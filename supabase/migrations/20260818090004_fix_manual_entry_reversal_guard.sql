-- MedFinder Gestion — Phase 2A — correctif du correctif : la migration
-- 20260818090003 bloquait aussi la contre-passation d'une ecriture MANUELLE
-- legitimement approuvee et postee (trouve par test d'integration, pas par
-- relecture) : reverse_journal_entry cree une nouvelle ligne journal_entries
-- avec source_type herite de l'originale (donc 'manual' si l'originale
-- l'est) et l'appelle immediatement app_private.post_journal_entry() dans
-- la meme transaction — mais cette nouvelle ligne demarre a 'draft', jamais
-- 'approved', puisque la contre-passation est une action systeme atomique
-- (deja gardee par accounting.reverse + justification obligatoire), jamais
-- une saisie manuelle a re-soumettre au workflow SoD.
--
-- Distinction : une ecriture manuelle "racine" (reversed_entry_id NULL)
-- exige toujours 'approved'. Une ecriture de contre-passation
-- (reversed_entry_id NOT NULL, quel que soit le source_type herite) suit le
-- chemin 'draft' inchange — reverse_journal_entry() reste la seule autorite
-- qui la cree ET la poste, dans la meme transaction, jamais un brouillon
-- laisse en attente.

create or replace function app_private.post_journal_entry(p_entry_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_entry public.journal_entries%rowtype;
  v_period_status text;
  v_line_count int;
  v_total_debit numeric(14, 2);
  v_total_credit numeric(14, 2);
  v_invalid_account_count int;
begin
  select * into v_entry from public.journal_entries where id = p_entry_id for update;
  if not found then
    raise exception 'Ecriture comptable % introuvable', p_entry_id;
  end if;

  if v_entry.source_type = 'manual' and v_entry.reversed_entry_id is null then
    if v_entry.status <> 'approved' then
      raise exception 'Ecriture manuelle % : le workflow Soumission -> Approbation doit etre complete avant comptabilisation (statut actuel: %)',
        p_entry_id, v_entry.status;
    end if;
  else
    if v_entry.status <> 'draft' then
      raise exception 'Ecriture comptable % n''est pas en brouillon (statut: %)', p_entry_id, v_entry.status;
    end if;
  end if;

  select status into v_period_status from public.accounting_periods where id = v_entry.period_id;
  if v_period_status <> 'open' then
    raise exception 'Periode comptable fermee — comptabilisation impossible pour l''ecriture %', p_entry_id;
  end if;

  select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into v_line_count, v_total_debit, v_total_credit
    from public.journal_entry_lines
    where entry_id = p_entry_id;

  if v_line_count < 2 then
    raise exception 'Ecriture comptable % : au moins 2 lignes requises (trouve: %)', p_entry_id, v_line_count;
  end if;
  if v_total_debit <= 0 or v_total_credit <= 0 then
    raise exception 'Ecriture comptable % : total debit et credit doivent etre strictement positifs (debit=%, credit=%)',
      p_entry_id, v_total_debit, v_total_credit;
  end if;
  if v_total_debit <> v_total_credit then
    raise exception 'Ecriture comptable % desequilibree : debit=% credit=%', p_entry_id, v_total_debit, v_total_credit;
  end if;

  select count(*) into v_invalid_account_count
    from public.journal_entry_lines l
    join public.chart_of_accounts a on a.id = l.account_id
    where l.entry_id = p_entry_id
      and (a.organization_id <> v_entry.organization_id or not a.is_active);
  if v_invalid_account_count > 0 then
    raise exception 'Ecriture comptable % : % ligne(s) referencent un compte invalide/inactif/hors organisation',
      p_entry_id, v_invalid_account_count;
  end if;

  update public.journal_entries
     set status = 'posted', posted_by = p_actor, posted_at = now()
   where id = p_entry_id;

  perform app_private.write_audit_log(
    v_entry.organization_id, 'post_journal_entry', 'comptabilite', 'journal_entry', p_entry_id,
    null, jsonb_build_object('debit', v_total_debit, 'credit', v_total_credit), 'success'
  );
end;
$$;

revoke execute on function app_private.post_journal_entry(uuid, uuid) from public;
