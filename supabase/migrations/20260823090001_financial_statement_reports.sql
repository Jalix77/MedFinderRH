-- MedFinder Gestion — Phase 2B — Etats financiers (docs/phase-2b-plan.md,
-- plan valide par Jean Alix Pierre le 17/08/2026, 13 ajustements integres).
-- Les 6 etats sont derives EXCLUSIVEMENT de journal_entries/
-- journal_entry_lines en statut 'posted' — jamais des modules metier
-- (expense_requests, grants, cash_movements) directement.

-- --- Extension minimale de schema : classification des flux de tresorerie
-- --- (§7 du plan) — configurable par compte, jamais codee en dur ---------

alter table public.chart_of_accounts
  add column cash_flow_category text
  check (cash_flow_category in ('operating', 'investing', 'financing'));

comment on column public.chart_of_accounts.cash_flow_category is
  'Classification du flux de tresorerie genere quand ce compte est la '
  'contrepartie d''une ecriture touchant un compte de tresorerie (methode '
  'directe, docs/phase-2b-plan.md §7). NULL = non classifie ; le rapport de '
  'flux de tresorerie place alors le mouvement dans UNCLASSIFIED, jamais une '
  'supposition. Jamais applique aux comptes de tresorerie eux-memes (ils '
  'sont mesures, jamais leur propre contrepartie).';

-- Classification proposee pour les 18 comptes seedes en 2A — point de
-- depart raisonnable, entierement modifiable ensuite par le comptable via
-- l'UI /comptabilite. N'affecte que les codes exacts deja seedes, jamais
-- un compte cree manuellement par ailleurs.
update public.chart_of_accounts set cash_flow_category = 'operating' where code in ('1100', '2100', '2900', '4000', '4010', '4900', '6000', '6100', '6200', '6800');
update public.chart_of_accounts set cash_flow_category = 'investing' where code in ('1500', '1510', '1590');
update public.chart_of_accounts set cash_flow_category = 'financing' where code in ('2200', '3000');
-- 1000/1010/1020 (tresorerie) et 3900 (resultat non affecte) restent NULL
-- intentionnellement : les comptes de tresorerie ne sont jamais leur propre
-- contrepartie, et 3900 n'est en pratique jamais touche directement par une
-- ecriture de tresorerie tant qu'aucune cloture formelle n'existe.

create or replace function app_private.seed_default_chart_of_accounts()
returns trigger
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  insert into public.chart_of_accounts (organization_id, code, label, type, cash_flow_category) values
    (new.id, '1000', 'Caisse',                                    'asset',     null),
    (new.id, '1010', 'Banque',                                    'asset',     null),
    (new.id, '1020', 'Mobile Money',                               'asset',     null),
    (new.id, '1100', 'Creances clients',                           'asset',     'operating'),
    (new.id, '1500', 'Immobilisations — materiel informatique',     'asset',     'investing'),
    (new.id, '1510', 'Immobilisations — materiel de bureau',        'asset',     'investing'),
    (new.id, '1590', 'Amortissements cumules',                      'asset',     'investing'),
    (new.id, '2100', 'Dettes fournisseurs',                         'liability', 'operating'),
    (new.id, '2200', 'Emprunt FDI',                                 'liability', 'financing'),
    (new.id, '2900', 'Fonds affectes (dons/subventions)',           'liability', 'operating'),
    (new.id, '3000', 'Capital / Apport fondateurs',                 'equity',    'financing'),
    (new.id, '3900', 'Resultat de l''exercice',                     'equity',    null),
    (new.id, '4000', 'Revenus — abonnements',                       'revenue',   'operating'),
    (new.id, '4010', 'Revenus — publicite/sponsoring',               'revenue',   'operating'),
    (new.id, '4900', 'Revenus PAPEJ',                                'revenue',   'operating'),
    (new.id, '6000', 'Charges — depenses operationnelles',           'expense',   'operating'),
    (new.id, '6100', 'Charges — paie',                               'expense',   'operating'),
    (new.id, '6200', 'Charges financieres — interets FDI',           'expense',   'operating'),
    (new.id, '6800', 'Dotations aux amortissements',                 'expense',   'operating')
  on conflict (organization_id, code) do nothing;

  return new;
end;
$$;

revoke execute on function app_private.seed_default_chart_of_accounts() from public;

-- --- Fonction centrale de signe par type de compte (§4/§5 du plan) -------
-- Testee directement (tests/unit) — jamais reimplementee localement par
-- une des 6 RPC ci-dessous.

create or replace function app_private.account_normal_balance_sign(p_type text)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select case when p_type in ('asset', 'expense') then 1::smallint else -1::smallint end;
$$;

revoke all on function app_private.account_normal_balance_sign(text) from public;
grant execute on function app_private.account_normal_balance_sign(text) to authenticated;

-- --- Fonction interne : compte de resultat (reutilisee par le bilan) -----
-- Aucune verification de permission ici (appelee soit par la RPC publique
-- deja gardee, soit en interne par le bilan) — jamais exposee directement.

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
      and je.entry_date between p_period_start and p_period_end
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
      and je.entry_date between p_period_start and p_period_end
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

-- --- Fonction interne : solde d'un ensemble de comptes a une date --------
-- Reutilisee par le grand livre (solde d'ouverture par compte) ET le flux
-- de tresorerie (tresorerie d'ouverture/de cloture) — jamais deux formules.

create or replace function app_private.compute_accounts_balance_as_of(
  p_org_id uuid, p_account_ids uuid[], p_as_of_date date
) returns numeric
language sql
stable
security definer
set search_path = public, app_private
as $$
  select coalesce(sum(jel.debit) - sum(jel.credit), 0)
  from public.journal_entry_lines jel
  join public.journal_entries je on je.id = jel.entry_id
  where jel.account_id = any(p_account_ids) and je.organization_id = p_org_id
    and je.status = 'posted' and je.entry_date < p_as_of_date;
$$;

revoke execute on function app_private.compute_accounts_balance_as_of(uuid, uuid[], date) from public;

-- --- RPC 1 : Journal general ----------------------------------------------
-- Filtre uniquement au niveau ecriture (periode/journal) — JAMAIS par
-- compte, pour que Sigma debit = Sigma credit reste toujours vrai sur le
-- perimetre retourne (§2 du plan — piege explicitement evite par
-- construction, pas documente comme exception a surveiller).

create or replace function public.generate_general_journal_report(
  p_org_id uuid, p_period_start date, p_period_end date, p_journal_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_lines jsonb;
  v_total_debit numeric(14, 2);
  v_total_credit numeric(14, 2);
begin
  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, p_org_id, 'accounting.view')) then
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'entry_number', je.entry_number, 'entry_date', je.entry_date,
      'journal_code', j.code, 'reference', coalesce(je.source_type || ':' || je.source_id::text, 'manuel'),
      'libelle', je.description, 'source_type', je.source_type,
      'account_code', a.code, 'account_label', a.label,
      'debit', jel.debit, 'credit', jel.credit,
      'cost_center_code', coalesce(cc.code, 'NON_AFFECTE')
    ) order by je.entry_date, je.entry_number), '[]'::jsonb),
    coalesce(sum(jel.debit), 0), coalesce(sum(jel.credit), 0)
  into v_lines, v_total_debit, v_total_credit
  from public.journal_entries je
  join public.journal_entry_lines jel on jel.entry_id = je.id
  join public.journals j on j.id = je.journal_id
  join public.chart_of_accounts a on a.id = jel.account_id
  left join public.cost_centers cc on cc.id = jel.cost_center_id
  where je.organization_id = p_org_id and je.status = 'posted'
    and je.entry_date between p_period_start and p_period_end
    and (p_journal_code is null or j.code = p_journal_code);

  return jsonb_build_object(
    'success', true, 'period_start', p_period_start, 'period_end', p_period_end,
    'journal_code', p_journal_code, 'lines', v_lines,
    'total_debit', v_total_debit, 'total_credit', v_total_credit,
    'is_balanced_scope', true -- filtre entier ecriture (periode/journal) : invariant toujours applicable
  );
end;
$$;

revoke all on function public.generate_general_journal_report(uuid, date, date, text) from public;
grant execute on function public.generate_general_journal_report(uuid, date, date, text) to authenticated;

-- --- RPC 2 : Grand livre ---------------------------------------------------

create or replace function public.generate_general_ledger_report(
  p_org_id uuid, p_period_start date, p_period_end date, p_account_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_accounts jsonb;
begin
  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, p_org_id, 'accounting.view')) then
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  select coalesce(jsonb_agg(acc order by acc->>'code'), '[]'::jsonb) into v_accounts
  from (
    select jsonb_build_object(
      'account_id', a.id, 'code', a.code, 'label', a.label, 'type', a.type,
      'opening_balance', app_private.compute_accounts_balance_as_of(p_org_id, array[a.id], p_period_start),
      'lines', coalesce(l.lines, '[]'::jsonb),
      'total_debit', coalesce(l.debit_sum, 0), 'total_credit', coalesce(l.credit_sum, 0),
      'closing_balance', app_private.compute_accounts_balance_as_of(p_org_id, array[a.id], p_period_start)
        + coalesce(l.debit_sum, 0) - coalesce(l.credit_sum, 0)
    ) as acc
    from public.chart_of_accounts a
    left join lateral (
      select
        jsonb_agg(jsonb_build_object(
          'entry_number', je.entry_number, 'entry_date', je.entry_date,
          'libelle', je.description, 'debit', jel.debit, 'credit', jel.credit
        ) order by je.entry_date, je.entry_number) as lines,
        sum(jel.debit) as debit_sum, sum(jel.credit) as credit_sum
      from public.journal_entry_lines jel
      join public.journal_entries je on je.id = jel.entry_id
      where jel.account_id = a.id and je.organization_id = p_org_id and je.status = 'posted'
        and je.entry_date between p_period_start and p_period_end
      having count(*) > 0
    ) l on true
    where a.organization_id = p_org_id
      and (p_account_id is null or a.id = p_account_id)
      and (p_account_id is not null or l.lines is not null) -- vue "tous les comptes" : uniquement ceux avec mouvement
  ) accs;

  return jsonb_build_object(
    'success', true, 'period_start', p_period_start, 'period_end', p_period_end, 'accounts', v_accounts
  );
end;
$$;

revoke all on function public.generate_general_ledger_report(uuid, date, date, uuid) from public;
grant execute on function public.generate_general_ledger_report(uuid, date, date, uuid) to authenticated;

-- --- RPC 3 : Balance generale ----------------------------------------------

create or replace function public.generate_trial_balance_report(
  p_org_id uuid, p_period_start date, p_period_end date
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_accounts jsonb;
  v_total_debit numeric(14, 2);
  v_total_credit numeric(14, 2);
  v_sum_solde_brut numeric(14, 2);
begin
  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, p_org_id, 'accounting.view')) then
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'account_id', a.id, 'code', a.code, 'label', a.label, 'type', a.type,
      'opening_balance', app_private.compute_accounts_balance_as_of(p_org_id, array[a.id], p_period_start),
      'period_debit', l.debit_sum, 'period_credit', l.credit_sum,
      'closing_balance_brut',
        app_private.compute_accounts_balance_as_of(p_org_id, array[a.id], p_period_start) + l.debit_sum - l.credit_sum,
      'closing_balance_normal',
        (app_private.compute_accounts_balance_as_of(p_org_id, array[a.id], p_period_start) + l.debit_sum - l.credit_sum)
          * app_private.account_normal_balance_sign(a.type),
      'sens', case when app_private.account_normal_balance_sign(a.type) *
        (app_private.compute_accounts_balance_as_of(p_org_id, array[a.id], p_period_start) + l.debit_sum - l.credit_sum) >= 0
        then (case when a.type in ('asset', 'expense') then 'debiteur' else 'crediteur' end)
        else (case when a.type in ('asset', 'expense') then 'crediteur' else 'debiteur' end)
      end
    ) order by a.code), '[]'::jsonb),
    coalesce(sum(l.debit_sum), 0), coalesce(sum(l.credit_sum), 0),
    coalesce(sum(
      app_private.compute_accounts_balance_as_of(p_org_id, array[a.id], p_period_start) + l.debit_sum - l.credit_sum
    ), 0)
  into v_accounts, v_total_debit, v_total_credit, v_sum_solde_brut
  from public.chart_of_accounts a
  join lateral (
    select coalesce(sum(jel.debit), 0) as debit_sum, coalesce(sum(jel.credit), 0) as credit_sum
    from public.journal_entry_lines jel
    join public.journal_entries je on je.id = jel.entry_id
    where jel.account_id = a.id and je.organization_id = p_org_id and je.status = 'posted'
      and je.entry_date between p_period_start and p_period_end
    having count(*) > 0
    union all
    -- Comptes avec un solde d'ouverture non nul mais aucun mouvement dans
    -- la periode : doivent quand meme apparaitre (solde de cloture = solde
    -- d'ouverture), sinon le grand livre et la balance divergeraient.
    select 0, 0
    where not exists (
      select 1 from public.journal_entry_lines jel2
      join public.journal_entries je2 on je2.id = jel2.entry_id
      where jel2.account_id = a.id and je2.organization_id = p_org_id and je2.status = 'posted'
        and je2.entry_date between p_period_start and p_period_end
    )
    and app_private.compute_accounts_balance_as_of(p_org_id, array[a.id], p_period_start) <> 0
    limit 1
  ) l on true
  where a.organization_id = p_org_id;

  return jsonb_build_object(
    'success', true, 'period_start', p_period_start, 'period_end', p_period_end,
    'accounts', v_accounts,
    'total_period_debit', v_total_debit, 'total_period_credit', v_total_credit,
    'sum_closing_balance_brut', v_sum_solde_brut
  );
end;
$$;

revoke all on function public.generate_trial_balance_report(uuid, date, date) from public;
grant execute on function public.generate_trial_balance_report(uuid, date, date) to authenticated;

-- --- RPC 4 : Compte de resultat (delegue a la fonction interne partagee) -

create or replace function public.generate_income_statement_report(
  p_org_id uuid, p_period_start date, p_period_end date, p_cost_center_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
begin
  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, p_org_id, 'accounting.view')) then
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  return jsonb_build_object('success', true) ||
    app_private.compute_income_statement(p_org_id, p_period_start, p_period_end, p_cost_center_id);
end;
$$;

revoke all on function public.generate_income_statement_report(uuid, date, date, uuid) from public;
grant execute on function public.generate_income_statement_report(uuid, date, date, uuid) to authenticated;

-- --- RPC 5 : Bilan (as_of_date, resultat non affecte via la RPC interne) -

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

  -- Resultat non affecte : borne strictement a l'exercice COURANT
  -- (debut d'exercice -> date demandee) — evite tout double comptage avec
  -- un exercice anterieur deja affecte aux capitaux propres par une
  -- ecriture reelle (§6 du plan) : ce calcul ne voit jamais les mouvements
  -- d'un exercice precedent, ils sont deja dans le solde poste des comptes
  -- de capitaux propres statutaires ci-dessous.
  v_income_statement := app_private.compute_income_statement(p_org_id, v_fiscal_year.start_date, p_as_of_date, null);
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

-- --- RPC 6 : Flux de tresorerie (methode directe, classification) --------

create or replace function public.generate_cash_flow_report(
  p_org_id uuid, p_period_start date, p_period_end date
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_treasury_ids uuid[];
  v_opening numeric(14, 2);
  v_closing numeric(14, 2);
  v_lines jsonb;
  v_operating numeric(14, 2);
  v_investing numeric(14, 2);
  v_financing numeric(14, 2);
  v_unclassified numeric(14, 2);
  v_internal_transfers numeric(14, 2);
begin
  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, p_org_id, 'accounting.view')) then
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  select coalesce(array_agg(gl_account_id), array[]::uuid[]) into v_treasury_ids
  from (
    select gl_account_id from public.cash_accounts where organization_id = p_org_id
    union
    select gl_account_id from public.bank_accounts where organization_id = p_org_id
    union
    select gl_account_id from public.mobile_money_accounts where organization_id = p_org_id
  ) t;

  v_opening := app_private.compute_accounts_balance_as_of(p_org_id, v_treasury_ids, p_period_start);

  -- Une ligne de mouvement par (ecriture, ligne de tresorerie) — la
  -- classification regarde les AUTRES lignes de la meme ecriture (les
  -- contreparties), jamais le compte de tresorerie lui-meme.
  with treasury_lines as (
    select jel.id as line_id, jel.entry_id, jel.debit, jel.credit, je.entry_number, je.entry_date, je.description
    from public.journal_entry_lines jel
    join public.journal_entries je on je.id = jel.entry_id
    where jel.account_id = any(v_treasury_ids) and je.organization_id = p_org_id and je.status = 'posted'
      and je.entry_date between p_period_start and p_period_end
  ),
  counterparties as (
    select tl.line_id, tl.entry_id, tl.debit, tl.credit, tl.entry_number, tl.entry_date, tl.description,
      -- true si CETTE contrepartie est elle-meme un compte de tresorerie (virement interne)
      bool_or(cp.account_id = any(v_treasury_ids)) as has_treasury_counterparty,
      array_agg(distinct coa.cash_flow_category) filter (where coa.account_id_is_not_treasury) as categories
    from treasury_lines tl
    join lateral (
      select jel2.account_id, jel2.account_id = any(v_treasury_ids) as is_also_treasury
      from public.journal_entry_lines jel2
      where jel2.entry_id = tl.entry_id and jel2.id <> tl.line_id
    ) cp on true
    join lateral (
      select a.cash_flow_category, not (cp.account_id = any(v_treasury_ids)) as account_id_is_not_treasury
      from public.chart_of_accounts a where a.id = cp.account_id
    ) coa on true
    group by tl.line_id, tl.entry_id, tl.debit, tl.credit, tl.entry_number, tl.entry_date, tl.description
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'entry_number', entry_number, 'entry_date', entry_date, 'libelle', description,
      'debit', debit, 'credit', credit,
      'category',
        case
          when has_treasury_counterparty then 'INTERNAL_TRANSFER'
          when array_length(categories, 1) = 1 and categories[1] is not null then categories[1]
          else 'UNCLASSIFIED'
        end
    ) order by entry_date, entry_number), '[]'::jsonb),
    coalesce(sum(case when not has_treasury_counterparty and array_length(categories,1)=1 and categories[1]='operating' then debit - credit else 0 end), 0),
    coalesce(sum(case when not has_treasury_counterparty and array_length(categories,1)=1 and categories[1]='investing' then debit - credit else 0 end), 0),
    coalesce(sum(case when not has_treasury_counterparty and array_length(categories,1)=1 and categories[1]='financing' then debit - credit else 0 end), 0),
    coalesce(sum(case when not has_treasury_counterparty and (categories[1] is null or array_length(categories,1) <> 1) then debit - credit else 0 end), 0),
    coalesce(sum(case when has_treasury_counterparty then debit - credit else 0 end), 0)
  into v_lines, v_operating, v_investing, v_financing, v_unclassified, v_internal_transfers
  from counterparties;

  v_closing := v_opening + v_operating + v_investing + v_financing + v_unclassified + v_internal_transfers;

  return jsonb_build_object(
    'success', true, 'period_start', p_period_start, 'period_end', p_period_end,
    'method', 'direct',
    'opening_balance', v_opening, 'closing_balance', v_closing,
    'operating', v_operating, 'investing', v_investing, 'financing', v_financing,
    'unclassified', v_unclassified, 'internal_transfers', v_internal_transfers,
    'net_change', v_operating + v_investing + v_financing + v_unclassified,
    'lines', v_lines
  );
end;
$$;

revoke all on function public.generate_cash_flow_report(uuid, date, date) from public;
grant execute on function public.generate_cash_flow_report(uuid, date, date) to authenticated;
