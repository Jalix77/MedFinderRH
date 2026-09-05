'use client'

export function Header({ organizationName, breadcrumb, onOpenMenu, menuOpen }: {
  organizationName: string
  breadcrumb: string[]
  onOpenMenu: () => void
  menuOpen: boolean
}) {
  return (
    <header className="flex min-h-16 shrink-0 items-center gap-4 border-b border-mf-border bg-mf-surface px-4 py-3 lg:px-8">
      <button type="button" onClick={onOpenMenu} aria-expanded={menuOpen} aria-controls="mobile-navigation"
        className="shrink-0 rounded-md border border-mf-border px-3 py-1.5 text-[13px] text-[var(--mf-text-3)] lg:hidden">
        Menu
      </button>
      <nav aria-label="Fil d’Ariane" className="min-w-0 flex-1">
        <ol className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          {breadcrumb.map((crumb, index) => (
            <li key={crumb} className="flex min-w-0 items-center gap-2.5">
              {index > 0 && <span aria-hidden className="text-[13px] text-[var(--mf-neutral-3)]">/</span>}
              <span aria-current={index === breadcrumb.length - 1 ? 'page' : undefined}
                className={index === breadcrumb.length - 1
                  ? 'text-[15px] font-semibold text-[var(--mf-text)] [overflow-wrap:anywhere]'
                  : 'text-[12.5px] font-medium uppercase tracking-[0.13em] text-[var(--mf-text-6)]'}>{crumb}</span>
            </li>
          ))}
        </ol>
      </nav>
      <span title={organizationName} className="hidden min-w-0 max-w-[280px] truncate text-[13px] text-[var(--mf-text-5)] xl:inline-block">
        {organizationName}
      </span>
    </header>
  )
}
