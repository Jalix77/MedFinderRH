-- MedFinder Gestion — Phase 2B — correctif : "Resultat non affecte" du
-- bilan etait borne a l'exercice COURANT (fiscal_year.start_date ->
-- p_as_of_date). Or, tant qu'aucune ecriture de cloture formelle n'existe,
-- des produits/charges d'un exercice ANTERIEUR peuvent rester non
-- affectes (jamais fermes) — les exclure casse l'identite
-- Actif = Passif + Capitaux Propres + Resultat non affecte, qui doit
-- rester vraie INCONDITIONNELLEMENT (consequence directe de l'invariant
-- debit=credit deja garanti au posting, docs/phase-2b-plan.md §4).
--
-- Trouve par test d'integration (pas par relecture) : sur l'organisation
-- de demonstration partagee, plusieurs exercices anterieurs non fermes
-- coexistent — le bilan ne balancait plus des qu'un seul d'entre eux
-- portait un solde de resultat non nul.
--
-- Correction : le "resultat non affecte" est desormais calcule SANS borne
-- de date basse (cumule depuis l'origine du grand livre jusqu'a
-- p_as_of_date) — ce qui reste correct et coherent avec §6 du plan :
-- une fois qu'un exercice anterieur EST reellement affecte par une
-- ecriture (debit du compte de revenu/charge, credit d'un compte de
-- capitaux propres), cette ecriture reduit elle-meme le solde cumule du
-- compte concerne — le retirant automatiquement du calcul, sans double
-- comptage et sans avoir besoin de connaitre la date de cette ecriture.
-- p_fiscal_year_id reste un parametre (verifie l'appartenance a
-- l'organisation, conserve pour le libelle "resultat de l'exercice"),
-- mais ne borne plus le calcul.

create or replace function app_private.compute_income_statement(
  p_org_id uuid, p_period_start date, p_period_end date, p_cost_center_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, app_private
as $$
declare
  v_revenues jsonb;
  v_expenses jsonb;
  v_total_revenue numeric(14, 2);
  v_total_expense numeric(14, 2);
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'account_id', a.id, 'code', a.code, 'label', a.label, 'amount', l.credit_sum - l.debit_sum
    ) order by a.code), '[]'::jsonb),
    coalesce(sum(l.credit_sum - l.debit_sum), 0)
  into v_revenues, v_total_revenue
  from public.chart_of_accounts a
  join lateral (
    select coalesce(sum(jel.debit), 0) as debit_sum, coalesce(sum(jel.credit), 0) as credit_sum
    from public.journal_entry_lines jel
    join public.journal_entries je on je.id = jel.entry_id
    where jel.account_id = a.id and je.organization_id = p_org_id and je.status = 'posted'
      and je.entry_date <= p_period_end
      and (p_period_start is null or je.entry_date >= p_period_start)
      and (p_cost_center_id is null or jel.cost_center_id = p_cost_center_id)
    having count(*) > 0
  ) l on true
  where a.organization_id = p_org_id and a.type = 'revenue';

  select coalesce(jsonb_agg(jsonb_build_object(
      'account_id', a.id, 'code', a.code, 'label', a.label, 'amount', l.debit_sum - l.credit_sum
    ) order by a.code), '[]'::jsonb),
    coalesce(sum(l.debit_sum - l.credit_sum), 0)
  into v_expenses, v_total_expense
  from public.chart_of_accounts a
  join lateral (
    select coalesce(sum(jel.debit), 0) as debit_sum, coalesce(sum(jel.credit), 0) as credit_sum
    from public.journal_entry_lines jel
    join public.journal_entries je on je.id = jel.entry_id
    where jel.account_id = a.id and je.organization_id = p_org_id and je.status = 'posted'
      and je.entry_date <= p_period_end
      and (p_period_start is null or je.entry_date >= p_period_start)
      and (p_cost_center_id is null or jel.cost_center_id = p_cost_center_id)
    having count(*) > 0
  ) l on true
  where a.organization_id = p_org_id and a.type = 'expense';

  return jsonb_build_object(
    'period_start', p_period_start, 'period_end', p_period_end,
    'revenues', v_revenues, 'expenses', v_expenses,
    'total_revenue', v_total_revenue, 'total_expense', v_total_expense,
    'net_result', v_total_revenue - v_total_expense
  );
end;
$$;

revoke execute on function app_private.compute_income_statement(uuid, date, date, uuid) from public;

create or replace function public.generate_balance_sheet_report(
  p_org_id uuid, p_fiscal_year_id uuid, p_as_of_date date
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_fiscal_year public.fiscal_years%rowtype;
  v_assets jsonb;
  v_liabilities jsonb;
  v_equity jsonb;
  v_total_assets numeric(14, 2);
  v_total_liabilities numeric(14, 2);
  v_total_equity numeric(14, 2);
  v_income_statement jsonb;
  v_unaffected_result numeric(14, 2);
begin
  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, p_org_id, 'accounting.view')) then
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  select * into v_fiscal_year from public.fiscal_years where id = p_fiscal_year_id and organization_id = p_org_id;
  if not found then
    return jsonb_build_object('success', false, 'error', 'fiscal_year_not_found');
  end if;

  -- Resultat non affecte : CUMULE depuis l'origine du grand livre jusqu'a
  -- la date demandee (p_period_start = null), pas seulement l'exercice
  -- courant — voir commentaire d'en-tete de cette migration.
  v_income_statement := app_private.compute_income_statement(p_org_id, null, p_as_of_date, null);
  v_unaffected_result := (v_income_statement->>'net_result')::numeric;

  select coalesce(jsonb_agg(jsonb_build_object(
      'account_id', a.id, 'code', a.code, 'label', a.label,
      'balance', app_private.compute_accounts_balance_as_of(p_org_id, array[a.id], p_as_of_date + 1)
    ) order by a.code), '[]'::jsonb),
    coalesce(sum(app_private.compute_accounts_balance_as_of(p_org_id, array[a.id], p_as_of_date + 1)), 0)
  into v_assets, v_total_assets
  from public.chart_of_accounts a
  where a.organization_id = p_org_id and a.type = 'asset'
    and app_private.compute_accounts_balance_as_of(p_org_id, array[a.id], p_as_of_date + 1) <> 0;

  select coalesce(jsonb_agg(jsonb_build_object(
      'account_id', a.id, 'code', a.code, 'label', a.label,
      'balance', -app_private.compute_accounts_balance_as_of(p_org_id, array[a.id], p_as_of_date + 1)
    ) order by a.code), '[]'::jsonb),
    coalesce(sum(-app_private.compute_accounts_balance_as_of(p_org_id, array[a.id], p_as_of_date + 1)), 0)
  into v_liabilities, v_total_liabilities
  from public.chart_of_accounts a
  where a.organization_id = p_org_id and a.type = 'liability'
    and app_private.compute_accounts_balance_as_of(p_org_id, array[a.id], p_as_of_date + 1) <> 0;

  select coalesce(jsonb_agg(jsonb_build_object(
      'account_id', a.id, 'code', a.code, 'label', a.label,
      'balance', -app_private.compute_accounts_balance_as_of(p_org_id, array[a.id], p_as_of_date + 1)
    ) order by a.code), '[]'::jsonb),
    coalesce(sum(-app_private.compute_accounts_balance_as_of(p_org_id, array[a.id], p_as_of_date + 1)), 0)
  into v_equity, v_total_equity
  from public.chart_of_accounts a
  where a.organization_id = p_org_id and a.type = 'equity'
    and app_private.compute_accounts_balance_as_of(p_org_id, array[a.id], p_as_of_date + 1) <> 0;

  return jsonb_build_object(
    'success', true, 'as_of_date', p_as_of_date, 'fiscal_year_id', p_fiscal_year_id,
    'assets', v_assets, 'liabilities', v_liabilities, 'equity', v_equity,
    'unaffected_result', v_unaffected_result,
    'total_assets', v_total_assets,
    'total_liabilities_and_equity', v_total_liabilities + v_total_equity + v_unaffected_result
  );
end;
$$;

revoke all on function public.generate_balance_sheet_report(uuid, uuid, date) from public;
grant execute on function public.generate_balance_sheet_report(uuid, uuid, date) to authenticated;
