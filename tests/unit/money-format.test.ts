import { describe, it, expect } from 'vitest'
import { formatMoney, formatNumber } from '@/lib/format/money'

// Intl.NumberFormat insere des espaces insecables (U+202F/U+00A0) — on
// calcule la valeur attendue via le meme mecanisme plutot que de recopier
// des espaces litteraux ambigus a la main.
function expectedMoney(amount: number, currency: string) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

describe('formatMoney (§ regles UX Phase 1C-UI : affichage HTG/USD)', () => {
  it('formate un montant HTG avec le code devise explicite', () => {
    expect(formatMoney(1500, 'HTG')).toBe(expectedMoney(1500, 'HTG'))
    expect(formatMoney(1500, 'HTG')).toContain('HTG')
  })

  it('formate un montant USD avec le code devise explicite', () => {
    expect(formatMoney(250.5, 'USD')).toBe(expectedMoney(250.5, 'USD'))
    expect(formatMoney(250.5, 'USD')).toContain('USD')
  })

  it('applique HTG par defaut si aucune devise fournie', () => {
    expect(formatMoney(100)).toBe(expectedMoney(100, 'HTG'))
  })

  it('accepte une chaine numerique (valeur brute Postgres numeric)', () => {
    expect(formatMoney('1234.5', 'HTG')).toBe(expectedMoney(1234.5, 'HTG'))
  })

  it('gere les valeurs nulles/indefinies sans lever d\'exception (etat vide honnete)', () => {
    expect(formatMoney(null)).toBe(expectedMoney(0, 'HTG'))
    expect(formatMoney(undefined)).toBe(expectedMoney(0, 'HTG'))
  })

  it('retourne un tiret pour une valeur non numerique plutot qu\'un plantage', () => {
    expect(formatMoney('abc', 'HTG')).toBe('—')
  })
})

describe('formatNumber', () => {
  it('formate un entier avec separateur de milliers fr-FR', () => {
    expect(formatNumber(12000)).toBe((12000).toLocaleString('fr-FR'))
  })

  it('gere les valeurs nulles', () => {
    expect(formatNumber(null)).toBe((0).toLocaleString('fr-FR'))
  })
})
