'use server'

import { revalidatePath } from 'next/cache'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import {
  EMPLOYEE_PHOTO_BUCKET,
  employeePhotoExtension,
  isEmployeePhotoPath,
  validateEmployeePhoto,
} from '@/lib/storage/employee-photo'

type PhotoResult = { error?: string; warning?: string }
class PhotoError extends Error {}

async function editableEmployee(formData: FormData) {
  const orgId = await getActiveOrganizationId()
  if (!orgId) throw new PhotoError('Aucune organisation active.')
  if (!(await hasPermission(orgId, 'employee.update'))) {
    throw new PhotoError('Vous ne pouvez pas modifier la photo de cet employé.')
  }
  const employeeId = String(formData.get('employee_id') ?? '')
  const supabase = await createClient()
  const { data: employee, error } = await supabase.from('employees')
    .select('id, photo_storage_path').eq('organization_id', orgId).eq('id', employeeId).maybeSingle()
  if (error || !employee) throw new PhotoError('Employé introuvable dans cette organisation.')
  return { supabase, orgId, employeeId, oldPath: employee.photo_storage_path }
}

/** Une reponse RLS a zero ligne ou une modification concurrente est un echec. */
async function referencePhoto(context: Awaited<ReturnType<typeof editableEmployee>>, path: string | null) {
  const { supabase, orgId, employeeId, oldPath } = context
  let query = supabase.from('employees').update({ photo_storage_path: path })
    .eq('id', employeeId).eq('organization_id', orgId)
  query = oldPath === null ? query.is('photo_storage_path', null) : query.eq('photo_storage_path', oldPath)
  const { data, error } = await query.select('id').maybeSingle()
  if (error || !data) throw new PhotoError('La photo n’a pas pu être enregistrée. Actualisez la fiche puis réessayez.')
}

async function cleanupPhoto(context: Awaited<ReturnType<typeof editableEmployee>>, path: string | null) {
  if (!path) return true
  if (!isEmployeePhotoPath(path, context.orgId, context.employeeId)) return false
  try {
    const { error } = await context.supabase.storage.from(EMPLOYEE_PHOTO_BUCKET).remove([path])
    return !error
  } catch {
    return false
  }
}

export async function uploadEmployeeProfilePhotoAction(formData: FormData): Promise<PhotoResult> {
  try {
    const context = await editableEmployee(formData)
    const file = formData.get('file')
    const validationError = validateEmployeePhoto(file)
    if (validationError) return { error: validationError }
    const photo = file as File
    const newPath = `${context.orgId}/${context.employeeId}/${crypto.randomUUID()}.${employeePhotoExtension(photo.type)}`
    const { error } = await context.supabase.storage.from(EMPLOYEE_PHOTO_BUCKET)
      .upload(newPath, photo, { contentType: photo.type, upsert: false, cacheControl: '60' })
    if (error) return { error: 'Le téléversement de la photo a échoué.' }

    try {
      await referencePhoto(context, newPath)
    } catch (error) {
      // Compensation : ne touche jamais a l'ancienne photo.
      const cleaned = await cleanupPhoto(context, newPath)
      if (!cleaned) return { error: 'Enregistrement impossible. Le nettoyage du fichier téléversé a également échoué.' }
      throw error
    }
    const cleaned = await cleanupPhoto(context, context.oldPath)
    revalidatePath(`/rh/employes/${context.employeeId}`)
    return cleaned ? {} : { warning: 'Photo enregistrée. Le nettoyage de l’ancienne photo a échoué.' }
  } catch (error) {
    return { error: error instanceof PhotoError ? error.message : 'Impossible de modifier la photo. Réessayez.' }
  }
}

export async function removeEmployeeProfilePhotoAction(formData: FormData): Promise<PhotoResult> {
  try {
    const context = await editableEmployee(formData)
    await referencePhoto(context, null)
    const cleaned = await cleanupPhoto(context, context.oldPath)
    revalidatePath(`/rh/employes/${context.employeeId}`)
    return cleaned ? {} : { warning: 'Photo retirée de la fiche. La suppression du fichier privé a échoué.' }
  } catch (error) {
    return { error: error instanceof PhotoError ? error.message : 'Impossible de supprimer la photo. Réessayez.' }
  }
}
