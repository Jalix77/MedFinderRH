import { describe, expect, it } from 'vitest'
import { approach, closestSurface, pointerLight, surfaceRadius } from '@/components/specular/geometry'

const rect = { left: 100, top: 100, right: 300, bottom: 200, width: 200, height: 100 }
describe('Specular — geometry', () => {
  it('uses the original diagonal steering inside and fades to zero at 160px', () => {
    expect(pointerLight(rect, { x: 200, y: 150 }).angle).toBeCloseTo(Math.atan2(2 / 100, -2 / 200))
    expect(pointerLight(rect, { x: 380, y: 150 }).brightness).toBe(0.5)
    expect(pointerLight(rect, { x: 460, y: 150 }).brightness).toBe(0)
  })
  it('prefers the hovered nested card to its parent, and the closest outside surface', () => {
    const parent = { left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400 }
    expect(closestSurface([{ target: 'panel', rect: parent }, { target: 'card', rect }], { x: 150, y: 150 })?.target).toBe('card')
    expect(closestSurface([{ target: 'card', rect }], { x: 600, y: 150 })).toBeNull()
  })
  it('honors real fractional radii, percentages, default and clamping', () => {
    expect(surfaceRadius('11.5px', rect)).toBe(11.5)
    expect(surfaceRadius('50%', rect)).toBe(50)
    expect(surfaceRadius(undefined, rect)).toBe(12)
    expect(surfaceRadius('900', rect)).toBe(50)
  })
  it('takes the short angle path and settles without an idle sweep', () => {
    const next = approach(Math.PI - 0.1, 0, -Math.PI + 0.1, 1, 0.016)
    expect(next.angle).toBeGreaterThan(Math.PI - 0.1)
    expect(next.brightness).toBeGreaterThan(0)
    expect(approach(1, 1, 1, 1, 0.016).settled).toBe(true)
  })
})
