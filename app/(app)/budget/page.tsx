import type { Metadata } from 'next'
import Link from 'next/link'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { AccessDenied } from '@/components/shell/access-denied'
import { StatusBadge } from '@/components/finance/status-badge'
import { MetricCard } from '@/components/finance/metric-card'
import { formatMoney } from '@/lib/format/money'
import { createFiscalYearAction, createBudgetAction, createCostCenterAction } from '@/app/actions/budget'

export const metadata: Metadata = { title: 'Budget — MedFinder Gestion' }

export default async function BudgetPage() {
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />

  const canView = await hasPermission(orgId, 'budget.view')
  if (!canView) return <AccessDenied />
  const canManage = await hasPermission(orgId, 'budget.manage')

  const supabase = await createClient()
  const [{ data: fiscalYears }, { data: budgets }, { data: costCenters }, { data: departments }, { data: balances }] =
    await Promise.all([
      supabase.from('fiscal_years').select('id, label, start_date, end_date, status').order('start_date', { ascending: false }),
      supabase
        .from('budgets')
        .select('id, name, status, source_type, fiscal_years ( label )')
        .order('created_at', { ascending: false }),
      supabase.from('cost_centers').select('id, code, name'),
      supabase.from('departments').select('id, name').eq('status', 'active').order('name'),
      supabase.from('budget_line_balances').select('planned_amount, committed_open, available_amount'),
    ])

  // Vue d'ensemble metier (regles UX) : "Budget consomme"/"Budget disponible",
  // pas des noms de colonnes techniques.
  const totalPlanned = (balances ?? []).reduce((sum, b) => sum + Number(b.planned_amount ?? 0), 0)
  const totalAvailable = (balances ?? []).reduce((sum, b) => sum + Number(b.available_amount ?? 0), 0)
  const totalConsumed = totalPlanned - totalAvailable

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-mf-navy-900">Budget</h1>
        <p className="text-sm text-slate-500">Exercices, budgets, lignes budgetaires et centres de couts.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard label="Budget planifie" value={formatMoney(totalPlanned)} />
        <MetricCard label="Budget consomme" value={formatMoney(totalConsumed)} tone="warning" />
        <MetricCard label="Budget disponible" value={formatMoney(totalAvailable)} tone="success" />
      </div>

      <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-mf-navy-900">Budgets</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-1 pr-4">Nom</th>
                <th className="py-1 pr-4">Exercice</th>
                <th className="py-1 pr-4">Source</th>
                <th className="py-1 pr-4">Statut</th>
              </tr>
            </thead>
            <tbody>
              {(budgets ?? []).map((b) => (
                <tr key={b.id} className="border-t border-mf-border">
                  <td className="py-2 pr-4">
                    <Link href={`/budget/${b.id}`} className="font-medium text-mf-navy-700 hover:underline">
                      {b.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-slate-500">{b.fiscal_years?.label ?? '—'}</td>
                  <td className="py-2 pr-4 text-slate-500">{b.source_type === 'papej' ? 'PAPEJ' : 'General'}</td>
                  <td className="py-2 pr-4">
                    <StatusBadge status={b.status} />
                  </td>
                </tr>
              ))}
              {(budgets ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-slate-400">
                    Aucun budget.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {canManage && (
          <details className="border-t border-mf-border pt-3">
            <summary className="cursor-pointer text-sm font-medium text-mf-navy-700">+ Nouveau budget</summary>
            <form action={createBudgetAction} className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-mf-navy-900">Nom</label>
                <input name="name" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-mf-navy-900">Exercice comptable</label>
                <select
                  name="fiscal_year_id"
                  required
                  className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
                >
                  <option value="">—</option>
                  {(fiscalYears ?? []).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <button
                  type="submit"
                  className="rounded-lg bg-mf-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-emerald-500"
                >
                  Creer le budget
                </button>
              </div>
            </form>
          </details>
        )}
      </section>

      {canManage && (
        <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-mf-navy-900">
              Exercices comptables ({(fiscalYears ?? []).length})
            </summary>
            <div className="mt-3 space-y-3">
              <ul className="space-y-1 text-sm text-slate-500">
                {(fiscalYears ?? []).map((f) => (
                  <li key={f.id}>
                    {f.label} — {f.start_date} → {f.end_date} ({f.status === 'open' ? 'ouvert' : 'ferme'})
                  </li>
                ))}
              </ul>
              <form action={createFiscalYearAction} className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-mf-navy-900">Libelle</label>
                  <input name="label" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-mf-navy-900">Date de debut</label>
                  <input type="date" name="start_date" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-mf-navy-900">Date de fin</label>
                  <input type="date" name="end_date" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
                </div>
                <div className="col-span-3">
                  <button
                    type="submit"
                    className="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800"
                  >
                    Creer l&apos;exercice
                  </button>
                </div>
              </form>
            </div>
          </details>
        </section>
      )}

      {canManage && (
        <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-mf-navy-900">
              Centres de couts ({(costCenters ?? []).length})
            </summary>
            <div className="mt-3 space-y-3">
              <ul className="space-y-1 text-sm text-slate-500">
                {(costCenters ?? []).map((c) => (
                  <li key={c.id}>
                    {c.code} — {c.name}
                  </li>
                ))}
              </ul>
              <form action={createCostCenterAction} className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-mf-navy-900">Code</label>
                  <input name="code" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-mf-navy-900">Nom</label>
                  <input name="name" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-mf-navy-900">Departement (optionnel)</label>
                  <select name="department_id" className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm">
                    <option value="">—</option>
                    {(departments ?? []).map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-3">
                  <button
                    type="submit"
                    className="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800"
                  >
                    Creer le centre de cout
                  </button>
                </div>
              </form>
            </div>
          </details>
        </section>
      )}
    </div>
  )
}
