// MedFinder Gestion — nettoyage UNIQUE et retroactif des fixtures de test
// accumulees dans le projet cloud partage AVANT l'adoption du mecanisme de
// marquage (tests/support/fixture-registry.ts, TEST_FIXTURE_MARKER). Ces
// lignes n'ont pas ete taguees a leur creation (elles precedent le
// mecanisme) — identifiees ici EXCLUSIVEMENT par correspondance EXACTE
// avec les prefixes litteraux utilises par le code de test AVANT retrofit
// (verifies un par un contre l'historique git de chaque fichier, jamais
// devines). AUCUNE suppression par anciennete, AUCUNE heuristique large
// ("contient E2E" par exemple) : chaque motif ci-dessous correspond a une
// ligne de code precise, citee en commentaire.
//
// Scope strict : organization_id IN (Org A demo, Org B demo) UNIQUEMENT —
// jamais une purge globale. N'importe quelle ligne ne correspondant a
// AUCUN motif exact reste intouchee.
import { createClient } from '@supabase/supabase-js'
import WS from 'ws'
if (typeof globalThis.WebSocket === 'undefined') globalThis.WebSocket = WS

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const DRY_RUN = process.argv.includes('--dry-run')

async function orgIds() {
  const { data } = await admin
    .from('organizations')
    .select('id, name')
    .in('name', ['MedFinder Demo — Organisation A', 'MedFinder Demo — Organisation B'])
  if (!data || data.length !== 2) throw new Error('Organisations de demo introuvables — arret par securite.')
  return data.map((o) => o.id)
}

// { table, column, prefixes: [motif exact -> fichier:ligne d'origine] }
// Prefixes verifies un par un dans les fichiers de test AVANT le retrofit
// de tagging (git show HEAD~1 sur chaque fichier concerne).
const PATTERNS = [
  {
    table: 'fiscal_years',
    column: 'label',
    prefixes: [
      'E2E-', // tests/e2e/fixtures.ts createApprovedBudgetLine
      'E2E2-', // tests/e2e/fixtures.ts createBudgetWithTwoLines
      'E2E-empty-', // tests/e2e/errors-empty-states.spec.ts
      'RLS-', // accounting-core.test.ts + papej.test.ts (RLS tests)
      'RLS-BUD-', // budget.test.ts
      'BUD-', // budget.test.ts approvedBudgetLine
      'DRAFT-', // budget.test.ts (budget draft test)
      'verif090010-', // expense-creator-visibility.test.ts approvedBudgetLine
      'verifdraft090010-', // expense-creator-visibility.test.ts draftBudgetLine
      'EXP-', // expenses.test.ts setupExpenseFixtures
      'PAPEJ-', // papej.test.ts setupGrantFixtures
    ],
  },
  {
    table: 'budgets',
    column: 'name',
    prefixes: [
      'Budget E2E ', // tests/e2e/fixtures.ts (inclut "Budget E2E transfert ")
      'Budget E2E vide ', // errors-empty-states.spec.ts
      'Budget ', // budget.test.ts + expenses.test.ts (approvedBudgetLine/setupExpenseFixtures)
      'RLS ', // budget.test.ts RLS test
      'Non approuve', // budget.test.ts draft-budget test (litteral exact)
      'Budget verif ', // expense-creator-visibility.test.ts
      'Budget brouillon verif ', // expense-creator-visibility.test.ts
    ],
  },
  {
    table: 'budget_lines',
    column: 'category',
    prefixes: [
      'Categorie E2E ', // tests/e2e/fixtures.ts
      'Source ', // tests/e2e/fixtures.ts createBudgetWithTwoLines (lineA)
      'Cible ', // tests/e2e/fixtures.ts createBudgetWithTwoLines (lineB)
      'Categorie ', // budget.test.ts + expenses.test.ts (categoryId nom expense_categories, distinct table)
      'Cat ', // expenses.test.ts setupExpenseFixtures budget_lines.category
      'Categorie verif ', // expense-creator-visibility.test.ts
      'Categorie brouillon verif ', // expense-creator-visibility.test.ts
    ],
  },
  {
    table: 'expense_categories',
    column: 'name',
    prefixes: [
      'Categorie ', // expenses.test.ts setupExpenseFixtures
    ],
  },
  {
    table: 'cash_accounts',
    column: 'name',
    prefixes: [
      'Caisse ', // expenses.test.ts setupExpenseFixtures (inclut "Caisse PAPEJ ")
    ],
  },
  {
    // Doit etre nettoyee APRES expense_categories/cash_accounts (qui la
    // referencent) — placee en dernier dans PATTERNS pour cette raison ;
    // la boucle generique de fin de script suit l'ordre du tableau.
    table: 'chart_of_accounts',
    column: 'label',
    prefixes: [
      'Compte debit test', // accounting-core.test.ts (litteral exact)
      'Compte credit test', // accounting-core.test.ts (litteral exact)
      'Charge test', // expenses.test.ts (litteral exact)
      'Caisse GL test', // expenses.test.ts (litteral exact)
      'Produit PAPEJ test', // papej.test.ts (litteral exact)
      'Caisse PAPEJ test', // papej.test.ts (litteral exact)
      'Produit', // papej.test.ts RLS test (litteral exact, court — verifie code=REV-RLS- en complement ci-dessous)
    ],
  },
  {
    table: 'grants',
    column: 'name',
    prefixes: [
      'PAPEJ E2E ', // tests/e2e/fixtures.ts createGrant
      'PAPEJ ', // papej.test.ts setupGrantFixtures
      'RLS-', // papej.test.ts RLS test
    ],
  },
  {
    table: 'expense_requests',
    column: 'payee_name',
    prefixes: [
      'Fournisseur Test', // expenses.test.ts (litteral exact)
      'Fournisseur verif', // expense-creator-visibility.test.ts (litteral exact, inclut "Fournisseur verif" et "Fournisseur autre createur"? non — distinct, voir ligne suivante)
      'Fournisseur autre createur', // expense-creator-visibility.test.ts (litteral exact)
      'Fournisseur PAPEJ', // papej.test.ts (litteral exact)
      'Fournisseur PDF ', // tests/e2e/papej-pdf-export.spec.ts
      'Fournisseur E2E', // tests/e2e/expense-workflow.spec.ts (inclut "Fournisseur E2E double")
    ],
  },
]

async function run() {
  const orgs = await orgIds()
  console.log(`Organisations cible (demo uniquement) : ${orgs.join(', ')}`)
  console.log(DRY_RUN ? '=== DRY RUN (aucune suppression) ===' : '=== SUPPRESSION REELLE ===')

  // 1) Identifier tous les budget_lines legacy (necessaire pour purger
  //    budget_commitments/budget_transfers/grant_budget_lines/
  //    expense_requests AVANT budgets/budget_lines eux-memes — restrict FK).
  const legacyBudgetLineIds = new Set()
  const legacyBudgetIds = new Set()
  const legacyGrantIds = new Set()
  const legacyExpenseRequestIds = new Set()

  for (const { table, column, prefixes } of PATTERNS) {
    for (const prefix of prefixes) {
      const { data, error } = await admin
        .from(table)
        .select('id')
        .in('organization_id', orgs)
        .like(column, `${prefix}%`)
      if (error) {
        console.error(`Erreur lecture ${table}.${column} like '${prefix}%':`, error.message)
        continue
      }
      const rows = data ?? []
      console.log(`${table}.${column} LIKE '${prefix}%' -> ${rows.length} ligne(s)`)
      if (table === 'budget_lines') for (const r of rows) legacyBudgetLineIds.add(r.id)
      if (table === 'budgets') for (const r of rows) legacyBudgetIds.add(r.id)
      if (table === 'grants') for (const r of rows) legacyGrantIds.add(r.id)
    }
  }

  // Lignes budgetaires appartenant a un budget legacy meme si leur propre
  // categorie ne correspond a aucun motif (ex. categorie non prefixee) —
  // toujours scope strict : uniquement les budgets DEJA identifies avec
  // certitude ci-dessus par leur propre nom.
  if (legacyBudgetIds.size > 0) {
    const { data } = await admin.from('budget_lines').select('id').in('budget_id', [...legacyBudgetIds])
    for (const r of data ?? []) legacyBudgetLineIds.add(r.id)
  }

  // expense_requests rattachees a une ligne budgetaire legacy.
  if (legacyBudgetLineIds.size > 0) {
    const { data } = await admin.from('expense_requests').select('id').in('budget_line_id', [...legacyBudgetLineIds])
    for (const r of data ?? []) legacyExpenseRequestIds.add(r.id)
  }
  // + celles deja identifiees par payee_name (peuvent referencer une ligne
  // non-legacy dans de rares cas — capture les deux ensembles).
  for (const { table, column, prefixes } of PATTERNS) {
    if (table !== 'expense_requests') continue
    for (const prefix of prefixes) {
      const { data } = await admin.from('expense_requests').select('id').in('organization_id', orgs).like(column, `${prefix}%`)
      for (const r of data ?? []) legacyExpenseRequestIds.add(r.id)
    }
  }

  console.log(`\nRecapitulatif avant suppression :`)
  console.log(`  budgets legacy : ${legacyBudgetIds.size}`)
  console.log(`  budget_lines legacy : ${legacyBudgetLineIds.size}`)
  console.log(`  grants legacy : ${legacyGrantIds.size}`)
  console.log(`  expense_requests legacy : ${legacyExpenseRequestIds.size}`)

  if (DRY_RUN) {
    console.log('\nDry run termine — relancer sans --dry-run pour supprimer reellement.')
    return
  }

  let deleted = { total: 0 }
  async function del(table, column, ids) {
    if (ids.length === 0) return
    // par lots de 100 pour rester sous les limites de l'API
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100)
      const { error, count } = await admin.from(table).delete({ count: 'exact' }).in(column, batch)
      if (error) {
        console.error(`  echec suppression ${table} (${batch.length} lignes) :`, error.message)
      } else {
        deleted.total += count ?? 0
        console.log(`  ${table} : ${count ?? batch.length} ligne(s) supprimee(s)`)
      }
    }
  }

  // Ordre FK-safe : enfants d'abord.
  console.log('\n--- Suppression (ordre inverse des dependances) ---')
  await del('expense_attachments', 'expense_request_id', [...legacyExpenseRequestIds])
  await del('expenses', 'expense_request_id', [...legacyExpenseRequestIds]) // restrict — doit precéder expense_requests
  await del('expense_approvals', 'expense_id', [...legacyExpenseRequestIds]) // cascade normalement, explicite par securite
  await del('budget_commitments', 'budget_line_id', [...legacyBudgetLineIds])
  await del('budget_commitments', 'reference_id', [...legacyExpenseRequestIds])
  await del('budget_transfers', 'from_line_id', [...legacyBudgetLineIds])
  await del('budget_transfers', 'to_line_id', [...legacyBudgetLineIds])
  await del('grant_budget_lines', 'budget_line_id', [...legacyBudgetLineIds])
  await del('grant_budget_lines', 'grant_id', [...legacyGrantIds])
  await del('grant_reports', 'grant_id', [...legacyGrantIds])
  await del('expense_requests', 'id', [...legacyExpenseRequestIds])
  await del('budget_lines', 'id', [...legacyBudgetLineIds])
  await del('budgets', 'id', [...legacyBudgetIds])
  await del('grants', 'id', [...legacyGrantIds])

  // Tables sans lien FK descendant restant a ce stade — colonnes texte
  // exactes, deja filtrees par organisation.
  for (const { table, column, prefixes } of PATTERNS) {
    if (['budget_lines', 'budgets', 'grants', 'expense_requests'].includes(table)) continue
    for (const prefix of prefixes) {
      const { error, count } = await admin
        .from(table)
        .delete({ count: 'exact' })
        .in('organization_id', orgs)
        .like(column, `${prefix}%`)
      if (error) {
        console.error(`  echec suppression ${table} like '${prefix}%' :`, error.message)
      } else if (count) {
        deleted.total += count
        console.log(`  ${table} (${prefix}%) : ${count} ligne(s) supprimee(s)`)
      }
    }
  }

  console.log(`\nTotal supprime : ${deleted.total} lignes.`)
}

run().catch((err) => {
  console.error('Erreur fatale :', err)
  process.exit(1)
})
