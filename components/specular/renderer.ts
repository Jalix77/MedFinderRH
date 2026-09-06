import { Renderer, Program, Mesh, Triangle } from 'ogl'
import { PAD, type Rect } from './geometry'
import { VERT, FRAG } from './shaders'

export type SurfaceFrame = { rect: Rect; radius: number; angle: number; brightness: number; intensity: number; line: number[]; base: number[] }
export type SurfaceRenderer = { draw: (frame: SurfaceFrame) => void; dispose: () => void }

// Loaded only after a eligible pointer/focus interaction, never in the server tree.
export function createSurfaceRenderer(canvas: HTMLCanvasElement): SurfaceRenderer {
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const renderer = new Renderer({ canvas, alpha: true, premultipliedAlpha: true, antialias: true, depth: false, dpr, webgl: 2, powerPreference: 'low-power' })
  const gl = renderer.gl
  if (!renderer.isWebgl2) {
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    throw new Error('Specular requires WebGL2')
  }
  gl.clearColor(0, 0, 0, 0)
  const geometry = new Triangle(gl)
  // Triangle's UV attribute is not used by the original shader.
  delete geometry.attributes.uv
  const program = new Program(gl, {
    vertex: VERT, fragment: FRAG, depthTest: false, depthWrite: false, transparent: true,
    uniforms: {
      uCenter: { value: [0, 0] }, uHalfSize: { value: [1, 1] }, uRadius: { value: 12 },
      uAngle: { value: 2.4 }, uPx: { value: dpr }, uLineColor: { value: [1, 1, 1] },
      uBaseColor: { value: [0, 0, 0] }, uIntensity: { value: 0 },
      uShineSize: { value: 10 * Math.PI / 180 }, uShineFade: { value: 40 * Math.PI / 180 },
      uThickness: { value: dpr }, uBaseWidth: { value: dpr },
    },
  })
  program.setBlendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
  const mesh = new Mesh(gl, { geometry, program })
  let width = 0
  let height = 0
  return {
    draw({ rect, radius, angle, brightness, intensity, line, base }) {
      if (rect.width !== width || rect.height !== height) {
        width = rect.width
        height = rect.height
        renderer.setSize(width + PAD * 2, height + PAD * 2)
        program.uniforms.uCenter.value = [(PAD + width / 2) * dpr, (PAD + height / 2) * dpr]
        program.uniforms.uHalfSize.value = [width / 2 * dpr, height / 2 * dpr]
      }
      canvas.style.transform = `translate3d(${rect.left - PAD}px, ${rect.top - PAD}px, 0)`
      canvas.style.opacity = String(brightness)
      program.uniforms.uRadius.value = radius * dpr
      program.uniforms.uAngle.value = angle
      program.uniforms.uLineColor.value = line
      program.uniforms.uBaseColor.value = base
      program.uniforms.uIntensity.value = intensity
      renderer.render({ scene: mesh })
    },
    dispose() {
      geometry.remove()
      program.remove()
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
