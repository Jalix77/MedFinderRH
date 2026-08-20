import type { Metadata } from 'next'
import Link from 'next/link'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { AccessDenied } from '@/components/shell/access-denied'
import { StatusBadge } from '@/components/finance/status-badge'
import { ActionForm } from '@/components/finance/action-form'
import { formatMoney } from '@/lib/format/money'
import {
  submitInvoiceDocumentAction,
  issueInvoiceDocumentAction,
  cancelInvoiceDocumentAction,
  deleteInvoiceDraftAction,
  requestInvoiceIssueExceptionAction,
  validateInvoiceIssueExceptionAction,
} from '@/app/actions/invoicing'

export const metadata: Metadata = { title: 'Document — MedFinder Gestion' }

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />

  const [canManage, canView, canReverse] = await Promise.all([
    hasPermission(orgId, 'invoice.manage'),
    hasPermission(orgId, 'accounting.view'),
    hasPermission(orgId, 'accounting.reverse'),
  ])
  if (!canManage && !canView) return <AccessDenied />

  const supabase = await createClient()
  // Anti-IDOR : aucune condition d'organisation ecrite ici — la RLS ne
  // renvoie rien pour un document d'une autre organisation.
  const { data: doc } = await supabase
    .from('invoices')
    .select('*, third_parties ( id, legal_name, third_party_code, tax_id )')
    .eq('id', id)
    .maybeSingle()
  if (!doc) return <AccessDenied />

  const [{ data: lines }, { data: payments }, { data: exceptions }, { data: entries }, { data: credited }] =
    await Promise.all([
      supabase
        .from('invoice_lines')
        .select('id, line_number, description, quantity, unit_price, tax_rate_percent, line_subtotal, tax_amount, line_total')
        .eq('invoice_id', id)
        .order('line_number'),
      supabase
        .from('customer_payments')
        .select('id, payment_number, payment_date, amount, status, treasury_account_type, journal_entry_id')
        .eq('invoice_id', id)
        .order('payment_date'),
      supabase
        .from('invoice_issue_approvals')
        .select('id, exception_justification, exception_result, exception_validated_at, decision_reason')
        .eq('invoice_id', id)
        .order('created_at', { ascending: false }),
      canView
        ? supabase
            .from('journal_entries')
            .select('id, entry_number, entry_date, status, reversed_entry_id')
            .eq('source_type', 'invoice')
            .eq('source_id', id)
            .order('created_at')
        : Promise.resolve({ data: [] }),
      doc.credited_invoice_id
        ? supabase.from('invoices').select('id, document_number').eq('id', doc.credited_invoice_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ])

  const tp = doc.third_parties as { id: string; legal_name: string; third_party_code: string; tax_id: string | null } | null
  const isDraft = ['draft', 'pending_issue'].includes(doc.status)
  const isCredit = doc.document_type === 'CREDIT_NOTE'
  const pendingException = (exceptions ?? []).find((e) => e.exception_result === null)
  const label = isCredit ? 'Avoir' : 'Facture'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-mf-navy-900">
            {label} {doc.document_number ?? '(brouillon)'}
          </h1>
          <p className="text-sm text-slate-500">
            {tp && (
              <>
                <Link href={`/tiers/${tp.id}`} className="text-mf-navy-700 hover:underline">{tp.legal_name}</Link>
                {' — '}
              </>
            )}
            <Link href="/facturation" className="text-mf-navy-700 hover:underline">Retour a la liste</Link>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={doc.status} domain="invoice" />
          <a href={`/api/facturation/${id}/pdf`}
            className="rounded-lg border border-mf-border px-3 py-1.5 text-xs font-semibold text-mf-navy-700 hover:bg-slate-50">
            Telecharger le PDF
          </a>
        </div>
      </div>

      {/* --- Synthese --- */}
      <section className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm">
          <p className="text-xs text-slate-400">Total</p>
          <p className="text-lg font-semibold text-mf-navy-900">{formatMoney(doc.total, doc.currency)}</p>
          {doc.currency !== 'HTG' && (
            <p className="text-xs text-slate-400">{formatMoney(doc.total_htg ?? 0, 'HTG')} (historique)</p>
          )}
        </div>
        <div className="rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm">
          <p className="text-xs text-slate-400">Deja paye</p>
          <p className="text-lg font-semibold text-mf-navy-900">{formatMoney(doc.amount_paid, doc.currency)}</p>
        </div>
        <div className="rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm">
          <p className="text-xs text-slate-400">Reste a payer</p>
          <p className="text-lg font-semibold text-mf-navy-900">{formatMoney(doc.balance_due ?? 0, doc.currency)}</p>
        </div>
        <div className="rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm">
          <p className="text-xs text-slate-400">Echeance</p>
          <p className="text-lg font-semibold text-mf-navy-900">{doc.due_date}</p>
        </div>
      </section>

      {/* --- Informations --- */}
      <section className="grid gap-2 rounded-2xl border border-mf-border bg-mf-surface p-4 text-sm shadow-sm sm:grid-cols-2">
        <div><span className="text-slate-400">Date du document :</span> {doc.document_date}</div>
        <div><span className="text-slate-400">Devise :</span> {doc.currency}</div>
        {doc.currency !== 'HTG' && (
          <div><span className="text-slate-400">Taux fige :</span> {doc.exchange_rate_to_htg}</div>
        )}
        {tp?.tax_id && <div><span className="text-slate-400">NIF :</span> {tp.tax_id}</div>}
        {doc.external_reference && (
          <div><span className="text-slate-400">Reference externe :</span> {doc.external_reference}</div>
        )}
        {credited && (
          <div>
            <span className="text-slate-400">Avoir sur :</span>{' '}
            <Link href={`/facturation/${(credited as { id: string }).id}`} className="text-mf-navy-700 hover:underline">
              {(credited as { document_number: string }).document_number}
            </Link>
          </div>
        )}
        {doc.credit_reason && <div><span className="text-slate-400">Motif de l&apos;avoir :</span> {doc.credit_reason}</div>}
        {doc.cancel_reason && (
          <div className="sm:col-span-2 text-mf-danger">
            <span className="text-slate-400">Motif d&apos;annulation :</span> {doc.cancel_reason}
          </div>
        )}
        {doc.notes && <div className="sm:col-span-2"><span className="text-slate-400">Notes :</span> {doc.notes}</div>}
      </section>

      {/* --- Lignes --- */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-mf-navy-900">Lignes</h2>
        <div className="overflow-x-auto rounded-2xl border border-mf-border bg-mf-surface shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Qte</th>
                <th className="px-3 py-2 text-right">P.U.</th>
                <th className="px-3 py-2 text-right">Taxe</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {(lines ?? []).map((l) => (
                <tr key={l.id} className="border-t border-mf-border">
                  <td className="px-3 py-2 text-xs">{l.line_number}</td>
                  <td className="px-3 py-2">{l.description}</td>
                  <td className="px-3 py-2 text-right">{l.quantity}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(l.unit_price, doc.currency)}</td>
                  <td className="px-3 py-2 text-right">
                    {Number(l.tax_rate_percent) > 0 ? `${l.tax_rate_percent}% (${formatMoney(l.tax_amount ?? 0, doc.currency)})` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">{formatMoney(l.line_total ?? 0, doc.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* --- Encaissements --- */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-mf-navy-900">Encaissements</h2>
        {(payments ?? []).length === 0 ? (
          <p className="rounded-2xl border border-mf-border bg-mf-surface p-4 text-sm text-slate-400 shadow-sm">
            Aucun encaissement enregistre pour ce document.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-mf-border bg-mf-surface shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2">Numero</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Compte</th>
                  <th className="px-3 py-2 text-right">Montant</th>
                  <th className="px-3 py-2">Statut</th>
                </tr>
              </thead>
              <tbody>
                {(payments ?? []).map((p) => (
                  <tr key={p.id} className="border-t border-mf-border">
                    <td className="px-3 py-2 font-mono text-xs">{p.payment_number}</td>
                    <td className="px-3 py-2 text-xs">{p.payment_date}</td>
                    <td className="px-3 py-2 text-xs">{p.treasury_account_type}</td>
                    <td className="px-3 py-2 text-right">{formatMoney(p.amount, doc.currency)}</td>
                    <td className="px-3 py-2"><StatusBadge status={p.status} domain="payment" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* --- Tracabilite comptable --- */}
      {canView && (entries ?? []).length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-mf-navy-900">Ecritures comptables liees</h2>
          <div className="overflow-x-auto rounded-2xl border border-mf-border bg-mf-surface shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-3 py-2">Numero</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Nature</th>
                  <th className="px-3 py-2">Statut</th>
                </tr>
              </thead>
              <tbody>
                {(entries ?? []).map((e) => (
                  <tr key={e.id} className="border-t border-mf-border">
                    <td className="px-3 py-2">
                      <Link href={`/comptabilite/${e.id}`} className="font-mono text-xs text-mf-navy-700 hover:underline">
                        {e.entry_number}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs">{e.entry_date}</td>
                    <td className="px-3 py-2 text-xs">
                      {e.reversed_entry_id ? 'Contre-passation' : "Ecriture d'origine"}
                    </td>
                    <td className="px-3 py-2"><StatusBadge status={e.status} domain="journal_entry" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* --- Exceptions de separation des fonctions --- */}
      {(exceptions ?? []).length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-mf-navy-900">Exceptions a la separation des fonctions</h2>
          <div className="space-y-2">
            {(exceptions ?? []).map((e) => (
              <div key={e.id} className="rounded-2xl border border-mf-border bg-mf-surface p-4 text-sm shadow-sm">
                <p className="text-slate-600">{e.exception_justification}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {e.exception_result
                    ? `Decision : ${e.exception_result === 'approved' ? 'approuvee' : 'refusee'}${
                        e.decision_reason ? ` — ${e.decision_reason}` : ''
                      }`
                    : 'En attente de validation par un DIRECTEUR_GENERAL ou SUPER_ADMIN'}
                </p>
                {!e.exception_result && canManage && (
                  <div className="mt-2 flex gap-2">
                    <ActionForm
                      action={validateInvoiceIssueExceptionAction}
                      hiddenFields={{ exception_id: e.id, document_id: id, decision: 'approved' }}
                      submitLabel="Approuver l'exception"
                      buttonClassName="rounded-lg border border-mf-border px-3 py-1.5 text-xs font-semibold text-mf-navy-700 hover:bg-slate-50"
                    />
                    <ActionForm
                      action={validateInvoiceIssueExceptionAction}
                      hiddenFields={{ exception_id: e.id, document_id: id, decision: 'refused' }}
                      submitLabel="Refuser"
                      buttonClassName="rounded-lg border border-mf-border px-3 py-1.5 text-xs font-semibold text-mf-danger hover:bg-slate-50"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* --- Actions de workflow --- */}
      {canManage && (
        <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-mf-navy-900">Actions</h2>

          {isDraft && (
            <div className="flex flex-wrap gap-2">
              <Link href={`/facturation/${id}/modifier`}
                className="rounded-lg border border-mf-border px-3 py-1.5 text-sm font-semibold text-mf-navy-700 hover:bg-slate-50">
                Modifier
              </Link>
              {doc.status === 'draft' && (
                <ActionForm
                  action={submitInvoiceDocumentAction}
                  hiddenFields={{ id }}
                  submitLabel="Soumettre"
                  pendingLabel="Soumission…"
                  buttonClassName="rounded-lg border border-mf-border px-3 py-1.5 text-sm font-semibold text-mf-navy-700 hover:bg-slate-50"
                />
              )}
              <ActionForm
                action={issueInvoiceDocumentAction}
                hiddenFields={{ id }}
                submitLabel="Emettre"
                pendingLabel="Emission…"
                buttonClassName="rounded-lg bg-mf-navy-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-mf-navy-800"
              />
              <ActionForm
                action={deleteInvoiceDraftAction}
                hiddenFields={{ id }}
                submitLabel="Supprimer le brouillon"
                buttonClassName="rounded-lg border border-mf-border px-3 py-1.5 text-sm font-semibold text-mf-danger hover:bg-slate-50"
              />
            </div>
          )}

          {isDraft && (
            <details className="rounded-lg border border-mf-border p-3">
              <summary className="cursor-pointer text-sm font-medium text-mf-navy-900">
                Demander une exception (emettre un document que j&apos;ai moi-meme cree)
              </summary>
              <p className="mt-2 text-xs text-slate-500">
                L&apos;emetteur ne peut normalement pas etre le createur du document. Une exception doit etre
                justifiee et validee par un DIRECTEUR_GENERAL ou un SUPER_ADMIN distinct.
              </p>
              <div className="mt-2">
                <ActionForm
                  action={requestInvoiceIssueExceptionAction}
                  hiddenFields={{ id }}
                  submitLabel="Demander l'exception"
                  buttonClassName="rounded-lg border border-mf-border px-3 py-1.5 text-sm font-semibold text-mf-navy-700 hover:bg-slate-50"
                >
                  <input name="justification" required placeholder="Justification"
                    className="w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
                </ActionForm>
              </div>
              {pendingException && (
                <p className="mt-2 text-xs text-amber-700">Une demande est deja en attente de validation.</p>
              )}
            </details>
          )}

          {doc.status === 'issued' && (
            <details className="rounded-lg border border-mf-border p-3">
              <summary className="cursor-pointer text-sm font-medium text-mf-navy-900">Annuler ce document</summary>
              <p className="mt-2 text-xs text-slate-500">
                L&apos;annulation contre-passe l&apos;ecriture comptable : elle exige aussi la permission de
                contre-passation.{' '}
                {!canReverse && (
                  <span className="text-mf-danger">
                    Vous ne disposez pas de cette permission — l&apos;action sera refusee par le backend.
                  </span>
                )}
              </p>
              <div className="mt-2">
                <ActionForm
                  action={cancelInvoiceDocumentAction}
                  hiddenFields={{ id }}
                  submitLabel="Annuler le document"
                  buttonClassName="rounded-lg border border-mf-border px-3 py-1.5 text-sm font-semibold text-mf-danger hover:bg-slate-50"
                >
                  <input name="reason" required placeholder="Motif d'annulation"
                    className="w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
                </ActionForm>
              </div>
            </details>
          )}

          {['partially_paid', 'paid'].includes(doc.status) && (
            <p className="text-xs text-slate-500">
              Ce document a deja recu un encaissement : il ne peut plus etre annule. Une correction passe par un avoir.
            </p>
          )}
        </section>
      )}
    </div>
  )
}
