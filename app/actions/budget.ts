'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { assertRpcSuccess } from '@/lib/actions/rpc-result'
import {
  FiscalYearSchema,
  BudgetSchema,
  CostCenterSchema,
  BudgetLineSchema,
  BudgetTransferSchema,
} from '@/lib/validation/budget'

function firstIssueMessage(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? 'Donnees invalides.'
}

export async function createFiscalYearAction(formData: FormData) {
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')

  const parsed = FiscalYearSchema.safeParse({
    label: formData.get('label'),
    start_date: formData.get('start_date'),
    end_date: formData.get('end_date'),
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { error } = await supabase.from('fiscal_years').insert({ organization_id: orgId, ...parsed.data })
  if (error) throw new Error(error.message)

  revalidatePath('/budget')
  // Reutilisee depuis /comptabilite (Phase 2A) — memes exercices comptables
  // partages entre Budget et Comptabilite, aucune duplication de table/RPC.
  revalidatePath('/comptabilite')
}

export async function createBudgetAction(formData: FormData) {
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')

  const parsed = BudgetSchema.safeParse({
    fiscal_year_id: formData.get('fiscal_year_id'),
    name: formData.get('name'),
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { error } = await supabase.from('budgets').insert({ organization_id: orgId, ...parsed.data })
  if (error) throw new Error(error.message)

  revalidatePath('/budget')
}

export async function setBudgetStatusAction(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '')
  if (!['draft', 'approved', 'revised'].includes(status)) throw new Error('Statut invalide.')

  const supabase = await createClient()
  const { error } = await supabase.from('budgets').update({ status }).eq('id', id)
  if (error) throw new Error(error.message)

  revalidatePath('/budget')
}

export async function createCostCenterAction(formData: FormData) {
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')

  const parsed = CostCenterSchema.safeParse({
    code: formData.get('code'),
    name: formData.get('name'),
    department_id: formData.get('department_id') || null,
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { error } = await supabase.from('cost_centers').insert({ organization_id: orgId, ...parsed.data })
  if (error) throw new Error(error.message)

  revalidatePath('/budget')
}

export async function createBudgetLineAction(formData: FormData) {
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')
  const budgetId = String(formData.get('budget_id') ?? '')

  const parsed = BudgetLineSchema.safeParse({
    budget_id: budgetId,
    category: formData.get('category'),
    planned_amount: formData.get('planned_amount'),
    currency: formData.get('currency') || 'HTG',
    cost_center_id: formData.get('cost_center_id') || null,
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { error } = await supabase.from('budget_lines').insert({ organization_id: orgId, ...parsed.data })
  if (error) throw new Error(error.message)

  revalidatePath(`/budget/${budgetId}`)
}

export async function transferBudgetAmountAction(formData: FormData) {
  const budgetId = String(formData.get('budget_id') ?? '')
  const parsed = BudgetTransferSchema.safeParse({
    from_line_id: formData.get('from_line_id'),
    to_line_id: formData.get('to_line_id'),
    amount: formData.get('amount'),
    reason: formData.get('reason'),
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('transfer_budget_amount', {
    p_from_line_id: parsed.data.from_line_id,
    p_to_line_id: parsed.data.to_line_id,
    p_amount: parsed.data.amount,
    p_reason: parsed.data.reason,
  })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)

  revalidatePath(`/budget/${budgetId}`)
}
