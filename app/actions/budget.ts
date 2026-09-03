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

/**
 * Modification d'une ligne budgetaire.
 *
 * Le controle est SERVEUR et non applicatif : la policy
 * `budget_lines_update` n'autorise l'UPDATE que si le budget parent est
 * 'draft' et si l'acteur porte `budget.manage`. Aucune verification n'est
 * donc reecrite ici, ce qui creerait une seconde autorite.
 *
 * En revanche, RLS filtre SILENCIEUSEMENT : un UPDATE refuse ne leve pas
 * d'erreur, il ne touche simplement aucune ligne. Sans le `.select()`
 * ci-dessous, l'ecran afficherait un succes pour une operation refusee.
 */
export async function updateBudgetLineAction(formData: FormData) {
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')

  const lineId = String(formData.get('line_id') ?? '')
  const budgetId = String(formData.get('budget_id') ?? '')
  if (!lineId) throw new Error('Ligne budgetaire invalide.')

  const parsed = BudgetLineSchema.safeParse({
    budget_id: budgetId,
    category: formData.get('category'),
    planned_amount: formData.get('planned_amount'),
    currency: formData.get('currency') || 'HTG',
    cost_center_id: formData.get('cost_center_id') || null,
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('budget_lines')
    .update({
      category: parsed.data.category,
      planned_amount: parsed.data.planned_amount,
      currency: parsed.data.currency,
      cost_center_id: parsed.data.cost_center_id ?? null,
    })
    .eq('id', lineId)
    .select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) {
    throw new Error(
      "Modification refusee : la ligne n'est modifiable que tant que le budget est en brouillon, et avec la permission de gestion budgetaire."
    )
  }

  revalidatePath(`/budget/${budgetId}`)
  revalidatePath('/budget')
}

/**
 * Suppression d'une ligne budgetaire.
 *
 * Deux refus distincts, tous deux poses en BASE :
 *   - budget non brouillon ou permission absente -> la policy
 *     `budget_lines_delete` ne selectionne aucune ligne (refus silencieux,
 *     rendu explicite ici comme pour l'UPDATE) ;
 *   - ligne portant des engagements, des demandes de depense ou une ligne
 *     de financement -> les cles etrangeres `on delete restrict` levent
 *     23503. Le message est traduit, la regle n'est pas reimplementee.
 */
export async function deleteBudgetLineAction(formData: FormData) {
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')

  const lineId = String(formData.get('line_id') ?? '')
  const budgetId = String(formData.get('budget_id') ?? '')
  if (!lineId) throw new Error('Ligne budgetaire invalide.')

  const supabase = await createClient()
  const { data, error } = await supabase.from('budget_lines').delete().eq('id', lineId).select('id')

  if (error) {
    if (error.code === '23503') {
      throw new Error(
        'Suppression impossible : cette ligne porte des engagements, des demandes de depense ou un financement. Liberez-les d’abord.'
      )
    }
    throw new Error(error.message)
  }
  if (!data || data.length === 0) {
    throw new Error(
      "Suppression refusee : une ligne n'est supprimable que tant que le budget est en brouillon, et avec la permission de gestion budgetaire."
    )
  }

  revalidatePath(`/budget/${budgetId}`)
  revalidatePath('/budget')
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
