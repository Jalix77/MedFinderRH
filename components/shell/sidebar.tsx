'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { NavItem } from '@/lib/navigation'

/**
 * Navigation mobile (Phase 1C-UI, regles UX) : sur petit ecran, la
 * sidebar devient un tiroir declenche par un bouton hamburger, ferme par
 * defaut pour ne pas masquer le contenu. Sur desktop (sm: et plus),
 * comportement inchange (colonne fixe toujours visible).
 */
export function Sidebar({ items }: { items: NavItem[] }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const nav = (
    <nav className="flex h-full w-60 flex-col gap-1 bg-mf-navy-950 p-4">
      <div className="mb-6 flex items-center justify-between px-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-mf-emerald-500">
            MedFinder Haiti
          </p>
          <p className="text-sm font-bold text-white">MedFinder Gestion</p>
        </div>
        <button
          type="button"
          aria-label="Fermer le menu"
          onClick={() => setOpen(false)}
          className="rounded-lg p-1 text-slate-300 hover:bg-mf-navy-800 sm:hidden"
        >
          ✕
        </button>
      </div>
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
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

  return (
    <>
      {/* Bouton hamburger — visible uniquement sous le point de rupture sm. */}
      <button
        type="button"
        aria-label="Ouvrir le menu"
        onClick={() => setOpen(true)}
        className="fixed left-3 top-3 z-40 rounded-lg bg-mf-navy-950 p-2 text-white shadow-lg sm:hidden"
      >
        ☰
      </button>

      {/* Desktop : colonne fixe toujours presente. */}
      <div className="hidden sm:block">{nav}</div>

      {/* Mobile : tiroir + fond assombri, uniquement quand ouvert. */}
      {open && (
        <div className="fixed inset-0 z-50 flex sm:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="relative z-10">{nav}</div>
        </div>
      )}
    </>
  )
}
