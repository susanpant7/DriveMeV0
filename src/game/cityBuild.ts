import * as THREE from 'three'
import { B, BOX, G, HALF_ROAD, HORIZONTAL_NAMES, ISLAND_R, LANES, LANE_W, LOTS, RING_OUT, VERTICAL_NAMES, clearance, dirv, hashN, laneOff, nodeIndex, nodeKind } from './map'

type V3 = [number, number, number]
type V2 = [number, number]

/** Accumulates triangles (position, normal, uv, colour) into one BufferGeometry. */
const CH = 4 // chunks per side (each B metres) so far-away parts of the city can be culled
const chunkOf = (x: number, z: number) => Math.min(CH - 1, Math.max(0, Math.floor(x / B))) * CH + Math.min(CH - 1, Math.max(0, Math.floor(z / B)))

interface Buf { pos: number[]; nor: number[]; uv: number[]; col: number[] }
export class MB {
  bufs: Buf[] = Array.from({ length: CH * CH }, () => ({ pos: [], nor: [], uv: [], col: [] }))

  tri(a: V3, b: V3, c: V3, ua: V2, ub: V2, uc: V2, color: V3) {
    const buf = this.bufs[chunkOf((a[0] + b[0] + c[0]) / 3, (a[2] + b[2] + c[2]) / 3)]
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const l = Math.hypot(nx, ny, nz) || 1
    nx /= l; ny /= l; nz /= l
    for (const [p, u] of [[a, ua], [b, ub], [c, uc]] as Array<[V3, V2]>) {
      buf.pos.push(p[0], p[1], p[2])
      buf.nor.push(nx, ny, nz)
      buf.uv.push(u[0], u[1])
      buf.col.push(color[0], color[1], color[2])
    }
  }
  quad(a: V3, b: V3, c: V3, d: V3, ua: V2, ub: V2, uc: V2, ud: V2, color: V3) {
    this.tri(a, b, c, ua, ub, uc, color)
    this.tri(a, c, d, ua, uc, ud, color)
  }
  /** horizontal quad given as 4 (x,z) corners, always facing up; uv from world position */
  upQuad(pts: [V2, V2, V2, V2], y: number, color: V3, s = 4) {
    const [p0, p1, p2] = pts
    const cross = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0])
    const q = cross > 0 ? pts : ([pts[3], pts[2], pts[1], pts[0]] as [V2, V2, V2, V2])
    const v = q.map((p) => [p[0], y, p[1]] as V3)
    const u = q.map((p) => [p[0] / s, p[1] / s] as V2)
    // winding giving +y normal: (x0,z0),(x0,z1),(x1,z1) was verified; flip if needed
    const nrm = (v[1][2] - v[0][2]) * (v[2][0] - v[0][0]) - (v[1][0] - v[0][0]) * (v[2][2] - v[0][2])
    if (nrm > 0) this.quad(v[0], v[1], v[2], v[3], u[0], u[1], u[2], u[3], color)
    else this.quad(v[3], v[2], v[1], v[0], u[3], u[2], u[1], u[0], color)
  }
  rect(x0: number, z0: number, x1: number, z1: number, y: number, color: V3, s = 4) {
    this.upQuad([[x0, z0], [x0, z1], [x1, z1], [x1, z0]], y, color, s)
  }
  /** box with its base at y0, rotated about y. facade = windowed walls (uv tiled in metres). */
  box(cx: number, y0: number, cz: number, sx: number, sy: number, sz: number, rotY: number, color: V3, facade = false) {
    const c = Math.cos(rotY), s = Math.sin(rotY)
    const corner = (lx: number, lz: number): V2 => [cx + lx * c + lz * s, cz - lx * s + lz * c]
    const ring: V2[] = [corner(-sx / 2, -sz / 2), corner(sx / 2, -sz / 2), corner(sx / 2, sz / 2), corner(-sx / 2, sz / 2)]
    const y1 = y0 + sy
    for (let i = 0; i < 4; i++) {
      const a = ring[i], b = ring[(i + 1) % 4]
      const A: V3 = [a[0], y0, a[1]], Bv: V3 = [b[0], y0, b[1]], C: V3 = [b[0], y1, b[1]], D: V3 = [a[0], y1, a[1]]
      const mid = [(a[0] + b[0]) / 2 - cx, (a[1] + b[1]) / 2 - cz]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      const uu = facade ? len / 8 : 0, vv = facade ? sy / 8 : 0
      const n = [(b[1] - a[1]), -(b[0] - a[0])] // candidate outward normal in xz
      const out = n[0] * mid[0] + n[1] * mid[1] > 0
      if (out) this.quad(A, Bv, C, D, [0, 0], [uu, 0], [uu, vv], [0, vv], color)
      else this.quad(Bv, A, D, C, [uu, 0], [0, 0], [0, vv], [uu, vv], color)
    }
    const top = ring.map((p) => [p[0], y1, p[1]] as V3)
    const t: V2 = facade ? [0.02, 0.02] : [0, 0]
    this.quad(top[0], top[3], top[2], top[1], t, t, t, t, color) // faces up
  }
  addGeometry(g: THREE.BufferGeometry, color: V3, worldUV = 0) {
    const ng = g.index ? g.toNonIndexed() : g
    const p = ng.getAttribute('position'), n = ng.getAttribute('normal'), uv = ng.getAttribute('uv')
    for (let i = 0; i < p.count; i += 3) {
      const buf = this.bufs[chunkOf((p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3)]
      for (let k = i; k < i + 3; k++) {
        buf.pos.push(p.getX(k), p.getY(k), p.getZ(k))
        buf.nor.push(n.getX(k), n.getY(k), n.getZ(k))
        if (worldUV) buf.uv.push(p.getX(k) / worldUV, p.getZ(k) / worldUV)
        else buf.uv.push(uv ? uv.getX(k) : 0, uv ? uv.getY(k) : 0)
        buf.col.push(color[0], color[1], color[2])
      }
    }
  }
  /** one geometry per non-empty chunk */
  build(): THREE.BufferGeometry[] {
    return this.bufs
      .filter((b) => b.pos.length)
      .map((b) => {
        const g = new THREE.BufferGeometry()
        g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3))
        g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3))
        g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2))
        g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3))
        g.computeBoundingSphere()
        return g
      })
  }
}

/* ------------------------------------------------------------------ */
/* Sign atlas                                                          */
/* ------------------------------------------------------------------ */
interface Rect { x: number; y: number; w: number; h: number }
export const ATLAS_W = 2048
export const ATLAS_H = 1024
const cell = (i: number): Rect => ({ x: i * 256, y: 0, w: 256, h: 256 })
export const SIGN = { speed: cell(0), yield: cell(1), rbWarn: cell(2), sigWarn: cell(3), ped: cell(4), rbMust: cell(5), chevron: cell(6), lanes: cell(7) }
export const PLATE = (i: number): Rect => ({ x: i * 256, y: 256, w: 256, h: 128 })
export const PANEL = (i: number): Rect => ({ x: (i % 4) * 512, y: 384 + Math.floor(i / 4) * 256, w: 512, h: 256 })
const DEST = ['Harbour', 'Airport', 'Old Town', 'Stadium', 'Park', 'Station', 'University', 'Market']

function arrowHead(g: CanvasRenderingContext2D, x: number, y: number, ang: number, s: number) {
  g.save(); g.translate(x, y); g.rotate(ang)
  g.beginPath(); g.moveTo(s, 0); g.lineTo(-s * 0.6, -s * 0.7); g.lineTo(-s * 0.6, s * 0.7); g.closePath(); g.fill()
  g.restore()
}

export function drawSpeedSign(g: CanvasRenderingContext2D, units: 'kmh' | 'mph') {
  const { x, y, w, h } = SIGN.speed
  g.clearRect(x, y, w, h)
  g.fillStyle = '#d8251d'; g.beginPath(); g.arc(x + 128, y + 128, 120, 0, 7); g.fill()
  g.fillStyle = '#fff'; g.beginPath(); g.arc(x + 128, y + 128, 86, 0, 7); g.fill()
  g.fillStyle = '#111'; g.font = '700 88px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillText(units === 'mph' ? '30' : '50', x + 128, y + 134)
}

export function makeAtlas(units: 'kmh' | 'mph') {
  const c = document.createElement('canvas')
  c.width = ATLAS_W
  c.height = ATLAS_H
  const g = c.getContext('2d')!
  drawSpeedSign(g, units)

  const tri = (r: Rect, down: boolean) => {
    g.fillStyle = '#d8251d'
    g.beginPath()
    if (down) { g.moveTo(r.x + 6, r.y + 24); g.lineTo(r.x + 250, r.y + 24); g.lineTo(r.x + 128, r.y + 236) }
    else { g.moveTo(r.x + 128, r.y + 20); g.lineTo(r.x + 250, r.y + 232); g.lineTo(r.x + 6, r.y + 232) }
    g.closePath(); g.fill()
    g.fillStyle = '#fff'
    g.beginPath()
    if (down) { g.moveTo(r.x + 40, r.y + 52); g.lineTo(r.x + 216, r.y + 52); g.lineTo(r.x + 128, r.y + 204) }
    else { g.moveTo(r.x + 128, r.y + 66); g.lineTo(r.x + 214, r.y + 210); g.lineTo(r.x + 42, r.y + 210) }
    g.closePath(); g.fill()
  }
  // give way
  tri(SIGN.yield, true)
  // roundabout ahead (warning)
  tri(SIGN.rbWarn, false)
  g.strokeStyle = '#111'; g.fillStyle = '#111'; g.lineWidth = 9
  for (let i = 0; i < 3; i++) {
    const a = (i * 2 * Math.PI) / 3 - Math.PI / 2
    g.beginPath(); g.arc(SIGN.rbWarn.x + 128, SIGN.rbWarn.y + 152, 38, a, a + 1.5); g.stroke()
    arrowHead(g, SIGN.rbWarn.x + 128 + 38 * Math.cos(a + 1.5), SIGN.rbWarn.y + 152 + 38 * Math.sin(a + 1.5), a + 1.5 + Math.PI / 2, 14)
  }
  // traffic signals ahead
  tri(SIGN.sigWarn, false)
  g.fillStyle = '#111'; g.fillRect(SIGN.sigWarn.x + 98, SIGN.sigWarn.y + 90, 60, 112)
  ;['#e22', '#fb0', '#2c4'].forEach((col, i) => { g.fillStyle = col; g.beginPath(); g.arc(SIGN.sigWarn.x + 128, SIGN.sigWarn.y + 112 + i * 34, 13, 0, 7); g.fill() })
  // pedestrian crossing (blue square)
  g.fillStyle = '#1757b8'; g.fillRect(SIGN.ped.x + 8, SIGN.ped.y + 8, 240, 240)
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(SIGN.ped.x + 128, SIGN.ped.y + 30); g.lineTo(SIGN.ped.x + 226, SIGN.ped.y + 214); g.lineTo(SIGN.ped.x + 30, SIGN.ped.y + 214); g.closePath(); g.fill()
  g.fillStyle = '#111'; g.beginPath(); g.arc(SIGN.ped.x + 128, SIGN.ped.y + 106, 15, 0, 7); g.fill()
  g.strokeStyle = '#111'; g.lineWidth = 12; g.lineCap = 'round'
  g.beginPath(); g.moveTo(SIGN.ped.x + 128, SIGN.ped.y + 124); g.lineTo(SIGN.ped.x + 128, SIGN.ped.y + 164); g.lineTo(SIGN.ped.x + 106, SIGN.ped.y + 200); g.moveTo(SIGN.ped.x + 128, SIGN.ped.y + 164); g.lineTo(SIGN.ped.x + 152, SIGN.ped.y + 200); g.moveTo(SIGN.ped.x + 128, SIGN.ped.y + 136); g.lineTo(SIGN.ped.x + 100, SIGN.ped.y + 152); g.moveTo(SIGN.ped.x + 128, SIGN.ped.y + 136); g.lineTo(SIGN.ped.x + 158, SIGN.ped.y + 150); g.stroke()
  // roundabout mandatory (blue circle)
  g.fillStyle = '#1757b8'; g.beginPath(); g.arc(SIGN.rbMust.x + 128, SIGN.rbMust.y + 128, 120, 0, 7); g.fill()
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 12
  for (let i = 0; i < 3; i++) {
    const a = (i * 2 * Math.PI) / 3 - Math.PI / 2
    g.beginPath(); g.arc(SIGN.rbMust.x + 128, SIGN.rbMust.y + 128, 54, a, a + 1.55); g.stroke()
    arrowHead(g, SIGN.rbMust.x + 128 + 54 * Math.cos(a + 1.55), SIGN.rbMust.y + 128 + 54 * Math.sin(a + 1.55), a + 1.55 + Math.PI / 2, 20)
  }
  // chevron (keep right around the island)
  g.fillStyle = '#111'; g.fillRect(SIGN.chevron.x + 8, SIGN.chevron.y + 40, 240, 176)
  g.fillStyle = '#fff'; g.fillRect(SIGN.chevron.x + 18, SIGN.chevron.y + 50, 220, 156)
  g.strokeStyle = '#111'; g.lineWidth = 26; g.lineJoin = 'miter'
  g.beginPath(); g.moveTo(SIGN.chevron.x + 96, SIGN.chevron.y + 70); g.lineTo(SIGN.chevron.x + 168, SIGN.chevron.y + 128); g.lineTo(SIGN.chevron.x + 96, SIGN.chevron.y + 186); g.stroke()

  // lane-use sign: blue, three arrows (left / straight / right)
  {
    const r = SIGN.lanes
    g.fillStyle = '#1757b8'; g.fillRect(r.x + 10, r.y + 10, 236, 236)
    g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeRect(r.x + 18, r.y + 18, 220, 220)
    g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineWidth = 16; g.lineCap = 'butt'
    const lane = (cx: number, kind: 'L' | 'S' | 'R') => {
      const bx = r.x + cx, by = r.y + 214
      g.beginPath(); g.moveTo(bx, by); g.lineTo(bx, by - 100); g.stroke()
      if (kind === 'S') { g.beginPath(); g.moveTo(bx - 26, by - 100); g.lineTo(bx + 26, by - 100); g.lineTo(bx, by - 150); g.closePath(); g.fill() }
      else {
        const d = kind === 'L' ? -1 : 1
        g.beginPath(); g.moveTo(bx, by - 100); g.lineTo(bx + d * 40, by - 140); g.stroke()
        g.beginPath(); g.moveTo(bx + d * 18, by - 160); g.lineTo(bx + d * 70, by - 160); g.lineTo(bx + d * 70, by - 108); g.closePath(); g.fill()
      }
    }
    lane(72, 'L'); lane(128, 'S'); lane(184, 'R')
  }
  // street name plates
  ;[...VERTICAL_NAMES, ...HORIZONTAL_NAMES].forEach((name, i) => {
    const r = PLATE(i)
    g.fillStyle = '#0b6b3a'; g.fillRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8)
    g.strokeStyle = '#fff'; g.lineWidth = 5; g.strokeRect(r.x + 10, r.y + 10, r.w - 20, r.h - 20)
    g.fillStyle = '#fff'; g.font = '700 48px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText(name, r.x + r.w / 2, r.y + r.h / 2 + 3)
  })
  // overhead gantry panels (one per crossing road)
  for (let i = 0; i < 8; i++) {
    const r = PANEL(i)
    g.fillStyle = '#0b6b3a'; g.fillRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8)
    g.strokeStyle = '#fff'; g.lineWidth = 7; g.strokeRect(r.x + 14, r.y + 14, r.w - 28, r.h - 28)
    g.fillStyle = '#fff'; g.textBaseline = 'middle'
    g.font = '700 60px Arial, sans-serif'; g.textAlign = 'center'
    g.fillText('▲ City Centre', r.x + r.w / 2, r.y + 78)
    g.font = '700 46px Arial, sans-serif'
    g.textAlign = 'left'; g.fillText('◄ ' + DEST[(i * 2) % 8], r.x + 34, r.y + 170)
    g.textAlign = 'right'; g.fillText(DEST[(i * 2 + 1) % 8] + ' ►', r.x + r.w - 34, r.y + 170)
    g.font = '600 34px Arial, sans-serif'; g.textAlign = 'center'; g.fillStyle = '#cfe9d8'
    g.fillText(i < 4 ? VERTICAL_NAMES[i] : HORIZONTAL_NAMES[i - 4], r.x + r.w / 2, r.y + 220)
  }
  return c
}

export function facadeCanvas() {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = '#ebe7df'; g.fillRect(0, 0, 256, 256)
  for (const [x, y] of [[26, 30], [150, 30], [26, 158], [150, 158]]) {
    const gr = g.createLinearGradient(0, y, 0, y + 70)
    gr.addColorStop(0, '#3c4c5e'); gr.addColorStop(1, '#6f8296')
    g.fillStyle = '#c9c4ba'; g.fillRect(x - 5, y - 5, 90, 80)
    g.fillStyle = gr; g.fillRect(x, y, 80, 70)
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x, y, 80, 8)
  }
  return c
}

/* ------------------------------------------------------------------ */
/* One period of the city                                              */
/* ------------------------------------------------------------------ */
export interface LampDef { x: number; y: number; z: number; yaw: number; node: number; axis: 0 | 1; l: number }
export interface TreeDef { x: number; z: number; s: number }

type Pt2 = [number, number]
/** polygons (in the lane's travel frame: a = forward, b = toward the travel-right) for each arrow kind */
const ARROW_SHAPES: Record<'L' | 'S' | 'SR', Pt2[][]> = (() => {
  const straight: Pt2[][] = [[[0, -0.15], [2.6, -0.15], [2.6, 0.15], [0, 0.15]], [[2.5, -0.62], [2.5, 0.62], [3.9, 0]]]
  const right: Pt2[][] = [[[1.25, 0.9], [2.05, 0.9], [2.05, 1.5]], [[1.25, 0.9], [2.05, 1.5], [1.25, 1.5]]]
  const mir = (shapes: Pt2[][]): Pt2[][] => shapes.map((poly) => poly.map(([a, b]) => [a, -b] as Pt2))
  const turn = (d: 1 | -1): Pt2[][] => {
    const f = (b: number) => b * d
    return [
      [[0, -0.15], [1.9, -0.15], [1.9, 0.15], [0, 0.15]],
      [[1.7, f(0)], [2.1, f(0)], [2.1, f(1.35)], [1.7, f(1.35)]],
      [[1.35, f(1.3)], [2.45, f(1.3)], [1.9, f(2.2)]],
    ].map((poly) => poly.map(([a, b]) => [a, b] as Pt2))
  }
  void right; void mir
  const sr: Pt2[][] = [...straight, [[1.45, 0], [1.8, 0], [1.8, 1.1], [1.45, 1.1]], [[1.1, 1.05], [2.15, 1.05], [1.62, 1.8]]]
  return { S: straight, L: turn(-1), SR: sr }
})()

export function buildCity() {
  const asphalt = new MB(), marks = new MB(), solid = new MB(), buildings = new MB(), signs = new MB()
  const lamps: LampDef[] = []
  const trees: TreeDef[] = []
  const WHITE: V3 = [0.92, 0.92, 0.9], YELLOW: V3 = [0.95, 0.75, 0.1]
  const CONC: V3 = [0.62, 0.63, 0.65], POLE: V3 = [0.45, 0.47, 0.5], DARK: V3 = [0.06, 0.06, 0.07]
  const rectUV = (r: Rect): [V2, V2, V2, V2] => {
    const u0 = r.x / ATLAS_W, u1 = (r.x + r.w) / ATLAS_W
    const vT = 1 - r.y / ATLAS_H, vB = 1 - (r.y + r.h) / ATLAS_H
    return [[u0, vB], [u1, vB], [u1, vT], [u0, vT]]
  }
  /** sign face: centre (x,y,z), size w x h, front facing `face` (xz unit vector) */
  const signQuad = (x: number, y: number, z: number, w: number, h: number, face: V2, r: Rect) => {
    const rx = face[1], rz = -face[0]
    const BL: V3 = [x - rx * w / 2, y - h / 2, z - rz * w / 2]
    const BR: V3 = [x + rx * w / 2, y - h / 2, z + rz * w / 2]
    const TR: V3 = [BR[0], y + h / 2, BR[2]]
    const TL: V3 = [BL[0], y + h / 2, BL[2]]
    const uv = rectUV(r)
    signs.quad(BL, BR, TR, TL, uv[0], uv[1], uv[2], uv[3], [1, 1, 1])
  }
  const post = (x: number, z: number, h: number, t = 0.09, color = POLE) => solid.box(x, 0, z, t, h, t, 0, color)

  // ---------------- roads ----------------
  for (let i = 0; i < G; i++) {
    for (let k = 0; k < G * 4; k++) {
      asphalt.rect(i * B - HALF_ROAD - 0.5, k * 50, i * B + HALF_ROAD + 0.5, (k + 1) * 50, 0, [1, 1, 1]) // vertical road
      asphalt.rect(k * 50, i * B - HALF_ROAD - 0.5, (k + 1) * 50, i * B + HALF_ROAD + 0.5, 0, [1, 1, 1]) // horizontal road
    }
  }
  for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
    const cx = i * B, cz = j * B
    if (nodeKind(i, j) === 'round') {
      const ring = new THREE.RingGeometry(ISLAND_R - 1, RING_OUT, 72, 1)
      ring.rotateX(-Math.PI / 2)
      ring.translate(cx, 0.001, cz)
      asphalt.addGeometry(ring, [1, 1, 1], 4)
    }
  }

  // ---------------- markings, kerbs, per-edge props ----------------
  const at = (ax: number, az: number, d: number, u: number, v: number): V2 => {
    const [dx, dz] = dirv(d), [rx, rz] = dirv(d - 1)
    return [ax + dx * u + rx * v, az + dz * u + rz * v]
  }
  const mk = (ax: number, az: number, d: number, u0: number, u1: number, v0: number, v1: number, color: V3, y = 0.02) =>
    marks.upQuad([at(ax, az, d, u0, v0), at(ax, az, d, u1, v0), at(ax, az, d, u1, v1), at(ax, az, d, u0, v1)], y, color)

  /** painted arrow on a lane: tail at road coordinate u0, pointing along `ds` (+1/-1), lane centre at v0 */
  const arrow = (ax: number, az: number, d: number, u0: number, ds: 1 | -1, v0: number, kind: 'L' | 'S' | 'SR') => {
    for (const poly of ARROW_SHAPES[kind]) {
      const pts = poly.map(([a, b]) => at(ax, az, d, u0 + ds * a, v0 + ds * b))
      if (pts.length === 3) marks.upQuad([pts[0], pts[1], pts[2], pts[2]], 0.02, WHITE)
      else marks.upQuad([pts[0], pts[1], pts[2], pts[3]], 0.02, WHITE)
    }
  }
  const treeAlong = (ax: number, az: number, d: number, u: number, v: number, s: number) => {
    const [x, z] = at(ax, az, d, u, v)
    trees.push({ x, z, s })
  }

  for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
    const ax = i * B, az = j * B
    for (const d of [0, 3]) {
      const [dx, dz] = dirv(d)
      const clrA = clearance(i, j), clrB = clearance(i + dx, j + dz)
      const S0 = clrA, S1 = B - clrB
      mk(ax, az, d, S0, S1, -0.27, -0.13, YELLOW)
      mk(ax, az, d, S0, S1, 0.13, 0.27, YELLOW)
      for (let k = 1; k < LANES; k++) for (const sg of [-1, 1]) {
        const v = sg * LANE_W * k // dashed dividers between lanes of the same direction
        for (let u = S0 + 4; u + 3 < S1 - 12; u += 12) mk(ax, az, d, u, u + 3, v - 0.075, v + 0.075, WHITE)
      }
      mk(ax, az, d, S0, S1, HALF_ROAD - 0.35, HALF_ROAD - 0.15, WHITE)
      mk(ax, az, d, S0, S1, -HALF_ROAD + 0.15, -HALF_ROAD + 0.35, WHITE)
      // stop lines + zebra crossings at both ends
      mk(ax, az, d, S1 - 2.3, S1 - 1.7, 0.4, HALF_ROAD - 0.1, WHITE)
      mk(ax, az, d, S0 + 1.7, S0 + 2.3, -HALF_ROAD + 0.1, -0.4, WHITE)
      // painted lane arrows (inner lane: left, middle: straight, outer: straight + right). Roundabout ends: straight.
      const endKinds = (round: boolean): Array<'L' | 'S' | 'SR'> => (round ? ['S', 'S', 'S'] : ['L', 'S', 'SR'])
      for (const [uEnd, ds, round, v0sign] of [[S1, 1, nodeKind(i + dx, j + dz) === 'round', 1], [S0, -1, nodeKind(i, j) === 'round', -1]] as Array<[number, 1 | -1, boolean, 1 | -1]>) {
        endKinds(round).forEach((kind, k) => {
          for (const back of [20, 58]) arrow(ax, az, d, uEnd - ds * back, ds, v0sign * laneOff(k), kind)
        })
      }
      for (let v = -9.6; v <= 9.7; v += 1.2) {
        mk(ax, az, d, S1 - 7.6, S1 - 4.6, v - 0.3, v + 0.3, WHITE)
        mk(ax, az, d, S0 + 4.6, S0 + 7.6, v - 0.3, v + 0.3, WHITE)
      }
      // sidewalks
      const [sx0, sz0] = at(ax, az, d, (S0 + S1) / 2, HALF_ROAD + 1.7)
      const [sx1, sz1] = at(ax, az, d, (S0 + S1) / 2, -(HALF_ROAD + 1.7))
      const along = S1 - S0
      const horizontal = dz === 0
      for (const [sx, sz] of [[sx0, sz0], [sx1, sz1]]) solid.box(sx, 0, sz, horizontal ? along : 3, 0.15, horizontal ? 3 : along, 0, CONC)
      // street trees
      for (let u = S0 + 14; u < S1 - 10; u += 26) {
        treeAlong(ax, az, d, u, HALF_ROAD + 5, 0.9 + hashN(ax + u, az, 5) * 0.4)
        treeAlong(ax, az, d, u + 13, -(HALF_ROAD + 5), 0.9 + hashN(ax + u, az, 6) * 0.4)
      }
    }
  }

  // ---------------- junction furniture ----------------
  for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
    const cx = i * B, cz = j * B
    const n = nodeIndex(i, j)
    const kind = nodeKind(i, j)
    const clr = clearance(i, j)

    if (kind === 'signal') {
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) solid.box(cx + sx * (HALF_ROAD + 7.2), 0, cz + sz * (HALF_ROAD + 7.2), 14, 0.15, 14, 0, CONC)
    } else {
      // island: kerb, grass, trees
      const kerb = new THREE.CylinderGeometry(ISLAND_R, ISLAND_R, 0.22, 56)
      kerb.translate(cx, 0.11, cz)
      solid.addGeometry(kerb, [0.6, 0.6, 0.62])
      const grass = new THREE.CylinderGeometry(ISLAND_R - 0.7, ISLAND_R - 0.7, 0.05, 56)
      grass.translate(cx, 0.245, cz)
      solid.addGeometry(grass, [0.2, 0.42, 0.16])
      for (let k = 0; k < 4; k++) trees.push({ x: cx + Math.cos(k * 1.57 + 0.7) * 8, z: cz + Math.sin(k * 1.57 + 0.7) * 8, s: 1.1 + (k % 2) * 0.3 })
      trees.push({ x: cx, z: cz, s: 1.5 })
      // outer edge lines between the arms
      for (let d = 0; d < 4; d++) {
        const t0 = (d * Math.PI) / 2 + 0.42, t1 = ((d + 1) * Math.PI) / 2 - 0.42
        const m = 10
        for (let q = 0; q < m; q++) {
          const a0 = t0 + ((t1 - t0) * q) / m, a1 = t0 + ((t1 - t0) * (q + 1)) / m
          const p = (r: number, a: number): V2 => [cx + r * Math.cos(a), cz - r * Math.sin(a)]
          marks.upQuad([p(RING_OUT - 0.5, a0), p(RING_OUT - 0.5, a1), p(RING_OUT - 0.3, a1), p(RING_OUT - 0.3, a0)], 0.02, WHITE)
        }
      }
    }

    for (let a = 0; a < 4; a++) {
      const [ox, oz] = dirv(a)
      const [rx, rz] = dirv(a + 1) // right of the inbound travel direction
      const P = (u: number, q: number): V2 => [cx + ox * u + rx * q, cz + oz * u + rz * q]
      const face: V2 = [ox, oz]
      const crossIdx = a % 2 === 0 ? i : 4 + j // road that crosses the one being driven along
      const yaw = Math.atan2(ox, oz)

      // overhead gantry
      const gu = clr + 90
      const [gp0x, gp0z] = P(gu, 0.4), [gp1x, gp1z] = P(gu, HALF_ROAD + 0.9), [gcx, gcz] = P(gu, (HALF_ROAD + 1.3) / 2)
      post(gp0x, gp0z, 7.8, 0.35)
      post(gp1x, gp1z, 7.8, 0.35)
      solid.box(gcx, 7.55, gcz, HALF_ROAD + 0.5, 0.35, 0.35, Math.atan2(-rz, rx), POLE)
      signQuad(gcx + ox * 0.25, 5.9, gcz + oz * 0.25, 7.4, 3.7, face, PANEL(crossIdx))

      // roadside signs on the right-hand verge
      const side = (u: number, h: number, w: number, hh: number, r: Rect) => {
        const [x, z] = P(u, HALF_ROAD + 1.7)
        post(x, z, h)
        signQuad(x + ox * 0.08, h + hh / 2 - 0.1, z + oz * 0.08, w, hh, face, r)
      }
      side(clr + 62, 2.6, 1.1, 1.1, kind === 'signal' ? SIGN.sigWarn : SIGN.rbWarn)
      side(clr + 30, 2.4, 0.95, 0.95, SIGN.speed)
      side(clr + 11, 2.3, 0.95, 0.95, SIGN.ped)
      side(clr + 46, 2.5, 1.3, 1.3, SIGN.lanes)

      if (kind === 'signal') {
        // mast arm over the lanes with two signal heads and a street-name plate
        const mu = clr + 0.6
        const [px, pz] = P(mu, HALF_ROAD + 1.7)
        post(px, pz, 6.2, 0.28)
        const [mx, mz] = P(mu, (HALF_ROAD + 1.7 + 0.6) / 2)
        solid.box(mx, 5.9, mz, HALF_ROAD + 1.1, 0.22, 0.22, Math.atan2(-rz, rx), POLE)
        for (const q of [laneOff(0), laneOff(1), laneOff(2)]) {
          const [hx, hz] = P(mu, q)
          solid.box(hx, 4.65, hz, 0.45, 1.25, 0.3, yaw, DARK)
          for (let l = 0; l < 3; l++) lamps.push({ x: hx + ox * 0.17, y: 5.55 - l * 0.38, z: hz + oz * 0.17, yaw, node: n, axis: a % 2 === 0 ? 0 : 1, l })
        }
        const [nx, nz] = P(mu, 5.3)
        signQuad(nx + ox * 0.15, 6.75, nz + oz * 0.15, 2.4, 1.2, face, PLATE(crossIdx))
      } else {
        // give way + roundabout signs at the entry, chevrons on the island
        const [yx, yz] = P(clr + 2.5, HALF_ROAD + 1.7)
        post(yx, yz, 3.9)
        signQuad(yx + ox * 0.08, 2.6, yz + oz * 0.08, 1.1, 1.1, face, SIGN.yield)
        signQuad(yx + ox * 0.08, 3.75, yz + oz * 0.08, 0.95, 0.95, face, SIGN.rbMust)
        const [qx, qz] = [cx + ox * (ISLAND_R - 0.3), cz + oz * (ISLAND_R - 0.3)]
        post(qx, qz, 1.5, 0.08)
        signQuad(qx + ox * 0.06, 1.35, qz + oz * 0.06, 1.8, 1.35, face, SIGN.chevron)
      }
    }
  }

  // ---------------- blocks: plazas, buildings, parks ----------------
  for (const l of LOTS) {
    if (l.park) {
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
        trees.push({ x: l.x0 + 8 + a * 18 + hashN(l.x0, a, b) * 5, z: l.z0 + 8 + b * 18 + hashN(l.z0, b, a) * 5, s: 0.9 + hashN(a, b, l.x0) * 0.6 })
      }
      continue
    }
    solid.box((l.x0 + l.x1) / 2, 0, (l.z0 + l.z1) / 2, l.x1 - l.x0, 0.08, l.z1 - l.z0, 0, [0.55, 0.56, 0.58])
    buildings.box((l.bx0 + l.bx1) / 2, 0.08, (l.bz0 + l.bz1) / 2, l.bx1 - l.bx0, l.h, l.bz1 - l.bz0, 0, l.color, true)
  }

  return { asphalt: asphalt.build(), marks: marks.build(), solid: solid.build(), buildings: buildings.build(), signs: signs.build(), lamps, trees }
}
export { BOX }
