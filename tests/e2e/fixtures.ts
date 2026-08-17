import { createClient } from '@supabase/supabase-js'
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
