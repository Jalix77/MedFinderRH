-- MedFinder Gestion — Phase 1A
-- Fonctions RBAC centrales. Source unique de verite reutilisee a la fois par
-- les policies RLS et par les Server Actions cote application (via l'appel
-- RPC public.current_user_has_permission) — voir security.md §2 et ADR-004.

create or replace function app_private.is_active_member(p_user_id uuid, p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app_private
as $$
  select exists (
    select 1 from public.memberships
    where user_id = p_user_id
      and organization_id = p_org_id
      and status = 'active'
  );
$$;

create or replace function app_private.is_super_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app_private
as $$
  select exists (
    select 1
    from public.membership_roles mr
    join public.memberships m on m.id = mr.membership_id
    join public.roles r on r.id = mr.role_id
    where m.user_id = p_user_id
      and m.status = 'active'
      and r.code = 'SUPER_ADMIN'
      and r.organization_id is null
  );
$$;

comment on function app_private.is_super_admin is
  'SUPER_ADMIN est un role technique global : detenir ce role dans au moins '
  'une organisation donne acces technique a toutes les organisations '
  '(architecture.md §6, permissions-matrix.md).';

-- Regle de resolution effective (voir security.md §2) :
--   effectif = (role-grant) ET NON (override "revoke" actif)
--            OU (override "grant" actif, si toujours membre actif)
-- "revoke" est toujours prioritaire (deny wins).
create or replace function app_private.has_permission(
  p_user_id uuid,
  p_org_id uuid,
  p_permission_code text
) returns boolean
language plpgsql
stable
security definer
set search_path = public, app_private
as $$
declare
  v_role_grant boolean;
  v_override_grant boolean;
  v_override_revoke boolean;
begin
  if not app_private.is_active_member(p_user_id, p_org_id) then
    return false;
  end if;

  select exists (
    select 1
    from public.membership_roles mr
    join public.memberships m on m.id = mr.membership_id
    join public.role_permissions rp on rp.role_id = mr.role_id
    join public.permissions perm on perm.id = rp.permission_id
    where m.user_id = p_user_id
      and m.organization_id = p_org_id
      and m.status = 'active'
      and perm.code = p_permission_code
  ) into v_role_grant;

  select exists (
    select 1 from public.user_permission_overrides upo
    join public.permissions perm on perm.id = upo.permission_id
    where upo.user_id = p_user_id
      and upo.organization_id = p_org_id
      and perm.code = p_permission_code
      and upo.effect = 'grant'
      and (upo.expires_at is null or upo.expires_at > now())
  ) into v_override_grant;

  select exists (
    select 1 from public.user_permission_overrides upo
    join public.permissions perm on perm.id = upo.permission_id
    where upo.user_id = p_user_id
      and upo.organization_id = p_org_id
      and perm.code = p_permission_code
      and upo.effect = 'revoke'
      and (upo.expires_at is null or upo.expires_at > now())
  ) into v_override_revoke;

  if v_override_revoke then
    return false;
  end if;

  return coalesce(v_role_grant, false) or coalesce(v_override_grant, false);
end;
$$;

comment on function app_private.has_permission is
  'Fonction unique de resolution RBAC, reutilisee par toutes les policies '
  'RLS et par public.current_user_has_permission(). Ne jamais dupliquer '
  'cette logique ailleurs (ADR-004).';

-- Wrapper public, appelable en RPC par l'application (toujours limite a
-- l'utilisateur authentifie courant — pas d'IDOR possible via user_id
-- arbitraire, auth.uid() est derive du JWT verifie par PostgREST).
create or replace function public.current_user_has_permission(
  p_org_id uuid,
  p_permission_code text
) returns boolean
language sql
stable
security definer
set search_path = public, app_private
as $$
  select app_private.has_permission(auth.uid(), p_org_id, p_permission_code);
$$;

revoke all on function public.current_user_has_permission(uuid, text) from public;
grant execute on function public.current_user_has_permission(uuid, text) to authenticated;

comment on function public.current_user_has_permission is
  'RPC public : verifie une permission pour l''utilisateur authentifie '
  'courant uniquement. Utilise par lib/permissions cote application en '
  'defense-in-depth au-dessus de RLS (jamais comme seule protection).';
