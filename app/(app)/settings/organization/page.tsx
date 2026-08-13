import type { Metadata } from 'next'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { AccessDenied } from '@/components/shell/access-denied'
import { updateOrganizationSettingsAction } from '@/app/actions/rbac'

export const metadata: Metadata = { title: 'Organisation — MedFinder Gestion' }

export default async function OrganizationSettingsPage() {
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />

  const allowed = await hasPermission(orgId, 'settings.manage')
  if (!allowed) return <AccessDenied />

  const supabase = await createClient()
  const { data: org } = await supabase
    .from('organizations')
    .select('name, legal_name, tax_id, default_currency, fiscal_year_start_month, timezone')
    .eq('id', orgId)
    .single()

  if (!org) return <AccessDenied />

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-bold text-mf-navy-900">Parametres de l&apos;organisation</h1>

      <form
        action={updateOrganizationSettingsAction}
        className="space-y-4 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm"
      >
        <Field label="Nom" name="name" defaultValue={org.name} />
        <Field label="Raison sociale" name="legal_name" defaultValue={org.legal_name ?? ''} />
        <Field label="NIF" name="tax_id" defaultValue={org.tax_id ?? ''} />
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-mf-navy-900">Devise</label>
            <select
              name="default_currency"
              defaultValue={org.default_currency}
              className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
            >
              <option value="HTG">HTG</option>
              <option value="USD">USD</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-mf-navy-900">
              Debut exercice fiscal (mois)
            </label>
            <input
              type="number"
              name="fiscal_year_start_month"
              min={1}
              max={12}
              defaultValue={org.fiscal_year_start_month}
              className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
            />
          </div>
        </div>
        <Field label="Fuseau horaire" name="timezone" defaultValue={org.timezone} />

        <button
          type="submit"
          className="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800"
        >
          Enregistrer
        </button>
      </form>
    </div>
  )
}

function Field({
  label,
  name,
  defaultValue,
}: {
  label: string
  name: string
  defaultValue: string
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium text-mf-navy-900">
        {label}
      </label>
      <input
        id={name}
        name={name}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
      />
    </div>
  )
}
