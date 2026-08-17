import type { Metadata } from 'next'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/dal'
import { AccessDenied } from '@/components/shell/access-denied'
import { StatusBadge } from '@/components/finance/status-badge'
import { ActionForm } from '@/components/finance/action-form'
import { formatMoney } from '@/lib/format/money'
import {
  submitManualJournalEntryAction,
  approveManualJournalEntryAction,
  requestManualEntryApprovalExceptionAction,
  validateManualEntryApprovalExceptionAction,
  postJournalEntryAction,
  reverseJournalEntryAction,
} from '@/app/actions/accounting'

export const metadata: Metadata = { title: 'Ecriture comptable — MedFinder Gestion' }

type PageProps = { params: Promise<{ id: string }> }

export default async function JournalEntryDetailPage({ params }: PageProps) {
  const { id } = await params
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />

  const canView = await hasPermission(orgId, 'accounting.view')
  if (!canView) return <AccessDenied />
  const [canPost, canReverse] = await Promise.all([
    hasPermission(orgId, 'accounting.post'),
    hasPermission(orgId, 'accounting.reverse'),
  ])

  const { userId } = await verifySession()
  const supabase = await createClient()

  const { data: entry } = await supabase
    .from('journal_entries')
    .select(
      `id, entry_number, entry_date, description, status, source_type, created_by, reversed_entry_id,
       journals ( code, label ), accounting_periods ( month, status )`
    )
    .eq('id', id)
    .maybeSingle()

  if (!entry) return <AccessDenied />

  const isCreator = entry.created_by === userId

  const [{ data: lines }, { data: approvals }] = await Promise.all([
    supabase
      .from('journal_entry_lines')
      .select('id, debit, credit, currency, chart_of_accounts ( code, label )')
      .eq('entry_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('journal_entry_approvals')
      .select('*')
      .eq('entry_id', id)
      .order('created_at', { ascending: true }),
  ])

  const totalDebit = (lines ?? []).reduce((s, l) => s + Number(l.debit), 0)
  const totalCredit = (lines ?? []).reduce((s, l) => s + Number(l.credit), 0)
  const pendingException = (approvals ?? []).find((a) => a.exception_requested_by && !a.exception_result)
  const isManual = entry.source_type === 'manual'

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-mf-navy-900">{entry.entry_number}</h1>
          <p className="text-sm text-slate-500">
            {entry.journals?.code} — {entry.journals?.label} · {entry.entry_date}
          </p>
        </div>
        <StatusBadge status={entry.status} domain="journal_entry" />
      </div>

      {entry.description && <p className="text-sm text-slate-600">{entry.description}</p>}

      {/* --- Lignes --- */}
      <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-mf-navy-900">Lignes</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="py-1 pr-4">Compte</th>
              <th className="py-1 pr-4 text-right">Debit</th>
              <th className="py-1 pr-4 text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {(lines ?? []).map((l) => (
              <tr key={l.id} className="border-t border-mf-border">
                <td className="py-2 pr-4">
                  {l.chart_of_accounts?.code} — {l.chart_of_accounts?.label}
                </td>
                <td className="py-2 pr-4 text-right">{Number(l.debit) > 0 ? formatMoney(l.debit, l.currency) : '—'}</td>
                <td className="py-2 pr-4 text-right">{Number(l.credit) > 0 ? formatMoney(l.credit, l.currency) : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-mf-border font-semibold">
              <td className="py-2 pr-4">Total</td>
              <td className="py-2 pr-4 text-right">{formatMoney(totalDebit)}</td>
              <td className="py-2 pr-4 text-right">{formatMoney(totalCredit)}</td>
            </tr>
          </tfoot>
        </table>
      </section>

      {/* --- Actions de workflow --- */}
      <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-mf-navy-900">Actions</h2>
        <div className="flex flex-wrap gap-3">
          {isManual && entry.status === 'draft' && canPost && (
            <ActionForm
              action={submitManualJournalEntryAction}
              hiddenFields={{ id: entry.id }}
              submitLabel="Soumettre"
              pendingLabel="Soumission..."
              buttonClassName="rounded-lg bg-mf-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-emerald-500 disabled:opacity-60"
            />
          )}

          {isManual && entry.status === 'submitted' && canPost && (
            <>
              <ActionForm
                action={approveManualJournalEntryAction}
                hiddenFields={{ id: entry.id, decision: 'approved' }}
                submitLabel="Approuver"
                pendingLabel="Approbation..."
                buttonClassName="rounded-lg bg-mf-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-emerald-500 disabled:opacity-60"
              />
              <ActionForm
                action={approveManualJournalEntryAction}
                hiddenFields={{ id: entry.id, decision: 'rejected' }}
                submitLabel="Rejeter"
                pendingLabel="Rejet..."
                buttonClassName="rounded-lg border border-mf-border px-4 py-2 text-sm font-semibold text-mf-danger hover:bg-red-50 disabled:opacity-60"
              />
            </>
          )}

          {/* Comptabiliser : 'draft' uniquement pour les ecritures automatiques
              (expense/grant, jamais laissees en attente) ; 'approved'
              uniquement pour les ecritures manuelles — le workflow
              Soumission -> Approbation est obligatoire pour celles-ci
              (§0.3 du plan Phase 2, app_private.post_journal_entry refuse
              desormais explicitement un brouillon manuel non approuve). */}
          {((!isManual && entry.status === 'draft') || (isManual && entry.status === 'approved')) && canPost && (
            <ActionForm
              action={postJournalEntryAction}
              hiddenFields={{ id: entry.id }}
              submitLabel="Comptabiliser"
              pendingLabel="Comptabilisation..."
              buttonClassName="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800 disabled:opacity-60"
            />
          )}

          {entry.status === 'posted' && canReverse && (
            <details className="w-full">
              <summary className="cursor-pointer text-sm font-medium text-mf-danger">Contre-passer</summary>
              <ActionForm
                action={reverseJournalEntryAction}
                hiddenFields={{ id: entry.id }}
                submitLabel="Confirmer la contre-passation"
                pendingLabel="Contre-passation..."
                className="mt-2 space-y-2"
                buttonClassName="rounded-lg bg-mf-danger px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                <textarea
                  name="reason"
                  required
                  placeholder="Motif de la contre-passation"
                  className="w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
                />
              </ActionForm>
            </details>
          )}

          {isManual && entry.status === 'submitted' && isCreator && !pendingException && (
            <details className="w-full">
              <summary className="cursor-pointer text-sm font-medium text-amber-700">
                Demander une exception de separation des fonctions (equipe reduite)
              </summary>
              <ActionForm
                action={requestManualEntryApprovalExceptionAction}
                hiddenFields={{ id: entry.id }}
                submitLabel="Demander l'exception"
                pendingLabel="Envoi..."
                className="mt-2 space-y-2"
                buttonClassName="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-60"
              >
                <textarea
                  name="justification"
                  required
                  placeholder="Justification (ex. aucun autre approbateur disponible)"
                  className="w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
                />
              </ActionForm>
            </details>
          )}

          {pendingException && (
            <div className="w-full rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-800">Exception en attente de validation (DIRECTEUR_GENERAL/SUPER_ADMIN)</p>
              <p className="mt-1 text-sm text-amber-800">{pendingException.exception_justification}</p>
              <div className="mt-2 flex gap-2">
                <ActionForm
                  action={validateManualEntryApprovalExceptionAction}
                  hiddenFields={{ id: entry.id, result: 'approved' }}
                  submitLabel="Valider l'exception"
                  pendingLabel="Validation..."
                  buttonClassName="rounded-lg bg-mf-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-mf-emerald-500 disabled:opacity-60"
                />
                <ActionForm
                  action={validateManualEntryApprovalExceptionAction}
                  hiddenFields={{ id: entry.id, result: 'refused' }}
                  submitLabel="Refuser l'exception"
                  pendingLabel="Refus..."
                  buttonClassName="rounded-lg border border-mf-border px-3 py-1.5 text-xs font-semibold text-mf-danger hover:bg-red-50 disabled:opacity-60"
                />
              </div>
            </div>
          )}

          {entry.reversed_entry_id && (
            <p className="w-full text-xs text-slate-400">Contre-passation de l&apos;ecriture {entry.reversed_entry_id}.</p>
          )}
        </div>
      </section>

      {/* --- Historique d'approbation (ecritures manuelles) --- */}
      {isManual && (approvals ?? []).length > 0 && (
        <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-mf-navy-900">Decisions et exceptions</h2>
          <ul className="space-y-2 text-sm">
            {(approvals ?? []).map((a) => (
              <li key={a.id} className="rounded-lg bg-slate-50 p-3">
                {a.decision && (
                  <p>
                    Decision : <span className="font-medium">{a.decision === 'approved' ? 'Approuvee' : 'Rejetee'}</span>
                    {a.decided_at && ` — ${new Date(a.decided_at).toLocaleString('fr-FR')}`}
                  </p>
                )}
                {a.comment && <p className="text-slate-500">{a.comment}</p>}
                {a.exception_requested_by && (
                  <div className="mt-1 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                    <p>Exception SoD demandee — {a.sod_rule_violated ?? 'auto-approbation'}</p>
                    <p>{a.exception_justification}</p>
                    {a.exception_result && (
                      <p className="mt-1 font-medium">
                        Resultat : {a.exception_result === 'approved' ? 'Validee' : 'Refusee'}
                        {a.exception_validated_at && ` — ${new Date(a.exception_validated_at).toLocaleString('fr-FR')}`}
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
