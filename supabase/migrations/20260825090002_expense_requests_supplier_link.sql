-- MedFinder Gestion — Phase 2C, jalon 2C.1 (2e migration) : liaison
-- FACULTATIVE d'une demande de depense a une fiche fournisseur.
--
-- DECISION ARBITREE n°1 (Jean Alix Pierre, 19/08/2026) :
--   « Pas de workflow autonome de factures fournisseurs en Phase 2C.
--     Les fournisseurs sont des tiers et expense_requests.supplier_id
--     est ajoute nullable ; payee_name et payee_reference restent des
--     snapshots historiques. »
--
-- Cette migration est donc STRICTEMENT ADDITIVE :
--   - payee_name (NOT NULL) et payee_reference sont CONSERVES tels
--     quels. Ils demeurent la PHOTO HISTORIQUE du beneficiaire au
--     moment de la depense — indispensable pour les depenses ponctuelles
--     sans fiche fournisseur, et pour ne jamais reecrire le passe si une
--     fiche est renommee plus tard.
--   - supplier_id est nullable et le restera DEFINITIVEMENT. Il n'est
--     jamais rendu obligatoire, ni maintenant ni dans une phase
--     ulterieure.
--   - AUCUNE demande de depense existante n'est modifiee, ni retro-liee
--     automatiquement a un tiers.
--   - AUCUNE policy RLS, AUCUNE RPC, AUCUN trigger existant de
--     expense_requests n'est modifie : le workflow de depense de la
--     Phase 1C.4 fonctionne exactement comme avant.
--
-- Aucune ecriture comptable n'est generee ni modifiee par ce jalon.

alter table public.expense_requests
  add column supplier_id uuid null references public.third_parties (id) on delete restrict;

comment on column public.expense_requests.supplier_id is
  'Lien FACULTATIF vers une fiche fournisseur (public.third_parties). '
  'Nullable de facon permanente — decision arbitree n°1 de Phase 2C. '
  'Ne remplace PAS payee_name/payee_reference, qui restent le snapshot '
  'historique du beneficiaire au moment de la depense.';

-- Cle etrangere indexee (index partiel : la grande majorite des lignes
-- restera a NULL). Evite l'avertissement Performance Advisor « cle
-- etrangere non indexee » — lecon Phase 1C.
create index expense_requests_supplier_idx
  on public.expense_requests (supplier_id)
  where supplier_id is not null;

-- Coherence : le tiers designe doit porter le role SUPPLIER et
-- appartenir a la MEME organisation que la demande de depense.
-- `on delete restrict` ci-dessus empeche deja de supprimer un
-- fournisseur reference ; ce trigger ferme le cas d'un rattachement
-- incorrect a l'ecriture.
create or replace function app_private.enforce_expense_supplier_consistency()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_supplier record;
begin
  if new.supplier_id is null then
    return new;
  end if;

  select organization_id, is_supplier, is_active, legal_name
    into v_supplier
    from public.third_parties
    where id = new.supplier_id;

  if not found then
    raise exception 'Fournisseur % introuvable', new.supplier_id;
  end if;

  if v_supplier.organization_id <> new.organization_id then
    raise exception
      'Incoherence organisation : le fournisseur % appartient a une autre organisation que la demande de depense',
      new.supplier_id;
  end if;

  if not v_supplier.is_supplier then
    raise exception
      'Le tiers "%" n''a pas le role fournisseur — impossible de le rattacher a une demande de depense',
      v_supplier.legal_name;
  end if;

  return new;
end;
$$;

revoke execute on function app_private.enforce_expense_supplier_consistency() from public;

create trigger enforce_expense_supplier_consistency
  before insert or update on public.expense_requests
  for each row execute function app_private.enforce_expense_supplier_consistency();
