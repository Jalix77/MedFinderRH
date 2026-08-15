-- MedFinder Gestion — Phase 1C, sous-jalon 0 (outillage prealable)
-- Standard adopte en Phase 1B (fix_app_private_grants) et rendu obligatoire
-- pour toute la suite : chaque fonction app_private/SECURITY DEFINER doit
-- recevoir un REVOKE explicite immediatement apres sa creation, jamais
-- s'appuyer seul sur ALTER DEFAULT PRIVILEGES (comportement observe non
-- fiable entre fichiers de migration CLI separes — voir 20260814090008).
--
-- Cette fonction expose, via RPC PostgREST reserve a service_role
-- uniquement, la liste des privileges EXECUTE indesirables (PUBLIC ou anon)
-- sur les fonctions d'un schema donne (app_private par defaut). Utilisee
-- par tests/integration/privilege-audit.test.ts, rejouable a chaque phase
-- future sans modification.
create or replace function public.debug_unwanted_function_grants(p_schema text default 'app_private')
returns table (function_signature text, grantee text)
language sql
stable
security definer
set search_path = public, pg_catalog, information_schema
as $$
  select
    g.routine_name || '(' || coalesce(pg_get_function_identity_arguments(p.oid), '') || ')' as function_signature,
    g.grantee
  from information_schema.routine_privileges g
  join pg_namespace n on n.nspname = g.routine_schema
  join pg_proc p on p.pronamespace = n.oid and p.proname = g.routine_name
  where g.routine_schema = p_schema
    and g.privilege_type = 'EXECUTE'
    and g.grantee in ('PUBLIC', 'anon')
$$;

-- Auto-application du standard qu'elle audite : revoke public/anon, grant
-- uniquement a service_role (outil de verification interne, jamais appele
-- par l'application ni par un client authentifie).
revoke all on function public.debug_unwanted_function_grants(text) from public;
revoke execute on function public.debug_unwanted_function_grants(text) from anon, authenticated;
grant execute on function public.debug_unwanted_function_grants(text) to service_role;
