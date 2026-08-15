'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import {
  DepartmentSchema,
  PositionSchema,
  EmployeeCreateSchema,
  EmployeeSensitiveDataSchema,
  ContractSchema,
  ContractAmendmentSchema,
} from '@/lib/validation/hr'

function firstIssueMessage(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? 'Donnees invalides.'
}

// --- Departements / postes ------------------------------------------------

export async function createDepartmentAction(formData: FormData) {
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')

  const parsed = DepartmentSchema.safeParse({
    name: formData.get('name'),
    parent_department_id: formData.get('parent_department_id') || null,
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { error } = await supabase
    .from('departments')
    .insert({ organization_id: orgId, ...parsed.data })
  if (error) throw new Error(error.message)

  revalidatePath('/rh/departements')
}

export async function setDepartmentStatusAction(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.from('departments').update({ status }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/rh/departements')
}

export async function createPositionAction(formData: FormData) {
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')

  const parsed = PositionSchema.safeParse({
    title: formData.get('title'),
    department_id: formData.get('department_id') || null,
    description: formData.get('description') || null,
    responsibilities: formData.get('responsibilities') || null,
    required_skills: formData.get('required_skills') || null,
    reports_to_position_id: formData.get('reports_to_position_id') || null,
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { error } = await supabase.from('positions').insert({ organization_id: orgId, ...parsed.data })
  if (error) throw new Error(error.message)

  revalidatePath('/rh/departements')
}

export async function setPositionStatusAction(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const status = String(formData.get('status') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.from('positions').update({ status }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/rh/departements')
}

// --- Employes ---------------------------------------------------------

export async function createEmployeeAction(formData: FormData) {
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')

  const parsed = EmployeeCreateSchema.safeParse({
    first_name: formData.get('first_name'),
    last_name: formData.get('last_name'),
    gender: formData.get('gender') || null,
    hire_date: formData.get('hire_date'),
    department_id: formData.get('department_id') || null,
    position_id: formData.get('position_id') || null,
    manager_employee_id: formData.get('manager_employee_id') || null,
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('employees')
    // matricule: chaine vide -> le trigger assign_employee_matricule (Phase 1B)
    // genere EMP-0001... automatiquement ; le type genere l'exige non-null
    // bien que la colonne DB accepte une valeur vide/absente en pratique.
    .insert({ organization_id: orgId, matricule: '', ...parsed.data })
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  revalidatePath('/rh/employes')
  redirect(`/rh/employes/${data.id}`)
}

export async function updateEmployeeAction(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const parsed = EmployeeCreateSchema.partial().safeParse({
    first_name: formData.get('first_name') || undefined,
    last_name: formData.get('last_name') || undefined,
    gender: formData.get('gender') || null,
    hire_date: formData.get('hire_date') || undefined,
    department_id: formData.get('department_id') || null,
    position_id: formData.get('position_id') || null,
    manager_employee_id: formData.get('manager_employee_id') || null,
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { error } = await supabase.from('employees').update(parsed.data).eq('id', id)
  if (error) throw new Error(error.message)

  revalidatePath(`/rh/employes/${id}`)
}

export async function terminateEmployeeAction(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.from('employees').update({ status: 'terminated' }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath(`/rh/employes/${id}`)
  revalidatePath('/rh/employes')
}

export async function reactivateEmployeeAction(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const supabase = await createClient()
  const { error } = await supabase.from('employees').update({ status: 'active' }).eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath(`/rh/employes/${id}`)
  revalidatePath('/rh/employes')
}

// --- Donnees tres sensibles ----------------------------------------------

export async function upsertEmployeeSensitiveDataAction(formData: FormData) {
  const employeeId = String(formData.get('employee_id') ?? '')
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')

  const parsed = EmployeeSensitiveDataSchema.safeParse({
    birth_date: formData.get('birth_date') || null,
    personal_phone: formData.get('personal_phone') || null,
    personal_email: formData.get('personal_email') || null,
    address: formData.get('address') || null,
    nif: formData.get('nif') || null,
    ninu: formData.get('ninu') || null,
    cin: formData.get('cin') || null,
    emergency_contact_name: formData.get('emergency_contact_name') || null,
    emergency_contact_phone: formData.get('emergency_contact_phone') || null,
    hr_notes: formData.get('hr_notes') || null,
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const { emergency_contact_name, emergency_contact_phone, ...rest } = parsed.data
  const supabase = await createClient()
  const { error } = await supabase.from('employee_sensitive_data').upsert(
    {
      employee_id: employeeId,
      organization_id: orgId,
      ...rest,
      emergency_contact:
        emergency_contact_name || emergency_contact_phone
          ? { name: emergency_contact_name, phone: emergency_contact_phone }
          : null,
    },
    { onConflict: 'employee_id' }
  )
  if (error) throw new Error(error.message)

  revalidatePath(`/rh/employes/${employeeId}`)
}

// --- Contrats -----------------------------------------------------------

export async function createContractAction(formData: FormData) {
  const employeeId = String(formData.get('employee_id') ?? '')
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')

  const parsed = ContractSchema.safeParse({
    type: formData.get('type'),
    start_date: formData.get('start_date'),
    end_date: formData.get('end_date') || null,
    probation_end_date: formData.get('probation_end_date') || null,
    base_salary: formData.get('base_salary') || null,
    currency: formData.get('currency') || 'HTG',
    payment_method: formData.get('payment_method') || null,
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { error } = await supabase.from('contracts').insert({
    organization_id: orgId,
    employee_id: employeeId,
    status: 'active',
    ...parsed.data,
    end_date: parsed.data.end_date || null,
    probation_end_date: parsed.data.probation_end_date || null,
  })
  if (error) throw new Error(error.message)

  revalidatePath(`/rh/employes/${employeeId}`)
}

export async function createContractAmendmentAction(formData: FormData) {
  const contractId = String(formData.get('contract_id') ?? '')
  const employeeId = String(formData.get('employee_id') ?? '')
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')

  const parsed = ContractAmendmentSchema.safeParse({
    effective_date: formData.get('effective_date'),
    change_description: formData.get('change_description'),
  })
  if (!parsed.success) throw new Error(firstIssueMessage(parsed.error))

  const supabase = await createClient()
  const { error } = await supabase.from('contract_amendments').insert({
    organization_id: orgId,
    contract_id: contractId,
    ...parsed.data,
  })
  if (error) throw new Error(error.message)

  revalidatePath(`/rh/employes/${employeeId}`)
}

// --- Documents ------------------------------------------------------------

const DOCUMENT_TYPES = ['contrat_signe', 'piece_identite', 'diplome', 'cv', 'justificatif', 'autre'] as const

export async function uploadEmployeeDocumentAction(formData: FormData) {
  const employeeId = String(formData.get('employee_id') ?? '')
  const type = String(formData.get('type') ?? 'autre')
  const file = formData.get('file') as File | null
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new Error('Aucune organisation active.')
  if (!file || file.size === 0) throw new Error('Aucun fichier fourni.')
  if (!(DOCUMENT_TYPES as readonly string[]).includes(type)) throw new Error('Type de document invalide.')

  const supabase = await createClient()
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `${orgId}/${employeeId}/${crypto.randomUUID()}-${safeName}`

  const { error: uploadError } = await supabase.storage
    .from('employee-documents')
    .upload(storagePath, file, { contentType: file.type || 'application/octet-stream' })
  if (uploadError) throw new Error(uploadError.message)

  const { error: insertError } = await supabase.from('employee_documents').insert({
    organization_id: orgId,
    employee_id: employeeId,
    type,
    storage_path: storagePath,
    original_filename: file.name,
  })
  if (insertError) {
    // Retire le fichier orphelin si l'insertion des metadonnees echoue.
    await supabase.storage.from('employee-documents').remove([storagePath])
    throw new Error(insertError.message)
  }

  revalidatePath(`/rh/employes/${employeeId}`)
}

export async function getEmployeeDocumentSignedUrlAction(documentId: string): Promise<string> {
  const supabase = await createClient()
  const { data: doc, error: docError } = await supabase
    .from('employee_documents')
    .select('storage_path')
    .eq('id', documentId)
    .single()
  if (docError || !doc) throw new Error(docError?.message ?? 'Document introuvable.')

  const { data, error } = await supabase.storage
    .from('employee-documents')
    .createSignedUrl(doc.storage_path, 60) // 60 secondes — jamais d'URL permanente (§47)
  if (error || !data) throw new Error(error?.message ?? 'Echec de generation de l\'URL signee.')

  return data.signedUrl
}
