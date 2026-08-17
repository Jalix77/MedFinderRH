-- MedFinder Gestion — Phase 2A — correctif : contournement reel trouve par
-- verification directe dans le navigateur (pas par relecture de code) : la
-- migration 20260818090001 elargissait app_private.post_journal_entry pour
-- accepter le statut 'approved' EN PLUS de 'draft', mais n'empechait pas de
-- comptabiliser directement une ecriture MANUELLE encore en 'draft' —
-- contournant entierement le workflow Soumission -> Approbation (§0.3 du
-- plan Phase 2, exigence explicite de Jean Alix Pierre : "le createur d'une
-- ecriture manuelle ne doit pas pouvoir la valider lui-meme"). Un COMPTABLE
-- pouvait creer un brouillon et cliquer directement "Comptabiliser" sans
-- jamais passer par Soumettre/Approuver.
--
-- Correction : le statut 'draft' n'est accepte que pour les ecritures
-- AUTOMATIQUES (source_type <> 'manual' — expense/grant aujourd'hui,
-- invoice/payroll/asset/loan/contribution en Phase 2B-2F, toutes postees
-- dans la meme transaction que leur creation, jamais laissees en attente).
-- Une ecriture manuelle (source_type = 'manual') exige desormais
-- explicitement le statut 'approved' — jamais 'draft' — donc le workflow
-- Draft -> Submitted -> Approved -> Posted devient réellement incontournable.
-- Aucun autre comportement de la fonction ne change (invariants equilibre/
-- periode/comptes toujours verifies a l'identique).

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

  if v_entry.source_type = 'manual' then
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
