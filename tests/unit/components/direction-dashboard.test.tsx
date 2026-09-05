// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { DirectionDashboard, type DirectionDashboardProps } from '@/components/direction/direction-dashboard'
import { CompositionBar, Kpi } from '@/components/direction/dashboard-primitives'
import { formatMoney } from '@/lib/format/money'

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  queries: [] as { table: string; columns: string; filters: [string, unknown][] }[],
  rpc: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth/dal', () => ({ getMemberships: async () => [
  { organization_id: 'org-a', organization_name: 'Organisation de test', role_codes: ['RH'] },
] }))
vi.mock('@/lib/auth/active-org', () => ({ getActiveOrganizationId: async () => 'org-a' }))
vi.mock('@/lib/permissions', () => ({ hasPermission: async (_org: string, permission: string) => state.permissions.has(permission) }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  rpc: state.rpc,
  from: (table: string) => {
    const call = { table, columns: '', filters: [] as [string, unknown][] }
    state.queries.push(call)
    const query = {
      select: (columns: string) => { call.columns = columns; return query },
      eq: (key: string, value: unknown) => { call.filters.push([key, value]); return query },
      in: (key: string, value: unknown) => { call.filters.push([key, value]); return query },
      then: (resolve: (response: { data: unknown; count?: number }) => unknown) => {
        const response = table === 'memberships' ? { data: null, count: 3 }
          : table === 'cash_accounts' ? { data: [{ current_balance: 100, currency: 'HTG' }, { current_balance: 5, currency: 'USD' }] }
            : table === 'bank_accounts' ? { data: [{ current_balance: 900, currency: 'HTG' }] }
              : table === 'mobile_money_accounts' ? { data: [{ current_balance: 50, currency: 'HTG' }] }
                : table === 'budgets' ? { data: [{ id: 'approved', status: 'approved' }, { id: 'draft', status: 'draft' }] }
                  : table === 'budget_line_balances' ? { data: call.columns.includes('committed_open')
                    ? [{ committed_open: 100, available_amount: 700 }]
                    : [{ budget_id: 'approved', planned_amount: 1000, available_amount: 600 }, { budget_id: 'draft', planned_amount: 9999, available_amount: 9999 }] }
                    : table === 'expense_requests' ? { data: [{ id: 'paid-1' }, { id: 'paid-2' }], count: 4 }
                      : table === 'expense_attachments' ? { data: [{ expense_request_id: 'paid-1' }] }
                        : table === 'grants' ? { data: [{ id: 'grant-1', amount_granted: 1200, amount_received: 1000 }] }
                          : table === 'grant_budget_lines' ? { data: [{ budget_line_id: 'line-1' }] } : { data: [] }
        return Promise.resolve(response).then(resolve)
      },
    }
    return query
  },
}) }))
import DirectionPage from '@/app/(app)/direction/page'

const financialPermissions = ['accounting.view', 'treasury.manage', 'budget.view', 'expense.view', 'papej.view']
const zeroProps: DirectionDashboardProps = {
  organizationName: 'Organisation de test', roleCodes: ['RH'], memberCount: 0, organizationCount: 1,
  canViewAudit: false, canViewAccounting: true, canViewTreasury: true, canViewBudget: true,
  canViewExpenses: true, canViewPapej: true, hasAnyFinancialWidget: true,
  treasuryTotalsByCurrency: [['HTG', 0]], cashTotal: 0, bankTotal: 0,
  budgetConsumed: 0, budgetAvailable: 0, ledgerExpensesThisMonth: 0, expensesPending: 0,
  missingJustifications: 0, papejGranted: 0, papejReceived: 0, papejCommitted: 0, papejPaid: 0, papejAvailable: 0,
}

function expectKpi(container: HTMLElement, label: string, value: string) {
  const card = container.querySelector(`[data-direction-kpi="${label}"]`)
  expect(card, label).not.toBeNull()
  expect(card!.querySelector('dd')?.textContent).toBe(value)
}

beforeEach(() => {
  vi.clearAllMocks()
  state.queries = []
  state.permissions = new Set([...financialPermissions, 'audit.view'])
  state.rpc.mockResolvedValue({ data: { success: true, total_expense: '314.50' } })
})

describe('Direction — donnees reelles transmises a la presentation', () => {
  it('conserve les valeurs de chaque KPI, les devises et les sources canoniques', async () => {
    const { container } = render(await DirectionPage())
    for (const [label, value] of [
      ['Membres actifs', '3'], ['Organisations accessibles', '1'],
      ['Tresorerie totale (HTG)', formatMoney(1050)], ['Tresorerie totale (USD)', formatMoney(5, 'USD')],
      ['Solde caisse', formatMoney(105)], ['Solde banque', formatMoney(900)],
      ['Charges comptabilisees du mois', formatMoney(314.5)], ['Depenses a approuver', '4'],
      ['Justificatifs manquants', '1'], ['Budget consomme', formatMoney(400)], ['Budget disponible', formatMoney(600)],
      ['PAPEJ accorde', formatMoney(1200)], ['PAPEJ recu', formatMoney(1000)], ['PAPEJ engage', formatMoney(100)],
      ['PAPEJ paye', formatMoney(200)], ['Solde PAPEJ', formatMoney(700)],
    ]) expectKpi(container, label, value)
    expect(container.querySelectorAll('[data-direction-kpi]')).toHaveLength(16)
    expect(state.rpc).toHaveBeenCalledWith('generate_income_statement_report', expect.objectContaining({ p_org_id: 'org-a' }))
    expect(state.queries.find(q => q.table === 'memberships')?.filters).toContainEqual(['organization_id', 'org-a'])
    expect(state.queries.find(q => q.table === 'expense_attachments')?.filters).toContainEqual(['expense_request_id', ['paid-1', 'paid-2']])
  })

  it('sans permissions financieres : aucun KPI financier ni requete correspondante', async () => {
    state.permissions.clear()
    const { container } = render(await DirectionPage())
    expect(container.querySelectorAll('[data-direction-kpi]')).toHaveLength(2)
    expect(screen.getByRole('heading', { name: 'Modules disponibles' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: "Journal d'audit" })).not.toBeInTheDocument()
    expect(state.queries.map(q => q.table)).toEqual(['memberships'])
    expect(state.rpc).not.toHaveBeenCalled()
  })

  it.each([
    ['accounting.view', ['cash_accounts', 'bank_accounts', 'mobile_money_accounts'], 'Charges comptabilisees du mois'],
    ['treasury.manage', ['cash_accounts', 'bank_accounts', 'mobile_money_accounts'], 'Solde banque'],
    ['budget.view', ['budgets', 'budget_line_balances'], 'Budget disponible'],
    ['expense.view', ['expense_requests', 'expense_attachments'], 'Justificatifs manquants'],
    ['papej.view', ['grants', 'grant_budget_lines', 'budget_line_balances'], 'Solde PAPEJ'],
  ])('la permission %s ne charge que ses sources et affiche ses indicateurs', async (permission, tables, label) => {
    state.permissions = new Set([permission])
    const { container } = render(await DirectionPage())
    expect(new Set(state.queries.map(q => q.table))).toEqual(new Set(['memberships', ...tables]))
    expect(container.querySelector(`[data-direction-kpi="${label}"]`)).not.toBeNull()
    if (permission !== 'accounting.view') expect(state.rpc).not.toHaveBeenCalled()
    for (const [otherPermission, otherLabel] of [
      ['budget.view', 'Budget disponible'], ['expense.view', 'Justificatifs manquants'],
      ['papej.view', 'Solde PAPEJ'], ['accounting.view', 'Charges comptabilisees du mois'],
    ]) {
      if (permission !== otherPermission) expect(container.querySelector(`[data-direction-kpi="${otherLabel}"]`)).toBeNull()
    }
  })
})

describe('Direction — etats visuels', () => {
  it('affiche explicitement tous les zeros sans barre ou pourcentage fictif', () => {
    const { container } = render(<DirectionDashboard {...zeroProps} />)
    expectKpi(container, 'Charges comptabilisees du mois', formatMoney(0))
    expectKpi(container, 'Budget disponible', formatMoney(0))
    expectKpi(container, 'Depenses a approuver', '0')
    expectKpi(container, 'Solde PAPEJ', formatMoney(0))
    expect(screen.getAllByText('Aucun montant à répartir pour l’instant.')).toHaveLength(2)
    expect(container.textContent).not.toMatch(/NaN|Infinity|\d\s?%/)
  })
  it('zero positif reste lisible et un montant long peut revenir a la ligne', () => {
    const { container } = render(<Kpi label="Solde" value="1 234 567 890,00 HTG" tone="success" />)
    expect(container.querySelector('dd')?.textContent).toBe('1 234 567 890,00 HTG')
    expect(container.querySelector('dd span')).toHaveTextContent('HTG')
    expect(container.querySelector('dd')).toHaveClass('[overflow-wrap:anywhere]', 'leading-tight', 'text-mf-emerald-700')
    expect(container.firstChild).toHaveClass('min-w-0')
  })
  it('garde les montants negatifs visibles sans les transformer en proportions positives', () => {
    render(<CompositionBar label="Budget" formatValue={formatMoney} segments={[
      { label: 'Consommé', amount: 400 }, { label: 'Disponible', amount: -100, positive: true },
    ]} />)
    expect(screen.getByText('La répartition graphique n’est pas disponible pour ces montants.')).toBeInTheDocument()
    expect(within(screen.getByRole('list')).getByText(formatMoney(-100), { normalizer: text => text })).toBeInTheDocument()
  })
  it('le lien audit respecte sa permission et pointe vers la route existante', () => {
    const { rerender } = render(<DirectionDashboard {...zeroProps} canViewAudit />)
    expect(screen.getByRole('link', { name: "Journal d'audit" })).toHaveAttribute('href', '/audit')
    rerender(<DirectionDashboard {...zeroProps} canViewAudit={false} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
