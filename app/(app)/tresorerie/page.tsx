import type { Metadata } from 'next'
import Link from 'next/link'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { AccessDenied } from '@/components/shell/access-denied'
import { MetricCard } from '@/components/finance/metric-card'
import { formatMoney } from '@/lib/format/money'
import {
  createCashAccountAction,
  createBankAccountAction,
  createMobileMoneyAccountAction,
  createChartOfAccountAction,
  setTreasuryAccountStatusAction,
} from '@/app/actions/treasury'

export const metadata: Metadata = { title: 'Tresorerie — MedFinder Gestion' }

type TreasuryAccount = {
  id: string
  name?: string
  bank_name?: string
  provider?: string
  account_number_masked?: string | null
  currency: string
  current_balance: number
  status: string
}

export default async function TreasuryPage() {
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />

  const [canView, canManage] = await Promise.all([
    hasPermission(orgId, 'treasury.manage'),
    hasPermission(orgId, 'accounting.view'),
  ])
  const canRead = canView || canManage
  if (!canRead) return <AccessDenied />

  const supabase = await createClient()
  const [{ data: cashAccounts }, { data: bankAccounts }, { data: mobileAccounts }, { data: glAccounts }] =
    await Promise.all([
      supabase.from('cash_accounts').select('id, name, currency, current_balance, status').order('name'),
      supabase
        .from('bank_accounts')
        .select('id, bank_name, account_number_masked, currency, current_balance, status')
        .order('bank_name'),
      supabase
        .from('mobile_money_accounts')
        .select('id, provider, account_number_masked, currency, current_balance, status')
        .order('provider'),
      supabase.from('chart_of_accounts').select('id, code, label').eq('is_active', true).order('code'),
    ])

  const allAccounts: TreasuryAccount[] = [
    ...(cashAccounts ?? []),
    ...(bankAccounts ?? []),
    ...(mobileAccounts ?? []),
  ]

  // Solde total de tresorerie par devise — libelle metier avant tout
  // decoupage technique par type de compte (regles UX Phase 1C-UI).
  const totalsByCurrency = new Map<string, number>()
  for (const a of allAccounts) {
    if (a.status !== 'active') continue
    totalsByCurrency.set(a.currency, (totalsByCurrency.get(a.currency) ?? 0) + Number(a.current_balance))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-mf-navy-900">Tresorerie</h1>
          <p className="text-sm text-slate-500">Caisses, comptes bancaires, mobile money.</p>
        </div>
        <Link href="/tresorerie/mouvements" className="text-sm font-medium text-mf-navy-700 hover:underline">
          Voir les mouvements →
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[...totalsByCurrency.entries()].map(([currency, total]) => (
          <MetricCard key={currency} label={`Tresorerie totale (${currency})`} value={formatMoney(total, currency)} />
        ))}
        {totalsByCurrency.size === 0 && <MetricCard label="Tresorerie totale" value={formatMoney(0)} />}
      </div>

      <AccountSection
        title="Caisses"
        accounts={(cashAccounts ?? []).map((a) => ({ ...a, table: 'cash_accounts' as const, displayName: a.name }))}
        canManage={canManage}
      >
        {canManage && (
          <CreateForm action={createCashAccountAction} glAccounts={glAccounts ?? []}>
            <TextField label="Nom de la caisse" name="name" required />
          </CreateForm>
        )}
      </AccountSection>

      <AccountSection
        title="Comptes bancaires"
        accounts={(bankAccounts ?? []).map((a) => ({
          ...a,
          table: 'bank_accounts' as const,
          displayName: `${a.bank_name}${a.account_number_masked ? ` — ${a.account_number_masked}` : ''}`,
        }))}
        canManage={canManage}
      >
        {canManage && (
          <CreateForm action={createBankAccountAction} glAccounts={glAccounts ?? []}>
            <TextField label="Nom de la banque" name="bank_name" required />
            <TextField label="Numero de compte (masque)" name="account_number_masked" />
          </CreateForm>
        )}
      </AccountSection>

      <AccountSection
        title="Mobile money"
        accounts={(mobileAccounts ?? []).map((a) => ({
          ...a,
          table: 'mobile_money_accounts' as const,
          displayName: `${a.provider}${a.account_number_masked ? ` — ${a.account_number_masked}` : ''}`,
        }))}
        canManage={canManage}
      >
        {canManage && (
          <CreateForm action={createMobileMoneyAccountAction} glAccounts={glAccounts ?? []}>
            <TextField label="Fournisseur (ex. MonCash)" name="provider" required />
            <TextField label="Numero de compte (masque)" name="account_number_masked" />
          </CreateForm>
        )}
      </AccountSection>

      {canManage && (
        <section className="rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-mf-navy-900">
              Configuration comptable (plan comptable — {(glAccounts ?? []).length} compte(s))
            </summary>
            <div className="mt-3 space-y-3">
              <ul className="grid grid-cols-2 gap-1 text-xs text-slate-500 sm:grid-cols-3">
                {(glAccounts ?? []).map((g) => (
                  <li key={g.id}>
                    {g.code} — {g.label}
                  </li>
                ))}
              </ul>
              <form action={createChartOfAccountAction} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <TextField label="Code" name="code" required />
                <TextField label="Libelle" name="label" required />
                <div>
                  <label className="block text-xs font-medium text-mf-navy-900">Type</label>
                  <select name="type" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm">
                    <option value="asset">Actif</option>
                    <option value="liability">Passif</option>
                    <option value="equity">Capitaux propres</option>
                    <option value="revenue">Produit</option>
                    <option value="expense">Charge</option>
                  </select>
                </div>
                <div className="flex items-end">
                  <button
                    type="submit"
                    className="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800"
                  >
                    Ajouter
                  </button>
                </div>
              </form>
            </div>
          </details>
        </section>
      )}
    </div>
  )

  function AccountSection({
    title,
    accounts,
    canManage,
    children,
  }: {
    title: string
    accounts: (TreasuryAccount & { table: 'cash_accounts' | 'bank_accounts' | 'mobile_money_accounts'; displayName?: string })[]
    canManage: boolean
    children?: React.ReactNode
  }) {
    return (
      <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-mf-navy-900">{title}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-1 pr-4">Compte</th>
                <th className="py-1 pr-4">Solde</th>
                <th className="py-1 pr-4">Statut</th>
                {canManage && <th className="py-1"></th>}
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-t border-mf-border">
                  <td className="py-2 pr-4 text-mf-navy-900">{a.displayName}</td>
                  <td className="py-2 pr-4 font-medium">{formatMoney(a.current_balance, a.currency)}</td>
                  <td className="py-2 pr-4">
                    <span className={a.status === 'active' ? 'text-mf-emerald-600' : 'text-slate-400'}>
                      {a.status === 'active' ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  {canManage && (
                    <td className="py-2 text-right">
                      <form action={setTreasuryAccountStatusAction}>
                        <input type="hidden" name="table" value={a.table} />
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="status" value={a.status === 'active' ? 'inactive' : 'active'} />
                        <button type="submit" className="text-xs font-medium text-mf-navy-700 hover:underline">
                          {a.status === 'active' ? 'Desactiver' : 'Reactiver'}
                        </button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
              {accounts.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-slate-400">
                    Aucun compte.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {children}
      </section>
    )
  }
}

function CreateForm({
  action,
  glAccounts,
  children,
}: {
  action: (formData: FormData) => Promise<void>
  glAccounts: { id: string; code: string; label: string }[]
  children: React.ReactNode
}) {
  return (
    <details className="border-t border-mf-border pt-3">
      <summary className="cursor-pointer text-sm font-medium text-mf-navy-700">+ Nouveau compte</summary>
      <form action={action} className="mt-3 grid grid-cols-2 gap-3">
        {children}
        <div>
          <label className="block text-xs font-medium text-mf-navy-900">Compte comptable (plan comptable)</label>
          <select name="gl_account_id" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm">
            <option value="">—</option>
            {glAccounts.map((g) => (
              <option key={g.id} value={g.id}>
                {g.code} — {g.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-mf-navy-900">Devise</label>
          <select name="currency" className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm">
            <option value="HTG">HTG</option>
            <option value="USD">USD</option>
          </select>
        </div>
        <div className="col-span-2">
          <button
            type="submit"
            className="rounded-lg bg-mf-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-emerald-500"
          >
            Creer le compte
          </button>
        </div>
      </form>
    </details>
  )
}

function TextField({ label, name, required }: { label: string; name: string; required?: boolean }) {
  return (
    <div>
      <label className="block text-xs font-medium text-mf-navy-900">{label}</label>
      <input
        name={name}
        required={required}
        className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
      />
    </div>
  )
}
