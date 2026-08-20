import type { Metadata } from 'next'
import Link from 'next/link'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { AccessDenied } from '@/components/shell/access-denied'
import { InvoiceForm } from '@/components/finance/invoice-form'
import { createInvoiceDraftAction } from '@/app/actions/invoicing'
import { loadInvoiceFormOptions } from '../form-options'

export const metadata: Metadata = { title: 'Nouveau document — MedFinder Gestion' }

export default async function NouvelleFacturePage() {
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />
  if (!(await hasPermission(orgId, 'invoice.manage'))) return <AccessDenied />

  const supabase = await createClient()
  const options = await loadInvoiceFormOptions(supabase)
  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-mf-navy-900">Nouveau document</h1>
        <p className="text-sm text-slate-500">
          Le document est cree en brouillon : aucun numero n&apos;est attribue et aucune ecriture comptable
          n&apos;est generee tant qu&apos;il n&apos;est pas emis.{' '}
          <Link href="/facturation" className="text-mf-navy-700 hover:underline">Retour a la liste</Link>
        </p>
      </div>

      <InvoiceForm
        action={createInvoiceDraftAction}
        submitLabel="Creer le brouillon"
        customers={options.customers}
        revenueAccounts={options.revenueAccounts}
        taxRates={options.taxRates}
        costCenters={options.costCenters}
        issuedInvoices={options.issuedInvoices}
        initial={{
          document_type: 'INVOICE',
          third_party_id: '',
          credited_invoice_id: '',
          credit_reason: '',
          document_date: today,
          due_date: today,
          currency: 'HTG',
          exchange_rate_to_htg: '1',
          external_reference: '',
          notes: '',
          cost_center_id: '',
          lines: [],
        }}
      />
    </div>
  )
}
