-- MedFinder Gestion — Phase 1B
-- Structure organisationnelle : departements et postes. Donnee non
-- sensible (§80 "public interne") — lecture ouverte a tout membre actif de
-- l'organisation, ecriture reservee a department.manage/position.manage.
-- Pas de DELETE reel : desactivation via status (§56 "soft delete lorsque
-- pertinent").

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  parent_department_id uuid references public.departments (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  unique (organization_id, name)
);

comment on table public.departments is
  'Structure organisationnelle (§16 prompt maitre). Hierarchie optionnelle '
  'via parent_department_id. Donnee "public interne" (§80) — lecture ouverte.';

create trigger set_updated_at
  before update on public.departments
  for each row execute function app_private.set_updated_at();

create index departments_org_idx on public.departments (organization_id);

alter table public.departments enable row level security;

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  department_id uuid references public.departments (id) on delete set null,
  title text not null check (length(trim(title)) > 0),
  description text,
  responsibilities text,
  required_skills text,
  reports_to_position_id uuid references public.positions (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id)
);

comment on table public.positions is
  'Postes (§16 prompt maitre) : titre, fiche de poste, hierarchie via '
  'reports_to_position_id. department_id nullable (poste transverse '
  'possible, ex. fondateur).';

create trigger set_updated_at
  before update on public.positions
  for each row execute function app_private.set_updated_at();

create index positions_org_idx on public.positions (organization_id);
create index positions_department_idx on public.positions (department_id);

alter table public.positions enable row level security;

-- --- RLS ---------------------------------------------------------------

-- anon : aucun acces (coherent avec Phase 1A, explicite bien que deja
-- l'etat par defaut d'une nouvelle table — auto_expose_new_tables desactive).
revoke all on public.departments, public.positions from anon;

-- INSERT/UPDATE accordes au niveau table (RLS filtre ensuite les lignes/
-- conditions) ; DELETE jamais accorde — pas de suppression reelle possible.
grant select, insert, update on public.departments, public.positions to authenticated;
revoke delete on public.departments, public.positions from authenticated;

create policy departments_select on public.departments
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.is_active_member(auth.uid(), organization_id)
  );

create policy positions_select on public.positions
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.is_active_member(auth.uid(), organization_id)
  );

-- Ecriture directe (pas de RPC dediee : CRUD simple sans regle metier
-- complexe, contrairement aux tables RBAC de Phase 1A). INSERT/UPDATE
-- uniquement — pas de policy DELETE : desactivation via status (§56).
create policy departments_insert on public.departments
  for insert to authenticated
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'department.manage')
  );

create policy departments_update on public.departments
  for update to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'department.manage')
  )
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'department.manage')
  );

create policy positions_insert on public.positions
  for insert to authenticated
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'position.manage')
  );

create policy positions_update on public.positions
  for update to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'position.manage')
  )
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'position.manage')
  );
