import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { signInAs, adminClient, getOrgIdByName } from './helpers'

/**
 * Audit cible — point 5 : cloisonnement precis par role.
 */
describe('Audit — cloisonnement par role', () => {
  let orgA: string

  beforeAll(async () => {
    orgA = await getOrgIdByName('MedFinder Demo — Organisation A')
  })

  async function check(email: string, permission: string) {
    const { client } = await signInAs(email)
    const { data } = await client.rpc('current_user_has_permission', {
      p_org_id: orgA,
      p_permission_code: permission,
    })
    return data as boolean
  }

  it('DIRECTEUR_TECHNIQUE ne voit aucun salaire sans permission explicite', async () => {
    expect(await check('dt.demo@medfinder.test', 'employee.view_salary')).toBe(false)
  })

  it('SUPPORT ne voit aucune donnee comptable/financiere', async () => {
    for (const permission of ['accounting.post', 'accounting.view', 'treasury.manage', 'budget.view', 'papej.view', 'donation.view']) {
      expect(await check('support.demo@medfinder.test', permission), permission).toBe(false)
    }
  })

  it('COMPTABLE ne peut pas modifier roles/permissions', async () => {
    for (const permission of ['role.manage', 'user.manage', 'permission.override']) {
      expect(await check('comptable.demo@medfinder.test', permission), permission).toBe(false)
    }
  })

  describe('RH ne voit les remunerations que si explicitement autorisee', () => {
    let overrideId: string

    it('refuse par defaut', async () => {
      expect(await check('rh.demo@medfinder.test', 'employee.view_salary')).toBe(false)
      // RH garde payroll.view_all (traitement agrege de la paie), distinct
      // de la consultation d'un salaire individuel — voir security.md §2.
      expect(await check('rh.demo@medfinder.test', 'payroll.view_all')).toBe(true)
    })

    it('accorde apres override explicite, retire apres suppression', async () => {
      const admin = adminClient()
      const { data: rhUser } = await admin.from('users').select('id').eq('full_name', 'Demo RH').single()
      const { data: permission } = await admin
        .from('permissions')
        .select('id')
        .eq('code', 'employee.view_salary')
        .single()

      const { data: override } = await admin
        .from('user_permission_overrides')
        .insert({
          user_id: (rhUser as { id: string }).id,
          organization_id: orgA,
          permission_id: (permission as { id: string }).id,
          effect: 'grant',
          reason: 'Audit test — autorisation explicite RH',
          granted_by: (rhUser as { id: string }).id,
        })
        .select('id')
        .single()
      overrideId = (override as { id: string }).id

      expect(await check('rh.demo@medfinder.test', 'employee.view_salary')).toBe(true)
    })

    afterAll(async () => {
      if (overrideId) {
        await adminClient().from('user_permission_overrides').delete().eq('id', overrideId)
      }
    })
  })

  it('AGENT_TERRAIN reste limite a son perimetre (crm.view_own, pas crm.view_all/manage)', async () => {
    expect(await check('agent.demo@medfinder.test', 'crm.view_own')).toBe(true)
    expect(await check('agent.demo@medfinder.test', 'crm.view_all')).toBe(false)
    expect(await check('agent.demo@medfinder.test', 'crm.manage')).toBe(false)
    expect(await check('agent.demo@medfinder.test', 'employee.view_salary')).toBe(false)
    expect(await check('agent.demo@medfinder.test', 'accounting.post')).toBe(false)
  })

  it('EMPLOYE reste limite a ses propres donnees autorisees', async () => {
    expect(await check('employe.demo@medfinder.test', 'payroll.view_own')).toBe(true)
    expect(await check('employe.demo@medfinder.test', 'leave.request')).toBe(true)
    for (const permission of ['payroll.view_all', 'employee.create', 'employee.view_salary', 'accounting.post', 'role.manage', 'crm.view_all']) {
      expect(await check('employe.demo@medfinder.test', permission), permission).toBe(false)
    }
  })

  it('EMPLOYE ne peut pas lire le profil complet (phone/statut) d\'un collegue (durcissement audit — users_select)', async () => {
    const { client } = await signInAs('employe.demo@medfinder.test')
    const admin = adminClient()
    const { data: colleague } = await admin.from('users').select('id').eq('full_name', 'Demo Comptable').single()

    const { data, error } = await client
      .from('users')
      .select('id, full_name, phone, status, mfa_enabled')
      .eq('id', (colleague as { id: string }).id)

    expect(error).toBeNull()
    expect(data ?? []).toEqual([]) // ligne invisible : EMPLOYE n'a ni user.manage ni role.manage
  })
})
