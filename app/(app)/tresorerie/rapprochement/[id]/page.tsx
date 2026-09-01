import type { Metadata } from 'next'
import Link from 'next/link'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { AccessDenied } from '@/components/shell/access-denied'
import { ActionForm } from '@/components/finance/action-form'
import { CsvExportButton } from '@/components/finance/csv-export-button'
import { ManualMatchForm } from '@/components/finance/manual-match-form'
import { formatMoney } from '@/lib/format/money'
import {
  proposeBankReconciliationAction,
  validateBankMatchAction,
  rejectBankMatchAction,
  cancelBankStatementImportAction,
  createManualBankMatchAction,
} from '@/app/actions/reconciliation'

export const metadata: Metadata = { title: 'Rapprochement — MedFinder Gestion' }

const LINE_STATUS_LABELS: Record<string, string> = {
  unreconciled: 'Non rapproche',
  proposed: 'Propose',
  reconciled: 'Rapproche',
  discrepancy: 'Ecart',
  ignored: 'Ignore',
}

const LINE_STATUS_CLASS: Record<string, string> = {
  unreconciled: 'bg-slate-100 text-slate-600',
  proposed: 'bg-amber-50 text-amber-700',
  reconciled: 'bg-mf-emerald-50 text-mf-emerald-700',
  discrepancy: 'bg-red-50 text-mf-danger',
  ignored: 'bg-slate-100 text-slate-400',
}

type ReportLine = {
  id: string
  line_number: number
  value_date: string
  label: string
  direction: string
  amount: number
  status: string
  external_reference: string | null
}

type ReportMovement = {
  id: string
  movement_date: string
  direction: string
  amount: number
  description: string | null
  reference_type: string
}

type Report = {
  success: boolean
  error?: string
  statement_reference?: string
  currency?: string
  period_start?: string
  period_end?: string
  book_opening_balance?: number
  book_total_in?: number
  book_total_out?: number
  book_closing_balance?: number
  statement_opening_balance?: number
  statement_total_in?: number
  statement_total_out?: number
  statement_closing_balance?: number
  difference?: number
  reconciled_lines?: number
  total_lines?: number
  unreconciled_statement_lines?: ReportLine[]
  unmatched_cash_movements?: ReportMovement[]
}

export default async function RapprochementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />

  const [canReconcile, canManage, canView] = await Promise.all([
    hasPermission(orgId, 'treasury.reconcile'),
    hasPermission(orgId, 'treasury.manage'),
    hasPermission(orgId, 'accounting.view'),
  ])
  if (!canReconcile && !canManage && !canView) return <AccessDenied />

  const supabase = await createClient()
  // Anti-IDOR : la RLS ne renvoie rien pour un import d'une autre
  // organisation — aucun filtre organisationnel n'est reecrit ici.
  const { data: imp } = await supabase
    .from('bank_statement_imports')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (!imp) return <AccessDenied />

  const [{ data: reportData }, { data: lines }, { data: matches }] = await Promise.all([
    supabase.rpc('generate_bank_reconciliation_report', { p_import_id: id }),
    supabase
      .from('bank_statement_lines')
      .select('id, line_number, value_date, label, external_reference, direction, amount, currency, status')
      .eq('import_id', id)
      .order('line_number'),
    supabase
      .from('bank_reconciliation_matches')
      .select('id, statement_line_id, cash_movement_id, match_type, status, amount_difference, date_difference_days, notes, proposed_by, validated_by, rejection_reason')
      .eq('organization_id', orgId),
  ])

  const report = (reportData ?? { success: false }) as Report
  const currency = imp.currency
  const matchByLine = new Map(
    ((matches ?? []) as { statement_line_id: string; status: string }[])
      .filter((m) => m.status !== 'rejected')
      .map((m) => [m.statement_line_id, m])
  )

  // Mouvements candidats pour un rapprochement manuel : meme compte,
  // meme devise, non encore engages dans un rapprochement.
  const { data: candidateMovements } = await supabase
    .from('cash_movements')
    .select('id, movement_date, direction, amount, description, reference_type, reconciled')
    .eq('treasury_account_type', imp.treasury_account_type)
    .eq('treasury_account_id', imp.treasury_account_id)
    .eq('currency', currency)
    .eq('reconciled', false)
    .order('movement_date', { ascending: false })
    .limit(200)

  const engagedMovementIds = new Set(
    ((matches ?? []) as { cash_movement_id: string; status: string }[])
      .filter((m) => m.status !== 'rejected')
      .map((m) => m.cash_movement_id)
  )
  const availableMovements = (candidateMovements ?? [])
    .filter((m) => !engagedMovementIds.has(m.id))
    .map((m) => ({
      id: m.id,
      label: `${m.movement_date} — ${m.direction === 'in' ? 'Entree' : 'Sortie'} ${formatMoney(m.amount, currency)}${m.description ? ` — ${m.description.slice(0, 40)}` : ''}`,
      direction: m.direction,
      amount: Number(m.amount),
    }))

  const isCancelled = imp.status === 'cancelled'
  const csvRows = (lines ?? []).map((l) => ({
    Ligne: String(l.line_number),
    Date: l.value_date,
    Libelle: l.label,
    Reference: l.external_reference ?? '',
    Sens: l.direction === 'in' ? 'Entree' : 'Sortie',
    Montant: String(l.amount),
    Devise: l.currency,
    Statut: LINE_STATUS_LABELS[l.status] ?? l.status,
  }))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-mf-navy-900">{imp.statement_reference}</h1>
          <p className="text-sm text-slate-500">
            {imp.period_start} → {imp.period_end} — {imp.line_count} ligne(s) — {currency}
            {isCancelled && <span className="ml-2 font-semibold text-mf-danger">Annule</span>}
            {' — '}
            <Link href="/tresorerie/rapprochement" className="text-mf-navy-700 hover:underline">
              Retour aux releves
            </Link>
          </p>
        </div>
        <CsvExportButton rows={csvRows} filename={`rapprochement-${imp.statement_reference}.csv`} />
      </div>

      {/* --- Solde comptable vs solde releve --- */}
      {report.success && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-mf-navy-900">Solde comptable vs solde releve</h2>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm">
              <p className="text-xs text-slate-400">Solde comptable de cloture</p>
              <p className="text-lg font-semibold text-mf-navy-900">
                {formatMoney(report.book_closing_balance ?? 0, currency)}
              </p>
              <p className="text-xs text-slate-400">
                ouverture {formatMoney(report.book_opening_balance ?? 0, currency)}
              </p>
            </div>
            <div className="rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm">
              <p className="text-xs text-slate-400">Solde du releve</p>
              <p className="text-lg font-semibold text-mf-navy-900">
                {formatMoney(report.statement_closing_balance ?? 0, currency)}
              </p>
              <p className="text-xs text-slate-400">
                ouverture {formatMoney(report.statement_opening_balance ?? 0, currency)}
              </p>
            </div>
            <div className="rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm">
              <p className="text-xs text-slate-400">Ecart</p>
              <p className={`text-lg font-semibold ${Number(report.difference ?? 0) === 0 ? 'text-mf-emerald-700' : 'text-mf-danger'}`}>
                {formatMoney(report.difference ?? 0, currency)}
              </p>
            </div>
            <div className="rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm">
              <p className="text-xs text-slate-400">Lignes rapprochees</p>
              <p className="text-lg font-semibold text-mf-navy-900">
                {report.reconciled_lines ?? 0} / {report.total_lines ?? 0}
              </p>
            </div>
          </div>
          {Number(report.difference ?? 0) !== 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Un ecart subsiste entre la comptabilite et le releve. Le rapprochement ne cree
              <strong> aucune </strong>ecriture : si un ajustement comptable est justifie, il doit passer par
              une ecriture manuelle depuis la Comptabilite, avec sa validation propre.
            </p>
          )}
        </section>
      )}

      {/* --- Actions --- */}
      {canReconcile && !isCancelled && (
        <section className="flex flex-wrap items-start gap-3 rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm">
          <ActionForm
            action={proposeBankReconciliationAction}
            hiddenFields={{ import_id: id, date_tolerance_days: '3' }}
            submitLabel="Proposer les rapprochements automatiques"
            pendingLabel="Analyse…"
            buttonClassName="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800"
          />
          <details className="rounded-lg border border-mf-border p-3">
            <summary className="cursor-pointer text-sm font-medium text-mf-navy-900">Annuler cet import</summary>
            <p className="mt-2 text-xs text-slate-500">
              Refuse si un rapprochement valide en depend — aucun rapprochement valide n&apos;est jamais detruit.
            </p>
            <div className="mt-2">
              <ActionForm
                action={cancelBankStatementImportAction}
                hiddenFields={{ import_id: id }}
                submitLabel="Confirmer l'annulation"
                buttonClassName="rounded-lg border border-mf-border px-3 py-1.5 text-sm font-semibold text-mf-danger hover:bg-slate-50"
              >
                <input name="reason" required placeholder="Motif"
                  className="w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
              </ActionForm>
            </div>
          </details>
          <p className="text-xs text-slate-400">
            Une proposition automatique n&apos;est emise que si <strong>exactement un</strong> mouvement
            correspond (meme compte, devise, sens, montant exact, date a ±3 jours). En cas d&apos;ambiguite,
            le rapprochement reste manuel.
          </p>
        </section>
      )}

      {/* --- Lignes du releve --- */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-mf-navy-900">Lignes du releve</h2>
        <div className="overflow-x-auto rounded-2xl border border-mf-border bg-mf-surface shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Libelle</th>
                <th className="px-3 py-2">Reference</th>
                <th className="px-3 py-2">Sens</th>
                <th className="px-3 py-2 text-right">Montant</th>
                <th className="px-3 py-2">Statut</th>
                {canReconcile && !isCancelled && <th className="px-3 py-2">Action</th>}
              </tr>
            </thead>
            <tbody>
              {(lines ?? []).map((l) => {
                const match = matchByLine.get(l.id) as
                  | { id: string; status: string; match_type: string; amount_difference: number; date_difference_days: number }
                  | undefined
                return (
                  <tr key={l.id} className="border-t border-mf-border align-top">
                    <td className="px-3 py-2 text-xs">{l.line_number}</td>
                    <td className="px-3 py-2 text-xs">{l.value_date}</td>
                    <td className="px-3 py-2">{l.label}</td>
                    <td className="px-3 py-2 text-xs">{l.external_reference ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">{l.direction === 'in' ? 'Entree' : 'Sortie'}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(l.amount, l.currency)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${LINE_STATUS_CLASS[l.status] ?? 'bg-slate-100 text-slate-600'}`}>
                        {LINE_STATUS_LABELS[l.status] ?? l.status}
                      </span>
                      {match && Number(match.amount_difference) !== 0 && (
                        <div className="mt-1 text-xs text-mf-danger">
                          Ecart montant : {formatMoney(match.amount_difference, currency)}
                        </div>
                      )}
                      {match && Number(match.date_difference_days) > 0 && (
                        <div className="mt-1 text-xs text-amber-700">
                          Ecart date : {match.date_difference_days} j
                        </div>
                      )}
                    </td>
                    {canReconcile && !isCancelled && (
                      <td className="px-3 py-2">
                        {match?.status === 'proposed' && (
                          <div className="space-y-1">
                            <ActionForm
                              action={validateBankMatchAction}
                              hiddenFields={{ match_id: match.id, import_id: id }}
                              submitLabel="Valider"
                              buttonClassName="rounded-lg border border-mf-border px-3 py-1 text-xs font-semibold text-mf-navy-700 hover:bg-slate-50"
                            />
                            <details>
                              <summary className="cursor-pointer text-xs text-mf-danger">Rejeter</summary>
                              <div className="mt-1">
                                <ActionForm
                                  action={rejectBankMatchAction}
                                  hiddenFields={{ match_id: match.id, import_id: id }}
                                  submitLabel="Confirmer"
                                  buttonClassName="rounded-lg border border-mf-border px-2 py-1 text-xs font-semibold text-mf-danger hover:bg-slate-50"
                                >
                                  <input name="reason" required placeholder="Motif"
                                    className="w-full rounded-lg border border-mf-border px-2 py-1 text-xs" />
                                </ActionForm>
                              </div>
                            </details>
                          </div>
                        )}
                        {(l.status === 'unreconciled' || l.status === 'discrepancy') && !match && (
                          <ManualMatchForm
                            action={createManualBankMatchAction}
                            statementLineId={l.id}
                            importId={id}
                            movements={availableMovements}
                          />
                        )}
                        {l.status === 'reconciled' && (
                          <span className="text-xs text-slate-400">Verrouille</span>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
              {(lines ?? []).length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                    Aucune ligne dans ce releve.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* --- Mouvements comptables non rapproches --- */}
      {report.success && (report.unmatched_cash_movements ?? []).length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-mf-navy-900">
            Mouvements comptables non rapproches sur la periode
          </h2>
          <p className="text-xs text-slate-400">
            Presents en comptabilite mais absents du releve — l&apos;autre cote de l&apos;ecart.
          </p>
          <div className="overflow-x-auto rounded-2xl border border-mf-border bg-mf-surface shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Origine</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2">Sens</th>
                  <th className="px-3 py-2 text-right">Montant</th>
                </tr>
              </thead>
              <tbody>
                {(report.unmatched_cash_movements ?? []).map((m) => (
                  <tr key={m.id} className="border-t border-mf-border">
                    <td className="px-3 py-2 text-xs">{m.movement_date}</td>
                    <td className="px-3 py-2 text-xs">{m.reference_type}</td>
                    <td className="px-3 py-2 text-xs">{m.description ?? '—'}</td>
                    <td className="px-3 py-2 text-xs">{m.direction === 'in' ? 'Entree' : 'Sortie'}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(m.amount, currency)}</td>
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
