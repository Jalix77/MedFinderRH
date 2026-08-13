-- MedFinder Gestion — Seed de DEVELOPPEMENT UNIQUEMENT.
--
-- Ce fichier n'est charge que par `supabase db reset` / `supabase start`
-- sur un environnement LOCAL (voir supabase/config.toml [db.seed]). Il ne
-- doit JAMAIS etre execute contre un projet Supabase staging/production —
-- aucune procedure de ce depot ne l'invoque automatiquement en dehors du
-- CLI local (voir docs/roadmap.md, "Donnees de demonstration").
--
-- Objet : 2 organisations de demo + un compte de test par role (9 roles) +
-- un compte suspendu + un compte etranger a l'organisation A, pour executer
-- la matrice de tests RLS/RBAC de docs/security.md §4.
--
-- Mot de passe commun de TOUS les comptes de demo : "DemoPass#2026"
-- (valeur fixe, documentee ici en clair a dessein — acceptable uniquement
-- parce qu'elle ne s'applique qu'a une base Postgres locale ephemere,
-- jamais accessible depuis l'exterieur, jamais utilisee en staging/prod).
-- NE JAMAIS REUTILISER CE MOT DE PASSE POUR UN COMPTE REEL.

do $$
declare
  v_org_a uuid;
  v_org_b uuid;
  v_password text := crypt('DemoPass#2026', gen_salt('bf'));

  v_users jsonb := '[
    {"email": "super.demo@medfinder.test",     "name": "Demo Super Admin",       "role": "SUPER_ADMIN",         "org": "A", "status": "active"},
    {"email": "dg.demo@medfinder.test",        "name": "Demo Directeur General", "role": "DIRECTEUR_GENERAL",   "org": "A", "status": "active"},
    {"email": "dt.demo@medfinder.test",        "name": "Demo Directeur Tech",    "role": "DIRECTEUR_TECHNIQUE", "org": "A", "status": "active"},
    {"email": "comptable.demo@medfinder.test", "name": "Demo Comptable",         "role": "COMPTABLE",           "org": "A", "status": "active"},
    {"email": "rh.demo@medfinder.test",        "name": "Demo RH",                "role": "RH",                 "org": "A", "status": "active"},
    {"email": "manager.demo@medfinder.test",   "name": "Demo Manager",           "role": "MANAGER",             "org": "A", "status": "active"},
    {"email": "agent.demo@medfinder.test",     "name": "Demo Agent Terrain",     "role": "AGENT_TERRAIN",       "org": "A", "status": "active"},
    {"email": "support.demo@medfinder.test",   "name": "Demo Support",           "role": "SUPPORT",             "org": "A", "status": "active"},
    {"email": "employe.demo@medfinder.test",   "name": "Demo Employe",           "role": "EMPLOYE",             "org": "A", "status": "active"},
    {"email": "suspendu.demo@medfinder.test",  "name": "Demo Suspendu",          "role": "EMPLOYE",             "org": "A", "status": "suspended"},
    {"email": "orgb.demo@medfinder.test",      "name": "Demo Org B DG",          "role": "DIRECTEUR_GENERAL",   "org": "B", "status": "active"}
  ]'::jsonb;

  v_item jsonb;
  v_auth_id uuid;
  v_role_id uuid;
  v_membership_id uuid;
  v_org_id uuid;
begin
  insert into public.organizations (name, tax_id, settings)
  values ('MedFinder Demo — Organisation A', 'DEMO-A', jsonb_build_object('demo', true))
  returning id into v_org_a;

  insert into public.organizations (name, tax_id, settings)
  values ('MedFinder Demo — Organisation B', 'DEMO-B', jsonb_build_object('demo', true))
  returning id into v_org_b;

  for v_item in select * from jsonb_array_elements(v_users)
  loop
    v_auth_id := gen_random_uuid();
    v_org_id := case when v_item ->> 'org' = 'A' then v_org_a else v_org_b end;

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      is_sso_user
    ) values (
      '00000000-0000-0000-0000-000000000000', v_auth_id, 'authenticated', 'authenticated',
      v_item ->> 'email', v_password,
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', v_item ->> 'name'),
      -- email_change_token_new n'a pas de DEFAULT en base (contrairement
      -- aux autres colonnes *_token) : GoTrue echoue au scan SQL si NULL
      -- ("converting NULL to string is unsupported") — doit etre '' ici.
      '', '', '', '',
      false
    );

    -- public.users est cree automatiquement par le trigger on_auth_user_created.

    insert into public.memberships (user_id, organization_id, status)
    values (v_auth_id, v_org_id, v_item ->> 'status')
    returning id into v_membership_id;

    select id into v_role_id from public.roles
      where code = v_item ->> 'role' and organization_id is null;

    insert into public.membership_roles (membership_id, role_id)
    values (v_membership_id, v_role_id);
  end loop;

  raise notice 'Seed DEV termine : 2 organisations de demo, % comptes de test crees.', jsonb_array_length(v_users);
end;
$$;
