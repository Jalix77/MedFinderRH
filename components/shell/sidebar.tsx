'use client'

import type { NavItem } from '@/lib/navigation'
import { groupItems } from './navigation-groups'
import { SidebarNav } from './sidebar-nav'
import { SidebarAccount } from './sidebar-account'

export function Sidebar({ items, userName, roleLabel, onNavigate, onClose }: {
  items: NavItem[]
  userName: string
  roleLabel: string
  onNavigate?: () => void
  onClose?: () => void
}) {
  return (
    <nav aria-label="Navigation principale" className="flex h-full w-[292px] max-w-[calc(100vw-32px)] shrink-0 flex-col border-r border-mf-border bg-mf-surface">
      <div className="flex shrink-0 items-center justify-between px-5 py-5">
        <div>
          <p className="text-[15px] font-semibold tracking-tight text-[var(--mf-text)]">MedFinder</p>
          <p className="mt-0.5 text-[12px] text-[var(--mf-text-5)]">Gestion</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Fermer le menu"
          className="rounded-md px-2 py-1 text-[13px] text-[var(--mf-text-5)] hover:bg-[var(--mf-hover)] lg:hidden">Fermer</button>
      </div>
      <SidebarNav groups={groupItems(items)} onNavigate={onNavigate} />
      <SidebarAccount userName={userName} roleLabel={roleLabel} />
    </nav>
  )
}
