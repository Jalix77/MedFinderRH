-- MedFinder Gestion — Phase 1C, sous-jalon 1C.4 — Depenses
-- Aucune permission supplementaire (expense.* deja seedee en Phase 1A).
-- Aucune table/permission fournisseur (§2 du plan corrige) : payee_name/
-- payee_reference sont des champs transitoires, remplaces par une FK
-- supplier_id quand le vrai module Fournisseurs sera construit (forme des
-- donnees deja compatible, aucune migration destructive prevue).
--
-- Workflow (accounting-design.md §4, tel qu'approuve) :
--   draft -[submit]-> submitted -[approve]-> committed (engagement
--   budgetaire automatique) -[pay]-> paid -[justify]-> justified -> posted
--   (comptabilisation automatique). submitted -[reject]-> rejected.
--   submitted/committed -[cancel]-> cancelled (motivee, engagement libere).
-- Aucune creation directe en Paid/Posted ; aucune transition via UPDATE
-- direct — toutes les transitions passent par les RPC ci-dessous (§8 du
-- plan corrige). expense_requests n'a AUCUN privilege UPDATE pour
-- "authenticated" : seul un SECURITY DEFINER peut faire progresser le
-- statut.

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  default_account_id uuid references public.chart_of_accounts (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  unique (organization_id, name)
);

create trigger set_updated_at
  before update on public.expense_categories
  for each row execute function app_private.set_updated_at();

create index expense_categories_org_idx on public.expense_categories (organization_id);

alter table public.expense_categories enable row level security;

create table public.expense_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  expense_number text not null,
  requester_id uuid not null references public.users (id),
  category_id uuid references public.expense_categories (id) on delete restrict,
  cost_center_id uuid references public.cost_centers (id) on delete set null,
  budget_line_id uuid not null references public.budget_lines (id) on delete restrict,
  payee_name text not null check (length(trim(payee_name)) > 0),
  payee_reference text,
  description text,
  amount numeric(14, 2) not null check (amount > 0),
  currency char(3) not null default 'HTG',
  requested_date date not null default current_date,
  payment_method text not null check (payment_method in ('cash', 'bank', 'mobile_money')),
  status text not null default 'draft' check (status in
    ('draft', 'submitted', 'approved', 'rejected', 'committed', 'paid', 'justified', 'posted', 'cancelled')),
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  unique (organization_id, expense_number)
);

comment on table public.expense_requests is
  'payee_name/payee_reference : champs transitoires en attendant le module '
  'Fournisseurs (hors perimetre Phase 1C, §2 du plan corrige). Aucun '
  'privilege UPDATE pour "authenticated" — toute transition de statut passe '
  'par une RPC (submit/approve/reject/cancel/pay/justify_expense_request).';

create trigger set_updated_at
  before update on public.expense_requests
  for each row execute function app_private.set_updated_at();

create index expense_requests_org_idx on public.expense_requests (organization_id);
create index expense_requests_requester_idx on public.expense_requests (requester_id);
create index expense_requests_budget_line_idx on public.expense_requests (budget_line_id);
create index expense_requests_status_idx on public.expense_requests (status);

alter table public.expense_requests enable row level security;

create table public.expense_approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  expense_id uuid not null references public.expense_requests (id) on delete cascade,
  approver_id uuid references public.users (id),
  decision text check (decision in ('approved', 'rejected')),
  decided_at timestamptz,
  comment text,
  -- Modele formel de l'exception de separation des fonctions (§7 du plan
  -- corrige) — remplace un simple is_exception+exception_reason. Rempli
  -- uniquement quand l'approbateur normal serait le demandeur lui-meme.
  sod_rule_violated text check (sod_rule_violated in ('approver_is_requester')),
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

comment on table public.expense_approvals is
  'decision/decided_at restent NULL tant qu''une exception SoD est en '
  'attente de validation DG (request_expense_approval_exception cree la '
  'ligne, validate_expense_approval_exception la complete). Contrainte '
  'CHECK : une personne ne peut jamais etre a la fois demandeur et '
  'validateur de sa propre exception.';

create index expense_approvals_expense_idx on public.expense_approvals (expense_id);
create index expense_approvals_org_idx on public.expense_approvals (organization_id);

alter table public.expense_approvals enable row level security;

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  expense_request_id uuid not null references public.expense_requests (id) on delete restrict unique,
  paid_by uuid not null references public.users (id),
  paid_date date not null default current_date,
  treasury_account_type text not null check (treasury_account_type in ('cash', 'bank', 'mobile_money')),
  treasury_account_id uuid not null,
  commitment_id uuid references public.budget_commitments (id),
  no_commitment_reason text,
  journal_entry_id uuid references public.journal_entries (id),
  created_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  check (commitment_id is not null or no_commitment_reason is not null)
);

comment on table public.expenses is
  'Paiement effectif — une ligne par expense_request (unique). '
  'commitment_id : engagement consomme (cas normal). Si NULL, un paiement '
  'hors engagement exceptionnel a ete explicitement autorise '
  '(no_commitment_reason obligatoire, verifie par le CHECK) — voir §3/§4 du '
  'plan corrige. journal_entry_id reste NULL jusqu''a justify_expense_request '
  '(comptabilisation apres justificatif, pas au paiement — accounting-'
  'design.md §4).';

create index expenses_org_idx on public.expenses (organization_id);
create index expenses_commitment_idx on public.expenses (commitment_id);

alter table public.expenses enable row level security;

create table public.expense_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  expense_request_id uuid not null references public.expense_requests (id) on delete cascade,
  type text not null check (type in ('facture', 'recu', 'justificatif')),
  storage_path text not null unique,
  original_filename text not null,
  uploaded_by uuid references public.users (id),
  created_at timestamptz not null default now()
);

create index expense_attachments_expense_idx on public.expense_attachments (expense_request_id);
create index expense_attachments_org_idx on public.expense_attachments (organization_id);

alter table public.expense_attachments enable row level security;

-- --- Acces (metadonnees + storage), meme patron que can_access_employee_documents

create or replace function app_private.can_access_expense(p_org_id uuid, p_expense_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, app_private
as $$
begin
  if app_private.is_super_admin(auth.uid()) then
    return true;
  end if;
  if app_private.has_permission(auth.uid(), p_org_id, 'expense.view') then
    return true;
  end if;
  return exists (
    select 1 from public.expense_requests er
    where er.id = p_expense_id and er.organization_id = p_org_id and er.requester_id = auth.uid()
  );
end;
$$;

revoke execute on function app_private.can_access_expense(uuid, uuid) from public;
grant execute on function app_private.can_access_expense(uuid, uuid) to authenticated;

-- --- Aide : verifie l'appartenance a un role systeme donne (utilise pour
-- --- exiger un validateur DG sur l'exception SoD, §7 du plan corrige) ----

create or replace function app_private.has_role(p_user_id uuid, p_org_id uuid, p_role_code text)
returns boolean
language sql
stable
security definer
set search_path = public, app_private
as $$
  select exists (
    select 1
    from public.memberships m
    join public.membership_roles mr on mr.membership_id = m.id
    join public.roles r on r.id = mr.role_id
    where m.user_id = p_user_id
      and m.organization_id = p_org_id
      and m.status = 'active'
      and r.code = p_role_code
  );
$$;

revoke execute on function app_private.has_role(uuid, uuid, text) from public;

-- --- Numerotation : ajout du type 'expense' -------------------------------

create or replace function app_private.seed_default_numbering_sequences()
returns trigger
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  insert into public.numbering_sequences (organization_id, entity_type, prefix_pattern, reset_rule)
  values
    (new.id, 'employee', 'EMP-{seq:04d}', 'never'),
    (new.id, 'journal_entry', 'JE-{year}-{seq:04d}', 'yearly'),
    (new.id, 'expense', 'DEP-{year}-{seq:04d}', 'yearly')
  on conflict (organization_id, entity_type) do nothing;

  return new;
end;
$$;

insert into public.numbering_sequences (organization_id, entity_type, prefix_pattern, reset_rule)
select o.id, 'expense', 'DEP-{year}-{seq:04d}', 'yearly'
from public.organizations o
where not exists (
  select 1 from public.numbering_sequences ns
  where ns.organization_id = o.id and ns.entity_type = 'expense'
);

-- --- Complete la formule du disponible budgetaire (§4 du plan corrige) ---
-- Ajoute les 2 termes "paye" qui n'existaient pas avant qu'"expenses" ne
-- soit cree (1C.3 ne calculait que planned - engage actif). Cette
-- redefinition prend effet dans la MEME migration qui introduit le seul
-- chemin ('pay_expense_request') capable de faire passer un engagement a
-- 'consumed' — aucune fenetre ou l'ancienne formule partielle pourrait
-- sous-evaluer un engagement deja paye.

create or replace function app_private.budget_line_available(p_budget_line_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, app_private
as $$
  select bl.planned_amount
    - coalesce((
        select sum(bc.amount) from public.budget_commitments bc
        where bc.budget_line_id = bl.id and bc.status = 'active'
      ), 0)
    - coalesce((
        -- paye SUR engagement : le commitment est deja passe a 'consumed'
        -- (donc deja retire de la somme "actif" ci-dessus) — compte ici
        -- UNE seule fois, jamais dans les deux sommes simultanement.
        select sum(e.commitment_amount)
        from (
          select ex.id, bc2.amount as commitment_amount
          from public.expenses ex
          join public.budget_commitments bc2 on bc2.id = ex.commitment_id
          where bc2.budget_line_id = bl.id
        ) e
      ), 0)
    - coalesce((
        -- paye HORS engagement, exceptionnel (§3/§4 du plan corrige).
        select sum(ex.paid_amount)
        from (
          select exr.amount as paid_amount
          from public.expenses ex2
          join public.expense_requests exr on exr.id = ex2.expense_request_id
          where ex2.commitment_id is null and exr.budget_line_id = bl.id
        ) ex
      ), 0)
  from public.budget_lines bl
  where bl.id = p_budget_line_id;
$$;

comment on function app_private.budget_line_available is
  'Formule complete (§4 du plan corrige) : planned - engage_actif - '
  'paye_sur_engagement - paye_hors_engagement. Aucun double comptage : un '
  'engagement consomme sort de la somme "actif" au meme instant ou son '
  'montant apparait dans "paye_sur_engagement" (jamais les deux a la fois).';

-- --- RPC : soumission -----------------------------------------------------

create or replace function public.submit_expense_request(p_expense_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_expense public.expense_requests%rowtype;
begin
  select * into v_expense from public.expense_requests where id = p_expense_id for update;
  if not found then
    raise exception 'Demande de depense % introuvable', p_expense_id;
  end if;

  if v_expense.requester_id <> v_actor and not app_private.is_super_admin(v_actor) then
    perform app_private.write_audit_log(
      v_expense.organization_id, 'submit_expense_request', 'finance', 'expense_request', p_expense_id,
      null, null, 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  if v_expense.status <> 'draft' then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  update public.expense_requests set status = 'submitted' where id = p_expense_id;

  perform app_private.write_audit_log(
    v_expense.organization_id, 'submit_expense_request', 'finance', 'expense_request', p_expense_id,
    jsonb_build_object('status', 'draft'), jsonb_build_object('status', 'submitted'), 'success'
  );

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.submit_expense_request(uuid) from public;
grant execute on function public.submit_expense_request(uuid) to authenticated;

-- --- RPC : approbation (chemin normal, approbateur != demandeur) --------

create or replace function app_private.do_approve_expense(
  p_expense_id uuid, p_decision text, p_comment text, p_approver uuid
) returns void
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_expense public.expense_requests%rowtype;
  v_commitment_id uuid;
begin
  select * into v_expense from public.expense_requests where id = p_expense_id for update;
  if not found then
    raise exception 'Demande de depense % introuvable', p_expense_id;
  end if;
  if v_expense.status <> 'submitted' then
    raise exception 'Demande de depense % n''est pas soumise (statut: %)', p_expense_id, v_expense.status;
  end if;

  insert into public.expense_approvals (
    organization_id, expense_id, approver_id, decision, decided_at, comment, created_by
  ) values (
    v_expense.organization_id, p_expense_id, p_approver, p_decision, now(), p_comment, p_approver
  );

  if p_decision = 'rejected' then
    update public.expense_requests set status = 'rejected' where id = p_expense_id;
    perform app_private.write_audit_log(
      v_expense.organization_id, 'approve_expense_request', 'finance', 'expense_request', p_expense_id,
      null, jsonb_build_object('decision', 'rejected'), 'success'
    );
    return;
  end if;

  -- Approuve -> engagement budgetaire immediat (accounting-design.md §4 :
  -- "Approved --> Committed" est une transition automatique, pas une
  -- action manuelle distincte).
  v_commitment_id := app_private.commit_budget_line(
    v_expense.budget_line_id, 'expense_request', p_expense_id, v_expense.amount, p_approver
  );

  update public.expense_requests set status = 'committed' where id = p_expense_id;

  perform app_private.write_audit_log(
    v_expense.organization_id, 'approve_expense_request', 'finance', 'expense_request', p_expense_id,
    null, jsonb_build_object('decision', 'approved', 'commitment_id', v_commitment_id), 'success'
  );
end;
$$;

revoke execute on function app_private.do_approve_expense(uuid, text, text, uuid) from public;

create or replace function public.approve_expense_request(p_expense_id uuid, p_decision text, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_org_id uuid;
  v_requester_id uuid;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision invalide: %', p_decision;
  end if;

  select organization_id, requester_id into v_org_id, v_requester_id
    from public.expense_requests where id = p_expense_id;
  if v_org_id is null then
    raise exception 'Demande de depense % introuvable', p_expense_id;
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_org_id, 'expense.approve')) then
    perform app_private.write_audit_log(
      v_org_id, 'approve_expense_request', 'finance', 'expense_request', p_expense_id,
      null, jsonb_build_object('decision', p_decision), 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  -- Separation des fonctions (§7 du plan corrige) : blocage strict ici, pas
  -- d'exception implicite. La seule voie pour un cas ou l'approbateur
  -- serait le demandeur est request_expense_approval_exception() +
  -- validate_expense_approval_exception() (validateur DG distinct).
  if v_requester_id = v_actor and not app_private.is_super_admin(v_actor) then
    perform app_private.write_audit_log(
      v_org_id, 'approve_expense_request', 'finance', 'expense_request', p_expense_id,
      null, jsonb_build_object('reason', 'self_approval_blocked'), 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'self_approval_blocked');
  end if;

  perform app_private.do_approve_expense(p_expense_id, p_decision, p_comment, v_actor);

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.approve_expense_request(uuid, text, text) from public;
grant execute on function public.approve_expense_request(uuid, text, text) to authenticated;

-- --- RPC : exception SoD formelle (§7 du plan corrige) --------------------

create or replace function public.request_expense_approval_exception(
  p_expense_id uuid, p_justification text
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_expense public.expense_requests%rowtype;
begin
  select * into v_expense from public.expense_requests where id = p_expense_id;
  if not found then
    raise exception 'Demande de depense % introuvable', p_expense_id;
  end if;

  if v_expense.requester_id <> v_actor then
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;
  if v_expense.status <> 'submitted' then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;
  if length(trim(coalesce(p_justification, ''))) = 0 then
    raise exception 'Une justification est obligatoire pour une exception de separation des fonctions';
  end if;

  insert into public.expense_approvals (
    organization_id, expense_id, sod_rule_violated, exception_justification,
    exception_requested_by, created_by
  ) values (
    v_expense.organization_id, p_expense_id, 'approver_is_requester', p_justification, v_actor, v_actor
  );

  perform app_private.write_audit_log(
    v_expense.organization_id, 'request_expense_approval_exception', 'finance', 'expense_request', p_expense_id,
    null, jsonb_build_object('justification', p_justification), 'success'
  );

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.request_expense_approval_exception(uuid, text) from public;
grant execute on function public.request_expense_approval_exception(uuid, text) to authenticated;

create or replace function public.validate_expense_approval_exception(
  p_expense_id uuid, p_result text, p_comment text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_expense public.expense_requests%rowtype;
  v_pending public.expense_approvals%rowtype;
begin
  if p_result not in ('approved', 'refused') then
    raise exception 'Resultat invalide: %', p_result;
  end if;

  select * into v_expense from public.expense_requests where id = p_expense_id for update;
  if not found then
    raise exception 'Demande de depense % introuvable', p_expense_id;
  end if;

  select * into v_pending from public.expense_approvals
    where expense_id = p_expense_id and exception_result is null and exception_requested_by is not null
    order by created_at desc limit 1;
  if not found then
    return jsonb_build_object('success', false, 'error', 'no_pending_exception');
  end if;

  -- Validateur DG (ou SUPER_ADMIN) exige explicitement — pas seulement
  -- expense.approve (qui inclurait des MANAGER non habilites a arbitrer une
  -- exception SoD).
  if not (app_private.is_super_admin(v_actor)
          or app_private.has_role(v_actor, v_expense.organization_id, 'DIRECTEUR_GENERAL')) then
    perform app_private.write_audit_log(
      v_expense.organization_id, 'validate_expense_approval_exception', 'finance', 'expense_request', p_expense_id,
      null, jsonb_build_object('reason', 'validator_must_be_dg'), 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'validator_must_be_dg');
  end if;

  -- Meme personne ne peut jamais demander ET valider sa propre exception —
  -- deja garanti par le CHECK de table, revalide ici explicitement pour un
  -- message d'erreur clair (§7 du plan corrige : "jamais permettre a la
  -- meme personne de se declarer elle-meme exception autorisee").
  if v_pending.exception_requested_by = v_actor then
    perform app_private.write_audit_log(
      v_expense.organization_id, 'validate_expense_approval_exception', 'finance', 'expense_request', p_expense_id,
      null, jsonb_build_object('reason', 'self_validation_blocked'), 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'self_validation_blocked');
  end if;

  update public.expense_approvals
     set approver_id = v_actor,
         decision = case when p_result = 'approved' then 'approved' else 'rejected' end,
         decided_at = now(),
         comment = p_comment,
         exception_validated_by = v_actor,
         exception_validated_at = now(),
         exception_result = p_result
   where id = v_pending.id;

  if p_result = 'refused' then
    update public.expense_requests set status = 'rejected' where id = p_expense_id;
    perform app_private.write_audit_log(
      v_expense.organization_id, 'validate_expense_approval_exception', 'finance', 'expense_request', p_expense_id,
      null, jsonb_build_object('result', 'refused'), 'success'
    );
    return jsonb_build_object('success', true);
  end if;

  perform app_private.commit_budget_line(
    v_expense.budget_line_id, 'expense_request', p_expense_id, v_expense.amount, v_actor
  );
  update public.expense_requests set status = 'committed' where id = p_expense_id;

  perform app_private.write_audit_log(
    v_expense.organization_id, 'validate_expense_approval_exception', 'finance', 'expense_request', p_expense_id,
    null, jsonb_build_object('result', 'approved'), 'success'
  );

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.validate_expense_approval_exception(uuid, text, text) from public;
grant execute on function public.validate_expense_approval_exception(uuid, text, text) to authenticated;

-- --- RPC : annulation -------------------------------------------------

create or replace function public.cancel_expense_request(p_expense_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_expense public.expense_requests%rowtype;
  v_commitment_id uuid;
begin
  select * into v_expense from public.expense_requests where id = p_expense_id for update;
  if not found then
    raise exception 'Demande de depense % introuvable', p_expense_id;
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_expense.organization_id, 'expense.cancel')) then
    perform app_private.write_audit_log(
      v_expense.organization_id, 'cancel_expense_request', 'finance', 'expense_request', p_expense_id,
      null, null, 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  if v_expense.status not in ('submitted', 'committed') then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Une justification est obligatoire pour annuler une depense';
  end if;

  if v_expense.status = 'committed' then
    select id into v_commitment_id from public.budget_commitments
      where reference_type = 'expense_request' and reference_id = p_expense_id and status = 'active';
    if v_commitment_id is not null then
      perform app_private.release_budget_commitment(v_commitment_id, v_actor);
    end if;
  end if;

  update public.expense_requests set status = 'cancelled', cancel_reason = p_reason where id = p_expense_id;

  perform app_private.write_audit_log(
    v_expense.organization_id, 'cancel_expense_request', 'finance', 'expense_request', p_expense_id,
    null, jsonb_build_object('reason', p_reason), 'success'
  );

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.cancel_expense_request(uuid, text) from public;
grant execute on function public.cancel_expense_request(uuid, text) to authenticated;

-- --- RPC : paiement (§4/§6 du plan corrige — mouvement de tresorerie +
-- --- consommation d'engagement ; PAS de comptabilisation ici, voir
-- --- justify_expense_request pour le posting, accounting-design.md §4) ---

create or replace function public.pay_expense_request(
  p_expense_id uuid,
  p_treasury_account_type text,
  p_treasury_account_id uuid,
  p_paid_date date default current_date,
  p_no_commitment_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_expense public.expense_requests%rowtype;
  v_commitment public.budget_commitments%rowtype;
  v_approver_id uuid;
  v_expense_row_id uuid;
begin
  if p_treasury_account_type not in ('cash', 'bank', 'mobile_money') then
    raise exception 'Type de compte de tresorerie invalide: %', p_treasury_account_type;
  end if;

  select * into v_expense from public.expense_requests where id = p_expense_id for update;
  if not found then
    raise exception 'Demande de depense % introuvable', p_expense_id;
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_expense.organization_id, 'expense.pay')) then
    perform app_private.write_audit_log(
      v_expense.organization_id, 'pay_expense_request', 'finance', 'expense_request', p_expense_id,
      null, null, 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  if v_expense.status <> 'committed' then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  -- Separation des fonctions payeur/approbateur (§7 du plan corrige,
  -- security.md §3) : regle stricte en Phase 1C, sans mecanisme d'exception
  -- (contrairement a l'approbation) — decision de perimetre documentee.
  select approver_id into v_approver_id from public.expense_approvals
    where expense_id = p_expense_id and decision = 'approved'
    order by decided_at desc limit 1;
  if v_approver_id is not null and v_approver_id = v_actor and not app_private.is_super_admin(v_actor) then
    perform app_private.write_audit_log(
      v_expense.organization_id, 'pay_expense_request', 'finance', 'expense_request', p_expense_id,
      null, jsonb_build_object('reason', 'payer_is_approver'), 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'payer_is_approver');
  end if;

  select * into v_commitment from public.budget_commitments
    where reference_type = 'expense_request' and reference_id = p_expense_id and status = 'active'
    for update;

  if v_commitment.id is not null then
    perform app_private.consume_budget_commitment(v_commitment.id, v_actor);
  else
    -- Paiement hors engagement, exceptionnel (§3/§4 du plan corrige) :
    -- seul un detenteur de budget.manage peut l'autoriser explicitement.
    if not (app_private.is_super_admin(v_actor)
            or app_private.has_permission(v_actor, v_expense.organization_id, 'budget.manage')) then
      perform app_private.write_audit_log(
        v_expense.organization_id, 'pay_expense_request', 'finance', 'expense_request', p_expense_id,
        null, jsonb_build_object('reason', 'no_commitment_requires_budget_manage'), 'denied'
      );
      return jsonb_build_object('success', false, 'error', 'no_commitment_requires_budget_manage');
    end if;
    if length(trim(coalesce(p_no_commitment_reason, ''))) = 0 then
      raise exception 'Un motif est obligatoire pour un paiement sans engagement prealable';
    end if;
  end if;

  -- Verrouille le compte de tresorerie et decremente le solde, dans la
  -- meme transaction que la creation du mouvement — coherent avec le
  -- patron de verrouillage utilise pour le budget (§4). Branches explicites
  -- (pas de nom de table construit dynamiquement) : evite tout risque
  -- d'injection via un identifiant assemble a partir d'une entree.
  if p_treasury_account_type = 'cash' then
    perform 1 from public.cash_accounts where id = p_treasury_account_id and organization_id = v_expense.organization_id for update;
    if not found then raise exception 'Caisse % introuvable pour cette organisation', p_treasury_account_id; end if;
    update public.cash_accounts set current_balance = current_balance - v_expense.amount where id = p_treasury_account_id;
  elsif p_treasury_account_type = 'bank' then
    perform 1 from public.bank_accounts where id = p_treasury_account_id and organization_id = v_expense.organization_id for update;
    if not found then raise exception 'Compte bancaire % introuvable pour cette organisation', p_treasury_account_id; end if;
    update public.bank_accounts set current_balance = current_balance - v_expense.amount where id = p_treasury_account_id;
  else
    perform 1 from public.mobile_money_accounts where id = p_treasury_account_id and organization_id = v_expense.organization_id for update;
    if not found then raise exception 'Compte mobile money % introuvable pour cette organisation', p_treasury_account_id; end if;
    update public.mobile_money_accounts set current_balance = current_balance - v_expense.amount where id = p_treasury_account_id;
  end if;

  insert into public.cash_movements (
    organization_id, treasury_account_type, treasury_account_id, direction, amount,
    currency, movement_date, reference_type, reference_id, description, created_by, updated_by
  ) values (
    v_expense.organization_id, p_treasury_account_type, p_treasury_account_id, 'out', v_expense.amount,
    v_expense.currency, p_paid_date, 'expense', p_expense_id,
    'Paiement ' || v_expense.expense_number || ' — ' || v_expense.payee_name, v_actor, v_actor
  );

  insert into public.expenses (
    organization_id, expense_request_id, paid_by, paid_date, treasury_account_type, treasury_account_id,
    commitment_id, no_commitment_reason, created_by
  ) values (
    v_expense.organization_id, p_expense_id, v_actor, p_paid_date, p_treasury_account_type, p_treasury_account_id,
    v_commitment.id, case when v_commitment.id is null then p_no_commitment_reason else null end, v_actor
  ) returning id into v_expense_row_id;

  update public.expense_requests set status = 'paid' where id = p_expense_id;

  perform app_private.write_audit_log(
    v_expense.organization_id, 'pay_expense_request', 'finance', 'expense_request', p_expense_id,
    null, jsonb_build_object('expense_id', v_expense_row_id, 'amount', v_expense.amount), 'success'
  );

  return jsonb_build_object('success', true, 'expense_id', v_expense_row_id);
end;
$$;

revoke all on function public.pay_expense_request(uuid, text, uuid, date, text) from public;
grant execute on function public.pay_expense_request(uuid, text, uuid, date, text) to authenticated;

-- --- RPC : justification + comptabilisation automatique -------------------

create or replace function public.justify_expense_request(p_expense_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_expense public.expense_requests%rowtype;
  v_payment public.expenses%rowtype;
  v_category public.expense_categories%rowtype;
  v_gl_account_id uuid;
  v_attachment_count int;
  v_new_entry_id uuid;
begin
  select * into v_expense from public.expense_requests where id = p_expense_id for update;
  if not found then
    raise exception 'Demande de depense % introuvable', p_expense_id;
  end if;

  if not (app_private.is_super_admin(v_actor)
          or v_expense.requester_id = v_actor
          or app_private.has_permission(v_actor, v_expense.organization_id, 'expense.pay')) then
    perform app_private.write_audit_log(
      v_expense.organization_id, 'justify_expense_request', 'finance', 'expense_request', p_expense_id,
      null, null, 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  if v_expense.status <> 'paid' then
    return jsonb_build_object('success', false, 'error', 'invalid_status');
  end if;

  select count(*) into v_attachment_count from public.expense_attachments where expense_request_id = p_expense_id;
  if v_attachment_count = 0 then
    return jsonb_build_object('success', false, 'error', 'no_attachment');
  end if;

  select * into v_payment from public.expenses where expense_request_id = p_expense_id;
  if v_expense.category_id is not null then
    select * into v_category from public.expense_categories where id = v_expense.category_id;
  end if;
  v_gl_account_id := v_category.default_account_id;
  if v_gl_account_id is null then
    raise exception 'Categorie de depense sans compte comptable par defaut — comptabilisation impossible pour %', p_expense_id;
  end if;

  update public.expense_requests set status = 'justified' where id = p_expense_id;

  v_new_entry_id := app_private.create_and_post_two_line_entry(
    v_expense.organization_id,
    case v_payment.treasury_account_type when 'cash' then 'CASH' when 'bank' then 'BANK' else 'MISC' end,
    v_payment.paid_date,
    'Depense ' || v_expense.expense_number || ' — ' || v_expense.payee_name,
    'expense',
    p_expense_id,
    v_gl_account_id,
    (case v_payment.treasury_account_type
      when 'cash' then (select gl_account_id from public.cash_accounts where id = v_payment.treasury_account_id)
      when 'bank' then (select gl_account_id from public.bank_accounts where id = v_payment.treasury_account_id)
      else (select gl_account_id from public.mobile_money_accounts where id = v_payment.treasury_account_id)
    end),
    v_expense.amount,
    v_expense.currency,
    1,
    v_actor
  );

  update public.expenses set journal_entry_id = v_new_entry_id where id = v_payment.id;
  update public.expense_requests set status = 'posted' where id = p_expense_id;

  perform app_private.write_audit_log(
    v_expense.organization_id, 'justify_expense_request', 'finance', 'expense_request', p_expense_id,
    null, jsonb_build_object('journal_entry_id', v_new_entry_id), 'success'
  );

  return jsonb_build_object('success', true, 'journal_entry_id', v_new_entry_id);
end;
$$;

revoke all on function public.justify_expense_request(uuid) from public;
grant execute on function public.justify_expense_request(uuid) to authenticated;

-- --- Audit --------------------------------------------------------------

create trigger audit_expense_categories
  after insert or update or delete on public.expense_categories
  for each row execute function app_private.audit_row_trigger();

create trigger audit_expense_requests
  after insert or update or delete on public.expense_requests
  for each row execute function app_private.audit_row_trigger();

create trigger audit_expense_approvals
  after insert or update or delete on public.expense_approvals
  for each row execute function app_private.audit_row_trigger();

create trigger audit_expenses
  after insert or update or delete on public.expenses
  for each row execute function app_private.audit_row_trigger();

create trigger audit_expense_attachments
  after insert or update or delete on public.expense_attachments
  for each row execute function app_private.audit_row_trigger();

-- --- Grants et RLS --------------------------------------------------------

revoke all on public.expense_categories, public.expense_requests, public.expense_approvals,
  public.expenses, public.expense_attachments
  from anon;

grant select, insert, update on public.expense_categories to authenticated;
revoke delete on public.expense_categories from authenticated;

-- expense_requests : INSERT autorise (creation en 'draft' uniquement,
-- verifie par la policy WITH CHECK) ; AUCUN UPDATE — toute transition passe
-- par une RPC (§8 du plan corrige).
grant select, insert on public.expense_requests to authenticated;
revoke update, delete on public.expense_requests from authenticated;

grant select on public.expense_approvals, public.expenses to authenticated;
revoke insert, update, delete on public.expense_approvals, public.expenses from authenticated;

grant select, insert on public.expense_attachments to authenticated;
revoke update, delete on public.expense_attachments from authenticated;

create policy expense_categories_select on public.expense_categories
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'expense.view')
    or app_private.has_permission(auth.uid(), organization_id, 'budget.view')
  );

create policy expense_categories_write on public.expense_categories
  for insert to authenticated
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'budget.manage')
  );

create policy expense_categories_update on public.expense_categories
  for update to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'budget.manage')
  )
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'budget.manage')
  );

create policy expense_requests_select on public.expense_requests
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'expense.view')
    or requester_id = auth.uid()
  );

create policy expense_requests_insert on public.expense_requests
  for insert to authenticated
  with check (
    (app_private.is_super_admin(auth.uid())
     or app_private.has_permission(auth.uid(), organization_id, 'expense.create'))
    and requester_id = auth.uid()
    and status = 'draft'
  );

create policy expense_approvals_select on public.expense_approvals
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'expense.approve')
    or app_private.has_permission(auth.uid(), organization_id, 'expense.view')
    or exists (
      select 1 from public.expense_requests er
      where er.id = expense_approvals.expense_id and er.requester_id = auth.uid()
    )
  );

create policy expenses_select on public.expenses
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'expense.view')
    or exists (
      select 1 from public.expense_requests er
      where er.id = expenses.expense_request_id and er.requester_id = auth.uid()
    )
  );

create policy expense_attachments_select on public.expense_attachments
  for select to authenticated
  using (app_private.can_access_expense(organization_id, expense_request_id));

create policy expense_attachments_insert on public.expense_attachments
  for insert to authenticated
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'document.upload')
  );

-- --- Bucket Storage prive (meme patron que employee-documents, Phase 1B) --

insert into storage.buckets (id, name, public, file_size_limit)
values ('expense-attachments', 'expense-attachments', false, 20971520) -- 20 MiB
on conflict (id) do nothing;

create policy expense_attachments_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'expense-attachments'
    and app_private.can_access_expense(
      (storage.foldername(name))[1]::uuid,
      (storage.foldername(name))[2]::uuid
    )
  );

create policy expense_attachments_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'expense-attachments'
    and (
      app_private.is_super_admin(auth.uid())
      or app_private.has_permission(auth.uid(), (storage.foldername(name))[1]::uuid, 'document.upload')
    )
  );
