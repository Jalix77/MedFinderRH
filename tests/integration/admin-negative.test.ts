import { describe, it, expect, beforeAll } from 'vitest'
import { signInAs, adminClient, getOrgIdByName } from './helpers'
import { computeTotp } from './totp'

/**
 * Audit cible — point 6 : operations d'administration sensibles testees
 * contre les scenarios explicitement demandes. Certains sont deja couverts
 * ailleurs (references indiquees) ; ce fichier comble le reste.
 */
describe('Audit — operations d\'administration sensibles', () => {
  let orgA: string
  let orgB: string

  beforeAll(async () => {
    orgA = await getOrgIdByName('MedFinder Demo — Organisation A')
    orgB = await getOrgIdByName('MedFinder Demo — Organisation B')
  })

  it('auto-elevation DG : voir tests/integration/mfa-enforcement.test.ts (DG pleinement authentifie MFA, bloque) et rls-rbac.test.ts (DG sans MFA, not_authorized)', () => {
    expect(true).toBe(true)
  })

  it('auto-elevation MANAGER : refuse (role.manage absent du role) avant meme la regle d\'auto-elevation', async () => {
    const { client, userId } = await signInAs('manager.demo@medfinder.test')
    const admin = adminClient()
    const { data: membership } = await admin
      .from('memberships')
      .select('id')
      .eq('user_id', userId)
      .eq('organization_id', orgA)
      .single()

    const { data } = await client.rpc('admin_assign_role', {
      p_membership_id: (membership as { id: string }).id,
      p_role_code: 'DIRECTEUR_GENERAL',
    })
    expect((data as { success: boolean; error?: string }).error).toBe('not_authorized')
  })

  it('auto-elevation COMPTABLE : refuse (role.manage absent du role)', async () => {
    const { client, userId } = await signInAs('comptable.demo@medfinder.test')
    const admin = adminClient()
    const { data: membership } = await admin
      .from('memberships')
      .select('id')
      .eq('user_id', userId)
      .eq('organization_id', orgA)
      .single()

    const { data } = await client.rpc('admin_assign_role', {
      p_membership_id: (membership as { id: string }).id,
      p_role_code: 'SUPER_ADMIN',
    })
    expect((data as { success: boolean; error?: string }).error).toBe('not_authorized')
  })

  it('changement d\'organisation : un utilisateur de l\'org A ne peut pas administrer l\'org B', async () => {
    const { client } = await signInAs('employe.demo@medfinder.test') // membre de A uniquement
    const { data } = await client.rpc('admin_update_organization_settings', {
      p_org_id: orgB,
      p_name: 'Modifie depuis org A — ne doit jamais passer',
    })
    expect((data as { success: boolean; error?: string }).error).toBe('not_authorized')

    // Verification cote donnees : le nom de l'org B est inchange.
    const admin = adminClient()
    const { data: org } = await admin.from('organizations').select('name').eq('id', orgB).single()
    expect((org as { name: string }).name).toBe('MedFinder Demo — Organisation B')
  })

  it('membership suspendue : aucune action d\'administration possible pour le compte suspendu', async () => {
    const { client, userId } = await signInAs('suspendu.demo@medfinder.test')
    const admin = adminClient()
    const { data: membership } = await admin
      .from('memberships')
      .select('id')
      .eq('user_id', userId)
      .eq('organization_id', orgA)
      .single()

    const { data } = await client.rpc('admin_set_membership_status', {
      p_membership_id: (membership as { id: string }).id,
      p_status: 'active',
    })
    expect((data as { success: boolean; error?: string }).error).toBe('not_authorized')
  })

  it('membership suspendue : un admin autorise PEUT reactiver un compte suspendu (controle positif)', async () => {
    // Cree un membership suspendu jetable pour ne pas alterer le seed
    // partage par les autres tests de ce fichier de test.
    const admin = adminClient()
    const { data: authUser } = await admin.auth.admin.createUser({
      email: `audit-reactivation-${Date.now()}@medfinder.test`,
      password: 'DemoPass#2026',
      email_confirm: true,
    })
    const { data: membership } = await admin
      .from('memberships')
      .insert({ user_id: authUser.user!.id, organization_id: orgA, status: 'suspended' })
      .select('id')
      .single()

    const { client } = await signInAs('dg.demo@medfinder.test')
    const { data: enroll, error: enrollError } = await client.auth.mfa.enroll({ factorType: 'totp' })
    expect(enrollError, enrollError?.message).toBeNull()

    try {
      const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({
        factorId: enroll!.id,
      })
      expect(challengeError, challengeError?.message).toBeNull()
      const { error: verifyError } = await client.auth.mfa.verify({
        factorId: enroll!.id,
        challengeId: challenge!.id,
        code: computeTotp(enroll!.totp.secret),
      })
      expect(verifyError, verifyError?.message).toBeNull()

      const { data: result } = await client.rpc('admin_set_membership_status', {
        p_membership_id: (membership as { id: string }).id,
        p_status: 'active',
      })
      expect((result as { success: boolean }).success).toBe(true)

      const { data: reloaded } = await admin
        .from('memberships')
        .select('status')
        .eq('id', (membership as { id: string }).id)
        .single()
      expect((reloaded as { status: string }).status).toBe('active')
    } finally {
      await client.auth.mfa.unenroll({ factorId: enroll!.id })
    }

    await client.auth.mfa.unenroll({ factorId: enroll!.id })
  })

  it('override DENY : voir tests/integration/permission-overrides.test.ts (deny wins, expiration)', () => {
    expect(true).toBe(true)
  })

  it('token AAL1 alors qu\'AAL2 est requis : refuse meme pour une RPC admin_* (pas seulement current_user_has_permission)', async () => {
    const { client } = await signInAs('dg.demo@medfinder.test') // AAL1, aucun facteur enrole dans ce test
    const { data } = await client.rpc('admin_update_organization_settings', {
      p_org_id: orgA,
      p_name: 'Tentative sans MFA',
    })
    expect((data as { success: boolean; error?: string }).error).toBe('not_authorized')
  })
})
