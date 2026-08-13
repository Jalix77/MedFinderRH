'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { NavItem } from '@/lib/navigation'

export function Sidebar({ items }: { items: NavItem[] }) {
  const pathname = usePathname()

  return (
    <nav className="flex h-full w-60 flex-col gap-1 bg-mf-navy-950 p-4">
      <div className="mb-6 px-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-mf-emerald-500">
          MedFinder Haiti
        </p>
        <p className="text-sm font-bold text-white">MedFinder Gestion</p>
      </div>
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
              active
                ? 'bg-mf-emerald-600 text-white'
                : 'text-slate-300 hover:bg-mf-navy-800 hover:text-white'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
