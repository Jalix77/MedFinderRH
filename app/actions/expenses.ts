'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { assertRpcSuccess } from '@/lib/actions/rpc-result'
import {
  ExpenseCategorySchema,
  ExpenseRequestSchema,
  ExpensePaymentSchema,
  ExpenseCancelSchema,
  ExpenseExceptionRequestSchema,
  ExpenseExceptionValidationSchema,
} from '@/lib/validation/expenses'

function firstIssueMessage(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? 'Donnees invalides.'
}

export async function createExpenseCategoryAction(formData: FormData) {
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')

  const parsed = ExpenseCategorySchema.safeParse({
    name: formData.get('name'),
    default_account_id: formData.get('default_account_id') || null,
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { error } = await supabase.from('expense_categories').insert({ organization_id: orgId, ...parsed.data })
  if (error) throw new Error(error.message)

  revalidatePath('/depenses')
}

// Cree toujours en 'draft' (jamais Paid/Posted directement, §8 du plan
// corrige) — la soumission est une action separee et explicite.
export async function createExpenseRequestAction(formData: FormData) {
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')

  const parsed = ExpenseRequestSchema.safeParse({
    budget_line_id: formData.get('budget_line_id'),
    category_id: formData.get('category_id') || null,
    cost_center_id: formData.get('cost_center_id') || null,
    payee_name: formData.get('payee_name'),
    payee_reference: formData.get('payee_reference') || null,
    description: formData.get('description') || null,
    amount: formData.get('amount'),
    currency: formData.get('currency') || 'HTG',
    payment_method: formData.get('payment_method'),
    requested_date: formData.get('requested_date') || undefined,
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Session invalide.')

  const { data, error } = await supabase
    .from('expense_requests')
    // expense_number : chaine vide -> le trigger assign_expense_number
    // (Phase 1C) genere DEP-2026-0001... automatiquement.
    .insert({ organization_id: orgId, requester_id: user.id, expense_number: '', ...parsed.data })
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  revalidatePath('/depenses')
  redirect(`/depenses/${data.id}`)
}

export async function submitExpenseRequestAction(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('submit_expense_request', { p_expense_id: id })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)
  revalidatePath(`/depenses/${id}`)
  revalidatePath('/depenses')
}

export async function approveExpenseRequestAction(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const decision = String(formData.get('decision') ?? '')
  const comment = String(formData.get('comment') ?? '') || null
  if (!['approved', 'rejected'].includes(decision)) throw new Error('Decision invalide.')

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('approve_expense_request', {
    p_expense_id: id,
    p_decision: decision,
    p_comment: comment ?? undefined,
  })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)
  revalidatePath(`/depenses/${id}`)
  revalidatePath('/depenses')
}

export async function payExpenseRequestAction(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const parsed = ExpensePaymentSchema.safeParse({
    treasury_account_type: formData.get('treasury_account_type'),
    treasury_account_id: formData.get('treasury_account_id'),
    paid_date: formData.get('paid_date') || null,
    no_commitment_reason: formData.get('no_commitment_reason') || null,
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('pay_expense_request', {
    p_expense_id: id,
    p_treasury_account_type: parsed.data.treasury_account_type,
    p_treasury_account_id: parsed.data.treasury_account_id,
    p_paid_date: parsed.data.paid_date ?? undefined,
    p_no_commitment_reason: parsed.data.no_commitment_reason ?? undefined,
  })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)
  revalidatePath(`/depenses/${id}`)
  revalidatePath('/depenses')
  revalidatePath('/tresorerie')
}

export async function cancelExpenseRequestAction(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const parsed = ExpenseCancelSchema.safeParse({ reason: formData.get('reason') })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('cancel_expense_request', {
    p_expense_id: id,
    p_reason: parsed.data.reason,
  })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)
  revalidatePath(`/depenses/${id}`)
  revalidatePath('/depenses')
  revalidatePath('/budget')
}

export async function requestExpenseApprovalExceptionAction(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const parsed = ExpenseExceptionRequestSchema.safeParse({ justification: formData.get('justification') })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('request_expense_approval_exception', {
    p_expense_id: id,
    p_justification: parsed.data.justification,
  })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)
  revalidatePath(`/depenses/${id}`)
}

export async function validateExpenseApprovalExceptionAction(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const parsed = ExpenseExceptionValidationSchema.safeParse({
    result: formData.get('result'),
    comment: formData.get('comment') || null,
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('validate_expense_approval_exception', {
    p_expense_id: id,
    p_result: parsed.data.result,
    p_comment: parsed.data.comment ?? undefined,
  })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)
  revalidatePath(`/depenses/${id}`)
}

export async function justifyExpenseRequestAction(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('justify_expense_request', { p_expense_id: id })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)
  revalidatePath(`/depenses/${id}`)
  revalidatePath('/depenses')
}

const ATTACHMENT_TYPES = ['facture', 'recu', 'justificatif'] as const

export async function uploadExpenseAttachmentAction(formData: FormData) {
  const expenseId = String(formData.get('expense_id') ?? '')
  const type = String(formData.get('type') ?? 'justificatif')
  const file = formData.get('file') as File | null
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')
  if (!file || file.size === 0) throw new Error('Aucun fichier fourni.')
  if (!(ATTACHMENT_TYPES as readonly string[]).includes(type)) throw new Error('Type de justificatif invalide.')

  const supabase = await createClient()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `${orgId}/${expenseId}/${crypto.randomUUID()}-${safeName}`

  const { error: uploadError } = await supabase.storage
    .from('expense-attachments')
    .upload(storagePath, file, { contentType: file.type || 'application/octet-stream' })
  if (uploadError) throw new Error(uploadError.message)

  const { error: insertError } = await supabase.from('expense_attachments').insert({
    organization_id: orgId,
    expense_request_id: expenseId,
    type,
    storage_path: storagePath,
    original_filename: file.name,
  })
  if (insertError) {
    await supabase.storage.from('expense-attachments').remove([storagePath])
    throw new Error(insertError.message)
  }

  revalidatePath(`/depenses/${expenseId}`)
}

export async function getExpenseAttachmentSignedUrlAction(attachmentId: string): Promise<string> {
  const supabase = await createClient()
  const { data: doc, error: docError } = await supabase
    .from('expense_attachments')
    .select('storage_path')
    .eq('id', attachmentId)
    .single()
  if (docError || !doc) throw new Error(docError?.message ?? 'Justificatif introuvable.')

  const { data, error } = await supabase.storage
    .from('expense-attachments')
    .createSignedUrl(doc.storage_path, 60)
  if (error || !data) throw new Error(error?.message ?? "Echec de generation de l'URL signee.")

  return data.signedUrl
}
