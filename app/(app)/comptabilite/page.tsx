import type { Metadata } from 'next'
import Link from 'next/link'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { AccessDenied } from '@/components/shell/access-denied'
import { StatusBadge } from '@/components/finance/status-badge'
import { ManualEntryForm } from '@/components/finance/manual-entry-form'
import { createFiscalYearAction } from '@/app/actions/budget'
import { createChartOfAccountAction } from '@/app/actions/treasury'
import {
  createJournalAction,
  createAccountingPeriodAction,
  closeAccountingPeriodAction,
  setChartOfAccountStatusAction,
} from '@/app/actions/accounting'

export const metadata: Metadata = { title: 'Comptabilite — MedFinder Gestion' }

const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  asset: 'Actif',
  liability: 'Passif',
  equity: 'Capitaux propres',
  revenue: 'Revenu',
  expense: 'Charge',
}

export default async function ComptabilitePage() {
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />

  const canView = await hasPermission(orgId, 'accounting.view')
  if (!canView) return <AccessDenied />
  const canPost = await hasPermission(orgId, 'accounting.post')
  const canClosePeriod = await hasPermission(orgId, 'accounting.close_period')

  const supabase = await createClient()
  const [{ data: accounts }, { data: journals }, { data: fiscalYears }, { data: periods }, { data: entries }] =
    await Promise.all([
      supabase.from('chart_of_accounts').select('id, code, label, type, is_active').order('code'),
      supabase.from('journals').select('id, code, label').order('code'),
      supabase.from('fiscal_years').select('id, label, start_date, end_date, status').order('start_date', { ascending: false }),
      supabase
        .from('accounting_periods')
        .select('id, month, status, fiscal_years ( label )')
        .order('month', { ascending: false }),
      supabase
        .from('journal_entries')
        .select('id, entry_number, entry_date, description, status, source_type, journals ( code )')
        .order('created_at', { ascending: false })
        .limit(50),
    ])

  const activeAccounts = (accounts ?? []).filter((a) => a.is_active)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-mf-navy-900">Comptabilite</h1>
          <p className="text-sm text-slate-500">
            Plan comptable, journaux, exercices/periodes, ecritures (automatiques et manuelles).
          </p>
        </div>
        <Link href="/comptabilite/rapports" className="rounded-lg border border-mf-border px-4 py-2 text-sm font-semibold text-mf-navy-700 hover:bg-slate-50">
          Etats financiers
        </Link>
      </div>

      {/* --- Ecritures --- */}
      <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-mf-navy-900">Ecritures recentes</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="py-1 pr-4">Numero</th>
                <th className="py-1 pr-4">Date</th>
                <th className="py-1 pr-4">Journal</th>
                <th className="py-1 pr-4">Description</th>
                <th className="py-1 pr-4">Origine</th>
                <th className="py-1 pr-4">Statut</th>
              </tr>
            </thead>
            <tbody>
              {(entries ?? []).map((e) => (
                <tr key={e.id} className="border-t border-mf-border">
                  <td className="py-2 pr-4">
                    <Link href={`/comptabilite/${e.id}`} className="font-medium text-mf-navy-700 hover:underline">
                      {e.entry_number}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-slate-500">{e.entry_date}</td>
                  <td className="py-2 pr-4 text-slate-500">{e.journals?.code ?? '—'}</td>
                  <td className="py-2 pr-4 text-slate-500">{e.description ?? '—'}</td>
                  <td className="py-2 pr-4 text-slate-500">{e.source_type === 'manual' ? 'Manuelle' : 'Automatique'}</td>
                  <td className="py-2 pr-4">
                    <StatusBadge status={e.status} domain="journal_entry" />
                  </td>
                </tr>
              ))}
              {(entries ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-slate-400">
                    Aucune ecriture.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {canPost && (
          <details className="border-t border-mf-border pt-3">
            <summary className="cursor-pointer text-sm font-medium text-mf-navy-700">
              + Nouvelle ecriture manuelle
            </summary>
            <div className="mt-3">
              <ManualEntryForm
                journals={journals ?? []}
                accounts={activeAccounts.map((a) => ({ id: a.id, code: a.code, label: a.label }))}
              />
            </div>
          </details>
        )}
      </section>

      {/* --- Plan comptable --- */}
      <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-mf-navy-900">
            Plan comptable ({(accounts ?? []).length})
          </summary>
          <div className="mt-3 space-y-3">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="py-1 pr-4">Code</th>
                    <th className="py-1 pr-4">Libelle</th>
                    <th className="py-1 pr-4">Type</th>
                    <th className="py-1 pr-4">Statut</th>
                    {canPost && <th className="py-1 pr-4" />}
                  </tr>
                </thead>
                <tbody>
                  {(accounts ?? []).map((a) => (
                    <tr key={a.id} className="border-t border-mf-border">
                      <td className="py-2 pr-4 font-mono text-xs">{a.code}</td>
                      <td className="py-2 pr-4">{a.label}</td>
                      <td className="py-2 pr-4 text-slate-500">{ACCOUNT_TYPE_LABELS[a.type] ?? a.type}</td>
                      <td className="py-2 pr-4">
                        <StatusBadge status={a.is_active ? 'active' : 'inactive'} />
                      </td>
                      {canPost && (
                        <td className="py-2 pr-4">
                          <form action={setChartOfAccountStatusAction}>
                            <input type="hidden" name="id" value={a.id} />
                            <input type="hidden" name="is_active" value={(!a.is_active).toString()} />
                            <button type="submit" className="text-xs font-medium text-mf-navy-700 hover:underline">
                              {a.is_active ? 'Desactiver' : 'Reactiver'}
                            </button>
                          </form>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {canPost && (
              <form action={createChartOfAccountAction} className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="coa-code" className="block text-xs font-medium text-mf-navy-900">Code</label>
                  <input id="coa-code" name="code" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
                </div>
                <div>
                  <label htmlFor="coa-label" className="block text-xs font-medium text-mf-navy-900">Libelle</label>
                  <input id="coa-label" name="label" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
                </div>
                <div>
                  <label htmlFor="coa-type" className="block text-xs font-medium text-mf-navy-900">Type</label>
                  <select id="coa-type" name="type" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm">
                    {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-3">
                  <button type="submit" className="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800">
                    Creer le compte
                  </button>
                </div>
              </form>
            )}
          </div>
        </details>
      </section>

      {/* --- Journaux --- */}
      <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-mf-navy-900">
            Journaux ({(journals ?? []).length})
          </summary>
          <div className="mt-3 space-y-3">
            <ul className="space-y-1 text-sm text-slate-500">
              {(journals ?? []).map((j) => (
                <li key={j.id}>
                  {j.code} — {j.label}
                </li>
              ))}
            </ul>
            {canPost && (
              <form action={createJournalAction} className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="j-code" className="block text-xs font-medium text-mf-navy-900">Code</label>
                  <input id="j-code" name="code" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
                </div>
                <div>
                  <label htmlFor="j-label" className="block text-xs font-medium text-mf-navy-900">Libelle</label>
                  <input id="j-label" name="label" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
                </div>
                <div className="col-span-3">
                  <button type="submit" className="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800">
                    Creer le journal
                  </button>
                </div>
              </form>
            )}
          </div>
        </details>
      </section>

      {/* --- Exercices et periodes --- */}
      <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-mf-navy-900">
            Exercices et periodes comptables
          </summary>
          <div className="mt-3 space-y-4">
            <div>
              <p className="text-xs font-medium text-mf-navy-900">Exercices</p>
              <ul className="mt-1 space-y-1 text-sm text-slate-500">
                {(fiscalYears ?? []).map((f) => (
                  <li key={f.id}>
                    {f.label} — {f.start_date} → {f.end_date} ({f.status === 'open' ? 'ouvert' : 'ferme'})
                  </li>
                ))}
              </ul>
              {canPost && (
                <form action={createFiscalYearAction} className="mt-2 grid grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="fy-label" className="block text-xs font-medium text-mf-navy-900">Libelle</label>
                    <input id="fy-label" name="label" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label htmlFor="fy-start_date" className="block text-xs font-medium text-mf-navy-900">Debut</label>
                    <input id="fy-start_date" type="date" name="start_date" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label htmlFor="fy-end_date" className="block text-xs font-medium text-mf-navy-900">Fin</label>
                    <input id="fy-end_date" type="date" name="end_date" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
                  </div>
                  <div className="col-span-3">
                    <button type="submit" className="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800">
                      Creer l&apos;exercice
                    </button>
                  </div>
                </form>
              )}
            </div>

            <div>
              <p className="text-xs font-medium text-mf-navy-900">Periodes mensuelles</p>
              <ul className="mt-1 space-y-1 text-sm text-slate-500">
                {(periods ?? []).map((p) => (
                  <li key={p.id} className="flex items-center gap-2">
                    <span>
                      {p.fiscal_years?.label ?? '—'} — mois {p.month} ({p.status === 'open' ? 'ouverte' : 'fermee'})
                    </span>
                    {canClosePeriod && p.status === 'open' && (
                      <form action={closeAccountingPeriodAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <button type="submit" className="text-xs font-medium text-mf-danger hover:underline">
                          Cloturer
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
              {canPost && (
                <form action={createAccountingPeriodAction} className="mt-2 grid grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="ap-fiscal_year_id" className="block text-xs font-medium text-mf-navy-900">Exercice</label>
                    <select id="ap-fiscal_year_id" name="fiscal_year_id" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm">
                      <option value="">—</option>
                      {(fiscalYears ?? []).map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="ap-month" className="block text-xs font-medium text-mf-navy-900">Mois (1-12)</label>
                    <input id="ap-month" type="number" min="1" max="12" name="month" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
                  </div>
                  <div className="col-span-3">
                    <button type="submit" className="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800">
                      Creer la periode
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </details>
      </section>
    </div>
  )
}
