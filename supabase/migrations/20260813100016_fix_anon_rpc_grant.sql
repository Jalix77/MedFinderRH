-- MedFinder Gestion — Audit cloud (point 8)
-- Trouvaille reelle de la verification sur projet Supabase cloud dedie :
-- public.current_user_has_permission restait executable par le role
-- "anon" sur ce projet cloud (reponse "false", donc aucune fuite
-- d'information exploitee, mais l'appel lui-meme n'etait pas rejete —
-- alors que les 8 autres RPC public.* et le meme test en local
-- rejetaient correctement anon). Cause probable : le template de projet
-- Supabase Cloud applique par defaut un GRANT EXECUTE a "anon" distinct
-- du pseudo-role PUBLIC, que "revoke all ... from public" (deja present
-- dans 20260813100007) ne couvre pas — un revoke explicite sur anon est
-- necessaire en plus. Corrige ici pour local ET cloud, et durci sur les
-- 9 fonctions RPC exposees par coherence/prevention.

revoke all on function public.current_user_has_permission(uuid, text) from public, anon;
grant execute on function public.current_user_has_permission(uuid, text) to authenticated;

revoke all on function public.next_number(uuid, text) from public, anon;
grant execute on function public.next_number(uuid, text) to authenticated;

revoke all on function public.admin_create_membership(uuid, text, text) from public, anon;
grant execute on function public.admin_create_membership(uuid, text, text) to authenticated;

revoke all on function public.admin_assign_role(uuid, text) from public, anon;
grant execute on function public.admin_assign_role(uuid, text) to authenticated;

revoke all on function public.admin_revoke_role(uuid, text) from public, anon;
grant execute on function public.admin_revoke_role(uuid, text) to authenticated;

revoke all on function public.admin_set_membership_status(uuid, text) from public, anon;
grant execute on function public.admin_set_membership_status(uuid, text) to authenticated;

revoke all on function public.admin_set_user_status(uuid, uuid, text) from public, anon;
grant execute on function public.admin_set_user_status(uuid, uuid, text) to authenticated;

revoke all on function public.admin_set_permission_override(uuid, uuid, text, text, text, timestamptz) from public, anon;
grant execute on function public.admin_set_permission_override(uuid, uuid, text, text, text, timestamptz) to authenticated;

revoke all on function public.admin_update_organization_settings(uuid, text, text, text, char(3), smallint, text) from public, anon;
grant execute on function public.admin_update_organization_settings(uuid, text, text, text, char(3), smallint, text) to authenticated;

-- Meme durcissement pour toute fonction publique future : un GRANT
-- explicite a authenticated est requis, jamais un heritage implicite.
alter default privileges in schema public
  revoke execute on functions from public, anon;
