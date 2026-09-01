import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { FixtureRegistry, tag } from '../support/fixture-registry'

/**
 * Fixtures E2E — cree ses propres donnees plutot que de dependre de
 * l'etat accumule du projet partage (meme principe que
 * tests/integration/helpers.ts, duplique ici car Playwright et Vitest
 * sont deux runners distincts qui ne partagent pas de module).
 *
 * Hermeticite (suite au retour de Jean Alix Pierre — plus de 300 lignes
 * budgetaires accumulees dans le projet cloud partage sur une seule
 * session, jamais nettoyees) : chaque fonction ci-dessous enregistre
 * desormais tout ce qu'elle cree dans un FixtureRegistry partage,
 * retourne dans `cleanup`, et tague chaque libelle avec
 * TEST_FIXTURE_MARKER (voir tests/support/fixture-registry.ts). Chaque
 * spec appelant ces fonctions DOIT appeler `cleanup()` dans un
 * `finally` (voir tests/e2e/*.spec.ts) — fonctionne meme si le test
 * echoue en cours de route, puisque chaque insertion est enregistree
 * immediatement apres avoir reussi, avant toute assertion.
 */
function adminClient() {
  if (typeof globalThis.WebSocket === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    globalThis.WebSocket = require('ws')
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY requis pour les fixtures E2E.')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

const DEMO_PASSWORD = 'DemoPass#2026'
let cachedComptableClient: SupabaseClient | null = null

/** Session COMPTABLE reutilisee (memes raisons que financial-statements-reconciliation.test.ts : eviter un signInWithPassword par ecriture). */
async function comptableClient() {
  if (cachedComptableClient) return cachedComptableClient
  if (typeof globalThis.WebSocket === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    globalThis.WebSocket = require('ws')
  }
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { error } = await client.auth.signInWithPassword({ email: 'comptable.demo@medfinder.test', password: DEMO_PASSWORD })
  if (error) throw new Error(`Echec de connexion comptable.demo: ${error.message}`)
  cachedComptableClient = client
  return client
}

export async function getOrgAId(): Promise<string> {
  const admin = adminClient()
  const { data, error } = await admin
    .from('organizations')
    .select('id')
    .eq('name', 'MedFinder Demo — Organisation A')
    .single()
  if (error || !data) throw new Error(`Organisation introuvable: ${error?.message}`)
  return data.id as string
}

/** Cree un budget approuve avec une ligne, pret a recevoir une demande de depense. */
export async function createApprovedBudgetLine(label: string) {
  const admin = adminClient()
  const registry = new FixtureRegistry()
  const orgId = await getOrgAId()

  const { data: fy } = await admin
    .from('fiscal_years')
    .insert({ organization_id: orgId, label: tag(`E2E-${label}`), start_date: '2030-01-01', end_date: '2030-12-31' })
    .select('id')
    .single()
  registry.track('fiscal_years', fy!.id as string)

  const { data: budget } = await admin
    .from('budgets')
    .insert({ organization_id: orgId, fiscal_year_id: fy!.id, name: tag(`Budget E2E ${label}`), status: 'approved' })
    .select('id')
    .single()
  registry.track('budgets', budget!.id as string)

  const { data: line } = await admin
    .from('budget_lines')
    .insert({ organization_id: orgId, budget_id: budget!.id, category: tag(`Categorie E2E ${label}`), planned_amount: 100000 })
    .select('id, category')
    .single()
  registry.track('budget_lines', line!.id as string)

  return {
    orgId,
    budgetId: budget!.id as string,
    lineId: line!.id as string,
    category: line!.category as string,
    registry,
    admin,
    cleanup: () => registry.cleanup(admin),
  }
}

/** Budget approuve avec DEUX lignes — necessaire pour tester un transfert. */
export async function createBudgetWithTwoLines(label: string) {
  const admin = adminClient()
  const registry = new FixtureRegistry()
  const orgId = await getOrgAId()

  const { data: fy } = await admin
    .from('fiscal_years')
    .insert({ organization_id: orgId, label: tag(`E2E2-${label}`), start_date: '2031-01-01', end_date: '2031-12-31' })
    .select('id')
    .single()
  registry.track('fiscal_years', fy!.id as string)

  const { data: budget } = await admin
    .from('budgets')
    .insert({ organization_id: orgId, fiscal_year_id: fy!.id, name: tag(`Budget E2E transfert ${label}`), status: 'approved' })
    .select('id, name')
    .single()
  registry.track('budgets', budget!.id as string)

  const { data: lineA } = await admin
    .from('budget_lines')
    .insert({ organization_id: orgId, budget_id: budget!.id, category: tag(`Source ${label}`), planned_amount: 50000 })
    .select('id, category')
    .single()
  registry.track('budget_lines', lineA!.id as string)

  const { data: lineB } = await admin
    .from('budget_lines')
    .insert({ organization_id: orgId, budget_id: budget!.id, category: tag(`Cible ${label}`), planned_amount: 10000 })
    .select('id, category')
    .single()
  registry.track('budget_lines', lineB!.id as string)

  return {
    budgetId: budget!.id as string,
    budgetName: budget!.name as string,
    lineA: lineA! as { id: string; category: string },
    lineB: lineB! as { id: string; category: string },
    registry,
    admin,
    cleanup: () => registry.cleanup(admin),
  }
}

/** Financement PAPEJ minimal, sans ligne — sert au test d'etat vide. */
export async function createGrant(label: string) {
  const admin = adminClient()
  const registry = new FixtureRegistry()
  const orgId = await getOrgAId()
  const { data: grant } = await admin
    .from('grants')
    .insert({ organization_id: orgId, name: tag(`PAPEJ E2E ${label}`), donor_name: 'Bailleur E2E', amount_granted: 850000 })
    .select('id, name')
    .single()
  registry.track('grants', grant!.id as string)

  return { grantId: grant!.id as string, grantName: grant!.name as string, registry, admin, cleanup: () => registry.cleanup(admin) }
}

/** Fiche tiers CLIENT, sans document — pour les ecrans de referentiel. */
export async function createCustomerThirdParty(label: string) {
  const admin = adminClient()
  const registry = new FixtureRegistry()
  const orgId = await getOrgAId()

  const { data, error } = await admin
    .from('third_parties')
    .insert({ organization_id: orgId, legal_name: tag(`Client ${label}`), is_customer: true })
    .select('id, third_party_code, legal_name')
    .single()
  if (error) throw error
  registry.track('third_parties', data!.id as string)

  return {
    id: data!.id as string,
    code: data!.third_party_code as string,
    legalName: data!.legal_name as string,
    orgId,
    registry,
    admin,
    cleanup: () => registry.cleanup(admin),
  }
}

/**
 * Facture client EMISE (donc comptabilisee par 2C.3A), pour les ecrans de
 * consultation, le PDF et les controles d'acces.
 *
 * Le createur du brouillon est DIFFERENT de l'emetteur : la separation
 * des fonctions livree en 2C.3A refuserait sinon l'emission — ce n'est
 * pas ce que ces tests d'ecran cherchent a verifier.
 */
export async function createIssuedInvoice(label: string, total: number) {
  const admin = adminClient()
  const orgId = await getOrgAId()
  const customer = await createCustomerThirdParty(label)
  const registry = customer.registry

  const preparer = (await admin.from('users').select('id').eq('full_name', 'Demo Manager').single()).data!.id
  const revenue = (
    await admin
      .from('chart_of_accounts')
      .select('id')
      .eq('organization_id', orgId)
      .eq('type', 'revenue')
      .eq('is_active', true)
      .limit(1)
      .single()
  ).data!.id

  const today = new Date().toISOString().slice(0, 10)
  const { data: doc, error: docError } = await admin
    .from('invoices')
    .insert({
      organization_id: orgId,
      third_party_id: customer.id,
      document_date: today,
      due_date: '2027-12-31',
      created_by: preparer,
    })
    .select('id')
    .single()
  if (docError) throw docError
  registry.track('invoices', doc!.id as string)

  const { data: line, error: lineError } = await admin
    .from('invoice_lines')
    .insert({
      organization_id: orgId,
      invoice_id: doc!.id,
      line_number: 1,
      description: tag(`Prestation ${label}`),
      quantity: 1,
      unit_price: total,
      revenue_account_id: revenue,
    })
    .select('id')
    .single()
  if (lineError) throw lineError
  registry.track('invoice_lines', line!.id as string)

  const client = await comptableClient()
  const { data: issued, error: issueError } = await client.rpc('issue_invoice_document', {
    p_document_id: doc!.id,
  })
  if (issueError) throw issueError
  const result = issued as { success: boolean; document_number?: string; error?: string }
  if (!result?.success) throw new Error(`Emission impossible: ${JSON.stringify(issued)}`)

  return {
    invoiceId: doc!.id as string,
    documentNumber: result.document_number as string,
    customerId: customer.id,
    customerName: customer.legalName,
    orgId,
    registry,
    admin,
    cleanup: () => registry.cleanup(admin),
  }
}

/**
 * Deux comptes + une ecriture comptable a 2 lignes, COMPTABILISEE (posted),
 * pour exercer les etats financiers Phase 2B (tests/e2e/financial-statements.spec.ts).
 * Comptabilisee via la RPC post_journal_entry (chemin automatique
 * source_type='expense', identique au patron etabli par
 * tests/integration/financial-statements-reconciliation.test.ts) — jamais
 * insere directement en 'posted' (le trigger d'immutabilite le refuserait
 * de toute facon en dehors de ce chemin).
 *
 * Contrairement a la fixture d'integration, la date reelle du jour suffit
 * ici (pas de plage d'annees dediee) : chaque test de ce fichier verifie
 * seulement que le montant/libelle EXACT de CETTE fixture apparait dans le
 * rapport (assertion "contains", jamais une egalite de total cumule) —
 * insensible a toute accumulation d'ecritures d'autres rejeux sur le meme
 * mois.
 */
export async function createPostedJournalEntry(label: string, amount: number) {
  const admin = adminClient()
  const registry = new FixtureRegistry()
  const orgId = await getOrgAId()
  const client = await comptableClient()

  const { data: debitAcc } = await admin
    .from('chart_of_accounts')
    .insert({ organization_id: orgId, code: `E2E-D-${Date.now()}`, label: tag(`Compte debit E2E ${label}`), type: 'asset' })
    .select('id, code, label')
    .single()
  registry.track('chart_of_accounts', debitAcc!.id as string)

  const { data: creditAcc } = await admin
    .from('chart_of_accounts')
    .insert({ organization_id: orgId, code: `E2E-C-${Date.now()}`, label: tag(`Compte credit E2E ${label}`), type: 'revenue' })
    .select('id, code, label')
    .single()
  registry.track('chart_of_accounts', creditAcc!.id as string)

  const { data: journal } = await admin.from('journals').select('id').eq('organization_id', orgId).eq('code', 'MISC').single()

  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const monthStr = String(month).padStart(2, '0')
  const entryDate = `${year}-${monthStr}-15`

  const fyLabel = tag(`FY-E2E-${year}-${orgId.slice(0, 4)}`)
  let { data: fy } = await admin.from('fiscal_years').select('id').eq('organization_id', orgId).eq('label', fyLabel).maybeSingle()
  if (!fy) {
    const { data: created, error } = await admin
      .from('fiscal_years')
      .insert({ organization_id: orgId, label: fyLabel, start_date: `${year}-01-01`, end_date: `${year}-12-31` })
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
    .eq('month', month)
    .maybeSingle()
  if (!period) {
    const { data: created, error } = await admin
      .from('accounting_periods')
      .insert({ organization_id: orgId, fiscal_year_id: fy!.id, month })
      .select('id')
      .single()
    if (error) throw error
    registry.track('accounting_periods', created!.id as string)
    period = created
  }

  const { data: entry, error: entryError } = await admin
    .from('journal_entries')
    .insert({
      organization_id: orgId,
      journal_id: journal!.id,
      period_id: period!.id,
      entry_number: `E2E-JE-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
      entry_date: entryDate,
      source_type: 'expense',
      status: 'draft',
      description: tag(`Ecriture E2E ${label}`),
    })
    .select('id')
    .single()
  if (entryError) throw entryError
  registry.track('journal_entries', entry!.id as string)

  const { data: lines, error: lineError } = await admin
    .from('journal_entry_lines')
    .insert([
      { organization_id: orgId, entry_id: entry!.id, account_id: debitAcc!.id, debit: amount, credit: 0 },
      { organization_id: orgId, entry_id: entry!.id, account_id: creditAcc!.id, debit: 0, credit: amount },
    ])
    .select('id')
  if (lineError) throw lineError
  registry.trackMany('journal_entry_lines', (lines ?? []).map((l) => l.id as string))

  const { data: postData, error: postError } = await client.rpc('post_journal_entry', { p_entry_id: entry!.id })
  if (postError) throw postError
  if (!(postData as { success: boolean })?.success) throw new Error('post failed: ' + JSON.stringify(postData))

  return {
    orgId,
    debitAccount: debitAcc as { id: string; code: string; label: string },
    creditAccount: creditAcc as { id: string; code: string; label: string },
    entryId: entry!.id as string,
    fiscalYearId: fy!.id as string,
    entryDate,
    periodStart: `${year}-${monthStr}-01`,
    periodEnd: `${year}-${monthStr}-28`,
    registry,
    admin,
    cleanup: () => registry.cleanup(admin),
  }
}

/**
 * Phase 2D — compte de tresorerie dedie portant UN mouvement, pret a etre
 * rapproche contre un releve importe depuis l'UI.
 *
 * Compte dedie a chaque test : le rapprochement automatique n'emet une
 * proposition que s'il existe EXACTEMENT UN mouvement candidat. Un compte
 * partage rendrait ce determinisme dependant de l'etat accumule du projet.
 */
export async function createTreasuryAccountWithMovement(
  label: string,
  opts: { amount: number; date: string }
) {
  const admin = adminClient()
  const registry = new FixtureRegistry()
  const orgId = await getOrgAId()

  const { data: gl, error: glErr } = await admin
    .from('chart_of_accounts')
    .insert({
      organization_id: orgId,
      code: `E2E-RAP-${Date.now()}`,
      label: tag(`Caisse ${label}`),
      type: 'asset',
    })
    .select('id')
    .single()
  if (glErr) throw glErr
  registry.track('chart_of_accounts', gl!.id as string)

  const accountName = tag(`Caisse ${label}`)
  const { data: acc, error: accErr } = await admin
    .from('cash_accounts')
    .insert({ organization_id: orgId, name: accountName, currency: 'HTG', gl_account_id: gl!.id })
    .select('id')
    .single()
  if (accErr) throw accErr
  registry.track('cash_accounts', acc!.id as string)

  const { data: mv, error: mvErr } = await admin
    .from('cash_movements')
    .insert({
      organization_id: orgId,
      treasury_account_type: 'cash',
      treasury_account_id: acc!.id,
      direction: 'in',
      amount: opts.amount,
      currency: 'HTG',
      movement_date: opts.date,
      reference_type: 'manual',
      description: tag(`Mouvement ${label}`),
    })
    .select('id')
    .single()
  if (mvErr) throw mvErr
  registry.track('cash_movements', mv!.id as string)

  return {
    orgId,
    accountId: acc!.id as string,
    accountName,
    movementId: mv!.id as string,
    cleanup: () => registry.cleanup(admin),
  }
}

/**
 * Nettoyage d'un import cree PAR L'UI pendant un test (donc jamais suivi
 * par un FixtureRegistry). L'ordre est impose par les FK :
 * bank_reconciliation_matches est `on delete restrict` vers les lignes ET
 * vers les mouvements, donc les rapprochements partent en premier ; les
 * lignes partent ensuite en cascade avec l'import.
 *
 * Un rapprochement VALIDE resiste volontairement a la suppression
 * (app_private.bank_matches_immutable_once_validated) : le nettoyage est
 * best-effort et ne doit jamais faire echouer le test lui-meme.
 */
export async function cleanupBankStatementImport(importId: string) {
  const admin = adminClient()
  const { data: lines } = await admin
    .from('bank_statement_lines')
    .select('id')
    .eq('import_id', importId)
  const lineIds = ((lines ?? []) as { id: string }[]).map((l) => l.id)
  if (lineIds.length > 0) {
    await admin.from('bank_reconciliation_matches').delete().in('statement_line_id', lineIds)
  }
  await admin.from('bank_statement_imports').delete().eq('id', importId)
}
