import type { Metadata } from 'next'
import type { ReactNode } from 'react'
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
import { ProfileWorkspace, type ProfilePanel } from '@/components/hr/employee-profile/profile-workspace'
import {
  Avatar,
  Card,
  DataField,
  DocumentGlyph,
  EmptyState,
  FieldGrid,
  StatusPill,
  documentTypeLabel,
  statusLabel,
} from '@/components/hr/employee-profile/profile-primitives'
import { formatDay, formatDayShort } from '@/lib/format/day'
import { businessDate } from '@/lib/date/business-month'
import { formatMoney } from '@/lib/format/money'

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

  const positionTitle = employee.positions?.title ?? null
  const departmentName = employee.departments?.name ?? null
  const emergency = sensitive?.emergency_contact as { name?: string; phone?: string } | null
  const documentList = documents ?? []
  const contractList = contracts ?? []
  // Les contrats arrivent deja tries du plus recent au plus ancien.
  const [latestContract, ...previousContracts] = contractList

  const canSeeContracts = canViewSalary || isSelf
  const canSeePersonal = canViewSensitive || isSelf

  // --- Bandeau ------------------------------------------------------------

  const identity = (
    // Rangee a tous les points de rupture, et alignee en haut : seul
    // l'avatar remonte dans le bandeau. En colonne, une marge negative sur
    // le premier enfant entraine tous ses freres avec lui — le texte
    // repartirait sur le navy. Ici le decalage reste local a l'avatar.
    <div className="flex items-start gap-4 sm:gap-5">
      <Avatar
        firstName={employee.first_name}
        lastName={employee.last_name}
        className="-mt-10 sm:-mt-11"
      />
      <div className="min-w-0 pt-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-mf-navy-900">
            {employee.first_name} {employee.last_name}
          </h1>
          <StatusPill status={employee.status} />
        </div>
        <p className="mt-1 text-sm text-slate-500">
          <span className="font-medium text-mf-navy-700 tabular-nums">{employee.matricule}</span>
          {' · '}
          {positionTitle ?? 'Sans poste'}
          {' · '}
          {departmentName ?? 'Sans departement'}
        </p>
        <p className="mt-0.5 text-xs text-slate-400">Entre le {formatDay(employee.hire_date)}</p>
      </div>
    </div>
  )

  // Action secondaire volontairement discrete : terminer un contrat n'est
  // pas l'action courante d'une fiche.
  const secondaryAction = canTerminate ? (
    <form action={employee.status === 'terminated' ? reactivateEmployeeAction : terminateEmployeeAction}>
      <input type="hidden" name="id" value={employee.id} />
      <button
        type="submit"
        className="rounded-lg px-3 py-2 text-sm font-medium text-slate-500 underline-offset-4 hover:text-mf-danger hover:underline"
      >
        {employee.status === 'terminated' ? 'Reactiver' : 'Mettre fin au contrat'}
      </button>
    </form>
  ) : undefined

  // --- Onglet 1 : vue d'ensemble ------------------------------------------

  const overviewView = (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <Card title="Informations professionnelles" className="lg:col-span-2">
        <FieldGrid>
          <DataField label="Matricule" value={<span className="tabular-nums">{employee.matricule}</span>} />
          <DataField label="Statut" value={statusLabel(employee.status)} />
          <DataField label="Poste" value={positionTitle} />
          <DataField label="Departement" value={departmentName} />
          <DataField label="Date d'entree" value={formatDay(employee.hire_date)} />
        </FieldGrid>
      </Card>

      <Card title="Dossier">
        <dl className="space-y-4">
          <DataField
            label="Documents deposes"
            value={<span className="tabular-nums">{documentList.length}</span>}
          />
          {canSeeContracts && (
            <>
              <DataField
                label="Contrats enregistres"
                value={<span className="tabular-nums">{contractList.length}</span>}
              />
              <DataField
                label="Contrat le plus recent"
                value={latestContract ? `${latestContract.type} — ${formatDay(latestContract.start_date)}` : null}
              />
            </>
          )}
        </dl>
      </Card>
    </div>
  )

  const overviewEdit = canUpdate ? (
    <Card title="Modifier le profil" className="lg:max-w-3xl">
      <form action={updateEmployeeAction} className="space-y-4">
        <input type="hidden" name="id" value={employee.id} />
        {/* updateEmployeeAction lit `formData.get('gender') || null` : un
            formulaire qui ne soumet pas le champ ecrase le genre a NULL a
            chaque enregistrement. On le renvoie donc inchange. La chaine
            vide redevient null cote action, ce qui preserve aussi le cas
            "genre non renseigne". Aucune regle metier n'est touchee : le
            formulaire rend simplement ce que l'action attend. */}
        <input type="hidden" name="gender" value={employee.gender ?? ''} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Prenom" name="first_name" defaultValue={employee.first_name} />
          <Field label="Nom" name="last_name" defaultValue={employee.last_name} />
          <SelectField label="Departement" name="department_id" defaultValue={employee.department_id ?? ''}>
            <option value="">—</option>
            {(departments ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Poste" name="position_id" defaultValue={employee.position_id ?? ''}>
            <option value="">—</option>
            {(positions ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </SelectField>
        </div>
        <SubmitButton>Enregistrer</SubmitButton>
      </form>
    </Card>
  ) : undefined

  // --- Onglet 2 : informations personnelles --------------------------------
  // Le jeu de champs affiche depend strictement de employee.view_sensitive,
  // exactement comme avant : sans cette permission, un employe consultant
  // sa propre fiche ne voit que NIF, CIN, telephone et adresse.

  const personalView = canViewSensitive ? (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card title="Identite">
        <FieldGrid>
          <DataField label="Prenom" value={employee.first_name} />
          <DataField label="Nom" value={employee.last_name} />
          <DataField label="Date de naissance" value={formatDay(sensitive?.birth_date)} />
        </FieldGrid>
      </Card>

      <Card title="Coordonnees">
        <FieldGrid>
          <DataField label="Telephone personnel" value={sensitive?.personal_phone} />
          <DataField label="Email personnel" value={sensitive?.personal_email} />
          <DataField label="Adresse" value={sensitive?.address} wide />
        </FieldGrid>
      </Card>

      <Card title="Identifiants administratifs">
        <FieldGrid>
          <DataField label="NIF" value={sensitive?.nif} />
          <DataField label="NINU" value={sensitive?.ninu} />
          <DataField label="CIN" value={sensitive?.cin} />
        </FieldGrid>
      </Card>

      <Card title="Contact d'urgence">
        <FieldGrid>
          <DataField label="Nom" value={emergency?.name} />
          <DataField label="Telephone" value={emergency?.phone} />
        </FieldGrid>
      </Card>

      <Card title="Notes RH" className="lg:col-span-2">
        {sensitive?.hr_notes ? (
          <p className="whitespace-pre-wrap text-sm text-mf-navy-900">{sensitive.hr_notes}</p>
        ) : (
          <p className="text-sm text-slate-300">—</p>
        )}
      </Card>
    </div>
  ) : (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">
        Lecture seule — les autres informations personnelles requierent la permission{' '}
        <code className="text-xs">employee.view_sensitive</code>.
      </p>
      <Card title="Informations personnelles" className="lg:max-w-3xl">
        <FieldGrid>
          <DataField label="NIF" value={sensitive?.nif} />
          <DataField label="CIN" value={sensitive?.cin} />
          <DataField label="Telephone personnel" value={sensitive?.personal_phone} />
          <DataField label="Adresse" value={sensitive?.address} />
        </FieldGrid>
      </Card>
    </div>
  )

  const personalEdit = canViewSensitive ? (
    <Card title="Modifier les informations personnelles" className="lg:max-w-3xl">
      <form action={upsertEmployeeSensitiveDataAction} className="space-y-4">
        <input type="hidden" name="employee_id" value={employee.id} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Date de naissance" name="birth_date" type="date" defaultValue={sensitive?.birth_date ?? ''} />
          <Field label="Telephone personnel" name="personal_phone" defaultValue={sensitive?.personal_phone ?? ''} />
          <Field label="Email personnel" name="personal_email" defaultValue={sensitive?.personal_email ?? ''} />
          <Field label="NIF" name="nif" defaultValue={sensitive?.nif ?? ''} />
          <Field label="NINU" name="ninu" defaultValue={sensitive?.ninu ?? ''} />
          <Field label="CIN" name="cin" defaultValue={sensitive?.cin ?? ''} />
          <Field label="Adresse" name="address" defaultValue={sensitive?.address ?? ''} wide />
          <Field
            label="Contact d'urgence — nom"
            name="emergency_contact_name"
            defaultValue={emergency?.name ?? ''}
          />
          <Field
            label="Contact d'urgence — telephone"
            name="emergency_contact_phone"
            defaultValue={emergency?.phone ?? ''}
          />
        </div>
        <div>
          <label htmlFor="hr_notes" className="block text-xs font-medium text-mf-navy-900">
            Notes RH
          </label>
          <textarea
            id="hr_notes"
            name="hr_notes"
            defaultValue={sensitive?.hr_notes ?? ''}
            rows={4}
            className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
          />
        </div>
        <SubmitButton>Enregistrer</SubmitButton>
      </form>
    </Card>
  ) : undefined

  // --- Onglet 3 : contrats --------------------------------------------------

  const contractsView = (
    <div className="space-y-5">
      {latestContract ? (
        <Card
          title="Contrat le plus recent"
          action={<StatusPill status={latestContract.status} scope="contract" />}
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <p className="text-xl font-semibold text-mf-navy-900">{latestContract.type}</p>
            <p className="text-sm text-slate-500">
              du {formatDay(latestContract.start_date)}
              {latestContract.end_date ? ` au ${formatDay(latestContract.end_date)}` : ' — sans terme'}
            </p>
          </div>
          <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 border-t border-mf-border pt-5 sm:grid-cols-3">
            <DataField label="Debut" value={formatDay(latestContract.start_date)} />
            <DataField label="Fin" value={latestContract.end_date ? formatDay(latestContract.end_date) : null} />
            <DataField label="Fin de periode d'essai" value={formatDay(latestContract.probation_end_date)} />
            {latestContract.base_salary !== null && (
              <>
                <DataField
                  label="Remuneration de base"
                  value={
                    <span className="tabular-nums">
                      {formatMoney(latestContract.base_salary, latestContract.currency)}
                    </span>
                  }
                />
                <DataField label="Mode de paiement" value={latestContract.payment_method} />
              </>
            )}
          </dl>

          {canManageContracts && <AmendmentForm contractId={latestContract.id} employeeId={employee.id} />}
        </Card>
      ) : (
        <Card title="Contrats">
          <EmptyState>Aucun contrat enregistre.</EmptyState>
        </Card>
      )}

      {previousContracts.length > 0 && (
        <Card title="Historique">
          <ul className="divide-y divide-mf-border">
            {previousContracts.map((c) => (
              <li key={c.id} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-mf-navy-900">{c.type}</p>
                    <p className="text-xs text-slate-500">
                      {formatDayShort(c.start_date)}
                      {c.end_date ? ` → ${formatDayShort(c.end_date)}` : ''}
                      {c.base_salary !== null && (
                        <span className="tabular-nums"> · {formatMoney(c.base_salary, c.currency)}</span>
                      )}
                    </p>
                  </div>
                  <StatusPill status={c.status} scope="contract" />
                </div>
                {canManageContracts && <AmendmentForm contractId={c.id} employeeId={employee.id} />}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {canManageContracts && (
        <Card>
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-mf-navy-700">+ Nouveau contrat</summary>
            <form action={createContractAction} className="mt-4 space-y-4">
              <input type="hidden" name="employee_id" value={employee.id} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <SelectField label="Type" name="type" required>
                  {['CDI', 'CDD', 'consultant', 'prestataire', 'temps_partiel', 'fondateur', 'stage'].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </SelectField>
                <Field label="Date de debut" name="start_date" type="date" required />
                <Field label="Date de fin (optionnel)" name="end_date" type="date" />
                <Field label="Salaire de base" name="base_salary" type="number" />
                <SelectField label="Devise" name="currency">
                  <option value="HTG">HTG</option>
                  <option value="USD">USD</option>
                </SelectField>
                <SelectField label="Mode de paiement" name="payment_method">
                  <option value="">—</option>
                  <option value="virement_bancaire">Virement bancaire</option>
                  <option value="moncash">MonCash</option>
                  <option value="especes">Especes</option>
                  <option value="cheque">Cheque</option>
                </SelectField>
              </div>
              <button
                type="submit"
                className="rounded-lg bg-mf-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-emerald-500"
              >
                Creer le contrat
              </button>
            </form>
          </details>
        </Card>
      )}
    </div>
  )

  // --- Onglet 4 : documents -------------------------------------------------

  const documentsView = (
    <Card title={`Documents (${documentList.length})`}>
      {documentList.length > 0 ? (
        <ul className="divide-y divide-mf-border">
          {documentList.map((d) => (
            <li key={d.id} className="flex items-center gap-4 py-3 first:pt-0">
              <DocumentGlyph type={d.type} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-mf-navy-900">{d.original_filename}</p>
                <p className="text-xs text-slate-400">
                  {/* created_at est un instant, pas une date civile : on le
                      ramene au jour haitien plutot qu'au jour UTC. */}
                  {documentTypeLabel(d.type)} · depose le{' '}
                  {formatDayShort(businessDate(new Date(d.created_at)))}
                </p>
              </div>
              <DocumentDownloadLink documentId={d.id} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState>Aucun document depose.</EmptyState>
      )}

      {canUploadDocs && (
        <div className="mt-5">
          <DocumentUpload employeeId={employee.id} />
        </div>
      )}
    </Card>
  )

  // --- Assemblage ----------------------------------------------------------
  // Un onglet n'apparait que si la permission correspondante donne acces a
  // son contenu : les regles de visibilite sont celles d'avant, seule leur
  // presentation change.

  const panels: ProfilePanel[] = [
    { id: 'overview', label: "Vue d'ensemble", view: overviewView, edit: overviewEdit },
    ...(canSeePersonal
      ? [{ id: 'personal', label: 'Informations personnelles', view: personalView, edit: personalEdit }]
      : []),
    ...(canSeeContracts ? [{ id: 'contracts', label: 'Contrats', view: contractsView }] : []),
    { id: 'documents', label: 'Documents', view: documentsView },
  ]

  return (
    <div className="mx-auto max-w-7xl">
      <ProfileWorkspace
        identity={identity}
        secondaryAction={secondaryAction}
        canEdit={Boolean(overviewEdit || personalEdit)}
        panels={panels}
      />
    </div>
  )
}

// --- Petits blocs de formulaire (inchanges dans leur comportement) --------

function AmendmentForm({ contractId, employeeId }: { contractId: string; employeeId: string }) {
  return (
    <details className="mt-4 border-t border-mf-border pt-3">
      <summary className="cursor-pointer text-xs font-medium text-mf-navy-700">Ajouter un avenant</summary>
      <form action={createContractAmendmentAction} className="mt-3 space-y-2">
        <input type="hidden" name="contract_id" value={contractId} />
        <input type="hidden" name="employee_id" value={employeeId} />
        <input
          type="date"
          name="effective_date"
          required
          aria-label="Date d'effet de l'avenant"
          className="w-full rounded-lg border border-mf-border px-3 py-2 text-sm sm:max-w-xs"
        />
        <textarea
          name="change_description"
          required
          rows={2}
          aria-label="Description du changement"
          placeholder="Description du changement"
          className="w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
        />
        <button type="submit" className="rounded-lg bg-mf-navy-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-mf-navy-800">
          Enregistrer l&apos;avenant
        </button>
      </form>
    </details>
  )
}

function SubmitButton({ children }: { children: ReactNode }) {
  return (
    <button
      type="submit"
      className="rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800"
    >
      {children}
    </button>
  )
}

function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  required,
  wide = false,
}: {
  label: string
  name: string
  type?: string
  defaultValue?: string
  required?: boolean
  wide?: boolean
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <label htmlFor={`field-${name}`} className="block text-xs font-medium text-mf-navy-900">
        {label}
      </label>
      <input
        id={`field-${name}`}
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
      />
    </div>
  )
}

function SelectField({
  label,
  name,
  defaultValue,
  required,
  children,
}: {
  label: string
  name: string
  defaultValue?: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <div>
      <label htmlFor={`field-${name}`} className="block text-xs font-medium text-mf-navy-900">
        {label}
      </label>
      <select
        id={`field-${name}`}
        name={name}
        defaultValue={defaultValue}
        required={required}
        className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
      >
        {children}
      </select>
    </div>
  )
}
