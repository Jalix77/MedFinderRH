-- MedFinder Gestion — Phase 1C, sous-jalon 1C.1 — Comptabilite minimale
-- Socle strictement necessaire pour que le workflow depense (1C.4) et le
-- module PAPEJ (1C.5) puissent comptabiliser automatiquement, avec
-- l'invariant partie double garanti au moment du posting (docs/
-- accounting-design.md §1, corrige suite a la revue de Jean Alix Pierre —
-- voir docs/phase-1c-plan.md §5/§6/§7). PAS un module comptabilite complet :
-- aucune saisie manuelle, aucun etat financier — hors perimetre §1 du plan.
--
-- Permissions utilisees (accounting.post/reverse/close_period/view) : deja
-- seedees et accordees depuis la migration Phase 1A
-- 20260813100011_seed_rbac_catalogue.sql — aucune nouvelle permission ici
-- (voir docs/phase-1c-plan.md §3).
--
-- Classification de sensibilite (§80 prompt maitre) : donnees financieres
-- = "confidentiel" au minimum. Contrairement aux tables RH "publiques
-- internes" (departements/postes), la lecture ici est gardee par
-- accounting.view, pas ouverte a tout membre actif.

-- --- fiscal_years -----------------------------------------------------

create table public.fiscal_years (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  label text not null check (length(trim(label)) > 0),
  start_date date not null,
  end_date date not null check (end_date > start_date),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  unique (organization_id, label)
);

comment on table public.fiscal_years is
  'Exercices comptables. Donnee de configuration comptable (accounting.post).';

create trigger set_updated_at
  before update on public.fiscal_years
  for each row execute function app_private.set_updated_at();

create index fiscal_years_org_idx on public.fiscal_years (organization_id);

alter table public.fiscal_years enable row level security;

-- --- chart_of_accounts --------------------------------------------------

create table public.chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  code text not null check (length(trim(code)) > 0),
  label text not null check (length(trim(label)) > 0),
  type text not null check (type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  parent_account_id uuid references public.chart_of_accounts (id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  unique (organization_id, code)
);

comment on table public.chart_of_accounts is
  'Plan comptable, configurable par organisation (pas fige dans le code, '
  'permet une seconde entite juridique sans migration — accounting-design.md §1).';

create trigger set_updated_at
  before update on public.chart_of_accounts
  for each row execute function app_private.set_updated_at();

create index chart_of_accounts_org_idx on public.chart_of_accounts (organization_id);

alter table public.chart_of_accounts enable row level security;

-- --- accounting_periods --------------------------------------------------

create table public.accounting_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  fiscal_year_id uuid not null references public.fiscal_years (id) on delete cascade,
  month smallint not null check (month between 1 and 12),
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_by uuid references public.users (id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  unique (fiscal_year_id, month)
);

comment on table public.accounting_periods is
  'Une periode fermee est immuable (trigger accounting_periods_immutable_once_closed) '
  '— aucune reouverture silencieuse (§6/§7 du plan corrige).';

create trigger set_updated_at
  before update on public.accounting_periods
  for each row execute function app_private.set_updated_at();

create index accounting_periods_org_idx on public.accounting_periods (organization_id);
create index accounting_periods_fiscal_year_idx on public.accounting_periods (fiscal_year_id);

alter table public.accounting_periods enable row level security;

-- Defense en profondeur : meme un contexte SECURITY DEFINER (qui contourne
-- RLS) ne peut pas modifier une periode deja fermee. Seule garantie fiable
-- contre une reouverture silencieuse, y compris via un futur bug de policy.
create or replace function app_private.accounting_periods_immutable_once_closed()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'DELETE' then
    if OLD.status = 'closed' then
      raise exception 'Periode comptable % deja fermee — suppression interdite', OLD.id;
    end if;
    return OLD;
  end if;

  if OLD.status = 'closed' then
    raise exception 'Periode comptable % deja fermee — modification interdite (aucune reouverture silencieuse)', OLD.id;
  end if;
  return NEW;
end;
$$;

revoke execute on function app_private.accounting_periods_immutable_once_closed() from public;

create trigger accounting_periods_immutable_once_closed
  before update or delete on public.accounting_periods
  for each row execute function app_private.accounting_periods_immutable_once_closed();

-- --- journals -------------------------------------------------------------

create table public.journals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  code text not null check (length(trim(code)) > 0),
  label text not null check (length(trim(label)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  unique (organization_id, code)
);

comment on table public.journals is
  'Journaux comptables. 6 journaux standards auto-seedes a la creation de '
  'l''organisation (BANK/CASH/SALES/PURCHASES/PAYROLL/MISC), extensible.';

create trigger set_updated_at
  before update on public.journals
  for each row execute function app_private.set_updated_at();

create index journals_org_idx on public.journals (organization_id);

alter table public.journals enable row level security;

create or replace function app_private.seed_default_journals()
returns trigger
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  insert into public.journals (organization_id, code, label) values
    (new.id, 'BANK', 'Banque'),
    (new.id, 'CASH', 'Caisse'),
    (new.id, 'SALES', 'Ventes'),
    (new.id, 'PURCHASES', 'Achats'),
    (new.id, 'PAYROLL', 'Paie'),
    (new.id, 'MISC', 'Operations diverses')
  on conflict (organization_id, code) do nothing;

  return new;
end;
$$;

revoke execute on function app_private.seed_default_journals() from public;

create trigger seed_default_journals
  after insert on public.organizations
  for each row execute function app_private.seed_default_journals();

-- Comble les organisations existantes (Phase 1A/1B).
insert into public.journals (organization_id, code, label)
select o.id, j.code, j.label
from public.organizations o
cross join (values
  ('BANK', 'Banque'), ('CASH', 'Caisse'), ('SALES', 'Ventes'),
  ('PURCHASES', 'Achats'), ('PAYROLL', 'Paie'), ('MISC', 'Operations diverses')
) as j(code, label)
where not exists (
  select 1 from public.journals existing
  where existing.organization_id = o.id and existing.code = j.code
);

-- --- journal_entries / journal_entry_lines ---------------------------------

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  journal_id uuid not null references public.journals (id) on delete restrict,
  period_id uuid not null references public.accounting_periods (id) on delete restrict,
  entry_number text not null,
  entry_date date not null default current_date,
  description text,
  source_type text not null check (source_type in
    ('expense', 'invoice', 'payroll', 'asset', 'loan', 'contribution', 'grant', 'manual')),
  source_id uuid,
  status text not null default 'draft' check (status in ('draft', 'posted')),
  -- Auto-FK: pointe, sur l'ecriture de CONTRE-PASSATION, vers l'ecriture
  -- qu'elle reverse. L'ecriture d'origine n'est JAMAIS modifiee (§6 du plan
  -- corrige) — donc jamais de reversed_entry_id pose retroactivement dessus.
  reversed_entry_id uuid references public.journal_entries (id),
  posted_by uuid references public.users (id),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  unique (organization_id, entry_number)
);

comment on table public.journal_entries is
  'Aucune saisie manuelle en Phase 1C (hors perimetre) : toutes les '
  'ecritures sont creees et postees par app_private.create_and_post_two_line_entry() '
  '(appelee depuis les workflows Depenses/PAPEJ). Aucun INSERT/UPDATE/DELETE '
  'direct autorise a "authenticated" (voir grants plus bas) — seule une '
  'fonction SECURITY DEFINER peut ecrire ici.';

create trigger set_updated_at
  before update on public.journal_entries
  for each row execute function app_private.set_updated_at();

create index journal_entries_org_idx on public.journal_entries (organization_id);
create index journal_entries_period_idx on public.journal_entries (period_id);
create index journal_entries_source_idx on public.journal_entries (source_type, source_id);

alter table public.journal_entries enable row level security;

create table public.journal_entry_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entry_id uuid not null references public.journal_entries (id) on delete restrict,
  account_id uuid not null references public.chart_of_accounts (id) on delete restrict,
  debit numeric(14, 2) not null default 0 check (debit >= 0),
  credit numeric(14, 2) not null default 0 check (credit >= 0),
  third_party_type text check (third_party_type in ('customer', 'supplier', 'employee')),
  third_party_id uuid,
  currency char(3) not null default 'HTG',
  exchange_rate_to_htg numeric(14, 6) not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  check (debit = 0 or credit = 0),
  check (debit > 0 or credit > 0)
);

comment on table public.journal_entry_lines is
  'cost_center_id ajoute par la migration 1C.3 (budget) — cette table est '
  'creee avant que cost_centers n''existe. Meme regime d''ecriture que '
  'journal_entries : aucun acces direct "authenticated".';

create trigger set_updated_at
  before update on public.journal_entry_lines
  for each row execute function app_private.set_updated_at();

create index journal_entry_lines_entry_idx on public.journal_entry_lines (entry_id);
create index journal_entry_lines_account_idx on public.journal_entry_lines (account_id);
create index journal_entry_lines_org_idx on public.journal_entry_lines (organization_id);

alter table public.journal_entry_lines enable row level security;

-- Immutabilite post-POSTED (§5/§6 du plan corrige) : verifiee au niveau
-- trigger, pas seulement RLS — s'applique meme a un contexte SECURITY
-- DEFINER qui contournerait les policies. Une ligne peut etre modifiee/
-- supprimee tant que l'ecriture parente est "draft" (construction en cours) ;
-- plus aucune modification/suppression une fois "posted".
create or replace function app_private.journal_entries_immutable_once_posted()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'DELETE' then
    if OLD.status = 'posted' then
      raise exception 'Ecriture comptable % deja comptabilisee — suppression interdite (contre-passation requise)', OLD.id;
    end if;
    return OLD;
  end if;

  if OLD.status = 'posted' then
    raise exception 'Ecriture comptable % deja comptabilisee — modification interdite (contre-passation requise)', OLD.id;
  end if;
  return NEW;
end;
$$;

revoke execute on function app_private.journal_entries_immutable_once_posted() from public;

create trigger journal_entries_immutable_once_posted
  before update or delete on public.journal_entries
  for each row execute function app_private.journal_entries_immutable_once_posted();

create or replace function app_private.journal_entry_lines_immutable_once_posted()
returns trigger
language plpgsql
as $$
declare
  v_entry_status text;
begin
  select status into v_entry_status from public.journal_entries
    where id = coalesce(OLD.entry_id, NEW.entry_id);

  if v_entry_status = 'posted' then
    if TG_OP = 'DELETE' then
      raise exception 'Ligne d''ecriture comptable % : ecriture deja comptabilisee — suppression interdite', OLD.id;
    end if;
    raise exception 'Ligne d''ecriture comptable % : ecriture deja comptabilisee — modification interdite', OLD.id;
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

revoke execute on function app_private.journal_entry_lines_immutable_once_posted() from public;

create trigger journal_entry_lines_immutable_once_posted
  before update or delete on public.journal_entry_lines
  for each row execute function app_private.journal_entry_lines_immutable_once_posted();

-- --- RPC : posting, invariant verifie au moment atomique du passage a
-- --- 'posted', jamais ligne par ligne a l'insertion (§5/§6 du plan corrige)

-- app_private (jamais exposee via RPC PostgREST) : aucune saisie manuelle en
-- Phase 1C, uniquement appelee par d'autres fonctions security definer deja
-- responsables de la verification acteur/permission (post_expense en 1C.4,
-- record_grant_receipt en 1C.5).
create or replace function app_private.post_journal_entry(p_entry_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_entry public.journal_entries%rowtype;
  v_period_status text;
  v_line_count int;
  v_total_debit numeric(14, 2);
  v_total_credit numeric(14, 2);
  v_invalid_account_count int;
begin
  select * into v_entry from public.journal_entries where id = p_entry_id for update;
  if not found then
    raise exception 'Ecriture comptable % introuvable', p_entry_id;
  end if;
  if v_entry.status <> 'draft' then
    raise exception 'Ecriture comptable % n''est pas en brouillon (statut: %)', p_entry_id, v_entry.status;
  end if;

  -- Note : pas de write_audit_log("denied") ici pour period_closed/unbalanced
  -- ci-dessous — un audit ecrit dans la MEME transaction qu'un "raise
  -- exception" est annule par le rollback qu'il declenche (cf. convention
  -- documentee en tete de 20260813100009_admin_rpc_functions.sql : le
  -- couple perform+raise n'est utilise QUE pour de vraies denials
  -- d'autorisation, ou l'appelant renvoie un jsonb {success:false} au lieu
  -- de lever une exception — pas le cas ici, ces refus sont des violations
  -- d'invariant metier/donnee, pas des refus d'acces). L'exception elle-meme,
  -- propagee jusqu'a l'appelant (create_and_post_two_line_entry ou
  -- reverse_journal_entry), fait echouer toute l'operation englobante —
  -- comportement transactionnel voulu.
  select status into v_period_status from public.accounting_periods where id = v_entry.period_id;
  if v_period_status <> 'open' then
    raise exception 'Periode comptable fermee — comptabilisation impossible pour l''ecriture %', p_entry_id;
  end if;

  select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into v_line_count, v_total_debit, v_total_credit
    from public.journal_entry_lines
    where entry_id = p_entry_id;

  if v_line_count < 2 then
    raise exception 'Ecriture comptable % : au moins 2 lignes requises (trouve: %)', p_entry_id, v_line_count;
  end if;
  if v_total_debit <= 0 or v_total_credit <= 0 then
    raise exception 'Ecriture comptable % : total debit et credit doivent etre strictement positifs (debit=%, credit=%)',
      p_entry_id, v_total_debit, v_total_credit;
  end if;
  if v_total_debit <> v_total_credit then
    raise exception 'Ecriture comptable % desequilibree : debit=% credit=%', p_entry_id, v_total_debit, v_total_credit;
  end if;

  select count(*) into v_invalid_account_count
    from public.journal_entry_lines l
    join public.chart_of_accounts a on a.id = l.account_id
    where l.entry_id = p_entry_id
      and (a.organization_id <> v_entry.organization_id or not a.is_active);
  if v_invalid_account_count > 0 then
    raise exception 'Ecriture comptable % : % ligne(s) referencent un compte invalide/inactif/hors organisation',
      p_entry_id, v_invalid_account_count;
  end if;

  update public.journal_entries
     set status = 'posted', posted_by = p_actor, posted_at = now()
   where id = p_entry_id;

  perform app_private.write_audit_log(
    v_entry.organization_id, 'post_journal_entry', 'comptabilite', 'journal_entry', p_entry_id,
    null, jsonb_build_object('debit', v_total_debit, 'credit', v_total_credit), 'success'
  );
end;
$$;

revoke execute on function app_private.post_journal_entry(uuid, uuid) from public;

-- Enveloppe publique : verifie acteur/permission puis delegue. Il n'existe
-- pas de RPC publique pour CREER un brouillon en Phase 1C (aucune saisie
-- manuelle — §1 du plan), mais exposer la capacite de comptabiliser un
-- brouillon existant reste une fonctionnalite legitime (ex. outillage
-- futur, comptabilite corrective) et permet de tester les invariants de
-- app_private.post_journal_entry() independamment des workflows 1C.4/1C.5.
create or replace function public.post_journal_entry(p_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_org_id uuid;
begin
  select organization_id into v_org_id from public.journal_entries where id = p_entry_id;
  if v_org_id is null then
    raise exception 'Ecriture comptable % introuvable', p_entry_id;
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_org_id, 'accounting.post')) then
    perform app_private.write_audit_log(
      v_org_id, 'post_journal_entry', 'comptabilite', 'journal_entry', p_entry_id,
      null, null, 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  perform app_private.post_journal_entry(p_entry_id, v_actor);

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.post_journal_entry(uuid) from public;
grant execute on function public.post_journal_entry(uuid) to authenticated;

-- --- RPC : trouve la periode ouverte correspondant a une date ------------

create or replace function app_private.find_period_for_date(p_org_id uuid, p_date date)
returns uuid
language sql
stable
security definer
set search_path = public, app_private
as $$
  select ap.id
  from public.accounting_periods ap
  join public.fiscal_years fy on fy.id = ap.fiscal_year_id
  where fy.organization_id = p_org_id
    and p_date between fy.start_date and fy.end_date
    and ap.month = extract(month from p_date)::smallint
  limit 1;
$$;

-- Usage interne uniquement (create_and_post_two_line_entry) : rien ne la
-- rend accessible au client en Phase 1C (aucune UI de saisie manuelle), donc
-- aucun grant a authenticated — surface minimale (principe de moindre
-- privilege, contrairement au brouillon precedent de cette migration).
revoke execute on function app_private.find_period_for_date(uuid, date) from public;

-- --- RPC : creation + posting d'une ecriture a 2 lignes (cas d'usage
-- --- majoritaire : depense payee, reception de financement PAPEJ) --------

create or replace function app_private.create_and_post_two_line_entry(
  p_org_id uuid,
  p_journal_code text,
  p_entry_date date,
  p_description text,
  p_source_type text,
  p_source_id uuid,
  p_debit_account_id uuid,
  p_credit_account_id uuid,
  p_amount numeric,
  p_currency char(3),
  p_exchange_rate numeric,
  p_actor uuid
) returns uuid
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_journal_id uuid;
  v_period_id uuid;
  v_entry_number text;
  v_entry_id uuid;
begin
  if p_amount <= 0 then
    raise exception 'Montant invalide pour la comptabilisation: %', p_amount;
  end if;

  select id into v_journal_id from public.journals
    where organization_id = p_org_id and code = p_journal_code;
  if v_journal_id is null then
    raise exception 'Journal % introuvable pour l''organisation %', p_journal_code, p_org_id;
  end if;

  v_period_id := app_private.find_period_for_date(p_org_id, p_entry_date);
  if v_period_id is null then
    raise exception 'Aucune periode comptable configuree pour la date % (organisation %)', p_entry_date, p_org_id;
  end if;

  v_entry_number := app_private.next_number_internal(p_org_id, 'journal_entry');

  insert into public.journal_entries (
    organization_id, journal_id, period_id, entry_number, entry_date,
    description, source_type, source_id, status, created_by, updated_by
  ) values (
    p_org_id, v_journal_id, v_period_id, v_entry_number, p_entry_date,
    p_description, p_source_type, p_source_id, 'draft', p_actor, p_actor
  ) returning id into v_entry_id;

  insert into public.journal_entry_lines (
    organization_id, entry_id, account_id, debit, credit, currency, exchange_rate_to_htg, created_by, updated_by
  ) values
    (p_org_id, v_entry_id, p_debit_account_id, p_amount, 0, p_currency, p_exchange_rate, p_actor, p_actor),
    (p_org_id, v_entry_id, p_credit_account_id, 0, p_amount, p_currency, p_exchange_rate, p_actor, p_actor);

  perform app_private.post_journal_entry(v_entry_id, p_actor);

  return v_entry_id;
end;
$$;

revoke execute on function app_private.create_and_post_two_line_entry(
  uuid, text, date, text, text, uuid, uuid, uuid, numeric, char(3), numeric, uuid
) from public;

-- --- RPC : contre-passation — nouvelle ecriture, l'originale reste
-- --- strictement intacte (§6 du plan corrige) ------------------------------

create or replace function public.reverse_journal_entry(p_entry_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_original public.journal_entries%rowtype;
  v_new_entry_id uuid;
  v_new_entry_number text;
  v_period_id uuid;
begin
  select * into v_original from public.journal_entries where id = p_entry_id;
  if not found then
    raise exception 'Ecriture comptable % introuvable', p_entry_id;
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_original.organization_id, 'accounting.reverse')) then
    perform app_private.write_audit_log(
      v_original.organization_id, 'reverse_journal_entry', 'comptabilite', 'journal_entry', p_entry_id,
      null, jsonb_build_object('reason', p_reason), 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  if v_original.status <> 'posted' then
    return jsonb_build_object('success', false, 'error', 'entry_not_posted');
  end if;

  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Une justification est obligatoire pour une contre-passation';
  end if;

  -- Contre-passation dans la periode COURANTE (pas celle de l'ecriture
  -- d'origine, potentiellement fermee entretemps) — "toute anomalie
  -- detectee apres cloture se corrige par contre-passation sur la periode
  -- courante, jamais par reouverture" (accounting-design.md §7).
  v_period_id := app_private.find_period_for_date(v_original.organization_id, current_date);
  if v_period_id is null then
    raise exception 'Aucune periode comptable ouverte pour la date courante (organisation %)', v_original.organization_id;
  end if;

  v_new_entry_number := app_private.next_number_internal(v_original.organization_id, 'journal_entry');

  insert into public.journal_entries (
    organization_id, journal_id, period_id, entry_number, entry_date,
    description, source_type, source_id, status, reversed_entry_id, created_by, updated_by
  ) values (
    v_original.organization_id, v_original.journal_id, v_period_id, v_new_entry_number, current_date,
    'Contre-passation de ' || v_original.entry_number || ' — ' || p_reason,
    v_original.source_type, v_original.source_id, 'draft', v_original.id, v_actor, v_actor
  ) returning id into v_new_entry_id;

  -- Copie des lignes, debit/credit inverses.
  insert into public.journal_entry_lines (
    organization_id, entry_id, account_id, debit, credit, third_party_type, third_party_id,
    currency, exchange_rate_to_htg, created_by, updated_by
  )
  select
    organization_id, v_new_entry_id, account_id, credit, debit, third_party_type, third_party_id,
    currency, exchange_rate_to_htg, v_actor, v_actor
  from public.journal_entry_lines
  where entry_id = v_original.id;

  perform app_private.post_journal_entry(v_new_entry_id, v_actor);

  perform app_private.write_audit_log(
    v_original.organization_id, 'reverse_journal_entry', 'comptabilite', 'journal_entry', p_entry_id,
    null, jsonb_build_object('reversal_entry_id', v_new_entry_id, 'reason', p_reason), 'success'
  );

  return jsonb_build_object('success', true, 'reversal_entry_id', v_new_entry_id);
end;
$$;

revoke all on function public.reverse_journal_entry(uuid, text) from public;
grant execute on function public.reverse_journal_entry(uuid, text) to authenticated;

-- --- Audit trigger generique (Phase 1A/1B) sur toutes les nouvelles tables

create trigger audit_fiscal_years
  after insert or update or delete on public.fiscal_years
  for each row execute function app_private.audit_row_trigger();

create trigger audit_chart_of_accounts
  after insert or update or delete on public.chart_of_accounts
  for each row execute function app_private.audit_row_trigger();

create trigger audit_accounting_periods
  after insert or update or delete on public.accounting_periods
  for each row execute function app_private.audit_row_trigger();

create trigger audit_journals
  after insert or update or delete on public.journals
  for each row execute function app_private.audit_row_trigger();

create trigger audit_journal_entries
  after insert or update or delete on public.journal_entries
  for each row execute function app_private.audit_row_trigger();

create trigger audit_journal_entry_lines
  after insert or update or delete on public.journal_entry_lines
  for each row execute function app_private.audit_row_trigger();

-- --- Grants et RLS ---------------------------------------------------------

revoke all on public.fiscal_years, public.chart_of_accounts, public.accounting_periods,
  public.journals, public.journal_entries, public.journal_entry_lines
  from anon;

-- Tables de configuration comptable (CRUD simple, meme patron que
-- departements/postes en Phase 1B) : ecriture directe gardee par
-- accounting.post, jamais de DELETE reel.
grant select, insert, update on public.fiscal_years, public.chart_of_accounts, public.journals
  to authenticated;
revoke delete on public.fiscal_years, public.chart_of_accounts, public.journals from authenticated;

-- accounting_periods : INSERT (creation) gardee par accounting.post, mais
-- UPDATE (cloture) gardee par accounting.close_period specifiquement — deux
-- permissions differentes pour deux actions differentes.
grant select, insert, update on public.accounting_periods to authenticated;
revoke delete on public.accounting_periods from authenticated;

-- journal_entries / journal_entry_lines : ecriture EXCLUSIVEMENT via les
-- fonctions security definer ci-dessus (§5 du plan corrige) — aucun
-- privilege table-level pour "authenticated" au-dela de SELECT.
grant select on public.journal_entries, public.journal_entry_lines to authenticated;
revoke insert, update, delete on public.journal_entries, public.journal_entry_lines from authenticated;

create policy fiscal_years_select on public.fiscal_years
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'accounting.view')
  );

create policy fiscal_years_insert on public.fiscal_years
  for insert to authenticated
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'accounting.post')
  );

create policy fiscal_years_update on public.fiscal_years
  for update to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'accounting.post')
  )
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'accounting.post')
  );

create policy chart_of_accounts_select on public.chart_of_accounts
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'accounting.view')
  );

create policy chart_of_accounts_insert on public.chart_of_accounts
  for insert to authenticated
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'accounting.post')
  );

create policy chart_of_accounts_update on public.chart_of_accounts
  for update to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'accounting.post')
  )
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'accounting.post')
  );

create policy journals_select on public.journals
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'accounting.view')
  );

create policy journals_insert on public.journals
  for insert to authenticated
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'accounting.post')
  );

create policy journals_update on public.journals
  for update to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'accounting.post')
  )
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'accounting.post')
  );

create policy accounting_periods_select on public.accounting_periods
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'accounting.view')
  );

create policy accounting_periods_insert on public.accounting_periods
  for insert to authenticated
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'accounting.post')
  );

-- Transition unique autorisee : open -> closed. USING restreint les lignes
-- candidates aux periodes encore ouvertes ; WITH CHECK exige que le
-- resultat soit "closed" — combinaison qui rend toute autre transition
-- (ou toute modification d'une periode deja fermee) impossible via cette
-- policy, en plus du trigger d'immutabilite ci-dessus (defense en profondeur).
create policy accounting_periods_close on public.accounting_periods
  for update to authenticated
  using (
    status = 'open'
    and (app_private.is_super_admin(auth.uid())
         or app_private.has_permission(auth.uid(), organization_id, 'accounting.close_period'))
  )
  with check (status = 'closed');

create policy journal_entries_select on public.journal_entries
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'accounting.view')
  );

create policy journal_entry_lines_select on public.journal_entry_lines
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'accounting.view')
  );

-- --- Numerotation : ajout du type 'journal_entry' (moteur existant reutilise,
-- --- §11 du plan corrige — aucun second mecanisme de sequence) ------------

create or replace function app_private.seed_default_numbering_sequences()
returns trigger
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  insert into public.numbering_sequences (organization_id, entity_type, prefix_pattern, reset_rule)
  values
    (new.id, 'employee', 'EMP-{seq:04d}', 'never'),
    (new.id, 'journal_entry', 'JE-{year}-{seq:04d}', 'yearly')
  on conflict (organization_id, entity_type) do nothing;

  return new;
end;
$$;

insert into public.numbering_sequences (organization_id, entity_type, prefix_pattern, reset_rule)
select o.id, 'journal_entry', 'JE-{year}-{seq:04d}', 'yearly'
from public.organizations o
where not exists (
  select 1 from public.numbering_sequences ns
  where ns.organization_id = o.id and ns.entity_type = 'journal_entry'
);
