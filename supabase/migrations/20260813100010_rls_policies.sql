-- MedFinder Gestion — Phase 1A
-- Politiques RLS + grants pour toutes les tables du socle. Strategie :
--   - "anon" n'a aucun acces (application interne, pas de donnee publique) ;
--   - "authenticated" a uniquement les privileges de table necessaires
--     (SELECT partout ; UPDATE colonnes limitees sur public.users pour
--     l'auto-edition de profil) — tout le reste passe par les fonctions RPC
--     security definer (20260813100009), qui bypassent RLS via l'ownership
--     "postgres" des tables (FORCE ROW LEVEL SECURITY n'est PAS active,
--     c'est le comportement attendu et documente) ;
--   - RLS reste active sur 100% des tables exposees (aucune exception),
--     y compris pour ne restreindre "que" le SELECT — voir security.md §4.

-- --- anon : aucun acces ---------------------------------------------------
revoke all on public.organizations, public.users, public.memberships,
  public.roles, public.permissions, public.role_permissions,
  public.membership_roles, public.user_permission_overrides,
  public.numbering_sequences, public.audit_logs
  from anon;

-- --- authenticated : grants de table minimaux -----------------------------
revoke insert, update, delete on public.organizations from authenticated;
revoke insert, update, delete on public.users from authenticated; -- update colonnes deja restreint (migration 20260813100003)
revoke insert, update, delete on public.memberships from authenticated;
revoke insert, update, delete on public.roles from authenticated;
revoke insert, update, delete on public.permissions from authenticated;
revoke insert, update, delete on public.role_permissions from authenticated;
revoke insert, update, delete on public.membership_roles from authenticated;
revoke insert, update, delete on public.user_permission_overrides from authenticated;
revoke insert, update, delete on public.numbering_sequences from authenticated;
revoke insert, update, delete on public.audit_logs from authenticated;

grant select on public.organizations, public.users, public.memberships,
  public.roles, public.permissions, public.role_permissions,
  public.membership_roles, public.user_permission_overrides,
  public.numbering_sequences, public.audit_logs
  to authenticated;

-- --- organizations ---------------------------------------------------------
create policy organizations_select on public.organizations
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.is_active_member(auth.uid(), id)
  );

-- --- users -------------------------------------------------------------
create policy users_select on public.users
  for select to authenticated
  using (
    id = auth.uid()
    or app_private.is_super_admin(auth.uid())
    or exists (
      select 1 from public.memberships m1
      join public.memberships m2 on m2.organization_id = m1.organization_id
      where m1.user_id = auth.uid() and m1.status = 'active'
        and m2.user_id = public.users.id and m2.status = 'active'
    )
  );

create policy users_update_self on public.users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- --- memberships ---------------------------------------------------------
create policy memberships_select on public.memberships
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or user_id = auth.uid()
    or app_private.is_active_member(auth.uid(), organization_id)
  );

-- --- roles / permissions / role_permissions (catalogue de reference) -----
create policy roles_select on public.roles
  for select to authenticated using (true);

create policy permissions_select on public.permissions
  for select to authenticated using (true);

create policy role_permissions_select on public.role_permissions
  for select to authenticated using (true);

-- --- membership_roles ------------------------------------------------------
create policy membership_roles_select on public.membership_roles
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or exists (
      select 1 from public.memberships m
      where m.id = membership_roles.membership_id
        and (m.user_id = auth.uid() or app_private.is_active_member(auth.uid(), m.organization_id))
    )
  );

-- --- user_permission_overrides ---------------------------------------------
create policy user_permission_overrides_select on public.user_permission_overrides
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or user_id = auth.uid()
    or app_private.has_permission(auth.uid(), organization_id, 'permission.override')
    or app_private.has_permission(auth.uid(), organization_id, 'audit.view')
  );

-- --- numbering_sequences -----------------------------------------------
create policy numbering_sequences_select on public.numbering_sequences
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.is_active_member(auth.uid(), organization_id)
  );

-- --- audit_logs : lecture seule, jamais d'ecriture applicative -----------
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or (organization_id is not null and app_private.has_permission(auth.uid(), organization_id, 'audit.view'))
  );
