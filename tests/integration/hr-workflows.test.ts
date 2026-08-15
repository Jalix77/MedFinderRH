import { describe, it, expect, beforeAll } from 'vitest'
import { signInAs, adminClient, getOrgIdByName } from './helpers'

describe('Phase 1B — RH : departements, employes, contrats, documents', () => {
  let orgA: string
  let orgB: string

  beforeAll(async () => {
    orgA = await getOrgIdByName('MedFinder Demo — Organisation A')
    orgB = await getOrgIdByName('MedFinder Demo — Organisation B')
  })

  describe('Departements/postes', () => {
    it('RH (department.manage) peut creer un departement', async () => {
      const { client } = await signInAs('rh.demo@medfinder.test')
      const { data, error } = await client
        .from('departments')
        .insert({ organization_id: orgA, name: `Test Dept ${Date.now()}` })
        .select('id')
        .single()
      expect(error).toBeNull()
      expect(data?.id).toBeTruthy()
    })

    it('MANAGER (sans department.manage) ne peut pas creer de departement', async () => {
      const { client } = await signInAs('manager.demo@medfinder.test')
      const { error } = await client
        .from('departments')
        .insert({ organization_id: orgA, name: `Refuse ${Date.now()}` })
      expect(error).toBeTruthy()
    })

    it('tout membre actif peut lire les departements (donnee non sensible)', async () => {
      const { client } = await signInAs('employe.demo@medfinder.test')
      const { data, error } = await client.from('departments').select('id')
      expect(error).toBeNull()
      expect((data ?? []).length).toBeGreaterThan(0)
    })
  })

  describe('Creation employe + numerotation', () => {
    it('RH (employee.create) peut creer un employe, matricule auto-assigne', async () => {
      const { client } = await signInAs('rh.demo@medfinder.test')
      const { data, error } = await client
        .from('employees')
        .insert({
          organization_id: orgA,
          matricule: '',
          first_name: 'Test',
          last_name: `Creation-${Date.now()}`,
          hire_date: '2026-01-01',
        })
        .select('matricule')
        .single()
      expect(error).toBeNull()
      expect(data?.matricule).toMatch(/^EMP-\d{4}$/)
    })

    it('EMPLOYE (sans employee.create) ne peut pas creer d\'employe', async () => {
      const { client } = await signInAs('employe.demo@medfinder.test')
      const { error } = await client.from('employees').insert({
        organization_id: orgA,
        matricule: '',
        first_name: 'X',
        last_name: 'Y',
        hire_date: '2026-01-01',
      })
      expect(error).toBeTruthy()
    })

    it('20 creations concurrentes produisent 20 matricules uniques (atomicite)', async () => {
      const { client } = await signInAs('rh.demo@medfinder.test')
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          client
            .from('employees')
            .insert({
              organization_id: orgA,
              matricule: '',
              first_name: 'Concurrent',
              last_name: `Test-${Date.now()}-${i}`,
              hire_date: '2026-01-01',
            })
            .select('matricule')
            .single()
        )
      )
      const matricules = results.map((r) => r.data?.matricule)
      expect(matricules.every(Boolean)).toBe(true)
      expect(new Set(matricules).size).toBe(20)
    })
  })

  describe('Visibilite salaire (contracts) — employee.view_salary', () => {
    it('COMPTABLE voit les contrats', async () => {
      const { client } = await signInAs('comptable.demo@medfinder.test')
      const { data, error } = await client.from('contracts').select('id')
      expect(error).toBeNull()
      expect((data ?? []).length).toBeGreaterThan(0)
    })

    it('MANAGER ne voit aucun contrat', async () => {
      const { client } = await signInAs('manager.demo@medfinder.test')
      const { data } = await client.from('contracts').select('id')
      expect(data ?? []).toEqual([])
    })

    it('DIRECTEUR_TECHNIQUE ne voit que SON PROPRE contrat (pas celui des autres, sans employee.view_salary)', async () => {
      const admin = adminClient()
      const { data: dtUser } = await admin.from('users').select('id').eq('full_name', 'Demo Directeur Tech').single()
      const { data: dtEmployee } = await admin
        .from('employees')
        .select('id')
        .eq('user_id', (dtUser as { id: string }).id)
        .single()

      const { client } = await signInAs('dt.demo@medfinder.test')
      const { data } = await client.from('contracts').select('id, employee_id')
      const rows = (data ?? []) as { id: string; employee_id: string }[]
      // Visible uniquement via l'auto-acces (e.user_id = auth.uid()), donc
      // exclusivement des lignes rattachees a SA propre fiche employe.
      expect(rows.every((r) => r.employee_id === (dtEmployee as { id: string }).id)).toBe(true)
    })

    it('un employe voit son propre contrat malgre l\'absence de employee.view_salary', async () => {
      const admin = adminClient()
      const { data: employeUser } = await admin.from('users').select('id').eq('full_name', 'Demo Employe').single()
      const { data: ownEmployee } = await admin
        .from('employees')
        .select('id')
        .eq('user_id', (employeUser as { id: string }).id)
        .single()

      const { client } = await signInAs('employe.demo@medfinder.test')
      const { data, error } = await client
        .from('contracts')
        .select('id')
        .eq('employee_id', (ownEmployee as { id: string }).id)
      expect(error).toBeNull()
      expect((data ?? []).length).toBeGreaterThan(0)
    })
  })

  describe('Donnees tres sensibles (employee_sensitive_data) — employee.view_sensitive', () => {
    it('RH voit les donnees sensibles', async () => {
      const { client } = await signInAs('rh.demo@medfinder.test')
      const { data, error } = await client.from('employee_sensitive_data').select('id')
      expect(error).toBeNull()
      expect((data ?? []).length).toBeGreaterThan(0)
    })

    it('DIRECTEUR_TECHNIQUE ne voit que SA PROPRE fiche sensible (pas celle des autres)', async () => {
      const admin = adminClient()
      const { data: dtUser } = await admin.from('users').select('id').eq('full_name', 'Demo Directeur Tech').single()
      const { data: dtEmployee } = await admin
        .from('employees')
        .select('id')
        .eq('user_id', (dtUser as { id: string }).id)
        .single()

      const { client } = await signInAs('dt.demo@medfinder.test')
      const { data } = await client.from('employee_sensitive_data').select('id, employee_id')
      const rows = (data ?? []) as { id: string; employee_id: string }[]
      expect(rows.every((r) => r.employee_id === (dtEmployee as { id: string }).id)).toBe(true)
    })

    it('SUPPORT ne voit aucune donnee sensible', async () => {
      const { client } = await signInAs('support.demo@medfinder.test')
      const { data } = await client.from('employee_sensitive_data').select('id')
      expect(data ?? []).toEqual([])
    })

    it('EMPLOYE (auto-acces lecture) ne peut pas modifier ses propres donnees sensibles', async () => {
      const admin = adminClient()
      const { data: employeUser } = await admin.from('users').select('id').eq('full_name', 'Demo Employe').single()
      const { data: employeeRow } = await admin
        .from('employees')
        .select('id')
        .eq('user_id', (employeUser as { id: string }).id)
        .single()

      const { client } = await signInAs('employe.demo@medfinder.test')
      const { error } = await client
        .from('employee_sensitive_data')
        .insert({
          employee_id: (employeeRow as { id: string }).id,
          organization_id: orgA,
          nif: 'SELF-INSERTED',
        })
      expect(error).toBeTruthy()
    })
  })

  describe('Documents RH', () => {
    it('document.upload permet de deposer un fichier dans le bucket prive', async () => {
      const admin = adminClient()
      const { data: anyEmployee } = await admin
        .from('employees')
        .select('id')
        .eq('organization_id', orgA)
        .limit(1)
        .single()

      const { client } = await signInAs('rh.demo@medfinder.test')
      const path = `${orgA}/${(anyEmployee as { id: string }).id}/test-${Date.now()}.txt`
      const { error: uploadError } = await client.storage
        .from('employee-documents')
        .upload(path, new Blob(['test content'], { type: 'text/plain' }))
      expect(uploadError).toBeNull()

      const { error: insertError } = await client.from('employee_documents').insert({
        organization_id: orgA,
        employee_id: (anyEmployee as { id: string }).id,
        type: 'autre',
        storage_path: path,
        original_filename: 'test.txt',
      })
      expect(insertError).toBeNull()
    })

    it('un utilisateur d\'une autre organisation ne peut pas deposer de fichier sous le chemin de l\'org A (document.upload verifie l\'organisation, pas seulement la permission nommee)', async () => {
      const admin = adminClient()
      const { data: anyEmployee } = await admin
        .from('employees')
        .select('id')
        .eq('organization_id', orgA)
        .limit(1)
        .single()

      // orgb.demo@medfinder.test (DIRECTEUR_GENERAL, donc document.upload
      // accorde par le role) n'est PAS membre de l'organisation A — le
      // chemin de stockage porte l'org_id de la cible, has_permission()
      // doit donc refuser malgre la permission nommee correcte.
      const { client } = await signInAs('orgb.demo@medfinder.test')
      const path = `${orgA}/${(anyEmployee as { id: string }).id}/refuse-${Date.now()}.txt`
      const { error } = await client.storage
        .from('employee-documents')
        .upload(path, new Blob(['refuse'], { type: 'text/plain' }))
      expect(error).toBeTruthy()
    })

    it('un utilisateur sans acces ne peut pas lister/lire les documents d\'un employe', async () => {
      const { client } = await signInAs('agent.demo@medfinder.test')
      const { data } = await client.from('employee_documents').select('id')
      expect(data ?? []).toEqual([])
    })
  })

  describe('Fin de contrat (employee.terminate)', () => {
    it('RH peut terminer un employe', async () => {
      const admin = adminClient()
      const { data: employee } = await admin
        .from('employees')
        .insert({
          organization_id: orgA,
          matricule: '',
          first_name: 'ATerminer',
          last_name: `Test-${Date.now()}`,
          hire_date: '2026-01-01',
          status: 'active',
        })
        .select('id')
        .single()

      const { client } = await signInAs('rh.demo@medfinder.test')
      const { error } = await client
        .from('employees')
        .update({ status: 'terminated' })
        .eq('id', (employee as { id: string }).id)
      expect(error).toBeNull()

      const { data: reloaded } = await admin
        .from('employees')
        .select('status')
        .eq('id', (employee as { id: string }).id)
        .single()
      expect((reloaded as { status: string }).status).toBe('terminated')
    })

    it('MANAGER (sans employee.terminate/update) ne peut pas modifier un employe', async () => {
      const admin = adminClient()
      const { data: employee } = await admin
        .from('employees')
        .select('id')
        .eq('organization_id', orgA)
        .limit(1)
        .single()

      const { client } = await signInAs('manager.demo@medfinder.test')
      const { error, count } = await client
        .from('employees')
        .update({ status: 'terminated' }, { count: 'exact' })
        .eq('id', (employee as { id: string }).id)
      // RLS silencieuse : 0 ligne affectee plutot qu'une erreur explicite
      // (comportement standard PostgREST pour un UPDATE hors perimetre RLS).
      expect(error).toBeNull()
      expect(count ?? 0).toBe(0)
    })
  })

  describe('Isolation multi-organisation (nouvelles tables Phase 1B)', () => {
    it('un utilisateur de l\'organisation B ne voit aucun employe/contrat/departement de A', async () => {
      const { client } = await signInAs('orgb.demo@medfinder.test')
      const [employees, departments, contracts, sensitive] = await Promise.all([
        client.from('employees').select('id').eq('organization_id', orgA),
        client.from('departments').select('id').eq('organization_id', orgA),
        client.from('contracts').select('id').eq('organization_id', orgA),
        client.from('employee_sensitive_data').select('id').eq('organization_id', orgA),
      ])
      expect(employees.data ?? []).toEqual([])
      expect(departments.data ?? []).toEqual([])
      expect(contracts.data ?? []).toEqual([])
      expect(sensitive.data ?? []).toEqual([])
      void orgB
    })
  })
})
