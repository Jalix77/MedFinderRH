import type { Metadata } from 'next'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import {
  createDepartmentAction,
  createPositionAction,
  setDepartmentStatusAction,
  setPositionStatusAction,
} from '@/app/actions/hr'

export const metadata: Metadata = { title: 'Departements & postes — MedFinder Gestion' }

type Department = { id: string; name: string; status: string }
type Position = {
  id: string
  title: string
  department_id: string | null
  status: string
  departments: { name: string } | null
}

export default async function DepartmentsPage() {
  const orgId = await getActiveOrganizationId()
  if (!orgId) return null

  const [canManageDepartments, canManagePositions] = await Promise.all([
    hasPermission(orgId, 'department.manage'),
    hasPermission(orgId, 'position.manage'),
  ])

  const supabase = await createClient()
  const [{ data: departments }, { data: positions }] = await Promise.all([
    supabase.from('departments').select('id, name, status').order('name'),
    supabase
      .from('positions')
      .select('id, title, department_id, status, departments ( name )')
      .order('title'),
  ])

  const deptList = (departments ?? []) as Department[]
  const posList = (positions ?? []) as unknown as Position[]

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-bold text-mf-navy-900">Departements &amp; postes</h1>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-mf-navy-900">Departements</h2>

        {canManageDepartments && (
          <form
            action={createDepartmentAction}
            className="flex flex-wrap items-end gap-3 rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm"
          >
            <div>
              <label className="block text-xs font-medium text-mf-navy-900">Nom</label>
              <input
                name="name"
                required
                className="mt-1 rounded-lg border border-mf-border px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="rounded-lg bg-mf-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-emerald-500"
            >
              Ajouter
            </button>
          </form>
        )}

        <div className="overflow-x-auto rounded-2xl border border-mf-border bg-mf-surface shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Nom</th>
                <th className="px-4 py-2">Statut</th>
                {canManageDepartments && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody>
              {deptList.map((d) => (
                <tr key={d.id} className="border-t border-mf-border">
                  <td className="px-4 py-2 font-medium text-mf-navy-900">{d.name}</td>
                  <td className="px-4 py-2">
                    <span className={d.status === 'active' ? 'text-mf-emerald-600' : 'text-slate-400'}>
                      {d.status}
                    </span>
                  </td>
                  {canManageDepartments && (
                    <td className="px-4 py-2">
                      <form action={setDepartmentStatusAction}>
                        <input type="hidden" name="id" value={d.id} />
                        <input
                          type="hidden"
                          name="status"
                          value={d.status === 'active' ? 'inactive' : 'active'}
                        />
                        <button type="submit" className="text-xs text-mf-navy-700 hover:underline">
                          {d.status === 'active' ? 'Desactiver' : 'Reactiver'}
                        </button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
              {deptList.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                    Aucun departement.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-mf-navy-900">Postes</h2>

        {canManagePositions && (
          <form
            action={createPositionAction}
            className="flex flex-wrap items-end gap-3 rounded-2xl border border-mf-border bg-mf-surface p-4 shadow-sm"
          >
            <div>
              <label className="block text-xs font-medium text-mf-navy-900">Titre</label>
              <input
                name="title"
                required
                className="mt-1 rounded-lg border border-mf-border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-mf-navy-900">Departement</label>
              <select name="department_id" className="mt-1 rounded-lg border border-mf-border px-3 py-2 text-sm">
                <option value="">—</option>
                {deptList.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="rounded-lg bg-mf-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-emerald-500"
            >
              Ajouter
            </button>
          </form>
        )}

        <div className="overflow-x-auto rounded-2xl border border-mf-border bg-mf-surface shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Titre</th>
                <th className="px-4 py-2">Departement</th>
                <th className="px-4 py-2">Statut</th>
                {canManagePositions && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody>
              {posList.map((p) => (
                <tr key={p.id} className="border-t border-mf-border">
                  <td className="px-4 py-2 font-medium text-mf-navy-900">{p.title}</td>
                  <td className="px-4 py-2">{p.departments?.name ?? '—'}</td>
                  <td className="px-4 py-2">
                    <span className={p.status === 'active' ? 'text-mf-emerald-600' : 'text-slate-400'}>
                      {p.status}
                    </span>
                  </td>
                  {canManagePositions && (
                    <td className="px-4 py-2">
                      <form action={setPositionStatusAction}>
                        <input type="hidden" name="id" value={p.id} />
                        <input
                          type="hidden"
                          name="status"
                          value={p.status === 'active' ? 'inactive' : 'active'}
                        />
                        <button type="submit" className="text-xs text-mf-navy-700 hover:underline">
                          {p.status === 'active' ? 'Desactiver' : 'Reactiver'}
                        </button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
              {posList.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                    Aucun poste.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
