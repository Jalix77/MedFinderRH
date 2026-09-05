export const EMPLOYEE_PHOTO_BUCKET = 'employee-photos'
export const EMPLOYEE_PHOTO_MAX_BYTES = 3 * 1024 * 1024
export const EMPLOYEE_PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp'

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const PHOTO_PATH = new RegExp(`^${UUID}/${UUID}/${UUID}\\.(jpg|png|webp)$`)

export function employeePhotoExtension(mime: string): string | undefined {
  return Object.hasOwn(EXTENSIONS, mime) ? EXTENSIONS[mime] : undefined
}

export function isEmployeePhotoPath(path: string, orgId: string, employeeId: string): boolean {
  return path === path.trim() && PHOTO_PATH.test(path) && path.startsWith(`${orgId}/${employeeId}/`)
}

export function validateEmployeePhoto(file: FormDataEntryValue | null): string | null {
  if (!(file instanceof File) || file.size === 0) return 'Aucun fichier fourni.'
  if (file.size > EMPLOYEE_PHOTO_MAX_BYTES) return 'La photo ne doit pas dépasser 3 MiB.'
  if (!employeePhotoExtension(file.type)) return 'Formats acceptés : JPEG, PNG ou WebP.'
  return null
}
