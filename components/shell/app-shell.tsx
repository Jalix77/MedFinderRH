'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import type { NavItem } from '@/lib/navigation'
import { Header } from './header'
import { Sidebar } from './sidebar'
import { navigationBreadcrumb } from './navigation-groups'
import { SpecularSurfaceProvider } from '@/components/specular/specular-surface-provider'

// Geometrie du preview-shell canonique ; seuls les liens deja autorises arrivent ici.
export function AppShell({ items, organizationName, userName, roleLabel, children }: {
  items: NavItem[]
  organizationName: string
  userName: string
  roleLabel: string
  children: ReactNode
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const drawerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    drawerRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const desktop = window.matchMedia('(min-width: 1024px)')
    const onResize = () => { if (desktop.matches) setOpen(false) }
    desktop.addEventListener('change', onResize)
    return () => {
      document.body.style.overflow = previousOverflow
      desktop.removeEventListener('change', onResize)
      previousFocus?.focus()
    }
  }, [open])

  const sidebar = <Sidebar items={items} userName={userName} roleLabel={roleLabel}
    onNavigate={() => setOpen(false)} onClose={() => setOpen(false)} />

  return (
    <SpecularSurfaceProvider>
    <div data-mf-app className="flex min-h-[100dvh] bg-background text-foreground">
      <div className="sticky top-0 hidden h-[100dvh] shrink-0 lg:block">{sidebar}</div>
      {open && (
        <div id="mobile-navigation" role="dialog" aria-modal="true" aria-label="Menu de navigation"
          className="fixed inset-0 z-50 flex lg:hidden" ref={drawerRef}
          onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
            if (event.key !== 'Tab') return
            const focusable = [...(drawerRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex="0"]') ?? [])]
            const first = focusable[0]
            const last = focusable[focusable.length - 1]
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
            if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
          }}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
          <div className="relative z-10 h-full">{sidebar}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <Header organizationName={organizationName} breadcrumb={navigationBreadcrumb(items, pathname)}
          onOpenMenu={() => setOpen(true)} menuOpen={open} />
        <main className="min-w-0 flex-1 px-4 py-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full min-w-0 max-w-[1720px]">{children}</div>
        </main>
      </div>
    </div>
    </SpecularSurfaceProvider>
  )
}
