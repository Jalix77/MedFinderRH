import type { Metadata } from 'next'
import Link from 'next/link'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { AccessDenied } from '@/components/shell/access-denied'
import { ThirdPartyForm } from '@/components/finance/third-party-form'
import { createThirdPartyAction } from '@/app/actions/invoicing'

export const metadata: Metadata = { title: 'Nouveau tiers — MedFinder Gestion' }

export default async function NouveauTiersPage() {
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />

  const [canCustomer, canSupplier] = await Promise.all([
    hasPermission(orgId, 'customer.manage'),
    hasPermission(orgId, 'supplier.manage'),
  ])
  if (!canCustomer && !canSupplier) return <AccessDenied />

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-mf-navy-900">Nouveau tiers</h1>
        <p className="text-sm text-slate-500">
          <Link href="/tiers" className="text-mf-navy-700 hover:underline">Retour a la liste</Link>
        </p>
      </div>

      <ThirdPartyForm
        action={createThirdPartyAction}
        submitLabel="Creer le tiers"
        canCustomer={canCustomer}
        canSupplier={canSupplier}
        initial={{
          legal_name: '',
          commercial_name: '',
          legal_form: '',
          tax_id: '',
          is_customer: canCustomer,
          is_supplier: false,
          email: '',
          phone: '',
          preferred_currency: 'HTG',
          payment_terms_days: '0',
          notes: '',
        }}
      />
    </div>
  )
}
