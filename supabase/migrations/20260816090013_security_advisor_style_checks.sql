-- MedFinder Gestion — Phase 1C-UI, verification cloud demandee (§2 du
-- rapport de suivi) : Supabase Security Advisor lui-meme n'est accessible
-- que via le dashboard authentifie (hors de portee de Claude) ou l'API de
-- gestion Supabase avec un jeton d'acces personnel (portee compte entier,
-- jamais partage jusqu'ici — plus large que les cles de ce seul projet).
-- Ces 3 fonctions repliquent, en interrogeant l'etat REEL de la base
-- cloud (pas les fichiers de migration source comme les rapports
-- precedents), les verifications structurelles les plus proches de ce
-- que verifie le Security Advisor : RLS desactivee, fonctions
-- SECURITY DEFINER sans search_path fixe, vues sans security_invoker.
-- Reserve a service_role, jamais expose a un client authentifie.

create or replace function public.debug_tables_without_rls(p_schema text default 'public')
returns table (table_name text)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select c.relname::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = p_schema
    and c.relkind = 'r' -- tables ordinaires uniquement, pas les vues
    and not c.relrowsecurity
$$;

revoke all on function public.debug_tables_without_rls(text) from public;
revoke execute on function public.debug_tables_without_rls(text) from anon, authenticated;
grant execute on function public.debug_tables_without_rls(text) to service_role;

create or replace function public.debug_security_definer_without_search_path(p_schema text default 'public')
returns table (function_signature text)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = p_schema
    and p.prosecdef -- SECURITY DEFINER uniquement
    and not exists (
      select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) as cfg
      where cfg like 'search_path=%'
    )
$$;

revoke all on function public.debug_security_definer_without_search_path(text) from public;
revoke execute on function public.debug_security_definer_without_search_path(text) from anon, authenticated;
grant execute on function public.debug_security_definer_without_search_path(text) to service_role;

create or replace function public.debug_views_without_security_invoker(p_schema text default 'public')
returns table (view_name text)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select c.relname::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = p_schema
    and c.relkind = 'v' -- vues uniquement
    and not coalesce(
      (select option_value::boolean from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'),
      false
    )
$$;

revoke all on function public.debug_views_without_security_invoker(text) from public;
revoke execute on function public.debug_views_without_security_invoker(text) from anon, authenticated;
grant execute on function public.debug_views_without_security_invoker(text) to service_role;
