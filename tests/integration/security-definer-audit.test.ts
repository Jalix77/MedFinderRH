import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { signInAs, adminClient, getOrgIdByName } from './helpers'
import { computeTotp } from './totp'

if (typeof globalThis.WebSocket === 'undefined') {
  const { default: WS } = await import('ws')
  ;(globalThis as unknown as { WebSocket: unknown }).WebSocket = WS
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

/**
 * Audit cible (demande de Jean Alix Pierre, pre-validation Phase 1A) —
 * couvre les points 1 et 2 de l'audit : chaque fonction SECURITY DEFINER
 * exposee (les 9 avertissements Security Advisor "reviewed, intentional")
 * est prouvee inexploitable par un acteur non autorise, et les fonctions
 * internes (app_private) restent totalement hors d'atteinte.
 */
describe('Audit — fonctions SECURITY DEFINER exposees (9 avertissements Security Advisor)', () => {
  let orgA: string

  beforeAll(async () => {
    orgA = await getOrgIdByName('MedFinder Demo — Organisation A')
  })

  function anonClient() {
    return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  }

  describe('anon (non authentifie) — EXECUTE revoque, aucune des 9 fonctions n\'est exploitable', () => {
    const cases: Array<{ fn: string; args: Record<string, unknown> }> = [
      { fn: 'current_user_has_permission', args: { p_org_id: '00000000-0000-0000-0000-000000000000', p_permission_code: 'audit.view' } },
      { fn: 'next_number', args: { p_org_id: '00000000-0000-0000-0000-000000000000', p_entity_type: 'x' } },
      { fn: 'admin_create_membership', args: { p_org_id: '00000000-0000-0000-0000-000000000000', p_user_email: 'x@x.com', p_role_code: 'EMPLOYE' } },
      { fn: 'admin_assign_role', args: { p_membership_id: '00000000-0000-0000-0000-000000000000', p_role_code: 'EMPLOYE' } },
      { fn: 'admin_revoke_role', args: { p_membership_id: '00000000-0000-0000-0000-000000000000', p_role_code: 'EMPLOYE' } },
      { fn: 'admin_set_membership_status', args: { p_membership_id: '00000000-0000-0000-0000-000000000000', p_status: 'suspended' } },
      { fn: 'admin_set_user_status', args: { p_target_user_id: '00000000-0000-0000-0000-000000000000', p_org_id: '00000000-0000-0000-0000-000000000000', p_status: 'suspended' } },
      { fn: 'admin_set_permission_override', args: { p_target_user_id: '00000000-0000-0000-0000-000000000000', p_org_id: '00000000-0000-0000-0000-000000000000', p_permission_code: 'audit.view', p_effect: 'grant', p_reason: 'test' } },
      { fn: 'admin_update_organization_settings', args: { p_org_id: '00000000-0000-0000-0000-000000000000', p_name: 'hack' } },
    ]

    it.each(cases)('anon ne peut pas executer $fn', async ({ fn, args }) => {
      const client = anonClient()
      const { error } = await client.rpc(fn, args)
      expect(error, `anon a pu executer ${fn} sans erreur — EXECUTE devrait etre refuse`).toBeTruthy()
    })
  })

  it('les fonctions internes app_private.* ne sont pas exposees via RPC (schema hors [api].schemas)', async () => {
    const { client } = await signInAs('super.demo@medfinder.test')
    const { error } = await client.rpc('has_permission', {
      p_user_id: '00000000-0000-0000-0000-000000000000',
      p_org_id: orgA,
      p_permission_code: 'audit.view',
    })
    expect(error, 'app_private.has_permission ne doit pas etre appelable en RPC').toBeTruthy()
  })

  describe('EMPLOYE (authentifie, aucune permission d\'administration) — refuse sur les 7 RPC admin_*', () => {
    it('admin_create_membership -> not_authorized', async () => {
      const { client } = await signInAs('employe.demo@medfinder.test')
      const { data } = await client.rpc('admin_create_membership', {
        p_org_id: orgA,
        p_user_email: 'comptable.demo@medfinder.test',
        p_role_code: 'SUPER_ADMIN',
      })
      expect((data as { success: boolean; error?: string }).error).toBe('not_authorized')
    })

    it('admin_assign_role -> not_authorized', async () => {
      const { client } = await signInAs('employe.demo@medfinder.test')
      const admin = adminClient()
      const { data: targetMembership } = await admin
        .from('memberships')
        .select('id')
        .eq('organization_id', orgA)
        .limit(1)
        .single()
      const { data } = await client.rpc('admin_assign_role', {
        p_membership_id: (targetMembership as { id: string }).id,
        p_role_code: 'SUPER_ADMIN',
      })
      expect((data as { success: boolean; error?: string }).error).toBe('not_authorized')
    })

    it('admin_revoke_role -> not_authorized', async () => {
      const { client } = await signInAs('employe.demo@medfinder.test')
      const admin = adminClient()
      const { data: targetMembership } = await admin
        .from('memberships')
        .select('id')
        .eq('organization_id', orgA)
        .limit(1)
        .single()
      const { data } = await client.rpc('admin_revoke_role', {
        p_membership_id: (targetMembership as { id: string }).id,
        p_role_code: 'EMPLOYE',
      })
      expect((data as { success: boolean; error?: string }).error).toBe('not_authorized')
    })

    it('admin_set_membership_status -> not_authorized', async () => {
      const { client } = await signInAs('employe.demo@medfinder.test')
      const admin = adminClient()
      const { data: targetMembership } = await admin
        .from('memberships')
        .select('id')
        .eq('organization_id', orgA)
        .limit(1)
        .single()
      const { data } = await client.rpc('admin_set_membership_status', {
        p_membership_id: (targetMembership as { id: string }).id,
        p_status: 'suspended',
      })
      expect((data as { success: boolean; error?: string }).error).toBe('not_authorized')
    })

    it('admin_set_user_status -> not_authorized', async () => {
      const { client } = await signInAs('employe.demo@medfinder.test')
      const admin = adminClient()
      const { data: target } = await admin.from('users').select('id').eq('full_name', 'Demo Comptable').single()
      const { data } = await client.rpc('admin_set_user_status', {
        p_target_user_id: (target as { id: string }).id,
        p_org_id: orgA,
        p_status: 'suspended',
      })
      expect((data as { success: boolean; error?: string }).error).toBe('not_authorized')
    })

    it('admin_set_permission_override -> not_authorized', async () => {
      const { client, userId } = await signInAs('employe.demo@medfinder.test')
      const { data } = await client.rpc('admin_set_permission_override', {
        p_target_user_id: userId,
        p_org_id: orgA,
        p_permission_code: 'role.manage',
        p_effect: 'grant',
        p_reason: 'tentative non autorisee',
      })
      expect((data as { success: boolean; error?: string }).error).toBe('not_authorized')
    })

    it('admin_update_organization_settings -> not_authorized', async () => {
      const { client } = await signInAs('employe.demo@medfinder.test')
      const { data } = await client.rpc('admin_update_organization_settings', {
        p_org_id: orgA,
        p_name: 'Nom modifie sans autorisation',
      })
      expect((data as { success: boolean; error?: string }).error).toBe('not_authorized')
    })
  })

  it('admin_set_permission_override refuse une cible non membre actif de l\'organisation (durcissement audit)', async () => {
    // DG (org A) est pleinement autorise sur l'organisation A une fois le
    // MFA verifie (permission.override lui appartient par defaut). Il tente
    // de creer, sur l'organisation A, un override pour un utilisateur qui
    // n'est membre QUE de l'organisation B — donc pas membre actif de A.
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

      // Controle : DG a bien permission.override sur SON organisation apres MFA.
      const selfCheck = await client.rpc('current_user_has_permission', {
        p_org_id: orgA,
        p_permission_code: 'permission.override',
      })
      expect(selfCheck.data, 'DG devrait avoir permission.override sur orgA apres MFA').toBe(true)

      const admin = adminClient()
      const { data: target } = await admin
        .from('users')
        .select('id')
        .eq('full_name', 'Demo Org B DG')
        .single()

      const { data } = await client.rpc('admin_set_permission_override', {
        p_target_user_id: (target as { id: string }).id,
        p_org_id: orgA,
        p_permission_code: 'audit.view',
        p_effect: 'grant',
        p_reason: 'audit test — cible hors organisation',
      })
      expect((data as { success: boolean; error?: string }).success).toBe(false)
      expect((data as { success: boolean; error?: string }).error).toBe('target_not_active_member')
    } finally {
      await client.auth.mfa.unenroll({ factorId: enroll!.id })
    }
  })
})
