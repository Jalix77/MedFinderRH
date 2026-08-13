import { describe, it, expect } from 'vitest'
import { signInAs, getOrgIdByName } from './helpers'
import { computeTotp } from './totp'

/**
 * Verifie D2 de bout en bout : un DIRECTEUR_GENERAL (role.manage,
 * settings.manage par defaut) reste sans AUCUNE de ces permissions tant
 * que le MFA n'est pas enrole ET verifie (AAL2) — puis les recupere
 * immediatement apres, sur la MEME session. Verifie egalement que la
 * protection anti-auto-elevation (docs/security.md §3) s'applique bien a
 * un DG pleinement authentifie MFA (pas seulement en theorie).
 */
describe('MFA obligatoire (D2) — cycle complet enrolement -> AAL2', () => {
  it('DG : permissions refusees avant MFA, accordees apres verification TOTP', async () => {
    const orgA = await getOrgIdByName('MedFinder Demo — Organisation A')
    const { client, userId } = await signInAs('dg.demo@medfinder.test')

    const before = await client.rpc('current_user_has_permission', {
      p_org_id: orgA,
      p_permission_code: 'role.manage',
    })
    expect(before.data, 'refuse avant MFA').toBe(false)

    const { data: enroll, error: enrollError } = await client.auth.mfa.enroll({ factorType: 'totp' })
    expect(enrollError).toBeNull()
    const factorId = enroll!.id
    const secret = enroll!.totp.secret

    const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId })
    expect(challengeError).toBeNull()

    const { error: verifyError } = await client.auth.mfa.verify({
      factorId,
      challengeId: challenge!.id,
      code: computeTotp(secret),
    })
    expect(verifyError).toBeNull()

    const after = await client.rpc('current_user_has_permission', {
      p_org_id: orgA,
      p_permission_code: 'role.manage',
    })
    expect(after.data, 'accorde apres verification MFA (AAL2)').toBe(true)

    // Auto-elevation : meme pleinement authentifie MFA, un DG ne peut pas
    // s'auto-assigner un role (voir security.md §3).
    const { data: membership } = await client
      .from('memberships')
      .select('id')
      .eq('user_id', userId)
      .eq('organization_id', orgA)
      .single()

    const { data: assignResult } = await client.rpc('admin_assign_role', {
      p_membership_id: (membership as { id: string }).id,
      p_role_code: 'SUPER_ADMIN',
    })
    const result = assignResult as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('self_elevation_blocked')

    // Nettoyage : desenroler le facteur pour ne pas polluer les tests
    // suivants (chaque fichier de test tourne sur la meme base reinitialisee
    // une seule fois par la suite — voir tests/global-setup.ts).
    await client.auth.mfa.unenroll({ factorId })
  })
})
