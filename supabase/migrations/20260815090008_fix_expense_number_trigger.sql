-- MedFinder Gestion — Phase 1C, correctif post-verification cloud (2)
-- Trouvaille (rejeu de tests/integration/expenses.test.ts contre le projet
-- cloud) : contrairement a employees.matricule (Phase 1B,
-- assign_employee_matricule, BEFORE INSERT), expense_requests.expense_number
-- n'avait JAMAIS reçu le trigger equivalent — la migration 1C.4 ajoutait le
-- type de sequence 'expense' (§11 du plan corrige) mais oubliait de
-- brancher un trigger qui le consomme reellement a la creation. Consequence
-- concrete : chaque INSERT laissait expense_number a la chaine vide fournie
-- par le client, et la deuxieme demande de depense d'une meme organisation
-- violait la contrainte unique(organization_id, expense_number) —
-- confirme par la quasi-totalite des tests de expenses.test.ts rejoues
-- contre le cloud (duplicate key value).
--
-- Corrige ici avec exactement le meme patron qu'assign_employee_matricule
-- (20260814090004) : trigger BEFORE INSERT, n'assigne que si la valeur
-- fournie est vide/nulle (permet un futur import avec numero deja connu,
-- meme convention que pour les employes).

create or replace function app_private.assign_expense_number()
returns trigger
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  if new.expense_number is null or length(trim(new.expense_number)) = 0 then
    new.expense_number := app_private.next_number_internal(new.organization_id, 'expense');
  end if;
  return new;
end;
$$;

revoke execute on function app_private.assign_expense_number() from public;

create trigger assign_expense_number
  before insert on public.expense_requests
  for each row execute function app_private.assign_expense_number();
