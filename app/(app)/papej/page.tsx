import type { Metadata } from 'next'
import Link from 'next/link'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { AccessDenied } from '@/components/shell/access-denied'
import { MetricCard } from '@/components/finance/metric-card'
import { StatusBadge } from '@/components/finance/status-badge'
import { formatMoney } from '@/lib/format/money'
import { createGrantAction } from '@/app/actions/papej'

export const metadata: Metadata = { title: 'PAPEJ — MedFinder Gestion' }

export default async function PapejPage() {
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />

  const canView = await hasPermission(orgId, 'papej.view')
  if (!canView) return <AccessDenied />
  const canManage = await hasPermission(orgId, 'papej.manage')

  const supabase = await createClient()
  const [{ data: grants }, { data: glAccounts }] = await Promise.all([
    supabase
      .from('grants')
      .select('id, name, donor_name, amount_granted, amount_received, currency, status')
      .order('created_at', { ascending: false }),
    supabase.from('chart_of_accounts').select('id, code, label').eq('type', 'revenue').eq('is_active', true).order('code'),
  ])

  const totalGranted = (grants ?? []).reduce((sum, g) => sum + Number(g.amount_granted), 0)
  const totalReceived = (grants ?? []).reduce((sum, g) => sum + Number(g.amount_received), 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-mf-navy-900">PAPEJ</h1>
        <p className="text-sm text-slate-500">Financements et suivi des lignes budgetaires associees.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <MetricCard label="PAPEJ accorde" value={formatMoney(totalGranted)} />
        <MetricCard label="PAPEJ recu" value={formatMoney(totalReceived)} tone="success" />
      </div>

      <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-mf-navy-900">Financements</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-1 pr-4">Nom</th>
                <th className="py-1 pr-4">Bailleur</th>
                <th className="py-1 pr-4">Accorde</th>
                <th className="py-1 pr-4">Recu</th>
                <th className="py-1 pr-4">Statut</th>
              </tr>
            </thead>
            <tbody>
              {(grants ?? []).map((g) => (
                <tr key={g.id} className="border-t border-mf-border">
                  <td className="py-2 pr-4">
                    <Link href={`/papej/${g.id}`} className="font-medium text-mf-navy-700 hover:underline">
                      {g.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-slate-500">{g.donor_name ?? '—'}</td>
                  <td className="py-2 pr-4">{formatMoney(g.amount_granted, g.currency)}</td>
                  <td className="py-2 pr-4 font-medium text-mf-emerald-700">{formatMoney(g.amount_received, g.currency)}</td>
                  <td className="py-2 pr-4">
                    <StatusBadge status={g.status} />
                  </td>
                </tr>
              ))}
              {(grants ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-slate-400">
                    Aucun financement enregistre.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {canManage && (
          <details className="border-t border-mf-border pt-3">
            <summary className="cursor-pointer text-sm font-medium text-mf-navy-700">+ Nouveau financement</summary>
            <form action={createGrantAction} className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-mf-navy-900">Nom</label>
                <input name="name" required defaultValue="PAPEJ" className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-mf-navy-900">Bailleur</label>
                <input name="donor_name" className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-mf-navy-900">Montant accorde</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  name="amount_granted"
                  required
                  defaultValue="850000"
                  className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-mf-navy-900">Devise</label>
                <select name="currency" className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm">
                  <option value="HTG">HTG</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-mf-navy-900">Compte comptable de produit</label>
                <select
                  name="revenue_account_id"
                  required
                  className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
                >
                  <option value="">—</option>
                  {(glAccounts ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} — {a.label}
                    </option>
                  ))}
                </select>
                {(glAccounts ?? []).length === 0 && (
                  <p className="mt-1 text-xs text-amber-600">
                    Aucun compte de type &quot;Produit&quot; disponible — creez-en un depuis Tresorerie.
                  </p>
                )}
              </div>
              <div className="col-span-2">
                <button
                  type="submit"
                  className="rounded-lg bg-mf-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-emerald-500"
                >
                  Creer le financement
                </button>
              </div>
            </form>
          </details>
        )}
      </section>
    </div>
  )
}
