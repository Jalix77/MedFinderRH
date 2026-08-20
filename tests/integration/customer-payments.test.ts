import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { signInAs, adminClient, getOrgIdByName } from './helpers'
import { FixtureRegistry, tag } from '../support/fixture-registry'

/**
 * Phase 2C — jalon 2C.3B : encaissements clients, soldes, cash movements.
 *
 * Comme en 2C.3A, chaque assertion porte sur UN document / UN paiement
 * precis et sur SES propres objets — jamais sur un agregat cumulatif de
 * l'organisation : une ecriture comptabilisee est definitivement
 * immuable et ne peut pas etre nettoyee entre deux rejeux.
 */
describe('Phase 2C.3B — Encaissements clients', () => {
  let orgA: string
  let orgB: string
  let comptable: Awaited<ReturnType<typeof signInAs>>['client']
  let comptableId: string
  let preparerId: string
  let revenueA: string
  let customerA: string
  let cashHTG: string
  let cashUSD: string
  const registry = new FixtureRegistry()

  beforeAll(async () => {
    orgA = await getOrgIdByName('MedFinder Demo — Organisation A')
    orgB = await getOrgIdByName('MedFinder Demo — Organisation B')
    const s = await signInAs('comptable.demo@medfinder.test')
    comptable = s.client
    comptableId = s.userId

    const admin = adminClient()
    preparerId = (await admin.from('users').select('id').eq('full_name', 'Demo Manager').single()).data!.id as string
    revenueA = (await admin.from('chart_of_accounts').select('id')
      .eq('organization_id', orgA).eq('type', 'revenue').eq('is_active', true).limit(1).single()).data!.id as string
    customerA = await createCustomer(orgA, `pay-${Date.now()}`)
    cashHTG = await createCashAccount(orgA, `HTG-${Date.now()}`, 'HTG')
    cashUSD = await createCashAccount(orgA, `USD-${Date.now()}`, 'USD')
  })

  afterAll(async () => {
    await registry.cleanup(adminClient())
  })

  async function createCustomer(orgId: string, label: string) {
    const admin = adminClient()
    const { data, error } = await admin.from('third_parties')
      .insert({ organization_id: orgId, legal_name: tag(`Client ${label}`), is_customer: true })
      .select('id').single()
    if (error) throw error
    registry.track('third_parties', data!.id as string)
    return data!.id as string
  }

  async function createCashAccount(orgId: string, label: string, currency: string) {
    const admin = adminClient()
    const { data: gl, error: glErr } = await admin.from('chart_of_accounts')
      .insert({ organization_id: orgId, code: `TRZ-${label}`, label: tag(`Caisse ${label}`), type: 'asset' })
      .select('id').single()
    if (glErr) throw glErr
    registry.track('chart_of_accounts', gl!.id as string)

    const { data, error } = await admin.from('cash_accounts')
      .insert({ organization_id: orgId, name: tag(`Caisse ${label}`), currency, gl_account_id: gl!.id })
      .select('id').single()
    if (error) throw error
    registry.track('cash_accounts', data!.id as string)
    return data!.id as string
  }

  /** Facture EMISE (createur != emetteur, SoD respectee). */
  async function issuedInvoice(total: number, currency = 'HTG', rate = 1, orgId = orgA, tpId?: string, accountId?: string) {
    const admin = adminClient()
    const { data: doc, error } = await admin.from('invoices').insert({
      organization_id: orgId,
      third_party_id: tpId ?? customerA,
      currency, exchange_rate_to_htg: rate,
      document_date: new Date().toISOString().slice(0, 10),
      due_date: '2027-12-31',
      created_by: preparerId,
    }).select('id').single()
    if (error) throw error
    registry.track('invoices', doc!.id as string)

    const { data: line, error: le } = await admin.from('invoice_lines').insert({
      organization_id: orgId, invoice_id: doc!.id, line_number: 1,
      description: tag('Prestation'), quantity: 1, unit_price: total,
      revenue_account_id: accountId ?? revenueA,
    }).select('id').single()
    if (le) throw le
    registry.track('invoice_lines', line!.id as string)

    const res = await comptable.rpc('issue_invoice_document', { p_document_id: doc!.id })
    expect((res.data as { success: boolean })?.success, JSON.stringify(res.data ?? res.error)).toBe(true)
    return doc!.id as string
  }

  async function draftInvoice(total: number) {
    const admin = adminClient()
    const { data: doc } = await admin.from('invoices').insert({
      organization_id: orgA, third_party_id: customerA,
      document_date: new Date().toISOString().slice(0, 10), due_date: '2027-12-31',
      created_by: preparerId,
    }).select('id').single()
    registry.track('invoices', doc!.id as string)
    const { data: line } = await admin.from('invoice_lines').insert({
      organization_id: orgA, invoice_id: doc!.id, line_number: 1,
      description: tag('Brouillon'), quantity: 1, unit_price: total, revenue_account_id: revenueA,
    }).select('id').single()
    registry.track('invoice_lines', line!.id as string)
    return doc!.id as string
  }

  async function pay(invoiceId: string, amount: number, opts: { account?: string; type?: string; date?: string; client?: typeof comptable } = {}) {
    const c = opts.client ?? comptable
    const { data, error } = await c.rpc('record_customer_payment', {
      p_invoice_id: invoiceId,
      p_amount: amount,
      p_payment_date: opts.date ?? new Date().toISOString().slice(0, 10),
      p_treasury_account_type: opts.type ?? 'cash',
      p_treasury_account_id: opts.account ?? cashHTG,
    })
    if (data) {
      const d = data as { payment_id?: string }
      if (d.payment_id) registry.track('customer_payments', d.payment_id)
    }
    return { data: data as Record<string, unknown> | null, error }
  }

  async function readInvoice(id: string) {
    const { data } = await adminClient().from('invoices').select('*').eq('id', id).single()
    return data as Record<string, unknown>
  }

  async function paymentsOf(invoiceId: string) {
    const { data } = await adminClient().from('customer_payments')
      .select('id, payment_number, amount, status, journal_entry_id, cash_movement_id')
      .eq('invoice_id', invoiceId)
    return (data ?? []) as Record<string, unknown>[]
  }

  // ==================================================================
  describe('Paiements partiels, complets et solde deterministe', () => {
    it('paiement PARTIEL : statut partially_paid, solde exact', async () => {
      const inv = await issuedInvoice(1000)
      const { data } = await pay(inv, 300)
      expect(data!.success, JSON.stringify(data)).toBe(true)

      const doc = await readInvoice(inv)
      expect(Number(doc.amount_paid)).toBe(300)
      expect(Number(doc.balance_due)).toBe(700)
      expect(doc.status).toBe('partially_paid')
    })

    it('SECOND paiement : le solde se cumule correctement', async () => {
      const inv = await issuedInvoice(1000)
      expect((await pay(inv, 300)).data!.success).toBe(true)
      expect((await pay(inv, 250)).data!.success).toBe(true)

      const doc = await readInvoice(inv)
      expect(Number(doc.amount_paid)).toBe(550)
      expect(Number(doc.balance_due)).toBe(450)
      expect(doc.status).toBe('partially_paid')
    })

    it('paiement FINAL : statut paid, solde nul', async () => {
      const inv = await issuedInvoice(1000)
      expect((await pay(inv, 400)).data!.success).toBe(true)
      expect((await pay(inv, 600)).data!.success).toBe(true)

      const doc = await readInvoice(inv)
      expect(Number(doc.amount_paid)).toBe(1000)
      expect(Number(doc.balance_due)).toBe(0)
      expect(doc.status).toBe('paid')
    })

    it('paiement integral en une fois : issued -> paid directement', async () => {
      const inv = await issuedInvoice(750)
      expect((await pay(inv, 750)).data!.success).toBe(true)
      const doc = await readInvoice(inv)
      expect(doc.status).toBe('paid')
      expect(Number(doc.balance_due)).toBe(0)
    })

    it('le solde est DERIVE des paiements comptabilises, verifiable', async () => {
      const inv = await issuedInvoice(900)
      await pay(inv, 200)
      await pay(inv, 100)

      const admin = adminClient()
      const { data: sum } = await admin.from('customer_payments')
        .select('amount').eq('invoice_id', inv).eq('status', 'recorded')
      const computed = (sum ?? []).reduce((s, p) => s + Number(p.amount), 0)
      const doc = await readInvoice(inv)
      expect(Number(doc.amount_paid), 'amount_paid = somme des paiements recorded').toBe(computed)
    })

    it('amount_paid n\'est pas modifiable directement par un client', async () => {
      const inv = await issuedInvoice(500)
      const { error } = await comptable.from('invoices').update({ amount_paid: 500 }).eq('id', inv)
      const doc = await readInvoice(inv)
      expect(Number(doc.amount_paid), 'aucune mutation cliente du solde').toBe(0)
      void error
    })
  })

  // ==================================================================
  describe('Surpaiement impossible', () => {
    it('un paiement superieur au solde est refuse', async () => {
      const inv = await issuedInvoice(500)
      const { data } = await pay(inv, 600)
      expect(data!.success).toBe(false)
      expect(data!.error).toBe('overpayment')
      expect(Number((await readInvoice(inv)).amount_paid)).toBe(0)
      expect(await paymentsOf(inv)).toHaveLength(0)
    })

    it('un second paiement depassant le solde restant est refuse', async () => {
      const inv = await issuedInvoice(500)
      expect((await pay(inv, 400)).data!.success).toBe(true)
      const { data } = await pay(inv, 200)
      expect(data!.success).toBe(false)
      expect(data!.error).toBe('overpayment')
      expect(Number(data!.balance_due)).toBe(100)
      expect(Number((await readInvoice(inv)).amount_paid)).toBe(400)
    })

    it('CONCURRENCE : deux paiements simultanes ne peuvent pas surpayer', async () => {
      const inv = await issuedInvoice(1000)
      const results = await Promise.all([
        pay(inv, 700),
        pay(inv, 700),
      ])
      const ok = results.filter((r) => r.data?.success === true)
      expect(ok, 'un seul des deux paiements de 700 peut passer sur 1000').toHaveLength(1)

      const doc = await readInvoice(inv)
      expect(Number(doc.amount_paid), 'le cumul ne depasse jamais le total').toBeLessThanOrEqual(1000)
      expect(Number(doc.amount_paid)).toBe(700)
    })

    it('CONCURRENCE : trois paiements simultanes du solde exact — un seul passe', async () => {
      const inv = await issuedInvoice(300)
      const results = await Promise.all([pay(inv, 300), pay(inv, 300), pay(inv, 300)])
      const ok = results.filter((r) => r.data?.success === true)
      expect(ok).toHaveLength(1)

      const doc = await readInvoice(inv)
      expect(Number(doc.amount_paid)).toBe(300)
      expect(doc.status).toBe('paid')
      expect((await paymentsOf(inv)).filter((p) => p.status === 'recorded')).toHaveLength(1)
    })
  })

  // ==================================================================
  describe('Documents non encaissables', () => {
    it('un BROUILLON ne peut pas etre encaisse', async () => {
      const inv = await draftInvoice(400)
      const { data } = await pay(inv, 100)
      expect(data!.success).toBe(false)
      expect(data!.error).toBe('invalid_status')
      expect(await paymentsOf(inv)).toHaveLength(0)
    })

    it('une facture ANNULEE ne peut pas etre encaissee', async () => {
      const inv = await issuedInvoice(400)
      const cancel = await comptable.rpc('cancel_invoice_document', {
        p_document_id: inv, p_reason: 'Annulation avant encaissement',
      })
      expect((cancel.data as { success: boolean }).success).toBe(true)

      const { data } = await pay(inv, 100)
      expect(data!.success).toBe(false)
      expect(data!.error).toBe('invalid_status')
      expect(await paymentsOf(inv)).toHaveLength(0)
    })

    it('un AVOIR ne peut pas etre encaisse comme une facture', async () => {
      const invoiceId = await issuedInvoice(1000)
      const admin = adminClient()
      const { data: credit } = await admin.from('invoices').insert({
        organization_id: orgA, third_party_id: customerA,
        document_type: 'CREDIT_NOTE', credited_invoice_id: invoiceId,
        credit_reason: 'Avoir test', document_date: new Date().toISOString().slice(0, 10),
        due_date: '2027-12-31', created_by: preparerId,
      }).select('id').single()
      registry.track('invoices', credit!.id as string)
      const { data: cl } = await admin.from('invoice_lines').insert({
        organization_id: orgA, invoice_id: credit!.id, line_number: 1,
        description: tag('Ligne avoir'), quantity: 1, unit_price: 200, revenue_account_id: revenueA,
      }).select('id').single()
      registry.track('invoice_lines', cl!.id as string)
      expect((await comptable.rpc('issue_invoice_document', { p_document_id: credit!.id })).data).toMatchObject({ success: true })

      const { data } = await pay(credit!.id as string, 100)
      expect(data!.success).toBe(false)
      expect(data!.error).toBe('not_an_invoice')
    })
  })

  // ==================================================================
  describe('Devise et compte de tresorerie', () => {
    it('facture USD encaissee sur une caisse USD : taux historique conserve', async () => {
      const inv = await issuedInvoice(200, 'USD', 130)
      const { data } = await pay(inv, 80, { account: cashUSD })
      expect(data!.success, JSON.stringify(data)).toBe(true)

      const admin = adminClient()
      const { data: p } = await admin.from('customer_payments')
        .select('currency, exchange_rate_to_htg, amount_htg').eq('id', data!.payment_id as string).single()
      expect(p!.currency).toBe('USD')
      expect(Number(p!.exchange_rate_to_htg)).toBe(130)
      expect(Number(p!.amount_htg)).toBe(10400) // 80 * 130
    })

    it('devise incoherente : facture USD payee sur une caisse HTG => refus', async () => {
      const inv = await issuedInvoice(200, 'USD', 130)
      const { data } = await pay(inv, 50, { account: cashHTG })
      expect(data!.success).toBe(false)
      expect(data!.error).toBe('currency_mismatch')
      expect(await paymentsOf(inv)).toHaveLength(0)
    })

    it('devise incoherente : facture HTG payee sur une caisse USD => refus', async () => {
      const inv = await issuedInvoice(300)
      const { data } = await pay(inv, 100, { account: cashUSD })
      expect(data!.success).toBe(false)
      expect(data!.error).toBe('currency_mismatch')
    })

    it('compte de tresorerie inexistant => refus, aucun paiement', async () => {
      const inv = await issuedInvoice(300)
      const { data } = await pay(inv, 100, { account: '00000000-0000-0000-0000-000000000000' })
      expect(data!.success).toBe(false)
      expect(data!.error).toBe('treasury_account_not_found')
      expect(await paymentsOf(inv)).toHaveLength(0)
    })

    it('compte de tresorerie d\'une AUTRE organisation => refus', async () => {
      const cashB = await createCashAccount(orgB, `B-${Date.now()}`, 'HTG')
      const inv = await issuedInvoice(300)
      const { data } = await pay(inv, 100, { account: cashB })
      expect(data!.success).toBe(false)
      expect(data!.error).toBe('treasury_account_organization_mismatch')
    })

    it('le compte comptable de tresorerie est DEDUIT du compte choisi', async () => {
      const admin = adminClient()
      const { data: cashRow } = await admin.from('cash_accounts')
        .select('gl_account_id').eq('id', cashHTG).single()

      const inv = await issuedInvoice(500)
      const { data } = await pay(inv, 500)
      const { data: lines } = await admin.from('journal_entry_lines')
        .select('account_id, debit, credit').eq('entry_id', data!.journal_entry_id as string)

      const debitLine = (lines ?? []).find((l) => Number(l.debit) > 0)!
      expect(debitLine.account_id, 'gl_account_id du compte de caisse choisi').toBe(cashRow!.gl_account_id)
    })
  })

  // ==================================================================
  describe('Ecriture comptable et mouvement de tresorerie', () => {
    it('Dr Tresorerie / Cr Creances avec auxiliaire client', async () => {
      const inv = await issuedInvoice(600)
      const { data } = await pay(inv, 600)
      const admin = adminClient()
      const { data: lines } = await admin.from('journal_entry_lines')
        .select('account_id, debit, credit, third_party_type, third_party_id, currency, exchange_rate_to_htg')
        .eq('entry_id', data!.journal_entry_id as string)

      expect(lines).toHaveLength(2)
      const debit = (lines ?? []).find((l) => Number(l.debit) > 0)!
      const credit = (lines ?? []).find((l) => Number(l.credit) > 0)!
      expect(Number(debit.debit)).toBe(600)
      expect(Number(credit.credit)).toBe(600)
      expect(credit.third_party_type, 'la creance porte l\'auxiliaire').toBe('customer')
      expect(credit.third_party_id).toBe(customerA)
      for (const l of lines ?? []) {
        expect(l.currency).toBe('HTG')
        expect(Number(l.exchange_rate_to_htg)).toBe(1)
      }
    })

    it('EXACTEMENT une ecriture et un cash movement par paiement', async () => {
      const inv = await issuedInvoice(450)
      const { data } = await pay(inv, 450)
      const admin = adminClient()

      const { data: entries } = await admin.from('journal_entries')
        .select('id, status').eq('source_type', 'invoice').eq('source_id', data!.payment_id as string)
      expect(entries, 'une seule ecriture pour ce paiement').toHaveLength(1)
      expect(entries![0].status).toBe('posted')
      expect(entries![0].id).toBe(data!.journal_entry_id)

      const { data: movements } = await admin.from('cash_movements')
        .select('id, direction, amount, journal_entry_id').eq('id', data!.cash_movement_id as string)
      expect(movements).toHaveLength(1)
      expect(movements![0].direction).toBe('in')
      expect(Number(movements![0].amount)).toBe(450)
      expect(movements![0].journal_entry_id, 'le mouvement pointe la meme ecriture').toBe(data!.journal_entry_id)
    })

    it('lien exact paiement <-> facture <-> ecriture <-> mouvement', async () => {
      const inv = await issuedInvoice(320)
      const { data } = await pay(inv, 320)
      const admin = adminClient()
      const { data: p } = await admin.from('customer_payments')
        .select('invoice_id, journal_entry_id, cash_movement_id, organization_id')
        .eq('id', data!.payment_id as string).single()

      expect(p!.invoice_id).toBe(inv)
      expect(p!.journal_entry_id).toBe(data!.journal_entry_id)
      expect(p!.cash_movement_id).toBe(data!.cash_movement_id)

      const { data: je } = await admin.from('journal_entries')
        .select('organization_id').eq('id', p!.journal_entry_id as string).single()
      const { data: cm } = await admin.from('cash_movements')
        .select('organization_id, reference_id').eq('id', p!.cash_movement_id as string).single()
      expect(je!.organization_id).toBe(p!.organization_id)
      expect(cm!.organization_id).toBe(p!.organization_id)
      expect(cm!.reference_id).toBe(inv)
    })
  })

  // ==================================================================
  describe('Periode comptable et atomicite', () => {
    it('periode clturee => refus, aucun paiement / ecriture / mouvement', async () => {
      const admin = adminClient()
      const year = 2036
      const { data: fy } = await admin.from('fiscal_years').insert({
        organization_id: orgA, label: tag(`FY-PAY-${Date.now()}`),
        start_date: `${year}-01-01`, end_date: `${year}-12-31`,
      }).select('id').single()
      registry.track('fiscal_years', fy!.id as string)
      const { data: period } = await admin.from('accounting_periods').insert({
        organization_id: orgA, fiscal_year_id: fy!.id, month: 5, status: 'closed',
      }).select('id').single()
      registry.track('accounting_periods', period!.id as string)

      const inv = await issuedInvoice(400)
      const { data } = await pay(inv, 100, { date: `${year}-05-10` })
      expect(data!.success).toBe(false)
      expect(data!.error).toBe('period_closed')
      expect(await paymentsOf(inv)).toHaveLength(0)
      expect(Number((await readInvoice(inv)).amount_paid)).toBe(0)
    })

    it('ATOMICITE : si la comptabilisation echoue, aucun paiement ni mouvement ne subsiste', async () => {
      const admin = adminClient()
      // Compte de tresorerie dont le compte comptable est desactive apres coup.
      const { data: gl } = await admin.from('chart_of_accounts').insert({
        organization_id: orgA, code: `TRZKO-${Date.now()}`, label: tag('Caisse KO'), type: 'asset',
      }).select('id').single()
      registry.track('chart_of_accounts', gl!.id as string)
      const { data: acc } = await admin.from('cash_accounts').insert({
        organization_id: orgA, name: tag(`Caisse KO ${Date.now()}`), currency: 'HTG', gl_account_id: gl!.id,
      }).select('id').single()
      registry.track('cash_accounts', acc!.id as string)

      const inv = await issuedInvoice(280)
      await admin.from('chart_of_accounts').update({ is_active: false }).eq('id', gl!.id)

      const { data, error } = await pay(inv, 280, { account: acc!.id as string })
      const refused = error !== null || data?.success === false
      expect(refused, 'l\'encaissement doit echouer').toBe(true)

      expect(await paymentsOf(inv), 'aucun paiement ne subsiste').toHaveLength(0)
      expect(Number((await readInvoice(inv)).amount_paid)).toBe(0)
      expect((await readInvoice(inv)).status).toBe('issued')

      const { data: movements } = await admin.from('cash_movements')
        .select('id').eq('treasury_account_id', acc!.id as string)
      expect(movements ?? [], 'aucun mouvement de tresorerie ne subsiste').toEqual([])
    })
  })

  // ==================================================================
  describe('Immutabilite et correction par contre-passation', () => {
    it('un paiement comptabilise est immuable MEME via service_role', async () => {
      const inv = await issuedInvoice(500)
      const { data } = await pay(inv, 500)
      const admin = adminClient()
      const pid = data!.payment_id as string

      expect((await admin.from('customer_payments').update({ amount: 1 }).eq('id', pid)).error).toBeTruthy()
      expect((await admin.from('customer_payments').update({ invoice_id: inv }).eq('id', pid)).error).toBeFalsy()
      expect((await admin.from('customer_payments').delete().eq('id', pid)).error, 'aucun DELETE destructif').toBeTruthy()
    })

    it('annulation d\'un paiement : contre-passation, solde et statut recalcules', async () => {
      const inv = await issuedInvoice(1000)
      const { data } = await pay(inv, 1000)
      expect((await readInvoice(inv)).status).toBe('paid')
      const entryId = data!.journal_entry_id as string

      const { data: cancelled } = await comptable.rpc('cancel_customer_payment', {
        p_payment_id: data!.payment_id as string, p_reason: 'Cheque sans provision',
      })
      expect((cancelled as { success: boolean }).success, JSON.stringify(cancelled)).toBe(true)

      const doc = await readInvoice(inv)
      expect(Number(doc.amount_paid), 'solde recalcule apres annulation').toBe(0)
      expect(doc.status, 'retour a issued').toBe('issued')

      const admin = adminClient()
      const { data: entries } = await admin.from('journal_entries')
        .select('id, reversed_entry_id').eq('source_type', 'invoice').eq('source_id', data!.payment_id as string)
      expect(entries, 'origine + contre-passation').toHaveLength(2)
      expect((entries ?? []).filter((e) => e.reversed_entry_id === entryId)).toHaveLength(1)

      const { data: movements } = await admin.from('cash_movements')
        .select('direction').eq('reference_id', inv)
      const dirs = (movements ?? []).map((m) => m.direction)
      expect(dirs, 'le mouvement entrant est neutralise par un sortant').toContain('out')
    })

    it('annuler exige accounting.reverse', async () => {
      const inv = await issuedInvoice(200)
      const { data } = await pay(inv, 200)
      const admin = adminClient()
      const { data: perm } = await admin.from('permissions').select('id').eq('code', 'accounting.reverse').single()
      const { data: ov } = await admin.from('user_permission_overrides').insert({
        user_id: comptableId, organization_id: orgA, permission_id: perm!.id,
        effect: 'revoke', reason: 'Test 2C.3B', granted_by: comptableId,
      }).select('id').single()

      try {
        const { data: res } = await comptable.rpc('cancel_customer_payment', {
          p_payment_id: data!.payment_id as string, p_reason: 'Sans droit',
        })
        expect((res as { success: boolean }).success).toBe(false)
        expect((res as { error: string }).error).toBe('not_authorized_reverse')
      } finally {
        await admin.from('user_permission_overrides').delete().eq('id', ov!.id)
      }
      expect(Number((await readInvoice(inv)).amount_paid), 'solde inchange').toBe(200)
    })
  })

  // ==================================================================
  describe('Securite : RLS, IDOR, permissions', () => {
    it('anon ne peut pas encaisser', async () => {
      const inv = await issuedInvoice(300)
      const { createClient } = await import('@supabase/supabase-js')
      const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
      const { error } = await anon.rpc('record_customer_payment', {
        p_invoice_id: inv, p_amount: 10, p_payment_date: '2026-08-01',
        p_treasury_account_type: 'cash', p_treasury_account_id: cashHTG,
      })
      expect(error).toBeTruthy()
      expect(error!.code).toBe('42501')
      expect(await paymentsOf(inv)).toHaveLength(0)
    })

    it('EMPLOYE (sans payment.record) est refuse', async () => {
      const inv = await issuedInvoice(300)
      const { client } = await signInAs('employe.demo@medfinder.test')
      const { data } = await pay(inv, 100, { client })
      expect(data!.success).toBe(false)
      expect(data!.error).toBe('not_authorized')
      expect(await paymentsOf(inv)).toHaveLength(0)
    })

    it('IDOR : un acteur d\'Org B ne peut pas encaisser une facture d\'Org A', async () => {
      const inv = await issuedInvoice(300)
      const { client } = await signInAs('orgb.demo@medfinder.test')
      const { data } = await pay(inv, 100, { client })
      expect(data!.success).toBe(false)
      expect(data!.error).toBe('not_authorized')
      expect(Number((await readInvoice(inv)).amount_paid)).toBe(0)
    })

    it('EMPLOYE ne voit aucun encaissement', async () => {
      const inv = await issuedInvoice(300)
      await pay(inv, 100)
      const { client } = await signInAs('employe.demo@medfinder.test')
      const { data } = await client.from('customer_payments').select('id').eq('invoice_id', inv)
      expect(data ?? []).toEqual([])
    })

    it('aucune ecriture directe possible dans customer_payments (aucune policy INSERT)', async () => {
      const inv = await issuedInvoice(300)
      const { error } = await comptable.from('customer_payments').insert({
        organization_id: orgA, payment_number: `HACK-${Date.now()}`, invoice_id: inv,
        third_party_id: customerA, amount: 100, currency: 'HTG', exchange_rate_to_htg: 1,
        treasury_account_type: 'cash', treasury_account_id: cashHTG,
      })
      expect(error, 'les encaissements passent exclusivement par les RPC').toBeTruthy()
    })
  })

  // ==================================================================
  describe('Reporting 2B et hardening', () => {
    it('l\'encaissement apparait dans le flux de tresorerie 2B', async () => {
      const inv = await issuedInvoice(2468)
      const { data } = await pay(inv, 2468)
      expect(data!.success).toBe(true)
      const day = (await readInvoice(inv)).document_date as string

      const { data: cf } = await comptable.rpc('generate_cash_flow_report', {
        p_org_id: orgA, p_period_start: day, p_period_end: day,
      })
      const report = cf as { success: boolean; method: string; lines: { debit: number }[] }
      expect(report.success).toBe(true)
      expect(report.method).toBe('direct')
      expect(
        report.lines.some((l) => Number(l.debit) === 2468),
        'l\'encaissement de 2468 doit apparaitre en entree de tresorerie'
      ).toBe(true)
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
})
