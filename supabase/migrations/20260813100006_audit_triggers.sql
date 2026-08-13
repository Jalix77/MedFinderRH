-- MedFinder Gestion — Phase 1A
-- Attache le trigger d'audit generique aux tables sensibles du socle RBAC.
-- Toute creation/modification/suppression sur ces tables est tracee
-- automatiquement, y compris lorsqu'elle passe par une fonction RPC
-- security definer (le trigger s'execute quel que soit l'appelant).

create trigger audit_organizations
  after insert or update or delete on public.organizations
  for each row execute function app_private.audit_row_trigger();

create trigger audit_users
  after insert or update or delete on public.users
  for each row execute function app_private.audit_row_trigger();

create trigger audit_memberships
  after insert or update or delete on public.memberships
  for each row execute function app_private.audit_row_trigger();

create trigger audit_roles
  after insert or update or delete on public.roles
  for each row execute function app_private.audit_row_trigger();

create trigger audit_role_permissions
  after insert or update or delete on public.role_permissions
  for each row execute function app_private.audit_row_trigger();

create trigger audit_membership_roles
  after insert or update or delete on public.membership_roles
  for each row execute function app_private.audit_row_trigger();

create trigger audit_user_permission_overrides
  after insert or update or delete on public.user_permission_overrides
  for each row execute function app_private.audit_row_trigger();
