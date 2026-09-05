'use client'

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

/**
 * Coquille interactive de la fiche employe : bandeau profil, bascule
 * consultation/edition, et navigation par onglets.
 *
 * Tout le contenu arrive deja rendu depuis le serveur (`identity`, et
 * chaque panneau) : ce composant ne connait ni les donnees, ni les
 * permissions. Les formulaires qu'il affiche sont les formulaires
 * d'origine, avec leurs server actions inchangees — il decide seulement
 * lesquels sont visibles.
 *
 * Pas de librairie d'onglets : quatre boutons et un etat suffisent, et
 * l'accessibilite (roles ARIA, fleches, Home/End) tient en quelques
 * lignes.
 */

export type ProfilePanel = {
  id: string
  label: string
  /** Vue de consultation, toujours presente. */
  view: ReactNode
  /** Formulaire equivalent, si l'utilisateur a le droit de modifier. */
  edit?: ReactNode
}

export function ProfileWorkspace({
  identity,
  secondaryAction,
  canEdit,
  panels,
}: {
  identity: ReactNode
  secondaryAction?: ReactNode
  canEdit: boolean
  panels: ProfilePanel[]
}) {
  const [activeId, setActiveId] = useState(panels[0]?.id ?? '')
  const [editing, setEditing] = useState(false)
  const baseId = useId()
  // Refs plutot qu'une recherche par id : `useId` produit des identifiants
  // contenant des caracteres a echapper en selecteur CSS.
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())

  const activeIndex = Math.max(0, panels.findIndex((p) => p.id === activeId))
  const active = panels[activeIndex]

  function focusTab(index: number) {
    const next = panels[(index + panels.length) % panels.length]
    if (!next) return
    setActiveId(next.id)
    // Le focus suit la selection : c'est le comportement attendu d'un
    // tablist a activation automatique.
    tabRefs.current.get(next.id)?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowRight') focusTab(activeIndex + 1)
    else if (event.key === 'ArrowLeft') focusTab(activeIndex - 1)
    else if (event.key === 'Home') focusTab(0)
    else if (event.key === 'End') focusTab(panels.length - 1)
    else return
    event.preventDefault()
  }

  return (
    <div className="space-y-6">
      {/* --- Bandeau profil ------------------------------------------- */}
      <div className="overflow-hidden rounded-2xl border border-mf-border bg-mf-surface shadow-sm">
        {/* Decor abstrait, sans image externe : un degrade navy et deux
            voiles tres faibles. Rien qui attire l'oeil avant le nom. */}
        <div
          aria-hidden
          className="relative h-24 sm:h-28"
          style={{
            backgroundImage: `linear-gradient(105deg, var(--mf-navy-950), var(--mf-navy-800) 58%, var(--mf-navy-700))`,
          }}
        >
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `radial-gradient(120% 180% at 88% -40%, color-mix(in srgb, var(--mf-emerald-500) 26%, transparent), transparent 62%), repeating-linear-gradient(115deg, rgba(255,255,255,0.045) 0 1px, transparent 1px 22px)`,
            }}
          />
        </div>

        <div className="px-5 pb-5 sm:px-8 sm:pb-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="-mt-11 sm:-mt-14">{identity}</div>

            {(canEdit || secondaryAction) && (
              <div className="flex flex-wrap items-center gap-2 sm:pb-1">
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setEditing((v) => !v)}
                    aria-pressed={editing}
                    className={
                      editing
                        ? 'rounded-lg border border-mf-border px-4 py-2 text-sm font-semibold text-mf-navy-700 hover:bg-slate-50'
                        : 'rounded-lg bg-mf-navy-900 px-4 py-2 text-sm font-semibold text-white hover:bg-mf-navy-800'
                    }
                  >
                    {editing ? "Quitter l'edition" : 'Modifier'}
                  </button>
                )}
                {secondaryAction}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* --- Onglets --------------------------------------------------- */}
      <div className="-mx-1 overflow-x-auto px-1">
        <div
          role="tablist"
          aria-label="Sections de la fiche employe"
          onKeyDown={onKeyDown}
          className="flex min-w-max gap-1 border-b border-mf-border"
        >
          {panels.map((panel) => {
            const selected = panel.id === active?.id
            return (
              <button
                key={panel.id}
                id={`${baseId}-tab-${panel.id}`}
                ref={(node) => {
                  if (node) tabRefs.current.set(panel.id, node)
                  else tabRefs.current.delete(panel.id)
                }}
                role="tab"
                type="button"
                aria-selected={selected}
                aria-controls={`${baseId}-panel-${panel.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveId(panel.id)}
                className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mf-navy-700 ${
                  selected
                    ? 'border-mf-emerald-600 text-mf-navy-900'
                    : 'border-transparent text-slate-500 hover:text-mf-navy-900'
                }`}
              >
                {panel.label}
              </button>
            )
          })}
        </div>
      </div>

      {editing && (
        <p className="rounded-xl bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20">
          Mode edition — les sections modifiables affichent leur formulaire.
        </p>
      )}

      {active && (
        <div
          id={`${baseId}-panel-${active.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${active.id}`}
          tabIndex={0}
          className="focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-mf-navy-700"
        >
          {editing && active.edit ? active.edit : active.view}
        </div>
      )}
    </div>
  )
}
