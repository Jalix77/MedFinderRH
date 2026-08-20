import type { Metadata } from 'next'
import Link from 'next/link'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { AccessDenied } from '@/components/shell/access-denied'
import { InvoiceForm } from '@/components/finance/invoice-form'
import { updateInvoiceDraftAction } from '@/app/actions/invoicing'
import { loadInvoiceFormOptions } from '../../form-options'

export const metadata: Metadata = { title: 'Modifier le document — MedFinder Gestion' }

export default async function ModifierFacturePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />
  if (!(await hasPermission(orgId, 'invoice.manage'))) return <AccessDenied />

  const supabase = await createClient()
  const { data: doc } = await supabase.from('invoices').select('*').eq('id', id).maybeSingle()
  if (!doc) return <AccessDenied />

  // Un document emis n'est jamais modifiable — la base le refuse de toute
  // facon (trigger d'immutabilite) ; l'ecran ne fait que l'expliquer.
  if (!['draft', 'pending_issue'].includes(doc.status)) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-mf-navy-900">Modification impossible</h1>
        <p className="text-sm text-slate-500">
          Ce document est {doc.status === 'cancelled' ? 'annule' : 'emis'} : son contenu financier est definitivement
          fige. Une correction passe par un avoir ou une annulation motivee.
        </p>
        <Link href={`/facturation/${id}`} className="text-sm text-mf-navy-700 hover:underline">
          Retour au document
        </Link>
      </div>
    )
  }

  const [options, { data: lines }] = await Promise.all([
    loadInvoiceFormOptions(supabase),
    supabase
      .from('invoice_lines')
      .select('description, quantity, unit_price, revenue_account_id, tax_rate_id')
      .eq('invoice_id', id)
      .order('line_number'),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-mf-navy-900">Modifier le brouillon</h1>
        <p className="text-sm text-slate-500">
          <Link href={`/facturation/${id}`} className="text-mf-navy-700 hover:underline">Retour au document</Link>
        </p>
      </div>

      <InvoiceForm
        action={updateInvoiceDraftAction}
        submitLabel="Enregistrer le brouillon"
        customers={options.customers}
        revenueAccounts={options.revenueAccounts}
        taxRates={options.taxRates}
        costCenters={options.costCenters}
        issuedInvoices={options.issuedInvoices}
        initial={{
          id,
          document_type: doc.document_type === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : 'INVOICE',
          third_party_id: doc.third_party_id,
          credited_invoice_id: doc.credited_invoice_id ?? '',
          credit_reason: doc.credit_reason ?? '',
          document_date: doc.document_date,
          due_date: doc.due_date,
          currency: doc.currency === 'USD' ? 'USD' : 'HTG',
          exchange_rate_to_htg: String(doc.exchange_rate_to_htg),
          external_reference: doc.external_reference ?? '',
          notes: doc.notes ?? '',
          cost_center_id: doc.cost_center_id ?? '',
          lines: (lines ?? []).map((l) => ({
            description: l.description,
            quantity: String(l.quantity),
            unit_price: String(l.unit_price),
            revenue_account_id: l.revenue_account_id,
            tax_rate_id: l.tax_rate_id ?? '',
          })),
        }}
      />
    </div>
  )
}
