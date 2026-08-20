-- MedFinder Gestion — Phase 2C, jalon 2C.5B : releve client.
--
-- Prevu au plan (docs/phase-2c-plan.md §4.3) et non livre par les jalons
-- precedents ; livre ici pour fermer ce reste-a-faire de Phase 2C.
--
-- SOURCE : les DOCUMENTS et ENCAISSEMENTS reels (invoices,
-- customer_payments), c'est-a-dire l'etat documentaire effectivement
-- comptabilise — coherent par construction avec les ecritures generees en
-- 2C.3A/2C.3B, puisque chaque document emis et chaque encaissement porte
-- son ecriture. Le releve n'agrege JAMAIS journal_entry_lines
-- directement : le solde client doit refleter ce que le client doit sur
-- SES documents, pas un cumul de compte collectif qui melangerait tous
-- les tiers.
--
-- Conventions identiques aux 6 RPC d'etats financiers de Phase 2B :
-- security definer, search_path fixe, revoke public + grant authenticated,
-- refus renvoye en {success:false, error:'not_authorized'} plutot qu'en
-- exception (preserve la trace d'audit "denied").
--
-- Aucun identifiant d'organisation, aucun code de compte, aucun taux ni
-- aucune devise n'est code en dur.

create or replace function public.generate_customer_statement_report(
  p_org_id uuid,
  p_third_party_id uuid,
  p_period_start date,
  p_period_end date
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_tp record;
  v_opening numeric(14, 2);
  v_lines jsonb;
  v_total_debit numeric(14, 2);
  v_total_credit numeric(14, 2);
begin
  -- Autorisation : meme porte d'entree que les etats financiers 2B, ou
  -- la gestion de facturation. has_permission verifie d'abord
  -- is_active_member(acteur, p_org_id) — un p_org_id d'une autre
  -- organisation echoue donc avant tout acces (anti-IDOR).
  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, p_org_id, 'accounting.view')
          or app_private.has_permission(v_actor, p_org_id, 'invoice.manage')) then
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  if p_period_end < p_period_start then
    return jsonb_build_object('success', false, 'error', 'invalid_period');
  end if;

  select id, third_party_code, legal_name, tax_id, preferred_currency, is_customer, organization_id
    into v_tp
    from public.third_parties
   where id = p_third_party_id and organization_id = p_org_id;

  if not found then
    -- Couvre aussi le cas IDOR : un tiers d'une autre organisation est
    -- traite comme inexistant, sans jamais reveler son existence.
    return jsonb_build_object('success', false, 'error', 'third_party_not_found');
  end if;

  -- --- Solde d'ouverture : tout ce qui precede STRICTEMENT la periode.
  -- Facture emise = debit (le client doit) ; avoir = credit ;
  -- encaissement comptabilise = credit.
  select
    coalesce(sum(
      case
        when d.kind = 'INVOICE'     then d.amount
        when d.kind = 'CREDIT_NOTE' then -d.amount
        else -d.amount
      end
    ), 0)
    into v_opening
  from (
    select 'INVOICE'::text as kind, i.total as amount
      from public.invoices i
     where i.organization_id = p_org_id
       and i.third_party_id = p_third_party_id
       and i.document_type = 'INVOICE'
       and i.status in ('issued', 'partially_paid', 'paid')
       and i.document_date < p_period_start
    union all
    select 'CREDIT_NOTE', i.total
      from public.invoices i
     where i.organization_id = p_org_id
       and i.third_party_id = p_third_party_id
       and i.document_type = 'CREDIT_NOTE'
       and i.status in ('issued', 'partially_paid', 'paid')
       and i.document_date < p_period_start
    union all
    select 'PAYMENT', p.amount
      from public.customer_payments p
     where p.organization_id = p_org_id
       and p.third_party_id = p_third_party_id
       and p.status = 'recorded'
       and p.payment_date < p_period_start
  ) d;

  -- --- Mouvements de la periode, tries chronologiquement.
  select
    coalesce(jsonb_agg(m order by m.movement_date, m.reference), '[]'::jsonb),
    coalesce(sum(m.debit), 0),
    coalesce(sum(m.credit), 0)
    into v_lines, v_total_debit, v_total_credit
  from (
    select
      i.document_date as movement_date,
      i.document_number as reference,
      'INVOICE'::text as movement_type,
      coalesce(i.external_reference, '') as external_reference,
      i.currency,
      i.exchange_rate_to_htg,
      i.total as debit,
      0::numeric(14, 2) as credit,
      i.total_htg as amount_htg,
      i.status,
      i.due_date
    from public.invoices i
    where i.organization_id = p_org_id
      and i.third_party_id = p_third_party_id
      and i.document_type = 'INVOICE'
      and i.status in ('issued', 'partially_paid', 'paid')
      and i.document_date between p_period_start and p_period_end

    union all
    select
      i.document_date, i.document_number, 'CREDIT_NOTE',
      coalesce(i.credit_reason, ''), i.currency, i.exchange_rate_to_htg,
      0::numeric(14, 2), i.total, i.total_htg, i.status, i.due_date
    from public.invoices i
    where i.organization_id = p_org_id
      and i.third_party_id = p_third_party_id
      and i.document_type = 'CREDIT_NOTE'
      and i.status in ('issued', 'partially_paid', 'paid')
      and i.document_date between p_period_start and p_period_end

    union all
    select
      p.payment_date, p.payment_number, 'PAYMENT',
      coalesce(p.notes, ''), p.currency, p.exchange_rate_to_htg,
      0::numeric(14, 2), p.amount, p.amount_htg, p.status, null::date
    from public.customer_payments p
    where p.organization_id = p_org_id
      and p.third_party_id = p_third_party_id
      and p.status = 'recorded'
      and p.payment_date between p_period_start and p_period_end
  ) m;

  return jsonb_build_object(
    'success', true,
    'organization_id', p_org_id,
    'third_party', jsonb_build_object(
      'id', v_tp.id,
      'code', v_tp.third_party_code,
      'legal_name', v_tp.legal_name,
      'tax_id', v_tp.tax_id,
      'preferred_currency', v_tp.preferred_currency,
      'is_customer', v_tp.is_customer
    ),
    'period_start', p_period_start,
    'period_end', p_period_end,
    'opening_balance', v_opening,
    'lines', v_lines,
    'total_debit', v_total_debit,
    'total_credit', v_total_credit,
    'closing_balance', v_opening + v_total_debit - v_total_credit
  );
end;
$$;

revoke all on function public.generate_customer_statement_report(uuid, uuid, date, date) from public;
grant execute on function public.generate_customer_statement_report(uuid, uuid, date, date) to authenticated;

comment on function public.generate_customer_statement_report is
  'Releve client Phase 2C.5B : solde d''ouverture, mouvements de la '
  'periode (factures au debit, avoirs et encaissements au credit) et '
  'solde de cloture. Derive des documents et encaissements reellement '
  'comptabilises — jamais d''un cumul du compte collectif, qui '
  'melangerait tous les tiers.';

-- =====================================================================
-- AUTO-VERIFICATION
-- =====================================================================
do $verify$
declare
  v int;
begin
  select count(*) into v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'generate_customer_statement_report';
  if v <> 1 then
    raise exception 'ECHEC : generate_customer_statement_report absente.';
  end if;

  select count(*) into v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'generate_customer_statement_report'
     and not exists (
       select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg like 'search_path=%'
     );
  if v > 0 then
    raise exception 'ECHEC : search_path non fixe sur generate_customer_statement_report.';
  end if;

  select count(*) into v
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'generate_customer_statement_report'
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if v > 0 then
    raise exception 'ECHEC : la RPC est executable par anon.';
  end if;

  raise notice 'OK : releve client 2C.5B applique et verifie.';
end;
$verify$;
