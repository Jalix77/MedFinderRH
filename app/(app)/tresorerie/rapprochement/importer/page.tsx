import type { Metadata } from 'next'
import Link from 'next/link'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { AccessDenied } from '@/components/shell/access-denied'
import { StatementImportForm } from '@/components/finance/statement-import-form'
import { importBankStatementAction } from '@/app/actions/reconciliation'

export const metadata: Metadata = { title: 'Importer un releve — MedFinder Gestion' }

export default async function ImporterRelevePage() {
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />

  const [canReconcile, canManage] = await Promise.all([
    hasPermission(orgId, 'treasury.reconcile'),
    hasPermission(orgId, 'treasury.manage'),
  ])
  if (!canReconcile && !canManage) return <AccessDenied />

  const supabase = await createClient()
  const [{ data: cash }, { data: bank }, { data: mobile }] = await Promise.all([
    supabase.from('cash_accounts').select('id, name, currency, status').eq('status', 'active').order('name'),
    supabase.from('bank_accounts').select('id, bank_name, account_number_masked, currency, status')
      .eq('status', 'active').order('bank_name'),
    supabase.from('mobile_money_accounts').select('id, provider, account_number_masked, currency, status')
      .eq('status', 'active').order('provider'),
  ])

  const treasuryAccounts = [
    ...(cash ?? []).map((a) => ({ value: `cash:${a.id}`, label: `Caisse — ${a.name}`, currency: a.currency })),
    ...(bank ?? []).map((a) => ({
      value: `bank:${a.id}`,
      label: `Banque — ${a.bank_name}${a.account_number_masked ? ` (${a.account_number_masked})` : ''}`,
      currency: a.currency,
    })),
    ...(mobile ?? []).map((a) => ({
      value: `mobile_money:${a.id}`,
      label: `Mobile money — ${a.provider}${a.account_number_masked ? ` (${a.account_number_masked})` : ''}`,
      currency: a.currency,
    })),
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-mf-navy-900">Importer un releve</h1>
        <p className="text-sm text-slate-500">
          Le fichier est normalise dans le navigateur puis envoye ligne par ligne : aucun fichier brut
          n&apos;est stocke. Un contenu deja importe sur le meme compte est refuse.{' '}
          <Link href="/tresorerie/rapprochement" className="text-mf-navy-700 hover:underline">
            Retour aux releves
          </Link>
        </p>
      </div>

      {treasuryAccounts.length === 0 ? (
        <p className="rounded-2xl border border-mf-border bg-mf-surface p-4 text-sm text-slate-400 shadow-sm">
          Aucun compte de tresorerie actif — creez-en un depuis la Tresorerie avant d&apos;importer un releve.
        </p>
      ) : (
        <StatementImportForm action={importBankStatementAction} treasuryAccounts={treasuryAccounts} />
      )}
    </div>
  )
}
