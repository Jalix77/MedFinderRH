import type { Metadata } from 'next'
import Link from 'next/link'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/dal'
import { AccessDenied } from '@/components/shell/access-denied'
import { StatusBadge } from '@/components/finance/status-badge'
import { MetricCard } from '@/components/finance/metric-card'
import { formatMoney } from '@/lib/format/money'

export const metadata: Metadata = { title: 'Depenses — MedFinder Gestion' }

export default async function ExpensesPage() {
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />

  const [canViewAll, canCreate] = await Promise.all([
    hasPermission(orgId, 'expense.view'),
    hasPermission(orgId, 'expense.create'),
  ])
  if (!canViewAll && !canCreate) return <AccessDenied />

  const { userId } = await verifySession()
  const supabase = await createClient()

  // Sans expense.view, RLS ne renvoie de toute facon que les demandes du
  // requester_id courant (regle "AGENT_TERRAIN ne voit que ses depenses
  // autorisees") — la requete est identique, seule la visibilite differe
  // cote base, jamais cote client (§ regles de securite UI).
  const { data: expenses } = await supabase
    .from('expense_requests')
    .select('id, expense_number, payee_name, amount, currency, status, requested_date, requester_id')
    .order('requested_date', { ascending: false })
    .limit(200)

  const list = expenses ?? []
  const pending = list.filter((e) => e.status === 'submitted').length
  const awaitingJustification = list.filter((e) => e.status === 'paid').length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-mf-navy-900">Depenses</h1>
          <p className="text-sm text-slate-500">
            {canViewAll ? 'Toutes les demandes de depense.' : 'Vos demandes de depense.'}
          </p>
        </div>
        {canCreate && (
          <Link
            href="/depenses/nouvelle"
            className="rounded-lg bg-mf-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-emerald-500"
          >
            + Nouvelle demande
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <MetricCard label="Depenses en attente d'approbation" value={String(pending)} tone={pending > 0 ? 'warning' : 'default'} />
        <MetricCard
          label="Justificatifs manquants"
          value={String(awaitingJustification)}
          tone={awaitingJustification > 0 ? 'danger' : 'default'}
        />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-mf-border bg-mf-surface shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Numero</th>
              <th className="px-4 py-2">Beneficiaire</th>
              <th className="px-4 py-2">Montant</th>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Statut</th>
            </tr>
          </thead>
          <tbody>
            {list.map((e) => (
              <tr key={e.id} className="border-t border-mf-border hover:bg-slate-50">
                <td className="px-4 py-2">
                  <Link href={`/depenses/${e.id}`} className="font-medium text-mf-navy-700 hover:underline">
                    {e.expense_number || '—'}
                  </Link>
                  {e.requester_id === userId && <span className="ml-2 text-xs text-slate-400">(vous)</span>}
                </td>
                <td className="px-4 py-2 text-mf-navy-900">{e.payee_name}</td>
                <td className="px-4 py-2 font-medium">{formatMoney(e.amount, e.currency)}</td>
                <td className="px-4 py-2 text-slate-500">{e.requested_date}</td>
                <td className="px-4 py-2">
                  <StatusBadge status={e.status} domain="expense" />
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  Aucune demande de depense.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
