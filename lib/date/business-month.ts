/**
 * Bornes du mois METIER.
 *
 * MedFinder opere en Haiti : le mois comptable est celui de Port-au-Prince,
 * pas celui du serveur. Deduire les bornes de l'heure locale du processus
 * les rendait dependantes de l'hebergeur — un serveur en UTC bascule de
 * mois quatre a cinq heures avant Haiti, et le 1er du mois a 20h a
 * Port-au-Prince le KPI aurait deja bascule sur le mois suivant, affichant
 * zero charge. Le fuseau est donc declare ici, explicitement, une seule
 * fois.
 */

export const BUSINESS_TIME_ZONE = 'America/Port-au-Prince'

const FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Date civile a Port-au-Prince pour un instant donne, au format YYYY-MM-DD. */
export function businessDate(instant: Date): string {
  // formatToParts plutot que format() : l'ordre et les separateurs d'une
  // locale ne sont pas un contrat stable, les parties nommees le sont.
  const parts = FORMATTER.formatToParts(instant)
  const part = (type: 'year' | 'month' | 'day') =>
    parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export type BusinessMonthRange = { start: string; end: string }

/**
 * Du premier jour du mois en cours a Haiti jusqu'a la date du jour a Haiti.
 */
export function businessMonthToDate(instant: Date): BusinessMonthRange {
  const end = businessDate(instant)
  return { start: `${end.slice(0, 7)}-01`, end }
}
