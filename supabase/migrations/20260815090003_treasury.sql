-- MedFinder Gestion — Phase 1C, sous-jalon 1C.2 — Tresorerie
-- Caisses, comptes bancaires, mobile money, mouvements. Aucune permission
-- supplementaire (treasury.manage/treasury.reconcile deja seedees en
-- Phase 1A, docs/phase-1c-plan.md §3).
--
-- Visibilite : le catalogue de permissions n'a pas de "treasury.view"
-- dedie (docs/permissions-matrix.md). Plutot que d'ajouter un code hors du
-- catalogue deja approuve, la lecture est gardee par treasury.manage OU
-- accounting.view — ce dernier couvre le role Direction Generale
-- ("Direction, finance... rapports", docs/permissions-matrix.md §1) qui
-- n'a pas treasury.manage mais doit pouvoir consulter les soldes. Choix
-- documente ici, pas une modification du catalogue.
--
-- current_balance : colonne reelle, mise a jour UNIQUEMENT par les RPC de
-- paiement/reception (1C.4 pay_expense_request, 1C.5 record_grant_receipt)
-- via verrouillage de ligne (select ... for update), jamais par le client.
-- Aucune ecriture de mouvement en 1C.2 elle-meme (aucun workflow ne les
-- produit encore a ce stade) — cash_movements reste vide tant que 1C.4/1C.5
-- ne sont pas livres.

create table public.cash_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  currency char(3) not null default 'HTG',
  gl_account_id uuid not null references public.chart_of_accounts (id) on delete restrict,
  current_balance numeric(14, 2) not null default 0,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id),
  unique (organization_id, name)
);

comment on table public.cash_accounts is
  'Caisses. gl_account_id : compte du plan comptable credite/debite au '
  'paiement (compte de tresorerie), configure par le comptable.';

create trigger set_updated_at
  before update on public.cash_accounts
  for each row execute function app_private.set_updated_at();

create index cash_accounts_org_idx on public.cash_accounts (organization_id);

alter table public.cash_accounts enable row level security;

create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  bank_name text not null check (length(trim(bank_name)) > 0),
  account_number_masked text,
  currency char(3) not null default 'HTG',
  gl_account_id uuid not null references public.chart_of_accounts (id) on delete restrict,
  current_balance numeric(14, 2) not null default 0,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id)
);

comment on table public.bank_accounts is
  'Comptes bancaires. account_number_masked : jamais le numero complet en clair.';

create trigger set_updated_at
  before update on public.bank_accounts
  for each row execute function app_private.set_updated_at();

create index bank_accounts_org_idx on public.bank_accounts (organization_id);

alter table public.bank_accounts enable row level security;

create table public.mobile_money_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null check (length(trim(provider)) > 0),
  account_number_masked text,
  currency char(3) not null default 'HTG',
  gl_account_id uuid not null references public.chart_of_accounts (id) on delete restrict,
  current_balance numeric(14, 2) not null default 0,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id)
);

comment on table public.mobile_money_accounts is
  'Comptes mobile money (MonCash, NatCash, ...). Provider en texte libre '
  '(extensible), pas fige dans une enumeration.';

create trigger set_updated_at
  before update on public.mobile_money_accounts
  for each row execute function app_private.set_updated_at();

create index mobile_money_accounts_org_idx on public.mobile_money_accounts (organization_id);

alter table public.mobile_money_accounts enable row level security;

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  treasury_account_type text not null check (treasury_account_type in ('cash', 'bank', 'mobile_money')),
  treasury_account_id uuid not null,
  direction text not null check (direction in ('in', 'out')),
  amount numeric(14, 2) not null check (amount > 0),
  currency char(3) not null default 'HTG',
  exchange_rate_to_htg numeric(14, 6) not null default 1,
  movement_date date not null default current_date,
  reference_type text not null check (reference_type in
    ('expense', 'invoice', 'payroll', 'donation', 'grant', 'manual')),
  reference_id uuid,
  description text,
  reconciled boolean not null default false,
  journal_entry_id uuid references public.journal_entries (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.users (id),
  updated_by uuid references public.users (id)
);

comment on table public.cash_movements is
  'treasury_account_type/id : cible polymorphe (cash_accounts/bank_accounts/'
  'mobile_money_accounts), pas de FK enforce (meme patron que '
  'journal_entry_lines.third_party_type/id). "reconciled" reste a false en '
  'Phase 1C : le rapprochement bancaire reel (import releve, UI de '
  'lettrage) est hors perimetre (Phase 2, docs/phase-1c-plan.md §1). Append-'
  'only : aucune permission UPDATE/DELETE, meme via RPC (aucun workflow '
  'Phase 1C ne modifie un mouvement une fois cree).';

create trigger set_updated_at
  before update on public.cash_movements
  for each row execute function app_private.set_updated_at();

create index cash_movements_org_idx on public.cash_movements (organization_id);
create index cash_movements_account_idx on public.cash_movements (treasury_account_type, treasury_account_id);
create index cash_movements_reference_idx on public.cash_movements (reference_type, reference_id);

alter table public.cash_movements enable row level security;

-- --- Audit ------------------------------------------------------------

create trigger audit_cash_accounts
  after insert or update or delete on public.cash_accounts
  for each row execute function app_private.audit_row_trigger();

create trigger audit_bank_accounts
  after insert or update or delete on public.bank_accounts
  for each row execute function app_private.audit_row_trigger();

create trigger audit_mobile_money_accounts
  after insert or update or delete on public.mobile_money_accounts
  for each row execute function app_private.audit_row_trigger();

create trigger audit_cash_movements
  after insert or update or delete on public.cash_movements
  for each row execute function app_private.audit_row_trigger();

-- --- Grants et RLS ------------------------------------------------------

revoke all on public.cash_accounts, public.bank_accounts, public.mobile_money_accounts, public.cash_movements
  from anon;

-- Comptes de tresorerie : CRUD garde par treasury.manage, jamais de DELETE
-- reel (desactivation via status).
grant select, insert, update on public.cash_accounts, public.bank_accounts, public.mobile_money_accounts
  to authenticated;
revoke delete on public.cash_accounts, public.bank_accounts, public.mobile_money_accounts from authenticated;

-- cash_movements : lecture seule pour "authenticated" — creation
-- exclusivement via les RPC de paiement/reception ajoutees en 1C.4/1C.5
-- (meme regime que journal_entries, §5 du plan corrige).
grant select on public.cash_movements to authenticated;
revoke insert, update, delete on public.cash_movements from authenticated;

create policy cash_accounts_select on public.cash_accounts
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'treasury.manage')
    or app_private.has_permission(auth.uid(), organization_id, 'accounting.view')
  );

create policy cash_accounts_insert on public.cash_accounts
  for insert to authenticated
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'treasury.manage')
  );

create policy cash_accounts_update on public.cash_accounts
  for update to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'treasury.manage')
  )
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'treasury.manage')
  );

create policy bank_accounts_select on public.bank_accounts
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'treasury.manage')
    or app_private.has_permission(auth.uid(), organization_id, 'accounting.view')
  );

create policy bank_accounts_insert on public.bank_accounts
  for insert to authenticated
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'treasury.manage')
  );

create policy bank_accounts_update on public.bank_accounts
  for update to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'treasury.manage')
  )
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'treasury.manage')
  );

create policy mobile_money_accounts_select on public.mobile_money_accounts
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'treasury.manage')
    or app_private.has_permission(auth.uid(), organization_id, 'accounting.view')
  );

create policy mobile_money_accounts_insert on public.mobile_money_accounts
  for insert to authenticated
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'treasury.manage')
  );

create policy mobile_money_accounts_update on public.mobile_money_accounts
  for update to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'treasury.manage')
  )
  with check (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'treasury.manage')
  );

create policy cash_movements_select on public.cash_movements
  for select to authenticated
  using (
    app_private.is_super_admin(auth.uid())
    or app_private.has_permission(auth.uid(), organization_id, 'treasury.manage')
    or app_private.has_permission(auth.uid(), organization_id, 'accounting.view')
  );
