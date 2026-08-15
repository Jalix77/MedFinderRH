-- MedFinder Gestion — Phase 1B
-- Employes. Volontairement scinde en deux tables plutot que la version
-- "toutes colonnes sur employees" esquissee en Phase 0 (data-model.md §B) :
-- RLS filtre des LIGNES, jamais des colonnes — regrouper des champs de
-- sensibilite tres differente (nom, statut vs NIF/CIN/adresse) dans la
-- meme ligne aurait force soit une sur-exposition (comme le defaut trouve
-- sur public.users pendant l'audit Phase 1A, §16.5 du rapport de cloture),
-- soit une vue/fonction supplementaire. Deux tables avec deux policies
-- distinctes est plus simple et plus sur.
--
-- employees      : identite operationnelle (§80 "public interne" au sein
--                   de l'organisation) — nom, poste, departement, statut.
-- employee_sensitive_data : NIF/NINU/CIN/adresse/contact personnel/notes RH
--                   (§80 "tres sensible") — jamais dans employees.
-- Remuneration/contrat : deliberement PAS ici — voir contracts (migration
-- suivante), classee "confidentiel" et jamais dupliquee sur employees pour
-- eviter toute derive entre les deux sources.

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  matricule text not null,
  user_id uuid references public.users (id) on delete set null,
  first_name text not null check (length(trim(first_name)) > 0),
  last_name text not null check (length(trim(last_name)) > 0),
  gender text check (gender in ('F', 'M', 'autre', 'non_precise')),
  photo_url text,
  hire_date date not null,
  status text not null default 'active' check (status in ('active', 'on_leave', 'terminated')),
  department_id uuid references public.departments (id) on delete set null,
  position_id uuid references public.positions (id) on delete set null,
  manager_employee_id uuid references public.employees (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  unique (organization_id, matricule)
);

comment on table public.employees is
  'Identite operationnelle de l''employe (§15 prompt maitre). Remuneration '
  'et type de contrat vivent dans contracts, pas ici (evite la duplication '
  'source-de-verite). Donnees tres sensibles dans employee_sensitive_data.';

create trigger set_updated_at
  before update on public.employees
  for each row execute function app_private.set_updated_at();

create index employees_org_idx on public.employees (organization_id);
create index employees_department_idx on public.employees (department_id);
create index employees_position_idx on public.employees (position_id);
create index employees_manager_idx on public.employees (manager_employee_id);
create index employees_user_idx on public.employees (user_id);

alter table public.employees enable row level security;

-- Auto-assignation du matricule (EMP-0001, ...) si non fourni explicitement
-- — atomique via app_private.next_number_internal (verrou de ligne).
create or replace function app_private.assign_employee_matricule()
returns trigger
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  if new.matricule is null or length(trim(new.matricule)) = 0 then
    new.matricule := app_private.next_number_internal(new.organization_id, 'employee');
  end if;
  return new;
end;
$$;

create trigger assign_employee_matricule
  before insert on public.employees
  for each row execute function app_private.assign_employee_matricule();

-- --- RLS employees -------------------------------------------------------

revoke all on public.employees from anon;
grant select, insert, update on public.employees to authenticated;
revoke delete on public.employees from authenticated;

create policy employees_select on public.employees
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'employee.view')
    or user_id = auth.uid()
  );

create policy employees_insert on public.employees
  for insert to authenticated
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'employee.create')
  );

create policy employees_update on public.employees
  for update to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'employee.update')
    or app_private.has_permission(auth.uid(), organization_id, 'employee.terminate')
  )
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'employee.update')
    or app_private.has_permission(auth.uid(), organization_id, 'employee.terminate')
  );

-- --- employee_sensitive_data ---------------------------------------------

create table public.employee_sensitive_data (
  -- "id" surrogate (et non employee_id en cle primaire) pour rester
  -- compatible avec app_private.audit_row_trigger(), qui accede a NEW.id/
  -- OLD.id directement sur toutes les tables auditees (Phase 1A).
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null unique references public.employees (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  birth_date date,
  personal_phone text,
  personal_email text,
  address text,
  nif text,
  ninu text,
  cin text,
  emergency_contact jsonb,
  hr_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id)
);

comment on table public.employee_sensitive_data is
  'Donnees "tres sensibles" (§80) : NIF, NINU, CIN, adresse, contact '
  'personnel/urgence, notes RH. Lecture et ecriture reservees a '
  'employee.view_sensitive ou a l''employe concerne lui-meme.';

create trigger set_updated_at
  before update on public.employee_sensitive_data
  for each row execute function app_private.set_updated_at();

create index employee_sensitive_data_org_idx on public.employee_sensitive_data (organization_id);

alter table public.employee_sensitive_data enable row level security;

revoke all on public.employee_sensitive_data from anon;
grant select, insert, update on public.employee_sensitive_data to authenticated;
revoke delete on public.employee_sensitive_data from authenticated;

create policy employee_sensitive_data_select on public.employee_sensitive_data
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'employee.view_sensitive')
    or exists (
      select 1 from public.employees e
      where e.id = employee_sensitive_data.employee_id and e.user_id = auth.uid()
    )
  );

create policy employee_sensitive_data_insert on public.employee_sensitive_data
  for insert to authenticated
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'employee.view_sensitive')
  );

create policy employee_sensitive_data_update on public.employee_sensitive_data
  for update to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'employee.view_sensitive')
  )
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'employee.view_sensitive')
  );
