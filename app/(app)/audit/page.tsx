import type { Metadata } from 'next'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { AccessDenied } from '@/components/shell/access-denied'

export const metadata: Metadata = { title: 'Audit — MedFinder Gestion' }

export default async function AuditPage() {
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />

  const allowed = await hasPermission(orgId, 'audit.view')
  if (!allowed) return <AccessDenied />

  const supabase = await createClient()
  const { data: logs } = await supabase
    .from('audit_logs')
    .select('id, action, module, object_type, result, occurred_at, user_id')
    .eq('organization_id', orgId)
    .order('occurred_at', { ascending: false })
    .limit(50)

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-mf-navy-900">Journal d&apos;audit</h1>
      <p className="text-sm text-slate-500">
        50 evenements les plus recents pour cette organisation. Lecture seule — voir
        docs/security.md §6.
      </p>

      <div className="overflow-x-auto rounded-2xl border border-mf-border bg-mf-surface shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Action</th>
              <th className="px-4 py-2">Module</th>
              <th className="px-4 py-2">Objet</th>
              <th className="px-4 py-2">Resultat</th>
            </tr>
          </thead>
          <tbody>
            {(logs ?? []).map((log) => (
              <tr key={log.id} className="border-t border-mf-border">
                <td className="px-4 py-2 text-slate-500">
                  {new Date(log.occurred_at).toLocaleString('fr-FR')}
                </td>
                <td className="px-4 py-2 font-medium text-mf-navy-900">{log.action}</td>
                <td className="px-4 py-2">{log.module}</td>
                <td className="px-4 py-2">{log.object_type}</td>
                <td className="px-4 py-2">
                  <span
                    className={
                      log.result === 'denied'
                        ? 'text-mf-danger'
                        : log.result === 'error'
                          ? 'text-amber-600'
                          : 'text-mf-emerald-600'
                    }
                  >
                    {log.result}
                  </span>
                </td>
              </tr>
            ))}
            {(logs ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  Aucun evenement pour le moment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
