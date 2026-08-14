import { describe, it, expect } from 'vitest'
import { signInAs, adminClient, getOrgIdByName } from './helpers'

/**
 * Audit cible — point 7 : "aucune modification sensible ne doit etre
 * silencieuse ; toute action doit generer un audit complet". Verifie que
 * les refus (pas seulement les succes) laissent une trace exploitable dans
 * audit_logs — via service_role, qui bypass RLS pour la lecture de
 * verification uniquement (jamais pour l'action elle-meme, effectuee par
 * le compte de test normal).
 */
describe('Audit — completude du journal sur les actions refusees (D2 / §3 security.md)', () => {
  it('un refus admin_update_organization_settings (EMPLOYE) laisse une trace "denied"', async () => {
    const orgA = await getOrgIdByName('MedFinder Demo — Organisation A')
    const { client } = await signInAs('employe.demo@medfinder.test')

    const before = Date.now()
    const { data } = await client.rpc('admin_update_organization_settings', {
      p_org_id: orgA,
      p_name: 'Tentative EMPLOYE — doit etre journalisee',
    })
    expect((data as { success: boolean; error?: string }).error).toBe('not_authorized')

    const admin = adminClient()
    const { data: logs } = await admin
      .from('audit_logs')
      .select('action, module, result, occurred_at')
      .eq('organization_id', orgA)
      .eq('action', 'update_organization_settings')
      .eq('result', 'denied')
      .gte('occurred_at', new Date(before - 5000).toISOString())
      .order('occurred_at', { ascending: false })
      .limit(1)

    expect(logs, 'un refus doit produire une ligne audit_logs avec result=denied').not.toHaveLength(0)
  })

  it('une auto-elevation bloquee (DG, MFA verifie) laisse une trace "denied" distincte du refus simple', async () => {
    const orgA = await getOrgIdByName('MedFinder Demo — Organisation A')
    const { client, userId } = await signInAs('dg.demo@medfinder.test')

    const { data: enroll } = await client.auth.mfa.enroll({ factorType: 'totp' })
    try {
      const { data: challenge } = await client.auth.mfa.challenge({ factorId: enroll!.id })
      const { computeTotp } = await import('./totp')
      await client.auth.mfa.verify({
        factorId: enroll!.id,
        challengeId: challenge!.id,
        code: computeTotp(enroll!.totp.secret),
      })

      const admin = adminClient()
      const { data: membership } = await admin
        .from('memberships')
        .select('id')
        .eq('user_id', userId)
        .eq('organization_id', orgA)
        .single()

      const before = Date.now()
      const { data } = await client.rpc('admin_assign_role', {
        p_membership_id: (membership as { id: string }).id,
        p_role_code: 'SUPER_ADMIN',
      })
      expect((data as { success: boolean; error?: string }).error).toBe('self_elevation_blocked')

      const { data: logs } = await admin
        .from('audit_logs')
        .select('action, module, result, new_value, occurred_at')
        .eq('organization_id', orgA)
        .eq('action', 'assign_role')
        .eq('result', 'denied')
        .gte('occurred_at', new Date(before - 5000).toISOString())
        .order('occurred_at', { ascending: false })
        .limit(1)

      expect(logs).not.toHaveLength(0)
      expect((logs![0].new_value as { reason?: string })?.reason).toBe('self_elevation_blocked')
    } finally {
      await client.auth.mfa.unenroll({ factorId: enroll!.id })
    }
  })
})
