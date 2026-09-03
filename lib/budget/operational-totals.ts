/**
 * Totaux budgetaires OPERATIONNELS.
 *
 * Un budget 'draft' est un document de travail : ses lignes n'ont pas ete
 * arbitrees et aucune depense ne peut s'y engager. Les additionner aux
 * totaux revenait a annoncer une capacite de depense inexistante — cas
 * reel observe en production : un brouillon de 38 162 + 2 500 HTG, deja
 * comptabilise manuellement par ailleurs, s'affichait comme 40 662 HTG
 * encore disponibles.
 *
 * La regle vit ici plutot que dans le JSX de la page pour etre verifiable
 * par un test, et pour qu'il n'existe qu'un seul endroit ou elle puisse
 * changer.
 */

/** Seuls ces statuts rendent un budget opposable aux depenses. */
export const OPERATIONAL_BUDGET_STATUSES = ['approved', 'revised'] as const

export function isOperationalBudgetStatus(status: string | null | undefined): boolean {
  return status === 'approved' || status === 'revised'
}

export type BudgetRef = { id: string; status: string | null }

export type BudgetLineBalance = {
  budget_id: string | null
  planned_amount: number | string | null
  available_amount: number | string | null
}

export type OperationalTotals = {
  planned: number
  available: number
  consumed: number
  /** Montant des brouillons, expose separement — jamais melange, jamais cache. */
  draftPlanned: number
}

export function operationalBudgetTotals(
  budgets: BudgetRef[] | null | undefined,
  balances: BudgetLineBalance[] | null | undefined
): OperationalTotals {
  const operationalIds = new Set(
    (budgets ?? []).filter((b) => isOperationalBudgetStatus(b.status)).map((b) => b.id)
  )

  // `budget_id` est nullable dans les types generes (colonne d'une vue) :
  // une ligne sans budget rattache ne peut pas etre operationnelle.
  const isOperational = (budgetId: string | null) =>
    budgetId !== null && operationalIds.has(budgetId)

  let planned = 0
  let available = 0
  let draftPlanned = 0

  for (const row of balances ?? []) {
    const rowPlanned = Number(row.planned_amount ?? 0)
    if (isOperational(row.budget_id)) {
      planned += rowPlanned
      available += Number(row.available_amount ?? 0)
    } else {
      draftPlanned += rowPlanned
    }
  }

  return { planned, available, consumed: planned - available, draftPlanned }
}
