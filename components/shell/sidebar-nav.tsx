'use client'

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { NavItem } from '@/lib/navigation'

/**
 * Navigation issue du stash prototype-ui-apercu-direction, avec le langage d'interaction de LineSidebar
 * (React Bits) ADAPTE — le composant brut n'est pas utilise.
 *
 * Ce qui est repris du registry (LineSidebar-JS-CSS) :
 *   - une propriete CSS `--effect` (0 a 1) posee par item ;
 *   - une cible calculee a la distance verticale du pointeur :
 *     `ease(max(0, 1 - distance / proximityRadius))` ;
 *   - la courbe `smooth` = smoothstep `p * p * (3 - 2p)` ;
 *   - le lissage exponentiel par rAF `k = 1 - exp(-dt / tau)`, avec seuil
 *     de stabilisation et arret de la boucle une fois immobile ;
 *   - le marqueur horizontal dont la couleur et l'echelle suivent l'effet.
 *
 * Ce qui est DELIBEREMENT different, parce que le composant brut ne
 * conviendrait pas a un ERP :
 *   - de vrais `<Link>` Next, pas des `<li onClick>` : la navigation reste
 *     du HTML navigable, indexable et ouvrable dans un nouvel onglet ;
 *   - l'etat actif vient de `usePathname()`, pas d'un `useState` interne ;
 *   - les groupes Pilotage / Finance / RH / Administration sont conserves,
 *     l'effet traverse les groupes comme une seule liste continue ;
 *   - le focus clavier produit le meme effet que le survol, sinon
 *     l'affordance n'existerait qu'a la souris ;
 *   - `prefers-reduced-motion` coupe la boucle : plus aucun mouvement, et
 *     seul l'item actif reste marque ;
 *   - aucune couleur en dur : l'accent est `var(--mf-accent)`, donc la
 *     palette choisie et le mode clair/sombre s'appliquent d'office.
 *
 * Le registry ne declare ni `dependencies` ni `registryDependencies` :
 * aucun paquet n'a ete installe.
 */

/** Valeurs calees sur la demande : discretion avant tout. */
const PROXIMITY_RADIUS = 80
const MAX_SHIFT = 9
const SMOOTHING_MS = 140
const SETTLE_EPSILON = 0.0015

/** Courbe `smooth` du registry (smoothstep). */
function smoothstep(p: number): number {
  return p * p * (3 - 2 * p)
}

/**
 * `prefers-reduced-motion` lu comme une source externe plutot que via un
 * `useState` synchronise dans un effet : c'est exactement le cas d'usage de
 * useSyncExternalStore, et cela evite un rendu en cascade au montage.
 */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

export type NavGroup = { group: string; items: NavItem[] }

export function SidebarNav({
  groups,
  onNavigate,
}: {
  groups: NavGroup[]
  onNavigate?: () => void
}) {
  const pathname = usePathname()
  const containerRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([])
  const targetsRef = useRef<number[]>([])
  const currentRef = useRef<number[]>([])
  const rafRef = useRef<number | null>(null)
  const lastRef = useRef(0)
  const pinnedRef = useRef<Set<number>>(new Set())
  // Reference stable vers la frame courante : une fonction rAF doit pouvoir
  // se replanifier elle-meme, ce qu'un useCallback ne permet pas de faire
  // directement sans se referencer avant sa propre declaration.
  const frameRef = useRef<(now: number) => void>(() => {})

  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false
  )

  // Index plat sur l'ensemble des groupes : l'effet doit traverser les
  // separations de groupe, sinon il repartirait de zero a chaque titre.
  const flat: { item: NavItem; index: number }[] = []
  let cursor = 0
  const indexedGroups = groups.map((g) => ({
    group: g.group,
    items: g.items.map((item) => {
      const entry = { item, index: cursor++ }
      flat.push(entry)
      return entry
    }),
  }))

  const activeIndex = flat.findIndex(
    ({ item }) => pathname === item.href || pathname.startsWith(`${item.href}/`)
  )

  /** Une frame de lissage exponentiel, transposee du registry. */
  const runFrame = useCallback((now: number) => {
    const dt = Math.min((now - lastRef.current) / 1000, 0.05)
    lastRef.current = now
    const tau = Math.max(SMOOTHING_MS, 1) / 1000
    const k = 1 - Math.exp(-dt / tau)

    let moving = false
    const items = itemRefs.current
    for (let i = 0; i < items.length; i++) {
      const el = items[i]
      if (!el) continue
      const pinned = pinnedRef.current.has(i) ? 1 : 0
      const target = Math.max(targetsRef.current[i] ?? 0, pinned)
      const cur = currentRef.current[i] ?? 0
      const next = cur + (target - cur) * k
      const settled = Math.abs(target - next) < SETTLE_EPSILON
      const value = settled ? target : next
      currentRef.current[i] = value
      el.style.setProperty('--effect', value.toFixed(4))
      if (!settled) moving = true
    }

    rafRef.current = moving ? requestAnimationFrame(frameRef.current) : null
  }, [])

  useEffect(() => {
    frameRef.current = runFrame
  }, [runFrame])

  const startLoop = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    lastRef.current = performance.now()
    rafRef.current = requestAnimationFrame(runFrame)
  }, [runFrame])

  /** Sans animation : etat final pose directement, aucune boucle lancee. */
  const applyStatic = useCallback(() => {
    itemRefs.current.forEach((el, i) => {
      if (!el) return
      const value = pinnedRef.current.has(i) ? 1 : 0
      currentRef.current[i] = value
      el.style.setProperty('--effect', String(value))
    })
  }, [])

  const settle = useCallback(() => {
    if (reduced) applyStatic()
    else startLoop()
  }, [reduced, applyStatic, startLoop])

  // L'item actif reste marque en permanence, y compris sans mouvement.
  useEffect(() => {
    pinnedRef.current = new Set(activeIndex >= 0 ? [activeIndex] : [])
    settle()
  }, [activeIndex, settle])

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    },
    []
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (reduced) return
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      // `offsetTop` ignore le defilement, le pointeur non : on ramene les
      // deux dans le meme repere, sinon l'effet se decale des qu'on scrolle.
      const pointerY = e.clientY - rect.top + container.scrollTop
      const items = itemRefs.current
      for (let i = 0; i < items.length; i++) {
        const el = items[i]
        if (!el) continue
        const center = el.offsetTop + el.offsetHeight / 2
        const distance = Math.abs(pointerY - center)
        targetsRef.current[i] = smoothstep(Math.max(0, 1 - distance / PROXIMITY_RADIUS))
      }
      startLoop()
    },
    [reduced, startLoop]
  )

  const handlePointerLeave = useCallback(() => {
    targetsRef.current = targetsRef.current.map(() => 0)
    settle()
  }, [settle])

  /**
   * Le clavier doit produire la meme affordance que la souris.
   *
   * Le focus passe par le MEME canal que le pointeur (`targetsRef`) plutot
   * que par `pinnedRef` : ce dernier est reinitialise a chaque changement
   * d'item actif, ce qui effacait silencieusement la mise en avant au
   * focus. Constate a la mesure, pas suppose.
   */
  const focusItem = useCallback(
    (index: number, on: boolean) => {
      targetsRef.current[index] = on ? 1 : 0
      settle()
    },
    [settle]
  )

  /*
   * `overflow-x-clip` est une CORRECTION D'INTENTION, pas un masquage :
   * declarer `overflow-y: auto` force le navigateur a faire passer l'axe
   * horizontal de `visible` a `auto` (mesure : overflowX = "auto", alors
   * qu'aucun defilement horizontal n'a jamais ete voulu ici). Le decalage
   * de 9px du libelle au survol suffit alors a faire naitre une barre
   * horizontale au bas de ce conteneur. `clip` retablit le comportement
   * voulu — defilement vertical uniquement — et reste limite a ce seul
   * conteneur : aucun `overflow-x-hidden` global n'est pose.
   *
   * Rien ne peut etre rogne : le decalage de 9px tient dans le `pr-3` de
   * chaque lien, et le libelle le plus long mesure 161px pour 212px
   * disponibles.
   */
  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      className="relative min-h-0 flex-1 overflow-y-auto overflow-x-clip px-3 pb-5"
      style={
        {
          '--mf-nav-shift': `${MAX_SHIFT}px`,
          '--mf-nav-marker': '22px',
        } as React.CSSProperties
      }
    >
      {indexedGroups.map(({ group, items }) => (
        <div key={group} className="mb-6">
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-[var(--mf-text-7)]">
            {group}
          </p>
          <ul className="space-y-0.5">
            {items.map(({ item, index }) => {
              const active = index === activeIndex
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    ref={(el) => {
                      itemRefs.current[index] = el
                    }}
                    onClick={onNavigate}
                    onFocus={() => focusItem(index, true)}
                    onBlur={() => focusItem(index, false)}
                    aria-current={active ? 'page' : undefined}
                    className={`mf-nav-item relative flex items-center gap-3 rounded-lg py-2 pl-3.5 pr-3 text-[15px] ${
                      active
                        ? 'bg-[var(--mf-active)] font-medium text-[var(--mf-text)]'
                        : 'text-[var(--mf-text-2)] hover:bg-[var(--mf-hover)]'
                    }`}
                  >
                    {/* Filet vertical d'accent sur l'item actif : arbitrage
                        anterieur, conserve tel quel. */}
                    {active && (
                      <span
                        aria-hidden
                        className="mf-accent-bg absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full"
                      />
                    )}
                    {/* Marqueur de proximite, transpose du registry : sa
                        couleur et son echelle suivent `--effect`. Il occupe
                        la marge gauche, sans deplacer le libelle. */}
                    <span aria-hidden className="mf-nav-marker" />
                    {/* Emplacement d'icone reserve, inchange. */}
                    <span aria-hidden className="inline-block w-[18px] shrink-0" />
                    <span className="mf-nav-label">{item.label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
