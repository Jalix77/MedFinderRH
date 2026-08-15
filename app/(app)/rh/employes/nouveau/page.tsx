import type { Metadata } from 'next'
import { getActiveOrganizationId } from '@/lib/auth/active-org'
import { hasPermission } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import { AccessDenied } from '@/components/shell/access-denied'
import { createEmployeeAction } from '@/app/actions/hr'

export const metadata: Metadata = { title: 'Nouvel employe — MedFinder Gestion' }

export default async function NewEmployeePage() {
  const orgId = await getActiveOrganizationId()
  if (!orgId) return <AccessDenied />

  const canCreate = await hasPermission(orgId, 'employee.create')
  if (!canCreate) return <AccessDenied />

  const supabase = await createClient()
  const [{ data: departments }, { data: positions }] = await Promise.all([
    supabase.from('departments').select('id, name').eq('status', 'active').order('name'),
    supabase.from('positions').select('id, title').eq('status', 'active').order('title'),
  ])

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-xl font-bold text-mf-navy-900">Nouvel employe</h1>
      <p className="text-sm text-slate-500">
        Le matricule (EMP-0001, ...) est genere automatiquement. Les donnees tres
        sensibles (NIF, CIN, adresse...) se saisissent ensuite sur la fiche de
        l&apos;employe.
      </p>

      <form
        action={createEmployeeAction}
        className="space-y-4 rounded-2xl border border-mf-border bg-mf-surface p-6 shadow-sm"
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-mf-navy-900">Prenom</label>
            <input name="first_name" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-mf-navy-900">Nom</label>
            <input name="last_name" required className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-mf-navy-900">Genre</label>
            <select name="gender" className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm">
              <option value="">—</option>
              <option value="F">F</option>
              <option value="M">M</option>
              <option value="autre">Autre</option>
              <option value="non_precise">Non precise</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-mf-navy-900">Date d&apos;embauche</label>
            <input
              type="date"
              name="hire_date"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
              className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-mf-navy-900">Departement</label>
            <select name="department_id" className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm">
              <option value="">—</option>
              {(departments ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-mf-navy-900">Poste</label>
            <select name="position_id" className="mt-1 w-full rounded-lg border border-mf-border px-3 py-2 text-sm">
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
          Creer l&apos;employe
        </button>
      </form>
    </div>
  )
}
