-- MedFinder Gestion — Phase 1C-UI, correctif decouvert en construisant
-- l'interface de creation de depense.
--
-- Trouvaille : budget_lines_select / expense_categories_select /
-- cost_centers_select n'accordaient la lecture qu'aux detenteurs de
-- budget.view (ou expense.view pour les categories) — mais expense.create
-- (§ role AGENT_TERRAIN, docs/permissions-matrix.md : expense.create
-- "propres", sans budget.view) est cense pouvoir creer une demande de
-- depense, ce qui exige de choisir une ligne budgetaire (budget_line_id,
-- colonne NOT NULL de expense_requests). Sans lecture sur budget_lines, le
-- formulaire de creation presenterait une liste vide et un agent terrain
-- ne pourrait tout simplement pas soumettre de demande — contradiction
-- directe avec le role tel que documente.
--
-- Corrige en etendant les 3 policies SELECT concernees a expense.create,
-- en plus de budget.view/expense.view deja en place. Pas de fuite de
-- donnee sensible : categorie/nom de ligne/montant planifie ne sont pas
-- classes "tres sensible" (docs/security.md), et la visibilite reste
-- strictement scopee a l'organisation (is_active_member implicite dans
-- has_permission).

drop policy if exists budget_lines_select on public.budget_lines;
create policy budget_lines_select on public.budget_lines
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'budget.view')
    or app_private.has_permission(auth.uid(), organization_id, 'expense.create')
  );

drop policy if exists expense_categories_select on public.expense_categories;
create policy expense_categories_select on public.expense_categories
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'expense.view')
    or app_private.has_permission(auth.uid(), organization_id, 'budget.view')
    or app_private.has_permission(auth.uid(), organization_id, 'expense.create')
  );

drop policy if exists cost_centers_select on public.cost_centers;
create policy cost_centers_select on public.cost_centers
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'budget.view')
    or app_private.has_permission(auth.uid(), organization_id, 'expense.create')
  );

-- Deuxieme trouvaille, meme cause racine (ecran "historique des etats" de
-- la fiche depense, § perimetre UI obligatoire) : audit_logs_select exige
-- audit.view, qu'AGENT_TERRAIN/MANAGER/EMPLOYE n'ont jamais par defaut —
-- un demandeur ne pourrait donc jamais voir l'historique de SA PROPRE
-- demande. Extension etroite et scopee (pas une ouverture generale
-- d'audit_logs) : un acteur peut lire les entrees d'audit dont
-- object_type='expense_requests' et object_id correspond a une demande
-- dont il est le requester_id — meme principe d'auto-acces deja utilise
-- pour employees/contracts (Phase 1B).
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or (organization_id is not null and app_private.has_permission(auth.uid(), organization_id, 'audit.view'))
    or (
      object_type = 'expense_requests'
      and object_id in (select id from public.expense_requests where requester_id = auth.uid())
    )
  );
