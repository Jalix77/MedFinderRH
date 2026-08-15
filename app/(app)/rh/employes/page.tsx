import type { Metadata } from 'next'
import Link from 'next/link'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { AccessDenied } from '@/components/shell/access-denied'

export const metadata: Metadata = { title: 'Employes — MedFinder Gestion' }

type EmployeeRow = {
  id: string
  matricule: string
  first_name: string
  last_name: string
  status: string
  hire_date: string
  departments: { name: string } | null
  positions: { title: string } | null
}

export default async function EmployeesPage() {
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />

  const canView = await hasPermission(orgId, 'employee.view')
  if (!canView) return <AccessDenied />

  const canCreate = await hasPermission(orgId, 'employee.create')

  const supabase = await createClient()
  const { data } = await supabase
    .from('employees')
    .select('id, matricule, first_name, last_name, status, hire_date, departments ( name ), positions ( title )')
    .order('matricule')

  const employees = (data ?? []) as unknown as EmployeeRow[]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-mf-navy-900">Employes</h1>
        {canCreate && (
          <Link
            href="/rh/employes/nouveau"
            className="rounded-lg bg-mf-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-emerald-500"
          >
            + Nouvel employe
          </Link>
        )}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-mf-border bg-mf-surface shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Matricule</th>
              <th className="px-4 py-2">Nom</th>
              <th className="px-4 py-2">Departement</th>
              <th className="px-4 py-2">Poste</th>
              <th className="px-4 py-2">Statut</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id} className="border-t border-mf-border hover:bg-slate-50">
                <td className="px-4 py-2">
                  <Link href={`/rh/employes/${e.id}`} className="font-medium text-mf-navy-700 hover:underline">
                    {e.matricule}
                  </Link>
                </td>
                <td className="px-4 py-2 text-mf-navy-900">
                  {e.first_name} {e.last_name}
                </td>
                <td className="px-4 py-2">{e.departments?.name ?? '—'}</td>
                <td className="px-4 py-2">{e.positions?.title ?? '—'}</td>
                <td className="px-4 py-2">
                  <span
                    className={
                      e.status === 'active'
                        ? 'text-mf-emerald-600'
                        : e.status === 'terminated'
                          ? 'text-mf-danger'
                          : 'text-amber-600'
                    }
                  >
                    {e.status}
                  </span>
                </td>
              </tr>
            ))}
            {employees.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  Aucun employe visible.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
