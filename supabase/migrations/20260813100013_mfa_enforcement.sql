-- MedFinder Gestion — Phase 1A
-- Application reelle (niveau base de donnees, non contournable par un
-- simple oubli de redirection cote application) de la Decision D2 :
-- MFA obligatoire pour SUPER_ADMIN/DIRECTEUR_GENERAL toujours, et pour
-- DIRECTEUR_TECHNIQUE s'il detient une permission administrative sensible
-- (user.manage, role.manage, settings.manage).
--
-- Principe : has_permission() exige desormais que la session courante ait
-- atteint le niveau d'assurance AAL2 (defi MFA reussi) pour tout
-- utilisateur dont le role l'exige — SINON aucune permission n'est
-- accordee, quel que soit le role. L'enrolement MFA lui-meme (via
-- supabase.auth.mfa.enroll/verify) ne depend d'AUCUNE permission
-- applicative : un SUPER_ADMIN fraichement bootstrappe peut toujours se
-- connecter (AAL1) et enroler son facteur avant que quoi que ce soit
-- d'autre ne lui soit accorde — pas d'auto-verrouillage.

create or replace function app_private.current_aal()
returns text
language sql
stable
as $$
  select coalesce(nullif(auth.jwt() ->> 'aal', ''), 'aal1');
$$;

create or replace function app_private.user_requires_mfa(p_user_id uuid, p_org_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, app_private
as $$
declare
  v_role_codes text[];
begin
  select array_agg(r.code) into v_role_codes
  from public.membership_roles mr
  join public.memberships m on m.id = mr.membership_id
  join public.roles r on r.id = mr.role_id
  where m.user_id = p_user_id and m.organization_id = p_org_id and m.status = 'active';

  if v_role_codes is null then
    return false;
  end if;

  if 'SUPER_ADMIN' = any(v_role_codes) or 'DIRECTEUR_GENERAL' = any(v_role_codes) then
    return true;
  end if;

  if 'DIRECTEUR_TECHNIQUE' = any(v_role_codes) then
    return exists (
      select 1
      from public.membership_roles mr
      join public.memberships m on m.id = mr.membership_id
      join public.role_permissions rp on rp.role_id = mr.role_id
      join public.permissions p on p.id = rp.permission_id
      where m.user_id = p_user_id and m.organization_id = p_org_id and m.status = 'active'
        and p.code in ('user.manage', 'role.manage', 'settings.manage')
    );
  end if;

  return false;
end;
$$;

comment on function app_private.user_requires_mfa is
  'Politique D2 (docs/roadmap.md). Miroir exact de lib/auth/mfa.ts '
  'organizationRequiresMfa() cote application — un test d''integration '
  'compare les deux (voir tests/integration/mfa-policy.test.ts).';

-- is_super_admin() accorde un contournement large (toutes organisations,
-- toutes policies RLS qui l''appellent) : il doit lui-meme exiger AAL2,
-- sinon un SUPER_ADMIN non-MFA garderait ce contournement alors que
-- has_permission() le lui refuse deja pour les permissions nommees —
-- incoherence corrigee ici. L''appartenance ordinaire (is_active_member)
-- n''est PAS affectee : un SUPER_ADMIN non-MFA garde une visibilite de
-- simple membre le temps d''aller enroler son facteur.
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
  )
  and app_private.current_aal() = 'aal2';
$$;

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

  -- Application D2 : role a MFA obligatoire mais session non AAL2 => aucune
  -- permission accordee (l'enrolement MFA reste toujours possible : il ne
  -- passe par aucune de ces permissions).
  if app_private.user_requires_mfa(p_user_id, p_org_id)
     and app_private.current_aal() <> 'aal2' then
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
