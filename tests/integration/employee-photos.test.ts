import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { EMPLOYEE_PHOTO_BUCKET, EMPLOYEE_PHOTO_MAX_BYTES } from '@/lib/storage/employee-photo'

// Cette suite ecrit de petits objets de test : uniquement sur la stack LOCALE.
// Aucun client privilegie ; meme nettoyage via la session RH et les policies.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const local = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(url)
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const suite = describe.skipIf(!local)

suite('Photos employes — Storage/RLS reels (Supabase local avec migration et seed)', () => {
  let rh: SupabaseClient
  let viewer: SupabaseClient
  let self: SupabaseClient
  let foreign: SupabaseClient
  let orgId: string
  let employeeId: string
  let rhEmployeeId: string
  let foreignOrgId: string
  let photoPath: string
  const objects: string[] = []
  const blob = (mime = 'image/png', size = 8) => new Blob([new Uint8Array(size)], { type: mime })
  const newPath = (extension = 'png') => `${orgId}/${employeeId}/${crypto.randomUUID()}.${extension}`

  async function signIn(email: string) {
    const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await client.auth.signInWithPassword({ email, password: 'DemoPass#2026' })
    if (error || !data.user) throw new Error('Connexion seed local impossible.')
    return { client, userId: data.user.id }
  }

  beforeAll(async () => {
    if (typeof globalThis.WebSocket === 'undefined') {
      const { default: WS } = await import('ws')
      Object.assign(globalThis, { WebSocket: WS })
    }
    const rhSession = await signIn('rh.demo@medfinder.test')
    rh = rhSession.client
    const own = await signIn('employe.demo@medfinder.test')
    self = own.client
    viewer = (await signIn('manager.demo@medfinder.test')).client
    foreign = (await signIn('orgb.demo@medfinder.test')).client
    const { data: employee, error } = await self.from('employees').select('id, organization_id').eq('user_id', own.userId).single()
    if (error || !employee) throw new Error('Employe seed local absent.')
    employeeId = employee.id
    orgId = employee.organization_id
    const { data: rhEmployee } = await rh.from('employees').select('id').eq('user_id', rhSession.userId).single()
    rhEmployeeId = rhEmployee!.id
    const { data: orgB, error: orgError } = await foreign.from('organizations').select('id').eq('tax_id', 'DEMO-B').single()
    if (orgError || !orgB) throw new Error('Organisation B seed absente.')
    foreignOrgId = orgB.id
    photoPath = newPath()
    const upload = await rh.storage.from(EMPLOYEE_PHOTO_BUCKET).upload(photoPath, blob())
    expect(upload.error).toBeNull()
    objects.push(photoPath)
  })

  afterAll(async () => {
    if (rh && objects.length) {
      const { error } = await rh.storage.from(EMPLOYEE_PHOTO_BUCKET).remove(objects)
      expect(error).toBeNull()
    }
  })

  it('bucket prive : URL publique et lecture anonyme refusees', async () => {
    const response = await fetch(`${url}/storage/v1/object/public/${EMPLOYEE_PHOTO_BUCKET}/${photoPath}`)
    expect(response.ok).toBe(false)
    const anonymous = createClient(url, anonKey, { auth: { persistSession: false } })
    expect((await anonymous.storage.from(EMPLOYEE_PHOTO_BUCKET).createSignedUrl(photoPath, 60)).error).toBeTruthy()
  })
  it.each([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']])('accepte %s', async (mime, ext) => {
    const path = newPath(ext)
    const { error } = await rh.storage.from(EMPLOYEE_PHOTO_BUCKET).upload(path, blob(mime))
    if (!error) objects.push(path)
    expect(error).toBeNull()
  })
  it('MIME interdit et plus de 3 MiB refuses par Storage', async () => {
    for (const file of [blob('image/svg+xml'), blob('image/png', EMPLOYEE_PHOTO_MAX_BYTES + 1)]) {
      const path = newPath()
      const { error } = await rh.storage.from(EMPLOYEE_PHOTO_BUCKET).upload(path, file)
      if (!error) objects.push(path)
      expect(error).toBeTruthy()
    }
  })
  it('chemins utilisateur, sous-dossiers et employe de mauvaise organisation refuses', async () => {
    for (const path of [`${orgId}/${employeeId}/photo.png`, `${orgId}/${employeeId}/sub/${crypto.randomUUID()}.png`,
      `${foreignOrgId}/${employeeId}/${crypto.randomUUID()}.png`]) {
      expect((await rh.storage.from(EMPLOYEE_PHOTO_BUCKET).upload(path, blob())).error).toBeTruthy()
    }
  })
  it('employee.view peut signer la photo', async () => {
    const permission = await rh.rpc('current_user_has_permission', { p_org_id: orgId, p_permission_code: 'employee.view' })
    expect(permission.data).toBe(true)
    const { data, error } = await rh.storage.from(EMPLOYEE_PHOTO_BUCKET).createSignedUrl(photoPath, 60)
    expect(error).toBeNull()
    // Aucun affichage / log de signed URL, y compris dans les assertions.
    expect(Boolean(data?.signedUrl)).toBe(true)
  })
  it('self peut signer sa photo, pas celle de RH', async () => {
    expect((await self.storage.from(EMPLOYEE_PHOTO_BUCKET).createSignedUrl(photoPath, 60)).error).toBeNull()
    const other = `${orgId}/${rhEmployeeId}/${crypto.randomUUID()}.png`
    const { error } = await rh.storage.from(EMPLOYEE_PHOTO_BUCKET).upload(other, blob())
    expect(error).toBeNull()
    objects.push(other)
    expect((await self.storage.from(EMPLOYEE_PHOTO_BUCKET).createSignedUrl(other, 60)).error).toBeTruthy()
  })
  it('self et viewer sans employee.update ne peuvent uploader ou supprimer', async () => {
    for (const client of [self, viewer]) {
      const permission = await client.rpc('current_user_has_permission', { p_org_id: orgId, p_permission_code: 'employee.update' })
      expect(permission.data).toBe(false)
      expect((await client.storage.from(EMPLOYEE_PHOTO_BUCKET).upload(newPath(), blob())).error).toBeTruthy()
      await client.storage.from(EMPLOYEE_PHOTO_BUCKET).remove([photoPath])
      expect((await rh.storage.from(EMPLOYEE_PHOTO_BUCKET).download(photoPath)).error).toBeNull()
    }
  })
  it('cross-organization : lecture et upload refuses', async () => {
    expect((await foreign.storage.from(EMPLOYEE_PHOTO_BUCKET).createSignedUrl(photoPath, 60)).error).toBeTruthy()
    expect((await foreign.storage.from(EMPLOYEE_PHOTO_BUCKET).upload(newPath(), blob())).error).toBeTruthy()
  })
  it('la colonne refuse une URL ou un path hors employe meme avec employee.update', async () => {
    for (const value of ['https://example.test/photo?token=ephemere', `${orgId}/${rhEmployeeId}/${crypto.randomUUID()}.png`]) {
      expect((await rh.from('employees').update({ photo_storage_path: value }).eq('id', employeeId)).error).toBeTruthy()
    }
  })
})
