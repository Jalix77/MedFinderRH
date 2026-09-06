export const PROXIMITY = 160
export const PAD = 20
export type Point = { x: number; y: number }
export type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number }

export function pointerLight(rect: Rect, point: Point) {
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const distance = Math.hypot(Math.max(rect.left - point.x, 0, point.x - rect.right), Math.max(rect.top - point.y, 0, point.y - rect.bottom))
  const t = Math.max(0, 1 - distance / PROXIMITY)
  // Exact pointer steering and smoothstep proximity from React Bits SpecularButton.
  const angle = distance === 0
    ? Math.atan2(2 / rect.height, -2 / rect.width) + (point.x - cx) / (rect.width / 2) * 0.3 + (cy - point.y) / (rect.height / 2) * 0.15
    : Math.atan2(cy - point.y, point.x - cx)
  return { distance, angle, brightness: t * t * (3 - 2 * t) }
}

export function closestSurface<T>(candidates: { target: T; rect: Rect }[], point: Point) {
  let best: { target: T; rect: Rect; distance: number; angle: number; brightness: number } | null = null
  for (const candidate of candidates) {
    if (candidate.rect.width <= 0 || candidate.rect.height <= 0) continue
    const light = pointerLight(candidate.rect, point)
    if (light.distance >= PROXIMITY) continue
    if (!best || light.distance < best.distance || (light.distance === best.distance && candidate.rect.width * candidate.rect.height < best.rect.width * best.rect.height)) {
      best = { ...candidate, ...light }
    }
  }
  return best
}

export function surfaceRadius(value: string | undefined, rect: Rect) {
  const parsed = Number.parseFloat(value ?? '')
  const pixels = value?.endsWith('%') ? parsed * Math.min(rect.width, rect.height) / 100 : parsed
  return Math.max(0, Math.min(Number.isFinite(pixels) ? pixels : 12, rect.width / 2, rect.height / 2))
}

export function approach(angle: number, brightness: number, targetAngle: number, targetBrightness: number, dt: number) {
  const delta = ((targetAngle - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI
  return { angle: angle + delta * (1 - Math.exp(-dt * 7)), brightness: brightness + (targetBrightness - brightness) * (1 - Math.exp(-dt * 8)), settled: Math.abs(delta) < 0.001 && Math.abs(targetBrightness - brightness) < 0.001 }
}
