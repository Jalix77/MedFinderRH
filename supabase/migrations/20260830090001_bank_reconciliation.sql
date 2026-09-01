-- MedFinder Gestion — Phase 2D : rapprochement bancaire et de tresorerie.
--
-- ============================================================
-- PRINCIPE DIRECTEUR : AUCUNE SECONDE SOURCE COMPTABLE
-- ============================================================
-- Le rapprochement COMPARE des donnees externes (relevés) aux
-- mouvements de tresorerie et ecritures DEJA existants. Il ne cree
-- JAMAIS d'ecriture comptable, ne modifie aucun montant, et ne touche
-- qu'un seul champ hors de ses propres tables :
-- public.cash_movements.reconciled — un drapeau OPERATIONNEL, jamais un
-- montant ni une imputation.
--
-- Si un ecart reel exige un ajustement comptable, il passe par le moteur
-- existant (ecriture manuelle Phase 2A, avec sa separation
-- saisie/validation) — jamais par une modification silencieuse d'ici.
-- Aucune RPC de ce fichier ne cree de journal_entries.
--
-- PERIMETRE : comptes bancaires, caisse et mobile money deja modelises
-- en Phase 1C.2 (cash_accounts / bank_accounts / mobile_money_accounts),
-- sans aucune modification de ces tables.

-- =====================================================================
-- 1. Imports de releves
-- =====================================================================

create table public.bank_statement_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  -- Compte rapproche : meme couple (type, id) que cash_movements, donc
  -- couvre caisse, banque et mobile money sans structure parallele.
  treasury_account_type text not null
    check (treasury_account_type in ('cash', 'bank', 'mobile_money')),
  treasury_account_id uuid not null,

  statement_reference text not null check (length(trim(statement_reference)) > 0),
  period_start date not null,
  period_end date not null,

  currency char(3) not null check (currency in ('HTG', 'USD')),

  -- Soldes DU RELEVE (externes). Jamais confondus avec le solde
  -- comptable, qui reste derive de cash_movements.
  opening_balance_statement numeric(14, 2) not null default 0,
  closing_balance_statement numeric(14, 2) not null default 0,

  file_name text,
  source_format text not null default 'csv' check (source_format in ('csv', 'manual')),

  -- Empreinte du contenu importe : rend un DOUBLON D'IMPORT detectable
  -- de facon deterministe, independamment du nom de fichier.
  content_hash text not null,

  status text not null default 'imported' check (status in ('imported', 'cancelled')),
  cancel_reason text,
  cancelled_at timestamptz,
  cancelled_by uuid references public.users (id),

  line_count integer not null default 0 check (line_count >= 0),
  imported_at timestamptz not null default now(),
  imported_by uuid references public.users (id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),

  constraint bank_statement_imports_period_order check (period_end >= period_start),
  constraint bank_statement_imports_cancel_reason
    check (status <> 'cancelled' or (cancel_reason is not null and length(trim(cancel_reason)) > 0))
);

-- Anti-doublon STRUCTUREL : un meme contenu ne peut pas etre importe
-- deux fois sur le meme compte, sauf si le premier import a ete annule.
create unique index bank_statement_imports_no_duplicate_idx
  on public.bank_statement_imports (organization_id, treasury_account_type, treasury_account_id, content_hash)
  where status = 'imported';

create index bank_statement_imports_org_idx on public.bank_statement_imports (organization_id);
create index bank_statement_imports_account_idx
  on public.bank_statement_imports (treasury_account_type, treasury_account_id);
create index bank_statement_imports_period_idx
  on public.bank_statement_imports (organization_id, period_start, period_end);
create index bank_statement_imports_status_idx on public.bank_statement_imports (organization_id, status);

create trigger set_updated_at
  before update on public.bank_statement_imports
  for each row execute function app_private.set_updated_at();

create trigger audit_bank_statement_imports
  after insert or update or delete on public.bank_statement_imports
  for each row execute function app_private.audit_row_trigger();

alter table public.bank_statement_imports enable row level security;

-- =====================================================================
-- 2. Lignes de releve NORMALISEES
-- =====================================================================
-- Normalisation : direction + montant positif, exactement comme
-- cash_movements — ce qui rend la comparaison directe et sans
-- conversion de signe implicite. La ligne brute d'origine est conservee
-- en jsonb pour la tracabilite.

create table public.bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  import_id uuid not null references public.bank_statement_imports (id) on delete cascade,

  line_number integer not null check (line_number > 0),
  value_date date not null,
  label text not null check (length(trim(label)) > 0),
  external_reference text,

  direction text not null check (direction in ('in', 'out')),
  amount numeric(14, 2) not null check (amount > 0),
  currency char(3) not null check (currency in ('HTG', 'USD')),

  -- Ligne source telle qu'importee — jamais reecrite.
  raw_line jsonb,

  status text not null default 'unreconciled'
    check (status in ('unreconciled', 'proposed', 'reconciled', 'discrepancy', 'ignored')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),

  unique (import_id, line_number)
);

create index bank_statement_lines_import_idx on public.bank_statement_lines (import_id);
create index bank_statement_lines_org_idx on public.bank_statement_lines (organization_id);
create index bank_statement_lines_status_idx on public.bank_statement_lines (organization_id, status);
create index bank_statement_lines_matching_idx
  on public.bank_statement_lines (organization_id, value_date, direction, amount);

create trigger set_updated_at
  before update on public.bank_statement_lines
  for each row execute function app_private.set_updated_at();

create trigger audit_bank_statement_lines
  after insert or update or delete on public.bank_statement_lines
  for each row execute function app_private.audit_row_trigger();

alter table public.bank_statement_lines enable row level security;

-- =====================================================================
-- 3. Rapprochements
-- =====================================================================

create table public.bank_reconciliation_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  statement_line_id uuid not null references public.bank_statement_lines (id) on delete restrict,
  cash_movement_id uuid not null references public.cash_movements (id) on delete restrict,

  match_type text not null check (match_type in ('auto', 'manual')),
  status text not null default 'proposed' check (status in ('proposed', 'validated', 'rejected')),

  -- Ecarts mesures au moment de la proposition, conserves tels quels.
  amount_difference numeric(14, 2) not null default 0,
  date_difference_days integer not null default 0,

  notes text,

  proposed_by uuid references public.users (id),
  proposed_at timestamptz not null default now(),
  validated_by uuid references public.users (id),
  validated_at timestamptz,
  rejection_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),

  constraint bank_matches_rejection_reason
    check (status <> 'rejected' or (rejection_reason is not null and length(trim(rejection_reason)) > 0)),
  -- Separation des fonctions : le validateur n'est jamais le proposant.
  constraint bank_matches_validator_distinct
    check (validated_by is null or proposed_by is null or validated_by <> proposed_by)
);

-- =====================================================================
-- PREVENTION DU DOUBLE RAPPROCHEMENT — garanties STRUCTURELLES
-- =====================================================================
-- Une ligne de releve ne peut porter qu'UN SEUL rapprochement valide, et
-- un mouvement de tresorerie ne peut etre rapproche qu'UNE SEULE fois.
-- Ces deux index partiels rendent le double rapprochement impossible au
-- niveau base, independamment du code applicatif.
create unique index bank_matches_one_validated_per_line_idx
  on public.bank_reconciliation_matches (statement_line_id)
  where status = 'validated';

create unique index bank_matches_one_validated_per_movement_idx
  on public.bank_reconciliation_matches (cash_movement_id)
  where status = 'validated';

-- Une seule proposition en attente par ligne : evite d'empiler des
-- propositions concurrentes sur la meme ligne.
create unique index bank_matches_one_proposed_per_line_idx
  on public.bank_reconciliation_matches (statement_line_id)
  where status = 'proposed';

create index bank_matches_org_idx on public.bank_reconciliation_matches (organization_id);
create index bank_matches_line_idx on public.bank_reconciliation_matches (statement_line_id);
create index bank_matches_movement_idx on public.bank_reconciliation_matches (cash_movement_id);
create index bank_matches_status_idx on public.bank_reconciliation_matches (organization_id, status);

create trigger set_updated_at
  before update on public.bank_reconciliation_matches
  for each row execute function app_private.set_updated_at();

create trigger audit_bank_reconciliation_matches
  after insert or update or delete on public.bank_reconciliation_matches
  for each row execute function app_private.audit_row_trigger();

alter table public.bank_reconciliation_matches enable row level security;

-- =====================================================================
-- 4. Coherence d'organisation et de compte
-- =====================================================================

create or replace function app_private.enforce_bank_statement_line_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_import record;
begin
  select organization_id, currency, status
    into v_import
    from public.bank_statement_imports
   where id = new.import_id;

  if not found then
    raise exception 'Import de releve % introuvable', new.import_id;
  end if;
  if v_import.organization_id <> new.organization_id then
    raise exception 'Incoherence organisation entre la ligne de releve et son import';
  end if;
  if v_import.currency <> new.currency then
    raise exception
      'La devise de la ligne (%) doit etre celle du releve (%)', new.currency, v_import.currency;
  end if;

  return new;
end;
$$;

revoke execute on function app_private.enforce_bank_statement_line_consistency() from public;

create trigger enforce_bank_statement_line_consistency
  before insert or update on public.bank_statement_lines
  for each row execute function app_private.enforce_bank_statement_line_consistency();

-- Coherence du rapprochement : meme organisation, meme compte de
-- tresorerie, meme devise, meme sens. Ces regles sont posees en BASE et
-- non seulement en RPC, donc opposables a tout chemin privilegie.
create or replace function app_private.enforce_bank_match_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_line record;
  v_import record;
  v_mv record;
begin
  select organization_id, direction, currency, import_id
    into v_line from public.bank_statement_lines where id = new.statement_line_id;
  if not found then
    raise exception 'Ligne de releve % introuvable', new.statement_line_id;
  end if;

  select treasury_account_type, treasury_account_id
    into v_import from public.bank_statement_imports where id = v_line.import_id;

  select organization_id, direction, currency, treasury_account_type, treasury_account_id
    into v_mv from public.cash_movements where id = new.cash_movement_id;
  if not found then
    raise exception 'Mouvement de tresorerie % introuvable', new.cash_movement_id;
  end if;

  if v_line.organization_id <> new.organization_id
     or v_mv.organization_id <> new.organization_id then
    raise exception 'Incoherence organisation entre la ligne, le mouvement et le rapprochement';
  end if;

  if v_mv.treasury_account_type <> v_import.treasury_account_type
     or v_mv.treasury_account_id <> v_import.treasury_account_id then
    raise exception
      'Le mouvement de tresorerie n''appartient pas au compte rapproche par ce releve';
  end if;

  if v_mv.currency <> v_line.currency then
    raise exception
      'Devises incompatibles : ligne de releve % / mouvement %', v_line.currency, v_mv.currency;
  end if;

  if v_mv.direction <> v_line.direction then
    raise exception
      'Sens incompatibles : ligne de releve % / mouvement %', v_line.direction, v_mv.direction;
  end if;

  return new;
end;
$$;

revoke execute on function app_private.enforce_bank_match_consistency() from public;

create trigger enforce_bank_match_consistency
  before insert or update on public.bank_reconciliation_matches
  for each row execute function app_private.enforce_bank_match_consistency();

-- =====================================================================
-- 5. Immutabilite apres validation
-- =====================================================================
-- Un rapprochement VALIDE est fige et ne peut jamais etre supprime :
-- correction par rejet explicite AVANT validation, ou par annulation
-- motivee de l'import (section 7) — jamais par suppression destructive.

create or replace function app_private.bank_matches_immutable_once_validated()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'validated' then
      raise exception
        'Rapprochement % deja valide — suppression interdite (aucune suppression destructive d''un rapprochement valide)',
        old.id;
    end if;
    return old;
  end if;

  if old.status <> 'validated' then
    return new;
  end if;

  if new.statement_line_id  is distinct from old.statement_line_id
     or new.cash_movement_id is distinct from old.cash_movement_id
     or new.match_type       is distinct from old.match_type
     or new.status           is distinct from old.status
     or new.amount_difference is distinct from old.amount_difference
     or new.date_difference_days is distinct from old.date_difference_days
     or new.validated_by     is distinct from old.validated_by
     or new.validated_at     is distinct from old.validated_at
     or new.organization_id  is distinct from old.organization_id
  then
    raise exception 'Rapprochement % deja valide — contenu immuable', old.id;
  end if;

  return new;
end;
$$;

revoke execute on function app_private.bank_matches_immutable_once_validated() from public;

create trigger bank_matches_immutable_once_validated
  before update or delete on public.bank_reconciliation_matches
  for each row execute function app_private.bank_matches_immutable_once_validated();

-- Une ligne de releve rapprochee ne peut plus etre supprimee ni voir ses
-- montants reecrits (l'import entier doit etre annule, et il ne peut
-- l'etre que si aucun rapprochement valide n'en depend — section 7).
create or replace function app_private.bank_statement_lines_immutable_once_reconciled()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'reconciled' then
      raise exception 'Ligne de releve % deja rapprochee — suppression interdite', old.id;
    end if;
    return old;
  end if;

  if new.amount        is distinct from old.amount
     or new.direction  is distinct from old.direction
     or new.currency   is distinct from old.currency
     or new.value_date is distinct from old.value_date
     or new.import_id  is distinct from old.import_id
     or new.organization_id is distinct from old.organization_id
  then
    raise exception
      'Ligne de releve % : les donnees importees sont immuables (ni montant, ni sens, ni devise, ni date)',
      old.id;
  end if;

  return new;
end;
$$;

revoke execute on function app_private.bank_statement_lines_immutable_once_reconciled() from public;

create trigger bank_statement_lines_immutable_once_reconciled
  before update or delete on public.bank_statement_lines
  for each row execute function app_private.bank_statement_lines_immutable_once_reconciled();

-- =====================================================================
-- 6. RLS — permissions EXISTANTES uniquement
-- =====================================================================
-- treasury.manage et treasury.reconcile sont seedees depuis la Phase 1A.
-- AUCUNE permission nouvelle n'est creee.
--
-- Ecriture : exclusivement par les RPC (aucune policy INSERT/UPDATE/
-- DELETE), afin que les regles de rapprochement, la separation des
-- fonctions et les gardes de periode ne puissent jamais etre contournees
-- par une ecriture directe.

create policy bank_statement_imports_select on public.bank_statement_imports
  for select to authenticated
  using (
    app_private.is_super_admin((select auth.uid()))
    or app_private.has_permission((select auth.uid()), organization_id, 'treasury.manage')
    or app_private.has_permission((select auth.uid()), organization_id, 'treasury.reconcile')
    or app_private.has_permission((select auth.uid()), organization_id, 'accounting.view')
  );

create policy bank_statement_lines_select on public.bank_statement_lines
  for select to authenticated
  using (
    app_private.is_super_admin((select auth.uid()))
    or app_private.has_permission((select auth.uid()), organization_id, 'treasury.manage')
    or app_private.has_permission((select auth.uid()), organization_id, 'treasury.reconcile')
    or app_private.has_permission((select auth.uid()), organization_id, 'accounting.view')
  );

create policy bank_reconciliation_matches_select on public.bank_reconciliation_matches
  for select to authenticated
  using (
    app_private.is_super_admin((select auth.uid()))
    or app_private.has_permission((select auth.uid()), organization_id, 'treasury.manage')
    or app_private.has_permission((select auth.uid()), organization_id, 'treasury.reconcile')
    or app_private.has_permission((select auth.uid()), organization_id, 'accounting.view')
  );

-- =====================================================================
-- 7. Helper interne : resolution du compte de tresorerie
-- =====================================================================
-- CONFINE a app_private, aucun grant a anon ni authenticated.

-- Fonction SCALAIRE stricte : 3 parametres d'ENTREE, aucun parametre OUT.
-- Un parametre OUT interdirait `return <valeur>` en PL/pgSQL (42804) alors
-- que tous les appels l'utilisent comme un scalaire :
--   v_currency := app_private.treasury_account_exists(...);
--
-- Le type de compte inconnu retourne null explicitement plutot que de
-- retomber sur mobile_money_accounts : le helper est correct par lui-meme,
-- independamment de la validation deja faite en amont par la RPC.
create or replace function app_private.treasury_account_exists(
  p_org_id uuid,
  p_type text,
  p_id uuid
) returns char(3)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_currency char(3);
begin
  if p_type = 'cash' then
    select currency
      into v_currency
      from public.cash_accounts
     where id = p_id
       and organization_id = p_org_id;

  elsif p_type = 'bank' then
    select currency
      into v_currency
      from public.bank_accounts
     where id = p_id
       and organization_id = p_org_id;

  elsif p_type = 'mobile_money' then
    select currency
      into v_currency
      from public.mobile_money_accounts
     where id = p_id
       and organization_id = p_org_id;

  else
    return null;
  end if;

  return v_currency;
end;
$$;

revoke all on function app_private.treasury_account_exists(uuid, text, uuid) from public;
revoke execute on function app_private.treasury_account_exists(uuid, text, uuid) from anon, authenticated;

-- ---------------------------------------------------------------------
-- 7 bis. Garde DB : le compte de tresorerie appartient bien a l'org
-- ---------------------------------------------------------------------
-- Cette garantie est posee en BASE, pas seulement dans
-- import_bank_statement() : un chemin privilegie (service_role, script
-- d'administration, future RPC) ne peut pas creer un import rattache au
-- compte d'une AUTRE organisation, ni dans une devise differente de
-- celle du compte.
--
-- SECURITY DEFINER justifie : le trigger doit pouvoir lire
-- cash_accounts / bank_accounts / mobile_money_accounts independamment
-- des policies RLS de l'appelant, faute de quoi un compte legitime mais
-- non visible serait rejete a tort. Le controle est en LECTURE SEULE et
-- ne peut que refuser, jamais elargir un droit.
create or replace function app_private.enforce_bank_statement_import_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_currency char(3);
begin
  v_currency := app_private.treasury_account_exists(
    new.organization_id, new.treasury_account_type, new.treasury_account_id);

  if v_currency is null then
    raise exception
      'Le compte de tresorerie (%, %) n''appartient pas a l''organisation %',
      new.treasury_account_type, new.treasury_account_id, new.organization_id;
  end if;

  if v_currency <> new.currency then
    raise exception
      'La devise du releve (%) doit etre celle du compte de tresorerie (%)',
      new.currency, v_currency;
  end if;

  return new;
end;
$$;

revoke all on function app_private.enforce_bank_statement_import_account() from public;
revoke execute on function app_private.enforce_bank_statement_import_account() from anon, authenticated;

create trigger enforce_bank_statement_import_account
  before insert or update of organization_id, treasury_account_type, treasury_account_id, currency
  on public.bank_statement_imports
  for each row execute function app_private.enforce_bank_statement_import_account();

-- =====================================================================
-- 8. RPC — import d'un releve
-- =====================================================================

create or replace function public.import_bank_statement(
  p_org_id uuid,
  p_treasury_account_type text,
  p_treasury_account_id uuid,
  p_statement_reference text,
  p_period_start date,
  p_period_end date,
  p_opening_balance numeric,
  p_closing_balance numeric,
  p_lines jsonb,
  p_file_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_currency char(3);
  v_hash text;
  v_import_id uuid;
  v_line jsonb;
  v_n integer := 0;
  v_existing uuid;
begin
  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, p_org_id, 'treasury.manage')
          or app_private.has_permission(v_actor, p_org_id, 'treasury.reconcile')) then
    perform app_private.write_audit_log(
      p_org_id, 'import_bank_statement', 'tresorerie', 'bank_statement_import', null,
      null, null, 'denied');
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  if p_treasury_account_type not in ('cash', 'bank', 'mobile_money') then
    return jsonb_build_object('success', false, 'error', 'invalid_treasury_account_type');
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('success', false, 'error', 'no_lines');
  end if;
  if p_period_end < p_period_start then
    return jsonb_build_object('success', false, 'error', 'invalid_period');
  end if;

  -- La devise du releve est DEDUITE du compte de tresorerie choisi,
  -- jamais fournie par l'appelant : aucun rapprochement en devise
  -- croisee n'est possible.
  v_currency := app_private.treasury_account_exists(p_org_id, p_treasury_account_type, p_treasury_account_id);
  if v_currency is null then
    return jsonb_build_object('success', false, 'error', 'treasury_account_not_found');
  end if;

  -- Empreinte deterministe du contenu : detecte un doublon d'import
  -- meme si le nom de fichier differe.
  --
  -- md5() plutot que digest() de pgcrypto : md5 est une fonction NATIVE
  -- de pg_catalog, donc toujours resoluble quel que soit le schema
  -- d'installation des extensions (dans Supabase, pgcrypto vit dans
  -- `extensions`, hors du search_path fixe de cette fonction). Il ne
  -- s'agit pas d'un usage cryptographique mais d'une detection de
  -- doublon : md5 y suffit pleinement.
  v_hash := md5(p_lines::text);

  select id into v_existing
    from public.bank_statement_imports
   where organization_id = p_org_id
     and treasury_account_type = p_treasury_account_type
     and treasury_account_id = p_treasury_account_id
     and content_hash = v_hash
     and status = 'imported'
   limit 1;

  if v_existing is not null then
    perform app_private.write_audit_log(
      p_org_id, 'import_bank_statement', 'tresorerie', 'bank_statement_import', v_existing,
      null, jsonb_build_object('reason', 'duplicate_import'), 'denied');
    return jsonb_build_object(
      'success', false, 'error', 'duplicate_import', 'existing_import_id', v_existing);
  end if;

  insert into public.bank_statement_imports (
    organization_id, treasury_account_type, treasury_account_id,
    statement_reference, period_start, period_end, currency,
    opening_balance_statement, closing_balance_statement,
    file_name, content_hash, imported_by, created_by, updated_by
  ) values (
    p_org_id, p_treasury_account_type, p_treasury_account_id,
    p_statement_reference, p_period_start, p_period_end, v_currency,
    coalesce(p_opening_balance, 0), coalesce(p_closing_balance, 0),
    p_file_name, v_hash, v_actor, v_actor, v_actor
  ) returning id into v_import_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_n := v_n + 1;
    insert into public.bank_statement_lines (
      organization_id, import_id, line_number, value_date, label,
      external_reference, direction, amount, currency, raw_line,
      created_by, updated_by
    ) values (
      p_org_id, v_import_id, v_n,
      (v_line->>'value_date')::date,
      coalesce(nullif(trim(v_line->>'label'), ''), '(sans libelle)'),
      nullif(v_line->>'external_reference', ''),
      v_line->>'direction',
      (v_line->>'amount')::numeric,
      v_currency,
      v_line,
      v_actor, v_actor
    );
  end loop;

  update public.bank_statement_imports set line_count = v_n where id = v_import_id;

  perform app_private.write_audit_log(
    p_org_id, 'import_bank_statement', 'tresorerie', 'bank_statement_import', v_import_id,
    null, jsonb_build_object('lines', v_n, 'reference', p_statement_reference), 'success');

  return jsonb_build_object(
    'success', true, 'import_id', v_import_id, 'line_count', v_n, 'currency', v_currency);
end;
$$;

revoke all on function public.import_bank_statement(uuid, text, uuid, text, date, date, numeric, numeric, jsonb, text) from public;
grant execute on function public.import_bank_statement(uuid, text, uuid, text, date, date, numeric, numeric, jsonb, text) to authenticated;

-- =====================================================================
-- 9. RPC — propositions automatiques DETERMINISTES
-- =====================================================================
-- Regle : une proposition n'est emise que si il existe EXACTEMENT UN
-- mouvement candidat. En cas d'ambiguite (0 ou >1 candidat), aucune
-- proposition n'est faite — le rapprochement reste manuel. C'est ce qui
-- rend l'automatisme deterministe et reproductible.
--
-- Criteres du candidat : meme organisation, meme compte de tresorerie,
-- meme devise, meme sens, montant EXACTEMENT egal, date dans une
-- tolerance de +/- p_date_tolerance_days, et mouvement pas deja
-- rapproche ni deja engage dans un rapprochement propose/valide.

create or replace function public.propose_bank_reconciliation(
  p_import_id uuid,
  p_date_tolerance_days integer default 3
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_import public.bank_statement_imports%rowtype;
  v_line record;
  v_candidate uuid;
  v_candidate_count integer;
  v_candidate_date date;
  v_proposed integer := 0;
  v_ambiguous integer := 0;
  v_none integer := 0;
begin
  select * into v_import from public.bank_statement_imports where id = p_import_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'import_not_found');
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_import.organization_id, 'treasury.reconcile')) then
    perform app_private.write_audit_log(
      v_import.organization_id, 'propose_bank_reconciliation', 'tresorerie',
      'bank_statement_import', p_import_id, null, null, 'denied');
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  if v_import.status <> 'imported' then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;
  if p_date_tolerance_days < 0 or p_date_tolerance_days > 30 then
    return jsonb_build_object('success', false, 'error', 'invalid_tolerance');
  end if;

  for v_line in
    select l.* from public.bank_statement_lines l
     where l.import_id = p_import_id and l.status = 'unreconciled'
     order by l.line_number
  loop
    select count(*), min(m.id), min(m.movement_date)
      into v_candidate_count, v_candidate, v_candidate_date
      from public.cash_movements m
     where m.organization_id = v_import.organization_id
       and m.treasury_account_type = v_import.treasury_account_type
       and m.treasury_account_id = v_import.treasury_account_id
       and m.currency = v_line.currency
       and m.direction = v_line.direction
       and m.amount = v_line.amount
       and m.movement_date between v_line.value_date - p_date_tolerance_days
                               and v_line.value_date + p_date_tolerance_days
       -- Un mouvement deja marque rapproche n'est plus candidat, meme si
       -- son rapprochement d'origine n'est plus visible ici.
       and m.reconciled = false
       and not exists (
         select 1 from public.bank_reconciliation_matches x
          where x.cash_movement_id = m.id and x.status in ('proposed', 'validated')
       );

    if v_candidate_count = 1 then
      insert into public.bank_reconciliation_matches (
        organization_id, statement_line_id, cash_movement_id, match_type,
        status, amount_difference, date_difference_days,
        proposed_by, created_by, updated_by
      ) values (
        v_import.organization_id, v_line.id, v_candidate, 'auto',
        'proposed', 0, abs(v_candidate_date - v_line.value_date),
        v_actor, v_actor, v_actor
      );
      update public.bank_statement_lines set status = 'proposed' where id = v_line.id;
      v_proposed := v_proposed + 1;
    elsif v_candidate_count > 1 then
      v_ambiguous := v_ambiguous + 1;
    else
      v_none := v_none + 1;
    end if;
  end loop;

  perform app_private.write_audit_log(
    v_import.organization_id, 'propose_bank_reconciliation', 'tresorerie',
    'bank_statement_import', p_import_id, null,
    jsonb_build_object('proposed', v_proposed, 'ambiguous', v_ambiguous, 'unmatched', v_none),
    'success');

  return jsonb_build_object(
    'success', true, 'proposed', v_proposed,
    'ambiguous', v_ambiguous, 'unmatched', v_none);
end;
$$;

revoke all on function public.propose_bank_reconciliation(uuid, integer) from public;
grant execute on function public.propose_bank_reconciliation(uuid, integer) to authenticated;

-- =====================================================================
-- 10. RPC — rapprochement MANUEL
-- =====================================================================
-- Autorise un ecart de montant et/ou de date, mais l'ENREGISTRE
-- explicitement : un ecart n'est jamais absorbe en silence.

create or replace function public.create_manual_bank_match(
  p_statement_line_id uuid,
  p_cash_movement_id uuid,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_line public.bank_statement_lines%rowtype;
  v_mv public.cash_movements%rowtype;
  v_diff numeric(14, 2);
  v_days integer;
  v_id uuid;
begin
  select * into v_line from public.bank_statement_lines where id = p_statement_line_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'statement_line_not_found');
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_line.organization_id, 'treasury.reconcile')) then
    perform app_private.write_audit_log(
      v_line.organization_id, 'create_manual_bank_match', 'tresorerie',
      'bank_statement_line', p_statement_line_id, null, null, 'denied');
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  if v_line.status not in ('unreconciled', 'discrepancy') then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  select * into v_mv from public.cash_movements where id = p_cash_movement_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'cash_movement_not_found');
  end if;

  -- Anti-IDOR : un mouvement d'une autre organisation est traite comme
  -- inexistant, sans reveler son existence.
  if v_mv.organization_id <> v_line.organization_id then
    return jsonb_build_object('success', false, 'error', 'cash_movement_not_found');
  end if;

  if v_mv.currency <> v_line.currency then
    return jsonb_build_object('success', false, 'error', 'currency_mismatch');
  end if;
  if v_mv.direction <> v_line.direction then
    return jsonb_build_object('success', false, 'error', 'direction_mismatch');
  end if;

  if exists (
    select 1 from public.bank_reconciliation_matches x
     where x.cash_movement_id = p_cash_movement_id and x.status in ('proposed', 'validated')
  ) then
    return jsonb_build_object('success', false, 'error', 'movement_already_matched');
  end if;

  v_diff := v_line.amount - v_mv.amount;
  v_days := abs(v_mv.movement_date - v_line.value_date);

  insert into public.bank_reconciliation_matches (
    organization_id, statement_line_id, cash_movement_id, match_type,
    status, amount_difference, date_difference_days, notes,
    proposed_by, created_by, updated_by
  ) values (
    v_line.organization_id, p_statement_line_id, p_cash_movement_id, 'manual',
    'proposed', v_diff, v_days, p_notes, v_actor, v_actor, v_actor
  ) returning id into v_id;

  update public.bank_statement_lines
     set status = case when v_diff <> 0 then 'discrepancy' else 'proposed' end,
         updated_by = v_actor
   where id = p_statement_line_id;

  perform app_private.write_audit_log(
    v_line.organization_id, 'create_manual_bank_match', 'tresorerie',
    'bank_statement_line', p_statement_line_id, null,
    jsonb_build_object('match_id', v_id, 'amount_difference', v_diff, 'date_difference_days', v_days),
    'success');

  return jsonb_build_object(
    'success', true, 'match_id', v_id,
    'amount_difference', v_diff, 'date_difference_days', v_days);
end;
$$;

revoke all on function public.create_manual_bank_match(uuid, uuid, text) from public;
grant execute on function public.create_manual_bank_match(uuid, uuid, text) to authenticated;

-- =====================================================================
-- 11. RPC — validation d'un rapprochement (SoD + periode + verrouillage)
-- =====================================================================

create or replace function public.validate_bank_match(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_match public.bank_reconciliation_matches%rowtype;
  v_mv public.cash_movements%rowtype;
  v_period_id uuid;
  v_period_status text;
begin
  select * into v_match from public.bank_reconciliation_matches where id = p_match_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'match_not_found');
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_match.organization_id, 'treasury.reconcile')) then
    perform app_private.write_audit_log(
      v_match.organization_id, 'validate_bank_match', 'tresorerie',
      'bank_reconciliation_match', p_match_id, null, null, 'denied');
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  if v_match.status <> 'proposed' then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  -- SEPARATION DES FONCTIONS : le validateur ne peut pas etre celui qui
  -- a propose le rapprochement. Garde d'ACTEUR, meme mecanisme que les
  -- ecritures manuelles (2A) et l'emission de facture (2C.3A).
  if v_match.proposed_by = v_actor and not app_private.is_super_admin(v_actor) then
    perform app_private.write_audit_log(
      v_match.organization_id, 'validate_bank_match', 'tresorerie',
      'bank_reconciliation_match', p_match_id, null,
      jsonb_build_object('reason', 'self_validation_blocked'), 'denied');
    return jsonb_build_object('success', false, 'error', 'self_validation_blocked');
  end if;

  select * into v_mv from public.cash_movements where id = v_match.cash_movement_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'cash_movement_not_found');
  end if;

  -- PERIODE COMPTABLE : valider un rapprochement modifie un attribut
  -- d'un mouvement rattache a une periode. Si cette periode est fermee,
  -- l'operation est refusee — le controle existant n'est pas contourne.
  v_period_id := app_private.find_period_for_date(v_match.organization_id, v_mv.movement_date);
  if v_period_id is not null then
    select status into v_period_status from public.accounting_periods where id = v_period_id;
    if v_period_status <> 'open' then
      perform app_private.write_audit_log(
        v_match.organization_id, 'validate_bank_match', 'tresorerie',
        'bank_reconciliation_match', p_match_id, null,
        jsonb_build_object('reason', 'period_closed'), 'denied');
      return jsonb_build_object('success', false, 'error', 'period_closed');
    end if;
  end if;

  update public.bank_reconciliation_matches
     set status = 'validated', validated_by = v_actor, validated_at = now(), updated_by = v_actor
   where id = p_match_id;

  update public.bank_statement_lines
     set status = 'reconciled', updated_by = v_actor
   where id = v_match.statement_line_id;

  -- SEUL champ modifie hors des tables de rapprochement : un drapeau
  -- OPERATIONNEL. Aucun montant, aucune imputation, aucune ecriture.
  update public.cash_movements
     set reconciled = true, updated_by = v_actor
   where id = v_match.cash_movement_id;

  perform app_private.write_audit_log(
    v_match.organization_id, 'validate_bank_match', 'tresorerie',
    'bank_reconciliation_match', p_match_id, null,
    jsonb_build_object('cash_movement_id', v_match.cash_movement_id,
                       'amount_difference', v_match.amount_difference),
    'success');

  return jsonb_build_object('success', true, 'status', 'validated');
end;
$$;

revoke all on function public.validate_bank_match(uuid) from public;
grant execute on function public.validate_bank_match(uuid) to authenticated;

-- =====================================================================
-- 12. RPC — rejet motive d'une proposition
-- =====================================================================

create or replace function public.reject_bank_match(p_match_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_match public.bank_reconciliation_matches%rowtype;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    return jsonb_build_object('success', false, 'error', 'reason_required');
  end if;

  select * into v_match from public.bank_reconciliation_matches where id = p_match_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'match_not_found');
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_match.organization_id, 'treasury.reconcile')) then
    perform app_private.write_audit_log(
      v_match.organization_id, 'reject_bank_match', 'tresorerie',
      'bank_reconciliation_match', p_match_id, null, null, 'denied');
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  if v_match.status <> 'proposed' then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  update public.bank_reconciliation_matches
     set status = 'rejected', rejection_reason = p_reason, updated_by = v_actor
   where id = p_match_id;

  -- La ligne redevient disponible pour un autre rapprochement.
  update public.bank_statement_lines
     set status = 'unreconciled', updated_by = v_actor
   where id = v_match.statement_line_id;

  perform app_private.write_audit_log(
    v_match.organization_id, 'reject_bank_match', 'tresorerie',
    'bank_reconciliation_match', p_match_id, null,
    jsonb_build_object('reason', p_reason), 'success');

  return jsonb_build_object('success', true, 'status', 'rejected');
end;
$$;

revoke all on function public.reject_bank_match(uuid, text) from public;
grant execute on function public.reject_bank_match(uuid, text) to authenticated;

-- =====================================================================
-- 13. RPC — annulation motivee d'un import
-- =====================================================================
-- Refusee si un rapprochement VALIDE en depend : on ne detruit jamais un
-- rapprochement valide.
--
-- Si des propositions NON validees subsistent, elles sont amenees a un
-- etat TERMINAL coherent ('rejected', avec une raison systeme explicite)
-- plutot que laissees en suspens : sans cela, un mouvement de tresorerie
-- resterait artificiellement reserve par la proposition d'un import
-- annule, et sa ligne resterait 'proposed', bloquant tout reimport du
-- meme contenu.

create or replace function public.cancel_bank_statement_import(p_import_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_import public.bank_statement_imports%rowtype;
  v_validated integer;
  v_neutralised integer := 0;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    return jsonb_build_object('success', false, 'error', 'reason_required');
  end if;

  select * into v_import from public.bank_statement_imports where id = p_import_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'import_not_found');
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_import.organization_id, 'treasury.reconcile')) then
    perform app_private.write_audit_log(
      v_import.organization_id, 'cancel_bank_statement_import', 'tresorerie',
      'bank_statement_import', p_import_id, null, null, 'denied');
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  if v_import.status <> 'imported' then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  select count(*) into v_validated
    from public.bank_reconciliation_matches m
    join public.bank_statement_lines l on l.id = m.statement_line_id
   where l.import_id = p_import_id and m.status = 'validated';

  if v_validated > 0 then
    return jsonb_build_object(
      'success', false, 'error', 'has_validated_matches', 'validated_count', v_validated);
  end if;

  -- Neutralisation des propositions en attente. Etat terminal explicite,
  -- avec une raison SYSTEME distinguable d'un rejet metier.
  with neutralised as (
    update public.bank_reconciliation_matches m
       set status = 'rejected',
           rejection_reason = 'Annulation de l''import de releve : ' || p_reason,
           updated_by = v_actor
      from public.bank_statement_lines l
     where l.id = m.statement_line_id
       and l.import_id = p_import_id
       and m.status = 'proposed'
    returning m.statement_line_id
  )
  select count(*) into v_neutralised from neutralised;

  -- Les lignes redeviennent non rapprochees : aucune ne reste 'proposed'
  -- ou 'discrepancy' au titre d'une proposition desormais rejetee.
  update public.bank_statement_lines
     set status = 'unreconciled', updated_by = v_actor
   where import_id = p_import_id
     and status in ('proposed', 'discrepancy');

  update public.bank_statement_imports
     set status = 'cancelled', cancel_reason = p_reason,
         cancelled_at = now(), cancelled_by = v_actor, updated_by = v_actor
   where id = p_import_id;

  perform app_private.write_audit_log(
    v_import.organization_id, 'cancel_bank_statement_import', 'tresorerie',
    'bank_statement_import', p_import_id, null,
    jsonb_build_object('reason', p_reason, 'neutralised_matches', v_neutralised), 'success');

  return jsonb_build_object(
    'success', true, 'status', 'cancelled', 'neutralised_matches', v_neutralised);
end;
$$;

revoke all on function public.cancel_bank_statement_import(uuid, text) from public;
grant execute on function public.cancel_bank_statement_import(uuid, text) to authenticated;

-- =====================================================================
-- 14. RPC — etat de rapprochement : solde comptable vs solde releve
-- =====================================================================
-- Le solde COMPTABLE est derive de cash_movements (source unique
-- existante) ; le solde RELEVE vient de l'import. Aucun des deux n'est
-- recalcule a partir de l'autre.

create or replace function public.generate_bank_reconciliation_report(
  p_import_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_import public.bank_statement_imports%rowtype;
  v_book_in numeric(14, 2);
  v_book_out numeric(14, 2);
  v_book_opening numeric(14, 2);
  v_lines jsonb;
  v_unmatched_movements jsonb;
  v_stmt_in numeric(14, 2);
  v_stmt_out numeric(14, 2);
  v_reconciled_count integer;
  v_total_count integer;
begin
  select * into v_import from public.bank_statement_imports where id = p_import_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'import_not_found');
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_import.organization_id, 'treasury.reconcile')
          or app_private.has_permission(v_actor, v_import.organization_id, 'treasury.manage')
          or app_private.has_permission(v_actor, v_import.organization_id, 'accounting.view')) then
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  -- Solde comptable d'ouverture : mouvements STRICTEMENT anterieurs a la
  -- periode du releve.
  select coalesce(sum(case when direction = 'in' then amount else -amount end), 0)
    into v_book_opening
    from public.cash_movements
   where organization_id = v_import.organization_id
     and treasury_account_type = v_import.treasury_account_type
     and treasury_account_id = v_import.treasury_account_id
     and movement_date < v_import.period_start;

  select coalesce(sum(case when direction = 'in' then amount else 0 end), 0),
         coalesce(sum(case when direction = 'out' then amount else 0 end), 0)
    into v_book_in, v_book_out
    from public.cash_movements
   where organization_id = v_import.organization_id
     and treasury_account_type = v_import.treasury_account_type
     and treasury_account_id = v_import.treasury_account_id
     and movement_date between v_import.period_start and v_import.period_end;

  select coalesce(sum(case when direction = 'in' then amount else 0 end), 0),
         coalesce(sum(case when direction = 'out' then amount else 0 end), 0),
         count(*) filter (where status = 'reconciled'),
         count(*)
    into v_stmt_in, v_stmt_out, v_reconciled_count, v_total_count
    from public.bank_statement_lines
   where import_id = p_import_id;

  -- Lignes de releve non rapprochees (ecarts a traiter).
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id, 'line_number', l.line_number, 'value_date', l.value_date,
      'label', l.label, 'direction', l.direction, 'amount', l.amount,
      'status', l.status, 'external_reference', l.external_reference
    ) order by l.line_number), '[]'::jsonb)
    into v_lines
    from public.bank_statement_lines l
   where l.import_id = p_import_id and l.status <> 'reconciled';

  -- Mouvements comptables de la periode NON rapproches (l'autre cote de
  -- l'ecart : presents en comptabilite, absents du releve).
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'movement_date', m.movement_date, 'direction', m.direction,
      'amount', m.amount, 'description', m.description,
      'reference_type', m.reference_type
    ) order by m.movement_date), '[]'::jsonb)
    into v_unmatched_movements
    from public.cash_movements m
   where m.organization_id = v_import.organization_id
     and m.treasury_account_type = v_import.treasury_account_type
     and m.treasury_account_id = v_import.treasury_account_id
     and m.movement_date between v_import.period_start and v_import.period_end
     and not exists (
       select 1 from public.bank_reconciliation_matches x
        where x.cash_movement_id = m.id and x.status = 'validated'
     );

  return jsonb_build_object(
    'success', true,
    'import_id', p_import_id,
    'statement_reference', v_import.statement_reference,
    'currency', v_import.currency,
    'period_start', v_import.period_start,
    'period_end', v_import.period_end,
    'book_opening_balance', v_book_opening,
    'book_total_in', v_book_in,
    'book_total_out', v_book_out,
    'book_closing_balance', v_book_opening + v_book_in - v_book_out,
    'statement_opening_balance', v_import.opening_balance_statement,
    'statement_total_in', v_stmt_in,
    'statement_total_out', v_stmt_out,
    'statement_closing_balance', v_import.closing_balance_statement,
    'difference', (v_book_opening + v_book_in - v_book_out) - v_import.closing_balance_statement,
    'reconciled_lines', v_reconciled_count,
    'total_lines', v_total_count,
    'unreconciled_statement_lines', v_lines,
    'unmatched_cash_movements', v_unmatched_movements
  );
end;
$$;

revoke all on function public.generate_bank_reconciliation_report(uuid) from public;
grant execute on function public.generate_bank_reconciliation_report(uuid) to authenticated;

-- =====================================================================
-- 15. AUTO-VERIFICATION
-- =====================================================================
do $verify$
declare
  v int;
begin
  select count(*) into v from information_schema.tables
   where table_schema = 'public'
     and table_name in ('bank_statement_imports', 'bank_statement_lines', 'bank_reconciliation_matches');
  if v <> 3 then
    raise exception 'ECHEC : les 3 tables de rapprochement ne sont pas toutes creees (trouve %)', v;
  end if;

  select count(*) into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('import_bank_statement', 'propose_bank_reconciliation',
                       'create_manual_bank_match', 'validate_bank_match',
                       'reject_bank_match', 'cancel_bank_statement_import',
                       'generate_bank_reconciliation_report');
  if v <> 7 then
    raise exception 'ECHEC : les 7 RPC de rapprochement ne sont pas toutes creees (trouve %)', v;
  end if;

  -- Toute fonction Phase 2D doit avoir un search_path EXACTEMENT VIDE.
  -- La verification porte sur la valeur, pas sur la simple presence d'une
  -- configuration : `search_path=public, app_private` satisferait un test
  -- « une config existe » tout en laissant une resolution de nom
  -- dependante du schema, ce que cette phase exclut.
  select count(*) into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app_private')
     and p.proname in ('import_bank_statement', 'propose_bank_reconciliation',
                       'create_manual_bank_match', 'validate_bank_match',
                       'reject_bank_match', 'cancel_bank_statement_import',
                       'generate_bank_reconciliation_report',
                       'treasury_account_exists', 'enforce_bank_match_consistency',
                       'enforce_bank_statement_line_consistency',
                       'enforce_bank_statement_import_account',
                       'bank_matches_immutable_once_validated',
                       'bank_statement_lines_immutable_once_reconciled')
     and not exists (
       select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
        where cfg in ('search_path=""', 'search_path=')
     );
  if v > 0 then
    raise exception 'ECHEC : % fonction(s) Phase 2D dont le search_path n''est pas exactement vide', v;
  end if;

  -- Les 13 fonctions Phase 2D attendues doivent toutes exister (sans quoi
  -- le controle ci-dessus passerait a vide sur une fonction manquante).
  select count(*) into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'app_private')
     and p.proname in ('import_bank_statement', 'propose_bank_reconciliation',
                       'create_manual_bank_match', 'validate_bank_match',
                       'reject_bank_match', 'cancel_bank_statement_import',
                       'generate_bank_reconciliation_report',
                       'treasury_account_exists', 'enforce_bank_match_consistency',
                       'enforce_bank_statement_line_consistency',
                       'enforce_bank_statement_import_account',
                       'bank_matches_immutable_once_validated',
                       'bank_statement_lines_immutable_once_reconciled');
  if v <> 13 then
    raise exception 'ECHEC : 13 fonctions Phase 2D attendues, % trouvee(s)', v;
  end if;

  -- La garde d'appartenance du compte doit etre ARMEE sur la table.
  select count(*) into v from pg_trigger t
   where t.tgrelid = 'public.bank_statement_imports'::regclass
     and t.tgname = 'enforce_bank_statement_import_account'
     and not t.tgisinternal;
  if v <> 1 then
    raise exception 'ECHEC : le trigger d''appartenance du compte de tresorerie est absent';
  end if;

  -- Le helper interne ne doit jamais etre executable par anon/authenticated.
  select count(*) into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_private'
     and p.proname in ('treasury_account_exists', 'enforce_bank_statement_import_account')
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
       or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v > 0 then
    raise exception 'ECHEC : % helper(s) interne(s) app_private Phase 2D expose(s)', v;
  end if;

  raise notice 'OK : Phase 2D (rapprochement bancaire) appliquee et verifiee.';
end;
$verify$;
