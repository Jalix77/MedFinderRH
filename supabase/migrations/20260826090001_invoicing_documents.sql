-- MedFinder Gestion — Phase 2C, jalon 2C.2 : socle documentaire de
-- facturation client. Plan : docs/phase-2c-plan.md.
--
-- ============================================================
-- PERIMETRE STRICT : AUCUNE COMPTABILISATION DANS CE JALON
-- ============================================================
-- Cette migration ne cree NI ecriture Dr Creances / Cr Produits, NI
-- helper comptable multi-lignes, NI encaissement, NI cash_movement, NI
-- rapprochement, NI paiement partiel/complet, NI posting. Aucune ligne
-- de journal_entries / journal_entry_lines / cash_movements n'est ecrite
-- ni modifiee. Les etats financiers de Phase 2B restent donc
-- structurellement inchanges par 2C.2 : un document emis ici n'apparait
-- dans AUCUN etat comptable tant que le jalon 2C.3 n'est pas livre.
--
-- Consequence assumee et signalee : les documents emis pendant la
-- fenetre 2C.2 n'auront pas d'ecriture. Le jalon 2C.3 devra traiter leur
-- comptabilisation (rattrapage explicite ou remise en brouillon), ce qui
-- est documente comme point d'attention de la revue 2C.2.
--
-- Decision arbitree n°3 : modele documentaire UNIFIE — facture et avoir
-- sont le MEME document (document_type), avec une numerotation separee.
-- Decision arbitree n°7 : aucune fiscalite codee en dur ; le compte de
-- produit est choisi par configuration (par ligne), jamais par une
-- constante enfouie.

-- =====================================================================
-- 1. Taux de taxe — configurables, AUCUN taux seede
-- =====================================================================

create table public.tax_rates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  code text not null check (length(trim(code)) > 0),
  label text not null check (length(trim(label)) > 0),
  rate_percent numeric(6, 3) not null check (rate_percent >= 0 and rate_percent <= 100),
  -- Compte de taxe a reverser. Utilise a partir du jalon 2C.3 pour la
  -- comptabilisation ; conserve des maintenant pour que la configuration
  -- soit complete et qu'aucun compte ne soit devine plus tard.
  tax_account_id uuid references public.chart_of_accounts (id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  unique (organization_id, code)
);

comment on table public.tax_rates is
  'Taux de taxe configurables par organisation (Phase 2C.2). AUCUN taux '
  'n''est seede : aucune fiscalite haitienne n''est presumee tant '
  'qu''elle n''a pas ete validee. Une facturation sans taxe fonctionne '
  'integralement (tax_rate_id nullable sur les lignes).';

create index tax_rates_org_idx on public.tax_rates (organization_id);
create index tax_rates_account_idx on public.tax_rates (tax_account_id) where tax_account_id is not null;

create trigger set_updated_at
  before update on public.tax_rates
  for each row execute function app_private.set_updated_at();

create trigger audit_tax_rates
  after insert or update or delete on public.tax_rates
  for each row execute function app_private.audit_row_trigger();

alter table public.tax_rates enable row level security;

-- =====================================================================
-- 2. Documents de facturation — modele UNIFIE facture / avoir
-- =====================================================================

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  -- Decision arbitree n°3 : un seul modele documentaire.
  document_type text not null default 'INVOICE'
    check (document_type in ('INVOICE', 'CREDIT_NOTE')),
  -- NULL tant que le document est en brouillon : le numero n'est attribue
  -- qu'a l'EMISSION, ce qui evite tout trou de sequence du a des
  -- brouillons abandonnes (hypothese §15.8 du plan).
  document_number text,
  -- Avoir rattache a une facture d'origine (decision arbitree n°3).
  credited_invoice_id uuid references public.invoices (id) on delete restrict,

  -- Lien OBLIGATOIRE au tiers client (role verifie par trigger).
  third_party_id uuid not null references public.third_parties (id) on delete restrict,

  -- Statuts documentaires stricts. L'ensemble complet est declare des
  -- maintenant pour qu'aucune contrainte CHECK n'ait a etre reecrite plus
  -- tard (une modification de CHECK n'est pas une operation additive) ;
  -- 'partially_paid' et 'paid' ne sont ATTEIGNABLES qu'a partir du jalon
  -- 2C.4 (paiements), aucune transition de 2C.2 n'y mene.
  status text not null default 'draft'
    check (status in ('draft', 'pending_issue', 'issued', 'partially_paid', 'paid', 'cancelled')),

  document_date date not null default current_date,
  due_date date not null,
  issued_at timestamptz,
  issued_by uuid references public.users (id),

  currency char(3) not null default 'HTG' check (currency in ('HTG', 'USD')),
  -- Taux fige a l'emission, jamais reevalue retroactivement (decision
  -- Phase 2B §8 reconduite).
  exchange_rate_to_htg numeric(14, 6) not null default 1 check (exchange_rate_to_htg > 0),

  -- Montants recalcules exclusivement a partir des lignes (§3 ci-dessous)
  -- — jamais fournis par le client.
  subtotal numeric(14, 2) not null default 0,
  tax_total numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  -- Contre-valeur fonctionnelle HTG, historique par construction : elle
  -- derive du taux fige sur le document.
  total_htg numeric(14, 2) generated always as (round(total * exchange_rate_to_htg, 2)) stored,

  external_reference text,
  notes text,
  -- Motif obligatoire pour un avoir (contrainte plus bas).
  credit_reason text,

  cost_center_id uuid references public.cost_centers (id) on delete set null,

  cancelled_at timestamptz,
  cancelled_by uuid references public.users (id),
  cancel_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),

  -- --- Coherence documentaire ---
  constraint invoices_due_after_document_date check (due_date >= document_date),
  constraint invoices_total_is_sum check (total = subtotal + tax_total),
  -- Seul un avoir peut crediter une facture.
  constraint invoices_credit_link_only_for_credit_note
    check (document_type = 'CREDIT_NOTE' or credited_invoice_id is null),
  -- Un avoir exige un motif.
  constraint invoices_credit_reason_required
    check (document_type <> 'CREDIT_NOTE' or (credit_reason is not null and length(trim(credit_reason)) > 0)),
  -- Un document non brouillon possede necessairement un numero.
  constraint invoices_number_required_once_issued
    check (status in ('draft', 'pending_issue') or document_number is not null),
  -- En HTG, le taux vers HTG est necessairement 1.
  constraint invoices_htg_rate_is_one
    check (currency <> 'HTG' or exchange_rate_to_htg = 1),
  -- Une annulation est toujours motivee.
  constraint invoices_cancel_reason_required
    check (status <> 'cancelled' or (cancel_reason is not null and length(trim(cancel_reason)) > 0))
);

comment on table public.invoices is
  'Documents de facturation client (Phase 2C.2) — modele UNIFIE : '
  'document_type = INVOICE | CREDIT_NOTE, numerotation separee. '
  'AUCUNE comptabilisation a ce jalon : la generation d''ecritures '
  'commence au jalon 2C.3.';

-- Numero unique par organisation, uniquement lorsqu'il est attribue.
create unique index invoices_number_unique_idx
  on public.invoices (organization_id, document_number)
  where document_number is not null;

create index invoices_org_idx on public.invoices (organization_id);
create index invoices_third_party_idx on public.invoices (third_party_id);
create index invoices_org_status_idx on public.invoices (organization_id, status);
create index invoices_org_type_idx on public.invoices (organization_id, document_type);
create index invoices_due_date_idx on public.invoices (organization_id, due_date)
  where status in ('issued', 'partially_paid');
create index invoices_credited_idx on public.invoices (credited_invoice_id)
  where credited_invoice_id is not null;
create index invoices_cost_center_idx on public.invoices (cost_center_id)
  where cost_center_id is not null;

create trigger set_updated_at
  before update on public.invoices
  for each row execute function app_private.set_updated_at();

create trigger audit_invoices
  after insert or update or delete on public.invoices
  for each row execute function app_private.audit_row_trigger();

alter table public.invoices enable row level security;

-- =====================================================================
-- 3. Lignes de document — calcul DETERMINISTE cote serveur
-- =====================================================================
-- Les trois montants sont des COLONNES GENEREES : ils ne peuvent pas
-- etre fournis par le client, ni diverger de la formule. PostgreSQL
-- interdisant a une colonne generee d'en referencer une autre, la
-- sous-expression round(quantity * unit_price, 2) est repetee — c'est
-- volontaire et sans ambiguite.
--
-- tax_rate_percent est un INSTANTANE du taux au moment de la saisie :
-- modifier un tax_rates plus tard ne doit jamais reecrire un document
-- deja etabli.

create table public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  line_number smallint not null check (line_number > 0),

  description text not null check (length(trim(description)) > 0),
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price numeric(14, 2) not null check (unit_price >= 0),

  -- Decision arbitree n°7 : le compte de produit est choisi par
  -- configuration, ligne par ligne. Aucune constante de compte n'est
  -- enfouie dans une RPC.
  revenue_account_id uuid not null references public.chart_of_accounts (id) on delete restrict,

  tax_rate_id uuid references public.tax_rates (id) on delete restrict,
  tax_rate_percent numeric(6, 3) not null default 0
    check (tax_rate_percent >= 0 and tax_rate_percent <= 100),

  line_subtotal numeric(14, 2)
    generated always as (round(quantity * unit_price, 2)) stored,
  tax_amount numeric(14, 2)
    generated always as (round(round(quantity * unit_price, 2) * tax_rate_percent / 100, 2)) stored,
  line_total numeric(14, 2)
    generated always as (
      round(quantity * unit_price, 2)
      + round(round(quantity * unit_price, 2) * tax_rate_percent / 100, 2)
    ) stored,

  cost_center_id uuid references public.cost_centers (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),

  unique (invoice_id, line_number)
);

create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id);
create index invoice_lines_org_idx on public.invoice_lines (organization_id);
create index invoice_lines_revenue_account_idx on public.invoice_lines (revenue_account_id);
create index invoice_lines_tax_rate_idx on public.invoice_lines (tax_rate_id) where tax_rate_id is not null;
create index invoice_lines_cost_center_idx on public.invoice_lines (cost_center_id) where cost_center_id is not null;

create trigger set_updated_at
  before update on public.invoice_lines
  for each row execute function app_private.set_updated_at();

create trigger audit_invoice_lines
  after insert or update or delete on public.invoice_lines
  for each row execute function app_private.audit_row_trigger();

alter table public.invoice_lines enable row level security;

-- =====================================================================
-- 4. Table d'exception SoD a l'emission
--    (miroir exact de journal_entry_approvals, Phase 2A)
-- =====================================================================

create table public.invoice_issue_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  sod_rule_violated text not null default 'issuer_is_creator'
    check (sod_rule_violated in ('issuer_is_creator')),
  exception_justification text not null check (length(trim(exception_justification)) > 0),
  exception_requested_by uuid not null references public.users (id),
  exception_validated_by uuid references public.users (id),
  exception_validated_at timestamptz,
  exception_result text check (exception_result in ('approved', 'refused')),
  decision_reason text,
  created_at timestamptz not null default now(),
  -- Le demandeur ne peut jamais etre son propre validateur.
  check (
    exception_validated_by is null
    or exception_requested_by <> exception_validated_by
  )
);

create index invoice_issue_approvals_invoice_idx on public.invoice_issue_approvals (invoice_id);
create index invoice_issue_approvals_org_idx on public.invoice_issue_approvals (organization_id);

create trigger audit_invoice_issue_approvals
  after insert or update or delete on public.invoice_issue_approvals
  for each row execute function app_private.audit_row_trigger();

alter table public.invoice_issue_approvals enable row level security;

-- =====================================================================
-- 5. Coherence : organisation, role client, lien d'avoir
-- =====================================================================

create or replace function app_private.enforce_invoice_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_tp record;
  v_credited record;
begin
  select organization_id, is_customer, is_active, legal_name
    into v_tp
    from public.third_parties
    where id = new.third_party_id;

  if not found then
    raise exception 'Tiers % introuvable', new.third_party_id;
  end if;

  if v_tp.organization_id <> new.organization_id then
    raise exception
      'Incoherence organisation : le tiers % appartient a une autre organisation que le document',
      new.third_party_id;
  end if;

  if not v_tp.is_customer then
    raise exception
      'Le tiers "%" n''a pas le role client — impossible d''etablir un document de facturation a son nom',
      v_tp.legal_name;
  end if;

  -- Un tiers desactive ne peut pas recevoir un NOUVEAU document ; les
  -- documents deja existants restent modifiables/annulables.
  if tg_op = 'INSERT' and not v_tp.is_active then
    raise exception 'Le tiers "%" est desactive — aucun nouveau document ne peut lui etre adresse', v_tp.legal_name;
  end if;

  if new.credited_invoice_id is not null then
    select organization_id, document_type, status, currency
      into v_credited
      from public.invoices
      where id = new.credited_invoice_id;

    if not found then
      raise exception 'Facture creditee % introuvable', new.credited_invoice_id;
    end if;

    if v_credited.organization_id <> new.organization_id then
      raise exception 'Incoherence organisation : la facture creditee appartient a une autre organisation';
    end if;

    if v_credited.document_type <> 'INVOICE' then
      raise exception 'Un avoir ne peut crediter qu''une FACTURE, pas un autre avoir';
    end if;

    if v_credited.status not in ('issued', 'partially_paid', 'paid') then
      raise exception
        'Un avoir ne peut crediter qu''une facture EMISE (statut actuel : %)', v_credited.status;
    end if;

    -- La devise de l'avoir est necessairement celle de la facture creditee
    -- (decision arbitree n°5 : aucun ecart de change genere en 2C).
    if v_credited.currency <> new.currency then
      raise exception
        'La devise de l''avoir (%) doit etre celle de la facture creditee (%)',
        new.currency, v_credited.currency;
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function app_private.enforce_invoice_consistency() from public;

create trigger enforce_invoice_consistency
  before insert or update on public.invoices
  for each row execute function app_private.enforce_invoice_consistency();

-- Coherence des lignes : meme organisation que le document parent, et
-- compte de produit appartenant a la meme organisation.
create or replace function app_private.enforce_invoice_line_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_invoice_org uuid;
  v_account_org uuid;
  v_account_active boolean;
begin
  select organization_id into v_invoice_org
    from public.invoices where id = new.invoice_id;
  if v_invoice_org is null then
    raise exception 'Document % introuvable', new.invoice_id;
  end if;
  if v_invoice_org <> new.organization_id then
    raise exception 'Incoherence organisation entre la ligne et son document';
  end if;

  select organization_id, is_active into v_account_org, v_account_active
    from public.chart_of_accounts where id = new.revenue_account_id;
  if v_account_org is null then
    raise exception 'Compte de produit % introuvable', new.revenue_account_id;
  end if;
  if v_account_org <> new.organization_id then
    raise exception 'Le compte de produit appartient a une autre organisation';
  end if;
  if not v_account_active then
    raise exception 'Le compte de produit % est inactif', new.revenue_account_id;
  end if;

  return new;
end;
$$;

revoke execute on function app_private.enforce_invoice_line_consistency() from public;

create trigger enforce_invoice_line_consistency
  before insert or update on public.invoice_lines
  for each row execute function app_private.enforce_invoice_line_consistency();

-- =====================================================================
-- 6. Recalcul deterministe des totaux d'en-tete depuis les lignes
-- =====================================================================
-- Les totaux du document ne sont JAMAIS fournis par le client : ils sont
-- recalcules a chaque mutation de ligne. Le recalcul n'a lieu que tant
-- que le document est modifiable — apres emission, les lignes sont de
-- toute facon verrouillees (section 7).

create or replace function app_private.recalculate_invoice_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_invoice_id uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  update public.invoices i
  set subtotal  = coalesce(agg.sub, 0),
      tax_total = coalesce(agg.tax, 0),
      total     = coalesce(agg.sub, 0) + coalesce(agg.tax, 0)
  from (
    select
      sum(l.line_subtotal) as sub,
      sum(l.tax_amount)    as tax
    from public.invoice_lines l
    where l.invoice_id = v_invoice_id
  ) agg
  where i.id = v_invoice_id;

  return null;
end;
$$;

revoke execute on function app_private.recalculate_invoice_totals() from public;

create trigger recalculate_invoice_totals
  after insert or update or delete on public.invoice_lines
  for each row execute function app_private.recalculate_invoice_totals();

-- =====================================================================
-- 7. Immutabilite apres emission (decision arbitree n°10)
-- =====================================================================
-- Garde posee au niveau BASE, donc opposable a TOUS les chemins
-- privilegies applicatifs : Server Action, Route Handler, script
-- d'administration, et service_role inclus. Aucun code applicatif ne
-- peut la contourner puisqu'elle n'est pas dans le code applicatif.
--
-- Patron exact de journal_entries_immutable_once_posted (Phase 1C).

create or replace function app_private.invoices_immutable_once_issued()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('issued', 'partially_paid', 'paid', 'cancelled') then
      raise exception
        'Document % deja emis — suppression interdite (correction par avoir, annulation motivee)',
        coalesce(old.document_number, old.id::text);
    end if;
    return old;
  end if;

  if old.status in ('draft', 'pending_issue') then
    return new;
  end if;

  -- Document emis : seules les colonnes de cycle de vie peuvent bouger.
  -- amount_paid / statuts de paiement seront ouverts au jalon 2C.4.
  if new.document_type       is distinct from old.document_type
     or new.document_number  is distinct from old.document_number
     or new.third_party_id   is distinct from old.third_party_id
     or new.credited_invoice_id is distinct from old.credited_invoice_id
     or new.document_date    is distinct from old.document_date
     or new.due_date         is distinct from old.due_date
     or new.currency         is distinct from old.currency
     or new.exchange_rate_to_htg is distinct from old.exchange_rate_to_htg
     or new.subtotal         is distinct from old.subtotal
     or new.tax_total        is distinct from old.tax_total
     or new.total            is distinct from old.total
     or new.issued_at        is distinct from old.issued_at
     or new.issued_by        is distinct from old.issued_by
     or new.organization_id  is distinct from old.organization_id
     or new.credit_reason    is distinct from old.credit_reason
  then
    raise exception
      'Document % deja emis — modification interdite (aucune reecriture silencieuse ; correction par avoir)',
      coalesce(old.document_number, old.id::text);
  end if;

  return new;
end;
$$;

revoke execute on function app_private.invoices_immutable_once_issued() from public;

create trigger invoices_immutable_once_issued
  before update or delete on public.invoices
  for each row execute function app_private.invoices_immutable_once_issued();

-- Lignes : figees des que le document quitte l'etat modifiable.
create or replace function app_private.invoice_lines_immutable_once_issued()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status
    from public.invoices
    where id = coalesce(new.invoice_id, old.invoice_id);

  if v_status is not null and v_status not in ('draft', 'pending_issue') then
    raise exception
      'Document deja emis (statut %) — ses lignes ne peuvent plus etre ajoutees, modifiees ni supprimees',
      v_status;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function app_private.invoice_lines_immutable_once_issued() from public;

create trigger invoice_lines_immutable_once_issued
  before insert or update or delete on public.invoice_lines
  for each row execute function app_private.invoice_lines_immutable_once_issued();

-- =====================================================================
-- 8. Numerotation — moteur existant, sequences SEPAREES facture / avoir
-- =====================================================================
-- Patron applique pour la 4e fois : redefinition CUMULATIVE de la
-- fonction de seed (les motifs deja livres sont reproduits a
-- l'identique), puis comblement des organisations existantes.

create or replace function app_private.seed_default_numbering_sequences()
returns trigger
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  insert into public.numbering_sequences (organization_id, entity_type, prefix_pattern, reset_rule)
  values
    (new.id, 'employee',         'EMP-{seq:04d}',        'never'),
    (new.id, 'journal_entry',    'JE-{year}-{seq:04d}',  'yearly'),
    (new.id, 'expense',          'DEP-{year}-{seq:04d}', 'yearly'),
    (new.id, 'third_party',      'TRS-{seq:04d}',        'never'),
    (new.id, 'customer_invoice', 'FAC-{year}-{seq:04d}', 'yearly'),
    (new.id, 'credit_note',      'AV-{year}-{seq:04d}',  'yearly')
  on conflict (organization_id, entity_type) do nothing;

  return new;
end;
$$;

insert into public.numbering_sequences (organization_id, entity_type, prefix_pattern, reset_rule)
select o.id, v.entity_type, v.prefix_pattern, v.reset_rule
from public.organizations o
cross join (values
  ('customer_invoice', 'FAC-{year}-{seq:04d}', 'yearly'),
  ('credit_note',      'AV-{year}-{seq:04d}',  'yearly')
) as v(entity_type, prefix_pattern, reset_rule)
where not exists (
  select 1 from public.numbering_sequences ns
  where ns.organization_id = o.id and ns.entity_type = v.entity_type
);

-- =====================================================================
-- 9. RLS — permissions EXISTANTES reutilisees, aucune creee
-- =====================================================================
-- invoice.manage (ventes) est seedee depuis la Phase 1A. La lecture est
-- ouverte en plus a accounting.view, qui porte deja la consultation des
-- etats comptables depuis la Phase 2B.
-- `(select auth.uid())` systematique : evite la regression
-- auth_rls_initplan corrigee en Phase 1C.

-- --- tax_rates ---
create policy tax_rates_select on public.tax_rates
  for select to authenticated
  using (
    app_private.is_super_admin((select auth.uid()))
    or app_private.has_permission((select auth.uid()), organization_id, 'invoice.manage')
    or app_private.has_permission((select auth.uid()), organization_id, 'accounting.view')
  );

create policy tax_rates_write on public.tax_rates
  for all to authenticated
  using (
    app_private.is_super_admin((select auth.uid()))
    or app_private.has_permission((select auth.uid()), organization_id, 'invoice.manage')
  )
  with check (
    app_private.is_super_admin((select auth.uid()))
    or app_private.has_permission((select auth.uid()), organization_id, 'invoice.manage')
  );

-- --- invoices ---
create policy invoices_select on public.invoices
  for select to authenticated
  using (
    app_private.is_super_admin((select auth.uid()))
    or app_private.has_permission((select auth.uid()), organization_id, 'invoice.manage')
    or app_private.has_permission((select auth.uid()), organization_id, 'accounting.view')
  );

-- Creation : uniquement en brouillon. Les transitions de statut passent
-- exclusivement par les RPC (jalon 2C.2, migration suivante).
create policy invoices_insert on public.invoices
  for insert to authenticated
  with check (
    (app_private.is_super_admin((select auth.uid()))
     or app_private.has_permission((select auth.uid()), organization_id, 'invoice.manage'))
    and status = 'draft'
    and document_number is null
  );

-- Modification directe : uniquement tant que le document est modifiable.
-- Le passage a 'issued' n'est PAS possible par cette voie (le WITH CHECK
-- impose un statut modifiable en sortie) — l'emission est reservee a la
-- RPC dediee, qui porte la garde de separation des fonctions.
create policy invoices_update_draft on public.invoices
  for update to authenticated
  using (
    (app_private.is_super_admin((select auth.uid()))
     or app_private.has_permission((select auth.uid()), organization_id, 'invoice.manage'))
    and status in ('draft', 'pending_issue')
  )
  with check (
    (app_private.is_super_admin((select auth.uid()))
     or app_private.has_permission((select auth.uid()), organization_id, 'invoice.manage'))
    and status in ('draft', 'pending_issue')
  );

-- Suppression : autorisee UNIQUEMENT sur un document non emis. Le
-- trigger de la section 7 ferme en plus le chemin service_role.
create policy invoices_delete_draft on public.invoices
  for delete to authenticated
  using (
    (app_private.is_super_admin((select auth.uid()))
     or app_private.has_permission((select auth.uid()), organization_id, 'invoice.manage'))
    and status in ('draft', 'pending_issue')
  );

-- --- invoice_lines ---
create policy invoice_lines_select on public.invoice_lines
  for select to authenticated
  using (
    app_private.is_super_admin((select auth.uid()))
    or app_private.has_permission((select auth.uid()), organization_id, 'invoice.manage')
    or app_private.has_permission((select auth.uid()), organization_id, 'accounting.view')
  );

create policy invoice_lines_write on public.invoice_lines
  for all to authenticated
  using (
    app_private.is_super_admin((select auth.uid()))
    or app_private.has_permission((select auth.uid()), organization_id, 'invoice.manage')
  )
  with check (
    app_private.is_super_admin((select auth.uid()))
    or app_private.has_permission((select auth.uid()), organization_id, 'invoice.manage')
  );

-- --- invoice_issue_approvals ---
-- Lecture seule cote client : les ecritures passent par les RPC.
create policy invoice_issue_approvals_select on public.invoice_issue_approvals
  for select to authenticated
  using (
    app_private.is_super_admin((select auth.uid()))
    or app_private.has_permission((select auth.uid()), organization_id, 'invoice.manage')
    or app_private.has_permission((select auth.uid()), organization_id, 'accounting.view')
  );
