import type { Metadata } from 'next'
import Link from 'next/link'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { AccessDenied } from '@/components/shell/access-denied'
import { FinancialStatementTable } from '@/components/finance/financial-statement-table'
import {
  journalGeneralToTable,
  generalLedgerToTable,
  trialBalanceToTable,
  incomeStatementToTable,
  balanceSheetToTable,
  cashFlowToTable,
  type PdfTableReport,
} from '@/lib/pdf/financial-statements-report'

export const metadata: Metadata = { title: 'Etats financiers — MedFinder Gestion' }

const REPORT_TYPES = [
  { value: 'journal-general', label: 'Journal general' },
  { value: 'grand-livre', label: 'Grand livre' },
  { value: 'balance-generale', label: 'Balance generale' },
  { value: 'compte-de-resultat', label: 'Compte de resultat' },
  { value: 'bilan', label: 'Bilan' },
  { value: 'flux-tresorerie', label: 'Flux de tresorerie' },
] as const

type PageProps = {
  searchParams: Promise<{
    type?: string
    period_start?: string
    period_end?: string
    as_of_date?: string
    fiscal_year_id?: string
    journal_code?: string
    cost_center_id?: string
  }>
}

function defaultMonthRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { start: iso(start), end: iso(end) }
}

export default async function FinancialStatementsPage({ searchParams }: PageProps) {
  const params = await searchParams
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />

  const canView = await hasPermission(orgId, 'accounting.view')
  if (!canView) return <AccessDenied />

  const type = REPORT_TYPES.some((t) => t.value === params.type) ? params.type! : 'balance-generale'
  const { start: defaultStart, end: defaultEnd } = defaultMonthRange()
  const periodStart = params.period_start || defaultStart
  const periodEnd = params.period_end || defaultEnd
  const asOfDate = params.as_of_date || defaultEnd

  const supabase = await createClient()
  const [{ data: org }, { data: journals }, { data: fiscalYears }, { data: costCenters }] = await Promise.all([
    supabase.from('organizations').select('name').eq('id', orgId).maybeSingle(),
    supabase.from('journals').select('code, label').order('code'),
    supabase.from('fiscal_years').select('id, label').order('start_date', { ascending: false }),
    supabase.from('cost_centers').select('id, code, name').order('code'),
  ])
  const orgName = org?.name ?? 'MedFinder Gestion'
  const fiscalYearId = params.fiscal_year_id || fiscalYears?.[0]?.id || ''

  let table: PdfTableReport | null = null
  let pdfHref = ''
  const pdfParams = new URLSearchParams({ type })

  if (type === 'journal-general') {
    pdfParams.set('period_start', periodStart)
    pdfParams.set('period_end', periodEnd)
    if (params.journal_code) pdfParams.set('journal_code', params.journal_code)
    const { data } = await supabase.rpc('generate_general_journal_report', {
      p_org_id: orgId, p_period_start: periodStart, p_period_end: periodEnd, p_journal_code: params.journal_code || undefined,
    })
    const result = data as { success: boolean } & Parameters<typeof journalGeneralToTable>[1]
    if (result?.success) table = journalGeneralToTable(orgName, result)
  } else if (type === 'grand-livre') {
    pdfParams.set('period_start', periodStart)
    pdfParams.set('period_end', periodEnd)
    const { data } = await supabase.rpc('generate_general_ledger_report', {
      p_org_id: orgId, p_period_start: periodStart, p_period_end: periodEnd,
    })
    const result = data as { success: boolean } & Parameters<typeof generalLedgerToTable>[1]
    if (result?.success) table = generalLedgerToTable(orgName, result)
  } else if (type === 'balance-generale') {
    pdfParams.set('period_start', periodStart)
    pdfParams.set('period_end', periodEnd)
    const { data } = await supabase.rpc('generate_trial_balance_report', {
      p_org_id: orgId, p_period_start: periodStart, p_period_end: periodEnd,
    })
    const result = data as { success: boolean } & Parameters<typeof trialBalanceToTable>[1]
    if (result?.success) table = trialBalanceToTable(orgName, result)
  } else if (type === 'compte-de-resultat') {
    pdfParams.set('period_start', periodStart)
    pdfParams.set('period_end', periodEnd)
    if (params.cost_center_id) pdfParams.set('cost_center_id', params.cost_center_id)
    const { data } = await supabase.rpc('generate_income_statement_report', {
      p_org_id: orgId, p_period_start: periodStart, p_period_end: periodEnd, p_cost_center_id: params.cost_center_id || undefined,
    })
    const result = data as { success: boolean } & Parameters<typeof incomeStatementToTable>[1]
    if (result?.success) table = incomeStatementToTable(orgName, result)
  } else if (type === 'bilan') {
    pdfParams.set('as_of_date', asOfDate)
    pdfParams.set('fiscal_year_id', fiscalYearId)
    if (fiscalYearId) {
      const { data } = await supabase.rpc('generate_balance_sheet_report', {
        p_org_id: orgId, p_fiscal_year_id: fiscalYearId, p_as_of_date: asOfDate,
      })
      const result = data as { success: boolean } & Parameters<typeof balanceSheetToTable>[1]
      if (result?.success) table = balanceSheetToTable(orgName, result)
    }
  } else if (type === 'flux-tresorerie') {
    pdfParams.set('period_start', periodStart)
    pdfParams.set('period_end', periodEnd)
    const { data } = await supabase.rpc('generate_cash_flow_report', {
      p_org_id: orgId, p_period_start: periodStart, p_period_end: periodEnd,
    })
    const result = data as { success: boolean } & Parameters<typeof cashFlowToTable>[1]
    if (result?.success) table = cashFlowToTable(orgName, result)
  }
  pdfHref = `/api/comptabilite/rapports?${pdfParams.toString()}`

  const usesPeriod = type !== 'bilan'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-mf-navy-900">Etats financiers</h1>
        <p className="text-sm text-slate-500">
          Derives exclusivement des ecritures comptabilisees (jamais des modules metier directement).{' '}
          <Link href="/comptabilite" className="text-mf-navy-700 hover:underline">
            Retour a la comptabilite
          </Link>
        </p>
      </div>

      <nav className="flex flex-wrap gap-2">
        {REPORT_TYPES.map((t) => (
          <Link
            key={t.value}
            href={`/comptabilite/rapports?type=${t.value}`}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              type === t.value ? 'bg-mf-navy-900 text-white' : 'border border-mf-border text-mf-navy-700 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <form className="flex flex-wrap items-end gap-3 rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm" action="/comptabilite/rapports">
        <input type="hidden" name="type" value={type} />
        {usesPeriod && (
          <>
            <div>
              <label htmlFor="period_start" className="block text-xs font-medium text-mf-navy-900">Du</label>
              <input id="period_start" type="date" name="period_start" defaultValue={periodStart} className="mt-1 rounded-lg border border-mf-border px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="period_end" className="block text-xs font-medium text-mf-navy-900">Au</label>
              <input id="period_end" type="date" name="period_end" defaultValue={periodEnd} className="mt-1 rounded-lg border border-mf-border px-3 py-2 text-sm" />
            </div>
          </>
        )}
        {type === 'bilan' && (
          <>
            <div>
              <label htmlFor="fiscal_year_id" className="block text-xs font-medium text-mf-navy-900">Exercice</label>
              <select id="fiscal_year_id" name="fiscal_year_id" defaultValue={fiscalYearId} className="mt-1 rounded-lg border border-mf-border px-3 py-2 text-sm">
                {(fiscalYears ?? []).map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="as_of_date" className="block text-xs font-medium text-mf-navy-900">A la date du</label>
              <input id="as_of_date" type="date" name="as_of_date" defaultValue={asOfDate} className="mt-1 rounded-lg border border-mf-border px-3 py-2 text-sm" />
            </div>
          </>
        )}
        {type === 'journal-general' && (
          <div>
            <label htmlFor="journal_code" className="block text-xs font-medium text-mf-navy-900">Journal (optionnel)</label>
            <select id="journal_code" name="journal_code" defaultValue={params.journal_code ?? ''} className="mt-1 rounded-lg border border-mf-border px-3 py-2 text-sm">
              <option value="">Tous</option>
              {(journals ?? []).map((j) => (
                <option key={j.code} value={j.code}>{j.code} — {j.label}</option>
              ))}
            </select>
          </div>
        )}
        {type === 'compte-de-resultat' && (
          <div>
            <label htmlFor="cost_center_id" className="block text-xs font-medium text-mf-navy-900">Centre de cout (optionnel)</label>
            <select id="cost_center_id" name="cost_center_id" defaultValue={params.cost_center_id ?? ''} className="mt-1 rounded-lg border border-mf-border px-3 py-2 text-sm">
              <option value="">Tous</option>
              {(costCenters ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
              ))}
            </select>
          </div>
        )}
        <button type="submit" className="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800">
          Appliquer
        </button>
      </form>

      {table ? (
        <FinancialStatementTable
          columns={table.columns}
          rows={table.rows}
          summaryLines={table.summaryLines}
          csvFilename={`${type}-${usesPeriod ? `${periodStart}-${periodEnd}` : asOfDate}.csv`}
          pdfHref={pdfHref}
        />
      ) : (
        <p className="text-sm text-slate-400">
          {type === 'bilan' && !fiscalYearId
            ? 'Aucun exercice comptable configure — creez-en un depuis /comptabilite.'
            : "Aucune donnee, ou permission insuffisante pour cet etat."}
        </p>
      )}
    </div>
  )
}
