import { approach, closestSurface, pointerLight, surfaceRadius, type Point } from './geometry'
import type { SurfaceFrame, SurfaceRenderer } from './renderer'

type Loader = () => Promise<{ createSurfaceRenderer: (canvas: HTMLCanvasElement) => SurfaceRenderer }>
const INTERACTIVE = 'button:not(:disabled), a[href], [role="button"][tabindex]'
const SELECTOR = '[data-specular]:not([data-specular="false"]):not(:disabled):not([aria-disabled="true"])'

// These existing MedFinder neutral tokens resolve to sRGB hex, not a new palette.
function color(value: string) {
  const hex = value.trim().replace('#', '')
  if (/^[\da-f]{6}$/i.test(hex)) return [0, 2, 4].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
  return [1, 1, 1]
}

// One controller per authenticated shell. No React state participates in rendering.
export function mountSpecular(scope: HTMLElement, load: Loader = () => import('./renderer')) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)')
  const fine = matchMedia('(any-hover: hover) and (any-pointer: fine)')
  const forced = matchMedia('(forced-colors: active)')
  let disposed = false
  let failed = false
  let loading = false
  let generation = 0
  let raf = 0
  let last = 0
  let pointer: Point | null = null
  let focused: HTMLElement | null = null
  let active: HTMLElement | null = null
  let renderer: SurfaceRenderer | null = null
  let layer: HTMLDivElement | null = null
  let canvas: HTMLCanvasElement | null = null
  let surfaces: HTMLElement[] = []
  let dirty = true
  let refresh = true
  let angle = 2.4
  let brightness = 0
  let targetAngle = angle
  let targetBrightness = 0
  let frame: SurfaceFrame | null = null
  let pointerAttached = false
  const enabled = () => !disposed && !failed && !reduce.matches && !forced.matches && !document.hidden

  function hide() {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
    active = null
    frame = null
    brightness = 0
    targetBrightness = 0
    if (canvas) { canvas.style.opacity = '0'; canvas.dataset.state = 'idle' }
  }
  function release() {
    generation++
    loading = false
    hide()
    canvas?.removeEventListener('webglcontextlost', contextLost)
    renderer?.dispose()
    renderer = null
    layer?.remove()
    layer = null
    canvas = null
  }
  function contextLost(event: Event) {
    event.preventDefault()
    failed = true
    hide()
  }
  function wake() {
    if (enabled() && !raf && (pointer || focused || brightness > 0)) {
      last = performance.now()
      raf = requestAnimationFrame(tick)
    }
  }
  async function ensureRenderer() {
    if (renderer || loading || !enabled()) return
    loading = true
    const version = generation
    try {
      const loaded = await load()
      if (version !== generation || !enabled()) return
      layer = document.createElement('div')
      layer.className = 'mf-specular-overlay'
      layer.setAttribute('aria-hidden', 'true')
      canvas = document.createElement('canvas')
      canvas.dataset.specularCanvas = ''
      canvas.setAttribute('aria-hidden', 'true')
      canvas.addEventListener('webglcontextlost', contextLost)
      layer.append(canvas)
      scope.append(layer)
      renderer = loaded.createSurfaceRenderer(canvas)
      refresh = true
      wake()
    } catch {
      failed = true
      release()
    } finally {
      if (version === generation) loading = false
    }
  }
  function visible(target: HTMLElement) {
    return target.isConnected && target.matches(SELECTOR) && !target.closest('[hidden], [inert], [aria-hidden="true"]') && target.getClientRects().length > 0 && getComputedStyle(target).visibility !== 'hidden'
  }
  function updateTarget() {
    if (dirty) { surfaces = [...scope.querySelectorAll<HTMLElement>(SELECTOR)]; dirty = false }
    const candidates = surfaces.filter(visible).map(target => ({ target, rect: target.getBoundingClientRect() }))
      .filter(({ rect }) => rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth)
    let selected = pointer ? closestSurface(candidates, pointer) : null
    if (focused && visible(focused)) {
      const rect = focused.getBoundingClientRect()
      if (rect.bottom > 0 && rect.top < innerHeight) selected = { target: focused, rect, ...pointerLight(rect, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }) }
    }
    if (selected) {
      // Do not shine through an open menu/modal or another occluding surface.
      const { target, rect } = selected
      const x = Math.max(0, Math.min(innerWidth - 1, Math.max(rect.left + 1, Math.min(pointer?.x ?? rect.left + rect.width / 2, rect.right - 1))))
      const y = Math.max(0, Math.min(innerHeight - 1, Math.max(rect.top + 1, Math.min(pointer?.y ?? rect.top + rect.height / 2, rect.bottom - 1))))
      const hit = document.elementFromPoint(x, y)
      if (hit && !target.contains(hit)) selected = null
    }
    if (!selected) { targetBrightness = 0; return }
    if (active !== selected.target) { active = selected.target; brightness = 0; angle = selected.angle }
    targetAngle = selected.angle
    targetBrightness = selected.brightness
    const style = getComputedStyle(selected.target)
    frame = {
      rect: selected.rect, radius: surfaceRadius(selected.target.dataset.specularRadius ?? style.borderTopLeftRadius, selected.rect),
      angle, brightness, intensity: Number.parseFloat(style.getPropertyValue('--mf-specular-intensity')) || 0.85,
      line: color(style.getPropertyValue('--mf-specular-line')), base: color(style.getPropertyValue('--mf-border')),
    }
  }
  function tick(now: number) {
    raf = 0
    if (!enabled()) { hide(); return }
    if (active && !visible(active)) { hide(); refresh = true }
    if (refresh) { updateTarget(); refresh = false }
    if (!frame || (!targetBrightness && brightness < 0.001)) { hide(); return }
    if (!renderer) { void ensureRenderer(); return }
    const next = approach(angle, brightness, targetAngle, targetBrightness, Math.min(Math.max((now - last) / 1000, 0.001), 0.05))
    last = now
    angle = next.angle
    brightness = next.brightness
    if (next.settled) { angle = targetAngle; brightness = targetBrightness }
    renderer.draw({ ...frame, angle, brightness })
    if (canvas) canvas.dataset.state = next.settled ? 'settled' : 'animating'
    if (!next.settled) raf = requestAnimationFrame(tick)
    else if (!brightness) hide()
  }
  function onPointer(event: PointerEvent) {
    if (event.pointerType === 'touch') { pointer = null; hide(); return }
    pointer = { x: event.clientX, y: event.clientY }
    focused = null
    refresh = true
    wake()
  }
  function onFocus(event: FocusEvent) {
    const target = event.target instanceof HTMLElement ? event.target : null
    focused = target?.matches(INTERACTIVE) && target.matches(SELECTOR) && target.matches(':focus-visible') ? target : null
    refresh = true
    wake()
  }
  function onFocusOut() { focused = null; refresh = true; wake() }
  function leave() { pointer = null; focused = null; targetBrightness = 0; refresh = true; wake() }
  function invalidate() { refresh = true; wake() }
  function mediaChange() {
    const attach = fine.matches && !reduce.matches && !forced.matches
    if (attach !== pointerAttached) {
      if (attach) window.addEventListener('pointermove', onPointer, { passive: true })
      else window.removeEventListener('pointermove', onPointer)
      pointerAttached = attach
    }
    if (!attach) pointer = null
    if (reduce.matches || forced.matches) release()
    else invalidate()
  }
  function visibility() { if (document.hidden) { pointer = null; focused = null; hide() } else invalidate() }
  const mutations = new MutationObserver(records => {
    if (records.every(record => layer?.contains(record.target) || (record.target === scope && [...record.addedNodes, ...record.removedNodes].every(node => node === layer)))) return
    dirty = true
    if (active && !active.isConnected) hide()
    invalidate()
  })
  mutations.observe(scope, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'disabled', 'hidden', 'aria-disabled', 'data-specular', 'data-specular-radius'] })
  const theme = new MutationObserver(invalidate)
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mf-theme'] })
  const resize = new ResizeObserver(invalidate)
  resize.observe(scope)
  scope.addEventListener('focusin', onFocus)
  scope.addEventListener('focusout', onFocusOut)
  window.addEventListener('pointerout', eventOut)
  window.addEventListener('blur', leave)
  document.addEventListener('scroll', invalidate, { capture: true, passive: true })
  window.addEventListener('resize', invalidate, { passive: true })
  document.addEventListener('visibilitychange', visibility)
  for (const media of [reduce, fine, forced]) media.addEventListener('change', mediaChange)
  function eventOut(event: PointerEvent) { if (!event.relatedTarget) leave() }
  mediaChange()
  return () => {
    disposed = true
    mutations.disconnect(); theme.disconnect(); resize.disconnect()
    window.removeEventListener('pointermove', onPointer)
    window.removeEventListener('pointerout', eventOut)
    window.removeEventListener('blur', leave)
    document.removeEventListener('scroll', invalidate, true)
    window.removeEventListener('resize', invalidate)
    document.removeEventListener('visibilitychange', visibility)
    scope.removeEventListener('focusin', onFocus)
    scope.removeEventListener('focusout', onFocusOut)
    for (const media of [reduce, fine, forced]) media.removeEventListener('change', mediaChange)
    release()
  }
}
