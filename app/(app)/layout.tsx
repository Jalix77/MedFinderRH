import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { verifySession, getCurrentUserProfile, getMemberships } from '@/lib/auth/dal'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { organizationRequiresMfa, getMfaAssurance, needsMfaEnrollment } from '@/lib/auth/mfa'
import { hasPermission } from '@/lib/permissions'
import { NAV_ITEMS } from '@/lib/navigation'
import { Sidebar } from '@/components/shell/sidebar'
import { Header } from '@/components/shell/header'
import type { RoleCode } from '@/lib/permissions/codes'

export default async function AppLayout({ children }: { children: ReactNode }) {
  await verifySession()

  const [profile, memberships] = await Promise.all([getCurrentUserProfile(), getMemberships()])

  if (memberships.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-mf-navy-950 p-6">
        <div className="max-w-md rounded-2xl bg-mf-surface p-8 text-center shadow-xl">
          <h1 className="text-lg font-semibold text-mf-navy-900">Aucune organisation</h1>
          <p className="mt-2 text-sm text-slate-500">
            Votre compte n&apos;est rattache a aucune organisation active. Contactez un
            administrateur MedFinder Gestion.
          </p>
        </div>
      </div>
    )
  }

  const activeOrgId = await getActiveOrganizationId()
  if (!activeOrgId) redirect('/login')

  const activeMembership = memberships.find((m) => m.organization_id === activeOrgId)!
  const roleCodes = activeMembership.role_codes as RoleCode[]

  const requiresMfa = await organizationRequiresMfa(activeOrgId, roleCodes)
  const assurance = await getMfaAssurance()
  const mfaBannerVisible = needsMfaEnrollment(requiresMfa, assurance)

  const allowedNavItems = await Promise.all(
    NAV_ITEMS.map(async (item) => {
      if (!item.permission) return item
      const required = Array.isArray(item.permission) ? item.permission : [item.permission]
      // Tableau = "au moins une" (ex. Depenses reste visible pour un agent
      // terrain qui n'a que expense.create, sans jamais avoir expense.view).
      const results = await Promise.all(required.map((p) => hasPermission(activeOrgId, p)))
      return results.some(Boolean) ? item : null
    })
  ).then((items) => items.filter((i): i is (typeof NAV_ITEMS)[number] => i !== null))

  return (
    <div className="flex min-h-screen">
      <Sidebar items={allowedNavItems} />
      <div className="flex flex-1 flex-col">
        <Header
          organizationName={activeMembership.organization_name}
          userName={profile?.full_name ?? 'Utilisateur'}
          roleCodes={roleCodes}
        />
        {mfaBannerVisible && (
          <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900">
            Votre role exige l&apos;authentification a deux facteurs. Tant qu&apos;elle
            n&apos;est pas activee, vos actions restent limitees.{' '}
            <a href="/settings/security" className="font-semibold underline">
              Activer maintenant
            </a>
          </div>
        )}
        <main className="flex-1 bg-background p-6">{children}</main>
      </div>
    </div>
  )
}
