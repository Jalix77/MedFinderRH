-- MedFinder Gestion — Phase 2C, jalon 2C.3B : encaissements clients,
-- soldes et mouvements de tresorerie.
--
-- PERIMETRE : encaissement d'une facture client emise. Aucun elargissement
-- (pas de reglement fournisseur, pas de rapprochement bancaire — 2D).
--
-- CHOIX STRUCTURANT : un paiement vise UNE facture. Toutes les exigences
-- du jalon (partiel, second paiement, final, solde, statuts) portent sur
-- UNE facture recevant PLUSIEURS paiements — jamais l'inverse. Ce choix
-- rend le lien paiement <-> facture <-> ecriture <-> mouvement EXACT et
-- non ambigu, sans table d'allocation.
--
-- NOTE sur journal_entries.source_type : la valeur 'invoice' est
-- reutilisee telle quelle, avec source_id = ID DU PAIEMENT (jamais celui
-- de la facture, qui porte deja l'ecriture d'emission). Aucune contrainte
-- CHECK existante n'est donc modifiee ni elargie, et l'index unique
-- d'idempotence livre en 2C.3A
-- (source_type, source_id) where reversed_entry_id is null
-- garantit AUTOMATIQUEMENT une seule ecriture d'origine par paiement.
-- Le lien explicite est porte par customer_payments.journal_entry_id.

-- =====================================================================
-- 1. Solde de la facture — derive du serveur, jamais fourni par le client
-- =====================================================================

alter table public.invoices
  add column amount_paid numeric(14, 2) not null default 0;

-- Garantie STRUCTURELLE anti-surpaiement : meme si une logique applicative
-- comportait un trou, la base refuserait un cumul superieur au total.
alter table public.invoices
  add constraint invoices_amount_paid_within_total
  check (amount_paid >= 0 and amount_paid <= total);

alter table public.invoices
  add column balance_due numeric(14, 2)
  generated always as (total - amount_paid) stored;

comment on column public.invoices.amount_paid is
  'Cumul des encaissements COMPTABILISES de la facture. Maintenu '
  'exclusivement par app_private.recalculate_invoice_payment_state() a '
  'partir de customer_payments en statut recorded — jamais fourni ni '
  'modifiable par un client. balance_due en derive par colonne generee.';

-- =====================================================================
-- 2. Encaissements
-- =====================================================================

create table public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  payment_number text not null,

  -- Lien EXACT : un paiement, une facture.
  invoice_id uuid not null references public.invoices (id) on delete restrict,
  third_party_id uuid not null references public.third_parties (id) on delete restrict,

  payment_date date not null default current_date,
  amount numeric(14, 2) not null check (amount > 0),

  -- Devise du paiement = devise de la facture (verifie par le RPC).
  currency char(3) not null check (currency in ('HTG', 'USD')),
  exchange_rate_to_htg numeric(14, 6) not null check (exchange_rate_to_htg > 0),
  amount_htg numeric(14, 2) generated always as (round(amount * exchange_rate_to_htg, 2)) stored,

  -- Compte de tresorerie choisi ; le compte comptable en est DEDUIT
  -- (gl_account_id), jamais code en dur.
  treasury_account_type text not null check (treasury_account_type in ('cash', 'bank', 'mobile_money')),
  treasury_account_id uuid not null,

  status text not null default 'recorded' check (status in ('recorded', 'cancelled')),

  -- Liens un-a-un : deux paiements ne peuvent jamais partager une
  -- ecriture ni un mouvement de tresorerie.
  journal_entry_id uuid unique references public.journal_entries (id) on delete restrict,
  cash_movement_id uuid unique references public.cash_movements (id) on delete restrict,

  notes text,
  cancelled_at timestamptz,
  cancelled_by uuid references public.users (id),
  cancel_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),

  unique (organization_id, payment_number),
  constraint customer_payments_htg_rate_is_one
    check (currency <> 'HTG' or exchange_rate_to_htg = 1),
  constraint customer_payments_cancel_reason_required
    check (status <> 'cancelled' or (cancel_reason is not null and length(trim(cancel_reason)) > 0))
);

create index customer_payments_org_idx on public.customer_payments (organization_id);
create index customer_payments_invoice_idx on public.customer_payments (invoice_id);
create index customer_payments_third_party_idx on public.customer_payments (third_party_id);
create index customer_payments_date_idx on public.customer_payments (organization_id, payment_date);
create index customer_payments_status_idx on public.customer_payments (organization_id, status);
create index customer_payments_treasury_idx on public.customer_payments (treasury_account_type, treasury_account_id);

create trigger set_updated_at
  before update on public.customer_payments
  for each row execute function app_private.set_updated_at();

create trigger audit_customer_payments
  after insert or update or delete on public.customer_payments
  for each row execute function app_private.audit_row_trigger();

alter table public.customer_payments enable row level security;

-- =====================================================================
-- 3. Recalcul du solde et du statut — logique SERVEUR verifiable
-- =====================================================================
-- amount_paid est TOUJOURS recalcule depuis la somme des encaissements
-- en statut 'recorded'. Il n'est jamais incremente aveuglement, ce qui le
-- rend verifiable a tout moment : amount_paid = sum(paiements recorded).

create or replace function app_private.recalculate_invoice_payment_state()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_invoice_id uuid := coalesce(new.invoice_id, old.invoice_id);
  v_total numeric(14, 2);
  v_paid numeric(14, 2);
  v_status text;
begin
  select total, status into v_total, v_status
    from public.invoices where id = v_invoice_id;
  if not found then
    return null;
  end if;

  select coalesce(sum(p.amount), 0) into v_paid
    from public.customer_payments p
   where p.invoice_id = v_invoice_id and p.status = 'recorded';

  -- Une facture annulee ou non emise ne voit jamais son statut recalcule.
  if v_status in ('draft', 'pending_issue', 'cancelled') then
    update public.invoices set amount_paid = v_paid where id = v_invoice_id;
    return null;
  end if;

  update public.invoices
     set amount_paid = v_paid,
         status = case
                    when v_paid <= 0 then 'issued'
                    when v_paid >= v_total then 'paid'
                    else 'partially_paid'
                  end
   where id = v_invoice_id;

  return null;
end;
$$;

revoke execute on function app_private.recalculate_invoice_payment_state() from public;

create trigger recalculate_invoice_payment_state
  after insert or update or delete on public.customer_payments
  for each row execute function app_private.recalculate_invoice_payment_state();

-- =====================================================================
-- 4. Immutabilite d'un encaissement comptabilise
-- =====================================================================

create or replace function app_private.customer_payments_immutable_once_recorded()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      'Encaissement % comptabilise — suppression interdite (annulation motivee avec contre-passation)',
      coalesce(old.payment_number, old.id::text);
  end if;

  if old.status = 'cancelled' then
    raise exception 'Encaissement % deja annule — aucune modification possible', old.payment_number;
  end if;

  if new.amount             is distinct from old.amount
     or new.invoice_id      is distinct from old.invoice_id
     or new.third_party_id  is distinct from old.third_party_id
     or new.payment_date    is distinct from old.payment_date
     or new.currency        is distinct from old.currency
     or new.exchange_rate_to_htg is distinct from old.exchange_rate_to_htg
     or new.treasury_account_type is distinct from old.treasury_account_type
     or new.treasury_account_id   is distinct from old.treasury_account_id
     or new.journal_entry_id is distinct from old.journal_entry_id
     or new.cash_movement_id is distinct from old.cash_movement_id
     or new.payment_number   is distinct from old.payment_number
     or new.organization_id  is distinct from old.organization_id
  then
    raise exception
      'Encaissement % comptabilise — contenu financier immuable (correction par annulation et contre-passation)',
      old.payment_number;
  end if;

  return new;
end;
$$;

revoke execute on function app_private.customer_payments_immutable_once_recorded() from public;

create trigger customer_payments_immutable_once_recorded
  before update or delete on public.customer_payments
  for each row execute function app_private.customer_payments_immutable_once_recorded();

-- =====================================================================
-- 5. Numerotation — moteur existant (5e application du meme patron)
-- =====================================================================

create or replace function app_private.seed_default_numbering_sequences()
returns trigger
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  insert into public.numbering_sequences (organization_id, entity_type, prefix_pattern, reset_rule)
  values
    (new.id, 'employee',         'EMP-{seq:04d}',        'never'),
    (new.id, 'journal_entry',    'JE-{year}-{seq:04d}',  'yearly'),
    (new.id, 'expense',          'DEP-{year}-{seq:04d}', 'yearly'),
    (new.id, 'third_party',      'TRS-{seq:04d}',        'never'),
    (new.id, 'customer_invoice', 'FAC-{year}-{seq:04d}', 'yearly'),
    (new.id, 'credit_note',      'AV-{year}-{seq:04d}',  'yearly'),
    (new.id, 'customer_payment', 'ENC-{year}-{seq:04d}', 'yearly')
  on conflict (organization_id, entity_type) do nothing;
  return new;
end;
$$;

insert into public.numbering_sequences (organization_id, entity_type, prefix_pattern, reset_rule)
select o.id, 'customer_payment', 'ENC-{year}-{seq:04d}', 'yearly'
from public.organizations o
where not exists (
  select 1 from public.numbering_sequences ns
  where ns.organization_id = o.id and ns.entity_type = 'customer_payment'
);

-- =====================================================================
-- 6. RLS — permissions existantes (payment.record / accounting.view)
-- =====================================================================

create policy customer_payments_select on public.customer_payments
  for select to authenticated
  using (
    app_private.is_super_admin((select auth.uid()))
    or app_private.has_permission((select auth.uid()), organization_id, 'payment.record')
    or app_private.has_permission((select auth.uid()), organization_id, 'accounting.view')
    or app_private.has_permission((select auth.uid()), organization_id, 'invoice.manage')
  );

-- Aucune policy INSERT / UPDATE / DELETE : les encaissements sont creees
-- et annulees EXCLUSIVEMENT par les RPC ci-dessous, jamais par ecriture
-- directe depuis un client.

-- =====================================================================
-- 7. RPC — encaissement atomique
-- =====================================================================
-- Sequence garantie dans UNE SEULE transaction :
--   validation -> verrou facture -> controle solde -> creation paiement
--   -> ecriture comptable -> cash_movement -> mise a jour solde/statut
-- Toute anomalie leve : rien ne subsiste.

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

  -- Seule une FACTURE EMISE est encaissable : ni brouillon, ni annulee,
  -- ni avoir.
  if v_doc.document_type <> 'INVOICE' then
    return jsonb_build_object('success', false, 'error', 'not_an_invoice');
  end if;
  if v_doc.status not in ('issued', 'partially_paid') then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  -- Controle du solde : surpaiement impossible (le verrou ci-dessus rend
  -- ce controle sur, y compris sous concurrence).
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
      'already_paid', v_already, 'invoice_total', v_doc.total, 'balance_due', v_doc.total - v_already);
  end if;

  -- Compte de tresorerie : le compte comptable est DEDUIT du compte
  -- choisi (gl_account_id), jamais code en dur.
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

  -- Devise : identique a celle de la facture (aucun paiement croise en
  -- Phase 2C), et coherente avec le compte de tresorerie.
  if v_treasury_currency <> v_doc.currency then
    return jsonb_build_object('success', false, 'error', 'currency_mismatch');
  end if;

  -- Compte client : meme cascade de resolution qu'a l'emission.
  select coalesce(t.receivable_account_id, o.default_receivable_account_id)
    into v_receivable
    from public.third_parties t
    join public.organizations o on o.id = t.organization_id
   where t.id = v_doc.third_party_id;
  if v_receivable is null then
    return jsonb_build_object('success', false, 'error', 'receivable_account_not_configured');
  end if;

  -- Periode comptable du PAIEMENT (sa propre date).
  v_period_id := app_private.find_period_for_date(v_doc.organization_id, coalesce(p_payment_date, current_date));
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

  -- Creation de l'encaissement. Le trigger de recalcul mettra a jour
  -- amount_paid / status ; la contrainte invoices_amount_paid_within_total
  -- interdit structurellement tout depassement.
  insert into public.customer_payments (
    organization_id, payment_number, invoice_id, third_party_id,
    payment_date, amount, currency, exchange_rate_to_htg,
    treasury_account_type, treasury_account_id, status, notes,
    created_by, updated_by
  ) values (
    v_doc.organization_id, v_number, p_invoice_id, v_doc.third_party_id,
    coalesce(p_payment_date, current_date), p_amount, v_doc.currency, v_doc.exchange_rate_to_htg,
    p_treasury_account_type, p_treasury_account_id, 'recorded', p_notes,
    v_actor, v_actor
  ) returning id into v_payment_id;

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

  -- source_id = ID DU PAIEMENT : l'index unique d'idempotence de 2C.3A
  -- garantit donc une seule ecriture d'origine par encaissement.
  v_entry_id := app_private.post_document_journal_entry(
    v_doc.organization_id, 'CASH', coalesce(p_payment_date, current_date),
    'ENCAISSEMENT ' || v_number || ' / ' || coalesce(v_doc.document_number, ''),
    'invoice', v_payment_id, v_lines, v_actor);

  -- Mouvement de tresorerie, dans la MEME transaction.
  insert into public.cash_movements (
    organization_id, treasury_account_type, treasury_account_id, direction,
    amount, currency, exchange_rate_to_htg, movement_date,
    reference_type, reference_id, description, journal_entry_id,
    created_by, updated_by
  ) values (
    v_doc.organization_id, p_treasury_account_type, p_treasury_account_id, 'in',
    p_amount, v_doc.currency, v_doc.exchange_rate_to_htg, coalesce(p_payment_date, current_date),
    'invoice', p_invoice_id,
    'Encaissement ' || v_number || ' sur ' || coalesce(v_doc.document_number, ''), v_entry_id,
    v_actor, v_actor
  ) returning id into v_movement_id;

  -- Liens un-a-un (colonnes UNIQUE : ni double ecriture ni double
  -- mouvement possibles pour un meme paiement).
  update public.customer_payments
     set journal_entry_id = v_entry_id, cash_movement_id = v_movement_id
   where id = v_payment_id;

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
-- 8. RPC — annulation d'un encaissement (contre-passation, jamais DELETE)
-- =====================================================================

create or replace function public.cancel_customer_payment(p_payment_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_pay public.customer_payments%rowtype;
  v_reversal jsonb;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    return jsonb_build_object('success', false, 'error', 'reason_required');
  end if;

  select * into v_pay from public.customer_payments where id = p_payment_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'payment_not_found');
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_pay.organization_id, 'payment.record')) then
    perform app_private.write_audit_log(
      v_pay.organization_id, 'cancel_customer_payment', 'ventes', 'invoice', v_pay.invoice_id,
      null, null, 'denied');
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  if v_pay.status <> 'recorded' then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  -- Annuler un encaissement comptabilise EST une contre-passation :
  -- accounting.reverse est requis, sans contourner le controle existant.
  if v_pay.journal_entry_id is not null then
    if not (app_private.is_super_admin(v_actor)
            or app_private.has_permission(v_actor, v_pay.organization_id, 'accounting.reverse')) then
      perform app_private.write_audit_log(
        v_pay.organization_id, 'cancel_customer_payment', 'ventes', 'invoice', v_pay.invoice_id,
        null, jsonb_build_object('reason', 'reverse_permission_required'), 'denied');
      return jsonb_build_object('success', false, 'error', 'not_authorized_reverse');
    end if;

    v_reversal := public.reverse_journal_entry(v_pay.journal_entry_id, p_reason);
    if not coalesce((v_reversal->>'success')::boolean, false) then
      return jsonb_build_object('success', false, 'error',
        coalesce(v_reversal->>'error', 'reversal_failed'));
    end if;
  end if;

  -- Le mouvement de tresorerie est neutralise par un mouvement inverse,
  -- jamais supprime (aucune reecriture de l'historique de tresorerie).
  if v_pay.cash_movement_id is not null then
    insert into public.cash_movements (
      organization_id, treasury_account_type, treasury_account_id, direction,
      amount, currency, exchange_rate_to_htg, movement_date,
      reference_type, reference_id, description, created_by, updated_by
    ) values (
      v_pay.organization_id, v_pay.treasury_account_type, v_pay.treasury_account_id, 'out',
      v_pay.amount, v_pay.currency, v_pay.exchange_rate_to_htg, current_date,
      'invoice', v_pay.invoice_id,
      'Annulation encaissement ' || v_pay.payment_number || ' — ' || p_reason,
      v_actor, v_actor
    );
  end if;

  update public.customer_payments
     set status = 'cancelled', cancel_reason = p_reason,
         cancelled_at = now(), cancelled_by = v_actor, updated_by = v_actor
   where id = p_payment_id;

  perform app_private.write_audit_log(
    v_pay.organization_id, 'cancel_customer_payment', 'ventes', 'invoice', v_pay.invoice_id,
    null, jsonb_build_object('payment_number', v_pay.payment_number, 'reason', p_reason), 'success');

  return jsonb_build_object('success', true, 'status', 'cancelled');
end;
$$;

revoke all on function public.cancel_customer_payment(uuid, text) from public;
grant execute on function public.cancel_customer_payment(uuid, text) to authenticated;

-- =====================================================================
-- 9. AUTO-VERIFICATION
-- =====================================================================
do $verify$
declare
  v int;
begin
  select count(*) into v from information_schema.columns
   where table_schema = 'public' and table_name = 'invoices'
     and column_name in ('amount_paid', 'balance_due');
  if v <> 2 then
    raise exception 'ECHEC : amount_paid / balance_due absents de public.invoices';
  end if;

  select count(*) into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('record_customer_payment', 'cancel_customer_payment');
  if v <> 2 then
    raise exception 'ECHEC : les RPC d''encaissement ne sont pas toutes creees';
  end if;

  select count(*) into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_private' and p.proname = 'post_document_journal_entry'
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
       or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v > 0 then
    raise exception 'ECHEC : le helper app_private est expose — confinement rompu';
  end if;

  raise notice 'OK : jalon 2C.3B applique et verifie.';
end;
$verify$;
