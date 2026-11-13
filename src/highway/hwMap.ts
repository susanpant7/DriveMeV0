import { sim } from '../game/sim'
import { HW, LANE, NB_EDGE_L, NL, Z_FINISH, Z_TOP, edgeL, edgeR, forkShift, paveR, rampX, rampZ0, rampZ1, strips } from './layout'

/** A heading-up map of the highway: the carriageways, ramps and extra lanes, the lanes, your way through (blue), and your car. */
export function drawHighwayMap(g: CanvasRenderingContext2D, w: number, h: number) {
  const s = 4.0 // pixels per metre
  const px = w * 0.5, py = h * 0.62
  const X = (x: number) => px + (x - sim.x) * s
  const Y = (z: number) => py + (z - sim.z) * s
  g.fillStyle = '#0d141e'
  g.fillRect(0, 0, w, h)
  const zTop = Math.max(Z_FINISH, sim.z - py / s - 20), zBot = Math.min(Z_TOP, sim.z + (h - py) / s + 20)
  const band = (z0: number, z1: number, l: (z: number) => number, r: (z: number) => number, col: string) => {
    const a = Math.max(zTop, Math.min(z0, z1)), b = Math.min(zBot, Math.max(z0, z1))
    if (a >= b) return
    g.fillStyle = col
    g.beginPath()
    for (let z = a; z <= b; z += 8) g.lineTo(X(l(z)), Y(z))
    g.lineTo(X(l(b)), Y(b)); g.lineTo(X(r(b)), Y(b))
    for (let z = b; z >= a; z -= 8) g.lineTo(X(r(z)), Y(z))
    g.lineTo(X(r(a)), Y(a))
    g.closePath(); g.fill()
  }
  const all = strips()
  all.forEach((st, i) => band(st.z0, st.z1, st.l, st.r, i === all.length - 1 ? '#3d4655' : '#8b96a6'))
  const path = (xf: (z: number) => number, a: number, b: number) => { g.beginPath(); for (let z = Math.max(zTop, a); z <= Math.min(zBot, b); z += 8) g.lineTo(X(xf(z)), Y(z)); g.stroke() }
  // lane lines
  const f = HW.s.fork
  g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1.2; g.setLineDash([6, 9])
  for (let k = 1; k < NL; k++) path((z) => NB_EDGE_L + k * LANE + (f && k > f.split ? forkShift(z) : 0), Z_FINISH, Z_TOP)
  g.setLineDash([])
  g.strokeStyle = 'rgba(255,214,70,.75)'; g.lineWidth = 2; path(edgeL, Z_FINISH, Z_TOP)
  g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 1.5; path(edgeR, Z_FINISH, Z_TOP)
  // your way: the exit to take, or the branch to keep to
  g.lineCap = 'round'; g.lineJoin = 'round'
  const blue = (xf: (z: number) => number, a: number, b: number) => { g.strokeStyle = '#fff'; g.lineWidth = 16; path(xf, a, b); g.strokeStyle = '#0b5cff'; g.lineWidth = 10; path(xf, a, b) }
  const take = HW.s.ramps.find((r) => r.take)
  if (take) blue((z) => rampX(take, z), rampZ1(take), rampZ0(take))
  const start = HW.s.ramps.find((r) => r.player)
  if (start) blue((z) => rampX(start, z), start.g - 380, rampZ0(start))
  if (f) {
    const k = f.want === 'left' ? (f.split - 1) / 2 : (f.split + NL - 1) / 2
    blue((z) => NB_EDGE_L + (k + 0.5) * LANE + (f.want === 'right' ? forkShift(z) : 0), Z_FINISH, f.z + 500)
  }
  g.lineCap = 'butt'
  void paveR
  // you
  g.save(); g.translate(px, py); g.rotate(-sim.h)
  g.fillStyle = '#1a1f29'; g.strokeStyle = '#fff'; g.lineWidth = 2.5
  g.beginPath(); g.moveTo(0, -13); g.lineTo(9, 11); g.lineTo(0, 6); g.lineTo(-9, 11); g.closePath(); g.fill(); g.stroke()
  g.restore()
}
