'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getActiveOrganizationId } from '@/lib/auth/active-org'

type RpcResult = { success: boolean; error?: string; [key: string]: unknown }

type AdminRpcName =
  | 'admin_create_membership'
  | 'admin_assign_role'
  | 'admin_revoke_role'
  | 'admin_set_membership_status'
  | 'admin_set_user_status'
  | 'admin_set_permission_override'
  | 'admin_update_organization_settings'

async function callRpc(fn: AdminRpcName, args: Record<string, unknown>): Promise<RpcResult> {
  const supabase = await createClient()
  // Les fonctions admin_* retournent toutes un jsonb {success, error?, ...} —
  // pas modelisable finement par le typegen Supabase pour un nom de fonction
  // non-litteral sans alourdir chaque appel ; echappatoire de typage confinee
  // a cette seule fonction utilitaire, resultat re-type juste apres.
  const rpcCall = supabase.rpc.bind(supabase) as unknown as (
    fn: AdminRpcName,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>
  const { data, error } = await rpcCall(fn, args)
  if (error) {
    throw new Error(error.message)
  }
  const result = data as RpcResult
  if (!result?.success) {
    throw new Error(result?.error ?? 'Operation refusee par le serveur.')
  }
  return result
}

export async function inviteMemberAction(formData: FormData) {
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')

  const email = String(formData.get('email') ?? '').trim()
  const roleCode = String(formData.get('role') ?? '').trim()
  if (!email || !roleCode) throw new Error('Email et role requis.')

  await callRpc('admin_create_membership', {
    p_org_id: orgId,
    p_user_email: email,
    p_role_code: roleCode,
  })
  revalidatePath('/settings/users')
}

export async function assignRoleAction(formData: FormData) {
  const membershipId = String(formData.get('membershipId') ?? '')
  const roleCode = String(formData.get('role') ?? '')
  await callRpc('admin_assign_role', { p_membership_id: membershipId, p_role_code: roleCode })
  revalidatePath('/settings/users')
}

export async function revokeRoleAction(formData: FormData) {
  const membershipId = String(formData.get('membershipId') ?? '')
  const roleCode = String(formData.get('role') ?? '')
  await callRpc('admin_revoke_role', { p_membership_id: membershipId, p_role_code: roleCode })
  revalidatePath('/settings/users')
}

export async function setMembershipStatusAction(formData: FormData) {
  const membershipId = String(formData.get('membershipId') ?? '')
  const status = String(formData.get('status') ?? '')
  await callRpc('admin_set_membership_status', { p_membership_id: membershipId, p_status: status })
  revalidatePath('/settings/users')
}

export async function updateOrganizationSettingsAction(formData: FormData) {
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')

  await callRpc('admin_update_organization_settings', {
    p_org_id: orgId,
    p_name: String(formData.get('name') ?? '') || null,
    p_legal_name: String(formData.get('legal_name') ?? '') || null,
    p_tax_id: String(formData.get('tax_id') ?? '') || null,
    p_default_currency: String(formData.get('default_currency') ?? '') || null,
    p_fiscal_year_start_month: formData.get('fiscal_year_start_month')
      ? Number(formData.get('fiscal_year_start_month'))
      : null,
    p_timezone: String(formData.get('timezone') ?? '') || null,
  })
  revalidatePath('/settings/organization')
}
