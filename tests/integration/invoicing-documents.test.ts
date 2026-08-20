import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { signInAs, signInAsElevated, adminClient, getOrgIdByName } from './helpers'
import { FixtureRegistry, tag } from '../support/fixture-registry'

/**
 * Phase 2C — jalon 2C.2 : socle documentaire de facturation client.
 *
 * CE JALON NE COMPTABILISE RIEN. Un test dedie verifie explicitement
 * qu'aucune ecriture (journal_entries) ni aucun mouvement de tresorerie
 * (cash_movements) n'est cree par l'emission — la comptabilisation
 * commence au jalon 2C.3.
 *
 * Permissions reutilisees (aucune creee) : invoice.manage (COMPTABLE,
 * SUPER_ADMIN) et accounting.view en lecture.
 */
describe('Phase 2C.2 — Socle documentaire de facturation', () => {
  let orgA: string
  let orgB: string
  let comptableClient: Awaited<ReturnType<typeof signInAs>>['client']
  let comptableUserId: string
  let revenueAccountA: string
  let customerA: string
  const registry = new FixtureRegistry()

  beforeAll(async () => {
    orgA = await getOrgIdByName('MedFinder Demo — Organisation A')
    orgB = await getOrgIdByName('MedFinder Demo — Organisation B')
    const session = await signInAs('comptable.demo@medfinder.test')
    comptableClient = session.client
    comptableUserId = session.userId

    const admin = adminClient()
    const { data: acct } = await admin
      .from('chart_of_accounts')
      .select('id')
      .eq('organization_id', orgA)
      .eq('type', 'revenue')
      .eq('is_active', true)
      .limit(1)
      .single()
    revenueAccountA = acct!.id as string

    customerA = (await createCustomer(orgA, `client-principal-${Date.now()}`)).id
  })

  afterAll(async () => {
    await registry.cleanup(adminClient())
  })

  async function createCustomer(orgId: string, label: string) {
    const admin = adminClient()
    const { data, error } = await admin
      .from('third_parties')
      .insert({ organization_id: orgId, legal_name: tag(`Client ${label}`), is_customer: true })
      .select('id')
      .single()
    if (error) throw error
    registry.track('third_parties', data!.id as string)
    return data as { id: string }
  }

  /** Cree un document brouillon avec une ligne, via le client admin. */
  async function createDraft(
    opts: {
      orgId?: string
      thirdPartyId?: string
      documentType?: 'INVOICE' | 'CREDIT_NOTE'
      currency?: string
      exchangeRate?: number
      creditedInvoiceId?: string | null
      creditReason?: string | null
      createdBy?: string | null
      quantity?: number
      unitPrice?: number
      taxRatePercent?: number
      revenueAccountId?: string
      withLine?: boolean
    } = {}
  ) {
    const admin = adminClient()
    const orgId = opts.orgId ?? orgA
    const { data: doc, error } = await admin
      .from('invoices')
      .insert({
        organization_id: orgId,
        third_party_id: opts.thirdPartyId ?? customerA,
        document_type: opts.documentType ?? 'INVOICE',
        currency: opts.currency ?? 'HTG',
        exchange_rate_to_htg: opts.exchangeRate ?? 1,
        credited_invoice_id: opts.creditedInvoiceId ?? null,
        credit_reason: opts.creditReason ?? null,
        document_date: '2026-08-01',
        due_date: '2026-08-31',
        created_by: opts.createdBy === undefined ? comptableUserId : opts.createdBy,
      })
      .select('id')
      .single()
    if (error) throw error
    registry.track('invoices', doc!.id as string)

    if (opts.withLine !== false) {
      const { data: line, error: lineError } = await admin
        .from('invoice_lines')
        .insert({
          organization_id: orgId,
          invoice_id: doc!.id,
          line_number: 1,
          description: tag('Prestation'),
          quantity: opts.quantity ?? 2,
          unit_price: opts.unitPrice ?? 150,
          tax_rate_percent: opts.taxRatePercent ?? 0,
          revenue_account_id: opts.revenueAccountId ?? revenueAccountA,
        })
        .select('id')
        .single()
      if (lineError) throw lineError
      registry.track('invoice_lines', line!.id as string)
    }
    return doc!.id as string
  }

  async function readDoc(id: string) {
    const admin = adminClient()
    const { data } = await admin.from('invoices').select('*').eq('id', id).single()
    return data as Record<string, unknown>
  }

  // ------------------------------------------------------------------
  describe('Structure et modele documentaire unifie', () => {
    it('une facture brouillon n\'a AUCUN numero (attribue seulement a l\'emission)', async () => {
      const id = await createDraft()
      const doc = await readDoc(id)
      expect(doc.document_number).toBeNull()
      expect(doc.status).toBe('draft')
      expect(doc.document_type).toBe('INVOICE')
    })

    it('un avoir exige un motif (contrainte invoices_credit_reason_required)', async () => {
      const admin = adminClient()
      const { error } = await admin.from('invoices').insert({
        organization_id: orgA,
        third_party_id: customerA,
        document_type: 'CREDIT_NOTE',
        due_date: '2026-08-31',
        credit_reason: null,
      })
      expect(error, 'un avoir sans motif doit etre refuse').toBeTruthy()
    })

    it('seul un avoir peut referencer une facture creditee', async () => {
      const invoiceId = await createDraft()
      const admin = adminClient()
      const { error } = await admin.from('invoices').insert({
        organization_id: orgA,
        third_party_id: customerA,
        document_type: 'INVOICE', // pas un avoir
        due_date: '2026-08-31',
        credited_invoice_id: invoiceId,
      })
      expect(error, 'une FACTURE ne peut pas crediter une autre facture').toBeTruthy()
    })

    it('l\'echeance ne peut pas preceder la date du document', async () => {
      const admin = adminClient()
      const { error } = await admin.from('invoices').insert({
        organization_id: orgA,
        third_party_id: customerA,
        document_date: '2026-08-15',
        due_date: '2026-08-01',
      })
      expect(error).toBeTruthy()
    })

    it('en HTG le taux vers HTG est necessairement 1', async () => {
      const admin = adminClient()
      const { error } = await admin.from('invoices').insert({
        organization_id: orgA,
        third_party_id: customerA,
        currency: 'HTG',
        exchange_rate_to_htg: 130,
        due_date: '2026-08-31',
      })
      expect(error, 'HTG avec un taux != 1 doit etre refuse').toBeTruthy()
    })

    it('un document doit etre rattache a un tiers portant le role CLIENT', async () => {
      const admin = adminClient()
      const { data: supplierOnly } = await admin
        .from('third_parties')
        .insert({ organization_id: orgA, legal_name: tag('Fournisseur pur'), is_supplier: true })
        .select('id')
        .single()
      registry.track('third_parties', supplierOnly!.id as string)

      const { error } = await admin.from('invoices').insert({
        organization_id: orgA,
        third_party_id: supplierOnly!.id,
        due_date: '2026-08-31',
      })
      expect(error, 'un tiers non-client ne doit pas pouvoir recevoir une facture').toBeTruthy()
    })
  })

  // ------------------------------------------------------------------
  describe('Calcul deterministe sous-total / taxe / total', () => {
    it('les montants de ligne sont calcules par la base, jamais fournis par le client', async () => {
      const id = await createDraft({ quantity: 3, unitPrice: 100, taxRatePercent: 10 })
      const admin = adminClient()
      const { data: line } = await admin
        .from('invoice_lines')
        .select('line_subtotal, tax_amount, line_total')
        .eq('invoice_id', id)
        .single()

      expect(Number(line!.line_subtotal)).toBe(300)
      expect(Number(line!.tax_amount)).toBe(30)
      expect(Number(line!.line_total)).toBe(330)
    })

    it('les totaux d\'en-tete sont recalcules depuis les lignes', async () => {
      const id = await createDraft({ quantity: 2, unitPrice: 250, taxRatePercent: 0 })
      const doc = await readDoc(id)
      expect(Number(doc.subtotal)).toBe(500)
      expect(Number(doc.tax_total)).toBe(0)
      expect(Number(doc.total)).toBe(500)
    })

    it('ajouter une seconde ligne met a jour les totaux', async () => {
      const id = await createDraft({ quantity: 1, unitPrice: 100, taxRatePercent: 0 })
      const admin = adminClient()
      const { data: line } = await admin
        .from('invoice_lines')
        .insert({
          organization_id: orgA,
          invoice_id: id,
          line_number: 2,
          description: tag('Seconde prestation'),
          quantity: 2,
          unit_price: 50,
          tax_rate_percent: 10,
          revenue_account_id: revenueAccountA,
        })
        .select('id')
        .single()
      registry.track('invoice_lines', line!.id as string)

      const doc = await readDoc(id)
      expect(Number(doc.subtotal)).toBe(200) // 100 + 100
      expect(Number(doc.tax_total)).toBe(10) // 0 + 10
      expect(Number(doc.total)).toBe(210)
    })

    it('supprimer une ligne met a jour les totaux', async () => {
      const id = await createDraft({ quantity: 1, unitPrice: 400, taxRatePercent: 0 })
      const admin = adminClient()
      await admin.from('invoice_lines').delete().eq('invoice_id', id)
      const doc = await readDoc(id)
      expect(Number(doc.total)).toBe(0)
    })

    it('un client ne peut pas imposer un montant de ligne (colonnes generees)', async () => {
      const id = await createDraft({ withLine: false })
      const admin = adminClient()
      const { error } = await admin.from('invoice_lines').insert({
        organization_id: orgA,
        invoice_id: id,
        line_number: 1,
        description: tag('Tentative de forcage'),
        quantity: 1,
        unit_price: 10,
        tax_rate_percent: 0,
        revenue_account_id: revenueAccountA,
        line_total: 999999,
      })
      expect(error, 'ecrire une colonne generee doit etre refuse').toBeTruthy()
    })
  })

  // ------------------------------------------------------------------
  describe('Devise et montant fonctionnel HTG historique', () => {
    it('une facture USD conserve son montant USD et sa contre-valeur HTG figee', async () => {
      const id = await createDraft({ currency: 'USD', exchangeRate: 132.5, quantity: 1, unitPrice: 100 })
      const doc = await readDoc(id)
      expect(doc.currency).toBe('USD')
      expect(Number(doc.total)).toBe(100)
      expect(Number(doc.total_htg)).toBe(13250) // 100 * 132.5
    })

    it('total_htg suit le total tant que le document est modifiable', async () => {
      const id = await createDraft({ currency: 'USD', exchangeRate: 100, quantity: 1, unitPrice: 10 })
      expect(Number((await readDoc(id)).total_htg)).toBe(1000)

      const admin = adminClient()
      const { data: line } = await admin
        .from('invoice_lines')
        .insert({
          organization_id: orgA,
          invoice_id: id,
          line_number: 2,
          description: tag('Ligne USD'),
          quantity: 1,
          unit_price: 5,
          tax_rate_percent: 0,
          revenue_account_id: revenueAccountA,
        })
        .select('id')
        .single()
      registry.track('invoice_lines', line!.id as string)

      expect(Number((await readDoc(id)).total_htg)).toBe(1500) // 15 * 100
    })
  })

  // ------------------------------------------------------------------
  describe('Numerotation distincte facture / avoir', () => {
    it('chaque organisation dispose des sequences customer_invoice et credit_note', async () => {
      const admin = adminClient()
      for (const orgId of [orgA, orgB]) {
        const { data } = await admin
          .from('numbering_sequences')
          .select('entity_type, prefix_pattern')
          .eq('organization_id', orgId)
          .in('entity_type', ['customer_invoice', 'credit_note'])
        const types = (data ?? []).map((r) => r.entity_type as string)
        expect(types).toContain('customer_invoice')
        expect(types).toContain('credit_note')
      }
    })

    it('une facture emise recoit un numero FAC-, un avoir un numero AV-', async () => {
      // Le createur doit differer de l'emetteur (separation des fonctions,
      // decision arbitree n°2) — sinon l'emission est legitimement refusee.
      const admin = adminClient()
      const { data: other } = await admin.from('users').select('id').eq('full_name', 'Demo Manager').single()
      const preparer = other!.id as string

      const invoiceId = await createDraft({ createdBy: preparer })
      const issued = await comptableClient.rpc('issue_invoice_document', { p_document_id: invoiceId })
      expect((issued.data as { success: boolean }).success).toBe(true)
      const invoiceNumber = (issued.data as { document_number: string }).document_number
      expect(invoiceNumber).toMatch(/^FAC-\d{4}-\d{4,}$/)

      const creditId = await createDraft({
        documentType: 'CREDIT_NOTE',
        creditedInvoiceId: invoiceId,
        creditReason: 'Geste commercial',
        createdBy: preparer,
      })
      const issuedCredit = await comptableClient.rpc('issue_invoice_document', { p_document_id: creditId })
      expect((issuedCredit.data as { success: boolean }).success).toBe(true)
      expect((issuedCredit.data as { document_number: string }).document_number).toMatch(/^AV-\d{4}-\d{4,}$/)
    })

    it('les motifs des sequences preexistantes restent INCHANGES', async () => {
      const admin = adminClient()
      const { data } = await admin
        .from('numbering_sequences')
        .select('entity_type, prefix_pattern')
        .eq('organization_id', orgA)
        .in('entity_type', ['employee', 'journal_entry', 'expense', 'third_party'])
      const byType = Object.fromEntries((data ?? []).map((r) => [r.entity_type, r.prefix_pattern]))
      expect(byType['employee']).toBe('EMP-{seq:04d}')
      expect(byType['journal_entry']).toBe('JE-{year}-{seq:04d}')
      expect(byType['expense']).toBe('DEP-{year}-{seq:04d}')
      expect(byType['third_party']).toBe('TRS-{seq:04d}')
    })
  })

  // ------------------------------------------------------------------
  describe('Workflow documentaire et separation des fonctions', () => {
    it('brouillon -> pending_issue via submit', async () => {
      const id = await createDraft()
      const { data } = await comptableClient.rpc('submit_invoice_document', { p_document_id: id })
      expect((data as { success: boolean }).success).toBe(true)
      expect((await readDoc(id)).status).toBe('pending_issue')
    })

    it('submit refuse un document sans ligne', async () => {
      const id = await createDraft({ withLine: false })
      const { data } = await comptableClient.rpc('submit_invoice_document', { p_document_id: id })
      expect((data as { success: boolean; error: string }).success).toBe(false)
      expect((data as { error: string }).error).toBe('no_lines')
    })

    it('SoD : le createur ne peut pas emettre sa propre facture', async () => {
      // Document cree PAR le comptable qui tente ensuite de l'emettre.
      const id = await createDraft({ createdBy: comptableUserId })
      const { data } = await comptableClient.rpc('issue_invoice_document', { p_document_id: id })
      expect((data as { success: boolean }).success).toBe(false)
      expect((data as { error: string }).error).toBe('self_issue_blocked')
      expect((await readDoc(id)).document_number, 'aucun numero ne doit avoir ete consomme').toBeNull()
    })

    it('un emetteur DIFFERENT du createur peut emettre', async () => {
      const admin = adminClient()
      const { data: other } = await admin.from('users').select('id').eq('full_name', 'Demo Manager').single()
      const id = await createDraft({ createdBy: other!.id as string })

      const { data } = await comptableClient.rpc('issue_invoice_document', { p_document_id: id })
      expect((data as { success: boolean }).success).toBe(true)
      const doc = await readDoc(id)
      expect(doc.status).toBe('issued')
      expect(doc.document_number).not.toBeNull()
      expect(doc.issued_by).toBe(comptableUserId)
    })

    it('exception SoD : demandee puis validee par le DG, l\'emission devient possible', async () => {
      const id = await createDraft({ createdBy: comptableUserId })

      const req = await comptableClient.rpc('request_invoice_issue_exception', {
        p_document_id: id,
        p_justification: 'Equipe reduite — seul comptable disponible',
      })
      expect((req.data as { success: boolean }).success).toBe(true)
      const exceptionId = (req.data as { exception_id: string }).exception_id

      // Auto-validation refusee, meme par le demandeur.
      const self = await comptableClient.rpc('validate_invoice_issue_exception', {
        p_exception_id: exceptionId,
        p_decision: 'approved',
      })
      expect((self.data as { success: boolean }).success).toBe(false)

      const { client: dg, deElevate } = await signInAsElevated('dg.demo@medfinder.test')
      try {
        const val = await dg.rpc('validate_invoice_issue_exception', {
          p_exception_id: exceptionId,
          p_decision: 'approved',
          p_reason: 'Validee',
        })
        expect((val.data as { success: boolean }).success).toBe(true)
      } finally {
        await deElevate()
      }

      const issued = await comptableClient.rpc('issue_invoice_document', { p_document_id: id })
      expect((issued.data as { success: boolean }).success).toBe(true)
    })

    it('annulation motivee d\'une facture emise', async () => {
      const admin = adminClient()
      const { data: other } = await admin.from('users').select('id').eq('full_name', 'Demo Manager').single()
      const id = await createDraft({ createdBy: other!.id as string })
      await comptableClient.rpc('issue_invoice_document', { p_document_id: id })

      const { data } = await comptableClient.rpc('cancel_invoice_document', {
        p_document_id: id,
        p_reason: 'Erreur de destinataire',
      })
      expect((data as { success: boolean }).success).toBe(true)
      const doc = await readDoc(id)
      expect(doc.status).toBe('cancelled')
      expect(doc.cancel_reason).toBe('Erreur de destinataire')
    })

    it('annulation sans motif refusee', async () => {
      const admin = adminClient()
      const { data: other } = await admin.from('users').select('id').eq('full_name', 'Demo Manager').single()
      const id = await createDraft({ createdBy: other!.id as string })
      await comptableClient.rpc('issue_invoice_document', { p_document_id: id })

      const { data } = await comptableClient.rpc('cancel_invoice_document', {
        p_document_id: id,
        p_reason: '   ',
      })
      expect((data as { success: boolean }).success).toBe(false)
      expect((data as { error: string }).error).toBe('reason_required')
    })
  })

  // ------------------------------------------------------------------
  describe('Avoir relie a sa facture d\'origine', () => {
    async function issuedInvoice(currency = 'HTG', rate = 1) {
      const admin = adminClient()
      const { data: other } = await admin.from('users').select('id').eq('full_name', 'Demo Manager').single()
      const id = await createDraft({ createdBy: other!.id as string, currency, exchangeRate: rate })
      await comptableClient.rpc('issue_invoice_document', { p_document_id: id })
      return id
    }

    it('un avoir peut crediter une facture EMISE', async () => {
      const invoiceId = await issuedInvoice()
      const creditId = await createDraft({
        documentType: 'CREDIT_NOTE',
        creditedInvoiceId: invoiceId,
        creditReason: 'Retour partiel',
      })
      const doc = await readDoc(creditId)
      expect(doc.credited_invoice_id).toBe(invoiceId)
      expect(doc.document_type).toBe('CREDIT_NOTE')
    })

    it('un avoir ne peut PAS crediter un document encore en brouillon', async () => {
      const draftId = await createDraft()
      const admin = adminClient()
      const { error } = await admin.from('invoices').insert({
        organization_id: orgA,
        third_party_id: customerA,
        document_type: 'CREDIT_NOTE',
        credited_invoice_id: draftId,
        credit_reason: 'Test',
        due_date: '2026-08-31',
      })
      expect(error, 'crediter un brouillon doit etre refuse').toBeTruthy()
    })

    it('un avoir ne peut pas crediter un AUTRE avoir', async () => {
      const invoiceId = await issuedInvoice()
      const creditId = await createDraft({
        documentType: 'CREDIT_NOTE',
        creditedInvoiceId: invoiceId,
        creditReason: 'Premier avoir',
      })
      const admin = adminClient()
      const { data: other } = await admin.from('users').select('id').eq('full_name', 'Demo Manager').single()
      await admin.from('invoices').update({ created_by: other!.id }).eq('id', creditId)
      await comptableClient.rpc('issue_invoice_document', { p_document_id: creditId })

      const { error } = await admin.from('invoices').insert({
        organization_id: orgA,
        third_party_id: customerA,
        document_type: 'CREDIT_NOTE',
        credited_invoice_id: creditId,
        credit_reason: 'Avoir sur avoir',
        due_date: '2026-08-31',
      })
      expect(error, 'un avoir sur avoir doit etre refuse').toBeTruthy()
    })

    it('la devise de l\'avoir doit etre celle de la facture creditee', async () => {
      const invoiceId = await issuedInvoice('USD', 130)
      const admin = adminClient()
      const { error } = await admin.from('invoices').insert({
        organization_id: orgA,
        third_party_id: customerA,
        document_type: 'CREDIT_NOTE',
        credited_invoice_id: invoiceId,
        credit_reason: 'Devise incoherente',
        currency: 'HTG',
        due_date: '2026-08-31',
      })
      expect(error, 'un avoir HTG sur une facture USD doit etre refuse').toBeTruthy()
    })
  })

  // ------------------------------------------------------------------
  describe('Immutabilite apres emission', () => {
    async function issued() {
      const admin = adminClient()
      const { data: other } = await admin.from('users').select('id').eq('full_name', 'Demo Manager').single()
      const id = await createDraft({ createdBy: other!.id as string })
      await comptableClient.rpc('issue_invoice_document', { p_document_id: id })
      return id
    }

    it('modifier un montant apres emission est refuse MEME via service_role', async () => {
      const id = await issued()
      const admin = adminClient()
      const { error } = await admin.from('invoices').update({ total: 1 }).eq('id', id)
      expect(error, 'la garde est en base, opposable a service_role').toBeTruthy()
    })

    it('modifier la date ou la devise apres emission est refuse', async () => {
      const id = await issued()
      const admin = adminClient()
      const { error: dateError } = await admin.from('invoices').update({ due_date: '2027-01-01' }).eq('id', id)
      expect(dateError).toBeTruthy()
      const { error: currencyError } = await admin.from('invoices').update({ currency: 'USD' }).eq('id', id)
      expect(currencyError).toBeTruthy()
    })

    it('modifier une LIGNE apres emission est refuse', async () => {
      const id = await issued()
      const admin = adminClient()
      const { error } = await admin.from('invoice_lines').update({ unit_price: 1 }).eq('invoice_id', id)
      expect(error).toBeTruthy()
    })

    it('supprimer une ligne apres emission est refuse', async () => {
      const id = await issued()
      const admin = adminClient()
      const { error } = await admin.from('invoice_lines').delete().eq('invoice_id', id)
      expect(error).toBeTruthy()
    })

    it('DELETE destructif d\'un document EMIS est refuse MEME via service_role', async () => {
      const id = await issued()
      const admin = adminClient()
      const { error } = await admin.from('invoices').delete().eq('id', id)
      expect(error).toBeTruthy()

      const { data: still } = await admin.from('invoices').select('id').eq('id', id).maybeSingle()
      expect(still, 'le document doit toujours exister').not.toBeNull()
    })

    it('NON-SUR-BLOCAGE : un BROUILLON reste modifiable et supprimable', async () => {
      const id = await createDraft()
      const admin = adminClient()

      const { error: updateError } = await admin.from('invoices').update({ notes: 'note ajoutee' }).eq('id', id)
      expect(updateError, 'un brouillon doit rester modifiable').toBeNull()

      const { error: deleteError } = await admin.from('invoices').delete().eq('id', id)
      expect(deleteError, 'un brouillon doit rester supprimable').toBeNull()
    })

    it('NON-SUR-BLOCAGE : les notes restent modifiables apres emission', async () => {
      const id = await issued()
      const admin = adminClient()
      const { error } = await admin.from('invoices').update({ notes: 'commentaire post-emission' }).eq('id', id)
      expect(error, 'les champs non structurants doivent rester ouverts').toBeNull()
    })
  })

  // ------------------------------------------------------------------
  describe('Frontiere comptable du socle documentaire', () => {
    // NOTE : ce bloc verifiait initialement qu'une EMISSION ne creait
    // aucune ecriture — invariant vrai uniquement pendant la fenetre
    // 2C.2. Depuis le jalon 2C.3, l'emission comptabilise (couvert par
    // tests/integration/invoice-accounting.test.ts). L'invariant durable
    // conserve ici est celui du BROUILLON : tant qu'un document n'est
    // pas emis, il n'a AUCUN impact comptable ni tresorerie.
    it('un document en BROUILLON ne cree ni ecriture comptable ni mouvement de tresorerie', async () => {
      const admin = adminClient()
      const { count: entriesBefore } = await admin
        .from('journal_entries')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgA)
      const { count: movementsBefore } = await admin
        .from('cash_movements')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgA)

      const { data: other } = await admin.from('users').select('id').eq('full_name', 'Demo Manager').single()
      await createDraft({ createdBy: other!.id as string })

      const { count: entriesAfter } = await admin
        .from('journal_entries')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgA)
      const { count: movementsAfter } = await admin
        .from('cash_movements')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgA)

      expect(entriesAfter, 'un brouillon ne cree aucune ecriture').toBe(entriesBefore)
      expect(movementsAfter, 'un brouillon ne cree aucun mouvement de tresorerie').toBe(movementsBefore)
    })
  })

  // ------------------------------------------------------------------
  describe('RLS / RBAC / IDOR / multi-organisation', () => {
    it('anon ne voit aucun document', async () => {
      const { createClient } = await import('@supabase/supabase-js')
      const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
      const { data, error } = await anon.from('invoices').select('id')
      expect(error !== null || (data ?? []).length === 0).toBe(true)
    })

    it('anon ne peut executer aucune des RPC de workflow', async () => {
      const { createClient } = await import('@supabase/supabase-js')
      const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
      for (const fn of ['submit_invoice_document', 'issue_invoice_document']) {
        const { error } = await anon.rpc(fn, { p_document_id: customerA })
        expect(error, `${fn} doit etre inaccessible a anon`).toBeTruthy()
        expect(error!.code).toBe('42501')
      }
    })

    it('EMPLOYE (sans invoice.manage ni accounting.view) ne voit rien et ne peut rien creer', async () => {
      const id = await createDraft()
      const { client } = await signInAs('employe.demo@medfinder.test')

      const { data } = await client.from('invoices').select('id').eq('id', id)
      expect(data ?? []).toEqual([])

      const { error } = await client.from('invoices').insert({
        organization_id: orgA,
        third_party_id: customerA,
        due_date: '2026-08-31',
      })
      expect(error).toBeTruthy()
    })

    it('EMPLOYE se voit refuser les RPC avec not_authorized (jamais une execution)', async () => {
      const id = await createDraft()
      const { client } = await signInAs('employe.demo@medfinder.test')
      const { data } = await client.rpc('issue_invoice_document', { p_document_id: id })
      expect((data as { success: boolean }).success).toBe(false)
      expect((data as { error: string }).error).toBe('not_authorized')
    })

    it('isolation : un acteur d\'Org B ne voit aucun document d\'Org A', async () => {
      const id = await createDraft()
      const { client } = await signInAs('orgb.demo@medfinder.test')
      const { data } = await client.from('invoices').select('id').eq('id', id)
      expect(data ?? []).toEqual([])
    })

    it('IDOR : un acteur d\'Org B ne peut pas emettre un document d\'Org A', async () => {
      const admin = adminClient()
      const { data: other } = await admin.from('users').select('id').eq('full_name', 'Demo Manager').single()
      const id = await createDraft({ createdBy: other!.id as string })

      const { client } = await signInAs('orgb.demo@medfinder.test')
      const { data } = await client.rpc('issue_invoice_document', { p_document_id: id })
      expect((data as { success: boolean }).success).toBe(false)
      expect((data as { error: string }).error).toBe('not_authorized')

      expect((await readDoc(id)).document_number, 'aucun numero consomme').toBeNull()
    })

    it('IDOR : impossible de creer un document dans une autre organisation', async () => {
      const { client } = await signInAs('orgb.demo@medfinder.test')
      const { error } = await client.from('invoices').insert({
        organization_id: orgA,
        third_party_id: customerA,
        due_date: '2026-08-31',
      })
      expect(error).toBeTruthy()
    })

    it('une facture ne peut pas referencer un tiers d\'une AUTRE organisation', async () => {
      const customerB = await createCustomer(orgB, `clientB-${Date.now()}`)
      const admin = adminClient()
      const { error } = await admin.from('invoices').insert({
        organization_id: orgA,
        third_party_id: customerB.id,
        due_date: '2026-08-31',
      })
      expect(error).toBeTruthy()
    })

    it('une ligne ne peut pas utiliser un compte de produit d\'une AUTRE organisation', async () => {
      const id = await createDraft({ withLine: false })
      const admin = adminClient()
      const { data: acctB } = await admin
        .from('chart_of_accounts')
        .select('id')
        .eq('organization_id', orgB)
        .eq('type', 'revenue')
        .limit(1)
        .single()

      const { error } = await admin.from('invoice_lines').insert({
        organization_id: orgA,
        invoice_id: id,
        line_number: 1,
        description: tag('Compte hors organisation'),
        quantity: 1,
        unit_price: 10,
        revenue_account_id: acctB!.id,
      })
      expect(error).toBeTruthy()
    })
  })

  // ------------------------------------------------------------------
  describe('Fiscalite : rien de code en dur', () => {
    it('aucun taux de taxe n\'est seede par la migration', async () => {
      // L'assertion « table vide » ne peut pas tenir durablement : un
      // taux utilise par une ligne de document emis devient
      // insupprimable (FK on delete restrict + lignes immuables), donc
      // les fixtures des tests 2C.3A subsistent. L'invariant REEL, lui,
      // est durable : la migration ne cree AUCUN taux — tout taux
      // present provient d'une creation explicite (ici, les fixtures de
      // test, identifiables par TEST_FIXTURE_MARKER).
      const admin = adminClient()
      const { data } = await admin
        .from('tax_rates').select('id, code, label').eq('organization_id', orgA)
      const notCreatedByTests = (data ?? []).filter((r) => !String(r.label).startsWith('[TEST-FIXTURE]'))
      expect(
        notCreatedByTests,
        'aucune fiscalite ne doit etre presumee par la migration'
      ).toEqual([])
    })

    it('une facture SANS aucun taux configure fonctionne integralement', async () => {
      const id = await createDraft({ quantity: 4, unitPrice: 25, taxRatePercent: 0 })
      const doc = await readDoc(id)
      expect(Number(doc.subtotal)).toBe(100)
      expect(Number(doc.tax_total)).toBe(0)
      expect(Number(doc.total)).toBe(100)
    })
  })

  // ------------------------------------------------------------------
  describe('Hardening', () => {
    it('aucune fonction avec search_path mutable', async () => {
      const admin = adminClient()
      for (const schema of ['public', 'app_private']) {
        const { data, error } = await admin.rpc('debug_functions_with_mutable_search_path', { p_schema: schema })
        expect(error).toBeNull()
        expect(data ?? [], `search_path mutable dans ${schema}`).toEqual([])
      }
    })
  })
})
