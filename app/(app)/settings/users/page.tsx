import type { Metadata } from 'next'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/dal'
import { AccessDenied } from '@/components/shell/access-denied'
import { ROLE_CODES } from '@/lib/permissions/codes'
import {
  inviteMemberAction,
  assignRoleAction,
  revokeRoleAction,
  setMembershipStatusAction,
} from '@/app/actions/rbac'

export const metadata: Metadata = { title: 'Utilisateurs & roles — MedFinder Gestion' }

type MembershipRow = {
  id: string
  status: string
  user_id: string
  users: { full_name: string } | null
  membership_roles: { roles: { code: string } | null }[]
}

export default async function UsersSettingsPage() {
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />

  const [canManageUsers, canManageRoles] = await Promise.all([
    hasPermission(orgId, 'user.manage'),
    hasPermission(orgId, 'role.manage'),
  ])
  if (!canManageUsers && !canManageRoles) return <AccessDenied />

  const { userId: currentUserId } = await verifySession()
  const supabase = await createClient()
  const { data } = await supabase
    .from('memberships')
    .select('id, status, user_id, users ( full_name ), membership_roles ( roles ( code ) )')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: true })

  const memberships = (data ?? []) as unknown as MembershipRow[]

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-mf-navy-900">Utilisateurs &amp; roles</h1>

      {canManageUsers && (
        <form
          action={inviteMemberAction}
          className="flex flex-wrap items-end gap-3 rounded-2xl border border-mf-border bg-mf-surface p-5 shadow-sm"
        >
          <div>
            <label className="block text-xs font-medium text-mf-navy-900">
              Email (compte deja inscrit)
            </label>
            <input
              name="email"
              type="email"
              required
              className="mt-1 rounded-lg border border-mf-border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-mf-navy-900">Role initial</label>
            <select
              name="role"
              required
              className="mt-1 rounded-lg border border-mf-border px-3 py-2 text-sm"
            >
              {ROLE_CODES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded-lg bg-mf-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-emerald-500"
          >
            Ajouter a l&apos;organisation
          </button>
        </form>
      )}

      <div className="overflow-x-auto rounded-2xl border border-mf-border bg-mf-surface shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Utilisateur</th>
              <th className="px-4 py-2">Statut</th>
              <th className="px-4 py-2">Roles</th>
              {canManageRoles && <th className="px-4 py-2">Assigner un role</th>}
              {canManageUsers && <th className="px-4 py-2">Compte</th>}
            </tr>
          </thead>
          <tbody>
            {memberships.map((m) => {
              const isSelf = m.user_id === currentUserId
              const roleCodes = m.membership_roles.map((mr) => mr.roles?.code).filter(Boolean)

              return (
                <tr key={m.id} className="border-t border-mf-border align-top">
                  <td className="px-4 py-2 font-medium text-mf-navy-900">
                    {m.users?.full_name ?? m.user_id}
                    {isSelf && <span className="ml-1 text-xs text-slate-400">(vous)</span>}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={m.status === 'active' ? 'text-mf-emerald-600' : 'text-mf-danger'}
                    >
                      {m.status}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {roleCodes.map((code) => (
                        <span
                          key={code}
                          className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs"
                        >
                          {code}
                          {canManageRoles && !isSelf && (
                            <form action={revokeRoleAction}>
                              <input type="hidden" name="membershipId" value={m.id} />
                              <input type="hidden" name="role" value={code} />
                              <button
                                type="submit"
                                className="text-slate-400 hover:text-mf-danger"
                                aria-label={`Retirer ${code}`}
                              >
                                ×
                              </button>
                            </form>
                          )}
                        </span>
                      ))}
                    </div>
                  </td>
                  {canManageRoles && (
                    <td className="px-4 py-2">
                      {isSelf ? (
                        <span className="text-xs text-slate-400">
                          Auto-attribution non autorisee
                        </span>
                      ) : (
                        <form action={assignRoleAction} className="flex gap-2">
                          <input type="hidden" name="membershipId" value={m.id} />
                          <select name="role" className="rounded-lg border border-mf-border px-2 py-1 text-xs">
                            {ROLE_CODES.map((code) => (
                              <option key={code} value={code}>
                                {code}
                              </option>
                            ))}
                          </select>
                          <button
                            type="submit"
                            className="rounded-lg bg-mf-navy-900 px-2 py-1 text-xs font-semibold text-white hover:bg-mf-navy-800"
                          >
                            Assigner
                          </button>
                        </form>
                      )}
                    </td>
                  )}
                  {canManageUsers && (
                    <td className="px-4 py-2">
                      {isSelf ? (
                        <span className="text-xs text-slate-400">Non applicable</span>
                      ) : (
                        <form action={setMembershipStatusAction}>
                          <input type="hidden" name="membershipId" value={m.id} />
                          <input
                            type="hidden"
                            name="status"
                            value={m.status === 'active' ? 'suspended' : 'active'}
                          />
                          <button
                            type="submit"
                            className="rounded-lg border border-mf-border px-2 py-1 text-xs font-medium hover:bg-slate-50"
                          >
                            {m.status === 'active' ? 'Suspendre' : 'Reactiver'}
                          </button>
                        </form>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
