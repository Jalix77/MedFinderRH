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

-- ---------------------------------------------------------------------
-- Phase 1B — Departements, postes, employes, contrats de demonstration
-- (Organisation A uniquement). Postes calques sur §16 du prompt maitre.
-- Quelques employes sont lies (user_id) aux comptes de demo deja crees
-- ci-dessus, pour tester l'auto-visibilite RLS ("mes propres donnees").
-- ---------------------------------------------------------------------

do $$
declare
  v_org_a uuid;
  v_dept_direction uuid;
  v_dept_technique uuid;
  v_dept_commercial uuid;
  v_dept_support uuid;
  v_dept_finance uuid;

  v_pos_dg uuid;
  v_pos_dt uuid;
  v_pos_agent uuid;
  v_pos_support uuid;
  v_pos_comptable uuid;
  v_pos_rh uuid;

  v_user_dg uuid;
  v_user_dt uuid;
  v_user_agent uuid;
  v_user_support uuid;
  v_user_comptable uuid;
  v_user_rh uuid;
  v_user_employe uuid;

  v_emp_dg uuid;
  v_emp_dt uuid;
  v_emp_agent uuid;
  v_emp_support uuid;
  v_emp_comptable uuid;
  v_emp_rh uuid;
  v_emp_generic uuid;
begin
  select id into v_org_a from public.organizations where name = 'MedFinder Demo — Organisation A';

  select id into v_user_dg from auth.users where email = 'dg.demo@medfinder.test';
  select id into v_user_dt from auth.users where email = 'dt.demo@medfinder.test';
  select id into v_user_agent from auth.users where email = 'agent.demo@medfinder.test';
  select id into v_user_support from auth.users where email = 'support.demo@medfinder.test';
  select id into v_user_comptable from auth.users where email = 'comptable.demo@medfinder.test';
  select id into v_user_rh from auth.users where email = 'rh.demo@medfinder.test';
  select id into v_user_employe from auth.users where email = 'employe.demo@medfinder.test';

  insert into public.departments (organization_id, name) values (v_org_a, 'Direction') returning id into v_dept_direction;
  insert into public.departments (organization_id, name) values (v_org_a, 'Technique') returning id into v_dept_technique;
  insert into public.departments (organization_id, name) values (v_org_a, 'Commercial & Terrain') returning id into v_dept_commercial;
  insert into public.departments (organization_id, name) values (v_org_a, 'Support & Contenu') returning id into v_dept_support;
  insert into public.departments (organization_id, name) values (v_org_a, 'Finance') returning id into v_dept_finance;

  insert into public.positions (organization_id, department_id, title, description)
    values (v_org_a, v_dept_direction, 'Fondateur & Directeur General', 'Direction generale de MedFinder Haiti')
    returning id into v_pos_dg;
  insert into public.positions (organization_id, department_id, title, description, reports_to_position_id)
    values (v_org_a, v_dept_technique, 'Co-fondateur & Directeur Technique', 'Produit et technique', v_pos_dg)
    returning id into v_pos_dt;
  insert into public.positions (organization_id, department_id, title, description)
    values (v_org_a, v_dept_commercial, 'Agent commercial & onboarding terrain', 'Prospection et onboarding prestataires')
    returning id into v_pos_agent;
  insert into public.positions (organization_id, department_id, title, description)
    values (v_org_a, v_dept_support, 'Charge support, donnees & contenu', 'Support utilisateurs et moderation')
    returning id into v_pos_support;
  insert into public.positions (organization_id, department_id, title, description)
    values (v_org_a, v_dept_finance, 'Comptable externe', 'Comptabilite et finance')
    returning id into v_pos_comptable;
  insert into public.positions (organization_id, department_id, title, description)
    values (v_org_a, v_dept_direction, 'Ressources Humaines', 'Gestion du personnel')
    returning id into v_pos_rh;

  insert into public.employees (organization_id, user_id, matricule, first_name, last_name, hire_date, department_id, position_id, status)
    values (v_org_a, v_user_dg, null, 'Jean Alix', 'Pierre', date '2024-01-15', v_dept_direction, v_pos_dg, 'active')
    returning id into v_emp_dg;
  insert into public.employees (organization_id, user_id, matricule, first_name, last_name, hire_date, department_id, position_id, manager_employee_id, status)
    values (v_org_a, v_user_dt, null, 'Christopher Junior', 'Renfort', date '2024-01-15', v_dept_technique, v_pos_dt, v_emp_dg, 'active')
    returning id into v_emp_dt;
  insert into public.employees (organization_id, user_id, matricule, first_name, last_name, hire_date, department_id, position_id, manager_employee_id, status)
    values (v_org_a, v_user_agent, null, 'Demo', 'Agent Terrain', date '2025-03-01', v_dept_commercial, v_pos_agent, v_emp_dg, 'active')
    returning id into v_emp_agent;
  insert into public.employees (organization_id, user_id, matricule, first_name, last_name, hire_date, department_id, position_id, manager_employee_id, status)
    values (v_org_a, v_user_support, null, 'Demo', 'Support', date '2025-06-01', v_dept_support, v_pos_support, v_emp_dg, 'active')
    returning id into v_emp_support;
  insert into public.employees (organization_id, user_id, matricule, first_name, last_name, hire_date, department_id, position_id, status)
    values (v_org_a, v_user_comptable, null, 'Demo', 'Comptable', date '2024-06-01', v_dept_finance, v_pos_comptable, 'active')
    returning id into v_emp_comptable;
  insert into public.employees (organization_id, user_id, matricule, first_name, last_name, hire_date, department_id, position_id, manager_employee_id, status)
    values (v_org_a, v_user_rh, null, 'Demo', 'RH', date '2025-01-01', v_dept_direction, v_pos_rh, v_emp_dg, 'active')
    returning id into v_emp_rh;
  insert into public.employees (organization_id, user_id, matricule, first_name, last_name, hire_date, department_id, manager_employee_id, status)
    values (v_org_a, v_user_employe, null, 'Demo', 'Employe', date '2025-09-01', v_dept_support, v_emp_support, 'active')
    returning id into v_emp_generic;

  -- Donnees tres sensibles pour 2 employes (test employee.view_sensitive).
  insert into public.employee_sensitive_data (employee_id, organization_id, birth_date, personal_phone, nif, cin, emergency_contact)
  values
    (v_emp_dg, v_org_a, date '1988-04-12', '+509 3700 0001', 'NIF-0001', 'CIN-0001', jsonb_build_object('name', 'Contact Urgence DG', 'phone', '+509 3700 9001')),
    (v_emp_dt, v_org_a, date '1990-09-23', '+509 3700 0002', 'NIF-0002', 'CIN-0002', jsonb_build_object('name', 'Contact Urgence DT', 'phone', '+509 3700 9002'));

  -- Contrats (test employee.view_salary — visible COMPTABLE/DG/SUPER_ADMIN,
  -- pas MANAGER/DT/SUPPORT/AGENT_TERRAIN).
  insert into public.contracts (organization_id, employee_id, type, start_date, base_salary, currency, payment_method, status)
  values
    (v_org_a, v_emp_dg, 'fondateur', date '2024-01-15', 0, 'HTG', 'virement_bancaire', 'active'),
    (v_org_a, v_emp_dt, 'fondateur', date '2024-01-15', 0, 'HTG', 'virement_bancaire', 'active'),
    (v_org_a, v_emp_agent, 'CDI', date '2025-03-01', 25000, 'HTG', 'moncash', 'active'),
    (v_org_a, v_emp_support, 'CDI', date '2025-06-01', 22000, 'HTG', 'moncash', 'active'),
    (v_org_a, v_emp_comptable, 'consultant', date '2024-06-01', 15000, 'HTG', 'virement_bancaire', 'active'),
    (v_org_a, v_emp_rh, 'CDI', date '2025-01-01', 28000, 'HTG', 'virement_bancaire', 'active'),
    (v_org_a, v_emp_generic, 'CDD', date '2025-09-01', 18000, 'HTG', 'moncash', 'active');

  raise notice 'Seed RH termine : 5 departements, 6 postes, 7 employes, 2 fiches sensibles, 7 contrats.';
end;
$$;
