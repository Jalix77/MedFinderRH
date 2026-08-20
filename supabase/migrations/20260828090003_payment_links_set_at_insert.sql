-- MedFinder Gestion — Phase 2C.3B, correctif structurel.
--
-- CONTEXTE : record_customer_payment() inserait le paiement SANS ses
-- liens comptables, puis les posait par UPDATE — ce qui se heurtait au
-- trigger d'immutabilite (journal_entry_id / cash_movement_id figes des
-- l'insertion). Le correctif precedent (20260828090002) assouplissait le
-- trigger pour tolerer la transition NULL -> valeur.
--
-- MEILLEURE APPROCHE, retenue ici : SUPPRIMER LE BESOIN de cet UPDATE.
-- L'identifiant du paiement est genere EN AMONT (gen_random_uuid), ce
-- qui permet de creer l'ecriture puis le mouvement AVANT d'inserer le
-- paiement — celui-ci nait donc avec ses deux liens deja renseignes.
--
-- C'est possible parce que journal_entries.source_id et
-- cash_movements.reference_id sont des uuid SANS cle etrangere (verifie
-- dans les migrations 1C.1 et 1C.2) : ils peuvent referencer un paiement
-- cree juste apres, dans la MEME transaction.
--
-- Benefices :
--   - l'immutabilite redevient MAXIMALEMENT STRICTE : les liens sont
--     figes des la premiere version de la ligne, plus aucune transition
--     n'est tolerable, meme NULL -> valeur ;
--   - la fonction est correcte QUELLE QUE SOIT la version du trigger
--     d'immutabilite reellement installee (stricte ou assouplie), ce qui
--     supprime toute dependance a l'ordre d'application des correctifs ;
--   - une etape d'ecriture en moins dans la transaction.
--
-- L'atomicite est inchangee : tout est dans une seule transaction ; si
-- une etape echoue, ni ecriture, ni mouvement, ni paiement ne subsiste.

create or replace function public.record_customer_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_treasury_account_type text,
  p_treasury_account_id uuid,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_doc public.invoices%rowtype;
  v_already numeric(14, 2);
  v_treasury_gl uuid;
  v_treasury_currency char(3);
  v_treasury_org uuid;
  v_receivable uuid;
  v_period_id uuid;
  v_period_status text;
  v_number text;
  v_entry_id uuid;
  v_movement_id uuid;
  v_payment_id uuid;
  v_date date;
  v_lines jsonb;
begin
  if p_amount is null or p_amount <= 0 then
    return jsonb_build_object('success', false, 'error', 'invalid_amount');
  end if;
  if p_treasury_account_type not in ('cash', 'bank', 'mobile_money') then
    return jsonb_build_object('success', false, 'error', 'invalid_treasury_account_type');
  end if;

  -- VERROU : serialise tout encaissement concurrent sur cette facture.
  select * into v_doc from public.invoices where id = p_invoice_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'invoice_not_found');
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_doc.organization_id, 'payment.record')) then
    perform app_private.write_audit_log(
      v_doc.organization_id, 'record_customer_payment', 'ventes', 'invoice', p_invoice_id,
      null, null, 'denied');
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  if v_doc.document_type <> 'INVOICE' then
    return jsonb_build_object('success', false, 'error', 'not_an_invoice');
  end if;
  if v_doc.status not in ('issued', 'partially_paid') then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  select coalesce(sum(amount), 0) into v_already
    from public.customer_payments
   where invoice_id = p_invoice_id and status = 'recorded';

  if v_already + p_amount > v_doc.total then
    perform app_private.write_audit_log(
      v_doc.organization_id, 'record_customer_payment', 'ventes', 'invoice', p_invoice_id,
      null,
      jsonb_build_object('reason', 'overpayment', 'already_paid', v_already,
                         'attempted', p_amount, 'invoice_total', v_doc.total),
      'denied');
    return jsonb_build_object(
      'success', false, 'error', 'overpayment',
      'already_paid', v_already, 'invoice_total', v_doc.total,
      'balance_due', v_doc.total - v_already);
  end if;

  if p_treasury_account_type = 'cash' then
    select gl_account_id, currency, organization_id into v_treasury_gl, v_treasury_currency, v_treasury_org
      from public.cash_accounts where id = p_treasury_account_id;
  elsif p_treasury_account_type = 'bank' then
    select gl_account_id, currency, organization_id into v_treasury_gl, v_treasury_currency, v_treasury_org
      from public.bank_accounts where id = p_treasury_account_id;
  else
    select gl_account_id, currency, organization_id into v_treasury_gl, v_treasury_currency, v_treasury_org
      from public.mobile_money_accounts where id = p_treasury_account_id;
  end if;

  if v_treasury_gl is null then
    return jsonb_build_object('success', false, 'error', 'treasury_account_not_found');
  end if;
  if v_treasury_org <> v_doc.organization_id then
    return jsonb_build_object('success', false, 'error', 'treasury_account_organization_mismatch');
  end if;
  if v_treasury_currency <> v_doc.currency then
    return jsonb_build_object('success', false, 'error', 'currency_mismatch');
  end if;

  select coalesce(t.receivable_account_id, o.default_receivable_account_id)
    into v_receivable
    from public.third_parties t
    join public.organizations o on o.id = t.organization_id
   where t.id = v_doc.third_party_id;
  if v_receivable is null then
    return jsonb_build_object('success', false, 'error', 'receivable_account_not_configured');
  end if;

  v_date := coalesce(p_payment_date, current_date);

  v_period_id := app_private.find_period_for_date(v_doc.organization_id, v_date);
  if v_period_id is null then
    return jsonb_build_object('success', false, 'error', 'no_accounting_period');
  end if;
  select status into v_period_status from public.accounting_periods where id = v_period_id;
  if v_period_status <> 'open' then
    perform app_private.write_audit_log(
      v_doc.organization_id, 'record_customer_payment', 'ventes', 'invoice', p_invoice_id,
      null, jsonb_build_object('reason', 'period_closed'), 'denied');
    return jsonb_build_object('success', false, 'error', 'period_closed');
  end if;

  v_number := app_private.next_number_internal(v_doc.organization_id, 'customer_payment');

  -- Identifiant genere EN AMONT : permet de creer l'ecriture et le
  -- mouvement avant le paiement, donc d'inserer celui-ci deja rattache.
  v_payment_id := gen_random_uuid();

  -- Ecriture : Dr Tresorerie / Cr Creances (auxiliaire client).
  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', v_treasury_gl,
      'debit', p_amount, 'credit', 0,
      'currency', v_doc.currency,
      'exchange_rate_to_htg', v_doc.exchange_rate_to_htg
    ),
    jsonb_build_object(
      'account_id', v_receivable,
      'debit', 0, 'credit', p_amount,
      'third_party_type', 'customer',
      'third_party_id', v_doc.third_party_id,
      'currency', v_doc.currency,
      'exchange_rate_to_htg', v_doc.exchange_rate_to_htg
    )
  );

  v_entry_id := app_private.post_document_journal_entry(
    v_doc.organization_id, 'CASH', v_date,
    'ENCAISSEMENT ' || v_number || ' / ' || coalesce(v_doc.document_number, ''),
    'invoice', v_payment_id, v_lines, v_actor);

  insert into public.cash_movements (
    organization_id, treasury_account_type, treasury_account_id, direction,
    amount, currency, exchange_rate_to_htg, movement_date,
    reference_type, reference_id, description, journal_entry_id,
    created_by, updated_by
  ) values (
    v_doc.organization_id, p_treasury_account_type, p_treasury_account_id, 'in',
    p_amount, v_doc.currency, v_doc.exchange_rate_to_htg, v_date,
    'invoice', p_invoice_id,
    'Encaissement ' || v_number || ' sur ' || coalesce(v_doc.document_number, ''), v_entry_id,
    v_actor, v_actor
  ) returning id into v_movement_id;

  -- Le paiement NAIT deja rattache : aucun UPDATE, donc aucune tension
  -- avec l'immutabilite. Le trigger de recalcul (AFTER INSERT) met a jour
  -- amount_paid et le statut de la facture.
  insert into public.customer_payments (
    id, organization_id, payment_number, invoice_id, third_party_id,
    payment_date, amount, currency, exchange_rate_to_htg,
    treasury_account_type, treasury_account_id, status, notes,
    journal_entry_id, cash_movement_id, created_by, updated_by
  ) values (
    v_payment_id, v_doc.organization_id, v_number, p_invoice_id, v_doc.third_party_id,
    v_date, p_amount, v_doc.currency, v_doc.exchange_rate_to_htg,
    p_treasury_account_type, p_treasury_account_id, 'recorded', p_notes,
    v_entry_id, v_movement_id, v_actor, v_actor
  );

  perform app_private.write_audit_log(
    v_doc.organization_id, 'record_customer_payment', 'ventes', 'invoice', p_invoice_id,
    null,
    jsonb_build_object('payment_number', v_number, 'amount', p_amount,
                       'journal_entry_id', v_entry_id, 'cash_movement_id', v_movement_id),
    'success');

  return jsonb_build_object(
    'success', true, 'payment_id', v_payment_id, 'payment_number', v_number,
    'journal_entry_id', v_entry_id, 'cash_movement_id', v_movement_id,
    'amount_paid', v_already + p_amount, 'balance_due', v_doc.total - (v_already + p_amount),
    'invoice_status', case
                        when v_already + p_amount >= v_doc.total then 'paid'
                        else 'partially_paid'
                      end);
end;
$$;

revoke all on function public.record_customer_payment(uuid, numeric, date, text, uuid, text) from public;
grant execute on function public.record_customer_payment(uuid, numeric, date, text, uuid, text) to authenticated;

-- =====================================================================
-- AUTO-VERIFICATION
-- =====================================================================
do $verify$
declare
  v_ok boolean;
begin
  select prosrc like '%v_payment_id := gen_random_uuid()%'
    into v_ok
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_customer_payment';

  if v_ok is null then
    raise exception 'ECHEC : public.record_customer_payment est introuvable.';
  end if;
  if not v_ok then
    raise exception 'ECHEC : le correctif structurel n''a PAS ete applique.';
  end if;

  raise notice 'OK : les liens comptables du paiement sont desormais poses des l''insertion.';
end;
$verify$;
