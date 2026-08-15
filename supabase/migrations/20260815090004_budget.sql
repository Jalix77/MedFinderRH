-- MedFinder Gestion — Phase 1C, sous-jalon 1C.3 — Budget
-- Aucune permission supplementaire (budget.manage/view/transfer deja
-- seedees en Phase 1A, docs/phase-1c-plan.md §3).
--
-- Modele du disponible SANS double comptage (correction Jean Alix Pierre,
-- §4 du plan) :
--   disponible = planned_amount
--              - somme(engagements actifs)          -- engage restant
--              - somme(paiements avec engagement)    -- deja retire de la somme ci-dessus a la consommation
--              - somme(paiements sans engagement)    -- exceptionnel, autorise par budget.manage
-- app_private.budget_line_available() ne calcule ICI que les 2 premiers
-- termes (planned - actifs) : le troisieme (paiements) n'existe pas encore
-- tant qu'expenses (1C.4) n'est pas cree. La fonction est REDEFINIE dans la
-- migration 1C.4 pour completer la formule des que la table existe — voir
-- le commentaire correspondant la-bas. Aucun paiement ne peut survenir
-- avant 1C.4 (aucun workflow ne les produit), donc pas de fenetre de bug
-- reelle malgre la formule partielle a ce stade.
--
-- Tout engagement passe exclusivement par app_private.commit_budget_line()
-- (verrouillage FOR UPDATE de la ligne budgetaire, recalcul dans la
-- transaction, refus si insuffisant) — aucun INSERT/UPDATE direct sur
-- budget_commitments par un client authentifie (§4/§5 du plan corrige).

create table public.cost_centers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  code text not null check (length(trim(code)) > 0),
  name text not null check (length(trim(name)) > 0),
  department_id uuid references public.departments (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  unique (organization_id, code)
);

create trigger set_updated_at
  before update on public.cost_centers
  for each row execute function app_private.set_updated_at();

create index cost_centers_org_idx on public.cost_centers (organization_id);

alter table public.cost_centers enable row level security;

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  fiscal_year_id uuid not null references public.fiscal_years (id) on delete restrict,
  name text not null check (length(trim(name)) > 0),
  version int not null default 1,
  status text not null default 'draft' check (status in ('draft', 'approved', 'revised')),
  source_type text not null default 'general' check (source_type in ('general', 'papej', 'grant', 'donation')),
  source_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id)
);

comment on table public.budgets is
  'source_id : reference polymorphe (grants.id quand source_type=papej/grant) '
  '— pas de FK enforce, grants n''existe pas encore a ce stade (cree en 1C.5).';

create trigger set_updated_at
  before update on public.budgets
  for each row execute function app_private.set_updated_at();

create index budgets_org_idx on public.budgets (organization_id);
create index budgets_fiscal_year_idx on public.budgets (fiscal_year_id);

alter table public.budgets enable row level security;

create table public.budget_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  budget_id uuid not null references public.budgets (id) on delete cascade,
  cost_center_id uuid references public.cost_centers (id) on delete set null,
  category text not null check (length(trim(category)) > 0),
  planned_amount numeric(14, 2) not null default 0 check (planned_amount >= 0),
  currency char(3) not null default 'HTG',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id)
);

comment on table public.budget_lines is
  'planned_amount modifiable directement (RLS) tant que le budget parent est '
  '"draft" ; une fois "approved", seul app_private.transfer_budget_amount() '
  '(verrouillage + verification du disponible) peut le faire varier.';

create trigger set_updated_at
  before update on public.budget_lines
  for each row execute function app_private.set_updated_at();

create index budget_lines_org_idx on public.budget_lines (organization_id);
create index budget_lines_budget_idx on public.budget_lines (budget_id);

alter table public.budget_lines enable row level security;

-- Coherence organisation_id <-> budget_id : le client fournit organization_id
-- a l'INSERT (RLS ne verifie que "c'est bien MON organisation"), rien
-- n'empeche autrement de pointer budget_id vers le budget d'une AUTRE
-- organisation tout en declarant organization_id = la sienne. Ferme ici.
create or replace function app_private.enforce_budget_line_org_consistency()
returns trigger
language plpgsql
as $$
declare
  v_budget_org uuid;
begin
  select organization_id into v_budget_org from public.budgets where id = NEW.budget_id;
  if v_budget_org is null then
    raise exception 'Budget % introuvable', NEW.budget_id;
  end if;
  if v_budget_org <> NEW.organization_id then
    raise exception 'Incoherence organisation : budget_line.organization_id (%) <> budgets.organization_id (%)',
      NEW.organization_id, v_budget_org;
  end if;
  return NEW;
end;
$$;

revoke execute on function app_private.enforce_budget_line_org_consistency() from public;

create trigger enforce_budget_line_org_consistency
  before insert or update on public.budget_lines
  for each row execute function app_private.enforce_budget_line_org_consistency();

create table public.budget_commitments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  budget_line_id uuid not null references public.budget_lines (id) on delete restrict,
  reference_type text not null default 'expense_request' check (reference_type in ('expense_request', 'purchase_order')),
  reference_id uuid not null,
  amount numeric(14, 2) not null check (amount > 0),
  status text not null default 'active' check (status in ('active', 'released', 'consumed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  released_at timestamptz,
  released_by uuid references public.users (id),
  consumed_at timestamptz,
  consumed_by uuid references public.users (id)
);

comment on table public.budget_commitments is
  'Ecriture EXCLUSIVEMENT via app_private.commit_budget_line() / '
  'release_budget_commitment() / consume_budget_commitment() — aucun '
  'privilege table-level INSERT/UPDATE/DELETE pour "authenticated" (§4/§5 '
  'du plan corrige). "consumed" est pose par 1C.4 (pay_expense_request) — '
  'aucune ligne n''atteint ce statut avant que ce sous-jalon existe.';

create trigger set_updated_at
  before update on public.budget_commitments
  for each row execute function app_private.set_updated_at();

create index budget_commitments_line_idx on public.budget_commitments (budget_line_id);
create index budget_commitments_org_idx on public.budget_commitments (organization_id);
create index budget_commitments_reference_idx on public.budget_commitments (reference_type, reference_id);

alter table public.budget_commitments enable row level security;

create table public.budget_transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  budget_id uuid not null references public.budgets (id) on delete restrict,
  from_line_id uuid not null references public.budget_lines (id) on delete restrict,
  to_line_id uuid not null references public.budget_lines (id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  reason text not null check (length(trim(reason)) > 0),
  approved_by uuid references public.users (id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.users (id)
);

comment on table public.budget_transfers is
  'Ecriture EXCLUSIVEMENT via app_private.transfer_budget_amount() — un '
  'transfert modifie planned_amount sur DEUX lignes de facon atomique, '
  'impossible a exprimer correctement via un INSERT direct.';

create index budget_transfers_org_idx on public.budget_transfers (organization_id);
create index budget_transfers_budget_idx on public.budget_transfers (budget_id);

alter table public.budget_transfers enable row level security;

-- cost_center_id sur journal_entry_lines : differe depuis 1C.1 (cost_centers
-- n'existait pas encore).
alter table public.journal_entry_lines
  add column cost_center_id uuid references public.cost_centers (id);

-- --- Fonctions : formule du disponible (partielle, completee en 1C.4) ----

create or replace function app_private.budget_line_available(p_budget_line_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, app_private
as $$
  select bl.planned_amount - coalesce((
    select sum(bc.amount)
    from public.budget_commitments bc
    where bc.budget_line_id = bl.id and bc.status = 'active'
  ), 0)
  from public.budget_lines bl
  where bl.id = p_budget_line_id;
$$;

revoke execute on function app_private.budget_line_available(uuid) from public;

-- --- RPC : engagement transactionnel (§4 du plan corrige) -----------------
-- Verrouille la ligne budgetaire (serialise tout engagement concurrent sur
-- la MEME ligne), recalcule le disponible dans la transaction, refuse si
-- insuffisant, cree l'engagement, journalise — commit atomique implicite.

create or replace function app_private.commit_budget_line(
  p_budget_line_id uuid,
  p_reference_type text,
  p_reference_id uuid,
  p_amount numeric,
  p_actor uuid
) returns uuid
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_line public.budget_lines%rowtype;
  v_budget_status text;
  v_available numeric;
  v_commitment_id uuid;
begin
  if p_amount <= 0 then
    raise exception 'Montant d''engagement invalide: %', p_amount;
  end if;

  select * into v_line from public.budget_lines where id = p_budget_line_id for update;
  if not found then
    raise exception 'Ligne budgetaire % introuvable', p_budget_line_id;
  end if;

  select status into v_budget_status from public.budgets where id = v_line.budget_id;
  if v_budget_status <> 'approved' then
    raise exception 'Le budget de la ligne % n''est pas approuve (statut: %) — engagement impossible',
      p_budget_line_id, v_budget_status;
  end if;

  v_available := app_private.budget_line_available(p_budget_line_id);
  if p_amount > v_available then
    raise exception 'Budget insuffisant sur la ligne % : disponible=%, demande=%',
      p_budget_line_id, v_available, p_amount;
  end if;

  insert into public.budget_commitments (
    organization_id, budget_line_id, reference_type, reference_id, amount, status, created_by, updated_by
  ) values (
    v_line.organization_id, p_budget_line_id, p_reference_type, p_reference_id, p_amount, 'active', p_actor, p_actor
  ) returning id into v_commitment_id;

  perform app_private.write_audit_log(
    v_line.organization_id, 'commit_budget_line', 'budget', 'budget_commitment', v_commitment_id,
    null, jsonb_build_object('budget_line_id', p_budget_line_id, 'amount', p_amount, 'reference_type', p_reference_type, 'reference_id', p_reference_id),
    'success'
  );

  return v_commitment_id;
end;
$$;

revoke execute on function app_private.commit_budget_line(uuid, text, uuid, numeric, uuid) from public;

-- Enveloppe publique : verifie acteur/permission (budget.manage), delegue.
-- Utilisee directement par les tests de concurrence de ce sous-jalon (aucun
-- appelant metier n'existe encore — expense_requests arrive en 1C.4, qui
-- appellera app_private.commit_budget_line directement, sa propre RPC
-- ayant deja verifie la permission d'approbation).
create or replace function public.commit_budget_line(
  p_budget_line_id uuid,
  p_reference_type text,
  p_reference_id uuid,
  p_amount numeric
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_org_id uuid;
  v_commitment_id uuid;
begin
  select organization_id into v_org_id from public.budget_lines where id = p_budget_line_id;
  if v_org_id is null then
    raise exception 'Ligne budgetaire % introuvable', p_budget_line_id;
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_org_id, 'budget.manage')) then
    perform app_private.write_audit_log(
      v_org_id, 'commit_budget_line', 'budget', 'budget_line', p_budget_line_id,
      null, jsonb_build_object('amount', p_amount), 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  v_commitment_id := app_private.commit_budget_line(p_budget_line_id, p_reference_type, p_reference_id, p_amount, v_actor);

  return jsonb_build_object('success', true, 'commitment_id', v_commitment_id);
end;
$$;

revoke all on function public.commit_budget_line(uuid, text, uuid, numeric) from public;
grant execute on function public.commit_budget_line(uuid, text, uuid, numeric) to authenticated;

-- --- RPC : liberation d'un engagement (demande rejetee/annulee) ----------

create or replace function app_private.release_budget_commitment(p_commitment_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_commitment public.budget_commitments%rowtype;
begin
  select * into v_commitment from public.budget_commitments where id = p_commitment_id for update;
  if not found then
    raise exception 'Engagement % introuvable', p_commitment_id;
  end if;

  -- Verrouille aussi la ligne budgetaire : serialise avec tout
  -- commit_budget_line/consume_budget_commitment concurrent sur la meme ligne.
  perform 1 from public.budget_lines where id = v_commitment.budget_line_id for update;

  if v_commitment.status <> 'active' then
    raise exception 'Engagement % n''est pas actif (statut: %) — liberation impossible', p_commitment_id, v_commitment.status;
  end if;

  update public.budget_commitments
     set status = 'released', released_at = now(), released_by = p_actor
   where id = p_commitment_id;

  perform app_private.write_audit_log(
    v_commitment.organization_id, 'release_budget_commitment', 'budget', 'budget_commitment', p_commitment_id,
    null, null, 'success'
  );
end;
$$;

revoke execute on function app_private.release_budget_commitment(uuid, uuid) from public;

-- --- RPC : consommation d'un engagement (paiement effectue) --------------
-- Appelee par 1C.4 (pay_expense_request), jamais directement exposee —
-- la RPC de paiement doit avoir deja verifie sa propre permission/logique
-- (SoD, etc.) avant d'appeler ceci.

create or replace function app_private.consume_budget_commitment(p_commitment_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_commitment public.budget_commitments%rowtype;
begin
  select * into v_commitment from public.budget_commitments where id = p_commitment_id for update;
  if not found then
    raise exception 'Engagement % introuvable', p_commitment_id;
  end if;

  perform 1 from public.budget_lines where id = v_commitment.budget_line_id for update;

  if v_commitment.status <> 'active' then
    raise exception 'Engagement % n''est pas actif (statut: %) — consommation impossible', p_commitment_id, v_commitment.status;
  end if;

  update public.budget_commitments
     set status = 'consumed', consumed_at = now(), consumed_by = p_actor
   where id = p_commitment_id;

  perform app_private.write_audit_log(
    v_commitment.organization_id, 'consume_budget_commitment', 'budget', 'budget_commitment', p_commitment_id,
    null, null, 'success'
  );
end;
$$;

revoke execute on function app_private.consume_budget_commitment(uuid, uuid) from public;

-- --- RPC : transfert entre lignes budgetaires ------------------------------

create or replace function app_private.transfer_budget_amount(
  p_from_line_id uuid,
  p_to_line_id uuid,
  p_amount numeric,
  p_reason text,
  p_actor uuid
) returns uuid
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_from public.budget_lines%rowtype;
  v_to public.budget_lines%rowtype;
  v_available numeric;
  v_transfer_id uuid;
begin
  if p_amount <= 0 then
    raise exception 'Montant de transfert invalide: %', p_amount;
  end if;
  if p_from_line_id = p_to_line_id then
    raise exception 'Lignes source et cible identiques';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Une justification est obligatoire pour un transfert budgetaire';
  end if;

  -- Ordre canonique de verrouillage (par id) : evite un deadlock si deux
  -- transferts concurrents s'effectuent en sens inverse entre les memes
  -- deux lignes.
  if p_from_line_id < p_to_line_id then
    perform 1 from public.budget_lines where id = p_from_line_id for update;
    perform 1 from public.budget_lines where id = p_to_line_id for update;
  else
    perform 1 from public.budget_lines where id = p_to_line_id for update;
    perform 1 from public.budget_lines where id = p_from_line_id for update;
  end if;

  select * into v_from from public.budget_lines where id = p_from_line_id;
  select * into v_to from public.budget_lines where id = p_to_line_id;
  if v_from.id is null or v_to.id is null then
    raise exception 'Ligne budgetaire source ou cible introuvable';
  end if;
  if v_from.organization_id <> v_to.organization_id then
    raise exception 'Transfert entre organisations differentes interdit';
  end if;

  v_available := app_private.budget_line_available(p_from_line_id);
  if p_amount > v_available then
    raise exception 'Budget insuffisant sur la ligne source % : disponible=%, demande=%',
      p_from_line_id, v_available, p_amount;
  end if;

  update public.budget_lines set planned_amount = planned_amount - p_amount where id = p_from_line_id;
  update public.budget_lines set planned_amount = planned_amount + p_amount where id = p_to_line_id;

  insert into public.budget_transfers (
    organization_id, budget_id, from_line_id, to_line_id, amount, reason, approved_by, approved_at, created_by
  ) values (
    v_from.organization_id, v_from.budget_id, p_from_line_id, p_to_line_id, p_amount, p_reason, p_actor, now(), p_actor
  ) returning id into v_transfer_id;

  perform app_private.write_audit_log(
    v_from.organization_id, 'transfer_budget_amount', 'budget', 'budget_transfer', v_transfer_id,
    null, jsonb_build_object('from_line_id', p_from_line_id, 'to_line_id', p_to_line_id, 'amount', p_amount, 'reason', p_reason),
    'success'
  );

  return v_transfer_id;
end;
$$;

revoke execute on function app_private.transfer_budget_amount(uuid, uuid, numeric, text, uuid) from public;

create or replace function public.transfer_budget_amount(
  p_from_line_id uuid,
  p_to_line_id uuid,
  p_amount numeric,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_org_id uuid;
  v_transfer_id uuid;
begin
  select organization_id into v_org_id from public.budget_lines where id = p_from_line_id;
  if v_org_id is null then
    raise exception 'Ligne budgetaire % introuvable', p_from_line_id;
  end if;

  if not (app_private.is_super_admin(v_actor)
          or app_private.has_permission(v_actor, v_org_id, 'budget.transfer')) then
    perform app_private.write_audit_log(
      v_org_id, 'transfer_budget_amount', 'budget', 'budget_line', p_from_line_id,
      null, jsonb_build_object('amount', p_amount), 'denied'
    );
    return jsonb_build_object('success', false, 'error', 'not_authorized');
  end if;

  v_transfer_id := app_private.transfer_budget_amount(p_from_line_id, p_to_line_id, p_amount, p_reason, v_actor);

  return jsonb_build_object('success', true, 'transfer_id', v_transfer_id);
end;
$$;

revoke all on function public.transfer_budget_amount(uuid, uuid, numeric, text) from public;
grant execute on function public.transfer_budget_amount(uuid, uuid, numeric, text) to authenticated;

-- --- Vue : disponible par ligne, security_invoker (§10 du plan corrige) --

create view public.budget_line_balances
with (security_invoker = true) as
select
  bl.id as budget_line_id,
  bl.organization_id,
  bl.budget_id,
  bl.category,
  bl.planned_amount,
  coalesce((
    select sum(bc.amount) from public.budget_commitments bc
    where bc.budget_line_id = bl.id and bc.status = 'active'
  ), 0) as committed_open,
  app_private.budget_line_available(bl.id) as available_amount
from public.budget_lines bl;

comment on view public.budget_line_balances is
  'security_invoker=true : s''execute avec les privileges/policies RLS du '
  'role appelant (pas du proprietaire de la vue) — l''isolation '
  'organisationnelle de budget_lines s''applique donc a la vue elle-meme, '
  'testee explicitement (tests/integration/budget.test.ts).';

grant select on public.budget_line_balances to authenticated;

-- --- Audit ------------------------------------------------------------

create trigger audit_cost_centers
  after insert or update or delete on public.cost_centers
  for each row execute function app_private.audit_row_trigger();

create trigger audit_budgets
  after insert or update or delete on public.budgets
  for each row execute function app_private.audit_row_trigger();

create trigger audit_budget_lines
  after insert or update or delete on public.budget_lines
  for each row execute function app_private.audit_row_trigger();

create trigger audit_budget_commitments
  after insert or update or delete on public.budget_commitments
  for each row execute function app_private.audit_row_trigger();

create trigger audit_budget_transfers
  after insert or update or delete on public.budget_transfers
  for each row execute function app_private.audit_row_trigger();

-- --- Grants et RLS ------------------------------------------------------

revoke all on public.cost_centers, public.budgets, public.budget_lines,
  public.budget_commitments, public.budget_transfers
  from anon;

grant select, insert, update on public.cost_centers, public.budgets to authenticated;
revoke delete on public.cost_centers, public.budgets from authenticated;

grant select, insert, update on public.budget_lines to authenticated;
revoke delete on public.budget_lines from authenticated;

-- budget_commitments / budget_transfers : lecture seule, ecriture
-- exclusivement via les RPC ci-dessus (§4/§5 du plan corrige).
grant select on public.budget_commitments, public.budget_transfers to authenticated;
revoke insert, update, delete on public.budget_commitments, public.budget_transfers from authenticated;

create policy cost_centers_select on public.cost_centers
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'budget.view')
  );

create policy cost_centers_insert on public.cost_centers
  for insert to authenticated
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'budget.manage')
  );

create policy cost_centers_update on public.cost_centers
  for update to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'budget.manage')
  )
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'budget.manage')
  );

create policy budgets_select on public.budgets
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'budget.view')
  );

create policy budgets_insert on public.budgets
  for insert to authenticated
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'budget.manage')
  );

create policy budgets_update on public.budgets
  for update to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'budget.manage')
  )
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'budget.manage')
  );

create policy budget_lines_select on public.budget_lines
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'budget.view')
  );

create policy budget_lines_insert on public.budget_lines
  for insert to authenticated
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'budget.manage')
  );

-- Modification directe de planned_amount uniquement tant que le budget
-- parent est "draft" — une fois "approved", seul transfer_budget_amount()
-- (verrouillage + verification du disponible) peut le faire varier.
create policy budget_lines_update on public.budget_lines
  for update to authenticated
  using (
    (app_private.is_super_admin(auth.uid())
     or app_private.has_permission(auth.uid(), organization_id, 'budget.manage'))
    and exists (
      select 1 from public.budgets b
      where b.id = budget_lines.budget_id and b.status = 'draft'
    )
  )
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'budget.manage')
  );

create policy budget_commitments_select on public.budget_commitments
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'budget.view')
  );

create policy budget_transfers_select on public.budget_transfers
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'budget.view')
  );
