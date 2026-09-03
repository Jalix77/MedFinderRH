import { describe, it, expect } from 'vitest'
import {
  operationalBudgetTotals,
  isOperationalBudgetStatus,
} from '@/lib/budget/operational-totals'

/**
 * Regle metier : un budget en brouillon n'est pas du budget disponible.
 *
 * Le cas de reference reproduit exactement le defaut signale en
 * production : un brouillon de 38 162 + 2 500 HTG, deja comptabilise
 * manuellement, s'affichait comme 40 662 HTG encore disponibles.
 */
describe('operationalBudgetTotals', () => {
  it('ne compte ni approuve ni revise comme brouillon', () => {
    expect(isOperationalBudgetStatus('approved')).toBe(true)
    expect(isOperationalBudgetStatus('revised')).toBe(true)
    expect(isOperationalBudgetStatus('draft')).toBe(false)
    expect(isOperationalBudgetStatus(null)).toBe(false)
  })

  it('CAS REEL : un brouillon de 38 162 + 2 500 n\'est jamais annonce comme disponible', () => {
    const totals = operationalBudgetTotals(
      [{ id: 'b-draft', status: 'draft' }],
      [
        { budget_id: 'b-draft', planned_amount: 38162, available_amount: 38162 },
        { budget_id: 'b-draft', planned_amount: 2500, available_amount: 2500 },
      ]
    )
    expect(totals.planned).toBe(0)
    expect(totals.available).toBe(0)
    expect(totals.consumed).toBe(0)
    // Le montant n'est pas efface pour autant : il est expose a part.
    expect(totals.draftPlanned).toBe(40662)
  })

  it('compte les budgets approuves et revises', () => {
    const totals = operationalBudgetTotals(
      [
        { id: 'b1', status: 'approved' },
        { id: 'b2', status: 'revised' },
      ],
      [
        { budget_id: 'b1', planned_amount: 10000, available_amount: 4000 },
        { budget_id: 'b2', planned_amount: 5000, available_amount: 5000 },
      ]
    )
    expect(totals.planned).toBe(15000)
    expect(totals.available).toBe(9000)
    expect(totals.consumed).toBe(6000)
    expect(totals.draftPlanned).toBe(0)
  })

  it('separe brouillon et operationnel dans un meme jeu de donnees', () => {
    const totals = operationalBudgetTotals(
      [
        { id: 'ok', status: 'approved' },
        { id: 'wip', status: 'draft' },
      ],
      [
        { budget_id: 'ok', planned_amount: 1000, available_amount: 250 },
        { budget_id: 'wip', planned_amount: 9999, available_amount: 9999 },
      ]
    )
    expect(totals.planned).toBe(1000)
    expect(totals.available).toBe(250)
    expect(totals.consumed).toBe(750)
    expect(totals.draftPlanned).toBe(9999)
  })

  it('ignore une ligne sans budget rattache plutot que de la compter', () => {
    const totals = operationalBudgetTotals(
      [{ id: 'ok', status: 'approved' }],
      [{ budget_id: null, planned_amount: 500, available_amount: 500 }]
    )
    expect(totals.planned).toBe(0)
    expect(totals.draftPlanned).toBe(500)
  })

  it('accepte les montants numeriques renvoyes en chaine par PostgREST', () => {
    const totals = operationalBudgetTotals(
      [{ id: 'ok', status: 'approved' }],
      [{ budget_id: 'ok', planned_amount: '1200.50', available_amount: '200.25' }]
    )
    expect(totals.planned).toBeCloseTo(1200.5, 2)
    expect(totals.available).toBeCloseTo(200.25, 2)
    expect(totals.consumed).toBeCloseTo(1000.25, 2)
  })

  it('tolere des entrees vides', () => {
    expect(operationalBudgetTotals(null, null)).toEqual({
      planned: 0,
      available: 0,
      consumed: 0,
      draftPlanned: 0,
    })
  })
})
