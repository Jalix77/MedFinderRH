import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { signInAs, adminClient, getOrgIdByName } from './helpers'
import { FixtureRegistry, tag } from '../support/fixture-registry'

/**
 * Phase 2B — Etats financiers. Verifie que les 6 etats (journal general,
 * grand livre, balance generale, compte de resultat, bilan, flux de
 * tresorerie) se reconcilient exactement entre eux — exigence explicite de
 * Jean Alix Pierre, testee automatiquement, jamais visuellement
 * (docs/phase-2b-plan.md §12). Toutes les ecritures sont creees en
 * 'draft' via le client admin (source_type='expense', jamais 'manual' —
 * memes raisons que accounting-core.test.ts) puis comptabilisees via la
 * RPC post_journal_entry (chemin automatique inchange, §3 du rapport de
 * cloture 2A).
 */
describe('Phase 2B — Reconciliation des etats financiers', () => {
  let orgA: string
  let orgB: string
  const registry = new FixtureRegistry()
  // Une seule session COMPTABLE reutilisee pour toute la construction de
  // fixtures et les lectures — trouvaille reelle (hook timeout a 60s) :
  // se reconnecter (signInAs) a chaque ecriture postee, en serie sur une
  // dizaine d'ecritures dans un meme beforeAll, depasse largement la
  // marge disponible sous charge reseau reelle. Seuls les tests qui
  // exercent DELIBEREMENT une autre identite (EMPLOYE/SUPPORT/Org B)
  // continuent d'appeler signInAs() eux-memes.
  let comptableClient: Awaited<ReturnType<typeof signInAs>>['client']

  // Trouvaille reelle (rejeux successifs pendant le developpement de ce
  // fichier) : une ecriture COMPTABILISEE ne peut jamais etre supprimee,
  // meme via service_role (immutabilite deja garantie depuis 1C.1). Des
  // annees calendaires FIXES ('2029'/'2030'/'2031') faisaient que CHAQUE
  // rejeu de ce fichier laissait des ecritures reelles et permanentes sur
  // les MEMES dates — et les RPC d'etats financiers, correctement cumulatifs/
  // scopees par organisation (pas par execution de test), ramassaient a
  // chaque nouveau rejeu la totalite des ecritures de TOUS les rejeux
  // precedents sur ces memes dates, faussant les totaux de facon croissante
  // (1x, puis 2x, puis 3x observes). Correction : une plage d'annees
  // dediee et unique par rejeu (jamais reutilisee), aussi indispensable a
  // l'hermeticite des tests que l'unicite des identifiants de comptes.
  const testRunYearBase = 2200 + (Date.now() % 4000)

  beforeAll(async () => {
    orgA = await getOrgIdByName('MedFinder Demo — Organisation A')
    orgB = await getOrgIdByName('MedFinder Demo — Organisation B')
    ;({ client: comptableClient } = await signInAs('comptable.demo@medfinder.test'))
  })

  afterAll(async () => {
    await registry.cleanup(adminClient())
  })

  async function createAccount(orgId: string, label: string, type: string, cashFlowCategory: string | null = null) {
    const admin = adminClient()
    const { data, error } = await admin
      .from('chart_of_accounts')
      .insert({ organization_id: orgId, code: `FS-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}`, label: tag(label), type, cash_flow_category: cashFlowCategory })
      .select('id, code')
      .single()
    if (error) throw error
    registry.track('chart_of_accounts', data!.id as string)
    return data as { id: string; code: string }
  }

  async function postTwoLineEntry(
    orgId: string,
    journalCode: string,
    entryDate: string,
    debitAccountId: string,
    creditAccountId: string,
    amount: number,
    costCenterId: string | null = null
  ) {
    const admin = adminClient()
    const { data: journal } = await admin.from('journals').select('id').eq('organization_id', orgId).eq('code', journalCode).single()
    // find_period_for_date (app_private) n'est pas expose au client — on
    // retrouve/insere la periode couvrant entryDate via periodForDate(),
    // meme approche que les fixtures locales de accounting-core.test.ts.
    const { data: entry, error: entryError } = await admin
      .from('journal_entries')
      .insert({
        organization_id: orgId,
        journal_id: journal!.id,
        period_id: await periodForDate(orgId, entryDate),
        entry_number: `FS-JE-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
        entry_date: entryDate,
        source_type: 'expense',
        status: 'draft',
        description: tag(`Ecriture reconciliation ${amount}`),
      })
      .select('id')
      .single()
    if (entryError) throw entryError
    registry.track('journal_entries', entry!.id as string)

    const { data: lines, error: lineError } = await admin
      .from('journal_entry_lines')
      .insert([
        { organization_id: orgId, entry_id: entry!.id, account_id: debitAccountId, debit: amount, credit: 0, cost_center_id: costCenterId },
        { organization_id: orgId, entry_id: entry!.id, account_id: creditAccountId, debit: 0, credit: amount },
      ])
      .select('id')
    if (lineError) throw lineError
    registry.trackMany('journal_entry_lines', (lines ?? []).map((l) => l.id as string))

    const { data: postData, error: postError } = await comptableClient.rpc('post_journal_entry', { p_entry_id: entry!.id })
    if (postError) throw postError
    if (!(postData as { success: boolean })?.success) throw new Error('post failed: ' + JSON.stringify(postData))
    return entry!.id as string
  }

  const periodCache = new Map<string, string>()
  async function periodForDate(orgId: string, dateStr: string) {
    const key = `${orgId}:${dateStr.slice(0, 7)}`
    if (periodCache.has(key)) return periodCache.get(key)!
    const admin = adminClient()
    const [year, month] = dateStr.split('-')
    const label = tag(`FY-${year}-${orgId.slice(0, 4)}`)
    let { data: fy } = await admin.from('fiscal_years').select('id').eq('organization_id', orgId).eq('label', label).maybeSingle()
    if (!fy) {
      const { data: created, error } = await admin
        .from('fiscal_years')
        .insert({ organization_id: orgId, label, start_date: `${year}-01-01`, end_date: `${year}-12-31` })
        .select('id')
        .single()
      if (error) throw error
      registry.track('fiscal_years', created!.id as string)
      fy = created
    }
    let { data: period } = await admin
      .from('accounting_periods')
      .select('id')
      .eq('organization_id', orgId)
      .eq('fiscal_year_id', fy!.id)
      .eq('month', Number(month))
      .maybeSingle()
    if (!period) {
      const { data: created, error } = await admin
        .from('accounting_periods')
        .insert({ organization_id: orgId, fiscal_year_id: fy!.id, month: Number(month) })
        .select('id')
        .single()
      if (error) throw error
      registry.track('accounting_periods', created!.id as string)
      period = created
    }
    periodCache.set(key, period!.id as string)
    return period!.id as string
  }

  async function getFiscalYearId(orgId: string, year: string) {
    const admin = adminClient()
    const { data } = await admin
      .from('fiscal_years')
      .select('id')
      .eq('organization_id', orgId)
      .eq('label', tag(`FY-${year}-${orgId.slice(0, 4)}`))
      .maybeSingle()
    return data!.id as string
  }

  describe('Fixture principale : 5 types de comptes + tresorerie classifiee', () => {
    let assetAcc: { id: string; code: string }
    let liabilityAcc: { id: string; code: string }
    let equityAcc: { id: string; code: string }
    let revenueAcc: { id: string; code: string }
    let expenseAcc: { id: string; code: string }
    let treasuryGlId: string
    let cashAccountId: string
    let bankGlId: string
    let unclassifiedAcc: { id: string; code: string }
    let costCenterId: string
    const year = String(testRunYearBase)
    const label = `main${Date.now()}`

    beforeAll(async () => {
      const admin = adminClient()
      assetAcc = await createAccount(orgA, `${label}-actif`, 'asset', 'investing')
      liabilityAcc = await createAccount(orgA, `${label}-passif`, 'liability', 'financing')
      equityAcc = await createAccount(orgA, `${label}-capital`, 'equity')
      revenueAcc = await createAccount(orgA, `${label}-revenu`, 'revenue', 'operating')
      expenseAcc = await createAccount(orgA, `${label}-charge`, 'expense', 'operating')
      unclassifiedAcc = await createAccount(orgA, `${label}-nonclassifie`, 'expense', null)

      const treasury = await createAccount(orgA, `${label}-tresorerie-caisse`, 'asset')
      treasuryGlId = treasury.id
      const { data: cash } = await admin
        .from('cash_accounts')
        .insert({ organization_id: orgA, name: tag(`Caisse recon ${label}`), gl_account_id: treasuryGlId })
        .select('id')
        .single()
      cashAccountId = cash!.id as string
      registry.track('cash_accounts', cashAccountId)

      const bankTreasury = await createAccount(orgA, `${label}-tresorerie-banque`, 'asset')
      bankGlId = bankTreasury.id
      const { data: bank } = await admin
        .from('bank_accounts')
        .insert({ organization_id: orgA, bank_name: tag(`Banque recon ${label}`), gl_account_id: bankGlId })
        .select('id')
        .single()
      registry.track('bank_accounts', bank!.id as string)

      const { data: cc } = await admin
        .from('cost_centers')
        .insert({ organization_id: orgA, code: `FS-CC-${Date.now()}`, name: tag('Centre de cout recon') })
        .select('id')
        .single()
      costCenterId = cc!.id as string
      registry.track('cost_centers', costCenterId)

      // --- Ecriture AVANT la periode (solde d'ouverture non nul, §3/§12) --
      await postTwoLineEntry(orgA, 'MISC', `${Number(year) - 1}-06-15`, treasuryGlId, revenueAcc.id, 500)

      // --- Ecritures DANS la periode de test (juillet ${year}) -----------
      // Vente au comptant : tresorerie (actif) <- revenu (operating)
      await postTwoLineEntry(orgA, 'MISC', `${year}-07-05`, treasuryGlId, revenueAcc.id, 1000, costCenterId)
      // Charge payee en tresorerie (operating)
      await postTwoLineEntry(orgA, 'MISC', `${year}-07-10`, expenseAcc.id, treasuryGlId, 300)
      // Achat immobilisation paye en tresorerie (investing)
      await postTwoLineEntry(orgA, 'MISC', `${year}-07-12`, assetAcc.id, treasuryGlId, 200)
      // Emprunt decaisse en tresorerie (financing)
      await postTwoLineEntry(orgA, 'MISC', `${year}-07-15`, treasuryGlId, liabilityAcc.id, 400)
      // Charge non classifiee payee en tresorerie (contrepartie sans cash_flow_category)
      await postTwoLineEntry(orgA, 'MISC', `${year}-07-18`, unclassifiedAcc.id, treasuryGlId, 50)
      // Virement interne caisse -> banque (ne doit apparaitre dans aucune categorie)
      await postTwoLineEntry(orgA, 'BANK', `${year}-07-20`, bankGlId, treasuryGlId, 150)
      // Ecriture sans mouvement de tresorerie (accrual pur, charge/dette)
      await postTwoLineEntry(orgA, 'MISC', `${year}-07-22`, expenseAcc.id, liabilityAcc.id, 75)

      // --- Ecriture APRES la periode (exclue du resultat de la periode) --
      await postTwoLineEntry(orgA, 'MISC', `${year}-08-05`, treasuryGlId, revenueAcc.id, 9999)

      // equityAcc reste a solde nul dans cette fixture (aucune ecriture ne
      // le touche ici) — cree uniquement pour couvrir les 5 types de
      // comptes dans le perimetre ; testee specifiquement dans le describe
      // "Exercice precedent" ci-dessous, ou son solde n'est plus nul.
      void equityAcc
    }, 60000)

    it('journal general : total debit = total credit sur un perimetre par ecriture complete', async () => {
      const client = comptableClient
      const { data, error } = await client.rpc('generate_general_journal_report', {
        p_org_id: orgA, p_period_start: `${year}-07-01`, p_period_end: `${year}-07-31`,
      })
      expect(error).toBeNull()
      const report = data as { success: boolean; total_debit: number; total_credit: number; is_balanced_scope: boolean }
      expect(report.success).toBe(true)
      expect(report.is_balanced_scope).toBe(true)
      expect(Number(report.total_debit)).toBe(Number(report.total_credit))
    })

    it('grand livre : solde d\'ouverture provient des ecritures anterieures a la periode (pas recalcule depuis les seuls mouvements)', async () => {
      const client = comptableClient
      const { data, error } = await client.rpc('generate_general_ledger_report', {
        p_org_id: orgA, p_period_start: `${year}-07-01`, p_period_end: `${year}-07-31`, p_account_id: treasuryGlId,
      })
      expect(error).toBeNull()
      const report = data as { success: boolean; accounts: { opening_balance: number }[] }
      expect(report.success).toBe(true)
      // 500 poste en juin (annee precedente) sur ce compte de tresorerie.
      expect(Number(report.accounts[0].opening_balance)).toBe(500)
    })

    it('grand livre <-> balance generale : solde de cloture identique compte par compte', async () => {
      const client = comptableClient
      const [ledgerRes, balanceRes] = await Promise.all([
        client.rpc('generate_general_ledger_report', { p_org_id: orgA, p_period_start: `${year}-07-01`, p_period_end: `${year}-07-31`, p_account_id: treasuryGlId }),
        client.rpc('generate_trial_balance_report', { p_org_id: orgA, p_period_start: `${year}-07-01`, p_period_end: `${year}-07-31` }),
      ])
      expect(ledgerRes.error).toBeNull()
      expect(balanceRes.error).toBeNull()
      const ledger = ledgerRes.data as { accounts: { closing_balance: number }[] }
      const balance = balanceRes.data as { accounts: { account_id: string; closing_balance_brut: number }[] }
      const balanceRow = balance.accounts.find((a) => a.account_id === treasuryGlId)
      expect(balanceRow).toBeTruthy()
      expect(Number(balanceRow!.closing_balance_brut)).toBe(Number(ledger.accounts[0].closing_balance))
    })

    it('balance generale : Sigma mouvements debit = Sigma mouvements credit, et Sigma soldes bruts de cloture = 0', async () => {
      const client = comptableClient
      const { data, error } = await client.rpc('generate_trial_balance_report', {
        p_org_id: orgA, p_period_start: `${year}-07-01`, p_period_end: `${year}-07-31`,
      })
      expect(error).toBeNull()
      const report = data as { success: boolean; total_period_debit: number; total_period_credit: number; sum_closing_balance_brut: number }
      expect(report.success).toBe(true)
      expect(Number(report.total_period_debit)).toBe(Number(report.total_period_credit))
      // Peut differer legerement de 0 si d'autres tests tournent en parallele
      // dans la meme organisation partagee — tolerance stricte a 0 attendue
      // ici car ce fichier ne s'execute pas en parallele avec d'autres
      // suites touchant les MEMES comptes (comptes crees avec un label
      // unique par ce fichier).
      expect(Number(report.sum_closing_balance_brut)).toBeCloseTo(0, 6)
    })

    it('compte de resultat : resultat net = balance generale (revenus - charges), borne a la periode demandee', async () => {
      const client = comptableClient
      const [incomeRes, balanceRes] = await Promise.all([
        client.rpc('generate_income_statement_report', { p_org_id: orgA, p_period_start: `${year}-07-01`, p_period_end: `${year}-07-31` }),
        client.rpc('generate_trial_balance_report', { p_org_id: orgA, p_period_start: `${year}-07-01`, p_period_end: `${year}-07-31` }),
      ])
      expect(incomeRes.error).toBeNull()
      const income = incomeRes.data as { success: boolean; total_revenue: number; total_expense: number; net_result: number }
      const balance = balanceRes.data as { accounts: { account_id: string; period_debit: number; period_credit: number }[] }
      expect(income.success).toBe(true)

      // Reconciliation sur les MOUVEMENTS DE LA PERIODE de la balance
      // generale (period_credit/period_debit), pas sur son solde de
      // cloture cumule : ce dernier inclut le solde d'ouverture (activite
      // anterieure non cloturee), alors que le compte de resultat reste
      // strictement borne a la periode demandee — les deux notions sont
      // legitimement differentes, seuls les mouvements de periode se
      // reconcilient terme a terme. income.total_revenue/total_expense
      // sont des totaux ORG-LARGE (tous les comptes revenue/expense avec
      // mouvement) — sommer la balance generale sur le MEME perimetre
      // (tous les comptes de ce type), pas un seul compte : cette fixture
      // porte deux comptes 'expense' (expenseAcc ET unclassifiedAcc).
      const revenueMovement = balance.accounts
        .filter((a) => a.account_id === revenueAcc.id)
        .reduce((s, a) => s + Number(a.period_credit) - Number(a.period_debit), 0)
      const expenseMovement = balance.accounts
        .filter((a) => a.account_id === expenseAcc.id || a.account_id === unclassifiedAcc.id)
        .reduce((s, a) => s + Number(a.period_debit) - Number(a.period_credit), 0)
      expect(Number(income.total_revenue)).toBeCloseTo(revenueMovement, 6)
      expect(Number(income.total_expense)).toBeCloseTo(expenseMovement, 6)
      expect(Number(income.net_result)).toBe(Number(income.total_revenue) - Number(income.total_expense))

      // Ecriture de 9999 posee en aout : ne doit PAS apparaitre ici (borne a juillet).
      // Revenu attendu sur juillet uniquement : 1000 (vente comptant).
      expect(Number(income.total_revenue)).toBe(1000)
      // Charges attendues sur juillet : 300 (payee) + 50 (non classifiee) + 75 (accrual) = 425
      expect(Number(income.total_expense)).toBe(425)
    })

    it('bilan (as_of_date) : Actif = Passif + Capitaux Propres + Resultat non affecte', async () => {
      const fiscalYearId = await getFiscalYearId(orgA, year)
      const client = comptableClient
      const { data, error } = await client.rpc('generate_balance_sheet_report', {
        p_org_id: orgA, p_fiscal_year_id: fiscalYearId, p_as_of_date: `${year}-07-31`,
      })
      expect(error).toBeNull()
      const report = data as { success: boolean; total_assets: number; total_liabilities_and_equity: number; unaffected_result: number }
      expect(report.success).toBe(true)
      expect(Number(report.total_assets)).toBeCloseTo(Number(report.total_liabilities_and_equity), 6)
      // Doit inclure toutes les ecritures postees jusqu'a la date, y compris
      // celle de juin de l'annee precedente (solde d'ouverture) et celles de
      // juillet — mais PAS celle d'aout (posterieure a as_of_date).
      expect(Number(report.unaffected_result)).not.toBe(0)
    })

    it('bilan : inclut les ecritures anterieures a la periode demandee (pas seulement "la periode courante")', async () => {
      const fiscalYearId = await getFiscalYearId(orgA, year)
      const client = comptableClient
      const { data, error } = await client.rpc('generate_balance_sheet_report', {
        p_org_id: orgA, p_fiscal_year_id: fiscalYearId, p_as_of_date: `${year}-07-06`, // juste apres la vente du 07-05
      })
      expect(error).toBeNull()
      const report = data as { success: boolean; assets: { account_id: string; balance: number }[] }
      const treasuryAsset = report.assets.find((a) => a.account_id === treasuryGlId)
      // 500 (juin annee -1) + 1000 (vente 07-05) = 1500, meme si la periode
      // "demandee" ne couvre explicitement que jusqu'au 07-06.
      expect(Number(treasuryAsset!.balance)).toBe(1500)
    })

    // generate_balance_sheet_report a une signature differente des 5 autres
    // RPC (p_fiscal_year_id/p_as_of_date au lieu de p_period_start/
    // p_period_end) — non couverte par la boucle RPCS du describe
    // "Securite RPC" ci-dessous ; verifiee separement ici, dans le meme
    // describe que sa fixture (fiscalYearId deja resolu ci-dessus).
    it('bilan : isolation multi-organisation et permission accounting.view (anon/EMPLOYE/SUPPORT/Org B refuses, COMPTABLE autorise)', async () => {
      const fiscalYearId = await getFiscalYearId(orgA, year)
      const args = { p_org_id: orgA, p_fiscal_year_id: fiscalYearId, p_as_of_date: `${year}-07-31` }

      const { createClient } = await import('@supabase/supabase-js')
      const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
      const { error: anonError } = await anon.rpc('generate_balance_sheet_report', args)
      expect(anonError).toBeTruthy()
      expect(anonError!.code).toBe('42501')

      const { client: employeClient } = await signInAs('employe.demo@medfinder.test')
      const { data: employeData, error: employeError } = await employeClient.rpc('generate_balance_sheet_report', args)
      expect(employeError).toBeNull()
      expect((employeData as { success: boolean; error: string }).success).toBe(false)
      expect((employeData as { success: boolean; error: string }).error).toBe('not_authorized')

      const { client: supportClient } = await signInAs('support.demo@medfinder.test')
      const { data: supportData, error: supportError } = await supportClient.rpc('generate_balance_sheet_report', args)
      expect(supportError).toBeNull()
      expect((supportData as { success: boolean; error: string }).success).toBe(false)
      expect((supportData as { success: boolean; error: string }).error).toBe('not_authorized')

      const { client: orgbClient } = await signInAs('orgb.demo@medfinder.test')
      const { data: orgbData, error: orgbError } = await orgbClient.rpc('generate_balance_sheet_report', args)
      expect(orgbError).toBeNull()
      expect((orgbData as { success: boolean; error: string }).success).toBe(false)
      expect((orgbData as { success: boolean; error: string }).error).toBe('not_authorized')

      const { data: comptableData, error: comptableError } = await comptableClient.rpc('generate_balance_sheet_report', args)
      expect(comptableError).toBeNull()
      expect((comptableData as { success: boolean }).success).toBe(true)
    })

    it('flux de tresorerie : classification operating/investing/financing/UNCLASSIFIED/virement interne', async () => {
      const client = comptableClient
      const { data, error } = await client.rpc('generate_cash_flow_report', {
        p_org_id: orgA, p_period_start: `${year}-07-01`, p_period_end: `${year}-07-31`,
      })
      expect(error).toBeNull()
      const report = data as {
        success: boolean; method: string
        operating: number; investing: number; financing: number; unclassified: number; internal_transfers: number
        opening_balance: number; closing_balance: number
      }
      expect(report.success).toBe(true)
      expect(report.method).toBe('direct')
      // operating : +1000 (vente) - 300 (charge payee) = 700
      expect(Number(report.operating)).toBe(700)
      // investing : -200 (achat immobilisation)
      expect(Number(report.investing)).toBe(-200)
      // financing : +400 (emprunt decaisse)
      expect(Number(report.financing)).toBe(400)
      // unclassified : -50 (charge non classifiee)
      expect(Number(report.unclassified)).toBe(-50)
      // virement interne caisse->banque : 150 sortant de caisse + 150 entrant
      // en banque = 0 net sur l'ensemble des comptes de tresorerie consolides.
      expect(Number(report.internal_transfers)).toBeCloseTo(0, 6)
    })

    it('flux de tresorerie : Tresorerie d\'ouverture + flux nets = Tresorerie de cloture, identique au grand livre consolide', async () => {
      const client = comptableClient
      const { data: cashFlowData, error: cashFlowError } = await client.rpc('generate_cash_flow_report', {
        p_org_id: orgA, p_period_start: `${year}-07-01`, p_period_end: `${year}-07-31`,
      })
      expect(cashFlowError).toBeNull()
      const cashFlow = cashFlowData as { opening_balance: number; closing_balance: number; net_change: number; internal_transfers: number }

      // Reconciliation independante : l'organisation de demonstration
      // partagee porte d'AUTRES comptes de tresorerie crees par d'autres
      // suites de tests — recalculer via l'ENSEMBLE reel des comptes de
      // tresorerie de l'organisation (meme requete que la RPC elle-meme),
      // pas seulement les 2 comptes de cette fixture, pour rester valide
      // dans un environnement partage.
      const admin = adminClient()
      const [{ data: cashRows }, { data: bankRows }, { data: mmRows }] = await Promise.all([
        admin.from('cash_accounts').select('gl_account_id').eq('organization_id', orgA),
        admin.from('bank_accounts').select('gl_account_id').eq('organization_id', orgA),
        admin.from('mobile_money_accounts').select('gl_account_id').eq('organization_id', orgA),
      ])
      const treasuryIds = Array.from(new Set([...(cashRows ?? []), ...(bankRows ?? []), ...(mmRows ?? [])].map((r) => r.gl_account_id as string)))

      async function independentBalanceAsOf(asOfDate: string) {
        const { data: lines } = await admin
          .from('journal_entry_lines')
          .select('debit, credit, journal_entries!inner(status, entry_date, organization_id)')
          .in('account_id', treasuryIds)
          .eq('journal_entries.status', 'posted')
          .eq('journal_entries.organization_id', orgA)
          .lt('journal_entries.entry_date', asOfDate)
        return (lines ?? []).reduce((sum, l) => sum + Number(l.debit) - Number(l.credit), 0)
      }

      const independentOpening = await independentBalanceAsOf(`${year}-07-01`)
      const independentClosing = await independentBalanceAsOf(`${year}-08-01`)

      expect(Number(cashFlow.opening_balance)).toBeCloseTo(independentOpening, 6)
      expect(Number(cashFlow.closing_balance)).toBeCloseTo(independentClosing, 6)
      expect(Number(cashFlow.opening_balance) + Number(cashFlow.net_change) + Number(cashFlow.internal_transfers)).toBeCloseTo(Number(cashFlow.closing_balance), 6)
    })

    it('contre-passation : incluse naturellement, aucun invariant casse', async () => {
      const admin = adminClient()
      const client = comptableClient
      const entryId = await postTwoLineEntry(orgA, 'MISC', `${year}-07-25`, expenseAcc.id, treasuryGlId, 60)
      const { data: reverseData, error: reverseError } = await client.rpc('reverse_journal_entry', { p_entry_id: entryId, p_reason: 'Test reconciliation 2B' })
      expect(reverseError).toBeNull()
      const reversalId = (reverseData as { reversal_entry_id: string }).reversal_entry_id
      registry.track('journal_entries', reversalId)
      await registry.trackDerivedFrom(admin, 'journal_entry_lines', 'entry_id', [reversalId])

      const { data, error } = await client.rpc('generate_trial_balance_report', {
        p_org_id: orgA, p_period_start: `${year}-07-01`, p_period_end: `${year}-07-31`,
      })
      expect(error).toBeNull()
      const report = data as { total_period_debit: number; total_period_credit: number }
      expect(Number(report.total_period_debit)).toBe(Number(report.total_period_credit))
    })
  })

  describe('Exercice precedent deja affecte — pas de double comptage', () => {
    // "Resultat non affecte" est cumule depuis l'origine du grand livre
    // (migration 20260823090002, corrigee suite a l'echec de ce test
    // meme — voir docs/phase-2b-closing-report.md). Sur l'organisation de
    // demonstration partagee, ce cumul inclut donc aussi tout l'historique
    // des autres suites de tests : on ne peut pas affirmer une valeur
    // absolue attendue. On verifie a la place que l'ecriture d'affectation
    // deplace EXACTEMENT le bon montant, ni plus ni moins (preuve directe
    // de l'absence de double comptage, quelle que soit la donnee
    // historique environnante) — et que Actif=Passif+CP+Resultat continue
    // de tenir avant et apres, sans reglage manuel.
    it('une ecriture d\'affectation deplace le resultat non affecte vers les capitaux propres sans double comptage', async () => {
      const admin = adminClient()
      // Plage d'annees distincte de celle de "Fixture principale"
      // ci-dessus (meme si chacune est deja unique par rejeu) — evite
      // tout chevauchement de date, defense en profondeur.
      const priorYear = String(testRunYearBase + 500)
      const currentYear = String(testRunYearBase + 501)
      const revAcc = await createAccount(orgA, `prior-rev-${Date.now()}`, 'revenue', 'operating')
      const expAcc = await createAccount(orgA, `prior-exp-${Date.now()}`, 'expense', 'operating')
      const equityAcc = await createAccount(orgA, `prior-cap-${Date.now()}`, 'equity')
      const treasuryAcc = await createAccount(orgA, `prior-tres-${Date.now()}`, 'asset')
      const { data: cash } = await admin
        .from('cash_accounts')
        .insert({ organization_id: orgA, name: tag(`Caisse prior ${Date.now()}`), gl_account_id: treasuryAcc.id })
        .select('id')
        .single()
      registry.track('cash_accounts', cash!.id as string)

      // Exercice PRECEDENT : produits 1000, charges 400 -> resultat 600 non affecte.
      await postTwoLineEntry(orgA, 'MISC', `${priorYear}-03-01`, treasuryAcc.id, revAcc.id, 1000)
      await postTwoLineEntry(orgA, 'MISC', `${priorYear}-03-02`, expAcc.id, treasuryAcc.id, 400)

      // L'exercice COURANT n'existe pas encore a ce stade (aucune ecriture
      // n'y a ete postee) — periodForDate() le cree paresseusement, meme
      // mecanisme que postTwoLineEntry, mais il faut l'appeler explicitement
      // ici puisque le premier appel a le toucher est le snapshot "before"
      // (generate_balance_sheet_report), pas une ecriture.
      await periodForDate(orgA, `${currentYear}-01-01`)
      const currentFiscalYearId = await getFiscalYearId(orgA, currentYear)
      const client = comptableClient

      const { data: beforeData } = await client.rpc('generate_balance_sheet_report', {
        p_org_id: orgA, p_fiscal_year_id: currentFiscalYearId, p_as_of_date: `${currentYear}-01-01`,
      })
      const before = beforeData as { unaffected_result: number; total_assets: number; total_liabilities_and_equity: number }
      expect(Number(before.total_assets)).toBeCloseTo(Number(before.total_liabilities_and_equity), 6)

      // "Affectation" manuelle du resultat precedent aux capitaux propres,
      // par une ecriture reelle (cas reel : le comptable solde le resultat
      // precedent vers le capital) — debite le compte de revenu concerne,
      // credite les capitaux propres, exactement 600.
      await postTwoLineEntry(orgA, 'MISC', `${currentYear}-01-02`, revAcc.id, equityAcc.id, 600)

      const { data: afterData } = await client.rpc('generate_balance_sheet_report', {
        p_org_id: orgA, p_fiscal_year_id: currentFiscalYearId, p_as_of_date: `${currentYear}-01-31`,
      })
      const after = afterData as {
        unaffected_result: number; total_assets: number; total_liabilities_and_equity: number
        equity: { account_id: string; balance: number }[]
      }

      // Le compte de capitaux propres porte desormais le montant affecte...
      const equityRow = after.equity.find((e) => e.account_id === equityAcc.id)
      expect(Number(equityRow!.balance)).toBe(600)
      // ...et le resultat non affecte (cumule) a baisse d'EXACTEMENT 600 —
      // ni plus (double comptage), ni moins (montant perdu) — quelle que
      // soit sa valeur absolue avant l'ecriture.
      expect(Number(before.unaffected_result) - Number(after.unaffected_result)).toBeCloseTo(600, 6)
      // L'ecriture d'affectation ne touche aucun compte de tresorerie :
      // total_assets reste inchange entre les deux appels.
      expect(Number(after.total_assets)).toBeCloseTo(Number(before.total_assets), 6)
      // Le point central : Actif = Passif + CP + Resultat continue de tenir
      // malgre l'affectation, sans reglage manuel.
      expect(Number(after.total_assets)).toBeCloseTo(Number(after.total_liabilities_and_equity), 6)
    }, 60000)
  })

  describe('Securite RPC — accounting.view requis, isolation multi-organisation', () => {
    const RPCS: { name: string; args: Record<string, unknown> }[] = [
      { name: 'generate_general_journal_report', args: { p_period_start: '2031-01-01', p_period_end: '2031-01-31' } },
      { name: 'generate_general_ledger_report', args: { p_period_start: '2031-01-01', p_period_end: '2031-01-31' } },
      { name: 'generate_trial_balance_report', args: { p_period_start: '2031-01-01', p_period_end: '2031-01-31' } },
      { name: 'generate_income_statement_report', args: { p_period_start: '2031-01-01', p_period_end: '2031-01-31' } },
      { name: 'generate_cash_flow_report', args: { p_period_start: '2031-01-01', p_period_end: '2031-01-31' } },
    ]

    it('anon ne peut executer aucune des 5 RPC (permission denied, jamais une execution)', async () => {
      const { createClient } = await import('@supabase/supabase-js')
      const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
      for (const rpc of RPCS) {
        const { error } = await anon.rpc(rpc.name, { p_org_id: orgA, ...rpc.args })
        expect(error).toBeTruthy()
        expect(error!.code).toBe('42501')
      }
    })

    it('EMPLOYE (sans accounting.view) refuse sur les 5 RPC', async () => {
      const { client } = await signInAs('employe.demo@medfinder.test')
      for (const rpc of RPCS) {
        const { data, error } = await client.rpc(rpc.name, { p_org_id: orgA, ...rpc.args })
        expect(error).toBeNull()
        expect((data as { success: boolean; error: string }).success).toBe(false)
        expect((data as { success: boolean; error: string }).error).toBe('not_authorized')
      }
    })

    it('SUPPORT (sans accounting.view) refuse sur les 5 RPC', async () => {
      const { client } = await signInAs('support.demo@medfinder.test')
      for (const rpc of RPCS) {
        const { data, error } = await client.rpc(rpc.name, { p_org_id: orgA, ...rpc.args })
        expect(error).toBeNull()
        expect((data as { success: boolean; error: string }).success).toBe(false)
        expect((data as { success: boolean; error: string }).error).toBe('not_authorized')
      }
    })

    it('un acteur d\'Org B ne peut generer aucun des 5 etats pour Org A', async () => {
      const { client } = await signInAs('orgb.demo@medfinder.test')
      for (const rpc of RPCS) {
        const { data, error } = await client.rpc(rpc.name, { p_org_id: orgA, ...rpc.args })
        expect(error).toBeNull()
        expect((data as { success: boolean; error: string }).success).toBe(false)
        expect((data as { success: boolean; error: string }).error).toBe('not_authorized')
      }
      void orgB
    })

    it('COMPTABLE (accounting.view) autorise — controle positif', async () => {
      const client = comptableClient
      for (const rpc of RPCS) {
        const { data, error } = await client.rpc(rpc.name, { p_org_id: orgA, ...rpc.args })
        expect(error).toBeNull()
        expect((data as { success: boolean }).success).toBe(true)
      }
    })
  })
})
