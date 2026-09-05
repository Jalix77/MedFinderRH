import type { ReactNode } from 'react'

/**
 * Primitives de presentation de la fiche employe.
 *
 * Aucune donnee n'est calculee ni inventee ici : ces composants ne font
 * que mettre en forme ce que la page leur passe. Les couleurs sortent
 * exclusivement des tokens mf-* existants.
 */

export { Avatar, initials } from './avatar'

const EMPLOYEE_STATUS_LABELS: Record<string, string> = {
  active: 'Actif',
  on_leave: 'En conge',
  terminated: 'Sorti',
}

const CONTRACT_STATUS_LABELS: Record<string, string> = {
  active: 'En cours',
  suspended: 'Suspendu',
  terminated: 'Termine',
  expired: 'Expire',
}

/**
 * Le libelle est traduit quand il est connu, sinon la valeur brute est
 * affichee telle quelle : une fiche RH ne doit jamais masquer un statut
 * qu'elle ne sait pas nommer.
 */
export function statusLabel(status: string, scope: 'employee' | 'contract' = 'employee'): string {
  const table = scope === 'contract' ? CONTRACT_STATUS_LABELS : EMPLOYEE_STATUS_LABELS
  return table[status] ?? status
}

export function statusTone(status: string): 'positive' | 'critical' | 'neutral' {
  if (status === 'active') return 'positive'
  if (status === 'terminated' || status === 'expired') return 'critical'
  return 'neutral'
}

export function StatusPill({
  status,
  scope = 'employee',
}: {
  status: string
  scope?: 'employee' | 'contract'
}) {
  const tone = statusTone(status)
  const className =
    tone === 'positive'
      ? 'bg-mf-emerald-50 text-mf-emerald-700 ring-mf-emerald-600/20'
      : tone === 'critical'
        ? 'bg-red-50 text-mf-danger ring-red-600/20'
        : 'bg-amber-50 text-amber-700 ring-amber-600/20'

  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${className}`}
    >
      {statusLabel(status, scope)}
    </span>
  )
}

/** Carte de contenu — meme grammaire visuelle que le reste de l'ERP. */
export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-2xl border border-mf-border bg-mf-surface p-5 shadow-sm sm:p-6 ${className}`}>
      {(title || action) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title && (
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

/**
 * Ligne d'information en lecture. `value` accepte un ReactNode pour les
 * cas ou la valeur porte sa propre mise en forme (montant, badge).
 */
export function DataField({
  label,
  value,
  wide = false,
}: {
  label: string
  value: ReactNode
  wide?: boolean
}) {
  const empty = value === null || value === undefined || value === ''
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className="text-xs font-medium text-slate-400">{label}</dt>
      <dd className={`mt-0.5 text-sm ${empty ? 'text-slate-300' : 'text-mf-navy-900'}`}>
        {empty ? '—' : value}
      </dd>
    </div>
  )
}

export function FieldGrid({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">{children}</dl>
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-mf-border px-4 py-6 text-center text-sm text-slate-400">
      {children}
    </p>
  )
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  contrat_signe: 'Contrat signe',
  piece_identite: "Piece d'identite",
  diplome: 'Diplome',
  cv: 'CV',
  justificatif: 'Justificatif',
  autre: 'Autre',
}

export function documentTypeLabel(type: string): string {
  return DOCUMENT_TYPE_LABELS[type] ?? type
}

/**
 * Pastille de type de document. Pas de librairie d'icones : le projet n'en
 * a aucune installee et une dependance ne se justifie pas pour six
 * glyphes. Un trace inline suffit et reste dans les tokens.
 */
export function DocumentGlyph({ type }: { type: string }) {
  return (
    <span
      aria-hidden
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-mf-navy-700 ring-1 ring-inset ring-mf-border"
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" strokeWidth={1.6} stroke="currentColor">
        {type === 'piece_identite' ? (
          <>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <circle cx="9" cy="11" r="2" />
            <path d="M14 10h4M14 14h4M6 16c.8-1.4 4.4-1.4 5.2 0" strokeLinecap="round" />
          </>
        ) : type === 'diplome' ? (
          <>
            <path d="M3 8l9-4 9 4-9 4-9-4z" strokeLinejoin="round" />
            <path d="M7 10.5V15c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5v-4.5" strokeLinecap="round" />
          </>
        ) : (
          <>
            <path d="M6 3h7l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" strokeLinejoin="round" />
            <path d="M13 3v5h5" strokeLinejoin="round" />
          </>
        )}
      </svg>
    </span>
  )
}
