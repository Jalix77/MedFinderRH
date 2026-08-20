'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { assertRpcSuccess } from '@/lib/actions/rpc-result'
import { ThirdPartySchema, InvoiceDraftSchema } from '@/lib/validation/invoicing'

/**
 * Server Actions Phase 2C.4.
 *
 * AUCUNE regle metier n'est implementee ici : chaque transition de
 * workflow delegue a la RPC correspondante (2C.3A/2C.3B), qui porte la
 * separation des fonctions, la comptabilisation, l'atomicite et
 * l'immutabilite. Les ecritures directes en table (brouillons, tiers)
 * s'appuient exclusivement sur les policies RLS existantes.
 *
 * `organization_id` n'est JAMAIS pris depuis le formulaire : il vient
 * toujours du contexte serveur (getActiveOrganizationId), et la RLS le
 * recroise avec l'appartenance reelle de l'acteur.
 */

function firstIssueMessage(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? 'Donnees invalides.'
}

function parseLines(formData: FormData) {
  const raw = String(formData.get('lines') ?? '[]')
  try {
    return JSON.parse(raw) as unknown[]
  } catch {
    throw new Error('Lignes du document illisibles.')
  }
}

// --- Tiers -----------------------------------------------------------------

export async function createThirdPartyAction(formData: FormData) {
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')

  const parsed = ThirdPartySchema.safeParse({
    legal_name: formData.get('legal_name'),
    commercial_name: formData.get('commercial_name'),
    legal_form: formData.get('legal_form'),
    tax_id: formData.get('tax_id'),
    is_customer: formData.get('is_customer') === 'on',
    is_supplier: formData.get('is_supplier') === 'on',
    email: formData.get('email'),
    phone: formData.get('phone'),
    preferred_currency: formData.get('preferred_currency') ?? 'HTG',
    payment_terms_days: formData.get('payment_terms_days') ?? 0,
    notes: formData.get('notes'),
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('third_parties')
    .insert({ organization_id: orgId, ...parsed.data })
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  revalidatePath('/tiers')
  redirect(`/tiers/${data!.id}`)
}

export async function updateThirdPartyAction(formData: FormData) {
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')
  const id = String(formData.get('id') ?? '')
  if (!id) throw new Error('Tiers invalide.')

  const parsed = ThirdPartySchema.safeParse({
    legal_name: formData.get('legal_name'),
    commercial_name: formData.get('commercial_name'),
    legal_form: formData.get('legal_form'),
    tax_id: formData.get('tax_id'),
    is_customer: formData.get('is_customer') === 'on',
    is_supplier: formData.get('is_supplier') === 'on',
    email: formData.get('email'),
    phone: formData.get('phone'),
    preferred_currency: formData.get('preferred_currency') ?? 'HTG',
    payment_terms_days: formData.get('payment_terms_days') ?? 0,
    notes: formData.get('notes'),
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  // Pas de filtre organization_id ici : la policy RLS l'impose deja et
  // recroise l'appartenance reelle de l'acteur (anti-IDOR).
  const { error } = await supabase.from('third_parties').update(parsed.data).eq('id', id)
  if (error) throw new Error(error.message)

  revalidatePath(`/tiers/${id}`)
  revalidatePath('/tiers')
}

export async function setThirdPartyStatusAction(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const isActive = formData.get('is_active') === 'true'
  if (!id) throw new Error('Tiers invalide.')

  const supabase = await createClient()
  const { error } = await supabase.from('third_parties').update({ is_active: isActive }).eq('id', id)
  if (error) throw new Error(error.message)

  revalidatePath(`/tiers/${id}`)
  revalidatePath('/tiers')
}

// --- Documents de facturation ---------------------------------------------

async function writeDraft(formData: FormData, existingId?: string) {
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')

  const parsed = InvoiceDraftSchema.safeParse({
    document_type: formData.get('document_type') ?? 'INVOICE',
    third_party_id: formData.get('third_party_id'),
    credited_invoice_id: String(formData.get('credited_invoice_id') ?? '') || null,
    credit_reason: formData.get('credit_reason'),
    document_date: formData.get('document_date'),
    due_date: formData.get('due_date'),
    currency: formData.get('currency') ?? 'HTG',
    exchange_rate_to_htg: formData.get('exchange_rate_to_htg') ?? 1,
    external_reference: formData.get('external_reference'),
    notes: formData.get('notes'),
    cost_center_id: String(formData.get('cost_center_id') ?? '') || null,
    lines: parseLines(formData),
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))
  const { lines, ...header } = parsed.data

  const supabase = await createClient()
  let documentId = existingId

  if (documentId) {
    const { error } = await supabase.from('invoices').update(header).eq('id', documentId)
    if (error) throw new Error(error.message)
    // Les lignes d'un brouillon sont remplacees en bloc : plus simple et
    // sans etat intermediaire incoherent. Le trigger de recalcul remet
    // les totaux a jour a chaque mutation.
    const { error: delError } = await supabase.from('invoice_lines').delete().eq('invoice_id', documentId)
    if (delError) throw new Error(delError.message)
  } else {
    const { data, error } = await supabase
      .from('invoices')
      .insert({ organization_id: orgId, ...header })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    documentId = data!.id as string
  }

  const payload = lines.map((l, index) => ({
    organization_id: orgId,
    invoice_id: documentId!,
    line_number: index + 1,
    description: l.description,
    quantity: l.quantity,
    unit_price: l.unit_price,
    revenue_account_id: l.revenue_account_id,
    tax_rate_id: l.tax_rate_id ?? null,
  }))
  const { error: linesError } = await supabase.from('invoice_lines').insert(payload)
  if (linesError) throw new Error(linesError.message)

  return documentId!
}

export async function createInvoiceDraftAction(formData: FormData) {
  const id = await writeDraft(formData)
  revalidatePath('/facturation')
  redirect(`/facturation/${id}`)
}

export async function updateInvoiceDraftAction(formData: FormData) {
  const existingId = String(formData.get('id') ?? '')
  if (!existingId) throw new Error('Document invalide.')
  const id = await writeDraft(formData, existingId)
  revalidatePath(`/facturation/${id}`)
  redirect(`/facturation/${id}`)
}

export async function deleteInvoiceDraftAction(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  if (!id) throw new Error('Document invalide.')

  const supabase = await createClient()
  // La policy invoices_delete_draft et le trigger d'immutabilite
  // n'autorisent la suppression que sur un document non emis.
  const { error } = await supabase.from('invoices').delete().eq('id', id)
  if (error) throw new Error(error.message)

  revalidatePath('/facturation')
  redirect('/facturation')
}

// --- Transitions de workflow : deleguees aux RPC, jamais reimplementees ----

export async function submitInvoiceDocumentAction(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  if (!id) throw new Error('Document invalide.')

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('submit_invoice_document', { p_document_id: id })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)

  revalidatePath(`/facturation/${id}`)
  revalidatePath('/facturation')
}

export async function issueInvoiceDocumentAction(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  if (!id) throw new Error('Document invalide.')

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('issue_invoice_document', { p_document_id: id })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)

  revalidatePath(`/facturation/${id}`)
  revalidatePath('/facturation')
}

export async function cancelInvoiceDocumentAction(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const reason = String(formData.get('reason') ?? '').trim()
  if (!id) throw new Error('Document invalide.')
  if (!reason) throw new Error("Le motif d'annulation est obligatoire.")

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('cancel_invoice_document', {
    p_document_id: id,
    p_reason: reason,
  })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)

  revalidatePath(`/facturation/${id}`)
  revalidatePath('/facturation')
}

export async function requestInvoiceIssueExceptionAction(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const justification = String(formData.get('justification') ?? '').trim()
  if (!id) throw new Error('Document invalide.')
  if (!justification) throw new Error('La justification est obligatoire.')

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('request_invoice_issue_exception', {
    p_document_id: id,
    p_justification: justification,
  })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)

  revalidatePath(`/facturation/${id}`)
}

export async function validateInvoiceIssueExceptionAction(formData: FormData) {
  const exceptionId = String(formData.get('exception_id') ?? '')
  const documentId = String(formData.get('document_id') ?? '')
  const decision = String(formData.get('decision') ?? '')
  if (!exceptionId || !documentId) throw new Error('Exception invalide.')

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('validate_invoice_issue_exception', {
    p_exception_id: exceptionId,
    p_decision: decision,
    p_reason: String(formData.get('reason') ?? '') || undefined,
  })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)

  revalidatePath(`/facturation/${documentId}`)
}
