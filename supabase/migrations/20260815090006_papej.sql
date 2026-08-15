-- MedFinder Gestion — Phase 1C, sous-jalon 1C.5 — PAPEJ
-- Aucune permission supplementaire (papej.view/manage/report deja seedees
-- en Phase 1A).
--
-- Decision d'architecture (deviation mineure documentee vs le schema
-- indicatif de data-model.md §F, meme principe que les corrections
-- precedentes : reutiliser un mecanisme deja durci plutot qu'en dupliquer
-- un parallele) : une ligne budgetaire PAPEJ EST une ligne budgetaire
-- normale (public.budget_lines, budget.source_type='papej') — grant_budget_lines
-- est une couche de metadonnees 1:1 par-dessus, PAS un moteur d'engagement
-- parallele. Cela reutilise integralement commit_budget_line/
-- budget_line_available/le workflow depenses deja teste pour la
-- concurrence et l'absence de double comptage (1C.3/1C.4), plutot que de
-- reconstruire un systeme d'engagement PAPEJ specifique. Consequence :
-- pas de grant_expenses separee avec allocated_amount (allocation d'une
-- depense sur PLUSIEURS lignes) — chaque depense reste rattachee a UNE
-- ligne budgetaire (comme le reste du systeme). Documente comme dette
-- technique dans le rapport de cloture si un besoin d'allocation multi-
-- lignes emerge reellement.
--
-- amount_granted / amount_received : deux colonnes DISTINCTES en base
-- (§9 du plan corrige) — jamais supposees egales, jamais une constante
-- applicative.

create table public.grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  type text not null default 'PAPEJ' check (length(trim(type)) > 0),
  name text not null check (length(trim(name)) > 0),
  donor_name text,
  amount_granted numeric(14, 2) not null check (amount_granted >= 0),
  amount_received numeric(14, 2) not null default 0 check (amount_received >= 0),
  currency char(3) not null default 'HTG',
  received_date date,
  revenue_account_id uuid references public.chart_of_accounts (id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'closed')),
  agreement_document_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id)
);

comment on table public.grants is
  'amount_granted (accorde) et amount_received (effectivement recu, mis a '
  'jour uniquement par record_grant_receipt) restent deux colonnes '
  'distinctes — jamais supposees egales (§9 du plan corrige).';

create trigger set_updated_at
  before update on public.grants
  for each row execute function app_private.set_updated_at();

create index grants_org_idx on public.grants (organization_id);

alter table public.grants enable row level security;

create table public.grant_budget_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  grant_id uuid not null references public.grants (id) on delete cascade,
  budget_line_id uuid not null references public.budget_lines (id) on delete restrict unique,
  category text not null check (length(trim(category)) > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id)
);

comment on table public.grant_budget_lines is
  'Metadonnees 1:1 par-dessus budget_lines (voir note d''architecture en '
  'tete de migration). planned/engage/paye/disponible se lisent via '
  'budget_line_balances (1C.3) sur budget_line_id, pas ici.';

create trigger set_updated_at
  before update on public.grant_budget_lines
  for each row execute function app_private.set_updated_at();

create index grant_budget_lines_grant_idx on public.grant_budget_lines (grant_id);
create index grant_budget_lines_org_idx on public.grant_budget_lines (organization_id);

alter table public.grant_budget_lines enable row level security;

create table public.grant_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  grant_id uuid not null references public.grants (id) on delete cascade,
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  data jsonb not null,
  generated_by uuid references public.users (id),
  storage_path text,
  created_at timestamptz not null default now()
);

comment on table public.grant_reports is
  'data : instantane jsonb calcule par generate_papej_report() (par ligne : '
  'prevu/engage/paye/disponible + liste des depenses et leur statut de '
  'justification). storage_path reste NULL en Phase 1C — l''export PDF/'
  'Excel effectif (rendu de fichier) est une fonctionnalite d''interface, '
  'hors perimetre backend de cette phase (voir rapport de cloture).';

create index grant_reports_grant_idx on public.grant_reports (grant_id);
create index grant_reports_org_idx on public.grant_reports (organization_id);

alter table public.grant_reports enable row level security;

-- --- RPC : reception de financement (§9 du plan corrige) ------------------

create or replace function app_private.do_record_grant_receipt(
  p_grant_id uuid,
  p_amount numeric,
  p_received_date date,
  p_treasury_account_type text,
  p_treasury_account_id uuid,
  p_actor uuid
) returns uuid
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_grant public.grants%rowtype;
  v_journal_code text;
  v_treasury_gl_account_id uuid;
  v_new_entry_id uuid;
begin
  if p_amount <= 0 then
    raise exception 'Montant de reception invalide: %', p_amount;
  end if;
  if p_treasury_account_type not in ('cash', 'bank', 'mobile_money') then
    raise exception 'Type de compte de tresorerie invalide: %', p_treasury_account_type;
  end if;

  select * into v_grant from public.grants where id = p_grant_id for update;
  if not found then
    raise exception 'Financement % introuvable', p_grant_id;
  end if;
  if v_grant.revenue_account_id is null then
    raise exception 'Financement % sans compte comptable de produit configure — reception impossible', p_grant_id;
  end if;

  if p_treasury_account_type = 'cash' then
    v_journal_code := 'CASH';
    select gl_account_id into v_treasury_gl_account_id from public.cash_accounts
      where id = p_treasury_account_id and organization_id = v_grant.organization_id for update;
  elsif p_treasury_account_type = 'bank' then
    v_journal_code := 'BANK';
    select gl_account_id into v_treasury_gl_account_id from public.bank_accounts
      where id = p_treasury_account_id and organization_id = v_grant.organization_id for update;
  else
    v_journal_code := 'MISC';
    select gl_account_id into v_treasury_gl_account_id from public.mobile_money_accounts
      where id = p_treasury_account_id and organization_id = v_grant.organization_id for update;
  end if;
  if v_treasury_gl_account_id is null then
    raise exception 'Compte de tresorerie % introuvable pour cette organisation', p_treasury_account_id;
  end if;

  if p_treasury_account_type = 'cash' then
    update public.cash_accounts set current_balance = current_balance + p_amount where id = p_treasury_account_id;
  elsif p_treasury_account_type = 'bank' then
    update public.bank_accounts set current_balance = current_balance + p_amount where id = p_treasury_account_id;
  else
    update public.mobile_money_accounts set current_balance = current_balance + p_amount where id = p_treasury_account_id;
  end if;

  insert into public.cash_movements (
    organization_id, treasury_account_type, treasury_account_id, direction, amount,
    currency, movement_date, reference_type, reference_id, description, created_by, updated_by
  ) values (
    v_grant.organization_id, p_treasury_account_type, p_treasury_account_id, 'in', p_amount,
    v_grant.currency, p_received_date, 'grant', p_grant_id,
    'Reception financement ' || v_grant.name, p_actor, p_actor
  );

  v_new_entry_id := app_private.create_and_post_two_line_entry(
    v_grant.organization_id, v_journal_code, p_received_date,
    'Reception financement ' || v_grant.name, 'grant', p_grant_id,
    v_treasury_gl_account_id, v_grant.revenue_account_id,
    p_amount, v_grant.currency, 1, p_actor
  );

  update public.grants
     set amount_received = amount_received + p_amount,
         received_date = coalesce(received_date, p_received_date)
   where id = p_grant_id;

  perform app_private.write_audit_log(
    v_grant.organization_id, 'record_grant_receipt', 'papej', 'grant', p_grant_id,
    null, jsonb_build_object('amount', p_amount, 'journal_entry_id', v_new_entry_id), 'success'
  );

  return v_new_entry_id;
end;
$$;

revoke execute on function app_private.do_record_grant_receipt(uuid, numeric, date, text, uuid, uuid) from public;

create or replace function public.record_grant_receipt(
  p_grant_id uuid,
  p_amount numeric,
  p_received_date date,
  p_treasury_account_type text,
  p_treasury_account_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_org_id uuid;
  v_entry_id uuid;
begin
  select organization_id into v_org_id from public.grants where id = p_grant_id;
  if v_org_id is null then
    raise exception 'Financement % introuvable', p_grant_id;
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_org_id, 'papej.manage')) then
    perform app_private.write_audit_log(
      v_org_id, 'record_grant_receipt', 'papej', 'grant', p_grant_id,
      null, jsonb_build_object('amount', p_amount), 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  v_entry_id := app_private.do_record_grant_receipt(
    p_grant_id, p_amount, p_received_date, p_treasury_account_type, p_treasury_account_id, v_actor
  );

  return jsonb_build_object('success', true, 'journal_entry_id', v_entry_id);
end;
$$;

revoke all on function public.record_grant_receipt(uuid, numeric, date, text, uuid) from public;
grant execute on function public.record_grant_receipt(uuid, numeric, date, text, uuid) to authenticated;

-- --- RPC : creation d'une ligne budgetaire PAPEJ (cree budgets/budget_lines
-- --- + le lien grant_budget_lines de facon atomique) ----------------------

create or replace function public.create_grant_budget_line(
  p_grant_id uuid,
  p_category text,
  p_planned_amount numeric,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_grant public.grants%rowtype;
  v_budget_id uuid;
  v_line_id uuid;
  v_grant_line_id uuid;
  v_fiscal_year_id uuid;
begin
  select * into v_grant from public.grants where id = p_grant_id;
  if not found then
    raise exception 'Financement % introuvable', p_grant_id;
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_grant.organization_id, 'papej.manage')) then
    perform app_private.write_audit_log(
      v_grant.organization_id, 'create_grant_budget_line', 'papej', 'grant', p_grant_id,
      null, jsonb_build_object('category', p_category), 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;
  if p_planned_amount < 0 then
    raise exception 'Montant planifie invalide: %', p_planned_amount;
  end if;

  -- Reutilise/cree le budget PAPEJ de l'organisation (un seul budget
  -- source_type='papej' par organisation, cree a la demande).
  select id into v_budget_id from public.budgets
    where organization_id = v_grant.organization_id and source_type = 'papej' and source_id = p_grant_id;

  if v_budget_id is null then
    select id into v_fiscal_year_id from public.fiscal_years
      where organization_id = v_grant.organization_id and status = 'open'
      order by start_date desc limit 1;
    if v_fiscal_year_id is null then
      raise exception 'Aucun exercice comptable ouvert pour l''organisation % — creez-en un avant de configurer PAPEJ', v_grant.organization_id;
    end if;

    insert into public.budgets (organization_id, fiscal_year_id, name, status, source_type, source_id, created_by, updated_by)
    values (v_grant.organization_id, v_fiscal_year_id, 'Budget PAPEJ — ' || v_grant.name, 'approved', 'papej', p_grant_id, v_actor, v_actor)
    returning id into v_budget_id;
  end if;

  insert into public.budget_lines (organization_id, budget_id, category, planned_amount, currency, created_by, updated_by)
  values (v_grant.organization_id, v_budget_id, p_category, p_planned_amount, v_grant.currency, v_actor, v_actor)
  returning id into v_line_id;

  insert into public.grant_budget_lines (organization_id, grant_id, budget_line_id, category, notes, created_by, updated_by)
  values (v_grant.organization_id, p_grant_id, v_line_id, p_category, p_notes, v_actor, v_actor)
  returning id into v_grant_line_id;

  perform app_private.write_audit_log(
    v_grant.organization_id, 'create_grant_budget_line', 'papej', 'grant_budget_line', v_grant_line_id,
    null, jsonb_build_object('grant_id', p_grant_id, 'category', p_category, 'planned_amount', p_planned_amount), 'success'
  );

  return jsonb_build_object('success', true, 'grant_budget_line_id', v_grant_line_id, 'budget_line_id', v_line_id);
end;
$$;

revoke all on function public.create_grant_budget_line(uuid, text, numeric, text) from public;
grant execute on function public.create_grant_budget_line(uuid, text, numeric, text) to authenticated;

-- --- RPC : rapport PAPEJ (donnees, pas de rendu fichier — voir commentaire
-- --- sur grant_reports) ----------------------------------------------------

create or replace function public.generate_papej_report(p_grant_id uuid, p_period_start date, p_period_end date)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_grant public.grants%rowtype;
  v_lines jsonb;
  v_report jsonb;
  v_report_id uuid;
begin
  select * into v_grant from public.grants where id = p_grant_id;
  if not found then
    raise exception 'Financement % introuvable', p_grant_id;
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_grant.organization_id, 'papej.report')) then
    perform app_private.write_audit_log(
      v_grant.organization_id, 'generate_papej_report', 'papej', 'grant', p_grant_id,
      null, null, 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'category', gbl.category,
    -- planned = disponible + engage_actif + paye (formule sans double
    -- comptage de budget_line_available, §4 du plan corrige). "paye" ne
    -- compte QUE les statuts paid/justified/posted : un statut 'committed'
    -- est deja compte dans committed_open (son engagement est encore
    -- 'active'), l'inclure aussi ici le compterait deux fois.
    'planned_amount', b.available_amount + b.committed_open + coalesce(paid.amount, 0),
    'committed_open', b.committed_open,
    'available_amount', b.available_amount,
    'expenses', coalesce(display.expenses, '[]'::jsonb)
  )), '[]'::jsonb)
  into v_lines
  from public.grant_budget_lines gbl
  join public.budget_line_balances b on b.budget_line_id = gbl.budget_line_id
  left join lateral (
    select sum(exr.amount) as amount
    from public.expense_requests exr
    where exr.budget_line_id = gbl.budget_line_id
      and exr.status in ('paid', 'justified', 'posted')
      and exr.requested_date between p_period_start and p_period_end
  ) paid on true
  left join lateral (
    -- Liste d'affichage complete (tous les stades visibles, y compris
    -- 'committed') — distincte du calcul "paye" ci-dessus, qui doit rester
    -- limite aux montants effectivement decaisses pour ne pas fausser
    -- planned_amount.
    select jsonb_agg(jsonb_build_object(
      'expense_number', exr.expense_number,
      'payee_name', exr.payee_name,
      'amount', exr.amount,
      'status', exr.status,
      'justified', exr.status in ('justified', 'posted')
    )) as expenses
    from public.expense_requests exr
    where exr.budget_line_id = gbl.budget_line_id
      and exr.status in ('committed', 'paid', 'justified', 'posted')
      and exr.requested_date between p_period_start and p_period_end
  ) display on true
  where gbl.grant_id = p_grant_id;

  v_report := jsonb_build_object(
    'grant_id', p_grant_id,
    'grant_name', v_grant.name,
    'amount_granted', v_grant.amount_granted,
    'amount_received', v_grant.amount_received,
    'currency', v_grant.currency,
    'period_start', p_period_start,
    'period_end', p_period_end,
    'lines', v_lines
  );

  insert into public.grant_reports (organization_id, grant_id, period_start, period_end, data, generated_by)
  values (v_grant.organization_id, p_grant_id, p_period_start, p_period_end, v_report, v_actor)
  returning id into v_report_id;

  perform app_private.write_audit_log(
    v_grant.organization_id, 'generate_papej_report', 'papej', 'grant_report', v_report_id,
    null, jsonb_build_object('grant_id', p_grant_id), 'success'
  );

  return jsonb_build_object('success', true, 'report_id', v_report_id, 'report', v_report);
end;
$$;

revoke all on function public.generate_papej_report(uuid, date, date) from public;
grant execute on function public.generate_papej_report(uuid, date, date) to authenticated;

comment on function public.generate_papej_report is
  'planned_amount reconstruit par addition (disponible + engage + paye) '
  'plutot que lu directement sur budget_lines.planned_amount : evite une '
  'jointure supplementaire, algebriquement equivalent grace a la formule '
  'sans double comptage de budget_line_available() (§4 du plan corrige).';

-- --- Audit ------------------------------------------------------------

create trigger audit_grants
  after insert or update or delete on public.grants
  for each row execute function app_private.audit_row_trigger();

create trigger audit_grant_budget_lines
  after insert or update or delete on public.grant_budget_lines
  for each row execute function app_private.audit_row_trigger();

create trigger audit_grant_reports
  after insert or update or delete on public.grant_reports
  for each row execute function app_private.audit_row_trigger();

-- --- Grants et RLS ------------------------------------------------------

revoke all on public.grants, public.grant_budget_lines, public.grant_reports from anon;

-- amount_received/received_date : EXCLUS du grant UPDATE table-level (§9 du
-- plan corrige — "jamais supposes egaux, jamais une constante") — seule la
-- fonction record_grant_receipt() (SECURITY DEFINER, s'execute avec les
-- privileges du proprietaire de la table, non restreints par ce grant
-- colonne-par-colonne) peut les faire varier. Sans cette restriction, un
-- detenteur de papej.manage pourrait falsifier amount_received par un
-- UPDATE direct sans jamais passer par le mouvement de tresorerie ni
-- l'ecriture comptable correspondante.
grant select, insert on public.grants to authenticated;
grant update (name, donor_name, currency, type, amount_granted, status, agreement_document_path, revenue_account_id)
  on public.grants to authenticated;
revoke delete on public.grants from authenticated;

-- grant_budget_lines : creation exclusivement via create_grant_budget_line()
-- (doit creer budgets+budget_lines+grant_budget_lines de facon atomique) —
-- aucun INSERT direct.
grant select on public.grant_budget_lines to authenticated;
revoke insert, update, delete on public.grant_budget_lines from authenticated;

grant select on public.grant_reports to authenticated;
revoke insert, update, delete on public.grant_reports from authenticated;

create policy grants_select on public.grants
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'papej.view')
  );

create policy grants_insert on public.grants
  for insert to authenticated
  with check (
    (app_private.is_super_admin(auth.uid())
     or app_private.has_permission(auth.uid(), organization_id, 'papej.manage'))
    -- Un financement est toujours cree a 0 recu — seul record_grant_receipt()
    -- peut faire progresser amount_received (§9 du plan corrige).
    and amount_received = 0
  );

create policy grants_update on public.grants
  for update to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'papej.manage')
  )
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'papej.manage')
  );

create policy grant_budget_lines_select on public.grant_budget_lines
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'papej.view')
  );

create policy grant_reports_select on public.grant_reports
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'papej.view')
  );
