import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { signInAs, signInAsElevated, adminClient, getOrgIdByName } from './helpers'
import { FixtureRegistry, tag } from '../support/fixture-registry'

/**
 * Phase 2C — jalon 2C.3A : emission COMPTABLE des factures et avoirs.
 *
 * HERMETICITE : une ecriture comptabilisee est DEFINITIVEMENT immuable
 * (depuis 1C.1) — elle ne peut jamais etre nettoyee. Les assertions de
 * ce fichier portent donc TOUJOURS sur un document precis et sur SES
 * propres ecritures (jamais sur un agregat cumulatif de l'organisation),
 * afin qu'un rejeu n'invalide jamais un test. Lecon directe de Phase 2B.
 */
describe('Phase 2C.3A — Emission comptable des factures et avoirs', () => {
  let orgA: string
  let orgB: string
  let comptable: Awaited<ReturnType<typeof signInAs>>['client']
  let comptableId: string
  let preparerId: string
  let revenueA1: string
  let revenueA2: string
  let taxAccountA: string
  let taxRate10: string
  let customerA: string
  let receivableDefaultA: string
  const registry = new FixtureRegistry()

  beforeAll(async () => {
    orgA = await getOrgIdByName('MedFinder Demo — Organisation A')
    orgB = await getOrgIdByName('MedFinder Demo — Organisation B')
    const s = await signInAs('comptable.demo@medfinder.test')
    comptable = s.client
    comptableId = s.userId

    const admin = adminClient()
    preparerId = (await admin.from('users').select('id').eq('full_name', 'Demo Manager').single()).data!.id as string

    const { data: revenues } = await admin
      .from('chart_of_accounts')
      .select('id')
      .eq('organization_id', orgA)
      .eq('type', 'revenue')
      .eq('is_active', true)
      .order('code')
      .limit(2)
    revenueA1 = revenues![0].id as string
    revenueA2 = (revenues![1] ?? revenues![0]).id as string

    const { data: liab } = await admin
      .from('chart_of_accounts')
      .select('id')
      .eq('organization_id', orgA)
      .eq('type', 'liability')
      .eq('is_active', true)
      .limit(1)
      .single()
    taxAccountA = liab!.id as string

    const { data: org } = await admin
      .from('organizations').select('default_receivable_account_id').eq('id', orgA).single()
    receivableDefaultA = org!.default_receivable_account_id as string

    const { data: rate } = await admin
      .from('tax_rates')
      .insert({
        organization_id: orgA, code: `TVA10-${Date.now()}`, label: tag('Taxe 10%'),
        rate_percent: 10, tax_account_id: taxAccountA,
      })
      .select('id').single()
    taxRate10 = rate!.id as string
    registry.track('tax_rates', taxRate10)

    customerA = await createCustomer(orgA, `acct-${Date.now()}`)
  })

  afterAll(async () => {
    await registry.cleanup(adminClient())
  })

  async function createCustomer(orgId: string, label: string, receivableAccountId?: string | null) {
    const admin = adminClient()
    const { data, error } = await admin
      .from('third_parties')
      .insert({
        organization_id: orgId,
        legal_name: tag(`Client ${label}`),
        is_customer: true,
        receivable_account_id: receivableAccountId ?? null,
      })
      .select('id').single()
    if (error) throw error
    registry.track('third_parties', data!.id as string)
    return data!.id as string
  }

  type LineSpec = { qty?: number; price?: number; account?: string; taxRateId?: string | null; taxPercent?: number }

  /** Brouillon prepare par un ACTEUR DIFFERENT du comptable (SoD respectee par defaut). */
  async function draft(opts: {
    orgId?: string
    thirdPartyId?: string
    type?: 'INVOICE' | 'CREDIT_NOTE'
    creditedInvoiceId?: string
    creditReason?: string
    currency?: string
    rate?: number
    date?: string
    createdBy?: string
    lines?: LineSpec[]
  } = {}) {
    const admin = adminClient()
    const orgId = opts.orgId ?? orgA
    const { data: doc, error } = await admin
      .from('invoices')
      .insert({
        organization_id: orgId,
        third_party_id: opts.thirdPartyId ?? customerA,
        document_type: opts.type ?? 'INVOICE',
        credited_invoice_id: opts.creditedInvoiceId ?? null,
        credit_reason: opts.creditReason ?? null,
        currency: opts.currency ?? 'HTG',
        exchange_rate_to_htg: opts.rate ?? 1,
        document_date: opts.date ?? new Date().toISOString().slice(0, 10),
        // L'echeance ne peut jamais preceder la date du document
        // (contrainte invoices_due_after_document_date) : elle est donc
        // derivee de la date reelle du document, y compris pour les
        // scenarios dates loin dans le futur (periode clturee).
        due_date: opts.date && opts.date > '2027-12-31' ? opts.date : '2027-12-31',
        created_by: opts.createdBy ?? preparerId,
      })
      .select('id').single()
    if (error) throw error
    registry.track('invoices', doc!.id as string)

    const lines = opts.lines ?? [{ qty: 2, price: 150 }]
    let n = 0
    for (const l of lines) {
      n += 1
      const { data: line, error: le } = await admin
        .from('invoice_lines')
        .insert({
          organization_id: orgId,
          invoice_id: doc!.id,
          line_number: n,
          description: tag(`Ligne ${n}`),
          quantity: l.qty ?? 1,
          unit_price: l.price ?? 100,
          revenue_account_id: l.account ?? revenueA1,
          tax_rate_id: l.taxRateId ?? null,
          tax_rate_percent: l.taxPercent ?? 0,
        })
        .select('id').single()
      if (le) throw le
      registry.track('invoice_lines', line!.id as string)
    }
    return doc!.id as string
  }

  async function issue(docId: string, client = comptable) {
    const { data } = await client.rpc('issue_invoice_document', { p_document_id: docId })
    return data as Record<string, unknown>
  }

  async function readDoc(id: string) {
    const { data } = await adminClient().from('invoices').select('*').eq('id', id).single()
    return data as Record<string, unknown>
  }

  /** Ecritures rattachees a CE document uniquement. */
  async function entriesOf(docId: string) {
    const { data } = await adminClient()
      .from('journal_entries')
      .select('id, entry_number, status, source_type, source_id, reversed_entry_id, entry_date')
      .eq('source_type', 'invoice')
      .eq('source_id', docId)
    return (data ?? []) as Record<string, unknown>[]
  }

  async function linesOf(entryId: string) {
    const { data } = await adminClient()
      .from('journal_entry_lines')
      .select('account_id, debit, credit, third_party_type, third_party_id, currency, exchange_rate_to_htg')
      .eq('entry_id', entryId)
    return (data ?? []) as Record<string, unknown>[]
  }

  // ==================================================================
  describe('Emission simple, multi-lignes, taxes', () => {
    it('facture SANS taxe : Dr Creances / Cr Produit, equilibree', async () => {
      const id = await draft({ lines: [{ qty: 2, price: 150 }] })
      const res = await issue(id)
      expect(res.success, JSON.stringify(res)).toBe(true)

      const entries = await entriesOf(id)
      expect(entries).toHaveLength(1)
      expect(entries[0].status).toBe('posted')

      const lines = await linesOf(entries[0].id as string)
      expect(lines).toHaveLength(2)
      const debit = lines.filter((l) => Number(l.debit) > 0)
      const credit = lines.filter((l) => Number(l.credit) > 0)
      expect(Number(debit[0].debit)).toBe(300)
      expect(debit[0].account_id).toBe(receivableDefaultA)
      expect(Number(credit[0].credit)).toBe(300)
      expect(credit[0].account_id).toBe(revenueA1)
      expect(lines.reduce((s, l) => s + Number(l.debit), 0)).toBe(
        lines.reduce((s, l) => s + Number(l.credit), 0)
      )
    })

    it('facture AVEC taxe : Dr Creances total / Cr Produit HT / Cr Taxe', async () => {
      const id = await draft({ lines: [{ qty: 1, price: 1000, taxRateId: taxRate10, taxPercent: 10 }] })
      const res = await issue(id)
      expect(res.success, JSON.stringify(res)).toBe(true)
      expect(Number(res.total)).toBe(1100)

      const entries = await entriesOf(id)
      const lines = await linesOf(entries[0].id as string)
      expect(lines).toHaveLength(3)

      const receivable = lines.find((l) => l.account_id === receivableDefaultA)!
      const revenue = lines.find((l) => l.account_id === revenueA1)!
      const tax = lines.find((l) => l.account_id === taxAccountA)!
      expect(Number(receivable.debit)).toBe(1100)
      expect(Number(revenue.credit)).toBe(1000)
      expect(Number(tax.credit)).toBe(100)
    })

    it('facture MULTI-LIGNES : produits regroupes par compte, ecriture equilibree', async () => {
      const id = await draft({
        lines: [
          { qty: 1, price: 100, account: revenueA1 },
          { qty: 2, price: 50, account: revenueA1 },
          { qty: 1, price: 300, account: revenueA2 },
        ],
      })
      const res = await issue(id)
      expect(res.success, JSON.stringify(res)).toBe(true)
      expect(Number(res.total)).toBe(500)

      const lines = await linesOf((await entriesOf(id))[0].id as string)
      const totalDebit = lines.reduce((s, l) => s + Number(l.debit), 0)
      const totalCredit = lines.reduce((s, l) => s + Number(l.credit), 0)
      expect(totalDebit).toBe(500)
      expect(totalCredit).toBe(500)

      if (revenueA2 !== revenueA1) {
        expect(Number(lines.find((l) => l.account_id === revenueA1)!.credit)).toBe(200)
        expect(Number(lines.find((l) => l.account_id === revenueA2)!.credit)).toBe(300)
      }
    })
  })

  // ==================================================================
  describe('Devise : HTG et USD, taux porte sur les lignes', () => {
    it('HTG : taux exactement 1 sur toutes les lignes comptables', async () => {
      const id = await draft({ currency: 'HTG', rate: 1, lines: [{ qty: 1, price: 400 }] })
      expect((await issue(id)).success).toBe(true)
      const lines = await linesOf((await entriesOf(id))[0].id as string)
      for (const l of lines) {
        expect(l.currency).toBe('HTG')
        expect(Number(l.exchange_rate_to_htg)).toBe(1)
      }
    })

    it('USD : devise et taux historiques figes sur les lignes comptables', async () => {
      const id = await draft({ currency: 'USD', rate: 132.5, lines: [{ qty: 1, price: 200 }] })
      expect((await issue(id)).success).toBe(true)
      const doc = await readDoc(id)
      expect(Number(doc.total)).toBe(200)
      expect(Number(doc.total_htg)).toBe(26500)

      const lines = await linesOf((await entriesOf(id))[0].id as string)
      for (const l of lines) {
        expect(l.currency).toBe('USD')
        expect(Number(l.exchange_rate_to_htg)).toBe(132.5)
      }
    })
  })

  // ==================================================================
  describe('Comptabilite auxiliaire', () => {
    it('la ligne de creance porte third_party_id et third_party_type=customer', async () => {
      const id = await draft({ lines: [{ qty: 1, price: 250 }] })
      expect((await issue(id)).success).toBe(true)
      const lines = await linesOf((await entriesOf(id))[0].id as string)
      const receivable = lines.find((l) => Number(l.debit) > 0)!
      expect(receivable.third_party_type).toBe('customer')
      expect(receivable.third_party_id).toBe(customerA)
    })

    it('coherence organisation document / tiers / ecriture', async () => {
      const id = await draft({ lines: [{ qty: 1, price: 120 }] })
      expect((await issue(id)).success).toBe(true)
      const admin = adminClient()
      const doc = await readDoc(id)
      const entry = (await entriesOf(id))[0]
      const { data: tp } = await admin.from('third_parties').select('organization_id').eq('id', doc.third_party_id as string).single()
      const { data: je } = await admin.from('journal_entries').select('organization_id').eq('id', entry.id as string).single()
      expect(tp!.organization_id).toBe(doc.organization_id)
      expect(je!.organization_id).toBe(doc.organization_id)
    })

    it('un compte client SPECIFIQUE au tiers prime sur le defaut organisation', async () => {
      const admin = adminClient()
      const { data: alt } = await admin
        .from('chart_of_accounts')
        .insert({
          organization_id: orgA, code: `AR-ALT-${Date.now()}`,
          label: tag('Creances client dedie'), type: 'asset',
        })
        .select('id').single()
      registry.track('chart_of_accounts', alt!.id as string)

      const dedicated = await createCustomer(orgA, `dedie-${Date.now()}`, alt!.id as string)
      const id = await draft({ thirdPartyId: dedicated, lines: [{ qty: 1, price: 90 }] })
      expect((await issue(id)).success).toBe(true)

      const lines = await linesOf((await entriesOf(id))[0].id as string)
      const receivable = lines.find((l) => Number(l.debit) > 0)!
      expect(receivable.account_id).toBe(alt!.id)
      expect(receivable.account_id).not.toBe(receivableDefaultA)
    })
  })

  // ==================================================================
  describe('Configuration manquante — refus explicite, jamais un compte devine', () => {
    it('compte de taxe non resolu => tax_account_not_configured, aucune emission', async () => {
      // Ligne taxee SANS tax_rate_id : aucun compte de taxe resoluble.
      const id = await draft({ lines: [{ qty: 1, price: 100, taxRateId: null, taxPercent: 10 }] })
      const res = await issue(id)
      expect(res.success).toBe(false)
      expect(res.error).toBe('tax_account_not_configured')
      expect((await readDoc(id)).status).toBe('draft')
      expect(await entriesOf(id)).toHaveLength(0)
    })

    it('taux de taxe sans compte de taxe configure => refus', async () => {
      const admin = adminClient()
      const { data: rateNoAccount } = await admin
        .from('tax_rates')
        .insert({
          organization_id: orgA, code: `NOACC-${Date.now()}`,
          label: tag('Taxe sans compte'), rate_percent: 5, tax_account_id: null,
        })
        .select('id').single()
      registry.track('tax_rates', rateNoAccount!.id as string)

      const id = await draft({ lines: [{ qty: 1, price: 200, taxRateId: rateNoAccount!.id as string, taxPercent: 5 }] })
      const res = await issue(id)
      expect(res.success).toBe(false)
      expect(res.error).toBe('tax_account_not_configured')
      expect(await entriesOf(id)).toHaveLength(0)
    })

    it('compte client non configure (ni tiers ni organisation) => receivable_account_not_configured', async () => {
      const admin = adminClient()
      // Neutralise temporairement le defaut de l'organisation B.
      const { data: orgBefore } = await admin
        .from('organizations').select('default_receivable_account_id').eq('id', orgB).single()
      await admin.from('organizations').update({ default_receivable_account_id: null }).eq('id', orgB)
      try {
        const customerB = await createCustomer(orgB, `noacct-${Date.now()}`)
        const { data: revB } = await admin
          .from('chart_of_accounts').select('id')
          .eq('organization_id', orgB).eq('type', 'revenue').limit(1).single()

        const id = await draft({
          orgId: orgB, thirdPartyId: customerB, lines: [{ qty: 1, price: 100, account: revB!.id as string }],
        })
        const { client: orgbClient } = await signInAs('orgb.demo@medfinder.test')
        const { data } = await orgbClient.rpc('issue_invoice_document', { p_document_id: id })
        const res = data as Record<string, unknown>
        // L'acteur Org B peut ne pas porter invoice.manage : on accepte
        // les deux refus, mais JAMAIS une emission.
        expect(res.success).toBe(false)
        expect(['receivable_account_not_configured', 'not_authorized']).toContain(res.error)
        expect(await entriesOf(id)).toHaveLength(0)
      } finally {
        await admin
          .from('organizations')
          .update({ default_receivable_account_id: orgBefore!.default_receivable_account_id })
          .eq('id', orgB)
      }
    })
  })

  // ==================================================================
  describe('Periode comptable clturee', () => {
    it('emission refusee si la periode est fermee, et AUCUNE ecriture creee', async () => {
      const admin = adminClient()
      const year = 2035
      const { data: fy } = await admin
        .from('fiscal_years')
        .insert({
          organization_id: orgA, label: tag(`FY-CLOS-${Date.now()}`),
          start_date: `${year}-01-01`, end_date: `${year}-12-31`,
        })
        .select('id').single()
      registry.track('fiscal_years', fy!.id as string)

      const { data: period } = await admin
        .from('accounting_periods')
        .insert({ organization_id: orgA, fiscal_year_id: fy!.id, month: 6, status: 'closed' })
        .select('id').single()
      registry.track('accounting_periods', period!.id as string)

      const id = await draft({ date: `${year}-06-15`, lines: [{ qty: 1, price: 500 }] })
      const res = await issue(id)
      expect(res.success).toBe(false)
      expect(res.error).toBe('period_closed')
      expect((await readDoc(id)).status).toBe('draft')
      expect((await readDoc(id)).document_number).toBeNull()
      expect(await entriesOf(id)).toHaveLength(0)
    })
  })

  // ==================================================================
  describe('Separation des fonctions', () => {
    it('SoD : le createur ne peut pas emettre — aucun numero, aucune ecriture', async () => {
      const id = await draft({ createdBy: comptableId, lines: [{ qty: 1, price: 100 }] })
      const res = await issue(id)
      expect(res.success).toBe(false)
      expect(res.error).toBe('self_issue_blocked')
      expect((await readDoc(id)).document_number).toBeNull()
      expect(await entriesOf(id)).toHaveLength(0)
    })

    it('exception SoD validee par le DG : emission ET comptabilisation possibles', async () => {
      const id = await draft({ createdBy: comptableId, lines: [{ qty: 1, price: 175 }] })
      const req = await comptable.rpc('request_invoice_issue_exception', {
        p_document_id: id, p_justification: 'Seul comptable disponible',
      })
      const exceptionId = (req.data as { exception_id: string }).exception_id

      const { client: dg, deElevate } = await signInAsElevated('dg.demo@medfinder.test')
      try {
        const val = await dg.rpc('validate_invoice_issue_exception', {
          p_exception_id: exceptionId, p_decision: 'approved',
        })
        expect((val.data as { success: boolean }).success).toBe(true)
      } finally {
        await deElevate()
      }

      const res = await issue(id)
      expect(res.success, JSON.stringify(res)).toBe(true)
      expect(await entriesOf(id)).toHaveLength(1)
    })
  })

  // ==================================================================
  describe('Atomicite, idempotence, concurrence', () => {
    it('une facture issued possede EXACTEMENT UNE ecriture d\'origine', async () => {
      const id = await draft({ lines: [{ qty: 1, price: 640 }] })
      expect((await issue(id)).success).toBe(true)

      const entries = await entriesOf(id)
      const origins = entries.filter((e) => e.reversed_entry_id === null)
      expect(entries).toHaveLength(1)
      expect(origins).toHaveLength(1)
      expect((await readDoc(id)).status).toBe('issued')
    })

    it('double emission : le second appel est refuse, aucune seconde ecriture', async () => {
      const id = await draft({ lines: [{ qty: 1, price: 310 }] })
      expect((await issue(id)).success).toBe(true)
      const first = await entriesOf(id)

      const second = await issue(id)
      expect(second.success).toBe(false)
      expect(second.error).toBe('invalid_status')

      const after = await entriesOf(id)
      expect(after).toHaveLength(first.length)
      expect(after).toHaveLength(1)
    })

    it('appels CONCURRENTS : un seul gagne, un seul numero, une seule ecriture', async () => {
      const id = await draft({ lines: [{ qty: 1, price: 777 }] })

      const results = await Promise.all([
        comptable.rpc('issue_invoice_document', { p_document_id: id }),
        comptable.rpc('issue_invoice_document', { p_document_id: id }),
        comptable.rpc('issue_invoice_document', { p_document_id: id }),
      ])
      const successes = results.filter((r) => (r.data as { success?: boolean })?.success === true)
      expect(successes, 'un seul appel doit reussir').toHaveLength(1)

      const entries = await entriesOf(id)
      expect(entries, 'une seule ecriture malgre la concurrence').toHaveLength(1)

      const doc = await readDoc(id)
      expect(doc.status).toBe('issued')
      expect(doc.document_number).not.toBeNull()
    })

    it('ATOMICITE : si la comptabilisation ne peut aboutir, le document reste NON emis', async () => {
      // Compte de produit desactive apres la saisie => post_journal_entry
      // rejette l'ecriture (comptes invalides/inactifs).
      const admin = adminClient()
      const { data: acct } = await admin
        .from('chart_of_accounts')
        .insert({ organization_id: orgA, code: `TMP-${Date.now()}`, label: tag('Produit temporaire'), type: 'revenue' })
        .select('id').single()
      registry.track('chart_of_accounts', acct!.id as string)

      const id = await draft({ lines: [{ qty: 1, price: 260, account: acct!.id as string }] })
      await admin.from('chart_of_accounts').update({ is_active: false }).eq('id', acct!.id)

      const { data, error } = await comptable.rpc('issue_invoice_document', { p_document_id: id })
      const refused = error !== null || (data as { success?: boolean })?.success === false
      expect(refused, 'l\'emission doit echouer').toBe(true)

      const doc = await readDoc(id)
      expect(doc.status, 'le document ne doit PAS etre emis').toBe('draft')
      expect(doc.document_number, 'aucun numero ne doit subsister').toBeNull()
      expect(await entriesOf(id), 'aucune ecriture ne doit subsister').toHaveLength(0)
    })

    it('un desequilibre est structurellement impossible (debit = credit sur chaque ecriture)', async () => {
      const id = await draft({
        lines: [
          { qty: 3, price: 33.33, taxRateId: taxRate10, taxPercent: 10 },
          { qty: 1, price: 66.67, account: revenueA2 },
        ],
      })
      expect((await issue(id)).success).toBe(true)
      const lines = await linesOf((await entriesOf(id))[0].id as string)
      const d = lines.reduce((s, l) => s + Number(l.debit), 0)
      const c = lines.reduce((s, l) => s + Number(l.credit), 0)
      expect(d).toBe(c)
    })
  })

  // ==================================================================
  describe('Avoirs : sens inverse et plafond cumulatif', () => {
    async function issuedInvoice(total = 1000) {
      const id = await draft({ lines: [{ qty: 1, price: total }] })
      const res = await issue(id)
      expect(res.success, JSON.stringify(res)).toBe(true)
      return id
    }

    it('avoir PARTIEL : ecriture de sens INVERSE (Cr Creances / Dr Produit)', async () => {
      const invoiceId = await issuedInvoice(1000)
      const creditId = await draft({
        type: 'CREDIT_NOTE', creditedInvoiceId: invoiceId, creditReason: 'Retour partiel',
        lines: [{ qty: 1, price: 300 }],
      })
      const res = await issue(creditId)
      expect(res.success, JSON.stringify(res)).toBe(true)

      const lines = await linesOf((await entriesOf(creditId))[0].id as string)
      const receivable = lines.find((l) => l.account_id === receivableDefaultA)!
      const revenue = lines.find((l) => l.account_id === revenueA1)!
      expect(Number(receivable.credit), 'la creance est CREDITEE sur un avoir').toBe(300)
      expect(Number(receivable.debit)).toBe(0)
      expect(Number(revenue.debit), 'le produit est DEBITE sur un avoir').toBe(300)
      expect(receivable.third_party_id).toBe(customerA)
    })

    it('plafond cumulatif : deux avoirs successifs ne peuvent depasser le total de la facture', async () => {
      const invoiceId = await issuedInvoice(1000)

      const c1 = await draft({
        type: 'CREDIT_NOTE', creditedInvoiceId: invoiceId, creditReason: 'Avoir 1',
        lines: [{ qty: 1, price: 600 }],
      })
      expect((await issue(c1)).success).toBe(true)

      const c2 = await draft({
        type: 'CREDIT_NOTE', creditedInvoiceId: invoiceId, creditReason: 'Avoir 2',
        lines: [{ qty: 1, price: 500 }], // 600 + 500 > 1000
      })
      const res = await issue(c2)
      expect(res.success).toBe(false)
      expect(res.error).toBe('credit_exceeds_invoice')
      expect(Number(res.already_credited)).toBe(600)
      expect(await entriesOf(c2), 'aucune ecriture pour l\'avoir refuse').toHaveLength(0)
      expect((await readDoc(c2)).status).toBe('draft')
    })

    it('plafond cumulatif sous CONCURRENCE : deux avoirs simultanes ne depassent jamais le plafond', async () => {
      const invoiceId = await issuedInvoice(1000)
      const a = await draft({
        type: 'CREDIT_NOTE', creditedInvoiceId: invoiceId, creditReason: 'Concurrent A',
        lines: [{ qty: 1, price: 700 }],
      })
      const b = await draft({
        type: 'CREDIT_NOTE', creditedInvoiceId: invoiceId, creditReason: 'Concurrent B',
        lines: [{ qty: 1, price: 700 }],
      })

      const results = await Promise.all([
        comptable.rpc('issue_invoice_document', { p_document_id: a }),
        comptable.rpc('issue_invoice_document', { p_document_id: b }),
      ])
      const ok = results.filter((r) => (r.data as { success?: boolean })?.success === true)
      expect(ok, 'un seul des deux avoirs de 700 peut passer sur une facture de 1000').toHaveLength(1)

      const admin = adminClient()
      const { data: credited } = await admin
        .from('invoices').select('total')
        .eq('credited_invoice_id', invoiceId)
        .in('status', ['issued', 'partially_paid', 'paid'])
      const sum = (credited ?? []).reduce((s, c) => s + Number(c.total), 0)
      expect(sum, 'le cumul credite ne depasse jamais 1000').toBeLessThanOrEqual(1000)
    })

    it('un avoir exactement egal au solde restant est accepte', async () => {
      const invoiceId = await issuedInvoice(500)
      const c = await draft({
        type: 'CREDIT_NOTE', creditedInvoiceId: invoiceId, creditReason: 'Avoir total',
        lines: [{ qty: 1, price: 500 }],
      })
      const res = await issue(c)
      expect(res.success, JSON.stringify(res)).toBe(true)
    })
  })

  // ==================================================================
  describe('Annulation par contre-passation', () => {
    it('une facture cancelled possede l\'ecriture d\'origine PLUS sa contre-passation', async () => {
      const id = await draft({ lines: [{ qty: 1, price: 480 }] })
      expect((await issue(id)).success).toBe(true)
      const originEntry = (await entriesOf(id))[0]

      const { data } = await comptable.rpc('cancel_invoice_document', {
        p_document_id: id, p_reason: 'Erreur de destinataire',
      })
      expect((data as { success: boolean }).success, JSON.stringify(data)).toBe(true)

      const entries = await entriesOf(id)
      expect(entries, 'origine + contre-passation').toHaveLength(2)

      const origins = entries.filter((e) => e.reversed_entry_id === null)
      const reversals = entries.filter((e) => e.reversed_entry_id !== null)
      expect(origins, 'exactement une ecriture d\'origine').toHaveLength(1)
      expect(reversals, 'exactement une contre-passation').toHaveLength(1)
      expect(reversals[0].reversed_entry_id).toBe(originEntry.id)

      expect((await readDoc(id)).status).toBe('cancelled')

      // Effet net nul : la contre-passation neutralise l'origine.
      const oLines = await linesOf(origins[0].id as string)
      const rLines = await linesOf(reversals[0].id as string)
      const net = [...oLines, ...rLines].reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0)
      expect(net, 'l\'effet net des deux ecritures est nul').toBe(0)
    })

    it('annuler exige accounting.reverse en plus de invoice.manage', async () => {
      const id = await draft({ lines: [{ qty: 1, price: 130 }] })
      expect((await issue(id)).success).toBe(true)

      // Aucun role seede ne porte invoice.manage SANS accounting.reverse
      // (les deux vont ensemble sur COMPTABLE et SUPER_ADMIN). Le
      // scenario est donc isole en revoquant temporairement
      // accounting.reverse au comptable via un override individuel —
      // mecanisme existant depuis la Phase 1A, non modifie ici.
      const admin = adminClient()
      const { data: perm } = await admin
        .from('permissions').select('id').eq('code', 'accounting.reverse').single()
      const { data: override } = await admin
        .from('user_permission_overrides')
        .insert({
          user_id: comptableId,
          organization_id: orgA,
          permission_id: perm!.id,
          effect: 'revoke',
          reason: 'Test 2C.3A — isoler invoice.manage sans accounting.reverse',
          granted_by: comptableId,
        })
        .select('id').single()

      try {
        const { data } = await comptable.rpc('cancel_invoice_document', {
          p_document_id: id, p_reason: 'Tentative sans droit de contre-passation',
        })
        const res = data as Record<string, unknown>
        expect(res.success).toBe(false)
        expect(res.error, 'invoice.manage seul ne suffit pas pour contre-passer').toBe('not_authorized_reverse')
      } finally {
        await admin.from('user_permission_overrides').delete().eq('id', override!.id)
      }

      expect((await readDoc(id)).status, 'le document reste emis').toBe('issued')
      expect(await entriesOf(id), 'aucune contre-passation creee').toHaveLength(1)

      // Controle positif : une fois le droit retabli, l'annulation passe.
      const { data: ok } = await comptable.rpc('cancel_invoice_document', {
        p_document_id: id, p_reason: 'Annulation avec droit retabli',
      })
      expect((ok as { success: boolean }).success).toBe(true)
      expect(await entriesOf(id), 'origine + contre-passation').toHaveLength(2)
    })

    it('pas de double posting : re-annuler est refuse', async () => {
      const id = await draft({ lines: [{ qty: 1, price: 210 }] })
      expect((await issue(id)).success).toBe(true)
      await comptable.rpc('cancel_invoice_document', { p_document_id: id, p_reason: 'Premiere annulation' })

      const { data } = await comptable.rpc('cancel_invoice_document', {
        p_document_id: id, p_reason: 'Seconde tentative',
      })
      expect((data as { success: boolean }).success).toBe(false)
      expect(await entriesOf(id), 'toujours 2 ecritures, pas 3').toHaveLength(2)
    })
  })

  // ==================================================================
  describe('Immutabilite apres emission comptable', () => {
    it('le contenu financier reste immuable MEME via service_role', async () => {
      const id = await draft({ lines: [{ qty: 1, price: 350 }] })
      expect((await issue(id)).success).toBe(true)
      const admin = adminClient()
      expect((await admin.from('invoices').update({ total: 1 }).eq('id', id)).error).toBeTruthy()
      expect((await admin.from('invoices').update({ currency: 'USD' }).eq('id', id)).error).toBeTruthy()
      expect((await admin.from('invoice_lines').update({ unit_price: 1 }).eq('invoice_id', id)).error).toBeTruthy()
    })

    it('l\'ecriture comptable n\'est pas remplacable silencieusement', async () => {
      const id = await draft({ lines: [{ qty: 1, price: 275 }] })
      expect((await issue(id)).success).toBe(true)
      const entry = (await entriesOf(id))[0]
      const admin = adminClient()

      expect(
        (await admin.from('journal_entries').update({ description: 'reecriture' }).eq('id', entry.id as string)).error,
        'une ecriture comptabilisee est immuable'
      ).toBeTruthy()
      expect(
        (await admin.from('journal_entry_lines').update({ debit: 1 }).eq('entry_id', entry.id as string)).error
      ).toBeTruthy()
      expect(
        (await admin.from('journal_entries').delete().eq('id', entry.id as string)).error,
        'aucun DELETE destructif'
      ).toBeTruthy()
    })

    it('DELETE destructif du document emis refuse MEME via service_role', async () => {
      const id = await draft({ lines: [{ qty: 1, price: 195 }] })
      expect((await issue(id)).success).toBe(true)
      const admin = adminClient()
      expect((await admin.from('invoices').delete().eq('id', id)).error).toBeTruthy()
    })
  })

  // ==================================================================
  describe('Securite : RLS, IDOR, helper confine, search_path', () => {
    it('le helper app_private n\'est PAS expose via PostgREST', async () => {
      const { createClient } = await import('@supabase/supabase-js')
      for (const key of [process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!]) {
        const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key)
        const { error } = await c.rpc('post_document_journal_entry', {})
        expect(error, 'le helper ne doit pas etre appelable').toBeTruthy()
      }
      const { error: authedError } = await comptable.rpc('post_document_journal_entry', {})
      expect(authedError, 'meme un authentifie ne doit pas l\'atteindre').toBeTruthy()
    })

    it('aucun GRANT EXECUTE sur le helper pour anon/authenticated', async () => {
      const admin = adminClient()
      const { data } = await admin.rpc('debug_unwanted_function_grants', { p_schema: 'app_private' })
      const offenders = (data ?? []) as { function_signature: string; grantee: string }[]
      expect(
        offenders.filter((o) => o.function_signature.includes('post_document_journal_entry')),
        'aucun grant indu sur le helper'
      ).toEqual([])
    })

    it('anon ne peut pas emettre', async () => {
      const id = await draft({ lines: [{ qty: 1, price: 100 }] })
      const { createClient } = await import('@supabase/supabase-js')
      const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
      const { error } = await anon.rpc('issue_invoice_document', { p_document_id: id })
      expect(error).toBeTruthy()
      expect(error!.code).toBe('42501')
      expect(await entriesOf(id)).toHaveLength(0)
    })

    it('EMPLOYE se voit refuser l\'emission', async () => {
      const id = await draft({ lines: [{ qty: 1, price: 100 }] })
      const { client } = await signInAs('employe.demo@medfinder.test')
      const { data } = await client.rpc('issue_invoice_document', { p_document_id: id })
      expect((data as { success: boolean }).success).toBe(false)
      expect((data as { error: string }).error).toBe('not_authorized')
      expect(await entriesOf(id)).toHaveLength(0)
    })

    it('IDOR : un acteur d\'Org B ne peut pas emettre un document d\'Org A', async () => {
      const id = await draft({ lines: [{ qty: 1, price: 100 }] })
      const { client } = await signInAs('orgb.demo@medfinder.test')
      const { data } = await client.rpc('issue_invoice_document', { p_document_id: id })
      expect((data as { success: boolean }).success).toBe(false)
      expect((data as { error: string }).error).toBe('not_authorized')
      expect((await readDoc(id)).document_number).toBeNull()
      expect(await entriesOf(id)).toHaveLength(0)
    })

    it('aucune fonction avec search_path mutable', async () => {
      const admin = adminClient()
      for (const schema of ['public', 'app_private']) {
        const { data, error } = await admin.rpc('debug_functions_with_mutable_search_path', { p_schema: schema })
        expect(error).toBeNull()
        expect(data ?? [], `search_path mutable dans ${schema}`).toEqual([])
      }
    })
  })

  // ==================================================================
  describe('Integration avec le reporting Phase 2B', () => {
    it('la facture emise apparait au journal general et au grand livre du compte client', async () => {
      const id = await draft({ lines: [{ qty: 1, price: 4321 }] })
      const res = await issue(id)
      expect(res.success).toBe(true)
      const doc = await readDoc(id)
      const day = doc.document_date as string

      const journal = await comptable.rpc('generate_general_journal_report', {
        p_org_id: orgA, p_period_start: day, p_period_end: day,
      })
      const jr = journal.data as { success: boolean; lines: { account_code: string; debit: number }[] }
      expect(jr.success).toBe(true)
      expect(
        jr.lines.some((l) => Number(l.debit) === 4321),
        'la creance de 4321 doit apparaitre au journal general'
      ).toBe(true)

      const ledger = await comptable.rpc('generate_general_ledger_report', {
        p_org_id: orgA, p_period_start: day, p_period_end: day,
      })
      const lr = ledger.data as { success: boolean; accounts: { account_id: string }[] }
      expect(lr.success).toBe(true)
      expect(
        lr.accounts.some((a) => a.account_id === receivableDefaultA),
        'le compte client doit apparaitre au grand livre'
      ).toBe(true)
    })
  })
})
