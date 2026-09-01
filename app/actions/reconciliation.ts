'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { assertRpcSuccess } from '@/lib/actions/rpc-result'

/**
 * Server Actions Phase 2D — rapprochement bancaire.
 *
 * Aucune regle de rapprochement n'est implementee ici : chaque action
 * delegue a la RPC correspondante, qui porte la separation des
 * fonctions, la prevention du double rapprochement, les gardes de
 * periode et l'immutabilite. `organization_id` vient toujours du
 * contexte serveur, jamais du formulaire.
 */

export type ParsedStatementLine = {
  value_date: string
  label: string
  external_reference: string | null
  direction: 'in' | 'out'
  amount: number
}

export async function importBankStatementAction(formData: FormData) {
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')

  const treasuryRaw = String(formData.get('treasury_account') ?? '')
  const [treasuryType, treasuryId] = treasuryRaw.split(':')
  if (!treasuryType || !treasuryId) throw new Error('Choisissez un compte de tresorerie.')

  const reference = String(formData.get('statement_reference') ?? '').trim()
  if (!reference) throw new Error('La reference du releve est obligatoire.')

  const periodStart = String(formData.get('period_start') ?? '')
  const periodEnd = String(formData.get('period_end') ?? '')
  if (!periodStart || !periodEnd) throw new Error('La periode du releve est obligatoire.')

  let lines: ParsedStatementLine[]
  try {
    lines = JSON.parse(String(formData.get('lines') ?? '[]')) as ParsedStatementLine[]
  } catch {
    throw new Error('Lignes du releve illisibles.')
  }
  if (lines.length === 0) throw new Error('Le releve ne contient aucune ligne exploitable.')

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('import_bank_statement', {
    p_org_id: orgId,
    p_treasury_account_type: treasuryType,
    p_treasury_account_id: treasuryId,
    p_statement_reference: reference,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_opening_balance: Number(formData.get('opening_balance') ?? 0),
    p_closing_balance: Number(formData.get('closing_balance') ?? 0),
    p_lines: lines,
    p_file_name: String(formData.get('file_name') ?? '') || undefined,
  })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)

  const importId = (data as unknown as { import_id: string }).import_id
  revalidatePath('/tresorerie/rapprochement')
  redirect(`/tresorerie/rapprochement/${importId}`)
}

export async function proposeBankReconciliationAction(formData: FormData) {
  const importId = String(formData.get('import_id') ?? '')
  if (!importId) throw new Error('Import invalide.')
  const tolerance = Number(formData.get('date_tolerance_days') ?? 3)

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('propose_bank_reconciliation', {
    p_import_id: importId,
    p_date_tolerance_days: Number.isFinite(tolerance) ? tolerance : 3,
  })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)

  revalidatePath(`/tresorerie/rapprochement/${importId}`)
}

export async function createManualBankMatchAction(formData: FormData) {
  const lineId = String(formData.get('statement_line_id') ?? '')
  const movementId = String(formData.get('cash_movement_id') ?? '')
  const importId = String(formData.get('import_id') ?? '')
  if (!lineId) throw new Error('Ligne de releve invalide.')
  if (!movementId) throw new Error('Choisissez un mouvement de tresorerie.')

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('create_manual_bank_match', {
    p_statement_line_id: lineId,
    p_cash_movement_id: movementId,
    p_notes: String(formData.get('notes') ?? '') || undefined,
  })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)

  revalidatePath(`/tresorerie/rapprochement/${importId}`)
}

export async function validateBankMatchAction(formData: FormData) {
  const matchId = String(formData.get('match_id') ?? '')
  const importId = String(formData.get('import_id') ?? '')
  if (!matchId) throw new Error('Rapprochement invalide.')

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('validate_bank_match', { p_match_id: matchId })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)

  revalidatePath(`/tresorerie/rapprochement/${importId}`)
  revalidatePath('/tresorerie/mouvements')
}

export async function rejectBankMatchAction(formData: FormData) {
  const matchId = String(formData.get('match_id') ?? '')
  const importId = String(formData.get('import_id') ?? '')
  const reason = String(formData.get('reason') ?? '').trim()
  if (!matchId) throw new Error('Rapprochement invalide.')
  if (!reason) throw new Error('Le motif de rejet est obligatoire.')

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('reject_bank_match', {
    p_match_id: matchId,
    p_reason: reason,
  })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)

  revalidatePath(`/tresorerie/rapprochement/${importId}`)
}

export async function cancelBankStatementImportAction(formData: FormData) {
  const importId = String(formData.get('import_id') ?? '')
  const reason = String(formData.get('reason') ?? '').trim()
  if (!importId) throw new Error('Import invalide.')
  if (!reason) throw new Error("Le motif d'annulation est obligatoire.")

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('cancel_bank_statement_import', {
    p_import_id: importId,
    p_reason: reason,
  })
  if (error) throw new Error(error.message)
  assertRpcSuccess(data)

  revalidatePath('/tresorerie/rapprochement')
  revalidatePath(`/tresorerie/rapprochement/${importId}`)
}
