-- MedFinder Gestion — suppression d'une ligne budgetaire tant que le
-- budget est en brouillon.
--
-- POURQUOI UNE MIGRATION EST ICI INDISPENSABLE
-- -------------------------------------------
-- La modification d'une ligne etait deja possible : la policy
-- `budget_lines_update` (20260815090004) autorise l'UPDATE au porteur de
-- `budget.manage` UNIQUEMENT lorsque le budget parent est 'draft'. Rien a
-- ajouter de ce cote.
--
-- La SUPPRESSION, elle, est bloquee au niveau TABLE :
--   revoke delete on public.budget_lines from authenticated;
-- Aucune policy ne peut contourner un privilege revoque, donc la
-- capacite n'existe pas sans cette migration. Elle est additive et
-- n'ouvre rien d'autre.
--
-- CE QUI N'EST PAS AJOUTE, PARCE QUE DEJA GARANTI
-- ----------------------------------------------
-- « Ne jamais permettre la suppression d'une ligne ayant des
-- engagements » est deja assure par les cles etrangeres existantes, qui
-- referencent toutes budget_lines en `on delete restrict` :
--   budget_commitments.budget_line_id   (20260815090004)
--   budget_transfers.from_line_id / to_line_id
--   expense_requests.budget_line_id     (20260815090005)
--   grant_budget_lines.budget_line_id   (20260815090006)
-- PostgreSQL refuse donc la suppression avec 23503 des qu'une de ces
-- lignes existe. Redoubler ce controle en trigger ajouterait un second
-- endroit ou la regle pourrait diverger, sans rien garantir de plus. Le
-- test d'integration verifie ce refus au lieu de le supposer.

grant delete on public.budget_lines to authenticated;

-- Meme condition que la policy UPDATE existante : permission budgetaire
-- ET budget parent encore en brouillon. Une ligne d'un budget approuve ou
-- revise reste indestructible, y compris pour un SUPER_ADMIN passant par
-- l'application (seul un acces service_role, hors application, y echappe).
create policy budget_lines_delete on public.budget_lines
  for delete to authenticated
  using (
    (app_private.is_super_admin((select auth.uid()))
     or app_private.has_permission((select auth.uid()), organization_id, 'budget.manage'))
    and exists (
      select 1 from public.budgets b
      where b.id = budget_lines.budget_id and b.status = 'draft'
    )
  );

-- =====================================================================
-- AUTO-VERIFICATION
-- =====================================================================
-- Garde-fou etabli en Phase 2C apres deux migrations correctives restees
-- silencieusement sans effet.
do $verify$
declare
  v int;
begin
  select count(*) into v from pg_policies
   where schemaname = 'public' and tablename = 'budget_lines' and policyname = 'budget_lines_delete';
  if v <> 1 then
    raise exception 'ECHEC : la policy budget_lines_delete est absente';
  end if;

  if not has_table_privilege('authenticated', 'public.budget_lines', 'DELETE') then
    raise exception 'ECHEC : le privilege DELETE n''est pas accorde a authenticated sur budget_lines';
  end if;

  -- La policy doit bien porter la condition de brouillon : sans elle, une
  -- ligne d'un budget approuve deviendrait supprimable.
  select count(*) into v from pg_policies
   where schemaname = 'public' and tablename = 'budget_lines'
     and policyname = 'budget_lines_delete'
     and qual like '%draft%';
  if v <> 1 then
    raise exception 'ECHEC : budget_lines_delete ne restreint pas au statut draft';
  end if;

  raise notice 'OK : suppression d''une ligne budgetaire en brouillon activee et verifiee.';
end;
$verify$;
