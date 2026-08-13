import 'server-only'
import { cookies } from 'next/headers'
import { getMemberships } from './dal'

/**
 * "Organisation active" = pure commodite d'affichage (quel contexte
 * afficher dans l'UI), JAMAIS une frontiere de securite : RLS filtre deja
 * chaque requete selon les appartenances reelles de l'utilisateur, quel
 * que soit le contenu de ce cookie. Voir architecture.md §6 et ADR
 * associe : on a delibérément abandonné un mecanisme cote base
 * (current_org_id() via GUC de session) au profit d'un organization_id
 * explicite sur chaque appel, plus robuste dans le modele stateless de
 * PostgREST — ce cookie ne fait que présélectionner cette valeur cote UI.
 */
const ACTIVE_ORG_COOKIE = 'mfg_active_org'

export async function getActiveOrganizationId(): Promise<string | null> {
  const memberships = await getMemberships()
  if (memberships.length === 0) return null

  const cookieStore = await cookies()
  const preferred = cookieStore.get(ACTIVE_ORG_COOKIE)?.value

  const match = memberships.find((m) => m.organization_id === preferred)
  return (match ?? memberships[0]).organization_id
}

export async function setActiveOrganizationId(organizationId: string) {
  const cookieStore = await cookies()
  cookieStore.set(ACTIVE_ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30,
  })
}
