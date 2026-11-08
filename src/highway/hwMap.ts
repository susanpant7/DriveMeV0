import { sim } from '../game/sim'
import { NB_EDGE_L, NB_SHOULDER_L, SB_EDGE_IN, SB_EDGE_OUT, SHOULDER_R, Z_BEGIN_NB, Z_BEGIN_SB, Z_END, Z_FINISH, Z_GORE, Z_START, LANE, NB_X, nbPavementRight, rampX } from './layout'

/** A heading-up map of the highway course: carriageways, the ramp and merge lane, the surroundings and your car. */
export function drawHighwayMap(g: CanvasRenderingContext2D, w: number, h: number) {
  const s = 4.2 // pixels per metre
  const px = w * 0.42, py = h * 0.72
  const X = (x: number) => px + (x - sim.x) * s
  const Y = (z: number) => py + (z - sim.z) * s
  g.fillStyle = '#2a4a31'
  g.fillRect(0, 0, w, h)
  // mown-grass stripes and scattered trees (fixed positions along the course, so they scroll with the road)
  const zt0 = sim.z - py / s - 30, zt1 = sim.z + (h - py) / s + 30
  g.fillStyle = 'rgba(255,255,255,.035)'
  for (let z = Math.floor(zt0 / 40) * 40; z < zt1; z += 80) g.fillRect(0, Y(z), w, 40 * s)
  const hash = (n: number) => { const t = Math.sin(n * 127.1) * 43758.5453; return t - Math.floor(t) }
  for (let k = Math.floor(zt0 / 14); k < zt1 / 14; k++) {
    for (const side of [0, 1]) {
      const rx = side ? 36 + hash(k * 3 + 1) * 60 : -28 - hash(k * 5 + 2) * 70
      if (hash(k * 7 + side) < 0.45) continue
      g.fillStyle = 'rgba(20,60,30,.9)'
      g.beginPath(); g.arc(X(rx), Y(k * 14 + hash(k) * 10), (2.2 + hash(k * 9) * 2) * s, 0, Math.PI * 2); g.fill()
    }
  }
  const zTop = sim.z - py / s - 20, zBot = sim.z + (h - py) / s + 20
  const band = (z0: number, z1: number, l: (z: number) => number, r: (z: number) => number, col: string) => {
    const a = Math.max(zTop, Math.min(z0, z1)), b = Math.min(zBot, Math.max(z0, z1))
    if (a >= b) return
    g.fillStyle = col
    g.beginPath()
    for (let z = a; z <= b; z += 10) g.lineTo(X(l(z)), Y(z))
    g.lineTo(X(l(b)), Y(b))
    g.lineTo(X(r(b)), Y(b))
    for (let z = b; z >= a; z -= 10) g.lineTo(X(r(z)), Y(z))
    g.lineTo(X(r(a)), Y(a))
    g.closePath(); g.fill()
  }
  band(Z_FINISH, Z_BEGIN_NB, () => NB_EDGE_L - NB_SHOULDER_L, nbPavementRight, '#7a8190')
  band(Z_FINISH, Z_BEGIN_SB, () => SB_EDGE_OUT - SHOULDER_R, () => SB_EDGE_IN + NB_SHOULDER_L, '#626978')
  band(Z_GORE, Z_START + 5, (z) => rampX(z) - LANE / 2 - 1.2, (z) => rampX(z) + LANE / 2 + 2.4, '#7a8190')
  // pavement edge lines and guard rails
  const edge = (xf: (z: number) => number, z0: number, z1: number) => { g.beginPath(); for (let z = Math.max(zTop, Math.min(z0, z1)); z <= Math.min(zBot, Math.max(z0, z1)); z += 10) g.lineTo(X(xf(z)), Y(z)); g.stroke() }
  g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 1.5
  edge((z) => nbPavementRight(z) - 1, Z_FINISH, Z_BEGIN_NB)
  edge((z) => rampX(z) + LANE / 2, Z_GORE, Z_START + 5)
  g.strokeStyle = '#c9ced6'; g.lineWidth = 2
  edge((z) => nbPavementRight(z) + 0.4, Z_FINISH, Z_BEGIN_NB)
  // lane lines
  g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1; g.setLineDash([6, 10])
  for (let k = 1; k < NB_X.length; k++) { const x = X(NB_EDGE_L + k * LANE); g.beginPath(); g.moveTo(x, Y(Math.min(zTop, Z_BEGIN_NB))); g.lineTo(x, Y(zBot)); g.stroke() }
  g.setLineDash([])
  g.strokeStyle = '#f2b705'; g.lineWidth = 2
  g.beginPath(); g.moveTo(X(NB_EDGE_L), Y(Z_BEGIN_NB)); g.lineTo(X(NB_EDGE_L), Y(zTop)); g.stroke()
  // where the merge lane ends
  g.strokeStyle = '#ff4d4d'; g.lineWidth = 4
  g.beginPath(); g.moveTo(X(14), Y(Z_END)); g.lineTo(X(28), Y(Z_END)); g.stroke()
  // your route: along the ramp and into the merge lane
  g.strokeStyle = 'rgba(47,155,255,.55)'; g.lineWidth = 6; g.lineCap = 'round'; g.lineJoin = 'round'
  g.beginPath(); for (let z = Math.min(zBot, Z_START); z >= Math.max(zTop, Z_END); z -= 10) g.lineTo(X(rampX(z)), Y(z)); g.stroke()
  g.lineCap = 'butt'
  // you
  g.save(); g.translate(px, py); g.rotate(-sim.h)
  g.fillStyle = '#2f9bff'; g.strokeStyle = '#fff'; g.lineWidth = 2
  g.beginPath(); g.moveTo(0, -11); g.lineTo(7, 9); g.lineTo(0, 5); g.lineTo(-7, 9); g.closePath(); g.fill(); g.stroke()
  g.restore()
}
