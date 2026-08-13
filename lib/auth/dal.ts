import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'

export type MembershipWithRoles = {
  id: string
  organization_id: string
  status: Database['public']['Tables']['memberships']['Row']['status']
  organization_name: string
  role_codes: string[]
}

/**
 * Data Access Layer (voir le guide Next.js "Authentication" — DAL pattern).
 * Verifie la session aupres du serveur Supabase Auth (getUser(), jamais
 * getSession() seul cote serveur : getUser revalide le JWT au lieu de se
 * fier a un cookie non revérifié). Redirige vers /login si absent.
 */
export const verifySession = cache(async () => {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/login')
  }

  return { userId: user.id, email: user.email ?? null }
})

/** Comme verifySession, mais ne redirige pas — retourne null si absent. */
export const getOptionalSession = cache(async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  return { userId: user.id, email: user.email ?? null }
})

export const getCurrentUserProfile = cache(async () => {
  const session = await verifySession()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('users')
    .select('id, full_name, phone, avatar_url, status, mfa_enabled')
    .eq('id', session.userId)
    .single()

  if (error) {
    return null
  }
  return data
})

/**
 * Toutes les appartenances actives de l'utilisateur courant, avec les
 * codes de role effectifs (via membership_roles). Une seule requete
 * (jointures imbriquees PostgREST) plutot que N+1.
 */
export const getMemberships = cache(async (): Promise<MembershipWithRoles[]> => {
  const session = await verifySession()
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('memberships')
    .select(
      `id, organization_id, status,
       organizations ( name ),
       membership_roles ( roles ( code ) )`
    )
    .eq('user_id', session.userId)
    .eq('status', 'active')

  if (error || !data) {
    return []
  }

  return data.map((m) => ({
    id: m.id,
    organization_id: m.organization_id,
    status: m.status,
    organization_name: (m.organizations as unknown as { name: string } | null)?.name ?? '',
    role_codes: (m.membership_roles as unknown as Array<{ roles: { code: string } | null }>)
      .map((mr) => mr.roles?.code)
      .filter((code): code is string => Boolean(code)),
  }))
})
