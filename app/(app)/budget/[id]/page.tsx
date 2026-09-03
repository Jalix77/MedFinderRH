import type { Metadata } from 'next'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { AccessDenied } from '@/components/shell/access-denied'
import { StatusBadge } from '@/components/finance/status-badge'
import { formatMoney } from '@/lib/format/money'
import {
  createBudgetLineAction,
  setBudgetStatusAction,
  updateBudgetLineAction,
  deleteBudgetLineAction,
} from '@/app/actions/budget'
import { TransferForm } from '@/components/finance/transfer-form'

export const metadata: Metadata = { title: 'Budget — MedFinder Gestion' }

type PageProps = { params: Promise<{ id: string }> }

export default async function BudgetDetailPage({ params }: PageProps) {
  const { id } = await params
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />

  const canView = await hasPermission(orgId, 'budget.view')
  if (!canView) return <AccessDenied />
  const [canManage, canTransfer] = await Promise.all([
    hasPermission(orgId, 'budget.manage'),
    hasPermission(orgId, 'budget.transfer'),
  ])

  const supabase = await createClient()
  const { data: budget } = await supabase
    .from('budgets')
    .select('id, name, status, fiscal_years ( label )')
    .eq('id', id)
    .maybeSingle()
  if (!budget) return <AccessDenied />

  const [{ data: rawLines }, { data: costCenters }] = await Promise.all([
    supabase
      .from('budget_lines')
      .select('id, category, planned_amount, currency, cost_center_id')
      .eq('budget_id', id)
      .order('category'),
    supabase.from('cost_centers').select('id, code, name'),
  ])

  const lineIds = (rawLines ?? []).map((l) => l.id)
  // budget_line_balances est une vue (security_invoker, §10 du plan
  // corrige) sans contrainte FK reelle vers budget_lines — PostgREST ne
  // peut donc pas l'embarquer via select=...,budget_line_balances(...)
  // (PGRST200 "no relationship found", trouvaille du rejeu E2E : la page
  // affichait silencieusement "Aucune ligne budgetaire" meme quand des
  // lignes existaient, l'erreur de la requete n'etant jamais verifiee).
  // Corrige par deux requetes distinctes, jointes cote application.
  const [{ data: balancesRows }, { data: commitments }] =
    lineIds.length > 0
      ? await Promise.all([
          supabase
            .from('budget_line_balances')
            .select('budget_line_id, committed_open, available_amount')
            .in('budget_line_id', lineIds),
          supabase
            .from('budget_commitments')
            .select('id, budget_line_id, amount, status, reference_type, reference_id, created_at')
            .in('budget_line_id', lineIds)
            .eq('status', 'active'),
        ])
      : [{ data: [] }, { data: [] }]

  const balanceByLineId = new Map((balancesRows ?? []).map((b) => [b.budget_line_id, b]))
  const lines = (rawLines ?? []).map((l) => ({ ...l, balance: balanceByLineId.get(l.id) ?? null }))

  // Modification et suppression d'une ligne uniquement tant que le budget
  // est un brouillon. Ce booleen ne fait que refleter la regle : elle est
  // posee en base par les policies budget_lines_update / _delete, qui
  // exigent toutes deux `budgets.status = 'draft'`. Masquer les controles
  // evite de proposer une action vouee au refus, il ne la garantit pas.
  const canEditLines = canManage && budget.status === 'draft'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-mf-navy-900">{budget.name}</h1>
          <p className="text-sm text-slate-500">Exercice {budget.fiscal_years?.label ?? '—'}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={budget.status} />
          {canManage && budget.status === 'draft' && (
            <form action={setBudgetStatusAction}>
              <input type="hidden" name="id" value={budget.id} />
              <input type="hidden" name="status" value="approved" />
              <button
                type="submit"
                className="rounded-lg bg-mf-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-emerald-500"
              >
                Approuver le budget
              </button>
            </form>
          )}
        </div>
      </div>

      <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-mf-navy-900">Lignes budgetaires</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-1 pr-4">Categorie</th>
                <th className="py-1 pr-4">Prevu</th>
                <th className="py-1 pr-4">Engage</th>
                <th className="py-1 pr-4">Disponible</th>
                {canEditLines && <th className="py-1"></th>}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const balance = l.balance
                const committed = Number(balance?.committed_open ?? 0)
                return (
                  <tr key={l.id} className="border-t border-mf-border align-top">
                    <td className="py-2 pr-4 text-mf-navy-900">{l.category}</td>
                    <td className="py-2 pr-4">{formatMoney(l.planned_amount, l.currency)}</td>
                    <td className="py-2 pr-4 text-amber-700">{formatMoney(committed, l.currency)}</td>
                    <td className="py-2 pr-4 font-medium text-mf-emerald-700">
                      {formatMoney(balance?.available_amount ?? 0, l.currency)}
                    </td>
                    {canEditLines && (
                      <td className="py-2">
                        <details>
                          <summary className="cursor-pointer text-xs font-medium text-mf-navy-700">
                            Modifier
                          </summary>
                          <form
                            action={updateBudgetLineAction}
                            className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-mf-border p-2"
                          >
                            <input type="hidden" name="line_id" value={l.id} />
                            <input type="hidden" name="budget_id" value={budget.id} />
                            <input type="hidden" name="currency" value={l.currency} />
                            <div>
                              <label
                                htmlFor={`cat-${l.id}`}
                                className="block text-xs font-medium text-mf-navy-900"
                              >
                                Categorie
                              </label>
                              <input
                                id={`cat-${l.id}`}
                                name="category"
                                required
                                defaultValue={l.category}
                                className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
                              />
                            </div>
                            <div>
                              <label
                                htmlFor={`amt-${l.id}`}
                                className="block text-xs font-medium text-mf-navy-900"
                              >
                                Montant planifie
                              </label>
                              <input
                                id={`amt-${l.id}`}
                                type="number"
                                step="0.01"
                                min="0"
                                name="planned_amount"
                                required
                                defaultValue={String(l.planned_amount)}
                                className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
                              />
                            </div>
                            <div className="col-span-2">
                              <label
                                htmlFor={`cc-${l.id}`}
                                className="block text-xs font-medium text-mf-navy-900"
                              >
                                Centre de couts
                              </label>
                              <select
                                id={`cc-${l.id}`}
                                name="cost_center_id"
                                defaultValue={l.cost_center_id ?? ''}
                                className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
                              >
                                <option value="">—</option>
                                {(costCenters ?? []).map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.code} — {c.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="col-span-2 flex items-center gap-3">
                              <button
                                type="submit"
                                className="rounded-lg bg-mf-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-mf-emerald-500"
                              >
                                Enregistrer
                              </button>
                            </div>
                          </form>

                          {/* La suppression n'est proposee que si la ligne
                              ne porte aucun engagement. Le refus reste
                              garanti en base par les cles etrangeres
                              `on delete restrict` : masquer le bouton
                              evite une erreur previsible, il ne remplace
                              pas le controle. */}
                          {committed === 0 ? (
                            <form action={deleteBudgetLineAction} className="mt-2">
                              <input type="hidden" name="line_id" value={l.id} />
                              <input type="hidden" name="budget_id" value={budget.id} />
                              <button
                                type="submit"
                                className="rounded-lg border border-mf-border px-3 py-1.5 text-xs font-semibold text-mf-danger hover:bg-red-50"
                              >
                                Supprimer la ligne
                              </button>
                            </form>
                          ) : (
                            <p className="mt-2 text-xs text-slate-500">
                              Suppression indisponible : cette ligne porte des engagements.
                            </p>
                          )}
                        </details>
                      </td>
                    )}
                  </tr>
                )
              })}
              {(lines ?? []).length === 0 && (
                <tr>
                  <td colSpan={canEditLines ? 5 : 4} className="py-4 text-center text-slate-400">
                    Aucune ligne budgetaire.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {canManage && (
          <details className="border-t border-mf-border pt-3">
            <summary className="cursor-pointer text-sm font-medium text-mf-navy-700">+ Nouvelle ligne</summary>
            <form action={createBudgetLineAction} className="mt-3 grid grid-cols-2 gap-3">
              <input type="hidden" name="budget_id" value={budget.id} />
              <div>
                <label htmlFor="line-category" className="block text-xs font-medium text-mf-navy-900">Categorie</label>
                <input id="line-category" name="category" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
              </div>
              <div>
                <label htmlFor="line-planned_amount" className="block text-xs font-medium text-mf-navy-900">Montant planifie</label>
                <input
                  id="line-planned_amount"
                  type="number"
                  step="0.01"
                  min="0"
                  name="planned_amount"
                  required
                  className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label htmlFor="line-cost_center_id" className="block text-xs font-medium text-mf-navy-900">Centre de cout (optionnel)</label>
                <select id="line-cost_center_id" name="cost_center_id" className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm">
                  <option value="">—</option>
                  {(costCenters ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="line-currency" className="block text-xs font-medium text-mf-navy-900">Devise</label>
                <select id="line-currency" name="currency" className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm">
                  <option value="HTG">HTG</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <div className="col-span-2">
                <button
                  type="submit"
                  className="rounded-lg bg-mf-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-emerald-500"
                >
                  Ajouter la ligne
                </button>
              </div>
            </form>
          </details>
        )}
      </section>

      {canTransfer && (lines ?? []).length >= 2 && (
        <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-mf-navy-900">Transferer entre lignes</h2>
          <TransferForm budgetId={budget.id} lines={(lines ?? []).map((l) => ({ id: l.id, category: l.category }))} />
        </section>
      )}

      <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-mf-navy-900">Engagements actifs</h2>
        <ul className="space-y-1 text-sm">
          {(commitments ?? []).map((c) => {
            const line = (lines ?? []).find((l) => l.id === c.budget_line_id)
            return (
              <li key={c.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
                <span>
                  {line?.category ?? '—'} — {c.reference_type === 'expense_request' ? 'Depense' : c.reference_type}
                </span>
                <span className="font-medium text-amber-700">{formatMoney(c.amount)}</span>
              </li>
            )
          })}
          {(commitments ?? []).length === 0 && <p className="text-sm text-slate-400">Aucun engagement actif.</p>}
        </ul>
      </section>
    </div>
  )
}
