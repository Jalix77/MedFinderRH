-- MedFinder Gestion — Phase 2C.3A, correctif.
--
-- DEFAUT REEL, trouve par les tests (pas par relecture) : le helper
-- app_private.post_document_journal_entry assignait le resultat de
-- app_private.post_journal_entry() a une variable jsonb.
--
-- Or app_private.post_journal_entry(uuid, uuid) RETURNS VOID — c'est la
-- variante INTERNE, qui signale toute anomalie en LEVANT une exception
-- (periode fermee, desequilibre, comptes invalides). Seule la variante
-- publique public.post_journal_entry() renvoie un jsonb.
--
-- Consequence observee : l'affectation d'un `void` a une variable jsonb
-- produisait une chaine vide, d'ou l'erreur PostgreSQL 22P02
-- « invalid input syntax for type json: The input string ended
-- unexpectedly » a CHAQUE emission — aucune facture ne pouvait etre
-- comptabilisee.
--
-- Correction : appel par `perform`, et on s'en remet aux exceptions de
-- la fonction interne. C'est d'ailleurs le comportement RECHERCHE pour
-- l'atomicite (exigence n°1) : toute anomalie de comptabilisation leve,
-- donc annule la transaction entiere — numero d'ecriture, numero de
-- document et bascule de statut compris. Aucun etat « emis sans
-- ecriture » n'est observable.
--
-- Seul le corps du helper change ; sa signature, son confinement
-- (app_private, aucun grant) et son search_path sont inchanges.

create or replace function app_private.post_document_journal_entry(
  p_org_id uuid,
  p_journal_code text,
  p_entry_date date,
  p_description text,
  p_source_type text,
  p_source_id uuid,
  p_lines jsonb,
  p_actor uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_journal_id uuid;
  v_period_id uuid;
  v_entry_number text;
  v_entry_id uuid;
  v_line jsonb;
begin
  if p_lines is null or jsonb_array_length(p_lines) < 2 then
    raise exception 'Ecriture invalide : au moins 2 lignes sont requises';
  end if;

  select id into v_journal_id from public.journals
   where organization_id = p_org_id and code = p_journal_code;
  if v_journal_id is null then
    raise exception 'Journal % introuvable pour l''organisation %', p_journal_code, p_org_id;
  end if;

  v_period_id := app_private.find_period_for_date(p_org_id, p_entry_date);
  if v_period_id is null then
    raise exception 'Aucune periode comptable configuree pour la date %', p_entry_date;
  end if;

  v_entry_number := app_private.next_number_internal(p_org_id, 'journal_entry');

  insert into public.journal_entries (
    organization_id, journal_id, period_id, entry_number, entry_date,
    description, source_type, source_id, status, created_by, updated_by
  ) values (
    p_org_id, v_journal_id, v_period_id, v_entry_number, p_entry_date,
    p_description, p_source_type, p_source_id, 'draft', p_actor, p_actor
  ) returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    insert into public.journal_entry_lines (
      organization_id, entry_id, account_id, debit, credit,
      third_party_type, third_party_id, cost_center_id,
      currency, exchange_rate_to_htg, created_by, updated_by
    ) values (
      p_org_id,
      v_entry_id,
      (v_line->>'account_id')::uuid,
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      nullif(v_line->>'third_party_type', ''),
      nullif(v_line->>'third_party_id', '')::uuid,
      nullif(v_line->>'cost_center_id', '')::uuid,
      coalesce(nullif(v_line->>'currency', ''), 'HTG'),
      coalesce((v_line->>'exchange_rate_to_htg')::numeric, 1),
      p_actor, p_actor
    );
  end loop;

  -- Variante INTERNE : retourne void et LEVE en cas d'anomalie (periode
  -- fermee, desequilibre debit/credit, comptes invalides/inactifs/hors
  -- organisation). L'exception propage et annule toute la transaction —
  -- c'est exactement la garantie d'atomicite recherchee.
  perform app_private.post_journal_entry(v_entry_id, p_actor);

  return v_entry_id;
end;
$$;

revoke all on function app_private.post_document_journal_entry(uuid, text, date, text, text, uuid, jsonb, uuid) from public;
revoke execute on function app_private.post_document_journal_entry(uuid, text, date, text, text, uuid, jsonb, uuid) from anon, authenticated;

-- =====================================================================
-- AUTO-VERIFICATION — la migration echoue bruyamment si elle n'a pas
-- reellement pris effet (une premiere tentative d'application s'etait
-- terminee sans que le corps de la fonction soit remplace).
-- =====================================================================
do $verify$
declare
  v_fixed boolean;
  v_granted int;
begin
  select prosrc like '%perform app_private.post_journal_entry%'
    into v_fixed
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_private'
     and p.proname = 'post_document_journal_entry';

  if v_fixed is null then
    raise exception 'ECHEC : app_private.post_document_journal_entry est introuvable.';
  end if;

  if not v_fixed then
    raise exception
      'ECHEC : le corps de app_private.post_document_journal_entry n''a PAS ete remplace (l''ancienne version bugguee est toujours active).';
  end if;

  -- Le confinement doit rester intact : aucun droit d'execution pour
  -- anon ni authenticated.
  select count(*) into v_granted
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_private'
     and p.proname = 'post_document_journal_entry'
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
       or has_function_privilege('authenticated', p.oid, 'EXECUTE'));

  if v_granted > 0 then
    raise exception
      'ECHEC : le helper est expose a anon/authenticated — le confinement app_private est rompu.';
  end if;

  raise notice 'OK : correctif applique et confinement du helper verifie.';
end;
$verify$;
