-- MedFinder Gestion — Hardening cloud (auth_rls_initplan, 74 avertissements
-- Performance Advisor). Avant de reecrire la moindre policy, on a besoin
-- de l'etat REEL et complet des policies en base (pas d'une relecture des
-- fichiers de migration source, qui pourrait manquer une policy modifiee
-- entre plusieurs fichiers ou mal reconstituer le texte exact de la
-- clause USING/WITH CHECK). Cette fonction dump pg_policies integralement
-- pour generer, de facon mecanique et fiable, le prochain correctif.
-- service_role uniquement, jamais exposee a un client.

create or replace function public.debug_dump_all_policies()
returns table (
  schemaname text,
  tablename text,
  policyname text,
  permissive text,
  roles text,
  cmd text,
  qual text,
  with_check text
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select schemaname::text, tablename::text, policyname::text, permissive::text,
         roles::text, cmd::text, qual, with_check
  from pg_policies
  where schemaname = 'public'
  order by tablename, policyname
$$;

revoke all on function public.debug_dump_all_policies() from public;
revoke execute on function public.debug_dump_all_policies() from anon, authenticated;
grant execute on function public.debug_dump_all_policies() to service_role;
