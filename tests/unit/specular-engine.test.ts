// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSpecular } from '@/components/specular/engine'
import type { SurfaceFrame, SurfaceRenderer } from '@/components/specular/renderer'

const frames = new Map<number, FrameRequestCallback>()
const queries = new Map<string, EventTarget & { matches: boolean }>()
let id = 0
let now = 0
let cleanup: (() => void) | undefined
let scope: HTMLElement
let card: HTMLElement
let draw: ReturnType<typeof vi.fn<(frame: SurfaceFrame) => void>>
let dispose: ReturnType<typeof vi.fn<() => void>>
let create: ReturnType<typeof vi.fn<(canvas: HTMLCanvasElement) => SurfaceRenderer>>
type RendererLoader = NonNullable<Parameters<typeof mountSpecular>[1]>
let load: ReturnType<typeof vi.fn<RendererLoader>>

function flush(count = 160) {
  for (let i = 0; i < count; i++) {
    const batch = [...frames.values()]
    frames.clear()
    now += 20
    batch.forEach(callback => callback(now))
  }
}
function move(x = 150, y = 150, pointerType = 'mouse') {
  window.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: x, clientY: y, pointerType }))
}
function surface(tag = 'div', left = 100) {
  const el = document.createElement(tag)
  el.setAttribute('data-specular', '')
  el.style.cssText = 'border-top-left-radius:12px;--mf-border:#e2e8f0;--mf-specular-line:#f6f8fa;--mf-specular-intensity:0.55'
  const rect = { left, top: 100, right: left + 200, bottom: 200, width: 200, height: 100, x: left, y: 100, toJSON() {} }
  el.getBoundingClientRect = () => rect
  el.getClientRects = () => [rect] as unknown as DOMRectList
  scope.append(el)
  return el
}
async function start() {
  cleanup = mountSpecular(scope, load)
  move()
  flush(1)
  await Promise.resolve()
  flush()
}
beforeEach(() => {
  document.body.innerHTML = '<div data-mf-app></div>'
  scope = document.querySelector('[data-mf-app]')!
  frames.clear(); queries.clear(); id = 0; now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.set(++id, cb); return id })
  vi.stubGlobal('cancelAnimationFrame', (key: number) => frames.delete(key))
  vi.stubGlobal('matchMedia', (q: string) => {
    if (!queries.has(q)) queries.set(q, Object.assign(new EventTarget(), { matches: q.includes('any-hover') }))
    return queries.get(q)
  })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null })
  card = surface()
  draw = vi.fn<(frame: SurfaceFrame) => void>()
  dispose = vi.fn()
  create = vi.fn<(canvas: HTMLCanvasElement) => SurfaceRenderer>(() => ({ draw, dispose }))
  load = vi.fn(async () => ({ createSurfaceRenderer: create }))
})
afterEach(() => { cleanup?.(); cleanup = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Specular — shared lifecycle', () => {
  it('loads once, coalesces rapid moves into one frame and stops when settled', async () => {
    await start()
    expect(create).toHaveBeenCalledTimes(1)
    expect(scope.querySelectorAll('canvas')).toHaveLength(1)
    expect(frames.size).toBe(0)
    for (let i = 0; i < 100; i++) move(150 + i)
    expect(frames.size).toBe(1)
    flush()
    expect(frames.size).toBe(0)
    expect(create).toHaveBeenCalledTimes(1)
    expect(draw.mock.lastCall![0].radius).toBe(12)
    expect(scope.querySelector('canvas')?.getAttribute('aria-hidden')).toBe('true')
  })
  it('reuses the renderer for different sizes, updates the theme and fades outside proximity', async () => {
    await start()
    const button = surface('button', 400)
    button.style.setProperty('--mf-specular-intensity', '0.85')
    await Promise.resolve()
    move(450)
    flush()
    expect(draw.mock.lastCall![0].rect.left).toBe(400)
    expect(draw.mock.lastCall![0].intensity).toBe(0.85)
    move(900, 600)
    flush()
    expect(frames.size).toBe(0)
    expect(scope.querySelector('canvas')?.style.opacity).toBe('0')
    expect(create).toHaveBeenCalledTimes(1)
  })
  it('hides immediately when the active surface disappears and disposes everything on unmount', async () => {
    await start()
    card.remove()
    await Promise.resolve()
    expect(scope.querySelector('canvas')?.style.opacity).toBe('0')
    cleanup!()
    cleanup = undefined
    move()
    expect(frames.size).toBe(0)
    expect(scope.querySelector('canvas')).toBeNull()
    expect(dispose).toHaveBeenCalledOnce()
  })
  it('never loads WebGL in reduced motion or on touch-only movement', async () => {
    cleanup = mountSpecular(scope, load)
    const media = queries.get('(prefers-reduced-motion: reduce)')!
    media.matches = true
    media.dispatchEvent(new Event('change'))
    move(); flush()
    expect(load).not.toHaveBeenCalled()
    media.matches = false
    queries.get('(any-hover: hover) and (any-pointer: fine)')!.matches = false
    media.dispatchEvent(new Event('change'))
    move(150, 150, 'touch'); flush()
    expect(load).not.toHaveBeenCalled()
  })
  it('releases on reduced motion and can restart without the old context disabling it', async () => {
    await start()
    const oldCanvas = scope.querySelector('canvas')!
    const media = queries.get('(prefers-reduced-motion: reduce)')!
    media.matches = true; media.dispatchEvent(new Event('change'))
    expect(dispose).toHaveBeenCalledOnce()
    expect(scope.querySelector('canvas')).toBeNull()
    oldCanvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
    media.matches = false; media.dispatchEvent(new Event('change'))
    move(); flush(1); await Promise.resolve(); flush()
    expect(create).toHaveBeenCalledTimes(2)
    expect(scope.querySelectorAll('canvas')).toHaveLength(1)
  })
  it('updates theme while active without moving the surface or recreating WebGL', async () => {
    await start()
    const before = card.getBoundingClientRect()
    card.style.setProperty('--mf-specular-line', '#e9edf2')
    card.style.setProperty('--mf-specular-intensity', '0.85')
    document.documentElement.setAttribute('data-mf-theme', 'dark')
    await Promise.resolve(); flush()
    expect(draw.mock.lastCall![0].intensity).toBe(0.85)
    expect(draw.mock.lastCall![0].line).toEqual([233 / 255, 237 / 255, 242 / 255])
    expect(card.getBoundingClientRect()).toEqual(before)
    expect(create).toHaveBeenCalledOnce()
    expect(frames.size).toBe(0)
  })
  it('lights an interactive keyboard focus but never makes cards focusable', async () => {
    const button = surface('button', 400)
    cleanup = mountSpecular(scope, load)
    button.focus()
    flush(1); await Promise.resolve(); flush()
    expect(draw.mock.lastCall![0].rect.left).toBe(400)
    expect(card.hasAttribute('tabindex')).toBe(false)
    expect(card.hasAttribute('role')).toBe(false)
  })
  it('ignores disabled and occluded surfaces', async () => {
    card.setAttribute('data-specular', 'false')
    const button = surface('button') as HTMLButtonElement
    button.disabled = true
    await start()
    expect(load).not.toHaveBeenCalled()
    button.disabled = false
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => document.body })
    await Promise.resolve(); move(); flush()
    expect(load).not.toHaveBeenCalled()
  })
  it('cancels a pending import after unmount and degrades quietly if WebGL is unavailable', async () => {
    let resolve!: (module: { createSurfaceRenderer: typeof create }) => void
    load.mockImplementation(() => new Promise(done => { resolve = done }))
    cleanup = mountSpecular(scope, load)
    move(); flush(1); cleanup(); cleanup = undefined
    resolve({ createSurfaceRenderer: create }); await Promise.resolve()
    expect(create).not.toHaveBeenCalled()
    load.mockResolvedValue({ createSurfaceRenderer: () => { throw new Error('No WebGL') } })
    await start()
    expect(scope.querySelector('canvas')).toBeNull()
    expect(frames.size).toBe(0)
  })
})
