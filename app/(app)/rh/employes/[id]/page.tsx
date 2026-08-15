import type { Metadata } from 'next'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { verifySession } from '@/lib/auth/dal'
import { AccessDenied } from '@/components/shell/access-denied'
import {
  updateEmployeeAction,
  terminateEmployeeAction,
  reactivateEmployeeAction,
  upsertEmployeeSensitiveDataAction,
  createContractAction,
  createContractAmendmentAction,
} from '@/app/actions/hr'
import { DocumentUpload } from '@/components/hr/document-upload'
import { DocumentDownloadLink } from '@/components/hr/document-download-link'

export const metadata: Metadata = { title: 'Fiche employe — MedFinder Gestion' }

type PageProps = { params: Promise<{ id: string }> }

export default async function EmployeeDetailPage({ params }: PageProps) {
  const { id } = await params
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />

  const canView = await hasPermission(orgId, 'employee.view')
  const { userId } = await verifySession()

  const supabase = await createClient()
  const { data: employee } = await supabase
    .from('employees')
    .select(
      'id, matricule, first_name, last_name, gender, hire_date, status, user_id, department_id, position_id, departments ( name ), positions ( title )'
    )
    .eq('id', id)
    .maybeSingle()

  if (!employee) return <AccessDenied />

  const isSelf = employee.user_id === userId
  if (!canView && !isSelf) return <AccessDenied />

  const [canUpdate, canTerminate, canViewSensitive, canViewSalary, canManageContracts, canUploadDocs] =
    await Promise.all([
      hasPermission(orgId, 'employee.update'),
      hasPermission(orgId, 'employee.terminate'),
      hasPermission(orgId, 'employee.view_sensitive'),
      hasPermission(orgId, 'employee.view_salary'),
      hasPermission(orgId, 'contract.manage'),
      hasPermission(orgId, 'document.upload'),
    ])

  const [{ data: sensitive }, { data: contracts }, { data: documents }, { data: departments }, { data: positions }] =
    await Promise.all([
      canViewSensitive || isSelf
        ? supabase.from('employee_sensitive_data').select('*').eq('employee_id', id).maybeSingle()
        : Promise.resolve({ data: null }),
      canViewSalary || isSelf
        ? supabase.from('contracts').select('*').eq('employee_id', id).order('start_date', { ascending: false })
        : Promise.resolve({ data: null }),
      supabase
        .from('employee_documents')
        .select('id, type, original_filename, created_at')
        .eq('employee_id', id)
        .order('created_at', { ascending: false }),
      supabase.from('departments').select('id, name').eq('status', 'active').order('name'),
      supabase.from('positions').select('id, title').eq('status', 'active').order('title'),
    ])

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-mf-navy-900">
            {employee.first_name} {employee.last_name}
          </h1>
          <p className="text-sm text-slate-500">
            {employee.matricule} · {employee.positions?.title ?? 'Sans poste'} ·{' '}
            {employee.departments?.name ?? 'Sans departement'}
          </p>
        </div>
        <span
          className={
            employee.status === 'active'
              ? 'rounded-full bg-mf-emerald-50 px-3 py-1 text-xs font-semibold text-mf-emerald-700'
              : employee.status === 'terminated'
                ? 'rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-mf-danger'
                : 'rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700'
          }
        >
          {employee.status}
        </span>
      </div>

      {/* --- Profil de base --- */}
      {canUpdate && (
        <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-mf-navy-900">Profil</h2>
          <form action={updateEmployeeAction} className="space-y-3">
            <input type="hidden" name="id" value={employee.id} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-mf-navy-900">Prenom</label>
                <input
                  name="first_name"
                  defaultValue={employee.first_name}
                  className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-mf-navy-900">Nom</label>
                <input
                  name="last_name"
                  defaultValue={employee.last_name}
                  className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-mf-navy-900">Departement</label>
                <select
                  name="department_id"
                  defaultValue={employee.department_id ?? ''}
                  className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
                >
                  <option value="">—</option>
                  {(departments ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-mf-navy-900">Poste</label>
                <select
                  name="position_id"
                  defaultValue={employee.position_id ?? ''}
                  className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
                >
                  <option value="">—</option>
                  {(positions ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="submit"
              className="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800"
            >
              Enregistrer
            </button>
          </form>

          {canTerminate && (
            <form action={employee.status === 'terminated' ? reactivateEmployeeAction : terminateEmployeeAction}>
              <input type="hidden" name="id" value={employee.id} />
              <button
                type="submit"
                className="rounded-lg border border-mf-border px-3 py-1.5 text-xs font-medium text-mf-danger hover:bg-red-50"
              >
                {employee.status === 'terminated' ? 'Reactiver' : 'Mettre fin au contrat (terminer)'}
              </button>
            </form>
          )}
        </section>
      )}

      {/* --- Donnees tres sensibles --- */}
      {(canViewSensitive || isSelf) && (
        <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-mf-navy-900">
            Donnees tres sensibles {isSelf && !canViewSensitive && '(lecture seule)'}
          </h2>
          {canViewSensitive ? (
            <form action={upsertEmployeeSensitiveDataAction} className="space-y-3">
              <input type="hidden" name="employee_id" value={employee.id} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date de naissance" name="birth_date" type="date" defaultValue={sensitive?.birth_date ?? ''} />
                <Field label="Telephone personnel" name="personal_phone" defaultValue={sensitive?.personal_phone ?? ''} />
                <Field label="Email personnel" name="personal_email" defaultValue={sensitive?.personal_email ?? ''} />
                <Field label="NIF" name="nif" defaultValue={sensitive?.nif ?? ''} />
                <Field label="NINU" name="ninu" defaultValue={sensitive?.ninu ?? ''} />
                <Field label="CIN" name="cin" defaultValue={sensitive?.cin ?? ''} />
              </div>
              <Field label="Adresse" name="address" defaultValue={sensitive?.address ?? ''} />
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="Contact d'urgence — nom"
                  name="emergency_contact_name"
                  defaultValue={(sensitive?.emergency_contact as { name?: string } | null)?.name ?? ''}
                />
                <Field
                  label="Contact d'urgence — telephone"
                  name="emergency_contact_phone"
                  defaultValue={(sensitive?.emergency_contact as { phone?: string } | null)?.phone ?? ''}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-mf-navy-900">Notes RH</label>
                <textarea
                  name="hr_notes"
                  defaultValue={sensitive?.hr_notes ?? ''}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
                />
              </div>
              <button
                type="submit"
                className="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800"
              >
                Enregistrer
              </button>
            </form>
          ) : (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <ReadOnly label="NIF" value={sensitive?.nif} />
              <ReadOnly label="CIN" value={sensitive?.cin} />
              <ReadOnly label="Telephone personnel" value={sensitive?.personal_phone} />
              <ReadOnly label="Adresse" value={sensitive?.address} />
            </dl>
          )}
        </section>
      )}

      {/* --- Contrats --- */}
      {(canViewSalary || isSelf) && (
        <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-mf-navy-900">Contrats</h2>

          <div className="space-y-2">
            {(contracts ?? []).map((c) => (
              <div key={c.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-mf-navy-900">
                    {c.type} — {c.start_date} {c.end_date ? `→ ${c.end_date}` : ''}
                  </span>
                  <span className="text-xs text-slate-500">{c.status}</span>
                </div>
                {c.base_salary !== null && (
                  <p className="text-slate-500">
                    {Number(c.base_salary).toLocaleString('fr-FR')} {c.currency} · {c.payment_method ?? '—'}
                  </p>
                )}
                {canManageContracts && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-mf-navy-700">Ajouter un avenant</summary>
                    <form action={createContractAmendmentAction} className="mt-2 space-y-2">
                      <input type="hidden" name="contract_id" value={c.id} />
                      <input type="hidden" name="employee_id" value={employee.id} />
                      <input
                        type="date"
                        name="effective_date"
                        required
                        className="w-full rounded-lg border border-mf-border px-2 py-1 text-xs"
                      />
                      <textarea
                        name="change_description"
                        required
                        placeholder="Description du changement"
                        className="w-full rounded-lg border border-mf-border px-2 py-1 text-xs"
                      />
                      <button
                        type="submit"
                        className="rounded-lg bg-mf-navy-900 px-3 py-1 text-xs font-semibold text-white"
                      >
                        Enregistrer l&apos;avenant
                      </button>
                    </form>
                  </details>
                )}
              </div>
            ))}
            {(contracts ?? []).length === 0 && <p className="text-sm text-slate-400">Aucun contrat.</p>}
          </div>

          {canManageContracts && (
            <details>
              <summary className="cursor-pointer text-sm font-medium text-mf-navy-700">
                + Nouveau contrat
              </summary>
              <form action={createContractAction} className="mt-3 space-y-3">
                <input type="hidden" name="employee_id" value={employee.id} />
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-mf-navy-900">Type</label>
                    <select name="type" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm">
                      {['CDI', 'CDD', 'consultant', 'prestataire', 'temps_partiel', 'fondateur', 'stage'].map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Field label="Date de debut" name="start_date" type="date" required />
                  <Field label="Date de fin (optionnel)" name="end_date" type="date" />
                  <Field label="Salaire de base" name="base_salary" type="number" />
                  <div>
                    <label className="block text-xs font-medium text-mf-navy-900">Devise</label>
                    <select name="currency" className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm">
                      <option value="HTG">HTG</option>
                      <option value="USD">USD</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-mf-navy-900">Mode de paiement</label>
                    <select
                      name="payment_method"
                      className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
                    >
                      <option value="">—</option>
                      <option value="virement_bancaire">Virement bancaire</option>
                      <option value="moncash">MonCash</option>
                      <option value="especes">Especes</option>
                      <option value="cheque">Cheque</option>
                    </select>
                  </div>
                </div>
                <button
                  type="submit"
                  className="rounded-lg bg-mf-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-emerald-500"
                >
                  Creer le contrat
                </button>
              </form>
            </details>
          )}
        </section>
      )}

      {/* --- Documents --- */}
      <section className="space-y-3 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-mf-navy-900">Documents</h2>

        <ul className="space-y-1 text-sm">
          {(documents ?? []).map((d) => (
            <li key={d.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
              <span>
                {d.original_filename} <span className="text-xs text-slate-400">({d.type})</span>
              </span>
              <DocumentDownloadLink documentId={d.id} />
            </li>
          ))}
          {(documents ?? []).length === 0 && <p className="text-slate-400">Aucun document.</p>}
        </ul>

        {canUploadDocs && <DocumentUpload employeeId={employee.id} />}
      </section>
    </div>
  )
}

function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  required,
}: {
  label: string
  name: string
  type?: string
  defaultValue?: string
  required?: boolean
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-mf-navy-900">{label}</label>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
      />
    </div>
  )
}

function ReadOnly({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="text-mf-navy-900">{value || '—'}</dd>
    </div>
  )
}
