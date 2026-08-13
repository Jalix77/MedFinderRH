-- MedFinder Gestion — Phase 1A
-- Table racine multi-organisation. Toute table metier ulterieure porte
-- organization_id references organizations(id) — voir architecture.md §6.

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  legal_name text,
  tax_id text,
  default_currency char(3) not null default 'HTG'
    check (default_currency in ('HTG', 'USD')),
  fiscal_year_start_month smallint not null default 1
    check (fiscal_year_start_month between 1 and 12),
  timezone text not null default 'America/Port-au-Prince',
  -- Configuration libre non structuree (extensible sans migration) ;
  -- toute donnee structurante/critique doit rester en colonne typee, pas ici.
  settings jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  updated_by uuid
);

comment on table public.organizations is
  'Racine multi-organisation. "MedFinder Haiti" est la premiere organisation (seed dev/prod initial).';

create trigger set_updated_at
  before update on public.organizations
  for each row execute function app_private.set_updated_at();

alter table public.organizations enable row level security;
-- Les policies sont definies dans 20260813100009_rls_policies.sql (apres que
-- toutes les fonctions RBAC dont elles dependent existent).
