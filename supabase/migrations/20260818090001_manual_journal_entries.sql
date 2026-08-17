-- MedFinder Gestion — Phase 2A — Ecritures manuelles avec separation
-- saisie/validation obligatoire (docs/phase-2-plan.md §0.3/2A, decision
-- actee par Jean Alix Pierre le 17/08/2026).
--
-- Workflow : Draft -> Submitted -> Approved/Rejected -> Posted -> Reversed.
-- Le createur d'une ecriture manuelle ne peut jamais la valider lui-meme
-- (meme garde exacte que approve_expense_request en Phase 1C.4) ; exception
-- SoD formelle disponible (justification + validation DIRECTEUR_GENERAL/
-- SUPER_ADMIN + audit), mirror exact de request_expense_approval_exception/
-- validate_expense_approval_exception. Aucune nouvelle permission catalogue
-- (accounting.post couvre creation/soumission/approbation — la separation
-- est appliquee par verification d'acteur dans les RPC, pas par une
-- permission dediee, meme choix que expense.approve pour les depenses).
--
-- Les entrees automatiques (source_type 'expense'/'grant', creees par
-- app_private.create_and_post_two_line_entry) continuent d'aller
-- directement draft -> posted dans la meme transaction, EXACTEMENT comme
-- avant cette migration — seul app_private.post_journal_entry est elargi
-- pour accepter aussi le statut 'approved' (nouveau chemin manuel), son
-- comportement pour 'draft' reste identique bit pour bit.

-- --- journal_entries.status : elargi pour le workflow manuel ------------
-- Trouve dynamiquement le nom reel de la contrainte CHECK existante sur
-- "status" (auto-nommee par Postgres, jamais suppose a l'avance) avant de
-- la remplacer — plus robuste qu'un DROP CONSTRAINT par nom fixe.

do $$
declare
  v_constraint_name text;
begin
  select con.conname into v_constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'journal_entries'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%status%'
    and pg_get_constraintdef(con.oid) ilike '%draft%'
    and pg_get_constraintdef(con.oid) ilike '%posted%';

  if v_constraint_name is not null then
    execute format('alter table public.journal_entries drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table public.journal_entries
  add constraint journal_entries_status_check
  check (status in ('draft', 'submitted', 'approved', 'rejected', 'posted'));

comment on column public.journal_entries.status is
  'draft/posted : chemin automatique inchange (expense/grant, meme '
  'transaction). submitted/approved/rejected : chemin manuel uniquement '
  '(source_type=''manual''), separation saisie/validation obligatoire — '
  'voir journal_entry_approvals et docs/phase-2-plan.md §2A.';

-- --- journal_entry_approvals : mirror exact de expense_approvals --------

create table public.journal_entry_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  entry_id uuid not null references public.journal_entries (id) on delete cascade,
  approver_id uuid references public.users (id),
  decision text check (decision in ('approved', 'rejected')),
  decided_at timestamptz,
  comment text,
  -- Meme modele formel d'exception SoD que expense_approvals (§7 du plan
  -- 1C corrige, reconduit ici a l'identique).
  sod_rule_violated text check (sod_rule_violated in ('approver_is_creator')),
  exception_justification text,
  exception_requested_by uuid references public.users (id),
  exception_validated_by uuid references public.users (id),
  exception_validated_at timestamptz,
  exception_result text check (exception_result in ('approved', 'refused')),
  created_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  check (
    exception_requested_by is null
    or exception_validated_by is null
    or exception_requested_by <> exception_validated_by
  )
);

comment on table public.journal_entry_approvals is
  'Historique d''approbation des ecritures manuelles (source_type=''manual''). '
  'decision/decided_at restent NULL tant qu''une exception SoD est en '
  'attente de validation DG. Ecriture exclusivement via les RPC ci-dessous '
  '— aucun privilege table-level pour authenticated au-dela de SELECT.';

create index journal_entry_approvals_entry_idx on public.journal_entry_approvals (entry_id);
create index journal_entry_approvals_org_idx on public.journal_entry_approvals (organization_id);

alter table public.journal_entry_approvals enable row level security;

create trigger audit_journal_entry_approvals
  after insert or update or delete on public.journal_entry_approvals
  for each row execute function app_private.audit_row_trigger();

revoke all on public.journal_entry_approvals from anon;
grant select on public.journal_entry_approvals to authenticated;
revoke insert, update, delete on public.journal_entry_approvals from authenticated;

create policy journal_entry_approvals_select on public.journal_entry_approvals
  for select to authenticated
  using (
    app_private.is_super_admin((select auth.uid()))
    or app_private.has_permission((select auth.uid()), organization_id, 'accounting.view')
  );

-- --- app_private.post_journal_entry : elargi (draft -> aussi approved) --
-- Seul changement de comportement : le guard de statut. Tout le reste
-- (equilibre, periode ouverte, >=2 lignes, comptes valides/actifs/meme
-- organisation) reste rigoureusement identique — non-regression testee
-- explicitement (tests/integration/accounting-core.test.ts,
-- expenses.test.ts, papej.test.ts rejoues sans changement de resultat
-- attendu, docs/phase-2-plan.md §2A).

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
  if v_entry.status not in ('draft', 'approved') then
    raise exception 'Ecriture comptable % n''est pas en brouillon ni approuvee (statut: %)', p_entry_id, v_entry.status;
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

-- --- app_private.create_and_post_multi_line_entry : N lignes ------------
-- Meme role que create_and_post_two_line_entry (interne, jamais exposee a
-- authenticated) mais pour un nombre de lignes arbitraire (>=2) — usage
-- futur (2C factures multi-lignes). Reutilise app_private.post_journal_entry
-- pour l'invariant, aucune duplication.

create or replace function app_private.create_and_post_multi_line_entry(
  p_org_id uuid,
  p_journal_code text,
  p_entry_date date,
  p_description text,
  p_source_type text,
  p_source_id uuid,
  p_lines jsonb, -- [{account_id, debit, credit, cost_center_id?, third_party_type?, third_party_id?}, ...]
  p_currency char(3),
  p_exchange_rate numeric,
  p_actor uuid
) returns uuid
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_journal_id uuid;
  v_period_id uuid;
  v_entry_number text;
  v_entry_id uuid;
  v_line jsonb;
begin
  if jsonb_array_length(p_lines) < 2 then
    raise exception 'Ecriture multi-lignes : au moins 2 lignes requises (trouve: %)', jsonb_array_length(p_lines);
  end if;

  select id into v_journal_id from public.journals
    where organization_id = p_org_id and code = p_journal_code;
  if v_journal_id is null then
    raise exception 'Journal % introuvable pour l''organisation %', p_journal_code, p_org_id;
  end if;

  v_period_id := app_private.find_period_for_date(p_org_id, p_entry_date);
  if v_period_id is null then
    raise exception 'Aucune periode comptable configuree pour la date % (organisation %)', p_entry_date, p_org_id;
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
      organization_id, entry_id, account_id, debit, credit, cost_center_id,
      third_party_type, third_party_id, currency, exchange_rate_to_htg, created_by, updated_by
    ) values (
      p_org_id, v_entry_id, (v_line->>'account_id')::uuid,
      coalesce((v_line->>'debit')::numeric, 0), coalesce((v_line->>'credit')::numeric, 0),
      nullif(v_line->>'cost_center_id', '')::uuid,
      nullif(v_line->>'third_party_type', ''), nullif(v_line->>'third_party_id', '')::uuid,
      p_currency, p_exchange_rate, p_actor, p_actor
    );
  end loop;

  perform app_private.post_journal_entry(v_entry_id, p_actor);

  return v_entry_id;
end;
$$;

revoke execute on function app_private.create_and_post_multi_line_entry(
  uuid, text, date, text, text, uuid, jsonb, char(3), numeric, uuid
) from public;

-- --- RPC publique : creation d'un brouillon manuel -----------------------
-- Aucun equilibre exige a la creation (un brouillon desequilibre est
-- autorise, construction en cours — meme invariant deja teste sur le
-- chemin automatique, accounting-core.test.ts). Equilibre verifie
-- uniquement au posting, par post_journal_entry, jamais duplique ici.

create or replace function public.create_manual_journal_entry(
  p_org_id uuid,
  p_journal_code text,
  p_entry_date date,
  p_description text,
  p_lines jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_journal_id uuid;
  v_period_id uuid;
  v_entry_number text;
  v_entry_id uuid;
  v_line jsonb;
begin
  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, p_org_id, 'accounting.post')) then
    perform app_private.write_audit_log(
      p_org_id, 'create_manual_journal_entry', 'comptabilite', 'journal_entry', null,
      null, null, 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  if p_lines is null or jsonb_array_length(p_lines) < 2 then
    raise exception 'Ecriture manuelle : au moins 2 lignes requises';
  end if;

  select id into v_journal_id from public.journals
    where organization_id = p_org_id and code = p_journal_code;
  if v_journal_id is null then
    return jsonb_build_object('success', false, 'error', 'journal_not_found');
  end if;

  v_period_id := app_private.find_period_for_date(p_org_id, p_entry_date);
  if v_period_id is null then
    return jsonb_build_object('success', false, 'error', 'no_open_period');
  end if;

  v_entry_number := app_private.next_number_internal(p_org_id, 'journal_entry');

  insert into public.journal_entries (
    organization_id, journal_id, period_id, entry_number, entry_date,
    description, source_type, source_id, status, created_by, updated_by
  ) values (
    p_org_id, v_journal_id, v_period_id, v_entry_number, p_entry_date,
    p_description, 'manual', null, 'draft', v_actor, v_actor
  ) returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    insert into public.journal_entry_lines (
      organization_id, entry_id, account_id, debit, credit, cost_center_id,
      third_party_type, third_party_id, currency, exchange_rate_to_htg, created_by, updated_by
    ) values (
      p_org_id, v_entry_id, (v_line->>'account_id')::uuid,
      coalesce((v_line->>'debit')::numeric, 0), coalesce((v_line->>'credit')::numeric, 0),
      nullif(v_line->>'cost_center_id', '')::uuid,
      nullif(v_line->>'third_party_type', ''), nullif(v_line->>'third_party_id', '')::uuid,
      coalesce(v_line->>'currency', 'HTG'), coalesce((v_line->>'exchange_rate_to_htg')::numeric, 1),
      v_actor, v_actor
    );
  end loop;

  perform app_private.write_audit_log(
    p_org_id, 'create_manual_journal_entry', 'comptabilite', 'journal_entry', v_entry_id,
    null, jsonb_build_object('entry_number', v_entry_number), 'success'
  );

  return jsonb_build_object('success', true, 'entry_id', v_entry_id, 'entry_number', v_entry_number);
end;
$$;

revoke all on function public.create_manual_journal_entry(uuid, text, date, text, jsonb) from public;
grant execute on function public.create_manual_journal_entry(uuid, text, date, text, jsonb) to authenticated;

-- --- RPC publique : soumission -------------------------------------------
-- Permission accounting.post (identique a la creation) — n'importe quel
-- detenteur peut soumettre un brouillon manuel de son organisation (pas
-- restreint au createur : la garde SoD porte sur l'APPROBATION, pas la
-- soumission, cf. decision §0.3 du plan).

create or replace function public.submit_manual_journal_entry(p_entry_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_entry public.journal_entries%rowtype;
begin
  select * into v_entry from public.journal_entries where id = p_entry_id for update;
  if not found then
    raise exception 'Ecriture comptable % introuvable', p_entry_id;
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_entry.organization_id, 'accounting.post')) then
    perform app_private.write_audit_log(
      v_entry.organization_id, 'submit_manual_journal_entry', 'comptabilite', 'journal_entry', p_entry_id,
      null, null, 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  if v_entry.source_type <> 'manual' or v_entry.status <> 'draft' then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  update public.journal_entries set status = 'submitted' where id = p_entry_id;

  perform app_private.write_audit_log(
    v_entry.organization_id, 'submit_manual_journal_entry', 'comptabilite', 'journal_entry', p_entry_id,
    null, null, 'success'
  );

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.submit_manual_journal_entry(uuid) from public;
grant execute on function public.submit_manual_journal_entry(uuid) to authenticated;

-- --- RPC publique : approbation/rejet — separation saisie/validation ----
-- Refuse explicitement si l'acteur est le createur de l'ecriture (SoD),
-- meme garde exacte que approve_expense_request (§7 du plan 1C corrige).
-- SUPER_ADMIN reste exempte (coherent avec le mecanisme dependenses,
-- compte de secours).

create or replace function public.approve_manual_journal_entry(p_entry_id uuid, p_decision text, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_entry public.journal_entries%rowtype;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision invalide: %', p_decision;
  end if;

  select * into v_entry from public.journal_entries where id = p_entry_id for update;
  if not found then
    raise exception 'Ecriture comptable % introuvable', p_entry_id;
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_entry.organization_id, 'accounting.post')) then
    perform app_private.write_audit_log(
      v_entry.organization_id, 'approve_manual_journal_entry', 'comptabilite', 'journal_entry', p_entry_id,
      null, jsonb_build_object('decision', p_decision), 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  if v_entry.source_type <> 'manual' or v_entry.status <> 'submitted' then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  -- Separation des fonctions (§0.3 du plan Phase 2) : blocage strict ici,
  -- pas d'exception implicite. La seule voie pour un cas ou l'approbateur
  -- serait le createur est request_manual_entry_approval_exception() +
  -- validate_manual_entry_approval_exception() (validateur DG distinct).
  if v_entry.created_by = v_actor and not app_private.is_super_admin(v_actor) then
    perform app_private.write_audit_log(
      v_entry.organization_id, 'approve_manual_journal_entry', 'comptabilite', 'journal_entry', p_entry_id,
      null, jsonb_build_object('reason', 'self_approval_blocked'), 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'self_approval_blocked');
  end if;

  insert into public.journal_entry_approvals (
    organization_id, entry_id, approver_id, decision, decided_at, comment, created_by
  ) values (
    v_entry.organization_id, p_entry_id, v_actor, p_decision, now(), p_comment, v_actor
  );

  update public.journal_entries
     set status = case when p_decision = 'approved' then 'approved' else 'rejected' end
   where id = p_entry_id;

  perform app_private.write_audit_log(
    v_entry.organization_id, 'approve_manual_journal_entry', 'comptabilite', 'journal_entry', p_entry_id,
    null, jsonb_build_object('decision', p_decision), 'success'
  );

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.approve_manual_journal_entry(uuid, text, text) from public;
grant execute on function public.approve_manual_journal_entry(uuid, text, text) to authenticated;

-- --- RPC publique : exception SoD formelle (mirror expense) --------------

create or replace function public.request_manual_entry_approval_exception(
  p_entry_id uuid, p_justification text
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_entry public.journal_entries%rowtype;
begin
  select * into v_entry from public.journal_entries where id = p_entry_id;
  if not found then
    raise exception 'Ecriture comptable % introuvable', p_entry_id;
  end if;

  if v_entry.created_by <> v_actor then
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;
  if v_entry.source_type <> 'manual' or v_entry.status <> 'submitted' then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;
  if length(trim(coalesce(p_justification, ''))) = 0 then
    raise exception 'Une justification est obligatoire pour une exception de separation des fonctions';
  end if;

  insert into public.journal_entry_approvals (
    organization_id, entry_id, sod_rule_violated, exception_justification,
    exception_requested_by, created_by
  ) values (
    v_entry.organization_id, p_entry_id, 'approver_is_creator', p_justification, v_actor, v_actor
  );

  perform app_private.write_audit_log(
    v_entry.organization_id, 'request_manual_entry_approval_exception', 'comptabilite', 'journal_entry', p_entry_id,
    null, jsonb_build_object('justification', p_justification), 'success'
  );

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.request_manual_entry_approval_exception(uuid, text) from public;
grant execute on function public.request_manual_entry_approval_exception(uuid, text) to authenticated;

create or replace function public.validate_manual_entry_approval_exception(
  p_entry_id uuid, p_result text, p_comment text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_entry public.journal_entries%rowtype;
  v_pending public.journal_entry_approvals%rowtype;
begin
  if p_result not in ('approved', 'refused') then
    raise exception 'Resultat invalide: %', p_result;
  end if;

  select * into v_entry from public.journal_entries where id = p_entry_id for update;
  if not found then
    raise exception 'Ecriture comptable % introuvable', p_entry_id;
  end if;

  select * into v_pending from public.journal_entry_approvals
    where entry_id = p_entry_id and exception_result is null and exception_requested_by is not null
    order by created_at desc limit 1;
  if not found then
    return jsonb_build_object('success', false, 'error', 'no_pending_exception');
  end if;

  -- Validateur DG (ou SUPER_ADMIN) exige explicitement — meme garde que
  -- validate_expense_approval_exception (pas seulement accounting.post,
  -- qui inclurait des acteurs non habilites a arbitrer une exception SoD).
  if not (app_private.is_super_admin(v_actor)
          or app_private.has_role(v_actor, v_entry.organization_id, 'DIRECTEUR_GENERAL')) then
    perform app_private.write_audit_log(
      v_entry.organization_id, 'validate_manual_entry_approval_exception', 'comptabilite', 'journal_entry', p_entry_id,
      null, jsonb_build_object('reason', 'validator_must_be_dg'), 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'validator_must_be_dg');
  end if;

  if v_pending.exception_requested_by = v_actor then
    perform app_private.write_audit_log(
      v_entry.organization_id, 'validate_manual_entry_approval_exception', 'comptabilite', 'journal_entry', p_entry_id,
      null, jsonb_build_object('reason', 'self_validation_blocked'), 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'self_validation_blocked');
  end if;

  update public.journal_entry_approvals
     set approver_id = v_actor,
         decision = case when p_result = 'approved' then 'approved' else 'rejected' end,
         decided_at = now(),
         comment = p_comment,
         exception_validated_by = v_actor,
         exception_validated_at = now(),
         exception_result = p_result
   where id = v_pending.id;

  update public.journal_entries
     set status = case when p_result = 'approved' then 'approved' else 'rejected' end
   where id = p_entry_id;

  perform app_private.write_audit_log(
    v_entry.organization_id, 'validate_manual_entry_approval_exception', 'comptabilite', 'journal_entry', p_entry_id,
    null, jsonb_build_object('result', p_result), 'success'
  );

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.validate_manual_entry_approval_exception(uuid, text, text) from public;
grant execute on function public.validate_manual_entry_approval_exception(uuid, text, text) to authenticated;
