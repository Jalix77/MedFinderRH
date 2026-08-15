const EXPENSE_STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  submitted: 'Soumise',
  approved: 'Approuvee',
  rejected: 'Rejetee',
  committed: 'Engagee',
  paid: 'Payee — justificatif attendu',
  justified: 'Justifiee',
  posted: 'Comptabilisee',
  cancelled: 'Annulee',
}

const EXPENSE_STATUS_TONE: Record<string, Tone> = {
  draft: 'neutral',
  submitted: 'warning',
  approved: 'info',
  rejected: 'danger',
  committed: 'info',
  paid: 'warning',
  justified: 'success',
  posted: 'success',
  cancelled: 'danger',
}

const GENERIC_STATUS_LABELS: Record<string, string> = {
  active: 'Actif',
  inactive: 'Inactif',
  open: 'Ouvert',
  closed: 'Ferme',
  draft: 'Brouillon',
  approved: 'Approuve',
  revised: 'Revise',
}

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-600',
  success: 'bg-mf-emerald-50 text-mf-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  danger: 'bg-red-50 text-mf-danger',
  info: 'bg-mf-navy-900/5 text-mf-navy-700',
}

/**
 * Badge de statut reutilisable — libelles metier (§ regles UX), pas les
 * codes techniques bruts. `domain="expense"` utilise le vocabulaire du
 * workflow depense ; sinon repli sur un mapping generique (actif/ferme/...).
 */
export function StatusBadge({ status, domain }: { status: string; domain?: 'expense' }) {
  const label =
    (domain === 'expense' ? EXPENSE_STATUS_LABELS[status] : undefined) ?? GENERIC_STATUS_LABELS[status] ?? status
  const tone: Tone = (domain === 'expense' ? EXPENSE_STATUS_TONE[status] : undefined) ?? 'neutral'

  return (
    <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${TONE_CLASSES[tone]}`}>
      {label}
    </span>
  )
}
