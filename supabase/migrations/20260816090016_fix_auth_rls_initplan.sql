-- MedFinder Gestion — Hardening cloud, avertissements Performance Advisor
-- (auth_rls_initplan, 74 policies concernees sur 79 au total en
-- base — reconciliation dans docs/phase-1c-closing-report.md).
--
-- GENERE MECANIQUEMENT depuis l'etat REEL des policies
-- (public.debug_dump_all_policies(), migration 20260816090015), jamais
-- depuis une relecture des fichiers de migration source. Transformation
-- UNIQUE et IDENTIQUE pour toutes les policies : chaque appel nu
-- auth.uid()/auth.jwt()/auth.role()/auth.email() devient
-- (select auth.<fn>()) — la forme documentee par Supabase pour que
-- Postgres l'evalue une seule fois par requete (InitPlan) au lieu d'une
-- fois par ligne. AUCUNE autre modification : conditions, permissions,
-- perimetre d'acces et roles cibles restent identiques a l'octet pres en
-- dehors de cet enrobage — jamais de changement de logique d'autorisation
-- pour faire taire un avertissement de performance.
--
-- Chaque politique est DROP puis CREATE (Postgres ne supporte pas
-- CREATE OR REPLACE POLICY) avec le meme nom, la meme table, la meme
-- portee (permissive/restrictive), la meme commande (select/insert/
-- update/delete) et les memes roles cibles que la version actuelle.

drop policy if exists accounting_periods_close on public.accounting_periods;
create policy accounting_periods_close on public.accounting_periods
  as permissive
  for update
  to authenticated
  using (
    ((status = 'open'::text) AND (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'accounting.close_period'::text)))
  )
  with check (
    (status = 'closed'::text)
  );

drop policy if exists accounting_periods_insert on public.accounting_periods;
create policy accounting_periods_insert on public.accounting_periods
  as permissive
  for insert
  to authenticated
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'accounting.post'::text))
  );

drop policy if exists accounting_periods_select on public.accounting_periods;
create policy accounting_periods_select on public.accounting_periods
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'accounting.view'::text))
  );

drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR ((organization_id IS NOT NULL) AND app_private.has_permission((select auth.uid()), organization_id, 'audit.view'::text)) OR ((object_type = 'expense_requests'::text) AND (object_id IN ( SELECT expense_requests.id
   FROM public.expense_requests
  WHERE (expense_requests.requester_id = (select auth.uid()))))))
  );

drop policy if exists bank_accounts_insert on public.bank_accounts;
create policy bank_accounts_insert on public.bank_accounts
  as permissive
  for insert
  to authenticated
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'treasury.manage'::text))
  );

drop policy if exists bank_accounts_select on public.bank_accounts;
create policy bank_accounts_select on public.bank_accounts
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'treasury.manage'::text) OR app_private.has_permission((select auth.uid()), organization_id, 'accounting.view'::text))
  );

drop policy if exists bank_accounts_update on public.bank_accounts;
create policy bank_accounts_update on public.bank_accounts
  as permissive
  for update
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'treasury.manage'::text))
  )
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'treasury.manage'::text))
  );

drop policy if exists budget_commitments_select on public.budget_commitments;
create policy budget_commitments_select on public.budget_commitments
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'budget.view'::text))
  );

drop policy if exists budget_lines_insert on public.budget_lines;
create policy budget_lines_insert on public.budget_lines
  as permissive
  for insert
  to authenticated
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'budget.manage'::text))
  );

drop policy if exists budget_lines_select on public.budget_lines;
create policy budget_lines_select on public.budget_lines
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'budget.view'::text) OR (app_private.has_permission((select auth.uid()), organization_id, 'expense.create'::text) AND (EXISTS ( SELECT 1
   FROM public.budgets b
  WHERE ((b.id = budget_lines.budget_id) AND (b.status = 'approved'::text))))))
  );

drop policy if exists budget_lines_update on public.budget_lines;
create policy budget_lines_update on public.budget_lines
  as permissive
  for update
  to authenticated
  using (
    ((app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'budget.manage'::text)) AND (EXISTS ( SELECT 1
   FROM public.budgets b
  WHERE ((b.id = budget_lines.budget_id) AND (b.status = 'draft'::text)))))
  )
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'budget.manage'::text))
  );

drop policy if exists budget_transfers_select on public.budget_transfers;
create policy budget_transfers_select on public.budget_transfers
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'budget.view'::text))
  );

drop policy if exists budgets_insert on public.budgets;
create policy budgets_insert on public.budgets
  as permissive
  for insert
  to authenticated
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'budget.manage'::text))
  );

drop policy if exists budgets_select on public.budgets;
create policy budgets_select on public.budgets
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'budget.view'::text) OR (app_private.has_permission((select auth.uid()), organization_id, 'expense.create'::text) AND (status = 'approved'::text)))
  );

drop policy if exists budgets_update on public.budgets;
create policy budgets_update on public.budgets
  as permissive
  for update
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'budget.manage'::text))
  )
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'budget.manage'::text))
  );

drop policy if exists cash_accounts_insert on public.cash_accounts;
create policy cash_accounts_insert on public.cash_accounts
  as permissive
  for insert
  to authenticated
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'treasury.manage'::text))
  );

drop policy if exists cash_accounts_select on public.cash_accounts;
create policy cash_accounts_select on public.cash_accounts
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'treasury.manage'::text) OR app_private.has_permission((select auth.uid()), organization_id, 'accounting.view'::text))
  );

drop policy if exists cash_accounts_update on public.cash_accounts;
create policy cash_accounts_update on public.cash_accounts
  as permissive
  for update
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'treasury.manage'::text))
  )
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'treasury.manage'::text))
  );

drop policy if exists cash_movements_select on public.cash_movements;
create policy cash_movements_select on public.cash_movements
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'treasury.manage'::text) OR app_private.has_permission((select auth.uid()), organization_id, 'accounting.view'::text))
  );

drop policy if exists chart_of_accounts_insert on public.chart_of_accounts;
create policy chart_of_accounts_insert on public.chart_of_accounts
  as permissive
  for insert
  to authenticated
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'accounting.post'::text))
  );

drop policy if exists chart_of_accounts_select on public.chart_of_accounts;
create policy chart_of_accounts_select on public.chart_of_accounts
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'accounting.view'::text))
  );

drop policy if exists chart_of_accounts_update on public.chart_of_accounts;
create policy chart_of_accounts_update on public.chart_of_accounts
  as permissive
  for update
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'accounting.post'::text))
  )
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'accounting.post'::text))
  );

drop policy if exists contract_amendments_insert on public.contract_amendments;
create policy contract_amendments_insert on public.contract_amendments
  as permissive
  for insert
  to authenticated
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'contract.manage'::text))
  );

drop policy if exists contract_amendments_select on public.contract_amendments;
create policy contract_amendments_select on public.contract_amendments
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'employee.view_salary'::text) OR (EXISTS ( SELECT 1
   FROM (public.contracts c
     JOIN public.employees e ON ((e.id = c.employee_id)))
  WHERE ((c.id = contract_amendments.contract_id) AND (e.user_id = (select auth.uid()))))))
  );

drop policy if exists contracts_insert on public.contracts;
create policy contracts_insert on public.contracts
  as permissive
  for insert
  to authenticated
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'contract.manage'::text))
  );

drop policy if exists contracts_select on public.contracts;
create policy contracts_select on public.contracts
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'employee.view_salary'::text) OR (EXISTS ( SELECT 1
   FROM public.employees e
  WHERE ((e.id = contracts.employee_id) AND (e.user_id = (select auth.uid()))))))
  );

drop policy if exists contracts_update on public.contracts;
create policy contracts_update on public.contracts
  as permissive
  for update
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'contract.manage'::text))
  )
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'contract.manage'::text))
  );

drop policy if exists cost_centers_insert on public.cost_centers;
create policy cost_centers_insert on public.cost_centers
  as permissive
  for insert
  to authenticated
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'budget.manage'::text))
  );

drop policy if exists cost_centers_select on public.cost_centers;
create policy cost_centers_select on public.cost_centers
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'budget.view'::text) OR app_private.has_permission((select auth.uid()), organization_id, 'expense.create'::text))
  );

drop policy if exists cost_centers_update on public.cost_centers;
create policy cost_centers_update on public.cost_centers
  as permissive
  for update
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'budget.manage'::text))
  )
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'budget.manage'::text))
  );

drop policy if exists departments_insert on public.departments;
create policy departments_insert on public.departments
  as permissive
  for insert
  to authenticated
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'department.manage'::text))
  );

drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.is_active_member((select auth.uid()), organization_id))
  );

drop policy if exists departments_update on public.departments;
create policy departments_update on public.departments
  as permissive
  for update
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'department.manage'::text))
  )
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'department.manage'::text))
  );

drop policy if exists employee_documents_insert on public.employee_documents;
create policy employee_documents_insert on public.employee_documents
  as permissive
  for insert
  to authenticated
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'document.upload'::text))
  );

drop policy if exists employee_sensitive_data_insert on public.employee_sensitive_data;
create policy employee_sensitive_data_insert on public.employee_sensitive_data
  as permissive
  for insert
  to authenticated
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'employee.view_sensitive'::text))
  );

drop policy if exists employee_sensitive_data_select on public.employee_sensitive_data;
create policy employee_sensitive_data_select on public.employee_sensitive_data
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'employee.view_sensitive'::text) OR (EXISTS ( SELECT 1
   FROM public.employees e
  WHERE ((e.id = employee_sensitive_data.employee_id) AND (e.user_id = (select auth.uid()))))))
  );

drop policy if exists employee_sensitive_data_update on public.employee_sensitive_data;
create policy employee_sensitive_data_update on public.employee_sensitive_data
  as permissive
  for update
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'employee.view_sensitive'::text))
  )
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'employee.view_sensitive'::text))
  );

drop policy if exists employees_insert on public.employees;
create policy employees_insert on public.employees
  as permissive
  for insert
  to authenticated
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'employee.create'::text))
  );

drop policy if exists employees_select on public.employees;
create policy employees_select on public.employees
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'employee.view'::text) OR (user_id = (select auth.uid())))
  );

drop policy if exists employees_update on public.employees;
create policy employees_update on public.employees
  as permissive
  for update
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'employee.update'::text) OR app_private.has_permission((select auth.uid()), organization_id, 'employee.terminate'::text))
  )
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'employee.update'::text) OR app_private.has_permission((select auth.uid()), organization_id, 'employee.terminate'::text))
  );

drop policy if exists expense_approvals_select on public.expense_approvals;
create policy expense_approvals_select on public.expense_approvals
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'expense.approve'::text) OR app_private.has_permission((select auth.uid()), organization_id, 'expense.view'::text) OR (EXISTS ( SELECT 1
   FROM public.expense_requests er
  WHERE ((er.id = expense_approvals.expense_id) AND (er.requester_id = (select auth.uid()))))))
  );

drop policy if exists expense_attachments_insert on public.expense_attachments;
create policy expense_attachments_insert on public.expense_attachments
  as permissive
  for insert
  to authenticated
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'document.upload'::text))
  );

drop policy if exists expense_categories_select on public.expense_categories;
create policy expense_categories_select on public.expense_categories
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'expense.view'::text) OR app_private.has_permission((select auth.uid()), organization_id, 'budget.view'::text) OR app_private.has_permission((select auth.uid()), organization_id, 'expense.create'::text))
  );

drop policy if exists expense_categories_update on public.expense_categories;
create policy expense_categories_update on public.expense_categories
  as permissive
  for update
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'budget.manage'::text))
  )
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'budget.manage'::text))
  );

drop policy if exists expense_categories_write on public.expense_categories;
create policy expense_categories_write on public.expense_categories
  as permissive
  for insert
  to authenticated
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'budget.manage'::text))
  );

drop policy if exists expense_requests_insert on public.expense_requests;
create policy expense_requests_insert on public.expense_requests
  as permissive
  for insert
  to authenticated
  with check (
    ((app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'expense.create'::text)) AND (requester_id = (select auth.uid())) AND (status = 'draft'::text))
  );

drop policy if exists expense_requests_select on public.expense_requests;
create policy expense_requests_select on public.expense_requests
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'expense.view'::text) OR (requester_id = (select auth.uid())))
  );

drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'expense.view'::text) OR (EXISTS ( SELECT 1
   FROM public.expense_requests er
  WHERE ((er.id = expenses.expense_request_id) AND (er.requester_id = (select auth.uid()))))))
  );

drop policy if exists fiscal_years_insert on public.fiscal_years;
create policy fiscal_years_insert on public.fiscal_years
  as permissive
  for insert
  to authenticated
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'accounting.post'::text))
  );

drop policy if exists fiscal_years_select on public.fiscal_years;
create policy fiscal_years_select on public.fiscal_years
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'accounting.view'::text))
  );

drop policy if exists fiscal_years_update on public.fiscal_years;
create policy fiscal_years_update on public.fiscal_years
  as permissive
  for update
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'accounting.post'::text))
  )
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'accounting.post'::text))
  );

drop policy if exists grant_budget_lines_select on public.grant_budget_lines;
create policy grant_budget_lines_select on public.grant_budget_lines
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'papej.view'::text))
  );

drop policy if exists grant_reports_select on public.grant_reports;
create policy grant_reports_select on public.grant_reports
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'papej.view'::text))
  );

drop policy if exists grants_insert on public.grants;
create policy grants_insert on public.grants
  as permissive
  for insert
  to authenticated
  with check (
    ((app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'papej.manage'::text)) AND (amount_received = (0)::numeric))
  );

drop policy if exists grants_select on public.grants;
create policy grants_select on public.grants
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'papej.view'::text))
  );

drop policy if exists grants_update on public.grants;
create policy grants_update on public.grants
  as permissive
  for update
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'papej.manage'::text))
  )
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'papej.manage'::text))
  );

drop policy if exists journal_entries_select on public.journal_entries;
create policy journal_entries_select on public.journal_entries
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'accounting.view'::text))
  );

drop policy if exists journal_entry_lines_select on public.journal_entry_lines;
create policy journal_entry_lines_select on public.journal_entry_lines
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'accounting.view'::text))
  );

drop policy if exists journals_insert on public.journals;
create policy journals_insert on public.journals
  as permissive
  for insert
  to authenticated
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'accounting.post'::text))
  );

drop policy if exists journals_select on public.journals;
create policy journals_select on public.journals
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'accounting.view'::text))
  );

drop policy if exists journals_update on public.journals;
create policy journals_update on public.journals
  as permissive
  for update
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'accounting.post'::text))
  )
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'accounting.post'::text))
  );

drop policy if exists membership_roles_select on public.membership_roles;
create policy membership_roles_select on public.membership_roles
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR (EXISTS ( SELECT 1
   FROM public.memberships m
  WHERE ((m.id = membership_roles.membership_id) AND ((m.user_id = (select auth.uid())) OR app_private.is_active_member((select auth.uid()), m.organization_id))))))
  );

drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR (user_id = (select auth.uid())) OR app_private.is_active_member((select auth.uid()), organization_id))
  );

drop policy if exists mobile_money_accounts_insert on public.mobile_money_accounts;
create policy mobile_money_accounts_insert on public.mobile_money_accounts
  as permissive
  for insert
  to authenticated
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'treasury.manage'::text))
  );

drop policy if exists mobile_money_accounts_select on public.mobile_money_accounts;
create policy mobile_money_accounts_select on public.mobile_money_accounts
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'treasury.manage'::text) OR app_private.has_permission((select auth.uid()), organization_id, 'accounting.view'::text))
  );

drop policy if exists mobile_money_accounts_update on public.mobile_money_accounts;
create policy mobile_money_accounts_update on public.mobile_money_accounts
  as permissive
  for update
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'treasury.manage'::text))
  )
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'treasury.manage'::text))
  );

drop policy if exists numbering_sequences_select on public.numbering_sequences;
create policy numbering_sequences_select on public.numbering_sequences
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.is_active_member((select auth.uid()), organization_id))
  );

drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.is_active_member((select auth.uid()), id))
  );

drop policy if exists positions_insert on public.positions;
create policy positions_insert on public.positions
  as permissive
  for insert
  to authenticated
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'position.manage'::text))
  );

drop policy if exists positions_select on public.positions;
create policy positions_select on public.positions
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.is_active_member((select auth.uid()), organization_id))
  );

drop policy if exists positions_update on public.positions;
create policy positions_update on public.positions
  as permissive
  for update
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'position.manage'::text))
  )
  with check (
    (app_private.is_super_admin((select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'position.manage'::text))
  );

drop policy if exists user_permission_overrides_select on public.user_permission_overrides;
create policy user_permission_overrides_select on public.user_permission_overrides
  as permissive
  for select
  to authenticated
  using (
    (app_private.is_super_admin((select auth.uid())) OR (user_id = (select auth.uid())) OR app_private.has_permission((select auth.uid()), organization_id, 'permission.override'::text) OR app_private.has_permission((select auth.uid()), organization_id, 'audit.view'::text))
  );

drop policy if exists users_select on public.users;
create policy users_select on public.users
  as permissive
  for select
  to authenticated
  using (
    ((id = (select auth.uid())) OR app_private.is_super_admin((select auth.uid())) OR (EXISTS ( SELECT 1
   FROM (public.memberships target_m
     JOIN public.memberships actor_m ON ((actor_m.organization_id = target_m.organization_id)))
  WHERE ((target_m.user_id = users.id) AND (target_m.status = 'active'::text) AND (actor_m.user_id = (select auth.uid())) AND (actor_m.status = 'active'::text) AND (app_private.has_permission((select auth.uid()), actor_m.organization_id, 'user.manage'::text) OR app_private.has_permission((select auth.uid()), actor_m.organization_id, 'role.manage'::text))))))
  );

drop policy if exists users_update_self on public.users;
create policy users_update_self on public.users
  as permissive
  for update
  to authenticated
  using (
    (id = (select auth.uid()))
  )
  with check (
    (id = (select auth.uid()))
  );

