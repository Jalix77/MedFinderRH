import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'
import { EMPLOYEE_PHOTO_BUCKET, isEmployeePhotoPath } from './employee-photo'

/** URL ephemere uniquement dans le rendu de la requete courante. */
export async function getEmployeePhotoSignedUrl(
  supabase: SupabaseClient<Database>,
  orgId: string,
  employeeId: string,
  path: string | null,
): Promise<string | undefined> {
  if (!path || !isEmployeePhotoPath(path, orgId, employeeId)) return undefined
  try {
    const { data, error } = await supabase.storage.from(EMPLOYEE_PHOTO_BUCKET).createSignedUrl(path, 60)
    return error ? undefined : data?.signedUrl
  } catch {
    // Photo absente, expiree ou Storage indisponible : la fiche reste lisible.
    return undefined
  }
}
