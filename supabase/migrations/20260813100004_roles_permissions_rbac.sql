-- MedFinder Gestion — Phase 1A
-- Catalogue RBAC : roles, permissions, role_permissions, membership_roles,
-- user_permission_overrides. Voir docs/permissions-matrix.md pour le
-- catalogue fonctionnel complet ; les donnees de reference sont inserees
-- dans 20260813100011_seed_rbac_catalogue.sql.

-- Roles : un role est soit global/systeme (organization_id null — les 9
-- roles du catalogue Phase 1A), soit propre a une organisation (extension
-- future documentee en Phase 0, non utilisee en Phase 1A). Les deux espaces
-- de noms de code sont garantis uniques independamment via index partiels.
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  code text not null check (code = upper(code) and length(trim(code)) > 0),
  label text not null,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.roles is
  'Roles systeme (organization_id null, is_system=true) + extension future '
  'de roles personnalises par organisation (organization_id renseigne).';

create unique index roles_global_code_unique
  on public.roles (code) where organization_id is null;
create unique index roles_org_code_unique
  on public.roles (organization_id, code) where organization_id is not null;

create trigger set_updated_at
  before update on public.roles
  for each row execute function app_private.set_updated_at();

alter table public.roles enable row level security;

-- Permissions : catalogue global, non lie a une organisation.
create table public.permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z_]+\.[a-z_]+$'),
  module text not null,
  description text not null,
  created_at timestamptz not null default now()
);

comment on table public.permissions is
  'Catalogue global de permissions granulaires, notation "module.action" '
  '(ex. expense.approve). Voir docs/permissions-matrix.md.';

alter table public.permissions enable row level security;

-- role_permissions : permissions par defaut accordees a un role.
create table public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references public.roles (id) on delete cascade,
  permission_id uuid not null references public.permissions (id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (role_id, permission_id)
);

alter table public.role_permissions enable row level security;

-- membership_roles : role(s) effectif(s) d'une appartenance (many-to-many).
-- Permet a un utilisateur de cumuler plusieurs roles dans une meme
-- organisation (ex. RH + MANAGER) sans dupliquer la ligne memberships.
create table public.membership_roles (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.memberships (id) on delete cascade,
  role_id uuid not null references public.roles (id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (membership_id, role_id)
);

comment on table public.membership_roles is
  'Association many-to-many membership <-> role. Remplace un simple '
  'memberships.role_id pour permettre le cumul de roles (Phase 1A, D3).';

-- Un role propre a une organisation ne peut etre assigne qu'a une
-- appartenance de cette meme organisation (les roles globaux/systeme
-- restent assignables partout).
create or replace function app_private.validate_membership_role()
returns trigger
language plpgsql
as $$
declare
  v_membership_org uuid;
  v_role_org uuid;
begin
  select organization_id into v_membership_org
    from public.memberships where id = new.membership_id;

  if v_membership_org is null then
    raise exception 'Membership % introuvable', new.membership_id;
  end if;

  select organization_id into v_role_org
    from public.roles where id = new.role_id;

  if v_role_org is not null and v_role_org <> v_membership_org then
    raise exception
      'Le role % appartient a une autre organisation que le membership %',
      new.role_id, new.membership_id;
  end if;

  return new;
end;
$$;

create trigger trg_validate_membership_role
  before insert or update on public.membership_roles
  for each row execute function app_private.validate_membership_role();

create index membership_roles_membership_idx on public.membership_roles (membership_id);
create index membership_roles_role_idx on public.membership_roles (role_id);

alter table public.membership_roles enable row level security;

-- user_permission_overrides : exception individuelle tracee (grant ou
-- revoke) sur une permission precise, pour un utilisateur et une
-- organisation donnes. Toujours accompagnee d'une raison et d'un auteur
-- (§security.md §2 — jamais un octroi silencieux).
create table public.user_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  permission_id uuid not null references public.permissions (id) on delete cascade,
  effect text not null check (effect in ('grant', 'revoke')),
  reason text not null check (length(trim(reason)) > 0),
  granted_by uuid not null references public.users (id),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at is null or expires_at > created_at)
);

comment on table public.user_permission_overrides is
  'Exception individuelle tracee a une permission. "revoke" est toujours '
  'prioritaire sur un role-grant ou un autre override "grant" (deny wins) — '
  'voir app_private.has_permission.';

create index user_permission_overrides_user_org_idx
  on public.user_permission_overrides (user_id, organization_id);

alter table public.user_permission_overrides enable row level security;
