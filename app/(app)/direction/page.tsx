import type { Metadata } from 'next'
import { getMemberships } from '@/lib/auth/dal'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { DirectionDashboard } from '@/components/direction/direction-dashboard'
import { operationalBudgetTotals } from '@/lib/budget/operational-totals'
import { countExpensesWithoutReceipt } from '@/lib/expenses/missing-receipts'
import { businessMonthToDate } from '@/lib/date/business-month'

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

  // `accounting.view` est desormais lue pour elle-meme : les charges du mois
  // sont un indicateur COMPTABLE, pas un indicateur du module depenses.
  const [canViewAudit, canViewAccounting, canManageTreasury, canViewBudget, canViewExpenses, canViewPapej] =
    activeOrgId
      ? await Promise.all([
          hasPermission(activeOrgId, 'audit.view'),
          hasPermission(activeOrgId, 'accounting.view'),
          hasPermission(activeOrgId, 'treasury.manage'),
          hasPermission(activeOrgId, 'budget.view'),
          hasPermission(activeOrgId, 'expense.view'),
          hasPermission(activeOrgId, 'papej.view'),
        ])
      : [false, false, false, false, false, false]

  // Regle de visibilite de la tresorerie inchangee.
  const canViewTreasury = canViewAccounting || canManageTreasury

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

  // Memes totaux que /budget, et par la MEME fonction : seuls les budgets
  // approuves ou revises comptent. Un budget 'draft' n'est pas opposable
  // aux depenses, l'afficher comme "disponible" annoncait une capacite de
  // depense inexistante. La regle vit dans lib/budget/operational-totals
  // et n'est pas reecrite ici.
  let budgetConsumed = 0
  let budgetAvailable = 0
  if (canViewBudget) {
    const [{ data: budgetRefs }, { data: balances }] = await Promise.all([
      supabase.from('budgets').select('id, status'),
      supabase.from('budget_line_balances').select('budget_id, planned_amount, available_amount'),
    ])
    const totals = operationalBudgetTotals(budgetRefs, balances)
    budgetAvailable = totals.available
    budgetConsumed = totals.consumed
  }

  // Charges du mois : le grand livre, jamais le module depenses.
  //
  // Additionner les expense_requests laissait de cote toute charge
  // comptabilisee directement au journal (ecritures manuelles notamment),
  // et ignorait les contre-passations. On reutilise donc la source
  // canonique deja en place, generate_income_statement_report, qui ne
  // retient que les ecritures 'posted' sur des comptes de charge, applique
  // l'isolation organisationnelle et exige accounting.view. Elle n'est
  // appelee que sous la session de l'utilisateur : aucun contournement.
  //
  // Les expense_requests ne sont surtout PAS additionnees en plus : une
  // depense payee est deja une ecriture au grand livre, la compter deux
  // fois doublerait le montant.
  let ledgerExpensesThisMonth = 0
  if (canViewAccounting && activeOrgId) {
    // Mois METIER : celui de Port-au-Prince, jamais le fuseau implicite du
    // processus Node/Vercel — voir lib/date/business-month.
    const { start, end } = businessMonthToDate(new Date())
    const { data } = await supabase.rpc('generate_income_statement_report', {
      p_org_id: activeOrgId,
      p_period_start: start,
      p_period_end: end,
      p_cost_center_id: undefined,
    })
    const result = data as { success?: boolean; total_expense?: number | string } | null
    if (result?.success) ledgerExpensesThisMonth = Number(result.total_expense ?? 0)
  }

  let expensesPending = 0
  let missingJustifications = 0
  if (canViewExpenses) {
    const [{ count: pendingCount }, { data: paidExpenses }] = await Promise.all([
      supabase.from('expense_requests').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
      supabase.from('expense_requests').select('id').eq('status', 'paid'),
    ])
    expensesPending = pendingCount ?? 0

    // Une depense payee n'est "sans justificatif" que si AUCUNE piece n'y
    // est rattachee — meme seuil que justify_expense_request. La regle vit
    // dans lib/expenses/missing-receipts.
    if ((paidExpenses ?? []).length > 0) {
      const { data: attachments } = await supabase
        .from('expense_attachments')
        .select('expense_request_id')
        .in('expense_request_id', (paidExpenses ?? []).map((e) => e.id))
      missingJustifications = countExpensesWithoutReceipt(paidExpenses, attachments)
    }
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

  const hasAnyFinancialWidget =
    canViewTreasury || canViewBudget || canViewExpenses || canViewPapej || canViewAccounting

  return (
    <DirectionDashboard
      organizationName={active?.organization_name}
      roleCodes={active?.role_codes ?? []}
      memberCount={memberCount ?? 0}
      organizationCount={memberships.length}
      canViewAudit={canViewAudit}
      canViewAccounting={canViewAccounting}
      canViewTreasury={canViewTreasury}
      canViewBudget={canViewBudget}
      canViewExpenses={canViewExpenses}
      canViewPapej={canViewPapej}
      hasAnyFinancialWidget={hasAnyFinancialWidget}
      treasuryTotalsByCurrency={[...(treasuryTotalsByCurrency?.entries() ?? [])]}
      cashTotal={cashTotal}
      bankTotal={bankTotal}
      budgetConsumed={budgetConsumed}
      budgetAvailable={budgetAvailable}
      ledgerExpensesThisMonth={ledgerExpensesThisMonth}
      expensesPending={expensesPending}
      missingJustifications={missingJustifications}
      papejGranted={papejGranted}
      papejReceived={papejReceived}
      papejCommitted={papejCommitted}
      papejPaid={papejPaid}
      papejAvailable={papejAvailable}
    />
  )
}
