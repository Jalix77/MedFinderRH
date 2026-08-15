import type { Metadata } from 'next'
import { getMemberships } from '@/lib/auth/dal'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { MetricCard } from '@/components/finance/metric-card'
import { formatMoney } from '@/lib/format/money'

export const metadata: Metadata = { title: 'Accueil — MedFinder Gestion' }

export default async function DirectionPage() {
  const memberships = await getMemberships()
  const activeOrgId = await getActiveOrganizationId()
  const active = memberships.find((m) => m.organization_id === activeOrgId)

  const supabase = await createClient()
  const { count: memberCount } = await supabase
    .from('memberships')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', activeOrgId!)
    .eq('status', 'active')

  const [canViewAudit, canViewTreasury, canViewBudget, canViewExpenses, canViewPapej] = activeOrgId
    ? await Promise.all([
        hasPermission(activeOrgId, 'audit.view'),
        hasPermission(activeOrgId, 'accounting.view').then(
          async (v) => v || (await hasPermission(activeOrgId, 'treasury.manage'))
        ),
        hasPermission(activeOrgId, 'budget.view'),
        hasPermission(activeOrgId, 'expense.view'),
        hasPermission(activeOrgId, 'papej.view'),
      ])
    : [false, false, false, false, false]

  // --- Tresorerie : libelles metier avant tout, jamais de valeur fictive
  // (§ regles UX et dashboard, Phase 1C-UI) — chaque section n'interroge la
  // base que si la permission correspondante est confirmee, jamais "au cas
  // ou" (RLS le bloquerait de toute facon, mais on evite l'appel inutile).
  let treasuryTotalsByCurrency: Map<string, number> | null = null
  let cashTotal = 0
  let bankTotal = 0
  if (canViewTreasury) {
    const [{ data: cash }, { data: bank }, { data: mobile }] = await Promise.all([
      supabase.from('cash_accounts').select('current_balance, currency').eq('status', 'active'),
      supabase.from('bank_accounts').select('current_balance, currency').eq('status', 'active'),
      supabase.from('mobile_money_accounts').select('current_balance, currency').eq('status', 'active'),
    ])
    treasuryTotalsByCurrency = new Map()
    for (const row of [...(cash ?? []), ...(bank ?? []), ...(mobile ?? [])]) {
      treasuryTotalsByCurrency.set(row.currency, (treasuryTotalsByCurrency.get(row.currency) ?? 0) + Number(row.current_balance))
    }
    cashTotal = (cash ?? []).reduce((s, r) => s + Number(r.current_balance), 0)
    bankTotal = (bank ?? []).reduce((s, r) => s + Number(r.current_balance), 0)
  }

  let budgetConsumed = 0
  let budgetAvailable = 0
  if (canViewBudget) {
    const { data: balances } = await supabase.from('budget_line_balances').select('planned_amount, available_amount')
    const planned = (balances ?? []).reduce((s, b) => s + Number(b.planned_amount ?? 0), 0)
    budgetAvailable = (balances ?? []).reduce((s, b) => s + Number(b.available_amount ?? 0), 0)
    budgetConsumed = planned - budgetAvailable
  }

  let expensesThisMonth = 0
  let expensesPending = 0
  let missingJustifications = 0
  if (canViewExpenses) {
    const monthStart = new Date()
    monthStart.setDate(1)
    const monthStartStr = monthStart.toISOString().slice(0, 10)

    const [{ data: monthRows }, { count: pendingCount }, { count: missingCount }] = await Promise.all([
      supabase
        .from('expense_requests')
        .select('amount')
        .gte('requested_date', monthStartStr)
        .not('status', 'in', '(draft,cancelled,rejected)'),
      supabase.from('expense_requests').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
      supabase.from('expense_requests').select('id', { count: 'exact', head: true }).eq('status', 'paid'),
    ])
    expensesThisMonth = (monthRows ?? []).reduce((s, r) => s + Number(r.amount), 0)
    expensesPending = pendingCount ?? 0
    missingJustifications = missingCount ?? 0
  }

  let papejGranted = 0
  let papejReceived = 0
  let papejCommitted = 0
  let papejAvailable = 0
  if (canViewPapej) {
    const { data: grants } = await supabase.from('grants').select('id, amount_granted, amount_received')
    papejGranted = (grants ?? []).reduce((s, g) => s + Number(g.amount_granted), 0)
    papejReceived = (grants ?? []).reduce((s, g) => s + Number(g.amount_received), 0)

    const grantIds = (grants ?? []).map((g) => g.id)
    if (grantIds.length > 0) {
      const { data: grantLines } = await supabase
        .from('grant_budget_lines')
        .select('budget_line_id')
        .in('grant_id', grantIds)
      const budgetLineIds = (grantLines ?? []).map((l) => l.budget_line_id)
      if (budgetLineIds.length > 0) {
        const { data: balances } = await supabase
          .from('budget_line_balances')
          .select('committed_open, available_amount')
          .in('budget_line_id', budgetLineIds)
        papejCommitted = (balances ?? []).reduce((s, b) => s + Number(b.committed_open ?? 0), 0)
        papejAvailable = (balances ?? []).reduce((s, b) => s + Number(b.available_amount ?? 0), 0)
      }
    }
  }
  const papejPaid = papejReceived - papejAvailable - papejCommitted > 0 ? papejReceived - papejAvailable - papejCommitted : 0

  const hasAnyFinancialWidget = canViewTreasury || canViewBudget || canViewExpenses || canViewPapej

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-mf-navy-900">
          Bienvenue{active ? ` — ${active.organization_name}` : ''}
        </h1>
        <p className="text-sm text-slate-500">
          Organisation, acces, roles, audit, RH, depenses, tresorerie, budget et PAPEJ.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard label="Membres actifs" value={String(memberCount ?? 0)} />
        <MetricCard label="Vos roles" value={active?.role_codes.join(', ') || 'Aucun'} />
        <MetricCard label="Organisations accessibles" value={String(memberships.length)} />
      </div>

      {canViewTreasury && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-mf-navy-900">Tresorerie</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[...(treasuryTotalsByCurrency?.entries() ?? [])].map(([currency, total]) => (
              <MetricCard key={currency} label={`Tresorerie totale (${currency})`} value={formatMoney(total, currency)} />
            ))}
            <MetricCard label="Solde caisse" value={formatMoney(cashTotal)} />
            <MetricCard label="Solde banque" value={formatMoney(bankTotal)} />
          </div>
        </div>
      )}

      {(canViewExpenses || canViewBudget) && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-mf-navy-900">Depenses et budget</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {canViewExpenses && (
              <>
                <MetricCard label="Depenses du mois" value={formatMoney(expensesThisMonth)} />
                <MetricCard label="Depenses a approuver" value={String(expensesPending)} tone={expensesPending > 0 ? 'warning' : 'default'} />
                <MetricCard
                  label="Justificatifs manquants"
                  value={String(missingJustifications)}
                  tone={missingJustifications > 0 ? 'danger' : 'default'}
                />
              </>
            )}
            {canViewBudget && (
              <>
                <MetricCard label="Budget consomme" value={formatMoney(budgetConsumed)} tone="warning" />
                <MetricCard label="Budget disponible" value={formatMoney(budgetAvailable)} tone="success" />
              </>
            )}
          </div>
        </div>
      )}

      {canViewPapej && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-mf-navy-900">PAPEJ</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <MetricCard label="PAPEJ accorde" value={formatMoney(papejGranted)} />
            <MetricCard label="PAPEJ recu" value={formatMoney(papejReceived)} tone="success" />
            <MetricCard label="PAPEJ engage" value={formatMoney(papejCommitted)} tone="warning" />
            <MetricCard label="PAPEJ paye" value={formatMoney(papejPaid)} />
            <MetricCard label="Solde PAPEJ" value={formatMoney(papejAvailable)} tone="success" />
          </div>
        </div>
      )}

      {!hasAnyFinancialWidget && (
        <div className="rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-mf-navy-900">Modules disponibles</h2>
          <p className="text-sm text-slate-500">
            Les indicateurs financiers (tresorerie, budget, depenses, PAPEJ) sont visibles depuis le
            menu pour les roles disposant des permissions correspondantes.
          </p>
        </div>
      )}

      {!canViewAudit && (
        <p className="text-xs text-slate-400">
          Le journal d&apos;audit est visible depuis le menu pour les roles disposant de la
          permission <code>audit.view</code>.
        </p>
      )}
    </div>
  )
}
