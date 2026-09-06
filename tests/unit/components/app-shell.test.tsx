// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '@/components/shell/app-shell'
import { SidebarNav } from '@/components/shell/sidebar-nav'
import { groupItems, navigationBreadcrumb } from '@/components/shell/navigation-groups'
import { NAV_ITEMS } from '@/lib/navigation'
import { DARK_MODE_QUERY } from '@/lib/theme/appearance'

const state = vi.hoisted(() => ({ pathname: '/direction', logout: vi.fn<(formData: FormData) => Promise<void>>(async () => {}) }))
vi.mock('next/navigation', () => ({ usePathname: () => state.pathname }))
vi.mock('@/app/actions/auth', () => ({ logoutAction: state.logout }))
// The independent specular-engine suite owns WebGL lifecycle and scheduling.
vi.mock('@/components/specular/engine', () => ({ mountSpecular: () => () => {} }))

const queries = new Map<string, { matches: boolean; listeners: Set<() => void> }>()
const frames = new Map<number, FrameRequestCallback>()
let nextFrame = 0

beforeEach(() => {
  state.pathname = '/direction'
  state.logout.mockClear()
  queries.clear()
  frames.clear()
  vi.stubGlobal('matchMedia', (media: string) => {
    if (!queries.has(media)) queries.set(media, { matches: false, listeners: new Set() })
    const query = queries.get(media)!
    return { get matches() { return query.matches }, media,
      addEventListener: (_: string, callback: () => void) => query.listeners.add(callback),
      removeEventListener: (_: string, callback: () => void) => query.listeners.delete(callback),
    }
  })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
})
afterEach(() => vi.unstubAllGlobals())

function advanceFrames(count = 80) {
  let now = performance.now()
  act(() => {
    for (let i = 0; i < count; i++) {
      now += 16
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach(callback => callback(now))
    }
  })
}

function shell(items = NAV_ITEMS) {
  return <AppShell items={items} organizationName="Organisation test" userName="Compte Test" roleLabel="DG">
    <h1>Direction</h1>
  </AppShell>
}

describe('Shell — navigation reelle et compte', () => {
  it('garde tous les liens fournis, sans en inventer ni supprimer les inconnus', () => {
    const extra = { href: '/module-existant', label: 'Module existant', permission: null }
    const items = [...NAV_ITEMS, extra]
    expect(groupItems(items).flatMap(group => group.items).map(item => item.href).sort()).toEqual(items.map(item => item.href).sort())
    render(shell(items))
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' })
    expect(within(nav).getAllByRole('link')).toHaveLength(items.length)
    expect(within(nav).getByRole('link', { name: 'Accueil' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Module existant' })).toHaveAttribute('href', extra.href)
  })
  it('ne rend que les liens deja filtres et derive le fil d’Ariane de la route', () => {
    const items = NAV_ITEMS.filter(item => item.href === '/direction')
    render(shell(items))
    expect(screen.queryByRole('link', { name: 'Comptabilite' })).not.toBeInTheDocument()
    expect(navigationBreadcrumb(NAV_ITEMS, '/rh/employes/identifiant')).toEqual(['Ressources humaines', 'Employes'])
  })
  it('place la deconnexion dans la sidebar et appelle la meme action', async () => {
    render(shell())
    expect(within(screen.getByRole('banner')).queryByRole('button', { name: 'Deconnexion' })).not.toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' })
    await userEvent.click(within(nav).getByRole('button', { name: 'Deconnexion' }))
    expect(state.logout).toHaveBeenCalledOnce()
    expect(state.logout.mock.calls[0][0]).toBeInstanceOf(FormData)
  })
  it('ouvre le tiroir, contient le focus, ferme par Echap et restitue le focus', async () => {
    render(shell())
    const menu = screen.getByRole('button', { name: 'Menu' })
    await userEvent.click(menu)
    const dialog = screen.getByRole('dialog')
    const close = within(dialog).getByRole('button', { name: 'Fermer le menu' })
    const logout = within(dialog).getByRole('button', { name: 'Deconnexion' })
    expect(close).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')
    await userEvent.tab({ shift: true })
    expect(logout).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(menu).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
  })
  it('le menu apparence se ferme sans fermer le tiroir et le mode Systeme suit l’OS', async () => {
    render(shell())
    await userEvent.click(screen.getByRole('button', { name: 'Menu' }))
    const dialog = screen.getByRole('dialog')
    const appearance = within(dialog).getByRole('button', { name: 'Apparence' })
    await userEvent.click(appearance)
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(appearance).toHaveFocus()
    await userEvent.click(appearance)
    await userEvent.click(within(dialog).getByRole('menuitemradio', { name: 'Sombre' }))
    expect(document.documentElement).toHaveAttribute('data-mf-theme', 'dark')
    expect(localStorage.getItem('mf-appearance')).toBe('dark')
    await userEvent.click(appearance)
    await userEvent.click(within(dialog).getByRole('menuitemradio', { name: 'Système' }))
    const query = queries.get(DARK_MODE_QUERY)!
    act(() => { query.matches = true; query.listeners.forEach(listener => listener()) })
    expect(document.documentElement).toHaveAttribute('data-mf-theme', 'dark')
    act(() => { query.matches = false; query.listeners.forEach(listener => listener()) })
    expect(document.documentElement).toHaveAttribute('data-mf-theme', 'light')
  })
})

describe('Shell — animation du stash', () => {
  it('anime la proximite, revient au repos et conserve le marqueur actif', () => {
    const items = NAV_ITEMS.filter(item => ['/direction', '/budget'].includes(item.href))
    const { container } = render(<SidebarNav groups={[{ group: 'Pilotage', items }]} />)
    const links = screen.getAllByRole('link')
    links.forEach((link, index) => {
      Object.defineProperty(link, 'offsetTop', { value: index * 40 })
      Object.defineProperty(link, 'offsetHeight', { value: 40 })
    })
    fireEvent(container.firstElementChild!, new MouseEvent('pointermove', { bubbles: true, clientY: 60 }))
    advanceFrames()
    expect(Number(links[1].style.getPropertyValue('--effect'))).toBeGreaterThan(0.99)
    fireEvent.pointerLeave(container.firstElementChild!)
    advanceFrames()
    expect(Number(links[1].style.getPropertyValue('--effect'))).toBe(0)
    expect(Number(links[0].style.getPropertyValue('--effect'))).toBe(1)
    fireEvent.focus(links[1])
    advanceFrames()
    expect(Number(links[1].style.getPropertyValue('--effect'))).toBe(1)
  })
  it('ne lance pas de boucle en mouvement reduit', () => {
    queries.set('(prefers-reduced-motion: reduce)', { matches: true, listeners: new Set() })
    const { container } = render(<SidebarNav groups={groupItems(NAV_ITEMS)} />)
    fireEvent(container.firstElementChild!, new MouseEvent('pointermove', { bubbles: true, clientY: 60 }))
    expect(frames.size).toBe(0)
    expect(screen.getByRole('link', { name: 'Accueil' }).style.getPropertyValue('--effect')).toBe('1')
  })
})
