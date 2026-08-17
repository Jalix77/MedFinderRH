'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { assertRpcSuccess } from '@/lib/actions/rpc-result'
import { JournalSchema, AccountingPeriodSchema, ManualJournalEntrySchema } from '@/lib/validation/accounting'

function firstIssueMessage(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? 'Donnees invalides.'
}

// --- Journaux --------------------------------------------------------------
// CRUD simple garde par accounting.post (RLS), meme patron que
// createChartOfAccountAction/createFiscalYearAction — aucune RPC dediee,
// les 6 journaux standards restent auto-seedes, ceci n'ajoute qu'un journal
// supplementaire optionnel (ex. besoin metier specifique non couvert par
// BANK/CASH/SALES/PURCHASES/PAYROLL/MISC).

export async function createJournalAction(formData: FormData) {
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')

  const parsed = JournalSchema.safeParse({ code: formData.get('code'), label: formData.get('label') })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { error } = await supabase.from('journals').insert({ organization_id: orgId, ...parsed.data })
  if (error) throw new Error(error.message)

  revalidatePath('/comptabilite')
}

// --- Periodes comptables -----------------------------------------------
// accounting_periods_insert (accounting.post) / accounting_periods_close
// (accounting.close_period, transition open->closed uniquement) — policies
// deja existantes depuis 1C.1, aucun changement backend.

export async function createAccountingPeriodAction(formData: FormData) {
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')

  const parsed = AccountingPeriodSchema.safeParse({
    fiscal_year_id: formData.get('fiscal_year_id'),
    month: formData.get('month'),
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { error } = await supabase.from('accounting_periods').insert({ organization_id: orgId, ...parsed.data })
  if (error) throw new Error(error.message)

  revalidatePath('/comptabilite')
}

export async function closeAccountingPeriodAction(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  if (!id) throw new Error('Periode invalide.')

  const supabase = await createClient()
  const { error } = await supabase.from('accounting_periods').update({ status: 'closed' }).eq('id', id)
  if (error) throw new Error(error.message)

  revalidatePath('/comptabilite')
}

// --- Ecritures manuelles — Draft -> Submitted -> Approved/Rejected ->
// --- Posted -> Reversed (docs/phase-2-plan.md §0.3/2A) ----------------------

export async function createManualJournalEntryAction(formData: FormData) {
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')

  let rawLines: unknown
  try {
    rawLines = JSON.parse(String(formData.get('lines') ?? '[]'))
  } catch {
    throw new Error('Lignes d\'ecriture invalides.')
  }

  const parsed = ManualJournalEntrySchema.safeParse({
    journal_code: formData.get('journal_code'),
    entry_date: formData.get('entry_date'),
    description: formData.get('description'),
    lines: rawLines,
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_manual_journal_entry', {
    p_org_id: orgId,
    p_journal_code: parsed.data.journal_code,
    p_entry_date: parsed.data.entry_date,
    p_description: parsed.data.description,
    p_lines: parsed.data.lines,
  })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)

  revalidatePath('/comptabilite')
  redirect(`/comptabilite/${(data as unknown as { entry_id: string }).entry_id}`)
}

export async function submitManualJournalEntryAction(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('submit_manual_journal_entry', { p_entry_id: id })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)
  revalidatePath('/comptabilite')
  revalidatePath(`/comptabilite/${id}`)
}

export async function approveManualJournalEntryAction(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const decision = String(formData.get('decision') ?? '')
  const comment = (formData.get('comment') as string) || undefined
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('approve_manual_journal_entry', {
    p_entry_id: id,
    p_decision: decision,
    p_comment: comment,
  })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)
  revalidatePath('/comptabilite')
  revalidatePath(`/comptabilite/${id}`)
}

export async function requestManualEntryApprovalExceptionAction(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const justification = String(formData.get('justification') ?? '')
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('request_manual_entry_approval_exception', {
    p_entry_id: id,
    p_justification: justification,
  })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)
  revalidatePath(`/comptabilite/${id}`)
}

export async function validateManualEntryApprovalExceptionAction(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const result = String(formData.get('result') ?? '')
  const comment = (formData.get('comment') as string) || undefined
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('validate_manual_entry_approval_exception', {
    p_entry_id: id,
    p_result: result,
    p_comment: comment,
  })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)
  revalidatePath('/comptabilite')
  revalidatePath(`/comptabilite/${id}`)
}

// --- RPC deja existantes (1C.1), reutilisees telles quelles ----------------

export async function postJournalEntryAction(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('post_journal_entry', { p_entry_id: id })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)
  revalidatePath('/comptabilite')
  revalidatePath(`/comptabilite/${id}`)
}

export async function reverseJournalEntryAction(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const reason = String(formData.get('reason') ?? '')
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('reverse_journal_entry', { p_entry_id: id, p_reason: reason })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)
  revalidatePath('/comptabilite')
  revalidatePath(`/comptabilite/${id}`)
}

// --- Plan comptable — desactivation (jamais de suppression) ----------------
// Coherent avec le trigger chart_of_accounts_immutable_if_used (2A) et le
// grant DELETE deja revoque a authenticated depuis 1C.1 : la seule action
// disponible sur un compte existant reste is_active.

export async function setChartOfAccountStatusAction(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const isActive = formData.get('is_active') === 'true'
  const supabase = await createClient()
  const { error } = await supabase.from('chart_of_accounts').update({ is_active: isActive }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/comptabilite')
}
