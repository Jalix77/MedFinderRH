import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { hasPermission } from '@/lib/permissions'
import type { RoleCode } from '@/lib/permissions/codes'
import { needsMfaChallenge, needsMfaEnrollment, type MfaAssurance } from './mfa-policy'

export { needsMfaChallenge, needsMfaEnrollment, type MfaAssurance }

/**
 * Politique MFA (Decision D2 validee) :
 *   - SUPER_ADMIN, DIRECTEUR_GENERAL : MFA obligatoire des Phase 1A.
 *   - DIRECTEUR_TECHNIQUE : obligatoire s'il detient une permission
 *     administrative sensible (user.manage, role.manage, settings.manage).
 *   - COMPTABLE : deviendra obligatoire a l'activation des operations
 *     financieres (Phase 2) — pas encore applique en Phase 1A, la regle
 *     est ecrite ici pour qu'un seul changement l'active plus tard.
 *
 * Cette fonction determine si la POLITIQUE exige le MFA pour cet
 * utilisateur — getMfaAssurance() verifie separement si la session
 * COURANTE a effectivement franchi le second facteur. Miroir exact de
 * app_private.user_requires_mfa() cote base (voir migration
 * 20260813100013_mfa_enforcement.sql) — la reelle application est faite en
 * base ; cette fonction sert a l'UX (nav, bannieres).
 */
export async function organizationRequiresMfa(
  organizationId: string,
  roleCodes: RoleCode[]
): Promise<boolean> {
  if (roleCodes.includes('SUPER_ADMIN') || roleCodes.includes('DIRECTEUR_GENERAL')) {
    return true
  }

  if (roleCodes.includes('DIRECTEUR_TECHNIQUE')) {
    const [userManage, roleManage, settingsManage] = await Promise.all([
      hasPermission(organizationId, 'user.manage'),
      hasPermission(organizationId, 'role.manage'),
      hasPermission(organizationId, 'settings.manage'),
    ])
    if (userManage || roleManage || settingsManage) return true
  }

  // COMPTABLE : desactive tant que le module financier n'est pas actif
  // (voir docs/roadmap.md, Decision D2). Mettre `true` inconditionnellement
  // ici a l'ouverture de la Phase 2.

  return false
}

/** Niveau d'assurance MFA reel de la session courante (aupres de Supabase Auth). */
export async function getMfaAssurance(): Promise<MfaAssurance> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()

  if (error || !data) {
    return { currentLevel: null, nextLevel: null, hasVerifiedFactor: false }
  }

  const { data: factorsData } = await supabase.auth.mfa.listFactors()
  const hasVerifiedFactor = Boolean(factorsData?.totp?.some((f) => f.status === 'verified'))

  return {
    currentLevel: data.currentLevel,
    nextLevel: data.nextLevel,
    hasVerifiedFactor,
  }
}
