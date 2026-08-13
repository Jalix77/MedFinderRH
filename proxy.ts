import { type NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * Proxy (renomme depuis "middleware" en Next.js 16 — voir
 * node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md).
 *
 * Role STRICTEMENT limite a des verifications optimistes de presence de
 * session + rafraichissement du cookie Supabase — jamais une verification
 * de permission (couteux, et le guide Next.js deconseille tout acces base
 * de donnees ici, y compris pour les routes prefetchees). La securite
 * reelle est assuree par RLS + les verifications serveur dans le DAL et
 * les Server Actions (voir lib/auth/dal.ts, security.md §4).
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isAuthRoute =
    path.startsWith('/login') ||
    path.startsWith('/reset-password') ||
    path.startsWith('/update-password') ||
    path.startsWith('/mfa') ||
    path.startsWith('/auth/callback')

  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && (path === '/login' || path === '/')) {
    const url = request.nextUrl.clone()
    url.pathname = '/direction'
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
