import type { ReactNode } from 'react'

/** Presentation issue du stash nomme "prototype-ui-apercu-direction".
 * L'empreinte verifiee de cette source canonique est documentee dans DESIGN.md.
 * Les couleurs appartiennent exclusivement au theme MedFinder existant.
 * Aucune requete ni regle metier dans ces composants serveur.
 */
const captionClass = 'text-[11px] font-semibold uppercase leading-relaxed tracking-[0.14em] text-slate-500'

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className={captionClass}>{children}</p>
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`min-w-0 rounded-xl border border-mf-border bg-mf-surface ${className}`}>{children}</div>
}

export function SectionHeading({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
      <h2 className={captionClass}>{title}</h2>
      {aside != null && <div className="text-[13px] tabular-nums text-slate-500 [overflow-wrap:anywhere]">{aside}</div>}
    </div>
  )
}

export function PanelSection({ title, aside, children }: {
  title: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section aria-label={title} className="min-w-0 rounded-xl border border-mf-border bg-mf-surface p-4 lg:p-5">
      <SectionHeading title={title} aside={aside} />
      {children}
    </section>
  )
}

export function Kpi({ label, value, note, tone = 'default', nested = false }: {
  label: string
  value: string
  note?: string
  tone?: 'default' | 'success' | 'warning' | 'danger'
  nested?: boolean
}) {
  const valueTone = tone === 'danger' ? 'text-mf-danger'
    : tone === 'warning' ? 'text-amber-700'
      : tone === 'success' ? 'text-mf-emerald-700' : 'text-mf-navy-950'
  // Conserve le texte formate, mais autorise un retour avant la devise entiere.
  const moneyParts = value.match(/^(.+?)(\s)([A-Z]{3})$/u)

  return (
    <div data-direction-kpi={label}
      className={`flex min-h-[138px] min-w-0 flex-col justify-between rounded-xl border p-5 ${
        nested ? 'border-mf-border/60 bg-background/40' : 'border-mf-border bg-mf-surface'
      }`}>
      <dl>
        <dt className={captionClass}>{label}</dt>
        <dd className={`mt-4 text-[clamp(24px,1.9vw,34px)] font-semibold leading-tight tracking-tight tabular-nums [overflow-wrap:anywhere] ${valueTone}`}>
          {moneyParts ? <>{moneyParts[1]}{moneyParts[2]}<wbr /><span className="inline-block">{moneyParts[3]}</span></> : value}
        </dd>
      </dl>
      {note && <p className="mt-3 text-[13px] leading-relaxed text-slate-500">{note}</p>}
    </div>
  )
}

export type CompositionSegment = { label: string; amount: number; positive?: boolean }

/** Mise en proportion de valeurs deja calculees ; aucun nouveau KPI.
 * Une valeur negative ne peut pas etre representee par une largeur : les
 * montants restent alors lisibles dans la legende, sans proportion trompeuse.
 */
export function CompositionBar({ label, segments, formatValue }: {
  label: string
  segments: CompositionSegment[]
  formatValue: (amount: number) => string
}) {
  const representable = segments.every(({ amount }) => Number.isFinite(amount) && amount >= 0)
  const total = representable ? segments.reduce((sum, { amount }) => sum + amount, 0) : 0
  const tones = ['bg-mf-navy-800', 'bg-mf-navy-700/45', 'bg-mf-navy-700/20']

  return (
    <div className="mt-5 border-t border-mf-border/60 pt-5">
      <h3 className={`mb-4 ${captionClass}`}>{label}</h3>
      {total > 0 ? (
        <div aria-hidden className="mb-4 flex h-3 w-full overflow-hidden rounded-full bg-mf-border/50">
          {segments.map((segment, index) => segment.amount > 0 ? (
            <div key={segment.label}
              className={segment.positive ? 'bg-mf-emerald-600' : tones[index % tones.length]}
              style={{ width: `${segment.amount / total * 100}%` }} />
          ) : null)}
        </div>
      ) : (
        <p className="mb-4 text-[13px] text-slate-500">
          {representable ? 'Aucun montant à répartir pour l’instant.' : 'La répartition graphique n’est pas disponible pour ces montants.'}
        </p>
      )}
      <ul className="grid gap-x-8 gap-y-3 sm:grid-cols-2 xl:flex xl:flex-wrap">
        {segments.map((segment, index) => (
          <li key={segment.label} className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
            <span aria-hidden className={`size-2 shrink-0 rounded-full ${segment.positive ? 'bg-mf-emerald-600' : tones[index % tones.length]}`} />
            <span className="text-[13px] text-slate-600">{segment.label}</span>
            <span className="text-sm font-semibold tabular-nums text-mf-navy-950 [overflow-wrap:anywhere]">{formatValue(segment.amount)}</span>
            {total > 0 && <span className="text-xs tabular-nums text-slate-500">{(segment.amount / total * 100).toFixed(0)} %</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
