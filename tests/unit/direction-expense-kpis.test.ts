import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { countExpensesWithoutReceipt } from '@/lib/expenses/missing-receipts'
import {
  BUSINESS_TIME_ZONE,
  businessDate,
  businessMonthToDate,
} from '@/lib/date/business-month'

const ROOT = path.resolve(__dirname, '../..')
const DIRECTION = fs.readFileSync(path.join(ROOT, 'app/(app)/direction/page.tsx'), 'utf8')

/**
 * Garde-fou statique : les charges du mois viennent du grand livre.
 *
 * Le comportement comptable lui-meme est couvert cote base (RPC deja
 * testee) ; ce qui manquait ici, c'est la preuve que le dashboard
 * l'interroge au lieu de recalculer sa propre somme depuis les
 * expense_requests — exactement le defaut corrige.
 */
describe('/direction — charges du mois', () => {
  it("s'appuie sur generate_income_statement_report", () => {
    expect(DIRECTION).toMatch(/generate_income_statement_report/)
    expect(DIRECTION).toMatch(/total_expense/)
  })

  it('reste borne au mois courant et a la permission comptable', () => {
    expect(DIRECTION).toMatch(/p_period_start/)
    expect(DIRECTION).toMatch(/p_period_end/)
    expect(DIRECTION).toMatch(/canViewAccounting/)
  })

  it('derive ses bornes du fuseau metier, pas de celui du processus', () => {
    expect(DIRECTION).toMatch(/businessMonthToDate/)
    // getFullYear/getMonth lisent l'heure locale du serveur : sur Vercel
    // (UTC) le mois basculerait 4 h avant Haiti.
    expect(DIRECTION).not.toMatch(/getFullYear|getMonth\(\)/)
  })
})

/**
 * Fuseau metier : America/Port-au-Prince, declare, jamais implicite.
 */
describe('businessMonthToDate', () => {
  it('declare explicitement le fuseau haitien', () => {
    expect(BUSINESS_TIME_ZONE).toBe('America/Port-au-Prince')
  })

  it('FRONTIERE : 2026-09-05T01:00:00Z est encore le 4 septembre en Haiti', () => {
    const instant = new Date('2026-09-05T01:00:00Z')
    expect(businessDate(instant)).toBe('2026-09-04')
    expect(businessMonthToDate(instant)).toEqual({
      start: '2026-09-01',
      end: '2026-09-04',
    })
  })

  it('ne bascule de mois qu\'a minuit heure d\'Haiti, pas a minuit UTC', () => {
    // 01:00Z le 1er octobre = 21:00 le 30 septembre a Port-au-Prince :
    // les charges de septembre doivent encore etre celles affichees.
    expect(businessMonthToDate(new Date('2026-10-01T01:00:00Z'))).toEqual({
      start: '2026-09-01',
      end: '2026-09-30',
    })
    // 05:00Z le 1er octobre = 01:00 le 1er octobre en Haiti : la bascule
    // a eu lieu.
    expect(businessMonthToDate(new Date('2026-10-01T05:00:00Z'))).toEqual({
      start: '2026-10-01',
      end: '2026-10-01',
    })
  })

  it('formate toujours en YYYY-MM-DD, mois et jour sur deux chiffres', () => {
    expect(businessDate(new Date('2026-01-05T18:00:00Z'))).toBe('2026-01-05')
    expect(businessMonthToDate(new Date('2026-01-05T18:00:00Z')).start).toBe('2026-01-01')
  })

  it("n'additionne aucun montant depuis expense_requests", () => {
    // Double comptage : une depense payee est deja une ecriture au grand
    // livre. Aucune somme parallele ne doit subsister.
    expect(DIRECTION).not.toMatch(/reduce\([^)]*\.amount/)
    expect(DIRECTION).not.toMatch(/expensesThisMonth/)
  })

  it('ne contourne pas la RPC par le service_role', () => {
    expect(DIRECTION).not.toMatch(/service_role|SERVICE_ROLE|createAdminClient/)
  })
})

/**
 * Justificatifs manquants : meme seuil que justify_expense_request, qui
 * refuse avec `no_attachment` tant qu'il n'existe aucune piece et accepte
 * des la premiere.
 */
describe('countExpensesWithoutReceipt', () => {
  it('compte une depense payee sans aucune piece', () => {
    expect(countExpensesWithoutReceipt([{ id: 'e1' }], [])).toBe(1)
    expect(countExpensesWithoutReceipt([{ id: 'e1' }], null)).toBe(1)
  })

  it('ne compte pas une depense payee ayant au moins une piece', () => {
    expect(
      countExpensesWithoutReceipt([{ id: 'e1' }], [{ expense_request_id: 'e1' }])
    ).toBe(0)
  })

  it('une seule piece suffit, meme s\'il y en a plusieurs', () => {
    expect(
      countExpensesWithoutReceipt(
        [{ id: 'e1' }],
        [{ expense_request_id: 'e1' }, { expense_request_id: 'e1' }]
      )
    ).toBe(0)
  })

  it('distingue les depenses justifiees des autres dans un meme lot', () => {
    expect(
      countExpensesWithoutReceipt(
        [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }],
        [{ expense_request_id: 'e2' }]
      )
    ).toBe(2)
  })

  it("ignore une piece rattachee a une depense hors du lot", () => {
    expect(
      countExpensesWithoutReceipt([{ id: 'e1' }], [{ expense_request_id: 'autre' }])
    ).toBe(1)
  })

  it('tolere des entrees vides', () => {
    expect(countExpensesWithoutReceipt(null, null)).toBe(0)
    expect(countExpensesWithoutReceipt([], [{ expense_request_id: 'e1' }])).toBe(0)
  })
})
