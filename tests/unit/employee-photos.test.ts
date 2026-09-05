import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  employeePhotoExtension, isEmployeePhotoPath, validateEmployeePhoto, EMPLOYEE_PHOTO_MAX_BYTES,
} from '@/lib/storage/employee-photo'

const ORG = '10000000-0000-0000-0000-000000000001'
const EMPLOYEE = '20000000-0000-0000-0000-000000000001'
const OLD = `${ORG}/${EMPLOYEE}/30000000-0000-0000-0000-000000000001.jpg`
const state = vi.hoisted(() => ({
  org: '10000000-0000-0000-0000-000000000001' as string | null,
  allowed: true, missing: false, dbError: false, zeroRows: false,
  oldPath: null as string | null,
  events: [] as string[],
  writes: [] as Record<string, unknown>[],
  filters: [] as [string, unknown][],
  upload: vi.fn(), remove: vi.fn(), sign: vi.fn(), revalidate: vi.fn(), permission: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: state.revalidate }))
vi.mock('@/lib/auth/active-org', () => ({ getActiveOrganizationId: async () => state.org }))
vi.mock('@/lib/permissions', () => ({ hasPermission: (...args: unknown[]) => {
  state.permission(...args)
  return Promise.resolve(state.allowed)
} }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  storage: { from: (bucket: string) => {
    expect(bucket).toBe('employee-photos')
    return { upload: state.upload, remove: state.remove, createSignedUrl: state.sign }
  } },
  from: (table: string) => {
    expect(table).toBe('employees')
    let updating = false
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { state.filters.push([key, value]); return query },
      is: (key: string, value: unknown) => { state.filters.push([key, value]); return query },
      update: (data: Record<string, unknown>) => { updating = true; state.writes.push(data); return query },
      maybeSingle: async () => {
        if (updating) {
          state.events.push('db')
          return { data: state.dbError || state.zeroRows ? null : { id: 'ok' }, error: state.dbError ? {} : null }
        }
        // Simule la selection filtree, sans pretendre remplacer un test RLS.
        const inOrg = state.filters.some(([key, value]) => key === 'organization_id' && value === ORG)
        return { data: state.missing || !inOrg ? null : { id: EMPLOYEE, photo_storage_path: state.oldPath }, error: null }
      },
    }
    return query
  },
}) }))

import { uploadEmployeeProfilePhotoAction, removeEmployeeProfilePhotoAction } from '@/app/actions/employee-photos'
import { getEmployeePhotoSignedUrl } from '@/lib/storage/employee-photo-url'
import { createClient } from '@/lib/supabase/server'

function form(file: File | string | null = new File(['photo'], 'nom-utilisateur.exe', { type: 'image/jpeg' })) {
  const data = new FormData()
  data.set('employee_id', EMPLOYEE)
  if (file !== null) data.set('file', file)
  return data
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(state, { org: ORG, allowed: true, missing: false, dbError: false, zeroRows: false,
    oldPath: OLD, events: [], writes: [], filters: [] })
  state.upload.mockImplementation(async () => { state.events.push('upload'); return { error: null } })
  state.remove.mockImplementation(async () => { state.events.push('remove'); return { error: null } })
  state.sign.mockResolvedValue({ data: { signedUrl: 'https://private.test/photo?token=secret' }, error: null })
})

describe('validation photo', () => {
  it.each([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']])('accepte %s', (mime, ext) => {
    expect(validateEmployeePhoto(new File(['x'], 'x', { type: mime }))).toBeNull()
    expect(employeePhotoExtension(mime)).toBe(ext)
  })
  it.each(['image/svg+xml', 'image/gif', 'text/html', '', 'constructor', '__proto__'])('refuse %s', (mime) => {
    expect(validateEmployeePhoto(new File(['x'], 'x', { type: mime }))).toBeTruthy()
  })
  it('borne exacte 3 MiB, fichier vide et faux fichier', () => {
    expect(validateEmployeePhoto(new File([new Uint8Array(EMPLOYEE_PHOTO_MAX_BYTES)], 'x', { type: 'image/png' }))).toBeNull()
    expect(validateEmployeePhoto(new File([new Uint8Array(EMPLOYEE_PHOTO_MAX_BYTES + 1)], 'x', { type: 'image/png' }))).toContain('3 MiB')
    for (const value of [null, 'fake', new File([], 'vide')]) expect(validateEmployeePhoto(value)).toBeTruthy()
  })
  it('chemin strict et attache a cet employe de cette organisation', () => {
    expect(isEmployeePhotoPath(OLD, ORG, EMPLOYEE)).toBe(true)
    for (const value of [OLD + '/extra', OLD + '?token=x', OLD + '\n', OLD.replace('.jpg', '.svg'),
      OLD.replace('/30000000', '/nom-30000000'), 'https://public.test/a.jpg']) {
      expect(isEmployeePhotoPath(value, ORG, EMPLOYEE)).toBe(false)
    }
    expect(isEmployeePhotoPath(OLD, EMPLOYEE, ORG)).toBe(false)
  })
})

describe('actions photo — ordre et permissions', () => {
  it('nouvel objet -> reference DB -> suppression ancien, sans URL persistante', async () => {
    expect(await uploadEmployeeProfilePhotoAction(form())).toEqual({})
    expect(state.events).toEqual(['upload', 'db', 'remove'])
    const [newPath, , options] = state.upload.mock.calls[0]
    expect(isEmployeePhotoPath(newPath, ORG, EMPLOYEE)).toBe(true)
    expect(newPath).not.toContain('nom-utilisateur')
    expect(options).toMatchObject({ upsert: false, contentType: 'image/jpeg' })
    expect(state.writes).toEqual([{ photo_storage_path: newPath }])
    expect(state.filters).toContainEqual(['photo_storage_path', OLD])
    expect(state.remove).toHaveBeenCalledWith([OLD])
    expect(state.revalidate).toHaveBeenCalledWith(`/rh/employes/${EMPLOYEE}`)
  })
  it('ajout sans ancienne photo', async () => {
    state.oldPath = null
    expect(await uploadEmployeeProfilePhotoAction(form())).toEqual({})
    expect(state.events).toEqual(['upload', 'db'])
    expect(state.filters).toContainEqual(['photo_storage_path', null])
  })
  it.each(['dbError', 'zeroRows'] as const)('compense %s et conserve ancien', async (failure) => {
    state[failure] = true
    expect((await uploadEmployeeProfilePhotoAction(form())).error).toBeTruthy()
    expect(state.events).toEqual(['upload', 'db', 'remove'])
    expect(state.remove).toHaveBeenCalledExactlyOnceWith([state.upload.mock.calls[0][0]])
    expect(state.revalidate).not.toHaveBeenCalled()
  })
  it('echec upload laisse DB et ancien intacts', async () => {
    state.upload.mockResolvedValue({ error: {} })
    expect((await uploadEmployeeProfilePhotoAction(form())).error).toBeTruthy()
    expect(state.writes).toEqual([])
    expect(state.remove).not.toHaveBeenCalled()
  })
  it.each([uploadEmployeeProfilePhotoAction, removeEmployeeProfilePhotoAction])('refuse sans employee.update', async (action) => {
    state.allowed = false
    expect((await action(form())).error).toBeTruthy()
    expect(state.permission).toHaveBeenCalledWith(ORG, 'employee.update')
    expect(state.events).toEqual([])
  })
  it.each([uploadEmployeeProfilePhotoAction, removeEmployeeProfilePhotoAction])('refuse cross-organization', async (action) => {
    state.org = EMPLOYEE
    expect((await action(form())).error).toContain('organisation')
    expect(state.events).toEqual([])
  })
  it('refuse organisation absente, employe absent, fichier absent/invalide/trop gros', async () => {
    state.org = null
    expect((await uploadEmployeeProfilePhotoAction(form())).error).toBeTruthy()
    state.org = ORG
    state.missing = true
    expect((await uploadEmployeeProfilePhotoAction(form())).error).toBeTruthy()
    state.missing = false
    for (const file of [null, 'fake', new File(['x'], 'x', { type: 'image/svg+xml' }),
      new File([new Uint8Array(EMPLOYEE_PHOTO_MAX_BYTES + 1)], 'x', { type: 'image/png' })]) {
      expect((await uploadEmployeeProfilePhotoAction(form(file))).error).toBeTruthy()
    }
    expect(state.events).toEqual([])
  })
  it('suppression : DB null avant Storage', async () => {
    expect(await removeEmployeeProfilePhotoAction(form(null))).toEqual({})
    expect(state.events).toEqual(['db', 'remove'])
    expect(state.writes).toEqual([{ photo_storage_path: null }])
    expect(state.remove).toHaveBeenCalledWith([OLD])
  })
  it('suppression : echec DB conserve objet', async () => {
    state.dbError = true
    expect((await removeEmployeeProfilePhotoAction(form(null))).error).toBeTruthy()
    expect(state.remove).not.toHaveBeenCalled()
  })
  it('signale un nettoyage echoue apres succes sans annuler la nouvelle reference', async () => {
    state.remove.mockResolvedValue({ error: {} })
    expect((await uploadEmployeeProfilePhotoAction(form())).warning).toBeTruthy()
    expect(state.revalidate).toHaveBeenCalled()
    expect(state.writes).toHaveLength(1)
  })
  it('signale une compensation echouee, sans exposer URL ou details Storage', async () => {
    state.dbError = true
    state.remove.mockRejectedValue(new Error('https://secret.test/path?token=secret'))
    const result = await uploadEmployeeProfilePhotoAction(form())
    expect(result.error).toContain('nettoyage')
    expect(JSON.stringify(result)).not.toContain('secret')
  })
})

describe('lecture ephemere cote serveur', () => {
  it('signe uniquement pour 60s, sans ecriture', async () => {
    expect(await getEmployeePhotoSignedUrl(await createClient(), ORG, EMPLOYEE, OLD)).toContain('?token=')
    expect(state.sign).toHaveBeenCalledWith(OLD, 60)
    expect(state.writes).toEqual([])
  })
  it('fallback silencieux si absente, hors perimetre ou Storage en echec', async () => {
    const client = await createClient()
    expect(await getEmployeePhotoSignedUrl(client, ORG, EMPLOYEE, null)).toBeUndefined()
    expect(await getEmployeePhotoSignedUrl(client, EMPLOYEE, ORG, OLD)).toBeUndefined()
    expect(state.sign).not.toHaveBeenCalled()
    state.sign.mockResolvedValue({ error: {} })
    expect(await getEmployeePhotoSignedUrl(client, ORG, EMPLOYEE, OLD)).toBeUndefined()
    state.sign.mockRejectedValue(new Error('offline'))
    expect(await getEmployeePhotoSignedUrl(client, ORG, EMPLOYEE, OLD)).toBeUndefined()
  })
})

describe('configuration et absence de persistance des URL', () => {
  const root = path.resolve(__dirname, '../..')
  const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')
  const migration = read('supabase/migrations/20260905090001_employee_profile_photos.sql')
  it('bucket prive borne en taille et MIME, garde DB et chemin strict', () => {
    expect(migration).toContain("'employee-photos', 'employee-photos', false, 3145728")
    expect(migration).toContain("array['image/jpeg', 'image/png', 'image/webp']")
    expect(migration).toContain('employees_photo_storage_path_check')
    expect(migration).toContain('before insert or update on public.employees')
    expect(migration).not.toMatch(/drop column|security definer/i)
  })
  it('aucune URL publique, aucun stockage client ni audit de signed URL', () => {
    for (const file of ['app/actions/employee-photos.ts', 'lib/storage/employee-photo-url.ts',
      'components/hr/employee-profile/avatar.tsx', 'components/hr/employee-profile/photo-controls.tsx']) {
      expect(read(file)).not.toMatch(/getPublicUrl|localStorage|sessionStorage|console\.|photo_url|service_role|createAdminClient/)
    }
    expect(read('next.config.ts')).toContain('bodySizeLimit: "4mb"')
  })
})
