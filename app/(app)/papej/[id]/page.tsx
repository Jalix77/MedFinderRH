import type { Metadata } from 'next'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { AccessDenied } from '@/components/shell/access-denied'
import { MetricCard } from '@/components/finance/metric-card'
import { formatMoney } from '@/lib/format/money'
import { createGrantBudgetLineAction, recordGrantReceiptAction } from '@/app/actions/papej'
import { PapejReportGenerator } from '@/components/finance/papej-report'
import { ActionForm } from '@/components/finance/action-form'

export const metadata: Metadata = { title: 'PAPEJ — MedFinder Gestion' }

type PageProps = { params: Promise<{ id: string }> }

export default async function GrantDetailPage({ params }: PageProps) {
  const { id } = await params
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />

  const canView = await hasPermission(orgId, 'papej.view')
  if (!canView) return <AccessDenied />
  const [canManage, canReport] = await Promise.all([
    hasPermission(orgId, 'papej.manage'),
    hasPermission(orgId, 'papej.report'),
  ])

  const supabase = await createClient()
  const { data: grant } = await supabase
    .from('grants')
    .select('id, name, donor_name, amount_granted, amount_received, currency, status, received_date')
    .eq('id', id)
    .maybeSingle()
  if (!grant) return <AccessDenied />

  const [{ data: rawGrantLines }, { data: cashAccounts }, { data: bankAccounts }, { data: mobileAccounts }] =
    await Promise.all([
      supabase
        .from('grant_budget_lines')
        .select('id, category, notes, budget_line_id')
        .eq('grant_id', id)
        .order('category'),
      supabase.from('cash_accounts').select('id, name').eq('status', 'active'),
      supabase.from('bank_accounts').select('id, bank_name').eq('status', 'active'),
      supabase.from('mobile_money_accounts').select('id, provider').eq('status', 'active'),
    ])

  const lineIds = (rawGrantLines ?? []).map((l) => l.budget_line_id).filter(Boolean) as string[]
  // budget_line_balances est une vue sans FK reelle vers budget_lines —
  // PostgREST ne peut pas l'embarquer via select=...,budget_lines(budget_line_balances(...))
  // (meme trouvaille que app/(app)/budget/[id]/page.tsx, PGRST200 "no
  // relationship found" silencieusement ignore faute de verifier `error`).
  // Corrige par une requete separee, jointe cote application.
  const [{ data: balancesRows }, { data: missingJustifications }] =
    lineIds.length > 0
      ? await Promise.all([
          supabase
            .from('budget_line_balances')
            .select('budget_line_id, planned_amount, committed_open, available_amount')
            .in('budget_line_id', lineIds),
          supabase
            .from('expense_requests')
            .select('id, expense_number, payee_name, amount, currency')
            .in('budget_line_id', lineIds)
            .eq('status', 'paid'),
        ])
      : [{ data: [] }, { data: [] }]

  const balanceByLineId = new Map((balancesRows ?? []).map((b) => [b.budget_line_id, b]))
  const grantLines = (rawGrantLines ?? []).map((l) => ({
    ...l,
    balance: l.budget_line_id ? (balanceByLineId.get(l.budget_line_id) ?? null) : null,
  }))

  const totalAvailable = grantLines.reduce((sum, l) => sum + Number(l.balance?.available_amount ?? 0), 0)
  const totalCommitted = grantLines.reduce((sum, l) => sum + Number(l.balance?.committed_open ?? 0), 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-mf-navy-900">{grant.name}</h1>
        <p className="text-sm text-slate-500">{grant.donor_name ?? 'Bailleur non renseigne'}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <MetricCard label="Accorde" value={formatMoney(grant.amount_granted, grant.currency)} />
        <MetricCard label="Recu" value={formatMoney(grant.amount_received, grant.currency)} tone="success" />
        <MetricCard label="Engage" value={formatMoney(totalCommitted, grant.currency)} tone="warning" />
        <MetricCard label="Disponible" value={formatMoney(totalAvailable, grant.currency)} tone="success" />
        <MetricCard
          label="Justificatifs manquants"
          value={String((missingJustifications ?? []).length)}
          tone={(missingJustifications ?? []).length > 0 ? 'danger' : 'default'}
        />
      </div>

      <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-mf-navy-900">Lignes budgetaires PAPEJ</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-1 pr-4">Categorie</th>
                <th className="py-1 pr-4">Prevu</th>
                <th className="py-1 pr-4">Engage</th>
                <th className="py-1 pr-4">Disponible</th>
              </tr>
            </thead>
            <tbody>
              {grantLines.map((l) => {
                const b = l.balance
                return (
                  <tr key={l.id} className="border-t border-mf-border">
                    <td className="py-2 pr-4 text-mf-navy-900">{l.category}</td>
                    <td className="py-2 pr-4">{formatMoney(b?.planned_amount ?? 0, grant.currency)}</td>
                    <td className="py-2 pr-4 text-amber-700">{formatMoney(b?.committed_open ?? 0, grant.currency)}</td>
                    <td className="py-2 pr-4 font-medium text-mf-emerald-700">
                      {formatMoney(b?.available_amount ?? 0, grant.currency)}
                    </td>
                  </tr>
                )
              })}
              {grantLines.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-slate-400">
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
            <form action={createGrantBudgetLineAction} className="mt-3 grid grid-cols-2 gap-3">
              <input type="hidden" name="grant_id" value={grant.id} />
              <div>
                <label htmlFor="grant_line_category" className="block text-xs font-medium text-mf-navy-900">Categorie</label>
                <input id="grant_line_category" name="category" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
              </div>
              <div>
                <label htmlFor="grant_line_planned_amount" className="block text-xs font-medium text-mf-navy-900">Montant planifie</label>
                <input
                  id="grant_line_planned_amount"
                  type="number"
                  step="0.01"
                  min="0"
                  name="planned_amount"
                  required
                  className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
                />
              </div>
              <div className="col-span-2">
                <label htmlFor="grant_line_notes" className="block text-xs font-medium text-mf-navy-900">Notes (optionnel)</label>
                <input id="grant_line_notes" name="notes" className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
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

      {canManage && (
        <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-mf-navy-900">Enregistrer une reception de financement</h2>
          <ActionForm
            action={recordGrantReceiptAction}
            hiddenFields={{ grant_id: grant.id }}
            submitLabel="Enregistrer la reception"
            pendingLabel="Enregistrement..."
            className="grid grid-cols-2 gap-3 sm:grid-cols-4"
            buttonClassName="col-span-2 rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800 disabled:opacity-60 sm:col-span-4"
            onSuccessMessage="Reception enregistree."
          >
            <div>
              <label htmlFor="receipt_amount" className="block text-xs font-medium text-mf-navy-900">Montant recu</label>
              <input id="receipt_amount" type="number" step="0.01" min="0.01" name="amount" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="receipt_date" className="block text-xs font-medium text-mf-navy-900">Date de reception</label>
              <input id="receipt_date" type="date" name="received_date" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
            </div>
            <div>
              <label htmlFor="receipt_account_type" className="block text-xs font-medium text-mf-navy-900">Type de compte</label>
              <select id="receipt_account_type" name="treasury_account_type" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm">
                <option value="cash">Caisse</option>
                <option value="bank">Banque</option>
                <option value="mobile_money">Mobile money</option>
              </select>
            </div>
            <div>
              <label htmlFor="receipt_account_id" className="block text-xs font-medium text-mf-navy-900">Compte</label>
              <select id="receipt_account_id" name="treasury_account_id" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm">
                <option value="">—</option>
                <optgroup label="Caisses">
                  {(cashAccounts ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Banques">
                  {(bankAccounts ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.bank_name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Mobile money">
                  {(mobileAccounts ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.provider}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
          </ActionForm>
        </section>
      )}

      {(missingJustifications ?? []).length > 0 && (
        <section className="space-y-2 rounded-2xl border border-amber-300 bg-amber-50 p-6">
          <h2 className="text-sm font-semibold text-amber-800">Justificatifs manquants</h2>
          <ul className="space-y-1 text-sm text-amber-800">
            {(missingJustifications ?? []).map((e) => (
              <li key={e.id}>
                {e.expense_number} — {e.payee_name} — {formatMoney(e.amount, e.currency)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {canReport && (
        <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-mf-navy-900">Rapport PAPEJ</h2>
          <PapejReportGenerator grantId={grant.id} />
        </section>
      )}
    </div>
  )
}
