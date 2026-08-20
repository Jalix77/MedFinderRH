-- MedFinder Gestion — Phase 2C, jalon 2C.1 : referentiel de tiers.
-- Plan : docs/phase-2c-plan.md (approuve le 19/08/2026 avec 10 arbitrages).
--
-- PERIMETRE STRICT DE CE JALON : referentiel + RLS uniquement. AUCUNE
-- facture, AUCUN avoir, AUCUN paiement, AUCUNE ecriture comptable n'est
-- generee par cette migration. Les etats financiers de Phase 2B sont
-- donc structurellement inchanges par ce jalon.
--
-- Decision arbitree n°4 : referentiel UNIQUE (jamais deux tables
-- d'identite independantes). Un meme tiers peut porter les deux roles
-- CUSTOMER et SUPPLIER. C'est cette identite unique que
-- journal_entry_lines.third_party_id (colonne deja existante depuis 1C.1,
-- sans FK car polymorphe : 'employee' pointe vers public.employees)
-- referencera.
--
-- Decision arbitree n°6 : contacts et adresses en tables enfants
-- SIMPLES — aucun CRM (ni opportunites, ni activites, ni historique
-- d'interactions).

-- =====================================================================
-- 1. Table principale — identite canonique
-- =====================================================================

create table public.third_parties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  third_party_code text not null,

  -- Identite legale
  legal_name text not null check (length(trim(legal_name)) > 0),
  commercial_name text,
  legal_form text,
  -- NIF / identifiant fiscal : AUCUN format impose (hypothese §15.3 du
  -- plan — aucune specification fiscale haitienne validee a ce jour).
  tax_id text,

  -- Roles. Portes par deux drapeaux sur la table elle-meme plutot que
  -- par une table enfant : les policies RLS doivent arbitrer
  -- customer.manage vs supplier.manage AU MOMENT MEME de l'INSERT de la
  -- fiche ; avec une table enfant (inseree apres le parent) les roles
  -- n'existent pas encore a cet instant, ce qui rendrait la garde
  -- inoperante. Voir la note §2.1 du plan.
  is_customer boolean not null default false,
  is_supplier boolean not null default false,

  -- Coordonnees principales de l'entite (les contacts nominatifs vont
  -- dans third_party_contacts, les adresses dans third_party_addresses).
  email text,
  phone text,

  preferred_currency char(3) not null default 'HTG' check (preferred_currency in ('HTG', 'USD')),
  payment_terms_days integer not null default 0 check (payment_terms_days >= 0),

  -- Comptes collectifs : surcharge facultative du compte par defaut de
  -- l'organisation. Decision arbitree n°7 : aucun numero de compte n'est
  -- code en dur dans une RPC ; la resolution se fera en cascade
  -- (tiers -> defaut organisation -> erreur explicite).
  receivable_account_id uuid references public.chart_of_accounts (id) on delete restrict,
  payable_account_id uuid references public.chart_of_accounts (id) on delete restrict,

  -- Desactivation, jamais suppression, des qu'un tiers a servi (§9 du plan).
  is_active boolean not null default true,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),

  unique (organization_id, third_party_code),
  -- Un tiers qui n'est ni client ni fournisseur n'a aucun sens metier.
  constraint third_parties_at_least_one_role check (is_customer or is_supplier)
);

comment on table public.third_parties is
  'Referentiel unique des tiers (Phase 2C.1). Un meme tiers peut etre '
  'client ET fournisseur — identite canonique unique referencee par '
  'journal_entry_lines.third_party_id. Jamais supprime des qu''il est '
  'utilise : desactivation via is_active.';

-- Unicite du NIF par organisation, insensible a la casse, uniquement
-- lorsqu'il est renseigne (index partiel : plusieurs tiers sans NIF
-- restent possibles).
create unique index third_parties_tax_id_unique_idx
  on public.third_parties (organization_id, lower(tax_id))
  where tax_id is not null;

create index third_parties_org_idx on public.third_parties (organization_id);
create index third_parties_customer_idx on public.third_parties (organization_id) where is_customer;
create index third_parties_supplier_idx on public.third_parties (organization_id) where is_supplier;
create index third_parties_active_idx on public.third_parties (organization_id, is_active);
create index third_parties_legal_name_idx on public.third_parties (organization_id, lower(legal_name));
-- Cles etrangeres indexees : evite l'avertissement Performance Advisor
-- "cle etrangere non indexee" (lecon Phase 1C).
create index third_parties_receivable_account_idx on public.third_parties (receivable_account_id)
  where receivable_account_id is not null;
create index third_parties_payable_account_idx on public.third_parties (payable_account_id)
  where payable_account_id is not null;

create trigger set_updated_at
  before update on public.third_parties
  for each row execute function app_private.set_updated_at();

create trigger audit_third_parties
  after insert or update or delete on public.third_parties
  for each row execute function app_private.audit_row_trigger();

alter table public.third_parties enable row level security;

-- =====================================================================
-- 2. Tables enfants — contacts et adresses (decision arbitree n°6)
-- =====================================================================

create table public.third_party_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  third_party_id uuid not null references public.third_parties (id) on delete cascade,
  full_name text not null check (length(trim(full_name)) > 0),
  role_title text,
  email text,
  phone text,
  is_primary boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id)
);

create table public.third_party_addresses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  third_party_id uuid not null references public.third_parties (id) on delete cascade,
  address_type text not null default 'billing' check (address_type in ('billing', 'shipping', 'other')),
  address_line1 text not null check (length(trim(address_line1)) > 0),
  address_line2 text,
  city text,
  department text,
  country text not null default 'Haiti',
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id)
);

create index third_party_contacts_parent_idx on public.third_party_contacts (third_party_id);
create index third_party_contacts_org_idx on public.third_party_contacts (organization_id);
create index third_party_addresses_parent_idx on public.third_party_addresses (third_party_id);
create index third_party_addresses_org_idx on public.third_party_addresses (organization_id);

-- Au plus UN contact principal et UNE adresse principale par tiers.
create unique index third_party_contacts_one_primary_idx
  on public.third_party_contacts (third_party_id) where is_primary;
create unique index third_party_addresses_one_primary_idx
  on public.third_party_addresses (third_party_id) where is_primary;

create trigger set_updated_at
  before update on public.third_party_contacts
  for each row execute function app_private.set_updated_at();
create trigger set_updated_at
  before update on public.third_party_addresses
  for each row execute function app_private.set_updated_at();

create trigger audit_third_party_contacts
  after insert or update or delete on public.third_party_contacts
  for each row execute function app_private.audit_row_trigger();
create trigger audit_third_party_addresses
  after insert or update or delete on public.third_party_addresses
  for each row execute function app_private.audit_row_trigger();

alter table public.third_party_contacts enable row level security;
alter table public.third_party_addresses enable row level security;

-- =====================================================================
-- 3. Coherence d'organisation entre parent et enfants
--    (patron exact de app_private.enforce_budget_line_org_consistency)
-- =====================================================================

create or replace function app_private.enforce_third_party_child_org_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent_org uuid;
begin
  select organization_id into v_parent_org
    from public.third_parties where id = new.third_party_id;

  if v_parent_org is null then
    raise exception 'Tiers % introuvable', new.third_party_id;
  end if;

  if v_parent_org <> new.organization_id then
    raise exception
      'Incoherence organisation : la ligne enfant (%) n''appartient pas a la meme organisation que le tiers (%)',
      new.organization_id, v_parent_org;
  end if;

  return new;
end;
$$;

revoke execute on function app_private.enforce_third_party_child_org_consistency() from public;

create trigger enforce_org_consistency
  before insert or update on public.third_party_contacts
  for each row execute function app_private.enforce_third_party_child_org_consistency();

create trigger enforce_org_consistency
  before insert or update on public.third_party_addresses
  for each row execute function app_private.enforce_third_party_child_org_consistency();

-- =====================================================================
-- 4. Immutabilite : un tiers UTILISE n'est jamais supprimable
--    (patron exact de app_private.chart_of_accounts_immutable_if_used)
-- =====================================================================
-- journal_entry_lines.third_party_id ne peut pas porter de cle etrangere
-- (colonne POLYMORPHE : third_party_type = 'employee' pointe vers
-- public.employees). Ce trigger apporte donc la garantie qu'une FK ne
-- peut pas donner ici — decision arbitree n°4 / §16-D du plan.
--
-- `set search_path = ''` des l'ecriture : lecon directe du correctif
-- 20260824090001 (le Security Advisor reel avait signale la version
-- Phase 2A de ce meme patron, ecrite sans search_path fixe).

create or replace function app_private.third_parties_immutable_if_used()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_usage_count int;
begin
  select count(*) into v_usage_count
    from public.journal_entry_lines
    where third_party_id = OLD.id
      and third_party_type in ('customer', 'supplier');

  if v_usage_count > 0 then
    raise exception
      'Tiers % (%) deja utilise par % ligne(s) d''ecriture comptable — suppression interdite (desactivation uniquement)',
      OLD.legal_name, OLD.id, v_usage_count;
  end if;

  return OLD;
end;
$$;

revoke execute on function app_private.third_parties_immutable_if_used() from public;

create trigger third_parties_immutable_if_used
  before delete on public.third_parties
  for each row execute function app_private.third_parties_immutable_if_used();

-- =====================================================================
-- 5. Numerotation — moteur existant reutilise, aucun second mecanisme
-- =====================================================================
-- Patron deja applique trois fois (employee 1B, journal_entry 1C.1,
-- expense 1C.4) : la fonction de seed est REDEFINIE avec la liste
-- CUMULATIVE, puis les organisations existantes sont comblees.

create or replace function app_private.seed_default_numbering_sequences()
returns trigger
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  insert into public.numbering_sequences (organization_id, entity_type, prefix_pattern, reset_rule)
  values
    (new.id, 'employee',      'EMP-{seq:04d}',        'never'),
    (new.id, 'journal_entry', 'JE-{year}-{seq:04d}',  'yearly'),
    (new.id, 'expense',       'DEP-{year}-{seq:04d}', 'yearly'),
    (new.id, 'third_party',   'TRS-{seq:04d}',        'never')
  on conflict (organization_id, entity_type) do nothing;

  return new;
end;
$$;

-- Comble les organisations existantes.
insert into public.numbering_sequences (organization_id, entity_type, prefix_pattern, reset_rule)
select o.id, 'third_party', 'TRS-{seq:04d}', 'never'
from public.organizations o
where not exists (
  select 1 from public.numbering_sequences ns
  where ns.organization_id = o.id and ns.entity_type = 'third_party'
);

-- Auto-assignation du code tiers (meme patron que le matricule employe
-- et le numero de depense : atomique via next_number_internal, verrou de
-- ligne sur numbering_sequences).
create or replace function app_private.set_third_party_code()
returns trigger
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  if new.third_party_code is null or length(trim(new.third_party_code)) = 0 then
    new.third_party_code := app_private.next_number_internal(new.organization_id, 'third_party');
  end if;
  return new;
end;
$$;

revoke execute on function app_private.set_third_party_code() from public;

create trigger set_third_party_code
  before insert on public.third_parties
  for each row execute function app_private.set_third_party_code();

-- =====================================================================
-- 6. RLS — permissions DEJA existantes reutilisees, aucune creee
-- =====================================================================
-- customer.manage et supplier.manage sont seedees depuis la Phase 1A
-- (20260813100011_seed_rbac_catalogue.sql). Aucune nouvelle permission.
--
-- `(select auth.uid())` systematique : evite la regression
-- auth_rls_initplan corrigee en Phase 1C (20260816090016).
--
-- Regle de role : creer/modifier une fiche portant le role CUSTOMER
-- exige customer.manage ; le role SUPPLIER exige supplier.manage. Une
-- fiche mixte exige donc les DEUX permissions.

create policy third_parties_select on public.third_parties
  for select to authenticated
  using (
    app_private.is_super_admin((select auth.uid()))
    or app_private.has_permission((select auth.uid()), organization_id, 'customer.manage')
    or app_private.has_permission((select auth.uid()), organization_id, 'supplier.manage')
  );

create policy third_parties_insert on public.third_parties
  for insert to authenticated
  with check (
    app_private.is_super_admin((select auth.uid()))
    or (
      (not is_customer or app_private.has_permission((select auth.uid()), organization_id, 'customer.manage'))
      and (not is_supplier or app_private.has_permission((select auth.uid()), organization_id, 'supplier.manage'))
      -- Defense en profondeur : au moins une permission pertinente, meme
      -- si la contrainte third_parties_at_least_one_role garantit deja
      -- qu'au moins un role est actif.
      and (
        app_private.has_permission((select auth.uid()), organization_id, 'customer.manage')
        or app_private.has_permission((select auth.uid()), organization_id, 'supplier.manage')
      )
    )
  );

create policy third_parties_update on public.third_parties
  for update to authenticated
  using (
    app_private.is_super_admin((select auth.uid()))
    or app_private.has_permission((select auth.uid()), organization_id, 'customer.manage')
    or app_private.has_permission((select auth.uid()), organization_id, 'supplier.manage')
  )
  with check (
    app_private.is_super_admin((select auth.uid()))
    or (
      (not is_customer or app_private.has_permission((select auth.uid()), organization_id, 'customer.manage'))
      and (not is_supplier or app_private.has_permission((select auth.uid()), organization_id, 'supplier.manage'))
    )
  );

-- AUCUNE policy DELETE : la suppression d'un tiers est impossible depuis
-- un client authentifie, quel que soit son role. Desactivation via
-- is_active (§9 du plan). Le trigger de la section 4 ferme en plus le
-- chemin service_role pour un tiers deja utilise en comptabilite.

-- --- Enfants : herite du droit de gerer le tiers -----------------------

create policy third_party_contacts_select on public.third_party_contacts
  for select to authenticated
  using (
    app_private.is_super_admin((select auth.uid()))
    or app_private.has_permission((select auth.uid()), organization_id, 'customer.manage')
    or app_private.has_permission((select auth.uid()), organization_id, 'supplier.manage')
  );

create policy third_party_contacts_write on public.third_party_contacts
  for all to authenticated
  using (
    app_private.is_super_admin((select auth.uid()))
    or app_private.has_permission((select auth.uid()), organization_id, 'customer.manage')
    or app_private.has_permission((select auth.uid()), organization_id, 'supplier.manage')
  )
  with check (
    app_private.is_super_admin((select auth.uid()))
    or app_private.has_permission((select auth.uid()), organization_id, 'customer.manage')
    or app_private.has_permission((select auth.uid()), organization_id, 'supplier.manage')
  );

create policy third_party_addresses_select on public.third_party_addresses
  for select to authenticated
  using (
    app_private.is_super_admin((select auth.uid()))
    or app_private.has_permission((select auth.uid()), organization_id, 'customer.manage')
    or app_private.has_permission((select auth.uid()), organization_id, 'supplier.manage')
  );

create policy third_party_addresses_write on public.third_party_addresses
  for all to authenticated
  using (
    app_private.is_super_admin((select auth.uid()))
    or app_private.has_permission((select auth.uid()), organization_id, 'customer.manage')
    or app_private.has_permission((select auth.uid()), organization_id, 'supplier.manage')
  )
  with check (
    app_private.is_super_admin((select auth.uid()))
    or app_private.has_permission((select auth.uid()), organization_id, 'customer.manage')
    or app_private.has_permission((select auth.uid()), organization_id, 'supplier.manage')
  );
