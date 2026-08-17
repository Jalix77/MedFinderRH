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

// Ecritures manuelles (Phase 2A, docs/phase-2-plan.md §0.3) — vocabulaire
// distinct des depenses meme si certains codes se recoupent (draft/
// submitted/approved/rejected/posted), pour ne jamais afficher un statut
// depense (committed/paid/justified/cancelled) qui n'existe pas ici.
const JOURNAL_ENTRY_STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillon',
  submitted: 'Soumise',
  approved: 'Approuvee',
  rejected: 'Rejetee',
  posted: 'Comptabilisee',
}

const JOURNAL_ENTRY_STATUS_TONE: Record<string, Tone> = {
  draft: 'neutral',
  submitted: 'warning',
  approved: 'info',
  rejected: 'danger',
  posted: 'success',
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
export function StatusBadge({ status, domain }: { status: string; domain?: 'expense' | 'journal_entry' }) {
  const domainLabels =
    domain === 'expense' ? EXPENSE_STATUS_LABELS : domain === 'journal_entry' ? JOURNAL_ENTRY_STATUS_LABELS : undefined
  const domainTones =
    domain === 'expense' ? EXPENSE_STATUS_TONE : domain === 'journal_entry' ? JOURNAL_ENTRY_STATUS_TONE : undefined
  const label = domainLabels?.[status] ?? GENERIC_STATUS_LABELS[status] ?? status
  const tone: Tone = domainTones?.[status] ?? 'neutral'

  return (
    <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${TONE_CLASSES[tone]}`}>
      {label}
    </span>
  )
}
