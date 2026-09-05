/**
 * Depenses payees SANS piece justificative.
 *
 * Le KPI comptait auparavant toutes les depenses `paid`, ce qui affirmait
 * qu'aucune n'etait justifiee alors que plusieurs portaient deja une
 * facture ou un recu. Le workflow existant est explicite sur le seuil :
 * `justify_expense_request` refuse avec `no_attachment` tant qu'il n'y a
 * AUCUNE piece, et l'accepte des la premiere. Le KPI applique donc
 * exactement le meme seuil — au moins une piece suffit.
 *
 * La regle vit ici plutot que dans le JSX pour etre verifiable par un test.
 */

export type PaidExpenseRef = { id: string }
export type ExpenseAttachmentRef = { expense_request_id: string | null }

/**
 * Nombre de depenses payees dont aucune piece n'a ete deposee.
 *
 * `attachments` n'a pas besoin d'etre filtre : seules les pieces rattachees
 * a l'une des depenses fournies sont prises en compte.
 */
export function countExpensesWithoutReceipt(
  paidExpenses: PaidExpenseRef[] | null | undefined,
  attachments: ExpenseAttachmentRef[] | null | undefined
): number {
  const withReceipt = new Set(
    (attachments ?? [])
      .map((a) => a.expense_request_id)
      .filter((id): id is string => id !== null)
  )

  let missing = 0
  for (const expense of paidExpenses ?? []) {
    if (!withReceipt.has(expense.id)) missing += 1
  }
  return missing
}
