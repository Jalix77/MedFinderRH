import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { signInAs, adminClient, getOrgIdByName } from './helpers'
import { FixtureRegistry, tag } from '../support/fixture-registry'

/**
 * Phase 2C.5B — releve client.
 *
 * Comme pour les autres suites 2C, chaque assertion porte sur UN tiers
 * dedie a ce test : un document emis et un encaissement comptabilise ne
 * peuvent jamais etre nettoyes, donc un agregat par organisation serait
 * fausse par les rejeux successifs.
 */
describe('Phase 2C.5B — Releve client', () => {
  let orgA: string
  let orgB: string
  let comptable: Awaited<ReturnType<typeof signInAs>>['client']
  let preparerId: string
  let revenueA: string
  let cashHTG: string
  const registry = new FixtureRegistry()

  const PERIOD_START = '2026-03-01'
  const PERIOD_END = '2026-03-31'
  const BEFORE = '2026-02-10'
  const INSIDE = '2026-03-15'

  beforeAll(async () => {
    orgA = await getOrgIdByName('MedFinder Demo — Organisation A')
    orgB = await getOrgIdByName('MedFinder Demo — Organisation B')
    comptable = (await signInAs('comptable.demo@medfinder.test')).client

    const admin = adminClient()
    preparerId = (await admin.from('users').select('id').eq('full_name', 'Demo Manager').single()).data!.id as string
    revenueA = (
      await admin.from('chart_of_accounts').select('id')
        .eq('organization_id', orgA).eq('type', 'revenue').eq('is_active', true).limit(1).single()
    ).data!.id as string

    // Periodes comptables ouvertes pour fevrier et mars 2026.
    await ensurePeriod(orgA, 2026, 2)
    await ensurePeriod(orgA, 2026, 3)

    const { data: gl } = await admin.from('chart_of_accounts')
      .insert({ organization_id: orgA, code: `TRZS-${Date.now()}`, label: tag('Caisse releve'), type: 'asset' })
      .select('id').single()
    registry.track('chart_of_accounts', gl!.id as string)
    const { data: acc } = await admin.from('cash_accounts')
      .insert({ organization_id: orgA, name: tag(`Caisse releve ${Date.now()}`), currency: 'HTG', gl_account_id: gl!.id })
      .select('id').single()
    registry.track('cash_accounts', acc!.id as string)
    cashHTG = acc!.id as string
  })

  afterAll(async () => {
    await registry.cleanup(adminClient())
  })

  async function ensurePeriod(orgId: string, year: number, month: number) {
    const admin = adminClient()
    const label = tag(`FY-STMT-${year}-${orgId.slice(0, 4)}`)
    let { data: fy } = await admin.from('fiscal_years').select('id')
      .eq('organization_id', orgId).eq('label', label).maybeSingle()
    if (!fy) {
      const { data: created } = await admin.from('fiscal_years')
        .insert({ organization_id: orgId, label, start_date: `${year}-01-01`, end_date: `${year}-12-31` })
        .select('id').single()
      registry.track('fiscal_years', created!.id as string)
      fy = created
    }
    const { data: existing } = await admin.from('accounting_periods').select('id')
      .eq('organization_id', orgId).eq('fiscal_year_id', fy!.id).eq('month', month).maybeSingle()
    if (!existing) {
      const { data: created } = await admin.from('accounting_periods')
        .insert({ organization_id: orgId, fiscal_year_id: fy!.id, month })
        .select('id').single()
      registry.track('accounting_periods', created!.id as string)
    }
  }

  async function createCustomer(orgId: string, label: string) {
    const admin = adminClient()
    const { data } = await admin.from('third_parties')
      .insert({ organization_id: orgId, legal_name: tag(`Client ${label}`), is_customer: true })
      .select('id').single()
    registry.track('third_parties', data!.id as string)
    return data!.id as string
  }

  async function issuedInvoice(customerId: string, total: number, date: string) {
    const admin = adminClient()
    const { data: doc } = await admin.from('invoices').insert({
      organization_id: orgA, third_party_id: customerId,
      document_date: date, due_date: '2027-12-31', created_by: preparerId,
    }).select('id').single()
    registry.track('invoices', doc!.id as string)
    const { data: line } = await admin.from('invoice_lines').insert({
      organization_id: orgA, invoice_id: doc!.id, line_number: 1,
      description: tag('Prestation'), quantity: 1, unit_price: total, revenue_account_id: revenueA,
    }).select('id').single()
    registry.track('invoice_lines', line!.id as string)

    const { data: res } = await comptable.rpc('issue_invoice_document', { p_document_id: doc!.id })
    expect((res as { success: boolean })?.success, JSON.stringify(res)).toBe(true)
    return doc!.id as string
  }

  async function pay(invoiceId: string, amount: number, date: string) {
    const { data } = await comptable.rpc('record_customer_payment', {
      p_invoice_id: invoiceId, p_amount: amount, p_payment_date: date,
      p_treasury_account_type: 'cash', p_treasury_account_id: cashHTG,
    })
    expect((data as { success: boolean })?.success, JSON.stringify(data)).toBe(true)
    const paymentId = (data as { payment_id: string }).payment_id
    registry.track('customer_payments', paymentId)
    return paymentId
  }

  async function statement(customerId: string, orgId = orgA, client = comptable) {
    const { data } = await client.rpc('generate_customer_statement_report', {
      p_org_id: orgId, p_third_party_id: customerId,
      p_period_start: PERIOD_START, p_period_end: PERIOD_END,
    })
    return data as Record<string, unknown>
  }

  // ================================================================
  it('releve vide : soldes a zero, aucun mouvement', async () => {
    const c = await createCustomer(orgA, `vide-${Date.now()}`)
    const r = await statement(c)
    expect(r.success).toBe(true)
    expect(Number(r.opening_balance)).toBe(0)
    expect(Number(r.closing_balance)).toBe(0)
    expect(r.lines).toEqual([])
  })

  it('identite du tiers et periode restituees', async () => {
    const c = await createCustomer(orgA, `identite-${Date.now()}`)
    const r = await statement(c)
    const tp = r.third_party as { id: string; legal_name: string; is_customer: boolean }
    expect(tp.id).toBe(c)
    expect(tp.legal_name).toContain('[TEST-FIXTURE]')
    expect(tp.is_customer).toBe(true)
    expect(r.period_start).toBe(PERIOD_START)
    expect(r.period_end).toBe(PERIOD_END)
  })

  it('une facture emise dans la periode figure au DEBIT', async () => {
    const c = await createCustomer(orgA, `facture-${Date.now()}`)
    await issuedInvoice(c, 1000, INSIDE)

    const r = await statement(c)
    const lines = r.lines as { movement_type: string; debit: number; credit: number }[]
    expect(lines).toHaveLength(1)
    expect(lines[0].movement_type).toBe('INVOICE')
    expect(Number(lines[0].debit)).toBe(1000)
    expect(Number(lines[0].credit)).toBe(0)
    expect(Number(r.total_debit)).toBe(1000)
    expect(Number(r.closing_balance)).toBe(1000)
  })

  it('un encaissement figure au CREDIT et reduit le solde', async () => {
    const c = await createCustomer(orgA, `paiement-${Date.now()}`)
    const inv = await issuedInvoice(c, 1000, INSIDE)
    await pay(inv, 400, INSIDE)

    const r = await statement(c)
    const lines = r.lines as { movement_type: string; debit: number; credit: number }[]
    expect(lines).toHaveLength(2)
    const payment = lines.find((l) => l.movement_type === 'PAYMENT')!
    expect(Number(payment.credit)).toBe(400)
    expect(Number(r.total_debit)).toBe(1000)
    expect(Number(r.total_credit)).toBe(400)
    expect(Number(r.closing_balance), 'solde = 1000 - 400').toBe(600)
  })

  it('un avoir figure au CREDIT', async () => {
    const c = await createCustomer(orgA, `avoir-${Date.now()}`)
    const inv = await issuedInvoice(c, 1000, INSIDE)

    const admin = adminClient()
    const { data: credit } = await admin.from('invoices').insert({
      organization_id: orgA, third_party_id: c, document_type: 'CREDIT_NOTE',
      credited_invoice_id: inv, credit_reason: 'Retour', document_date: INSIDE,
      due_date: '2027-12-31', created_by: preparerId,
    }).select('id').single()
    registry.track('invoices', credit!.id as string)
    const { data: cl } = await admin.from('invoice_lines').insert({
      organization_id: orgA, invoice_id: credit!.id, line_number: 1,
      description: tag('Avoir'), quantity: 1, unit_price: 250, revenue_account_id: revenueA,
    }).select('id').single()
    registry.track('invoice_lines', cl!.id as string)
    const { data: issued } = await comptable.rpc('issue_invoice_document', { p_document_id: credit!.id })
    expect((issued as { success: boolean }).success).toBe(true)

    const r = await statement(c)
    const lines = r.lines as { movement_type: string; credit: number }[]
    const avoir = lines.find((l) => l.movement_type === 'CREDIT_NOTE')!
    expect(Number(avoir.credit)).toBe(250)
    expect(Number(r.closing_balance), '1000 - 250').toBe(750)
  })

  it('SOLDE D\'OUVERTURE : les mouvements anterieurs a la periode sont exclus des lignes mais inclus dans l\'ouverture', async () => {
    const c = await createCustomer(orgA, `ouverture-${Date.now()}`)
    // Anterieur a la periode.
    const before = await issuedInvoice(c, 800, BEFORE)
    await pay(before, 300, BEFORE)
    // Dans la periode.
    await issuedInvoice(c, 200, INSIDE)

    const r = await statement(c)
    expect(Number(r.opening_balance), '800 - 300 avant la periode').toBe(500)

    const lines = r.lines as { movement_date: string }[]
    expect(lines, 'seuls les mouvements de la periode sont listes').toHaveLength(1)
    expect(lines[0].movement_date).toBe(INSIDE)

    expect(Number(r.total_debit)).toBe(200)
    expect(Number(r.closing_balance), '500 + 200').toBe(700)
  })

  it('coherence : solde de cloture = ouverture + debit - credit', async () => {
    const c = await createCustomer(orgA, `coherence-${Date.now()}`)
    const before = await issuedInvoice(c, 1500, BEFORE)
    await pay(before, 500, BEFORE)
    const inv = await issuedInvoice(c, 900, INSIDE)
    await pay(inv, 400, INSIDE)

    const r = await statement(c)
    const expected = Number(r.opening_balance) + Number(r.total_debit) - Number(r.total_credit)
    expect(Number(r.closing_balance)).toBe(expected)
  })

  it('un encaissement ANNULE est exclu du releve', async () => {
    const c = await createCustomer(orgA, `annule-${Date.now()}`)
    const inv = await issuedInvoice(c, 600, INSIDE)
    const paymentId = await pay(inv, 600, INSIDE)

    const before = await statement(c)
    expect(Number(before.closing_balance)).toBe(0)

    const { data } = await comptable.rpc('cancel_customer_payment', {
      p_payment_id: paymentId, p_reason: 'Cheque sans provision',
    })
    expect((data as { success: boolean }).success, JSON.stringify(data)).toBe(true)

    const after = await statement(c)
    expect(Number(after.total_credit), 'le paiement annule ne compte plus').toBe(0)
    expect(Number(after.closing_balance), 'la creance redevient due').toBe(600)
  })

  it('un BROUILLON n\'apparait jamais au releve', async () => {
    const c = await createCustomer(orgA, `brouillon-${Date.now()}`)
    const admin = adminClient()
    const { data: doc } = await admin.from('invoices').insert({
      organization_id: orgA, third_party_id: c, document_date: INSIDE,
      due_date: '2027-12-31', created_by: preparerId,
    }).select('id').single()
    registry.track('invoices', doc!.id as string)
    const { data: line } = await admin.from('invoice_lines').insert({
      organization_id: orgA, invoice_id: doc!.id, line_number: 1,
      description: tag('Brouillon'), quantity: 1, unit_price: 999, revenue_account_id: revenueA,
    }).select('id').single()
    registry.track('invoice_lines', line!.id as string)

    const r = await statement(c)
    expect(r.lines, 'un document non emis est invisible').toEqual([])
    expect(Number(r.closing_balance)).toBe(0)
  })

  it('periode invalide refusee', async () => {
    const c = await createCustomer(orgA, `periode-${Date.now()}`)
    const { data } = await comptable.rpc('generate_customer_statement_report', {
      p_org_id: orgA, p_third_party_id: c,
      p_period_start: '2026-12-31', p_period_end: '2026-01-01',
    })
    expect((data as { success: boolean }).success).toBe(false)
    expect((data as { error: string }).error).toBe('invalid_period')
  })

  // ================================================================
  describe('Securite : RLS, IDOR, multi-organisation', () => {
    it('anon ne peut pas executer la RPC', async () => {
      const c = await createCustomer(orgA, `anon-${Date.now()}`)
      const { createClient } = await import('@supabase/supabase-js')
      const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
      const { error } = await anon.rpc('generate_customer_statement_report', {
        p_org_id: orgA, p_third_party_id: c, p_period_start: PERIOD_START, p_period_end: PERIOD_END,
      })
      expect(error).toBeTruthy()
      expect(error!.code).toBe('42501')
    })

    it('EMPLOYE (sans accounting.view ni invoice.manage) est refuse', async () => {
      const c = await createCustomer(orgA, `employe-${Date.now()}`)
      const { client } = await signInAs('employe.demo@medfinder.test')
      const r = await statement(c, orgA, client)
      expect(r.success).toBe(false)
      expect(r.error).toBe('not_authorized')
    })

    it('IDOR : un acteur d\'Org B ne peut pas lire le releve d\'un client d\'Org A', async () => {
      const c = await createCustomer(orgA, `idor-${Date.now()}`)
      await issuedInvoice(c, 5000, INSIDE)

      const { client } = await signInAs('orgb.demo@medfinder.test')
      const r = await statement(c, orgA, client)
      expect(r.success).toBe(false)
      expect(r.error).toBe('not_authorized')
      expect(JSON.stringify(r), 'aucune donnee ne doit fuiter').not.toContain('5000')
    })

    it('IDOR croise : un tiers d\'Org B interroge sous p_org_id = Org A est traite comme inexistant', async () => {
      const customerB = await createCustomer(orgB, `croise-${Date.now()}`)
      const { data } = await comptable.rpc('generate_customer_statement_report', {
        p_org_id: orgA, p_third_party_id: customerB,
        p_period_start: PERIOD_START, p_period_end: PERIOD_END,
      })
      const r = data as Record<string, unknown>
      expect(r.success).toBe(false)
      expect(r.error, 'jamais reveler l\'existence du tiers').toBe('third_party_not_found')
    })
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
