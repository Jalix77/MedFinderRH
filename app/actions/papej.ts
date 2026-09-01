'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { assertRpcSuccess } from '@/lib/actions/rpc-result'
import { GrantSchema, GrantBudgetLineSchema, GrantReceiptSchema, PapejReportSchema } from '@/lib/validation/papej'

function firstIssueMessage(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? 'Donnees invalides.'
}

export async function createGrantAction(formData: FormData) {
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')

  const parsed = GrantSchema.safeParse({
    type: formData.get('type') || 'PAPEJ',
    name: formData.get('name'),
    donor_name: formData.get('donor_name') || null,
    amount_granted: formData.get('amount_granted'),
    currency: formData.get('currency') || 'HTG',
    revenue_account_id: formData.get('revenue_account_id'),
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { error } = await supabase.from('grants').insert({ organization_id: orgId, ...parsed.data })
  if (error) throw new Error(error.message)

  revalidatePath('/papej')
}

export async function createGrantBudgetLineAction(formData: FormData) {
  const grantId = String(formData.get('grant_id') ?? '')
  const parsed = GrantBudgetLineSchema.safeParse({
    category: formData.get('category'),
    planned_amount: formData.get('planned_amount'),
    notes: formData.get('notes') || null,
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_grant_budget_line', {
    p_grant_id: grantId,
    p_category: parsed.data.category,
    p_planned_amount: parsed.data.planned_amount,
    p_notes: parsed.data.notes ?? undefined,
  })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)

  revalidatePath(`/papej/${grantId}`)
}

export async function recordGrantReceiptAction(formData: FormData) {
  const grantId = String(formData.get('grant_id') ?? '')
  const parsed = GrantReceiptSchema.safeParse({
    amount: formData.get('amount'),
    received_date: formData.get('received_date'),
    treasury_account_type: formData.get('treasury_account_type'),
    treasury_account_id: formData.get('treasury_account_id'),
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('record_grant_receipt', {
    p_grant_id: grantId,
    p_amount: parsed.data.amount,
    p_received_date: parsed.data.received_date,
    p_treasury_account_type: parsed.data.treasury_account_type,
    p_treasury_account_id: parsed.data.treasury_account_id,
  })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)

  revalidatePath(`/papej/${grantId}`)
  revalidatePath('/tresorerie')
}

export async function generatePapejReportAction(formData: FormData) {
  const grantId = String(formData.get('grant_id') ?? '')
  const parsed = PapejReportSchema.safeParse({
    period_start: formData.get('period_start'),
    period_end: formData.get('period_end'),
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('generate_papej_report', {
    p_grant_id: grantId,
    p_period_start: parsed.data.period_start,
    p_period_end: parsed.data.period_end,
  })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)

  revalidatePath(`/papej/${grantId}`)
  return data as { success: true; report_id: string; report: unknown }
}
