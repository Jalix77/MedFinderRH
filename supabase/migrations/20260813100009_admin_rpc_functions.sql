-- MedFinder Gestion — Phase 1A
-- Fonctions RPC administratives pour les operations RBAC sensibles
-- (assignation de role, suspension d'utilisateur, override de permission,
-- parametres d'organisation). Ces tables n'ont volontairement AUCUNE policy
-- RLS d'ecriture (insert/update/delete) pour les roles applicatifs : toute
-- mutation passe par ces fonctions security definer, ce qui garantit :
--   1. la verification de permission cote serveur avant toute ecriture ;
--   2. une trace d'audit y compris en cas de refus (une exception "raise"
--      ferait echouer/annuler la transaction et perdrait la trace du refus —
--      voir la note dans chaque fonction) ;
--   3. l'impossibilite de contourner ces regles via un appel PostgREST direct
--      sur la table.
--
-- Convention de retour : {"success": boolean, "error": text|null, ...}.
-- Les erreurs d'autorisation NE LEVENT PAS d'exception (pour que l'insertion
-- d'audit "denied" soit conservee) ; les erreurs de donnees invalides
-- (ex. ressource introuvable) levent une exception classique.

-- ---------------------------------------------------------------------
-- admin_create_membership : rattache un utilisateur (deja inscrit via
-- Supabase Auth) a une organisation avec un role initial.
-- ---------------------------------------------------------------------
create or replace function public.admin_create_membership(
  p_org_id uuid,
  p_user_email text,
  p_role_code text
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_target_user_id uuid;
  v_role_id uuid;
  v_membership_id uuid;
begin
  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, p_org_id, 'user.manage')) then
    perform app_private.write_audit_log(
      p_org_id, 'create_membership', 'rbac', 'membership', null,
      null, jsonb_build_object('email', p_user_email, 'role', p_role_code), 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  select id into v_target_user_id from auth.users where email = p_user_email;
  if v_target_user_id is null then
    raise exception 'Aucun compte Supabase Auth pour %. L''utilisateur doit d''abord s''inscrire.', p_user_email;
  end if;

  select id into v_role_id from public.roles
    where code = p_role_code and organization_id is null;
  if v_role_id is null then
    raise exception 'Code de role inconnu: %', p_role_code;
  end if;

  insert into public.memberships (user_id, organization_id, status, created_by)
  values (v_target_user_id, p_org_id, 'active', v_actor)
  on conflict (user_id, organization_id)
    do update set status = 'active', updated_by = v_actor, updated_at = now()
  returning id into v_membership_id;

  insert into public.membership_roles (membership_id, role_id, created_by)
  values (v_membership_id, v_role_id, v_actor)
  on conflict (membership_id, role_id) do nothing;

  return jsonb_build_object('success', true, 'membership_id', v_membership_id);
end;
$$;

revoke all on function public.admin_create_membership(uuid, text, text) from public;
grant execute on function public.admin_create_membership(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- admin_assign_role / admin_revoke_role
-- Auto-elevation interdite : un acteur ne peut pas modifier ses propres
-- roles, sauf s'il est deja SUPER_ADMIN (regle §3 security.md).
-- ---------------------------------------------------------------------
create or replace function public.admin_assign_role(
  p_membership_id uuid,
  p_role_code text
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_org_id uuid;
  v_target_user_id uuid;
  v_role_id uuid;
begin
  select organization_id, user_id into v_org_id, v_target_user_id
    from public.memberships where id = p_membership_id;
  if v_org_id is null then
    raise exception 'Membership % introuvable', p_membership_id;
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_org_id, 'role.manage')) then
    perform app_private.write_audit_log(
      v_org_id, 'assign_role', 'rbac', 'membership_roles', p_membership_id,
      null, jsonb_build_object('role', p_role_code), 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  if v_target_user_id = v_actor and not app_private.is_super_admin(v_actor) then
    perform app_private.write_audit_log(
      v_org_id, 'assign_role', 'rbac', 'membership_roles', p_membership_id,
      null, jsonb_build_object('role', p_role_code, 'reason', 'self_elevation_blocked'), 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'self_elevation_blocked');
  end if;

  select id into v_role_id from public.roles
    where code = p_role_code and organization_id is null;
  if v_role_id is null then
    raise exception 'Code de role inconnu: %', p_role_code;
  end if;

  insert into public.membership_roles (membership_id, role_id, created_by)
  values (p_membership_id, v_role_id, v_actor)
  on conflict (membership_id, role_id) do nothing;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.admin_assign_role(uuid, text) from public;
grant execute on function public.admin_assign_role(uuid, text) to authenticated;

create or replace function public.admin_revoke_role(
  p_membership_id uuid,
  p_role_code text
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_org_id uuid;
  v_target_user_id uuid;
  v_role_id uuid;
begin
  select organization_id, user_id into v_org_id, v_target_user_id
    from public.memberships where id = p_membership_id;
  if v_org_id is null then
    raise exception 'Membership % introuvable', p_membership_id;
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_org_id, 'role.manage')) then
    perform app_private.write_audit_log(
      v_org_id, 'revoke_role', 'rbac', 'membership_roles', p_membership_id,
      jsonb_build_object('role', p_role_code), null, 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  if v_target_user_id = v_actor and not app_private.is_super_admin(v_actor) then
    perform app_private.write_audit_log(
      v_org_id, 'revoke_role', 'rbac', 'membership_roles', p_membership_id,
      jsonb_build_object('role', p_role_code, 'reason', 'self_elevation_blocked'), null, 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'self_elevation_blocked');
  end if;

  select id into v_role_id from public.roles
    where code = p_role_code and organization_id is null;
  if v_role_id is null then
    raise exception 'Code de role inconnu: %', p_role_code;
  end if;

  delete from public.membership_roles
    where membership_id = p_membership_id and role_id = v_role_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.admin_revoke_role(uuid, text) from public;
grant execute on function public.admin_revoke_role(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- admin_set_membership_status : suspendre/reactiver une appartenance.
-- ---------------------------------------------------------------------
create or replace function public.admin_set_membership_status(
  p_membership_id uuid,
  p_status text
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_org_id uuid;
begin
  if p_status not in ('active', 'suspended') then
    raise exception 'Statut invalide: %', p_status;
  end if;

  select organization_id into v_org_id from public.memberships where id = p_membership_id;
  if v_org_id is null then
    raise exception 'Membership % introuvable', p_membership_id;
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_org_id, 'user.manage')) then
    perform app_private.write_audit_log(
      v_org_id, 'set_membership_status', 'rbac', 'membership', p_membership_id,
      null, jsonb_build_object('status', p_status), 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  update public.memberships
     set status = p_status, updated_by = v_actor
   where id = p_membership_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.admin_set_membership_status(uuid, text) from public;
grant execute on function public.admin_set_membership_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- admin_set_user_status : suspendre/reactiver un utilisateur (identite
-- globale). Necessite user.manage dans au moins une organisation commune
-- avec la cible, ou SUPER_ADMIN.
-- ---------------------------------------------------------------------
create or replace function public.admin_set_user_status(
  p_target_user_id uuid,
  p_org_id uuid,
  p_status text
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
begin
  if p_status not in ('active', 'suspended') then
    raise exception 'Statut invalide: %', p_status;
  end if;

  if p_target_user_id = v_actor then
    perform app_private.write_audit_log(
      p_org_id, 'set_user_status', 'rbac', 'user', p_target_user_id,
      null, jsonb_build_object('status', p_status, 'reason', 'self_action_blocked'), 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'self_action_blocked');
  end if;

  if not (app_private.is_super_admin(v_actor)
          or (app_private.has_permission(v_actor, p_org_id, 'user.manage')
              and app_private.is_active_member(p_target_user_id, p_org_id))) then
    perform app_private.write_audit_log(
      p_org_id, 'set_user_status', 'rbac', 'user', p_target_user_id,
      null, jsonb_build_object('status', p_status), 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  update public.users set status = p_status where id = p_target_user_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.admin_set_user_status(uuid, uuid, text) from public;
grant execute on function public.admin_set_user_status(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- admin_set_permission_override : accorde/retire une permission
-- individuelle, tracee et justifiee (permission.override).
-- ---------------------------------------------------------------------
create or replace function public.admin_set_permission_override(
  p_target_user_id uuid,
  p_org_id uuid,
  p_permission_code text,
  p_effect text,
  p_reason text,
  p_expires_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_permission_id uuid;
  v_override_id uuid;
begin
  if p_effect not in ('grant', 'revoke') then
    raise exception 'Effet invalide: %', p_effect;
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Une justification est obligatoire pour un override de permission';
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, p_org_id, 'permission.override')) then
    perform app_private.write_audit_log(
      p_org_id, 'set_permission_override', 'rbac', 'user_permission_overrides', null,
      null,
      jsonb_build_object('target_user_id', p_target_user_id, 'permission', p_permission_code, 'effect', p_effect),
      'denied'
    );
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  select id into v_permission_id from public.permissions where code = p_permission_code;
  if v_permission_id is null then
    raise exception 'Code de permission inconnu: %', p_permission_code;
  end if;

  insert into public.user_permission_overrides (
    user_id, organization_id, permission_id, effect, reason, granted_by, expires_at
  ) values (
    p_target_user_id, p_org_id, v_permission_id, p_effect, p_reason, v_actor, p_expires_at
  )
  returning id into v_override_id;

  return jsonb_build_object('success', true, 'override_id', v_override_id);
end;
$$;

revoke all on function public.admin_set_permission_override(uuid, uuid, text, text, text, timestamptz) from public;
grant execute on function public.admin_set_permission_override(uuid, uuid, text, text, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- admin_update_organization_settings : modification des parametres
-- structures de l'organisation (settings.manage). Parametres explicites
-- (pas de patch jsonb libre) pour eviter tout mass assignment.
-- ---------------------------------------------------------------------
create or replace function public.admin_update_organization_settings(
  p_org_id uuid,
  p_name text default null,
  p_legal_name text default null,
  p_tax_id text default null,
  p_default_currency char(3) default null,
  p_fiscal_year_start_month smallint default null,
  p_timezone text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
begin
  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, p_org_id, 'settings.manage')) then
    perform app_private.write_audit_log(
      p_org_id, 'update_organization_settings', 'settings', 'organization', p_org_id,
      null, jsonb_build_object('attempted', true), 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  update public.organizations set
    name = coalesce(p_name, name),
    legal_name = coalesce(p_legal_name, legal_name),
    tax_id = coalesce(p_tax_id, tax_id),
    default_currency = coalesce(p_default_currency, default_currency),
    fiscal_year_start_month = coalesce(p_fiscal_year_start_month, fiscal_year_start_month),
    timezone = coalesce(p_timezone, timezone),
    updated_by = v_actor
  where id = p_org_id;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.admin_update_organization_settings(uuid, text, text, text, char(3), smallint, text) from public;
grant execute on function public.admin_update_organization_settings(uuid, text, text, text, char(3), smallint, text) to authenticated;
