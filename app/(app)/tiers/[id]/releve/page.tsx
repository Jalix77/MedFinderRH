import type { Metadata } from 'next'
import Link from 'next/link'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { AccessDenied } from '@/components/shell/access-denied'
import { CsvExportButton } from '@/components/finance/csv-export-button'
import { formatMoney } from '@/lib/format/money'

export const metadata: Metadata = { title: 'Releve client — MedFinder Gestion' }

const MOVEMENT_LABELS: Record<string, string> = {
  INVOICE: 'Facture',
  CREDIT_NOTE: 'Avoir',
  PAYMENT: 'Encaissement',
}

type StatementLine = {
  movement_date: string
  reference: string
  movement_type: string
  external_reference: string
  currency: string
  debit: number
  credit: number
  amount_htg: number | null
  status: string
  due_date: string | null
}

type Statement = {
  success: boolean
  error?: string
  third_party?: { code: string; legal_name: string; tax_id: string | null; preferred_currency: string }
  period_start?: string
  period_end?: string
  opening_balance?: number
  lines?: StatementLine[]
  total_debit?: number
  total_credit?: number
  closing_balance?: number
}

function defaultRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), 0, 1)
  return { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) }
}

export default async function ReleveClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ du?: string; au?: string }>
}) {
  const { id } = await params
  const query = await searchParams
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />

  const [canView, canInvoice] = await Promise.all([
    hasPermission(orgId, 'accounting.view'),
    hasPermission(orgId, 'invoice.manage'),
  ])
  if (!canView && !canInvoice) return <AccessDenied />

  const range = defaultRange()
  const periodStart = query.du || range.start
  const periodEnd = query.au || range.end

  const supabase = await createClient()
  const { data } = await supabase.rpc('generate_customer_statement_report', {
    p_org_id: orgId,
    p_third_party_id: id,
    p_period_start: periodStart,
    p_period_end: periodEnd,
  })
  const report = (data ?? { success: false }) as Statement

  if (!report.success) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-mf-navy-900">Releve client</h1>
        <p className="rounded-2xl border border-mf-border bg-mf-surface p-4 text-sm text-slate-500 shadow-sm">
          {report.error === 'third_party_not_found'
            ? 'Ce tiers est introuvable ou inaccessible.'
            : report.error === 'invalid_period'
              ? 'La periode demandee est invalide.'
              : "Vous n'avez pas la permission necessaire pour consulter ce releve."}
        </p>
        <Link href="/tiers" className="text-sm text-mf-navy-700 hover:underline">Retour aux tiers</Link>
      </div>
    )
  }

  const currency = report.third_party?.preferred_currency ?? 'HTG'
  const lines = report.lines ?? []

  // Solde progressif, calcule a partir du solde d'ouverture retourne par
  // la RPC — jamais recalcule depuis les seuls mouvements de la periode.
  // `reduce` plutot qu'un accumulateur reassigne pendant le rendu :
  // un `let` mute au fil d'un map() est un effet de bord de rendu
  // (regle react-hooks/immutability).
  const openingBalance = Number(report.opening_balance ?? 0)
  const rows = lines.reduce<(StatementLine & { running: number })[]>((acc, l) => {
    const previous = acc.length > 0 ? acc[acc.length - 1].running : openingBalance
    acc.push({ ...l, running: previous + Number(l.debit) - Number(l.credit) })
    return acc
  }, [])

  const csvRows = rows.map((r) => ({
    Date: r.movement_date,
    Type: MOVEMENT_LABELS[r.movement_type] ?? r.movement_type,
    Reference: r.reference,
    Devise: r.currency,
    Debit: String(r.debit),
    Credit: String(r.credit),
    'Montant HTG': String(r.amount_htg ?? ''),
    'Solde progressif': String(r.running),
  }))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-mf-navy-900">
            Releve client — {report.third_party?.legal_name}
          </h1>
          <p className="text-sm text-slate-500">
            <span className="font-mono text-xs">{report.third_party?.code}</span>
            {report.third_party?.tax_id && <> — NIF {report.third_party.tax_id}</>}
            {' — '}
            <Link href={`/tiers/${id}`} className="text-mf-navy-700 hover:underline">Retour a la fiche</Link>
          </p>
        </div>
        <CsvExportButton rows={csvRows} filename={`releve-${report.third_party?.code}-${periodStart}-${periodEnd}.csv`} />
      </div>

      <form action={`/tiers/${id}/releve`} className="flex flex-wrap items-end gap-3 rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm">
        <div>
          <label htmlFor="du" className="block text-xs font-medium text-mf-navy-900">Du</label>
          <input id="du" type="date" name="du" defaultValue={periodStart}
            className="mt-1 rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="au" className="block text-xs font-medium text-mf-navy-900">Au</label>
          <input id="au" type="date" name="au" defaultValue={periodEnd}
            className="mt-1 rounded-lg border border-mf-border px-3 py-2 text-sm" />
        </div>
        <button type="submit"
          className="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800">
          Appliquer
        </button>
      </form>

      <section className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm">
          <p className="text-xs text-slate-400">Solde d&apos;ouverture</p>
          <p className="text-lg font-semibold text-mf-navy-900">
            {formatMoney(report.opening_balance ?? 0, currency)}
          </p>
        </div>
        <div className="rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm">
          <p className="text-xs text-slate-400">Total debit (factures)</p>
          <p className="text-lg font-semibold text-mf-navy-900">{formatMoney(report.total_debit ?? 0, currency)}</p>
        </div>
        <div className="rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm">
          <p className="text-xs text-slate-400">Total credit (avoirs + encaissements)</p>
          <p className="text-lg font-semibold text-mf-navy-900">{formatMoney(report.total_credit ?? 0, currency)}</p>
        </div>
        <div className="rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm">
          <p className="text-xs text-slate-400">Solde de cloture</p>
          <p className="text-lg font-semibold text-mf-navy-900">{formatMoney(report.closing_balance ?? 0, currency)}</p>
        </div>
      </section>

      <div className="overflow-x-auto rounded-2xl border border-mf-border bg-mf-surface shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Reference</th>
              <th className="px-3 py-2">Devise</th>
              <th className="px-3 py-2 text-right">Debit</th>
              <th className="px-3 py-2 text-right">Credit</th>
              <th className="px-3 py-2 text-right">Solde</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-mf-border bg-slate-50">
              <td className="px-3 py-2 text-xs" colSpan={6}>Solde d&apos;ouverture au {periodStart}</td>
              <td className="px-3 py-2 text-right font-medium">
                {formatMoney(report.opening_balance ?? 0, currency)}
              </td>
            </tr>
            {rows.map((r, i) => (
              <tr key={`${r.reference}-${i}`} className="border-t border-mf-border">
                <td className="px-3 py-2 text-xs">{r.movement_date}</td>
                <td className="px-3 py-2 text-xs">{MOVEMENT_LABELS[r.movement_type] ?? r.movement_type}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.reference}</td>
                <td className="px-3 py-2 text-xs">
                  {r.currency}
                  {r.currency !== 'HTG' && r.amount_htg != null && (
                    <div className="text-slate-400">{formatMoney(r.amount_htg, 'HTG')}</div>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {Number(r.debit) > 0 ? formatMoney(r.debit, r.currency) : '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  {Number(r.credit) > 0 ? formatMoney(r.credit, r.currency) : '—'}
                </td>
                <td className="px-3 py-2 text-right font-medium">{formatMoney(r.running, currency)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                  Aucun mouvement sur cette periode.
                </td>
              </tr>
            )}
            <tr className="border-t-2 border-mf-border bg-slate-50 font-semibold">
              <td className="px-3 py-2 text-xs" colSpan={4}>Solde de cloture au {periodEnd}</td>
              <td className="px-3 py-2 text-right">{formatMoney(report.total_debit ?? 0, currency)}</td>
              <td className="px-3 py-2 text-right">{formatMoney(report.total_credit ?? 0, currency)}</td>
              <td className="px-3 py-2 text-right">{formatMoney(report.closing_balance ?? 0, currency)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        Les factures sont portees au debit, les avoirs et encaissements au credit. Seuls les documents emis et
        les encaissements comptabilises sont pris en compte.
      </p>
    </div>
  )
}
