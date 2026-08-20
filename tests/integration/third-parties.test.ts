import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { signInAs, adminClient, getOrgIdByName } from './helpers'
import { FixtureRegistry, tag } from '../support/fixture-registry'

/**
 * Phase 2C — jalon 2C.1 : referentiel de tiers + liaison fournisseur aux
 * depenses. Ce jalon ne genere AUCUNE ecriture comptable : les tests
 * ci-dessous verifient le referentiel, la RLS/RBAC, l'isolation
 * multi-organisation, l'immutabilite, et la NON-REGRESSION du workflow
 * de depense de la Phase 1C.4.
 *
 * Permissions reutilisees (aucune creee) : customer.manage et
 * supplier.manage, seedees depuis la Phase 1A.
 *   - COMPTABLE  : possede les DEUX
 *   - DIRECTEUR_GENERAL : customer.manage uniquement (pas supplier.manage)
 *   - EMPLOYE / SUPPORT / RH : aucune des deux
 */
describe('Phase 2C.1 — Referentiel de tiers', () => {
  let orgA: string
  let orgB: string
  let comptableClient: Awaited<ReturnType<typeof signInAs>>['client']
  const registry = new FixtureRegistry()

  beforeAll(async () => {
    orgA = await getOrgIdByName('MedFinder Demo — Organisation A')
    orgB = await getOrgIdByName('MedFinder Demo — Organisation B')
    ;({ client: comptableClient } = await signInAs('comptable.demo@medfinder.test'))
  })

  afterAll(async () => {
    await registry.cleanup(adminClient())
  })

  /** Cree un tiers via le client admin (contourne la RLS volontairement) pour les tests qui n'exercent pas la RLS. */
  async function createThirdParty(
    orgId: string,
    label: string,
    roles: { is_customer?: boolean; is_supplier?: boolean } = { is_customer: true }
  ) {
    const admin = adminClient()
    const { data, error } = await admin
      .from('third_parties')
      .insert({
        organization_id: orgId,
        legal_name: tag(`Tiers ${label}`),
        is_customer: roles.is_customer ?? false,
        is_supplier: roles.is_supplier ?? false,
      })
      .select('id, third_party_code, legal_name')
      .single()
    if (error) throw error
    registry.track('third_parties', data!.id as string)
    return data as { id: string; third_party_code: string; legal_name: string }
  }

  describe('Structure et contraintes', () => {
    it('un tiers recoit automatiquement un code via le moteur de numerotation existant', async () => {
      const tp = await createThirdParty(orgA, `code${Date.now()}`)
      expect(tp.third_party_code).toMatch(/^TRS-\d{4,}$/)
    })

    it('deux tiers consecutifs recoivent des codes distincts (increment atomique)', async () => {
      const a = await createThirdParty(orgA, `seqA${Date.now()}`)
      const b = await createThirdParty(orgA, `seqB${Date.now()}`)
      expect(a.third_party_code).not.toBe(b.third_party_code)
    })

    it('un tiers peut porter LES DEUX roles (client ET fournisseur) — identite unique', async () => {
      const tp = await createThirdParty(orgA, `both${Date.now()}`, { is_customer: true, is_supplier: true })
      const admin = adminClient()
      const { data } = await admin.from('third_parties').select('is_customer, is_supplier').eq('id', tp.id).single()
      expect(data!.is_customer).toBe(true)
      expect(data!.is_supplier).toBe(true)
    })

    it('un tiers sans aucun role est refuse (contrainte third_parties_at_least_one_role)', async () => {
      const admin = adminClient()
      const { error } = await admin.from('third_parties').insert({
        organization_id: orgA,
        legal_name: tag('Tiers sans role'),
        is_customer: false,
        is_supplier: false,
      })
      expect(error).toBeTruthy()
    })

    it('le NIF est unique par organisation, insensible a la casse', async () => {
      const admin = adminClient()
      const nif = `NIF-${Date.now()}`
      const { data: first, error: firstError } = await admin
        .from('third_parties')
        .insert({ organization_id: orgA, legal_name: tag('NIF 1'), is_customer: true, tax_id: nif })
        .select('id')
        .single()
      expect(firstError).toBeNull()
      registry.track('third_parties', first!.id as string)

      const { error: dupError } = await admin
        .from('third_parties')
        .insert({ organization_id: orgA, legal_name: tag('NIF 2'), is_customer: true, tax_id: nif.toLowerCase() })
      expect(dupError, 'un NIF duplique (casse differente) doit etre refuse').toBeTruthy()
    })

    it('plusieurs tiers SANS NIF restent possibles (index unique partiel)', async () => {
      await createThirdParty(orgA, `nonif1${Date.now()}`)
      await createThirdParty(orgA, `nonif2${Date.now()}`)
      // Aucune exception attendue — assertion portee par l'absence d'erreur ci-dessus.
      expect(true).toBe(true)
    })

    it('le meme NIF reste possible dans une AUTRE organisation', async () => {
      const admin = adminClient()
      const nif = `NIF-XORG-${Date.now()}`
      const { data: a } = await admin
        .from('third_parties')
        .insert({ organization_id: orgA, legal_name: tag('NIF orgA'), is_customer: true, tax_id: nif })
        .select('id')
        .single()
      registry.track('third_parties', a!.id as string)

      const { data: b, error } = await admin
        .from('third_parties')
        .insert({ organization_id: orgB, legal_name: tag('NIF orgB'), is_customer: true, tax_id: nif })
        .select('id')
        .single()
      expect(error).toBeNull()
      registry.track('third_parties', b!.id as string)
    })
  })

  describe('Contacts et adresses (tables enfants)', () => {
    it('un contact et une adresse peuvent etre rattaches au tiers', async () => {
      const tp = await createThirdParty(orgA, `child${Date.now()}`)
      const admin = adminClient()

      const { data: contact, error: contactError } = await admin
        .from('third_party_contacts')
        .insert({ organization_id: orgA, third_party_id: tp.id, full_name: tag('Contact principal'), is_primary: true })
        .select('id')
        .single()
      expect(contactError).toBeNull()
      registry.track('third_party_contacts', contact!.id as string)

      const { data: address, error: addressError } = await admin
        .from('third_party_addresses')
        .insert({ organization_id: orgA, third_party_id: tp.id, address_line1: tag('12 rue Test'), is_primary: true })
        .select('id')
        .single()
      expect(addressError).toBeNull()
      registry.track('third_party_addresses', address!.id as string)
    })

    it('au plus UN contact principal par tiers', async () => {
      const tp = await createThirdParty(orgA, `oneprimary${Date.now()}`)
      const admin = adminClient()
      const { data: first } = await admin
        .from('third_party_contacts')
        .insert({ organization_id: orgA, third_party_id: tp.id, full_name: tag('Principal 1'), is_primary: true })
        .select('id')
        .single()
      registry.track('third_party_contacts', first!.id as string)

      const { error } = await admin
        .from('third_party_contacts')
        .insert({ organization_id: orgA, third_party_id: tp.id, full_name: tag('Principal 2'), is_primary: true })
      expect(error, 'un second contact principal doit etre refuse').toBeTruthy()
    })

    it('un enfant rattache a un tiers d\'une AUTRE organisation est refuse', async () => {
      const tpOrgB = await createThirdParty(orgB, `xorg${Date.now()}`)
      const admin = adminClient()
      const { error } = await admin
        .from('third_party_contacts')
        .insert({ organization_id: orgA, third_party_id: tpOrgB.id, full_name: tag('Contact incoherent') })
      expect(error, 'incoherence organisation parent/enfant doit etre refusee').toBeTruthy()
    })
  })

  describe('RLS / RBAC — permissions reutilisees, aucune creee', () => {
    it('anon ne voit aucun tiers', async () => {
      const { createClient } = await import('@supabase/supabase-js')
      const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
      const { data, error } = await anon.from('third_parties').select('id')
      // RLS : soit une erreur, soit un ensemble vide — jamais de donnee.
      expect(error !== null || (data ?? []).length === 0).toBe(true)
    })

    it('COMPTABLE (customer.manage + supplier.manage) peut creer un tiers mixte', async () => {
      const { data, error } = await comptableClient
        .from('third_parties')
        .insert({
          organization_id: orgA,
          legal_name: tag(`Tiers COMPTABLE ${Date.now()}`),
          is_customer: true,
          is_supplier: true,
        })
        .select('id')
        .single()
      expect(error).toBeNull()
      registry.track('third_parties', data!.id as string)
    })

    it('EMPLOYE (aucune des deux permissions) ne peut ni lire ni creer', async () => {
      const { client } = await signInAs('employe.demo@medfinder.test')

      const { data: readData } = await client.from('third_parties').select('id')
      expect(readData ?? []).toEqual([])

      const { error: writeError } = await client.from('third_parties').insert({
        organization_id: orgA,
        legal_name: tag('Tiers interdit EMPLOYE'),
        is_customer: true,
      })
      expect(writeError, 'un EMPLOYE ne doit pas pouvoir creer un tiers').toBeTruthy()
    })

    it('SUPPORT (aucune des deux permissions) ne peut ni lire ni creer', async () => {
      const { client } = await signInAs('support.demo@medfinder.test')

      const { data: readData } = await client.from('third_parties').select('id')
      expect(readData ?? []).toEqual([])

      const { error: writeError } = await client.from('third_parties').insert({
        organization_id: orgA,
        legal_name: tag('Tiers interdit SUPPORT'),
        is_customer: true,
      })
      expect(writeError).toBeTruthy()
    })

    it('un acteur d\'Org B ne voit aucun tiers d\'Org A (isolation multi-organisation)', async () => {
      const tpA = await createThirdParty(orgA, `isolation${Date.now()}`)
      const { client } = await signInAs('orgb.demo@medfinder.test')

      const { data } = await client.from('third_parties').select('id').eq('id', tpA.id)
      expect(data ?? [], 'aucune fiche d\'Org A ne doit etre visible depuis Org B').toEqual([])
    })

    it('IDOR : un acteur d\'Org B ne peut pas creer un tiers DANS Org A', async () => {
      const { client } = await signInAs('orgb.demo@medfinder.test')
      const { error } = await client.from('third_parties').insert({
        organization_id: orgA, // organisation d'autrui fournie par le client
        legal_name: tag('Tiers IDOR'),
        is_customer: true,
      })
      expect(error, 'creation cross-organisation doit etre refusee').toBeTruthy()
    })

    it('aucune suppression possible depuis un client authentifie (aucune policy DELETE)', async () => {
      const tp = await createThirdParty(orgA, `nodelete${Date.now()}`)
      const { error } = await comptableClient.from('third_parties').delete().eq('id', tp.id)

      const admin = adminClient()
      const { data: still } = await admin.from('third_parties').select('id').eq('id', tp.id).maybeSingle()
      expect(still, 'le tiers doit toujours exister — aucune policy DELETE').not.toBeNull()
      void error
    })
  })

  describe('Immutabilite : un tiers utilise en comptabilite n\'est jamais supprimable', () => {
    it('suppression refusee MEME via service_role si le tiers porte une ligne d\'ecriture', async () => {
      const admin = adminClient()
      const tp = await createThirdParty(orgA, `used${Date.now()}`, { is_customer: true })

      // Rattache le tiers a une ligne d'ecriture existante (colonne
      // polymorphe deja presente depuis 1C.1) pour simuler un usage
      // comptable, sans creer d'ecriture nouvelle.
      const { data: line } = await admin
        .from('journal_entry_lines')
        .select('id, entry_id')
        .limit(1)
        .maybeSingle()

      if (!line) {
        // Aucune ligne disponible dans l'environnement : le test ne peut
        // pas prouver l'immutabilite — echec explicite plutot qu'un faux vert.
        throw new Error('Aucune journal_entry_lines disponible pour exercer ce scenario')
      }

      const { error: updateError } = await admin
        .from('journal_entry_lines')
        .update({ third_party_type: 'customer', third_party_id: tp.id })
        .eq('id', line.id)

      if (updateError) {
        // La ligne appartient a une ecriture deja comptabilisee (immuable
        // depuis 1C.1) : on ne peut pas la rattacher. Scenario non
        // exercable sur cette ligne — signale explicitement.
        throw new Error(`Impossible de rattacher le tiers a une ligne pour le test: ${updateError.message}`)
      }

      const { error: deleteError } = await admin.from('third_parties').delete().eq('id', tp.id)
      expect(deleteError, 'la suppression doit etre refusee par le trigger d\'immutabilite').toBeTruthy()

      // Nettoyage : detache le tiers pour que le registre puisse supprimer la fiche.
      await admin
        .from('journal_entry_lines')
        .update({ third_party_type: null, third_party_id: null })
        .eq('id', line.id)
    })

    it('un tiers JAMAIS utilise reste supprimable via service_role', async () => {
      const admin = adminClient()
      const { data: tp } = await admin
        .from('third_parties')
        .insert({ organization_id: orgA, legal_name: tag(`Tiers jamais utilise ${Date.now()}`), is_customer: true })
        .select('id')
        .single()

      const { error } = await admin.from('third_parties').delete().eq('id', tp!.id)
      expect(error).toBeNull()
    })
  })

  describe('Liaison fournisseur aux depenses (decision arbitree n°1)', () => {
    async function anyBudgetLine() {
      const admin = adminClient()
      const { data } = await admin
        .from('budget_lines')
        .select('id')
        .eq('organization_id', orgA)
        .limit(1)
        .maybeSingle()
      if (!data) throw new Error('Aucune budget_line disponible dans Org A pour ce test')
      return data.id as string
    }

    async function requesterId() {
      const admin = adminClient()
      const { data } = await admin.from('users').select('id').eq('full_name', 'Demo Comptable').single()
      return data!.id as string
    }

    it('NON-REGRESSION : une depense reste creable SANS supplier_id (colonne facultative)', async () => {
      const admin = adminClient()
      const { data, error } = await admin
        .from('expense_requests')
        .insert({
          organization_id: orgA,
          budget_line_id: await anyBudgetLine(),
          requester_id: await requesterId(),
          payee_name: tag('Beneficiaire ponctuel sans fiche'),
          amount: 500,
          payment_method: 'cash',
          status: 'draft',
        })
        .select('id, supplier_id, payee_name')
        .single()
      expect(error).toBeNull()
      registry.track('expense_requests', data!.id as string)
      expect(data!.supplier_id, 'supplier_id doit rester nul et facultatif').toBeNull()
      expect(data!.payee_name, 'payee_name reste le snapshot historique').toContain('Beneficiaire ponctuel')
    })

    it('une depense peut etre rattachee a un fournisseur, payee_name restant conserve', async () => {
      const admin = adminClient()
      const supplier = await createThirdParty(orgA, `fourn${Date.now()}`, { is_supplier: true })

      const { data, error } = await admin
        .from('expense_requests')
        .insert({
          organization_id: orgA,
          budget_line_id: await anyBudgetLine(),
          requester_id: await requesterId(),
          payee_name: tag('Snapshot au moment de la depense'),
          supplier_id: supplier.id,
          amount: 750,
          payment_method: 'bank',
          status: 'draft',
        })
        .select('id, supplier_id, payee_name')
        .single()
      expect(error).toBeNull()
      registry.track('expense_requests', data!.id as string)
      expect(data!.supplier_id).toBe(supplier.id)
      expect(data!.payee_name, 'le snapshot coexiste avec le lien').toContain('Snapshot au moment')
    })

    it('rattacher un tiers SANS role fournisseur est refuse', async () => {
      const admin = adminClient()
      const customerOnly = await createThirdParty(orgA, `clientonly${Date.now()}`, { is_customer: true, is_supplier: false })

      const { error } = await admin.from('expense_requests').insert({
        organization_id: orgA,
        budget_line_id: await anyBudgetLine(),
        requester_id: await requesterId(),
        payee_name: tag('Rattachement invalide'),
        supplier_id: customerOnly.id,
        amount: 100,
        payment_method: 'cash',
        status: 'draft',
      })
      expect(error, 'un tiers non-fournisseur ne doit pas etre rattachable').toBeTruthy()
    })

    it('rattacher un fournisseur d\'une AUTRE organisation est refuse', async () => {
      const admin = adminClient()
      const supplierOrgB = await createThirdParty(orgB, `fournB${Date.now()}`, { is_supplier: true })

      const { error } = await admin.from('expense_requests').insert({
        organization_id: orgA,
        budget_line_id: await anyBudgetLine(),
        requester_id: await requesterId(),
        payee_name: tag('Rattachement cross-org'),
        supplier_id: supplierOrgB.id,
        amount: 100,
        payment_method: 'cash',
        status: 'draft',
      })
      expect(error, 'incoherence organisation doit etre refusee').toBeTruthy()
    })

    it('un fournisseur reference par une depense n\'est plus supprimable (on delete restrict)', async () => {
      const admin = adminClient()
      const supplier = await createThirdParty(orgA, `restrict${Date.now()}`, { is_supplier: true })

      const { data: expense } = await admin
        .from('expense_requests')
        .insert({
          organization_id: orgA,
          budget_line_id: await anyBudgetLine(),
          requester_id: await requesterId(),
          payee_name: tag('Depense verrouillant le fournisseur'),
          supplier_id: supplier.id,
          amount: 200,
          payment_method: 'cash',
          status: 'draft',
        })
        .select('id')
        .single()
      registry.track('expense_requests', expense!.id as string)

      const { error } = await admin.from('third_parties').delete().eq('id', supplier.id)
      expect(error, 'la FK on delete restrict doit bloquer la suppression').toBeTruthy()
    })
  })

  describe('Numerotation — aucune regression sur les types existants', () => {
    it('chaque organisation dispose des 4 sequences (employee, journal_entry, expense, third_party)', async () => {
      const admin = adminClient()
      for (const orgId of [orgA, orgB]) {
        const { data } = await admin
          .from('numbering_sequences')
          .select('entity_type')
          .eq('organization_id', orgId)
        const types = (data ?? []).map((r) => r.entity_type as string)
        for (const expected of ['employee', 'journal_entry', 'expense', 'third_party']) {
          expect(types, `sequence "${expected}" manquante pour l'organisation ${orgId}`).toContain(expected)
        }
      }
    })

    it('les motifs des sequences preexistantes sont INCHANGES', async () => {
      const admin = adminClient()
      const { data } = await admin
        .from('numbering_sequences')
        .select('entity_type, prefix_pattern, reset_rule')
        .eq('organization_id', orgA)
        .in('entity_type', ['employee', 'journal_entry', 'expense'])

      const byType = Object.fromEntries((data ?? []).map((r) => [r.entity_type, r]))
      expect(byType['employee'].prefix_pattern).toBe('EMP-{seq:04d}')
      expect(byType['employee'].reset_rule).toBe('never')
      expect(byType['journal_entry'].prefix_pattern).toBe('JE-{year}-{seq:04d}')
      expect(byType['journal_entry'].reset_rule).toBe('yearly')
      expect(byType['expense'].prefix_pattern).toBe('DEP-{year}-{seq:04d}')
      expect(byType['expense'].reset_rule).toBe('yearly')
    })
  })

  describe('Hardening — alignement sur le lint Supabase', () => {
    it('aucune nouvelle fonction avec search_path mutable', async () => {
      const admin = adminClient()
      for (const schema of ['public', 'app_private']) {
        const { data, error } = await admin.rpc('debug_functions_with_mutable_search_path', { p_schema: schema })
        expect(error).toBeNull()
        expect(data ?? [], `search_path mutable detecte dans ${schema}`).toEqual([])
      }
    })
  })
})
