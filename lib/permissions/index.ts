import 'server-only'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { PermissionCode } from './codes'

export class PermissionDeniedError extends Error {
  constructor(public readonly permission: string) {
    super(`Permission refusee: ${permission}`)
    this.name = 'PermissionDeniedError'
  }
}

/**
 * Verifie une permission pour l'utilisateur authentifie courant, dans une
 * organisation donnee, via le RPC public.current_user_has_permission
 * (lui-meme un wrapper de app_private.has_permission — source unique de
 * verite cote base, voir security.md §2).
 *
 * IMPORTANT : ceci est une couche de defense-in-depth pour l'UX (afficher
 * un message clair, cacher un bouton) — la protection reelle est RLS,
 * qui s'applique meme si ce check est omis ou contourne par erreur.
 */
export const hasPermission = cache(
  async (organizationId: string, permission: PermissionCode): Promise<boolean> => {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('current_user_has_permission', {
      p_org_id: organizationId,
      p_permission_code: permission,
    })

    if (error) {
      console.error('[permissions] current_user_has_permission a echoue:', error.message)
      return false
    }

    return Boolean(data)
  }
)

/** Leve PermissionDeniedError si l'utilisateur courant n'a pas la permission. */
export async function requirePermission(
  organizationId: string,
  permission: PermissionCode
): Promise<void> {
  const allowed = await hasPermission(organizationId, permission)
  if (!allowed) {
    throw new PermissionDeniedError(permission)
  }
}
