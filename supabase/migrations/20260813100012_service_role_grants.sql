-- MedFinder Gestion — Phase 1A
-- Depuis les versions recentes de Supabase (voir supabase/config.toml
-- [api] auto_expose_new_tables), les nouvelles tables ne sont plus
-- automatiquement accordees a "service_role" : un GRANT explicite est
-- necessaire, meme si service_role contourne RLS (BYPASSRLS ne dispense
-- pas des privileges de table au sens SQL standard). Corrige ici et fige
-- pour toute table future via ALTER DEFAULT PRIVILEGES.

grant usage on schema public to service_role;
grant usage on schema app_private to service_role;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
grant execute on all functions in schema app_private to service_role;

alter default privileges in schema public
  grant all privileges on tables to service_role;
alter default privileges in schema public
  grant all privileges on sequences to service_role;
alter default privileges in schema public
  grant execute on functions to service_role;
alter default privileges in schema app_private
  grant execute on functions to service_role;

comment on schema public is
  'service_role recoit desormais des grants explicites (comportement '
  'requis depuis que auto_expose_new_tables est desactive par defaut). '
  'Voir docs/security.md §5 : service_role reste reserve au serveur '
  'uniquement, jamais expose au client.';
