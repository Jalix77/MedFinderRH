import { logoutAction } from '@/app/actions/auth'

export function Header({
  organizationName,
  userName,
  roleCodes,
}: {
  organizationName: string
  userName: string
  roleCodes: string[]
}) {
  return (
    <header className="flex items-center justify-between border-b border-mf-border bg-mf-surface px-6 py-3">
      <div>
        <p className="text-sm font-semibold text-mf-navy-900">{organizationName}</p>
        <p className="text-xs text-slate-500">{roleCodes.join(' · ') || 'Aucun role'}</p>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-slate-600">{userName}</span>
        <form action={logoutAction}>
          <button
            type="submit"
            className="rounded-lg border border-mf-border px-3 py-1.5 text-sm font-medium text-mf-navy-900 transition hover:bg-slate-50"
          >
            Deconnexion
          </button>
        </form>
      </div>
    </header>
  )
}
