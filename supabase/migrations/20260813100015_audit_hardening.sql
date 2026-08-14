-- MedFinder Gestion — Audit cible pre-validation Phase 1A
-- Trois corrections identifiees pendant l'audit demande par Jean Alix
-- Pierre (pas de nouvelle fonctionnalite metier — durcissement de
-- l'existant uniquement). Voir docs/phase-1a-closing-report.md §Audit.

-- ---------------------------------------------------------------------
-- 1) users_select : la policy d'origine exposait TOUTES les colonnes de
--    public.users (dont phone, mfa_enabled, status — classees
--    "confidentiel" en §80 du prompt maitre) a n'importe quel collegue
--    actif de la meme organisation, alors que seul full_name/avatar_url
--    relevent du "public interne". RLS etant une restriction de LIGNES et
--    non de COLONNES, la seule maniere correcte de limiter l'exposition
--    est de restreindre la visibilite complete de la ligne aux cas ou
--    elle est reellement necessaire : soi-meme, ou un acteur disposant
--    d'une permission d'administration des utilisateurs/roles pour
--    l'organisation partagee (elle-meme deja soumise a la contrainte MFA
--    D2 pour SUPER_ADMIN/DG/DT). Toute UI future listant un simple
--    annuaire de collegues (nom, avatar) devra passer par une fonction
--    dediee n'exposant que ces colonnes, pas par un SELECT direct sur
--    public.users.
-- ---------------------------------------------------------------------

drop policy if exists users_select on public.users;

create policy users_select on public.users
  for select to authenticated
  using (
    id = auth.uid()
    or app_private.is_super_admin(auth.uid())
    or exists (
      select 1
      from public.memberships target_m
      join public.memberships actor_m
        on actor_m.organization_id = target_m.organization_id
      where target_m.user_id = public.users.id
        and target_m.status = 'active'
        and actor_m.user_id = auth.uid()
        and actor_m.status = 'active'
        and (
          app_private.has_permission(auth.uid(), actor_m.organization_id, 'user.manage')
          or app_private.has_permission(auth.uid(), actor_m.organization_id, 'role.manage')
        )
    )
  );

comment on policy users_select on public.users is
  'Restreint (audit pre-Phase-1B) : visibilite complete de la ligne limitee '
  'a soi-meme, SUPER_ADMIN (AAL2), ou un acteur avec user.manage/role.manage '
  'dans une organisation partagee avec la cible. Evite l''exposition de '
  'phone/mfa_enabled/status a de simples collegues.';

-- ---------------------------------------------------------------------
-- 2) admin_set_permission_override ne verifiait pas que l'utilisateur
--    cible est reellement membre actif de l'organisation avant de creer
--    l'override. Sans impact sur has_permission() (qui verifie deja
--    is_active_member en premier), mais permettait de creer des lignes
--    orphelines/dénuées de sens. Ajoute le meme controle que
--    admin_set_user_status.
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

  if not app_private.is_active_member(p_target_user_id, p_org_id) then
    perform app_private.write_audit_log(
      p_org_id, 'set_permission_override', 'rbac', 'user_permission_overrides', null,
      null,
      jsonb_build_object('target_user_id', p_target_user_id, 'permission', p_permission_code, 'effect', p_effect),
      'error'
    );
    return jsonb_build_object('success', false, 'error', 'target_not_active_member');
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
-- 3) Durcissement defense-in-depth : les fonctions de app_private ne
--    sont pas exposees par PostgREST (schema hors [api].schemas), ce qui
--    est la protection primaire — mais aucune n'avait de REVOKE EXECUTE
--    explicite. On le fait maintenant pour qu'un futur changement de
--    configuration API n'ouvre pas accidentellement un acces direct.
--    service_role garde EXECUTE (contexte serveur de confiance).
-- ---------------------------------------------------------------------

revoke execute on all functions in schema app_private from public;

alter default privileges in schema app_private
  revoke execute on functions from public;

-- IMPORTANT (corrige suite a echec de test) : les policies RLS de
-- 20260813100010 appellent app_private.is_super_admin / is_active_member /
-- has_permission DIRECTEMENT dans leur clause USING. Cette evaluation se
-- fait sous le role de connexion (authenticated), PAS sous le proprietaire
-- de la fonction (SECURITY DEFINER ne change le contexte de privilege
-- qu'UNE FOIS la fonction deja en cours d'execution — il faut d'abord avoir
-- le droit de l'appeler). Le revoke ci-dessus casse donc toute policy RLS
-- pour "authenticated" si on ne re-accorde pas explicitement EXECUTE sur
-- ces 3 points d'entree. Les fonctions imbriquees qu'elles appellent en
-- interne (user_requires_mfa, current_aal, write_audit_log, ...) s'executent
-- sous le contexte SECURITY DEFINER de la fonction appelante et n'ont pas
-- besoin d'un grant separe.
grant execute on function app_private.is_super_admin(uuid) to authenticated;
grant execute on function app_private.is_active_member(uuid, uuid) to authenticated;
grant execute on function app_private.has_permission(uuid, uuid, text) to authenticated;
