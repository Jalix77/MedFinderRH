-- MedFinder Gestion — Phase 1A
-- Miroir minimal de auth.users + appartenance a une organisation (memberships).
-- Le role effectif d'une appartenance est porte par membership_roles
-- (table de jonction many-to-many, voir 20260813100004), pas par une colonne
-- role_id ici — un utilisateur peut cumuler plusieurs roles dans une meme
-- organisation (ex. RH + MANAGER).

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  phone text,
  avatar_url text,
  mfa_enabled boolean not null default false,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.users is
  'Miroir applicatif de auth.users. Aucune donnee d''authentification (mot de '
  'passe, tokens) n''est dupliquee ici — gere exclusivement par Supabase Auth.';

create trigger set_updated_at
  before update on public.users
  for each row execute function app_private.set_updated_at();

-- Creation automatique du profil applicatif a l'inscription Supabase Auth.
create or replace function app_private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  insert into public.users (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email, 'Utilisateur')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app_private.handle_new_auth_user();

-- Seul le profil "public" (nom, telephone, avatar) est auto-editable par
-- l'utilisateur lui-meme. status/mfa_enabled ne sont modifiables que via les
-- fonctions RPC admin security definer (20260813100010), jamais par une
-- mise a jour directe de table — voir security.md §2.
revoke update on public.users from authenticated;
grant update (full_name, phone, avatar_url) on public.users to authenticated;

alter table public.users enable row level security;

-- Appartenance d'un utilisateur a une organisation.
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid,
  unique (user_id, organization_id)
);

comment on table public.memberships is
  'Appartenance user x organization. Le(s) role(s) effectif(s) sont dans '
  'membership_roles (many-to-many), pas ici.';

create trigger set_updated_at
  before update on public.memberships
  for each row execute function app_private.set_updated_at();

create index memberships_user_idx on public.memberships (user_id);
create index memberships_org_idx on public.memberships (organization_id);

alter table public.memberships enable row level security;
