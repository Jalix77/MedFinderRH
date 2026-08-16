-- MedFinder Gestion — Phase 1C-UI, verification demandee de la migration
-- 20260816090010 : deux trouvailles reelles, corrigees ici.
--
-- 1) budgets_select n'a jamais ete etendue a expense.create (seule
--    budget_lines_select l'a ete) — or app/(app)/depenses/nouvelle/page.tsx
--    embarque budgets ( name, status ) depuis budget_lines pour filtrer les
--    lignes d'un budget APPROUVE. Sans lecture sur `budgets`, PostgREST
--    renvoie `budgets: null` pour chaque ligne (confirme empiriquement
--    contre le cloud avec agent.demo) : le filtre
--    `l.budgets?.status === 'approved'` exclut alors TOUTES les lignes,
--    et un AGENT_TERRAIN voit systematiquement "Aucune ligne budgetaire
--    approuvee disponible" — contredisant directement l'assertion demandee
--    "AGENT_TERRAIN avec expense.create peut selectionner les lignes
--    necessaires a sa propre depense".
--
-- 2) La portee de 090010 etait plus large que necessaire : un detenteur de
--    expense.create seul voyait TOUTES les lignes budgetaires de
--    l'organisation, y compris celles de budgets en brouillon (jamais
--    utilisables pour une depense reelle) — contraire au principe de
--    moindre privilege et a l'assertion demandee "il ne peut pas consulter
--    globalement les lignes/budgets auxquels il n'a pas droit". Restreint
--    ici aux lignes dont le budget parent est 'approved' uniquement pour
--    la branche expense.create — les detenteurs de budget.view continuent
--    de tout voir (transparence totale deja voulue pour ce role).

drop policy if exists budget_lines_select on public.budget_lines;
create policy budget_lines_select on public.budget_lines
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'budget.view')
    or (
      app_private.has_permission(auth.uid(), organization_id, 'expense.create')
      and exists (
        select 1 from public.budgets b
        where b.id = budget_lines.budget_id and b.status = 'approved'
      )
    )
  );

drop policy if exists budgets_select on public.budgets;
create policy budgets_select on public.budgets
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'budget.view')
    or (
      app_private.has_permission(auth.uid(), organization_id, 'expense.create')
      and status = 'approved'
    )
  );
