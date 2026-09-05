/**
 * Affichage d'une date civile stockee en `date` PostgreSQL.
 *
 * Ces colonnes (hire_date, start_date, birth_date...) sont des dates
 * civiles, pas des instants : les passer par `new Date(...)` les fait
 * traverser un fuseau et un `2026-03-01` peut s'afficher `28 fevrier`
 * selon l'hebergeur. Le formatage se fait donc sur la chaine, sans
 * jamais construire de Date.
 */

const MONTHS_FR = [
  'janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre',
]

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/

/** `2026-03-01` -> `1 mars 2026`. Rend `—` si la valeur est absente. */
export function formatDay(value: string | null | undefined): string {
  if (!value) return '—'
  const match = ISO_DAY.exec(value)
  if (!match) return value
  const [, year, month, day] = match
  const monthLabel = MONTHS_FR[Number(month) - 1]
  if (!monthLabel) return value
  return `${Number(day)} ${monthLabel} ${year}`
}

/** Variante courte pour les listes denses : `01/03/2026`. */
export function formatDayShort(value: string | null | undefined): string {
  if (!value) return '—'
  const match = ISO_DAY.exec(value)
  if (!match) return value
  const [, year, month, day] = match
  return `${day}/${month}/${year}`
}
