import { describe, it, expect, beforeAll } from 'vitest'
import { signInAs, getOrgIdByName } from './helpers'

let orgA: string
let orgB: string

beforeAll(async () => {
  orgA = await getOrgIdByName('MedFinder Demo — Organisation A')
  orgB = await getOrgIdByName('MedFinder Demo — Organisation B')
})

describe('Isolation multi-organisation (docs/security.md §4)', () => {
  it('un utilisateur de l\'organisation A ne voit que l\'organisation A', async () => {
    const { client } = await signInAs('dg.demo@medfinder.test')
    const { data, error } = await client.from('organizations').select('id')
    expect(error).toBeNull()
    expect((data ?? []).map((o) => o.id)).toEqual([orgA])
  })

  it('un utilisateur de l\'organisation B ne voit que l\'organisation B', async () => {
    const { client } = await signInAs('orgb.demo@medfinder.test')
    const { data, error } = await client.from('organizations').select('id')
    expect(error).toBeNull()
    expect((data ?? []).map((o) => o.id)).toEqual([orgB])
  })

  it('un utilisateur de l\'organisation B ne voit aucun membership de A', async () => {
    const { client } = await signInAs('orgb.demo@medfinder.test')
    const { data } = await client
      .from('memberships')
      .select('id, organization_id')
      .eq('organization_id', orgA)
    expect(data ?? []).toEqual([])
  })
})

describe('Utilisateur suspendu (docs/security.md §4)', () => {
  it('ne voit aucune organisation', async () => {
    const { client } = await signInAs('suspendu.demo@medfinder.test')
    const { data } = await client.from('organizations').select('id')
    expect(data ?? []).toEqual([])
  })

  it('n\'a aucune permission, meme celles de son role EMPLOYE', async () => {
    const { client } = await signInAs('suspendu.demo@medfinder.test')
    const { data } = await client.rpc('current_user_has_permission', {
      p_org_id: orgA,
      p_permission_code: 'leave.request',
    })
    expect(data).toBe(false)
  })
})

describe('Aucun privilege frontend-only (§58)', () => {
  it('EMPLOYE ne peut pas s\'inserer directement dans membership_roles', async () => {
    const { client } = await signInAs('employe.demo@medfinder.test')
    const { error } = await client
      .from('membership_roles')
      .insert({ membership_id: '00000000-0000-0000-0000-000000000000', role_id: '00000000-0000-0000-0000-000000000000' })
    expect(error).toBeTruthy()
  })

  it('SUPER_ADMIN ne peut pas ecrire directement dans audit_logs', async () => {
    const { client } = await signInAs('super.demo@medfinder.test')
    const { error } = await client
      .from('audit_logs')
      .insert({ action: 'hack', module: 'test', object_type: 'test' })
    expect(error).toBeTruthy()
  })

  it('COMPTABLE ne peut pas modifier role_permissions directement', async () => {
    const { client } = await signInAs('comptable.demo@medfinder.test')
    const { error } = await client
      .from('role_permissions')
      .insert({ role_id: '00000000-0000-0000-0000-000000000000', permission_id: '00000000-0000-0000-0000-000000000000' })
    expect(error).toBeTruthy()
  })
})

type RoleCase = { label: string; email: string; allowed: string[]; denied: string[] }

// Roles sans MFA obligatoire en Phase 1A (D2) : verifies contre leur
// matrice de permissions par defaut (docs/permissions-matrix.md).
const NON_MFA_ROLE_CASES: RoleCase[] = [
  {
    label: 'COMPTABLE',
    email: 'comptable.demo@medfinder.test',
    allowed: ['accounting.post', 'employee.view_salary', 'treasury.manage'],
    denied: ['role.manage', 'recruitment.manage', 'payroll.approve'],
  },
  {
    label: 'RH',
    email: 'rh.demo@medfinder.test',
    allowed: ['employee.create', 'recruitment.manage', 'payroll.prepare'],
    denied: ['accounting.post', 'role.manage', 'treasury.manage'],
  },
  {
    label: 'MANAGER',
    email: 'manager.demo@medfinder.test',
    allowed: ['expense.approve', 'leave.approve', 'crm.view_all'],
    denied: ['payroll.pay', 'accounting.post', 'role.manage'],
  },
  {
    label: 'AGENT_TERRAIN',
    email: 'agent.demo@medfinder.test',
    allowed: ['crm.view_own', 'expense.create', 'subscription.manage'],
    denied: ['crm.view_all', 'accounting.post', 'employee.view_salary'],
  },
  {
    label: 'SUPPORT',
    email: 'support.demo@medfinder.test',
    allowed: ['document.upload', 'leave.request'],
    denied: ['accounting.post', 'crm.view_own', 'employee.view'],
  },
  {
    label: 'EMPLOYE',
    email: 'employe.demo@medfinder.test',
    allowed: ['leave.request', 'payroll.view_own'],
    denied: ['employee.create', 'accounting.post', 'role.manage'],
  },
]

// Roles avec MFA obligatoire des Phase 1A (D2) : les comptes de demo n'ont
// pas de facteur enrole => toute permission doit etre refusee, quel que
// soit le role, tant que le defi MFA n'est pas franchi (voir
// supabase/migrations/20260813100013_mfa_enforcement.sql).
const MFA_REQUIRED_ROLE_CASES: RoleCase[] = [
  {
    label: 'SUPER_ADMIN (sans MFA)',
    email: 'dg.demo@medfinder.test', // DG utilise ici comme SUPER_ADMIN est teste separement (facteur enrole via UI)
    allowed: [],
    denied: ['accounting.post', 'user.manage', 'role.manage', 'settings.manage'],
  },
  {
    label: 'DIRECTEUR_TECHNIQUE (sans MFA, detient user.manage)',
    email: 'dt.demo@medfinder.test',
    allowed: [],
    denied: ['user.manage', 'settings.manage', 'asset.manage'],
  },
]

describe.each(NON_MFA_ROLE_CASES)('RBAC — $label (MFA non requis en Phase 1A)', ({ email, allowed, denied }) => {
  it(`possede les permissions attendues et refuse celles non accordees`, async () => {
    const { client } = await signInAs(email)

    for (const permission of allowed) {
      const { data, error } = await client.rpc('current_user_has_permission', {
        p_org_id: orgA,
        p_permission_code: permission,
      })
      expect(error, `${email} / ${permission}`).toBeNull()
      expect(data, `${email} devrait avoir la permission ${permission}`).toBe(true)
    }

    for (const permission of denied) {
      const { data } = await client.rpc('current_user_has_permission', {
        p_org_id: orgA,
        p_permission_code: permission,
      })
      expect(data, `${email} ne devrait PAS avoir la permission ${permission}`).toBe(false)
    }
  })
})

describe.each(MFA_REQUIRED_ROLE_CASES)('RBAC — $label', ({ email, denied }) => {
  it('toute permission est refusee tant que le MFA n\'est pas complete (D2)', async () => {
    const { client } = await signInAs(email)
    for (const permission of denied) {
      const { data } = await client.rpc('current_user_has_permission', {
        p_org_id: orgA,
        p_permission_code: permission,
      })
      expect(data, `${email} ne devrait pas avoir ${permission} sans MFA`).toBe(false)
    }
  })
})

describe('Separation des fonctions — refus d\'action sans permission', () => {
  it('un DG sans MFA ne peut pas assigner de role (role.manage refuse par D2)', async () => {
    const { client, userId } = await signInAs('dg.demo@medfinder.test')
    const { data: membership } = await client
      .from('memberships')
      .select('id')
      .eq('user_id', userId)
      .eq('organization_id', orgA)
      .single()

    const { data } = await client.rpc('admin_assign_role', {
      p_membership_id: (membership as { id: string }).id,
      p_role_code: 'MANAGER',
    })
    // Sans MFA, has_permission(role.manage) est deja faux (D2) : le refus
    // intervient avant meme la verification anti-auto-elevation. Le test
    // dedie a l'auto-elevation avec un DG pleinement authentifie MFA est
    // dans mfa-enforcement.test.ts.
    expect((data as { success: boolean; error?: string }).success).toBe(false)
    expect((data as { success: boolean; error?: string }).error).toBe('not_authorized')
  })
})
