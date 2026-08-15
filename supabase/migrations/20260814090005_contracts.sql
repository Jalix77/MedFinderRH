-- MedFinder Gestion — Phase 1B
-- Contrats et avenants. Classe "confidentiel" (§80) au meme titre que le
-- salaire — la ligne entiere (type, dates, remuneration, mode de paiement)
-- est gated par employee.view_salary en lecture, pas seulement le montant
-- (RLS filtre des lignes, pas des colonnes ; regrouper une donnee non
-- sensible comme "type de contrat" avec le salaire dans la meme ligne
-- signifie que les deux heritent du meme niveau de protection — choix
-- assume ici car type/dates de contrat sont eux-memes classes
-- "confidentiel" par le prompt maitre, pas "public interne").

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  type text not null check (type in ('CDI', 'CDD', 'consultant', 'prestataire', 'temps_partiel', 'fondateur', 'stage')),
  start_date date not null,
  end_date date,
  probation_end_date date,
  base_salary numeric(14, 2) check (base_salary is null or base_salary >= 0),
  currency char(3) not null default 'HTG' check (currency in ('HTG', 'USD')),
  payment_method text check (payment_method in ('virement_bancaire', 'moncash', 'especes', 'cheque')),
  bank_account_masked text,
  moncash_number_masked text,
  benefits jsonb not null default '{}'::jsonb,
  document_storage_path text,
  status text not null default 'draft' check (status in ('draft', 'active', 'expired', 'terminated', 'superseded')),
  renewal_of_contract_id uuid references public.contracts (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  check (end_date is null or end_date >= start_date),
  check (probation_end_date is null or probation_end_date >= start_date)
);

comment on table public.contracts is
  'Contrats de travail (§17 prompt maitre). base_salary/currency y vivent '
  '(pas sur employees) — source unique de verite pour la remuneration. '
  'Ligne entiere classee "confidentiel" (§80), gated par employee.view_salary.';

create trigger set_updated_at
  before update on public.contracts
  for each row execute function app_private.set_updated_at();

create index contracts_org_idx on public.contracts (organization_id);
create index contracts_employee_idx on public.contracts (employee_id);

alter table public.contracts enable row level security;

revoke all on public.contracts from anon;
grant select, insert, update on public.contracts to authenticated;
revoke delete on public.contracts from authenticated;

create policy contracts_select on public.contracts
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'employee.view_salary')
    or exists (
      select 1 from public.employees e
      where e.id = contracts.employee_id and e.user_id = auth.uid()
    )
  );

create policy contracts_insert on public.contracts
  for insert to authenticated
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'contract.manage')
  );

create policy contracts_update on public.contracts
  for update to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'contract.manage')
  )
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'contract.manage')
  );

-- --- contract_amendments --------------------------------------------------

create table public.contract_amendments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contract_id uuid not null references public.contracts (id) on delete cascade,
  effective_date date not null,
  change_description text not null check (length(trim(change_description)) > 0),
  document_storage_path text,
  created_at timestamptz not null default now(),
  created_by uuid references public.users (id)
);

comment on table public.contract_amendments is
  'Avenants (§17). Meme niveau de protection que contracts — un avenant '
  'peut porter sur la remuneration.';

create index contract_amendments_org_idx on public.contract_amendments (organization_id);
create index contract_amendments_contract_idx on public.contract_amendments (contract_id);

alter table public.contract_amendments enable row level security;

revoke all on public.contract_amendments from anon;
grant select, insert on public.contract_amendments to authenticated;
revoke update, delete on public.contract_amendments from authenticated;

comment on table public.contract_amendments is
  'Avenants : jamais modifies apres creation (immuables, comme les '
  'ecritures comptables) — une correction cree un nouvel avenant.';

create policy contract_amendments_select on public.contract_amendments
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'employee.view_salary')
    or exists (
      select 1 from public.contracts c
      join public.employees e on e.id = c.employee_id
      where c.id = contract_amendments.contract_id and e.user_id = auth.uid()
    )
  );

create policy contract_amendments_insert on public.contract_amendments
  for insert to authenticated
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'contract.manage')
  );
