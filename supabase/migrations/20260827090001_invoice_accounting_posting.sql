-- MedFinder Gestion — Phase 2C, jalon 2C.3 : emission COMPTABLE des
-- factures et avoirs. Plan : docs/phase-2c-plan.md.
--
-- PERIMETRE : comptabilisation a l'emission uniquement. AUCUN
-- encaissement, AUCUN record_customer_payment, AUCUN cash_movement,
-- AUCUN passage automatique en PARTIALLY_PAID/PAID, AUCUN rapprochement
-- bancaire — ces elements viendront apres validation de ce jalon.
--
-- Les documents deja emis pendant la fenetre 2C.2 (32 fixtures de test,
-- 0 donnee metier — pre-controle du 19/08/2026) ne sont VOLONTAIREMENT
-- pas rattrapes par cette migration : aucun backfill n'est effectue, ce
-- qui evite de fabriquer des ecritures pour des donnees de test.

-- =====================================================================
-- 1. Compte client par defaut — resolu par CONFIGURATION
-- =====================================================================
-- Exigence n°3 : aucun code de compte (1100/4000...) ne doit etre une
-- dependance metier codee en dur dans un RPC. La resolution par `code`
-- a donc lieu ICI, une seule fois, au moment de la migration ; le RPC ne
-- connait ensuite que des identifiants issus du referentiel.

alter table public.organizations
  add column default_receivable_account_id uuid
    references public.chart_of_accounts (id) on delete restrict;

comment on column public.organizations.default_receivable_account_id is
  'Compte collectif "Creances clients" par defaut de l''organisation. '
  'Renseigne a la migration 2C.3 a partir du plan comptable seede, puis '
  'entierement administrable. La cascade de resolution est : '
  'third_parties.receivable_account_id -> ce defaut -> erreur explicite '
  'receivable_account_not_configured. Aucun code de compte n''est code '
  'en dur dans les RPC.';

create index organizations_default_receivable_idx
  on public.organizations (default_receivable_account_id)
  where default_receivable_account_id is not null;

-- Valeur de depart : le compte de creances clients deja seede.
update public.organizations o
   set default_receivable_account_id = (
     select a.id from public.chart_of_accounts a
     where a.organization_id = o.id and a.code = '1100' and a.is_active
     limit 1
   )
 where o.default_receivable_account_id is null;

-- =====================================================================
-- 2. Garantie D'UNICITE EN BASE — idempotence et concurrence
-- =====================================================================
-- Exigence n°8 : deux appels concurrents ne doivent produire ni deux
-- numeros, ni deux ecritures, ni double comptabilisation.
--
-- Deux verrous complementaires :
--   (a) `select ... for update` sur la ligne du document dans le RPC
--       serialise deux appels concurrents sur le MEME document : le
--       second attend, puis observe status='issued' et sort en
--       invalid_status. Le numero et l'ecriture du perdant sont annules
--       par le rollback de sa propre transaction.
--   (b) l'index unique ci-dessous : garantie STRUCTURELLE, independante
--       du code applicatif, qu'un document ne peut jamais porter deux
--       ecritures d'origine.
--
-- POINT SUBTIL : reverse_journal_entry() RECOPIE source_type et
-- source_id de l'ecriture d'origine sur l'ecriture de contre-passation.
-- Un index sur (source_type, source_id) seul casserait donc toute
-- annulation. Le filtre `reversed_entry_id is null` restreint l'unicite
-- aux seules ecritures D'ORIGINE et laisse passer leur contre-passation.

create unique index journal_entries_one_origin_per_invoice_idx
  on public.journal_entries (source_type, source_id)
  where source_type = 'invoice' and source_id is not null and reversed_entry_id is null;

-- =====================================================================
-- 3. Helper multi-lignes — CONFINE a app_private (exigence n°2)
-- =====================================================================
-- - jamais expose via PostgREST (schema app_private) ;
-- - AUCUN grant execute a authenticated ni a anon ;
-- - set search_path = '' ;
-- - il n'existe aucune RPC publique permettant a un utilisateur de
--   fournir des lignes comptables arbitraires : les lignes sont
--   construites par les RPC metier APRES validation.
--
-- Le helper ne reimplemente aucun controle : il delegue a
-- app_private.post_journal_entry, qui verifie deja periode ouverte,
-- equilibre debit = credit, minimum 2 lignes et validite des comptes.

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
  v_posted jsonb;
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

  -- Delegation au moteur existant : periode ouverte, equilibre, comptes.
  -- Toute anomalie leve une exception -> la transaction entiere est
  -- annulee, donc AUCUN document ne peut rester "emis sans ecriture".
  v_posted := app_private.post_journal_entry(v_entry_id, p_actor);
  if not coalesce((v_posted->>'success')::boolean, false) then
    raise exception 'Comptabilisation refusee : %', coalesce(v_posted->>'error', 'inconnue');
  end if;

  return v_entry_id;
end;
$$;

revoke all on function app_private.post_document_journal_entry(uuid, text, date, text, text, uuid, jsonb, uuid) from public;
revoke execute on function app_private.post_document_journal_entry(uuid, text, date, text, text, uuid, jsonb, uuid) from anon, authenticated;

comment on function app_private.post_document_journal_entry is
  'Helper de comptabilisation multi-lignes, Phase 2C.3. CONFINE a '
  'app_private : jamais expose via PostgREST, aucun grant a '
  'authenticated. Appelable uniquement par les RPC metier, qui '
  'construisent elles-memes les lignes APRES validation — aucun chemin '
  'ne permet a un utilisateur de poster des lignes arbitraires.';

-- =====================================================================
-- 4. Emission comptable — atomique (exigences n°1, 3, 4, 5, 6, 7, 8)
-- =====================================================================

create or replace function public.issue_invoice_document(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_doc public.invoices%rowtype;
  v_credited public.invoices%rowtype;
  v_line_count int;
  v_total numeric(14, 2);
  v_subtotal numeric(14, 2);
  v_tax_total numeric(14, 2);
  v_number text;
  v_entity_type text;
  v_exception_ok boolean;
  v_receivable_account uuid;
  v_period_id uuid;
  v_period_status text;
  v_missing_tax int;
  v_already_credited numeric(14, 2);
  v_sign int;
  v_lines jsonb;
  v_entry_id uuid;
begin
  -- (a) Verrou de ligne : serialise deux emissions concurrentes du meme
  --     document (exigence n°8).
  select * into v_doc from public.invoices where id = p_document_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'document_not_found');
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_doc.organization_id, 'invoice.manage')) then
    perform app_private.write_audit_log(
      v_doc.organization_id, 'issue_invoice_document', 'ventes', 'invoice', p_document_id,
      null, null, 'denied');
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  if v_doc.status not in ('draft', 'pending_issue') then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  -- (b) Separation des fonctions (exigence SoD, decision arbitree n°2).
  if v_doc.created_by = v_actor and not app_private.is_super_admin(v_actor) then
    select exists (
      select 1 from public.invoice_issue_approvals a
      where a.invoice_id = p_document_id
        and a.exception_result = 'approved'
        and a.exception_requested_by = v_actor
    ) into v_exception_ok;
    if not coalesce(v_exception_ok, false) then
      perform app_private.write_audit_log(
        v_doc.organization_id, 'issue_invoice_document', 'ventes', 'invoice', p_document_id,
        null, jsonb_build_object('reason', 'self_issue_blocked'), 'denied');
      return jsonb_build_object('success', false, 'error', 'self_issue_blocked');
    end if;
  end if;

  -- (c) Validation documentaire.
  select count(*), coalesce(sum(line_total), 0), coalesce(sum(line_subtotal), 0), coalesce(sum(tax_amount), 0)
    into v_line_count, v_total, v_subtotal, v_tax_total
    from public.invoice_lines where invoice_id = p_document_id;

  if v_line_count = 0 then
    return jsonb_build_object('success', false, 'error', 'no_lines');
  end if;
  if v_total <= 0 then
    return jsonb_build_object('success', false, 'error', 'zero_total');
  end if;

  -- Coherence organisation document / tiers (exigence n°4).
  if not exists (
    select 1 from public.third_parties t
    where t.id = v_doc.third_party_id and t.organization_id = v_doc.organization_id
  ) then
    return jsonb_build_object('success', false, 'error', 'third_party_organization_mismatch');
  end if;

  -- Devise (exigence n°5) : coherence du taux.
  if v_doc.currency = 'HTG' and v_doc.exchange_rate_to_htg <> 1 then
    return jsonb_build_object('success', false, 'error', 'invalid_exchange_rate');
  end if;

  -- (d) Periode comptable (exigence n°7) : refus PROPRE avant toute
  --     allocation, plutot qu'une exception en cours de route.
  v_period_id := app_private.find_period_for_date(v_doc.organization_id, v_doc.document_date);
  if v_period_id is null then
    return jsonb_build_object('success', false, 'error', 'no_accounting_period');
  end if;
  select status into v_period_status from public.accounting_periods where id = v_period_id;
  if v_period_status <> 'open' then
    perform app_private.write_audit_log(
      v_doc.organization_id, 'issue_invoice_document', 'ventes', 'invoice', p_document_id,
      null, jsonb_build_object('reason', 'period_closed'), 'denied');
    return jsonb_build_object('success', false, 'error', 'period_closed');
  end if;

  -- (e) Resolution du compte client PAR CONFIGURATION (exigence n°3) :
  --     tiers -> defaut organisation -> erreur explicite. Aucun code de
  --     compte n'apparait ici.
  select coalesce(t.receivable_account_id, o.default_receivable_account_id)
    into v_receivable_account
    from public.third_parties t
    join public.organizations o on o.id = t.organization_id
   where t.id = v_doc.third_party_id;

  if v_receivable_account is null then
    return jsonb_build_object('success', false, 'error', 'receivable_account_not_configured');
  end if;

  -- Compte de taxe : toute ligne taxee doit avoir un compte de taxe
  -- resoluble, sinon refus explicite (jamais un compte devine).
  select count(*) into v_missing_tax
    from public.invoice_lines l
    left join public.tax_rates r on r.id = l.tax_rate_id
   where l.invoice_id = p_document_id
     and l.tax_amount > 0
     and (r.id is null or r.tax_account_id is null);
  if v_missing_tax > 0 then
    return jsonb_build_object('success', false, 'error', 'tax_account_not_configured');
  end if;

  -- (f) Avoir : plafond cumulatif (exigence n°6). Le verrou sur la
  --     facture d'origine serialise deux avoirs concurrents.
  if v_doc.document_type = 'CREDIT_NOTE' then
    if v_doc.credited_invoice_id is null then
      return jsonb_build_object('success', false, 'error', 'credited_invoice_required');
    end if;

    select * into v_credited from public.invoices
     where id = v_doc.credited_invoice_id for update;
    if not found then
      return jsonb_build_object('success', false, 'error', 'credited_invoice_not_found');
    end if;

    select coalesce(sum(c.total), 0) into v_already_credited
      from public.invoices c
     where c.credited_invoice_id = v_doc.credited_invoice_id
       and c.document_type = 'CREDIT_NOTE'
       and c.status in ('issued', 'partially_paid', 'paid');

    if v_already_credited + v_total > v_credited.total then
      perform app_private.write_audit_log(
        v_doc.organization_id, 'issue_invoice_document', 'ventes', 'invoice', p_document_id,
        null,
        jsonb_build_object('reason', 'credit_exceeds_invoice',
                           'already_credited', v_already_credited,
                           'attempted', v_total, 'invoice_total', v_credited.total),
        'denied');
      return jsonb_build_object(
        'success', false, 'error', 'credit_exceeds_invoice',
        'already_credited', v_already_credited,
        'invoice_total', v_credited.total, 'attempted', v_total);
    end if;
  end if;

  -- (g) Numerotation : sequence distincte selon le type.
  v_entity_type := case when v_doc.document_type = 'CREDIT_NOTE'
                        then 'credit_note' else 'customer_invoice' end;
  v_number := app_private.next_number_internal(v_doc.organization_id, v_entity_type);

  -- (h) Construction des lignes comptables PAR LE RPC (exigence n°2) :
  --     l'utilisateur ne fournit jamais de lignes comptables.
  --     Facture : Dr Creances / Cr Produits [/ Cr Taxe].
  --     Avoir   : sens strictement inverse (exigence n°6).
  v_sign := case when v_doc.document_type = 'CREDIT_NOTE' then -1 else 1 end;

  select jsonb_agg(l) into v_lines from (
    -- Ligne de creance, porteuse de la comptabilite auxiliaire.
    select jsonb_build_object(
      'account_id', v_receivable_account,
      'debit',  case when v_sign = 1 then v_total else 0 end,
      'credit', case when v_sign = 1 then 0 else v_total end,
      'third_party_type', 'customer',
      'third_party_id', v_doc.third_party_id,
      'cost_center_id', v_doc.cost_center_id,
      'currency', v_doc.currency,
      'exchange_rate_to_htg', v_doc.exchange_rate_to_htg
    ) as l
    union all
    -- Produits, regroupes par compte.
    select jsonb_build_object(
      'account_id', g.revenue_account_id,
      'debit',  case when v_sign = 1 then 0 else g.amount end,
      'credit', case when v_sign = 1 then g.amount else 0 end,
      'cost_center_id', coalesce(g.cost_center_id, v_doc.cost_center_id),
      'currency', v_doc.currency,
      'exchange_rate_to_htg', v_doc.exchange_rate_to_htg
    )
    from (
      select l2.revenue_account_id, l2.cost_center_id, sum(l2.line_subtotal) as amount
        from public.invoice_lines l2
       where l2.invoice_id = p_document_id
       group by l2.revenue_account_id, l2.cost_center_id
      having sum(l2.line_subtotal) <> 0
    ) g
    union all
    -- Taxes, regroupees par compte de taxe.
    select jsonb_build_object(
      'account_id', tg.tax_account_id,
      'debit',  case when v_sign = 1 then 0 else tg.amount end,
      'credit', case when v_sign = 1 then tg.amount else 0 end,
      'currency', v_doc.currency,
      'exchange_rate_to_htg', v_doc.exchange_rate_to_htg
    )
    from (
      select r.tax_account_id, sum(l3.tax_amount) as amount
        from public.invoice_lines l3
        join public.tax_rates r on r.id = l3.tax_rate_id
       where l3.invoice_id = p_document_id and l3.tax_amount > 0
       group by r.tax_account_id
      having sum(l3.tax_amount) <> 0
    ) tg
  ) lines;

  -- (i) Comptabilisation. Toute anomalie leve une exception : la
  --     transaction entiere est annulee (numero compris), donc aucun
  --     document ne peut devenir 'issued' sans son ecriture.
  v_entry_id := app_private.post_document_journal_entry(
    v_doc.organization_id,
    'SALES',
    v_doc.document_date,
    coalesce(v_doc.document_type, 'INVOICE') || ' ' || v_number,
    'invoice',
    p_document_id,
    v_lines,
    v_actor
  );

  -- (j) Bascule du statut, dans la MEME transaction.
  update public.invoices
     set document_number = v_number,
         status          = 'issued',
         issued_at       = now(),
         issued_by       = v_actor,
         updated_by      = v_actor
   where id = p_document_id;

  perform app_private.write_audit_log(
    v_doc.organization_id, 'issue_invoice_document', 'ventes', 'invoice', p_document_id,
    null,
    jsonb_build_object('document_type', v_doc.document_type, 'document_number', v_number,
                       'total', v_total, 'journal_entry_id', v_entry_id),
    'success');

  return jsonb_build_object(
    'success', true, 'document_number', v_number, 'status', 'issued',
    'total', v_total, 'subtotal', v_subtotal, 'tax_total', v_tax_total,
    'journal_entry_id', v_entry_id);
end;
$$;

revoke all on function public.issue_invoice_document(uuid) from public;
grant execute on function public.issue_invoice_document(uuid) to authenticated;

-- =====================================================================
-- 5. Annulation — contre-passation, jamais de reecriture (exigence n°9)
-- =====================================================================

create or replace function public.cancel_invoice_document(p_document_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_doc public.invoices%rowtype;
  v_entry_id uuid;
  v_reversal jsonb;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    return jsonb_build_object('success', false, 'error', 'reason_required');
  end if;

  select * into v_doc from public.invoices where id = p_document_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'document_not_found');
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_doc.organization_id, 'invoice.manage')) then
    perform app_private.write_audit_log(
      v_doc.organization_id, 'cancel_invoice_document', 'ventes', 'invoice', p_document_id,
      null, null, 'denied');
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  if v_doc.status <> 'issued' then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  -- Ecriture d'origine du document (jamais une contre-passation).
  select id into v_entry_id from public.journal_entries
   where source_type = 'invoice' and source_id = p_document_id
     and reversed_entry_id is null
   limit 1;

  if v_entry_id is not null then
    -- Annuler un document comptabilise EST une contre-passation :
    -- l'acteur doit donc aussi porter accounting.reverse. Aucun
    -- contournement du controle existant de Phase 1C/2A.
    if not (app_private.is_super_admin(v_actor)
            or app_private.has_permission(v_actor, v_doc.organization_id, 'accounting.reverse')) then
      perform app_private.write_audit_log(
        v_doc.organization_id, 'cancel_invoice_document', 'ventes', 'invoice', p_document_id,
        null, jsonb_build_object('reason', 'reverse_permission_required'), 'denied');
      return jsonb_build_object('success', false, 'error', 'not_authorized_reverse');
    end if;

    v_reversal := public.reverse_journal_entry(v_entry_id, p_reason);
    if not coalesce((v_reversal->>'success')::boolean, false) then
      return jsonb_build_object('success', false, 'error',
        coalesce(v_reversal->>'error', 'reversal_failed'));
    end if;
  end if;

  update public.invoices
     set status        = 'cancelled',
         cancel_reason = p_reason,
         cancelled_at  = now(),
         cancelled_by  = v_actor,
         updated_by    = v_actor
   where id = p_document_id;

  perform app_private.write_audit_log(
    v_doc.organization_id, 'cancel_invoice_document', 'ventes', 'invoice', p_document_id,
    null, jsonb_build_object('reason', p_reason, 'reversed_entry', v_entry_id), 'success');

  return jsonb_build_object('success', true, 'status', 'cancelled', 'reversed_entry_id', v_entry_id);
end;
$$;

revoke all on function public.cancel_invoice_document(uuid, text) from public;
grant execute on function public.cancel_invoice_document(uuid, text) to authenticated;
