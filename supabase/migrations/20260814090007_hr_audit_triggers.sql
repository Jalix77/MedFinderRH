-- MedFinder Gestion — Phase 1B
-- Attache le trigger d'audit generique (app_private.audit_row_trigger,
-- Phase 1A) a toutes les nouvelles tables RH — chaque creation/
-- modification est tracee automatiquement, y compris les donnees tres
-- sensibles (employee_sensitive_data) et les contrats.

create trigger audit_departments
  after insert or update or delete on public.departments
  for each row execute function app_private.audit_row_trigger();

create trigger audit_positions
  after insert or update or delete on public.positions
  for each row execute function app_private.audit_row_trigger();

create trigger audit_employees
  after insert or update or delete on public.employees
  for each row execute function app_private.audit_row_trigger();

create trigger audit_employee_sensitive_data
  after insert or update or delete on public.employee_sensitive_data
  for each row execute function app_private.audit_row_trigger();

create trigger audit_contracts
  after insert or update or delete on public.contracts
  for each row execute function app_private.audit_row_trigger();

create trigger audit_contract_amendments
  after insert or update or delete on public.contract_amendments
  for each row execute function app_private.audit_row_trigger();

create trigger audit_employee_documents
  after insert or update or delete on public.employee_documents
  for each row execute function app_private.audit_row_trigger();
