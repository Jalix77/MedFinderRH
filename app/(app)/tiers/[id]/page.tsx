import type { Metadata } from 'next'
import Link from 'next/link'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { AccessDenied } from '@/components/shell/access-denied'
import { StatusBadge } from '@/components/finance/status-badge'
import { ActionForm } from '@/components/finance/action-form'
import { ThirdPartyForm } from '@/components/finance/third-party-form'
import { updateThirdPartyAction, setThirdPartyStatusAction } from '@/app/actions/invoicing'
import { formatMoney } from '@/lib/format/money'

export const metadata: Metadata = { title: 'Fiche tiers — MedFinder Gestion' }

export default async function FicheTiersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />

  const [canCustomer, canSupplier] = await Promise.all([
    hasPermission(orgId, 'customer.manage'),
    hasPermission(orgId, 'supplier.manage'),
  ])
  if (!canCustomer && !canSupplier) return <AccessDenied />

  const supabase = await createClient()
  // Aucun filtre organisationnel ici : la RLS l'impose deja et recroise
  // l'appartenance reelle de l'acteur — un id d'une autre organisation
  // ne renvoie simplement aucune ligne (anti-IDOR).
  const { data: tp } = await supabase.from('third_parties').select('*').eq('id', id).maybeSingle()
  if (!tp) return <AccessDenied />

  const [{ data: documents }, { data: expenses }] = await Promise.all([
    supabase
      .from('invoices')
      .select('id, document_type, document_number, status, document_date, due_date, currency, total, amount_paid, balance_due')
      .eq('third_party_id', id)
      .order('document_date', { ascending: false })
      .limit(50),
    supabase
      .from('expense_requests')
      .select('id, expense_number, payee_name, amount, currency, status, requested_date')
      .eq('supplier_id', id)
      .order('requested_date', { ascending: false })
      .limit(50),
  ])

  const issued = (documents ?? []).filter((d) => ['issued', 'partially_paid', 'paid'].includes(d.status))
  const encours = issued.reduce((s, d) => s + Number(d.balance_due ?? 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-mf-navy-900">{tp.legal_name}</h1>
          <p className="text-sm text-slate-500">
            <span className="font-mono text-xs">{tp.third_party_code}</span>
            {' — '}
            {[tp.is_customer ? 'Client' : null, tp.is_supplier ? 'Fournisseur' : null].filter(Boolean).join(' + ')}
            {' — '}
            <Link href="/tiers" className="text-mf-navy-700 hover:underline">Retour a la liste</Link>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={tp.is_active ? 'active' : 'inactive'} />
          <ActionForm
            action={setThirdPartyStatusAction}
            hiddenFields={{ id, is_active: tp.is_active ? 'false' : 'true' }}
            submitLabel={tp.is_active ? 'Desactiver' : 'Reactiver'}
            buttonClassName="rounded-lg border border-mf-border px-3 py-1.5 text-xs font-semibold text-mf-navy-700 hover:bg-slate-50"
          />
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm">
          <p className="text-xs text-slate-400">Encours client (documents emis)</p>
          <p className="text-lg font-semibold text-mf-navy-900">{formatMoney(encours, tp.preferred_currency)}</p>
        </div>
        <div className="rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm">
          <p className="text-xs text-slate-400">Documents de facturation</p>
          <p className="text-lg font-semibold text-mf-navy-900">{(documents ?? []).length}</p>
        </div>
        <div className="rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm">
          <p className="text-xs text-slate-400">Depenses rattachees</p>
          <p className="text-lg font-semibold text-mf-navy-900">{(expenses ?? []).length}</p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-mf-navy-900">Modifier la fiche</h2>
        <ThirdPartyForm
          action={updateThirdPartyAction}
          submitLabel="Enregistrer"
          canCustomer={canCustomer}
          canSupplier={canSupplier}
          initial={{
            id,
            legal_name: tp.legal_name,
            commercial_name: tp.commercial_name ?? '',
            legal_form: tp.legal_form ?? '',
            tax_id: tp.tax_id ?? '',
            is_customer: tp.is_customer,
            is_supplier: tp.is_supplier,
            email: tp.email ?? '',
            phone: tp.phone ?? '',
            preferred_currency: tp.preferred_currency === 'USD' ? 'USD' : 'HTG',
            payment_terms_days: String(tp.payment_terms_days ?? 0),
            notes: tp.notes ?? '',
          }}
        />
      </section>

      {(documents ?? []).length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-mf-navy-900">Factures et avoirs</h2>
          <div className="overflow-x-auto rounded-2xl border border-mf-border bg-mf-surface shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2">Numero</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">Restant</th>
                  <th className="px-3 py-2">Statut</th>
                </tr>
              </thead>
              <tbody>
                {(documents ?? []).map((d) => (
                  <tr key={d.id} className="border-t border-mf-border hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <Link href={`/facturation/${d.id}`} className="font-medium text-mf-navy-700 hover:underline">
                        {d.document_number ?? '(brouillon)'}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs">{d.document_type === 'CREDIT_NOTE' ? 'Avoir' : 'Facture'}</td>
                    <td className="px-3 py-2 text-xs">{d.document_date}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(d.total, d.currency)}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(d.balance_due ?? 0, d.currency)}</td>
                    <td className="px-3 py-2"><StatusBadge status={d.status} domain="invoice" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(expenses ?? []).length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-mf-navy-900">Depenses rattachees a ce fournisseur</h2>
          <p className="text-xs text-slate-400">
            Le beneficiaire enregistre au moment de la depense est conserve tel quel (photo historique).
          </p>
          <div className="overflow-x-auto rounded-2xl border border-mf-border bg-mf-surface shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2">Numero</th>
                  <th className="px-3 py-2">Beneficiaire (historique)</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2 text-right">Montant</th>
                  <th className="px-3 py-2">Statut</th>
                </tr>
              </thead>
              <tbody>
                {(expenses ?? []).map((e) => (
                  <tr key={e.id} className="border-t border-mf-border hover:bg-slate-50">
                    <td className="px-3 py-2">
                      <Link href={`/depenses/${e.id}`} className="font-medium text-mf-navy-700 hover:underline">
                        {e.expense_number}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs">{e.payee_name}</td>
                    <td className="px-3 py-2 text-xs">{e.requested_date}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(e.amount, e.currency)}</td>
                    <td className="px-3 py-2"><StatusBadge status={e.status} domain="expense" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
