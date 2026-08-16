-- MedFinder Gestion — Phase 1C-UI, complement export PDF PAPEJ
-- Ajoute organization_id/organization_name a la charge utile jsonb de
-- generate_papej_report() : l'export PDF (route app/api/papej/[grantId]/
-- rapport-pdf) doit afficher le nom de l'organisation sans requete
-- supplementaire fragile. Aucun changement de filtre ni de perimetre de
-- donnees — CREATE OR REPLACE strict, memes controles d'autorisation,
-- meme structure pour toutes les cles deja presentes.

create or replace function public.generate_papej_report(p_grant_id uuid, p_period_start date, p_period_end date)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_grant public.grants%rowtype;
  v_org_name text;
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

  select name into v_org_name from public.organizations where id = v_grant.organization_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'category', gbl.category,
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
    'organization_id', v_grant.organization_id,
    'organization_name', v_org_name,
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
  'planned_amount reconstruit par addition (disponible + engage + paye), '
  'algebriquement equivalent a budget_lines.planned_amount (formule sans '
  'double comptage de budget_line_available(), §4 du plan corrige). '
  'organization_id/organization_name ajoutes (20260816090011) pour '
  'l''export PDF (app/api/papej/[grantId]/rapport-pdf) sans requete '
  'supplementaire — aucun changement de filtre ni d''autorisation.';
