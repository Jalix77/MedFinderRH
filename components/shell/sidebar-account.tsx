'use client'

import { useEffect, useRef, useState } from 'react'
import { logoutAction } from '@/app/actions/auth'
import { APPEARANCES, type AppearanceId } from '@/lib/theme/appearance'
import { useAppearance } from './theme'

/**
 * Zone de compte en bas de la sidebar, issue du stash prototype-ui-apercu-direction.
 *
 * Ordre du prototype : profil, reglages visuels, puis deconnexion.
 *
 * La deconnexion reutilise `logoutAction`, la Server Action deja employee
 * par le header de production. Aucune logique d'authentification n'est
 * creee ni modifiee : c'est le meme `<form action={logoutAction}>`.
 *
 * Les reglages d'apparence sont PUREMENT visuels et locaux au
 * navigateur (localStorage). Ils n'ecrivent rien en base, ne declenchent
 * aucune requete et ne touchent a aucune preference serveur.
 */

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Popover ferme au clic exterieur et a la touche Echap. */
function Popover({
  label,
  title,
  children,
}: {
  label: string
  title: string
  children: (close: () => void) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const close = () => setOpen(false)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    ref.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
    return () => {
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  return (
    <div ref={ref} className="relative flex-1" onKeyDown={event => {
      if (!open) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); triggerRef.current?.focus() }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const options = [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])]
      const index = options.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
      options[next]?.focus()
    }}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="w-full rounded-lg border border-[var(--mf-border)] bg-[var(--mf-surface)] px-3 py-2 text-[13px] font-medium text-[var(--mf-text-2)] transition-colors hover:bg-[var(--mf-hover)]"
      >
        {label}
      </button>

      {open && (
        <div
          role="menu"
          aria-label={title}
          onClick={event => {
            if ((event.target as HTMLElement).closest('[role="menuitemradio"]')) triggerRef.current?.focus()
          }}
          className="absolute bottom-[calc(100%+8px)] left-0 z-30 w-[236px] rounded-xl border border-[var(--mf-border)] bg-[var(--mf-surface)] p-2 shadow-[0_12px_28px_-12px_rgba(10,26,47,0.28)]"
        >
          <p className="px-2 pb-2 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--mf-text-7)]">
            {title}
          </p>
          {children(close)}
        </div>
      )}
    </div>
  )
}

export function SidebarAccount({
  userName,
  roleLabel,
}: {
  userName: string
  roleLabel: string
}) {
  const { appearance, setAppearance } = useAppearance()

  return (
    <div className="shrink-0 space-y-3 border-t border-[var(--mf-border)] px-4 py-4">
      {/* --- Profil --- */}
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-[var(--mf-border)] bg-[var(--mf-active)] text-[12px] font-semibold text-[var(--mf-text-2)]"
        >
          {initials(userName)}
        </span>
        <div className="min-w-0">
          <p title={userName} className="truncate text-[14px] font-medium text-[var(--mf-text)]">{userName}</p>
          <p className="truncate text-[12px] text-[var(--mf-text-5)]" title={roleLabel}>
            {roleLabel}
          </p>
        </div>
      </div>

      {/* --- Reglages visuels --- */}
      <div className="flex gap-2">
        <Popover label="Apparence" title="Apparence">
          {(close) => (
            <ul className="space-y-0.5">
              {APPEARANCES.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={appearance === option.id}
                    onClick={() => {
                      setAppearance(option.id as AppearanceId)
                      close()
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-[13px] transition-colors hover:bg-[var(--mf-hover)] ${
                      appearance === option.id
                        ? 'font-medium text-[var(--mf-text)]'
                        : 'text-[var(--mf-text-3)]'
                    }`}
                  >
                    {option.label}
                    {appearance === option.id && (
                      <span aria-hidden className="mf-accent-bg size-1.5 rounded-full" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Popover>
      </div>

      {/* --- Deconnexion : meme Server Action que le header de production --- */}
      <form action={logoutAction}>
        <button
          type="submit"
          className="w-full rounded-lg border border-[var(--mf-border)] bg-[var(--mf-surface)] px-3 py-2 text-[13px] font-medium text-[var(--mf-text-2)] transition-colors hover:bg-[var(--mf-hover)]"
        >
          Deconnexion
        </button>
      </form>
    </div>
  )
}
