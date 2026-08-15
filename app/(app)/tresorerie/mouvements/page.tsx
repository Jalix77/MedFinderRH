import type { Metadata } from 'next'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { AccessDenied } from '@/components/shell/access-denied'
import { formatMoney } from '@/lib/format/money'

export const metadata: Metadata = { title: 'Mouvements de tresorerie — MedFinder Gestion' }

const REFERENCE_LABELS: Record<string, string> = {
  expense: 'Depense',
  grant: 'Financement PAPEJ',
  invoice: 'Facture',
  payroll: 'Paie',
  donation: 'Don',
  manual: 'Manuel',
}

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  cash: 'Caisse',
  bank: 'Banque',
  mobile_money: 'Mobile money',
}

export default async function TreasuryMovementsPage() {
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />

  const [canManage, canView] = await Promise.all([
    hasPermission(orgId, 'treasury.manage'),
    hasPermission(orgId, 'accounting.view'),
  ])
  if (!canManage && !canView) return <AccessDenied />

  const supabase = await createClient()
  const { data: movements } = await supabase
    .from('cash_movements')
    .select('id, treasury_account_type, direction, amount, currency, movement_date, reference_type, description, reconciled')
    .order('movement_date', { ascending: false })
    .limit(200)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-mf-navy-900">Mouvements de tresorerie</h1>
        <p className="text-sm text-slate-500">200 mouvements les plus recents, toutes tresoreries confondues.</p>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-mf-border bg-mf-surface shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Compte</th>
              <th className="px-4 py-2">Sens</th>
              <th className="px-4 py-2">Montant</th>
              <th className="px-4 py-2">Origine</th>
              <th className="px-4 py-2">Description</th>
            </tr>
          </thead>
          <tbody>
            {(movements ?? []).map((m) => (
              <tr key={m.id} className="border-t border-mf-border">
                <td className="px-4 py-2 text-slate-500">{m.movement_date}</td>
                <td className="px-4 py-2">{ACCOUNT_TYPE_LABELS[m.treasury_account_type] ?? m.treasury_account_type}</td>
                <td className="px-4 py-2">
                  <span className={m.direction === 'in' ? 'text-mf-emerald-600' : 'text-mf-danger'}>
                    {m.direction === 'in' ? 'Entree' : 'Sortie'}
                  </span>
                </td>
                <td className="px-4 py-2 font-medium text-mf-navy-900">{formatMoney(m.amount, m.currency)}</td>
                <td className="px-4 py-2">{REFERENCE_LABELS[m.reference_type] ?? m.reference_type}</td>
                <td className="px-4 py-2 text-slate-500">{m.description ?? '—'}</td>
              </tr>
            ))}
            {(movements ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Aucun mouvement de tresorerie pour le moment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
