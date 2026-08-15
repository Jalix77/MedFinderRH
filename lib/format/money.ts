/**
 * Formatage monetaire — utilise partout ou un montant HTG/USD est affiche
 * (§ regles UX "affichage des montants HTG/USD" de Phase 1C-UI). Intl gere
 * HTG correctement dans les runtimes Node/navigateur modernes ; le
 * fallback couvre les environnements plus anciens sans faire planter le
 * rendu d'une page financiere pour une simple absence de support locale.
 */
export function formatMoney(amount: number | string | null | undefined, currency: string = 'HTG'): string {
  const value = typeof amount === 'string' ? Number(amount) : (amount ?? 0)
  if (!Number.isFinite(value)) return '—'

  try {
    return new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
  }
}

/** Formate un nombre "brut" (sans devise) — utilise pour des compteurs (ex. "3 justificatifs manquants"). */
export function formatNumber(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : (value ?? 0)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('fr-FR')
}
