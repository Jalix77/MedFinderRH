import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from './database.types'

/**
 * Client Supabase cote serveur (Server Components, Server Actions, Route
 * Handlers). Utilise la cle publique anon + le cookie de session de
 * l'utilisateur courant — jamais service_role. Toute requete reste soumise
 * a RLS pour cet utilisateur precis.
 *
 * A appeler a chaque requete (ne pas mettre en cache/singleton global : le
 * cookie store est lie a la requete courante).
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {
            // Appele depuis un Server Component qui ne peut pas ecrire de
            // cookies (proxy.ts se charge du rafraichissement de session
            // dans ce cas — voir proxy.ts).
          }
        },
      },
    }
  )
}
