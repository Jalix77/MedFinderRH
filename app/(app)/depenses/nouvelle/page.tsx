import type { Metadata } from 'next'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { AccessDenied } from '@/components/shell/access-denied'
import { createExpenseRequestAction } from '@/app/actions/expenses'

export const metadata: Metadata = { title: 'Nouvelle demande — MedFinder Gestion' }

export default async function NewExpensePage() {
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />

  const canCreate = await hasPermission(orgId, 'expense.create')
  if (!canCreate) return <AccessDenied />

  const supabase = await createClient()
  const [{ data: budgetLines }, { data: categories }, { data: costCenters }] = await Promise.all([
    supabase
      .from('budget_lines')
      .select('id, category, planned_amount, currency, budgets ( name, status )')
      .order('category'),
    supabase.from('expense_categories').select('id, name').order('name'),
    supabase.from('cost_centers').select('id, code, name').order('code'),
  ])

  // Seules les lignes d'un budget approuve ont un sens operationnel — un
  // brouillon n'est pas encore un engagement possible.
  const approvedLines = (budgetLines ?? []).filter((l) => l.budgets?.status === 'approved')

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-xl font-bold text-mf-navy-900">Nouvelle demande de depense</h1>
        <p className="text-sm text-slate-500">
          La demande est creee en brouillon — vous devrez la soumettre explicitement depuis sa fiche.
        </p>
      </div>

      <form action={createExpenseRequestAction} className="space-y-4 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-mf-navy-900">Beneficiaire</label>
            <input
              name="payee_name"
              required
              placeholder="Nom du fournisseur / beneficiaire"
              className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-mf-navy-900">Reference (optionnel)</label>
            <input
              name="payee_reference"
              placeholder="Ex. numero de facture"
              className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-mf-navy-900">Montant</label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              name="amount"
              required
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
          <div>
            <label className="block text-xs font-medium text-mf-navy-900">Mode de paiement prevu</label>
            <select name="payment_method" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm">
              <option value="cash">Caisse</option>
              <option value="bank">Banque</option>
              <option value="mobile_money">Mobile money</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-mf-navy-900">Date</label>
            <input
              type="date"
              name="requested_date"
              defaultValue={new Date().toISOString().slice(0, 10)}
              className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-mf-navy-900">Ligne budgetaire</label>
            <select
              name="budget_line_id"
              required
              className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
            >
              <option value="">—</option>
              {approvedLines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.budgets?.name} — {l.category}
                </option>
              ))}
            </select>
            {approvedLines.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">
                Aucune ligne budgetaire approuvee disponible — contactez le comptable ou le budget.
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-mf-navy-900">Categorie (optionnel)</label>
            <select name="category_id" className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm">
              <option value="">—</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-mf-navy-900">Centre de cout (optionnel)</label>
            <select name="cost_center_id" className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm">
              <option value="">—</option>
              {(costCenters ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-mf-navy-900">Description (optionnel)</label>
            <textarea name="description" rows={3} className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
          </div>
        </div>
        <button
          type="submit"
          className="rounded-lg bg-mf-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-emerald-500"
        >
          Creer la demande (brouillon)
        </button>
      </form>
    </div>
  )
}
