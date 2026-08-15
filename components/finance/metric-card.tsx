/**
 * Carte de metrique — le DG doit pouvoir lire ces ecrans sans comprendre la
 * mecanique comptable interne (§ regles UX) : toujours un libelle metier
 * ("Budget disponible", "Depenses en attente"...), jamais un nom de colonne
 * ou de statut technique brut.
 */
export function MetricCard({
  label,
  value,
  tone = 'default',
  hint,
}: {
  label: string
  value: string
  tone?: 'default' | 'warning' | 'danger' | 'success'
  hint?: string
}) {
  const valueClass =
    tone === 'warning'
      ? 'text-amber-600'
      : tone === 'danger'
        ? 'text-mf-danger'
        : tone === 'success'
          ? 'text-mf-emerald-600'
          : 'text-mf-navy-900'

  return (
    <div className="rounded-2xl border border-mf-border bg-mf-surface p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${valueClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  )
}
