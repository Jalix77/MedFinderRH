-- MedFinder Gestion — Phase 1A
-- Journal d'audit central, append-only. Aucune policy insert/update/delete
-- n'est accordee aux roles applicatifs (authenticated/anon) : la seule voie
-- d'ecriture est app_private.write_audit_log(), appelee par les triggers de
-- ligne (audit_row_trigger) et par les fonctions RPC admin — toutes
-- security definer. Voir security.md §6.

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id),
  user_id uuid references public.users (id),
  action text not null,
  module text not null,
  object_type text not null,
  object_id uuid,
  old_value jsonb,
  new_value jsonb,
  occurred_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  result text not null default 'success' check (result in ('success', 'denied', 'error'))
);

comment on table public.audit_logs is
  'Append-only. Ecriture exclusivement via app_private.write_audit_log() '
  '(security definer). Aucune policy UPDATE/DELETE n''existe sur cette table.';

create index audit_logs_org_idx on public.audit_logs (organization_id, occurred_at desc);
create index audit_logs_object_idx on public.audit_logs (object_type, object_id);
create index audit_logs_user_idx on public.audit_logs (user_id);

alter table public.audit_logs enable row level security;

-- Fonction d'ecriture centrale. IP/user-agent sont lus depuis le GUC
-- "request.headers" que PostgREST/Kong renseigne automatiquement pour
-- chaque requete HTTP (client direct ou appel serveur via @supabase/ssr,
-- qui passe toujours par l'API HTTP, jamais par une connexion Postgres
-- directe). En dehors de ce contexte (migrations, scripts psql), le GUC est
-- absent : on l'intercepte proprement plutot que de faire echouer l'appel.
create or replace function app_private.write_audit_log(
  p_organization_id uuid,
  p_action text,
  p_module text,
  p_object_type text,
  p_object_id uuid,
  p_old_value jsonb,
  p_new_value jsonb,
  p_result text default 'success'
) returns uuid
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_headers jsonb;
  v_ip text;
  v_ua text;
  v_id uuid;
begin
  begin
    v_headers := current_setting('request.headers', true)::jsonb;
  exception when others then
    v_headers := null;
  end;

  v_ip := nullif(v_headers ->> 'x-forwarded-for', '');
  v_ua := nullif(v_headers ->> 'user-agent', '');

  insert into public.audit_logs (
    organization_id, user_id, action, module, object_type, object_id,
    old_value, new_value, ip_address, user_agent, result
  ) values (
    p_organization_id, auth.uid(), p_action, p_module, p_object_type, p_object_id,
    p_old_value, p_new_value, v_ip, v_ua, p_result
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function app_private.write_audit_log is
  'Point d''ecriture unique du journal d''audit. Ne jamais inserer dans '
  'audit_logs autrement que via cette fonction (ou les triggers qui '
  'l''appellent) — voir security.md §6.';

-- Trigger generique : capture avant/apres sur les tables sensibles.
-- "organizations" est son propre organization_id ; les autres tables
-- portent une colonne organization_id directement, sauf "users" (identite
-- globale, non rattachee a une organisation) ou organization_id reste NULL.
create or replace function app_private.audit_row_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_org_id uuid;
  v_object_id uuid;
begin
  v_object_id := coalesce(new.id, old.id);

  if TG_TABLE_NAME = 'organizations' then
    v_org_id := v_object_id;
  elsif TG_TABLE_NAME = 'users' then
    v_org_id := null;
  else
    begin
      v_org_id := coalesce(
        (to_jsonb(new) ->> 'organization_id')::uuid,
        (to_jsonb(old) ->> 'organization_id')::uuid
      );
    exception when others then
      v_org_id := null;
    end;
  end if;

  perform app_private.write_audit_log(
    v_org_id,
    lower(TG_OP),
    TG_TABLE_NAME,
    TG_TABLE_NAME,
    v_object_id,
    case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when TG_OP in ('UPDATE', 'INSERT') then to_jsonb(new) else null end,
    'success'
  );

  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
