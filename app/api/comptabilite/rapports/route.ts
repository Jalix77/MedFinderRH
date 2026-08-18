import { createClient } from '@/lib/supabase/server'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import {
  buildTabularReportPdf,
  journalGeneralToTable,
  generalLedgerToTable,
  trialBalanceToTable,
  incomeStatementToTable,
  balanceSheetToTable,
  cashFlowToTable,
} from '@/lib/pdf/financial-statements-report'

/**
 * Export PDF des 6 etats financiers (Phase 2B, docs/phase-2b-plan.md §11)
 * — un seul Route Handler, dispatch par `type`, mais chaque branche
 * rejoue EXACTEMENT la meme RPC que l'ecran avec exactement les memes
 * parametres : aucune divergence possible entre l'ecran, le CSV (construit
 * cote client a partir de la meme reponse RPC) et le PDF. Autorisation
 * entierement portee par chaque RPC elle-meme (deja verifiee 16 fois par
 * tests/integration/financial-statements-reconciliation.test.ts) — cette
 * route traduit un refus {success:false} en 403 HTTP, jamais une
 * confiance implicite locale.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type')
  const orgId = await getActiveOrganizationId()
  if (!orgId) return new Response('Organisation active introuvable.', { status: 400 })

  const supabase = await createClient()
  const { data: org } = await supabase.from('organizations').select('name').eq('id', orgId).maybeSingle()
  const orgName = org?.name ?? 'MedFinder Gestion'

  const periodStart = searchParams.get('period_start')
  const periodEnd = searchParams.get('period_end')
  const asOfDate = searchParams.get('as_of_date')
  const fiscalYearId = searchParams.get('fiscal_year_id')
  const journalCode = searchParams.get('journal_code') || undefined
  const accountId = searchParams.get('account_id') || undefined
  const costCenterId = searchParams.get('cost_center_id') || undefined

  function badRequest(message: string) {
    return new Response(message, { status: 400 })
  }
  function forbidden() {
    return new Response("Vous n'avez pas la permission necessaire pour generer cet etat.", { status: 403 })
  }

  let pdfBytes: Uint8Array
  let filename: string

  if (type === 'journal-general') {
    if (!periodStart || !periodEnd) return badRequest('period_start et period_end requis.')
    const { data, error } = await supabase.rpc('generate_general_journal_report', {
      p_org_id: orgId, p_period_start: periodStart, p_period_end: periodEnd, p_journal_code: journalCode,
    })
    if (error) return badRequest('Parametres invalides.')
    const result = data as { success: boolean } & Parameters<typeof journalGeneralToTable>[1]
    if (!result.success) return forbidden()
    pdfBytes = await buildTabularReportPdf(journalGeneralToTable(orgName, result), new Date())
    filename = `journal-general-${periodStart}-${periodEnd}.pdf`
  } else if (type === 'grand-livre') {
    if (!periodStart || !periodEnd) return badRequest('period_start et period_end requis.')
    const { data, error } = await supabase.rpc('generate_general_ledger_report', {
      p_org_id: orgId, p_period_start: periodStart, p_period_end: periodEnd, p_account_id: accountId,
    })
    if (error) return badRequest('Parametres invalides.')
    const result = data as { success: boolean } & Parameters<typeof generalLedgerToTable>[1]
    if (!result.success) return forbidden()
    pdfBytes = await buildTabularReportPdf(generalLedgerToTable(orgName, result), new Date())
    filename = `grand-livre-${periodStart}-${periodEnd}.pdf`
  } else if (type === 'balance-generale') {
    if (!periodStart || !periodEnd) return badRequest('period_start et period_end requis.')
    const { data, error } = await supabase.rpc('generate_trial_balance_report', {
      p_org_id: orgId, p_period_start: periodStart, p_period_end: periodEnd,
    })
    if (error) return badRequest('Parametres invalides.')
    const result = data as { success: boolean } & Parameters<typeof trialBalanceToTable>[1]
    if (!result.success) return forbidden()
    pdfBytes = await buildTabularReportPdf(trialBalanceToTable(orgName, result), new Date())
    filename = `balance-generale-${periodStart}-${periodEnd}.pdf`
  } else if (type === 'compte-de-resultat') {
    if (!periodStart || !periodEnd) return badRequest('period_start et period_end requis.')
    const { data, error } = await supabase.rpc('generate_income_statement_report', {
      p_org_id: orgId, p_period_start: periodStart, p_period_end: periodEnd, p_cost_center_id: costCenterId,
    })
    if (error) return badRequest('Parametres invalides.')
    const result = data as { success: boolean } & Parameters<typeof incomeStatementToTable>[1]
    if (!result.success) return forbidden()
    pdfBytes = await buildTabularReportPdf(incomeStatementToTable(orgName, result), new Date())
    filename = `compte-de-resultat-${periodStart}-${periodEnd}.pdf`
  } else if (type === 'bilan') {
    if (!fiscalYearId || !asOfDate) return badRequest('fiscal_year_id et as_of_date requis.')
    const { data, error } = await supabase.rpc('generate_balance_sheet_report', {
      p_org_id: orgId, p_fiscal_year_id: fiscalYearId, p_as_of_date: asOfDate,
    })
    if (error) return badRequest('Parametres invalides.')
    const result = data as { success: boolean } & Parameters<typeof balanceSheetToTable>[1]
    if (!result.success) return forbidden()
    pdfBytes = await buildTabularReportPdf(balanceSheetToTable(orgName, result), new Date())
    filename = `bilan-${asOfDate}.pdf`
  } else if (type === 'flux-tresorerie') {
    if (!periodStart || !periodEnd) return badRequest('period_start et period_end requis.')
    const { data, error } = await supabase.rpc('generate_cash_flow_report', {
      p_org_id: orgId, p_period_start: periodStart, p_period_end: periodEnd,
    })
    if (error) return badRequest('Parametres invalides.')
    const result = data as { success: boolean } & Parameters<typeof cashFlowToTable>[1]
    if (!result.success) return forbidden()
    pdfBytes = await buildTabularReportPdf(cashFlowToTable(orgName, result), new Date())
    filename = `flux-tresorerie-${periodStart}-${periodEnd}.pdf`
  } else {
    return badRequest('Type de rapport invalide.')
  }

  return new Response(new Uint8Array(pdfBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
