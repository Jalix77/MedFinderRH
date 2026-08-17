'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { CashAccountSchema, BankAccountSchema, MobileMoneyAccountSchema } from '@/lib/validation/treasury'

function firstIssueMessage(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? 'Donnees invalides.'
}

// --- Plan comptable minimal (prealable aux comptes de tresorerie) --------
// Aucune saisie manuelle d'ecriture (hors perimetre Phase 1C, voir
// docs/phase-1c-plan.md §1) — mais configurer un compte du plan comptable
// reste une operation de parametrage simple, gardee par accounting.post
// (RLS), necessaire pour que les comptes de tresorerie disposent d'un
// gl_account_id (docs/phase-1c-closing-report.md).
export async function createChartOfAccountAction(formData: FormData) {
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')

  const code = String(formData.get('code') ?? '').trim()
  const label = String(formData.get('label') ?? '').trim()
  const type = String(formData.get('type') ?? '')
  if (!code || !label) throw new Error('Code et libelle requis.')
  if (!['asset', 'liability', 'equity', 'revenue', 'expense'].includes(type)) {
    throw new Error('Type de compte invalide.')
  }

  const supabase = await createClient()
  const { error } = await supabase.from('chart_of_accounts').insert({ organization_id: orgId, code, label, type })
  if (error) throw new Error(error.message)

  revalidatePath('/tresorerie')
  revalidatePath('/budget')
  revalidatePath('/papej')
  // Reutilisee depuis /comptabilite (Phase 2A) — meme plan comptable
  // partage entre tous les modules, aucune duplication de table/RPC.
  revalidatePath('/comptabilite')
}

// --- Comptes de tresorerie -------------------------------------------------

export async function createCashAccountAction(formData: FormData) {
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')

  const parsed = CashAccountSchema.safeParse({
    name: formData.get('name'),
    gl_account_id: formData.get('gl_account_id'),
    currency: formData.get('currency') || 'HTG',
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { error } = await supabase.from('cash_accounts').insert({ organization_id: orgId, ...parsed.data })
  if (error) throw new Error(error.message)

  revalidatePath('/tresorerie')
}

export async function createBankAccountAction(formData: FormData) {
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')

  const parsed = BankAccountSchema.safeParse({
    bank_name: formData.get('bank_name'),
    account_number_masked: formData.get('account_number_masked') || null,
    gl_account_id: formData.get('gl_account_id'),
    currency: formData.get('currency') || 'HTG',
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { error } = await supabase.from('bank_accounts').insert({ organization_id: orgId, ...parsed.data })
  if (error) throw new Error(error.message)

  revalidatePath('/tresorerie')
}

export async function createMobileMoneyAccountAction(formData: FormData) {
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')

  const parsed = MobileMoneyAccountSchema.safeParse({
    provider: formData.get('provider'),
    account_number_masked: formData.get('account_number_masked') || null,
    gl_account_id: formData.get('gl_account_id'),
    currency: formData.get('currency') || 'HTG',
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { error } = await supabase.from('mobile_money_accounts').insert({ organization_id: orgId, ...parsed.data })
  if (error) throw new Error(error.message)

  revalidatePath('/tresorerie')
}

const TREASURY_TABLES = ['cash_accounts', 'bank_accounts', 'mobile_money_accounts'] as const

export async function setTreasuryAccountStatusAction(formData: FormData) {
  const table = String(formData.get('table') ?? '')
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '')
  if (!(TREASURY_TABLES as readonly string[]).includes(table)) throw new Error('Table invalide.')
  if (!['active', 'inactive'].includes(status)) throw new Error('Statut invalide.')

  const supabase = await createClient()
  const { error } = await supabase
    .from(table as (typeof TREASURY_TABLES)[number])
    .update({ status })
    .eq('id', id)
  if (error) throw new Error(error.message)

  revalidatePath('/tresorerie')
}
