import type { Metadata } from 'next'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { verifySession, getMemberships } from '@/lib/auth/dal'
import { AccessDenied } from '@/components/shell/access-denied'
import { StatusBadge } from '@/components/finance/status-badge'
import { ActionForm } from '@/components/finance/action-form'
import { formatMoney } from '@/lib/format/money'
import {
  submitExpenseRequestAction,
  approveExpenseRequestAction,
  payExpenseRequestAction,
  cancelExpenseRequestAction,
  requestExpenseApprovalExceptionAction,
  validateExpenseApprovalExceptionAction,
  justifyExpenseRequestAction,
  uploadExpenseAttachmentAction,
} from '@/app/actions/expenses'
import { AttachmentUpload } from '@/components/finance/attachment-upload'
import { AttachmentDownloadLink } from '@/components/finance/attachment-download-link'

export const metadata: Metadata = { title: 'Depense — MedFinder Gestion' }

const TREASURY_TYPE_LABELS: Record<string, string> = { cash: 'Caisse', bank: 'Banque', mobile_money: 'Mobile money' }
const ATTACHMENT_TYPES = [
  { value: 'facture', label: 'Facture' },
  { value: 'recu', label: 'Recu' },
  { value: 'justificatif', label: 'Justificatif' },
]

type PageProps = { params: Promise<{ id: string }> }

export default async function ExpenseDetailPage({ params }: PageProps) {
  const { id } = await params
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />

  const { userId } = await verifySession()
  const supabase = await createClient()

  const { data: expense } = await supabase
    .from('expense_requests')
    .select(
      `id, expense_number, payee_name, payee_reference, description, amount, currency, payment_method,
       status, requested_date, cancel_reason, requester_id,
       budget_lines ( category, budgets ( name ) ),
       expense_categories ( name ),
       cost_centers ( code, name )`
    )
    .eq('id', id)
    .maybeSingle()

  if (!expense) return <AccessDenied />

  const isRequester = expense.requester_id === userId
  const [canView, canApprove, canPay, canCancel, canManageBudget] = await Promise.all([
    hasPermission(orgId, 'expense.view'),
    hasPermission(orgId, 'expense.approve'),
    hasPermission(orgId, 'expense.pay'),
    hasPermission(orgId, 'expense.cancel'),
    hasPermission(orgId, 'budget.manage'),
  ])
  if (!canView && !isRequester) return <AccessDenied />

  const memberships = await getMemberships()
  const activeMembership = memberships.find((m) => m.organization_id === orgId)
  const isDgOrSuperAdmin =
    (activeMembership?.role_codes ?? []).some((r) => r === 'DIRECTEUR_GENERAL' || r === 'SUPER_ADMIN')

  const [{ data: approvals }, { data: payment }, { data: attachments }, { data: history }] =
    await Promise.all([
      supabase
        .from('expense_approvals')
        .select('*')
        .eq('expense_id', id)
        .order('created_at', { ascending: true }),
      supabase
        .from('expenses')
        .select('id, paid_date, treasury_account_type, treasury_account_id, journal_entry_id, commitment_id, no_commitment_reason')
        .eq('expense_request_id', id)
        .maybeSingle(),
      supabase
        .from('expense_attachments')
        .select('id, type, original_filename, created_at')
        .eq('expense_request_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('audit_logs')
        .select('id, action, occurred_at, old_value, new_value, result')
        .eq('object_type', 'expense_requests')
        .eq('object_id', id)
        .order('occurred_at', { ascending: true }),
    ])

  // Requetes distinctes par table (schemas de colonnes differents) plutot
  // qu'un nom de table dynamique — evite un type SelectQueryError.
  let treasuryAccounts: { id: string; label: string }[] = []
  if (expense.payment_method === 'cash') {
    const { data } = await supabase.from('cash_accounts').select('id, name').eq('status', 'active')
    treasuryAccounts = (data ?? []).map((a) => ({ id: a.id, label: a.name }))
  } else if (expense.payment_method === 'bank') {
    const { data } = await supabase.from('bank_accounts').select('id, bank_name').eq('status', 'active')
    treasuryAccounts = (data ?? []).map((a) => ({ id: a.id, label: a.bank_name }))
  } else if (expense.payment_method === 'mobile_money') {
    const { data } = await supabase.from('mobile_money_accounts').select('id, provider').eq('status', 'active')
    treasuryAccounts = (data ?? []).map((a) => ({ id: a.id, label: a.provider }))
  }

  const pendingException = (approvals ?? []).find((a) => a.exception_requested_by && !a.exception_result)

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-mf-navy-900">{expense.expense_number || 'Brouillon'}</h1>
          <p className="text-sm text-slate-500">{expense.payee_name}</p>
        </div>
        <div className="text-right">
          <StatusBadge status={expense.status} domain="expense" />
          <p className="mt-1 text-lg font-bold text-mf-navy-900">{formatMoney(expense.amount, expense.currency)}</p>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 rounded-2xl border border-mf-border bg-mf-surface p-6 text-sm shadow-sm">
        <Field label="Ligne budgetaire" value={`${expense.budget_lines?.budgets?.name ?? '—'} — ${expense.budget_lines?.category ?? '—'}`} />
        <Field label="Categorie" value={expense.expense_categories?.name ?? '—'} />
        <Field label="Centre de cout" value={expense.cost_centers ? `${expense.cost_centers.code} — ${expense.cost_centers.name}` : '—'} />
        <Field label="Mode de paiement" value={TREASURY_TYPE_LABELS[expense.payment_method] ?? expense.payment_method} />
        <Field label="Reference beneficiaire" value={expense.payee_reference ?? '—'} />
        <Field label="Date demandee" value={expense.requested_date} />
        {expense.description && <Field label="Description" value={expense.description} full />}
        {expense.cancel_reason && <Field label="Motif d'annulation" value={expense.cancel_reason} full />}
      </section>

      {/* --- Actions de workflow --- */}
      <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-mf-navy-900">Actions</h2>
        <div className="flex flex-wrap gap-3">
          {expense.status === 'draft' && isRequester && (
            <ActionForm
              action={submitExpenseRequestAction}
              hiddenFields={{ id: expense.id }}
              submitLabel="Soumettre"
              pendingLabel="Soumission..."
              buttonClassName="rounded-lg bg-mf-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-emerald-500 disabled:opacity-60"
            />
          )}

          {expense.status === 'submitted' && canApprove && (
            <>
              <ActionForm
                action={approveExpenseRequestAction}
                hiddenFields={{ id: expense.id, decision: 'approved' }}
                submitLabel="Approuver"
                pendingLabel="Approbation..."
                buttonClassName="rounded-lg bg-mf-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-emerald-500 disabled:opacity-60"
              />
              <ActionForm
                action={approveExpenseRequestAction}
                hiddenFields={{ id: expense.id, decision: 'rejected' }}
                submitLabel="Rejeter"
                pendingLabel="Rejet..."
                buttonClassName="rounded-lg border border-mf-border px-4 py-2 text-sm font-semibold text-mf-danger hover:bg-red-50 disabled:opacity-60"
              />
            </>
          )}

          {(expense.status === 'submitted' || expense.status === 'approved') && canCancel && (
            <details className="w-full">
              <summary className="cursor-pointer text-sm font-medium text-mf-danger">Annuler la demande</summary>
              <ActionForm
                action={cancelExpenseRequestAction}
                hiddenFields={{ id: expense.id }}
                submitLabel="Confirmer l'annulation"
                pendingLabel="Annulation..."
                className="mt-2 space-y-2"
                buttonClassName="rounded-lg bg-mf-danger px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                <textarea
                  name="reason"
                  required
                  placeholder="Motif de l'annulation"
                  className="w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
                />
              </ActionForm>
            </details>
          )}

          {expense.status === 'committed' && canPay && (
            <details className="w-full">
              <summary className="cursor-pointer text-sm font-medium text-mf-navy-700">Enregistrer le paiement</summary>
              <ActionForm
                action={payExpenseRequestAction}
                hiddenFields={{ id: expense.id, treasury_account_type: expense.payment_method }}
                submitLabel="Payer"
                pendingLabel="Paiement..."
                className="mt-2 space-y-2"
                buttonClassName="rounded-lg bg-mf-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-emerald-500 disabled:opacity-60"
              >
                <select
                  name="treasury_account_id"
                  required
                  className="w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
                >
                  <option value="">Compte de tresorerie —</option>
                  {treasuryAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
                {canManageBudget && (
                  <input
                    name="no_commitment_reason"
                    placeholder="Motif (uniquement si l'engagement budgetaire n'est plus actif — cas exceptionnel)"
                    className="w-full rounded-lg border border-mf-border px-3 py-2 text-xs"
                  />
                )}
              </ActionForm>
            </details>
          )}

          {expense.status === 'paid' && (
            <>
              <ActionForm
                action={justifyExpenseRequestAction}
                hiddenFields={{ id: expense.id }}
                submitLabel="Comptabiliser (justificatif depose)"
                pendingLabel="Comptabilisation..."
                buttonClassName="rounded-lg bg-mf-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-emerald-500 disabled:opacity-60"
              />
              {(attachments ?? []).length === 0 && (
                <p className="w-full text-xs text-amber-600">
                  Au moins un justificatif doit etre depose avant de pouvoir comptabiliser.
                </p>
              )}
            </>
          )}

          {expense.status === 'submitted' && isRequester && !pendingException && (
            <details className="w-full">
              <summary className="cursor-pointer text-sm font-medium text-amber-700">
                Demander une exception de separation des fonctions (equipe reduite)
              </summary>
              <ActionForm
                action={requestExpenseApprovalExceptionAction}
                hiddenFields={{ id: expense.id }}
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

          {pendingException && isDgOrSuperAdmin && (
            <div className="w-full rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-800">Exception en attente de validation</p>
              <p className="mt-1 text-sm text-amber-800">{pendingException.exception_justification}</p>
              <div className="mt-2 flex gap-2">
                <ActionForm
                  action={validateExpenseApprovalExceptionAction}
                  hiddenFields={{ id: expense.id, result: 'approved' }}
                  submitLabel="Valider l'exception"
                  pendingLabel="Validation..."
                  buttonClassName="rounded-lg bg-mf-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-mf-emerald-500 disabled:opacity-60"
                />
                <ActionForm
                  action={validateExpenseApprovalExceptionAction}
                  hiddenFields={{ id: expense.id, result: 'refused' }}
                  submitLabel="Refuser l'exception"
                  pendingLabel="Refus..."
                  buttonClassName="rounded-lg border border-mf-border px-3 py-1.5 text-xs font-semibold text-mf-danger hover:bg-red-50 disabled:opacity-60"
                />
              </div>
            </div>
          )}

        </div>
      </section>

      {/* --- Separation des fonctions --- */}
      {(approvals ?? []).length > 0 && (
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

      {/* --- Justificatifs --- */}
      <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-mf-navy-900">Justificatifs</h2>
        <ul className="space-y-1 text-sm">
          {(attachments ?? []).map((a) => (
            <li key={a.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
              <span>
                {a.original_filename} <span className="text-xs text-slate-400">({a.type})</span>
              </span>
              <AttachmentDownloadLink attachmentId={a.id} />
            </li>
          ))}
          {(attachments ?? []).length === 0 && <p className="text-slate-400">Aucun justificatif depose.</p>}
        </ul>
        {(isRequester || canPay) && ['paid', 'committed'].includes(expense.status) && (
          <AttachmentUpload expenseId={expense.id} types={ATTACHMENT_TYPES} action={uploadExpenseAttachmentAction} />
        )}
      </section>

      {/* --- Paiement (comptable) --- */}
      {payment && (
        <section className="space-y-2 rounded-2xl border border-mf-border bg-mf-surface p-6 text-sm shadow-sm">
          <h2 className="text-sm font-semibold text-mf-navy-900">Paiement</h2>
          <Field label="Date de paiement" value={payment.paid_date} />
          <Field label="Compte" value={TREASURY_TYPE_LABELS[payment.treasury_account_type] ?? payment.treasury_account_type} />
          {payment.no_commitment_reason && (
            <p className="text-xs text-amber-600">
              Paiement hors engagement (exceptionnel) — {payment.no_commitment_reason}
            </p>
          )}
        </section>
      )}

      {/* --- Historique des etats --- */}
      {(history ?? []).length > 0 && (
        <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-mf-navy-900">Historique</h2>
          <ol className="space-y-1 text-sm text-slate-500">
            {(history ?? []).map((h) => {
              const newStatus = (h.new_value as { status?: string } | null)?.status
              const oldStatus = (h.old_value as { status?: string } | null)?.status
              return (
                <li key={h.id}>
                  {new Date(h.occurred_at).toLocaleString('fr-FR')} — {h.action}
                  {newStatus && newStatus !== oldStatus && (
                    <span className="text-mf-navy-700"> ({oldStatus ?? 'creation'} → {newStatus})</span>
                  )}
                </li>
              )
            })}
          </ol>
        </section>
      )}

    </div>
  )
}

function Field({ label, value, full }: { label: string; value: string | null | undefined; full?: boolean }) {
  return (
    <div className={full ? 'col-span-2' : undefined}>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="text-mf-navy-900">{value || '—'}</dd>
    </div>
  )
}
