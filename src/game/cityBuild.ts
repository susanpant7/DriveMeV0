import * as THREE from 'three'
import { APRON_R, FLARE, HALF_MID, RING_R, segHalves, B, BOX, G, HALF_ROAD, HORIZONTAL_NAMES, ISLAND_R, LANE_W, LOTS, RING_OUT, VERTICAL_NAMES, clearance, dirv, hashN, laneOff, nodeIndex, nodeKind } from './map'

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

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath()
}

export function drawSpeedSign(g: CanvasRenderingContext2D, units: 'kmh' | 'mph') {
  const { x, y, w, h } = SIGN.speed
  g.clearRect(x, y, w, h)
  g.fillStyle = '#fff'; roundRect(g, x + 4, y + 4, w - 8, h - 8, 16); g.fill()
  g.strokeStyle = '#111'; g.lineWidth = 9; roundRect(g, x + 12, y + 12, w - 24, h - 24, 10); g.stroke()
  g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'
  g.font = '700 38px Arial, sans-serif'
  g.fillText('SPEED', x + 128, y + 52)
  g.fillText('LIMIT', x + 128, y + 90)
  g.font = '700 118px Arial, sans-serif'
  g.fillText(units === 'mph' ? '30' : '50', x + 128, y + 172)
}

export function makeAtlas(units: 'kmh' | 'mph') {
  const c = document.createElement('canvas')
  c.width = ATLAS_W
  c.height = ATLAS_H
  const g = c.getContext('2d')!
  drawSpeedSign(g, units)

  // give way (red / white, point down)
  {
    const r = SIGN.yield
    g.fillStyle = '#d8251d'; g.beginPath(); g.moveTo(r.x + 6, r.y + 24); g.lineTo(r.x + 250, r.y + 24); g.lineTo(r.x + 128, r.y + 236); g.closePath(); g.fill()
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(r.x + 42, r.y + 50); g.lineTo(r.x + 214, r.y + 50); g.lineTo(r.x + 128, r.y + 198); g.closePath(); g.fill()
  }
  // yellow diamond warning signs
  const diamond = (r: Rect) => {
    g.fillStyle = '#111'; g.beginPath(); g.moveTo(r.x + 128, r.y + 4); g.lineTo(r.x + 252, r.y + 128); g.lineTo(r.x + 128, r.y + 252); g.lineTo(r.x + 4, r.y + 128); g.closePath(); g.fill()
    g.fillStyle = '#f7c600'; g.beginPath(); g.moveTo(r.x + 128, r.y + 16); g.lineTo(r.x + 240, r.y + 128); g.lineTo(r.x + 128, r.y + 240); g.lineTo(r.x + 16, r.y + 128); g.closePath(); g.fill()
  }
  // roundabout ahead
  diamond(SIGN.rbWarn)
  g.strokeStyle = '#111'; g.fillStyle = '#111'; g.lineWidth = 11
  for (let i = 0; i < 3; i++) {
    const a = (i * 2 * Math.PI) / 3 - Math.PI / 2
    g.beginPath(); g.arc(SIGN.rbWarn.x + 128, SIGN.rbWarn.y + 128, 42, a, a + 1.5); g.stroke()
    arrowHead(g, SIGN.rbWarn.x + 128 + 42 * Math.cos(a + 1.5), SIGN.rbWarn.y + 128 + 42 * Math.sin(a + 1.5), a + 1.5 + Math.PI / 2, 15)
  }
  // traffic signal ahead
  diamond(SIGN.sigWarn)
  g.fillStyle = '#111'; roundRect(g, SIGN.sigWarn.x + 100, SIGN.sigWarn.y + 70, 56, 116, 10); g.fill()
  ;['#e22', '#fb0', '#2c4'].forEach((c, i) => { g.fillStyle = c; g.beginPath(); g.arc(SIGN.sigWarn.x + 128, SIGN.sigWarn.y + 94 + i * 36, 13, 0, 7); g.fill() })
  // pedestrian crossing: fluorescent yellow-green pentagon
  {
    const r = SIGN.ped
    const pent = (inset: number, color: string) => {
      g.fillStyle = color; g.beginPath()
      g.moveTo(r.x + 128, r.y + 6 + inset); g.lineTo(r.x + 246 - inset, r.y + 70 + inset); g.lineTo(r.x + 246 - inset, r.y + 246 - inset)
      g.lineTo(r.x + 10 + inset, r.y + 246 - inset); g.lineTo(r.x + 10 + inset, r.y + 70 + inset); g.closePath(); g.fill()
    }
    pent(0, '#111'); pent(10, '#c8ff1f')
    g.fillStyle = '#111'; g.beginPath(); g.arc(r.x + 136, r.y + 92, 15, 0, 7); g.fill()
    g.strokeStyle = '#111'; g.lineWidth = 13; g.lineCap = 'round'; g.lineJoin = 'round'
    g.beginPath(); g.moveTo(r.x + 134, r.y + 112); g.lineTo(r.x + 124, r.y + 160); g.lineTo(r.x + 100, r.y + 210); g.moveTo(r.x + 124, r.y + 160); g.lineTo(r.x + 150, r.y + 205)
    g.moveTo(r.x + 132, r.y + 124); g.lineTo(r.x + 168, r.y + 148); g.moveTo(r.x + 132, r.y + 124); g.lineTo(r.x + 98, r.y + 140); g.stroke()
  }
  // circular intersection (white, black arrows)
  {
    const r = SIGN.rbMust
    g.fillStyle = '#fff'; roundRect(g, r.x + 8, r.y + 8, 240, 240, 16); g.fill()
    g.strokeStyle = '#111'; g.lineWidth = 8; roundRect(g, r.x + 16, r.y + 16, 224, 224, 10); g.stroke()
    g.strokeStyle = '#111'; g.fillStyle = '#111'; g.lineWidth = 13
    for (let i = 0; i < 3; i++) {
      const a = (i * 2 * Math.PI) / 3 - Math.PI / 2
      g.beginPath(); g.arc(r.x + 128, r.y + 128, 56, a, a + 1.55); g.stroke()
      arrowHead(g, r.x + 128 + 56 * Math.cos(a + 1.55), r.y + 128 + 56 * Math.sin(a + 1.55), a + 1.55 + Math.PI / 2, 21)
    }
  }
  // chevron: black on yellow
  {
    const r = SIGN.chevron
    g.fillStyle = '#111'; g.fillRect(r.x + 8, r.y + 40, 240, 176)
    g.fillStyle = '#f7c600'; g.fillRect(r.x + 16, r.y + 48, 224, 160)
    g.strokeStyle = '#111'; g.lineWidth = 26; g.lineJoin = 'miter'
    g.beginPath(); g.moveTo(r.x + 96, r.y + 72); g.lineTo(r.x + 168, r.y + 128); g.lineTo(r.x + 96, r.y + 184); g.stroke()
  }
  // lane-use sign: white, black arrows (left / straight / right)
  {
    const r = SIGN.lanes
    g.fillStyle = '#fff'; roundRect(g, r.x + 8, r.y + 8, 240, 240, 16); g.fill()
    g.strokeStyle = '#111'; g.lineWidth = 8; roundRect(g, r.x + 16, r.y + 16, 224, 224, 10); g.stroke()
    g.fillStyle = '#111'; g.strokeStyle = '#111'; g.lineWidth = 16; g.lineCap = 'butt'
    const lane = (cx: number, kind: 'L' | 'S' | 'R' | 'SR') => {
      const bx = r.x + cx, by = r.y + 214
      g.beginPath(); g.moveTo(bx, by); g.lineTo(bx, by - 100); g.stroke()
      if (kind === 'SR') {
        g.beginPath(); g.moveTo(bx - 26, by - 100); g.lineTo(bx + 26, by - 100); g.lineTo(bx, by - 150); g.closePath(); g.fill()
        g.beginPath(); g.moveTo(bx, by - 62); g.lineTo(bx + 34, by - 96); g.stroke()
        g.beginPath(); g.moveTo(bx + 14, by - 122); g.lineTo(bx + 62, by - 122); g.lineTo(bx + 62, by - 74); g.closePath(); g.fill()
      } else if (kind === 'S') { g.beginPath(); g.moveTo(bx - 26, by - 100); g.lineTo(bx + 26, by - 100); g.lineTo(bx, by - 150); g.closePath(); g.fill() }
      else {
        const d = kind === 'L' ? -1 : 1
        g.beginPath(); g.moveTo(bx, by - 100); g.lineTo(bx + d * 40, by - 140); g.stroke()
        g.beginPath(); g.moveTo(bx + d * 18, by - 160); g.lineTo(bx + d * 70, by - 160); g.lineTo(bx + d * 70, by - 108); g.closePath(); g.fill()
      }
    }
    lane(62, 'L'); lane(118, 'S'); lane(170, 'R')
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

/** Curtain-wall facade: colour, roughness and metalness maps (glass is glossy and reflects the sky). */
export function facadeCanvases() {
  const mk = () => {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    return { c, g: c.getContext('2d')! }
  }
  const col = mk(), rough = mk(), metal = mk()
  col.g.fillStyle = '#dcd9d2'; col.g.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 900; i++) {
    const v = 195 + Math.random() * 40
    col.g.fillStyle = `rgba(${v},${v - 2},${v - 8},0.35)`
    col.g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2)
  }
  rough.g.fillStyle = '#e6e6e6'; rough.g.fillRect(0, 0, 256, 256)
  metal.g.fillStyle = '#000'; metal.g.fillRect(0, 0, 256, 256)
  for (const fy of [0, 128]) {
    const y0 = fy + 20, h = 90
    const gl = col.g.createLinearGradient(0, y0, 0, y0 + h)
    gl.addColorStop(0, '#a9c4dc'); gl.addColorStop(0.55, '#5f7f9c'); gl.addColorStop(1, '#34506a')
    col.g.fillStyle = '#2a3037'; col.g.fillRect(8, y0 - 5, 240, h + 10)
    col.g.fillStyle = gl; col.g.fillRect(12, y0, 232, h)
    // reflection streak + mullions
    col.g.fillStyle = 'rgba(255,255,255,0.13)'
    col.g.beginPath(); col.g.moveTo(40, y0 + h); col.g.lineTo(88, y0); col.g.lineTo(120, y0); col.g.lineTo(72, y0 + h); col.g.closePath(); col.g.fill()
    for (const mx of [76, 140, 204]) { col.g.fillStyle = '#2a3037'; col.g.fillRect(mx - 2, y0, 4, h) }
    rough.g.fillStyle = '#1c1c1c'; rough.g.fillRect(12, y0, 232, h)
    metal.g.fillStyle = '#8c8c8c'; metal.g.fillRect(12, y0, 232, h)
    for (const mx of [76, 140, 204]) { rough.g.fillStyle = '#a0a0a0'; rough.g.fillRect(mx - 2, y0, 4, h); metal.g.fillStyle = '#000'; metal.g.fillRect(mx - 2, y0, 4, h) }
  }
  return { color: col.c, rough: rough.c, metal: metal.c }
}

/* ------------------------------------------------------------------ */
/* One period of the city                                              */
/* ------------------------------------------------------------------ */
export interface LampDef { x: number; y: number; z: number; yaw: number; node: number; axis: 0 | 1; l: number; arrow: boolean }
export interface TreeDef { x: number; z: number; s: number }

type Pt2 = [number, number]
/** polygons (in the lane's travel frame: a = forward, b = toward the travel-right) for each arrow kind */
const ARROW_SHAPES: Record<'L' | 'S' | 'R' | 'SR', Pt2[][]> = (() => {
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
  return { S: straight, L: turn(-1), R: turn(1), SR: sr }
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

  const at = (ax: number, az: number, d: number, u: number, v: number): V2 => {
    const [dx, dz] = dirv(d), [rx, rz] = dirv(d - 1)
    return [ax + dx * u + rx * v, az + dz * u + rz * v]
  }
  // ---------------- roads ----------------
  // Ordinary roads are 2 lanes each way; on the approach to a signalised junction the road widens (outward) for a third lane.
  for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
    const cx = i * B, cz = j * B
    if (nodeKind(i, j) === 'signal') asphalt.rect(cx - BOX, cz - BOX, cx + BOX, cz + BOX, 0, [1, 1, 1])
    else {
      const ring = new THREE.RingGeometry(ISLAND_R - 1, RING_OUT, 72, 1)
      ring.rotateX(-Math.PI / 2)
      ring.translate(cx, 0.001, cz)
      asphalt.addGeometry(ring, [1, 1, 1], 4)
    }
    for (const d of [0, 3]) {
      const [dx, dz] = dirv(d)
      const kA = nodeKind(i, j), kB = nodeKind(i + dx, j + dz)
      const cA = clearance(i, j), cB = clearance(i + dx, j + dz)
      const u0 = kA === 'round' ? cA - 3 : cA
      const u1 = kB === 'round' ? B - cB + 3 : B - cB
      for (let u = u0; u < u1 - 0.01; u += 4) {
        const ue = Math.min(u + 4, u1)
        const h0 = segHalves(kA, kB, cA, cB, u), h1 = segHalves(kA, kB, cA, cB, ue)
        asphalt.upQuad([at(cx, cz, d, u, h0.right + 0.5), at(cx, cz, d, ue, h1.right + 0.5), at(cx, cz, d, ue, -(h1.left + 0.5)), at(cx, cz, d, u, -(h0.left + 0.5))], 0, [1, 1, 1])
      }
    }
  }

  // ---------------- markings, kerbs, per-edge props ----------------
  const mk = (ax: number, az: number, d: number, u0: number, u1: number, v0: number, v1: number, color: V3, y = 0.02) =>
    marks.upQuad([at(ax, az, d, u0, v0), at(ax, az, d, u1, v0), at(ax, az, d, u1, v1), at(ax, az, d, u0, v1)], y, color)

  /** painted arrow on a lane: tail at road coordinate u0, pointing along `ds` (+1/-1), lane centre at v0 */
  const arrow = (ax: number, az: number, d: number, u0: number, ds: 1 | -1, v0: number, kind: 'L' | 'S' | 'R' | 'SR') => {
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
      const kA = nodeKind(i, j), kB = nodeKind(i + dx, j + dz)
      mk(ax, az, d, S0, S1, -0.27, -0.13, YELLOW)
      mk(ax, az, d, S0, S1, 0.13, 0.27, YELLOW)
      // dashed divider between the two ordinary lanes, both directions
      for (const sg of [-1, 1]) {
        for (let u = S0 + 4; u + 3 < S1 - 12; u += 12) mk(ax, az, d, u, u + 3, sg * LANE_W - 0.075, sg * LANE_W + 0.075, WHITE)
      }
      // the added right-turn lane: its own dashed divider, only where that lane exists
      if (kB === 'signal') for (let u = S1 - FLARE + 2; u + 3 < S1 - 12; u += 12) mk(ax, az, d, u, u + 3, 2 * LANE_W - 0.075, 2 * LANE_W + 0.075, WHITE)
      if (kA === 'signal') for (let u = S0 + 12; u + 3 < S0 + FLARE - 2; u += 12) mk(ax, az, d, u, u + 3, -2 * LANE_W - 0.075, -2 * LANE_W + 0.075, WHITE)
      // edge lines follow the widening road
      for (let u = S0; u < S1 - 0.01; u += 3) {
        const ue = Math.min(u + 3, S1)
        const h0 = segHalves(kA, kB, S0, B - S1, u), h1 = segHalves(kA, kB, S0, B - S1, ue)
        marks.upQuad([at(ax, az, d, u, h0.right - 0.35), at(ax, az, d, ue, h1.right - 0.35), at(ax, az, d, ue, h1.right - 0.15), at(ax, az, d, u, h0.right - 0.15)], 0.02, WHITE)
        marks.upQuad([at(ax, az, d, u, -(h0.left - 0.15)), at(ax, az, d, ue, -(h1.left - 0.15)), at(ax, az, d, ue, -(h1.left - 0.35)), at(ax, az, d, u, -(h0.left - 0.35))], 0.02, WHITE)
      }
      // stop lines + zebra crossings at both ends
      const roundEnd1 = nodeKind(i + dx, j + dz) === 'round'
      const roundEnd0 = nodeKind(i, j) === 'round'
      if (!roundEnd1) mk(ax, az, d, S1 - 2.3, S1 - 1.7, 0.4, HALF_ROAD - 0.1, WHITE)
      if (!roundEnd0) mk(ax, az, d, S0 + 1.7, S0 + 2.3, -HALF_ROAD + 0.1, -0.4, WHITE)
      // roundabout entries: a yield line of white triangles ("shark teeth") pointing at approaching drivers,
      // and a raised splitter island that separates entering from leaving traffic
      const teeth = (uEnd: number, ds: 1 | -1, vSign: 1 | -1) => {
        for (let v = 0.5; v < HALF_MID - 0.6; v += 0.9) {
          const p0 = at(ax, az, d, uEnd - ds * 2.1, vSign * v)
          const p1 = at(ax, az, d, uEnd - ds * 2.1, vSign * (v + 0.6))
          const p2 = at(ax, az, d, uEnd - ds * 3.0, vSign * (v + 0.3)) // the tip points back at the approaching car
          marks.upQuad([p0, p1, p2, p2], 0.02, WHITE)
        }
      }
      const island = (uEnd: number, ds: 1 | -1) => {
        const pts: Pt2[] = [[0.6, -1.9], [0.6, 1.9], [9, 1.55], [20, 0.7], [29, 0.15], [20, -0.7], [9, -1.55]]
        const shape = new THREE.Shape()
        pts.forEach(([a, b], k) => {
          const [wx, wz] = at(ax, az, d, uEnd - ds * a, b)
          if (k) shape.lineTo(wx, -wz)
          else shape.moveTo(wx, -wz)
        })
        shape.closePath()
        const g = new THREE.ExtrudeGeometry(shape, { depth: 0.17, bevelEnabled: false })
        g.rotateX(-Math.PI / 2)
        solid.addGeometry(g, [0.66, 0.67, 0.69])
        // reflective yellow nose on the approaching end
        const nose = at(ax, az, d, uEnd - ds * 29.4, 0)
        solid.box(nose[0], 0, nose[1], 0.4, 0.5, 0.4, 0, YELLOW)
      }
      if (roundEnd1) { teeth(S1, 1, 1); island(S1, 1) }
      if (roundEnd0) { teeth(S0, -1, -1); island(S0, -1) }
      // painted lane arrows: inner lane left, middle straight, added outer lane right. Roundabout ends (2 lanes): straight.
      const endKinds = (round: boolean): Array<'L' | 'S' | 'R'> => (round ? ['S', 'S'] : ['L', 'S', 'R'])
      for (const [uEnd, ds, round, v0sign] of [[S1, 1, nodeKind(i + dx, j + dz) === 'round', 1], [S0, -1, nodeKind(i, j) === 'round', -1]] as Array<[number, 1 | -1, boolean, 1 | -1]>) {
        endKinds(round).forEach((kind, k) => {
          for (const back of [20, 58]) arrow(ax, az, d, uEnd - ds * back, ds, v0sign * laneOff(k), kind)
        })
      }
      // crosswalks: across the full road width at that end (3 lanes on the approach to a signal, 2 elsewhere)
      const ext1 = kB === 'signal' ? HALF_ROAD - 0.3 : HALF_MID - 0.2
      const ext0 = kA === 'signal' ? HALF_ROAD - 0.3 : HALF_MID - 0.2
      for (let v = -(HALF_MID - 0.2); v <= ext1; v += 1.2) {
        const o1 = roundEnd1 ? 7.4 : 0 // one car length back from a roundabout's yield line
        mk(ax, az, d, S1 - 7.6 - o1, S1 - 4.6 - o1, v - 0.3, v + 0.3, WHITE)
      }
      for (let v = -ext0; v <= HALF_MID - 0.2; v += 1.2) {
        const o0 = roundEnd0 ? 7.4 : 0
        mk(ax, az, d, S0 + 4.6 + o0, S0 + 7.6 + o0, v - 0.3, v + 0.3, WHITE)
      }
      // sidewalks follow the road edge, stepping out where the turn lane is added
      {
        const SW = 3
        const horizontal = dz === 0
        for (const sg of [1, -1] as const) {
          const runs: Array<[number, number, number]> = []
          for (let u = S0; u < S1 - 0.01; u += 6) {
            const um = Math.min(u + 6, S1)
            const h = segHalves(kA, kB, S0, B - S1, (u + um) / 2)
            const off = (sg === 1 ? h.right : h.left) + 0.5 + SW / 2
            const last = runs[runs.length - 1]
            if (last && Math.abs(last[2] - off) < 0.05) last[1] = um
            else runs.push([u, um, off])
          }
          for (const [r0, r1, off] of runs) {
            const [wx, wz] = at(ax, az, d, (r0 + r1) / 2, sg * off)
            solid.box(wx, 0, wz, horizontal ? r1 - r0 + 0.02 : SW, 0.15, horizontal ? SW : r1 - r0 + 0.02, 0, CONC)
          }
        }
      }
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
      // truck apron: the mountable ring around the central island
      const apron = new THREE.RingGeometry(ISLAND_R - 0.1, APRON_R, 72, 1)
      apron.rotateX(-Math.PI / 2)
      apron.translate(cx, 0.028, cz)
      marks.addGeometry(apron, [0.4, 0.36, 0.33], 3)
      const apronEdge = new THREE.RingGeometry(APRON_R - 0.3, APRON_R, 72, 1)
      apronEdge.rotateX(-Math.PI / 2)
      apronEdge.translate(cx, 0.03, cz)
      marks.addGeometry(apronEdge, [0.9, 0.9, 0.87], 3)
      // counter-clockwise direction arrows on the circulating roadway, between the arms
      for (let q = 0; q < 4; q++) {
        const th = (q * Math.PI) / 2 + Math.PI / 4
        const px = cx + RING_R * Math.cos(th), pz = cz - RING_R * Math.sin(th)
        const fxv = -Math.sin(th), fzv = -Math.cos(th) // direction of travel (counter-clockwise)
        const rxv = -fzv, rzv = fxv
        for (const poly of ARROW_SHAPES.S) {
          const pts = poly.map(([a, b]) => [px + fxv * (a - 1.9) + rxv * b, pz + fzv * (a - 1.9) + rzv * b] as V2)
          marks.upQuad(pts.length === 3 ? [pts[0], pts[1], pts[2], pts[2]] : [pts[0], pts[1], pts[2], pts[3]], 0.03, WHITE)
        }
      }
      // kerbed pavement around the outside, between the arms
      for (let q = 0; q < 4; q++) {
        const a0 = (q * Math.PI) / 2 + 0.42, a1 = ((q + 1) * Math.PI) / 2 - 0.42
        const sh = new THREE.Shape()
        sh.absarc(cx, -cz, RING_OUT + 4, a0, a1, false)
        sh.absarc(cx, -cz, RING_OUT + 0.1, a1, a0, true)
        const g = new THREE.ExtrudeGeometry(sh, { depth: 0.15, bevelEnabled: false, curveSegments: 14 })
        g.rotateX(-Math.PI / 2)
        solid.addGeometry(g, CONC)
      }
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
      const HW = kind === 'signal' ? HALF_ROAD : HALF_MID // half-width of the approach where the signs stand

      // overhead gantry
      const gu = clr + 90
      const [gp0x, gp0z] = P(gu, 0.4), [gp1x, gp1z] = P(gu, HW + 0.9), [gcx, gcz] = P(gu, (HW + 1.3) / 2)
      post(gp0x, gp0z, 7.8, 0.35)
      post(gp1x, gp1z, 7.8, 0.35)
      solid.box(gcx, 7.55, gcz, HW + 0.5, 0.35, 0.35, Math.atan2(-rz, rx), POLE)
      signQuad(gcx + ox * 0.25, 5.9, gcz + oz * 0.25, 7.4, 3.7, face, PANEL(crossIdx))

      // roadside signs on the right-hand verge
      const side = (u: number, h: number, w: number, hh: number, r: Rect) => {
        const [x, z] = P(u, HW + 1.7)
        post(x, z, h)
        signQuad(x + ox * 0.08, h + hh / 2 - 0.1, z + oz * 0.08, w, hh, face, r)
      }
      side(clr + 62, 2.6, 1.1, 1.1, kind === 'signal' ? SIGN.sigWarn : SIGN.rbWarn)
      side(clr + 30, 2.4, 0.85, 1.05, SIGN.speed)
      side(clr + 11, 2.3, 0.95, 0.95, SIGN.ped)
      if (kind === 'signal') side(clr + 46, 2.5, 1.3, 1.3, SIGN.lanes) // lane-use sign (matches the painted arrows)

      if (kind === 'signal') {
        // Signals hang ACROSS the road on the FAR side of the junction, facing the waiting traffic:
        // a mast arm over the lanes with one head per lane, plus a pole head at the far-left corner.
        const uf = -(clr + 1.5)
        const qEdge = HALF_ROAD + 1.7
        // a signal head: black backplate with a yellow reflective border, housing, and a visor over each lamp
        const head = (hx: number, hz: number, yc: number) => {
          const rxv = oz, rzv = -ox // the head's right-hand axis, seen from the approaching driver
          solid.box(hx, yc, hz, 0.82, 2.02, 0.1, yaw, DARK)
          for (const [dx, dy, w, hh] of [[0, 1.0, 0.82, 0.05], [0, -1.0, 0.82, 0.05], [-0.385, 0, 0.05, 2.02], [0.385, 0, 0.05, 2.02]]) {
            solid.box(hx + ox * 0.056 + rxv * dx, yc + dy, hz + oz * 0.056 + rzv * dx, w, hh, 0.012, yaw, YELLOW)
          }
          solid.box(hx, yc, hz, 0.62, 1.75, 0.3, yaw, DARK)
          for (let l = 0; l < 3; l++) solid.box(hx + ox * 0.2, yc + 0.75 - l * 0.5, hz + oz * 0.2, 0.5, 0.035, 0.34, yaw, DARK)
        }
        const [px, pz] = P(uf, qEdge)
        post(px, pz, 5.0, 0.3)
        const armLen = qEdge - 0.2
        const [mx, mz] = P(uf, (qEdge + 0.2) / 2)
        solid.box(mx, 4.75, mz, armLen, 0.22, 0.22, Math.atan2(-rz, rx), POLE)
        ;[laneOff(0), laneOff(1), laneOff(2)].forEach((q, lane) => {
          const [hx, hz] = P(uf, q)
          head(hx, hz, 3.7)
          // the left lane has its own left-turn ARROW signal; the other lanes show the through signal
          for (let l = 0; l < 3; l++) lamps.push({ x: hx + ox * 0.17, y: 4.2 - l * 0.5, z: hz + oz * 0.17, yaw, node: n, axis: a % 2 === 0 ? 0 : 1, l, arrow: lane === 0 })
        })
        // far-left corner pole: a second set, seen from the right-hand lanes too
        const [lx, lz] = P(uf, -qEdge)
        post(lx, lz, 4.4, 0.22)
        head(lx, lz, 2.9)
        for (let l = 0; l < 3; l++) lamps.push({ x: lx + ox * 0.17, y: 3.4 - l * 0.5, z: lz + oz * 0.17, yaw, node: n, axis: a % 2 === 0 ? 0 : 1, l, arrow: false })
        // street-name plate on top of the arm
        const [nx, nz] = P(uf, qEdge * 0.55)
        signQuad(nx + ox * 0.15, 5.5, nz + oz * 0.15, 2.4, 1.2, face, PLATE(crossIdx))
      } else {
        // give way + roundabout signs at the entry, chevrons on the island
        const [yx, yz] = P(clr + 2.5, HW + 1.7)
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
    const bw = l.bx1 - l.bx0, bd = l.bz1 - l.bz0, bcx = (l.bx0 + l.bx1) / 2, bcz = (l.bz0 + l.bz1) / 2
    buildings.box(bcx, 0.08, bcz, bw, l.h, bd, 0, l.color, true)
    solid.box(bcx, 0.08, bcz, bw + 2, 5, bd + 2, 0, [0.3, 0.31, 0.33]) // dark podium / shopfront band
    if (l.h > 26) buildings.box(bcx, 0.08 + l.h, bcz, bw * 0.66, l.h * 0.28, bd * 0.66, 0, [l.color[0] * 0.9, l.color[1] * 0.9, l.color[2] * 0.92], true) // setback tier
    solid.box(bcx, 0.08 + l.h + (l.h > 26 ? l.h * 0.28 : 0), bcz, bw * 0.3, 2.2, bd * 0.3, 0, [0.42, 0.43, 0.45]) // roof plant
  }

  return { asphalt: asphalt.build(), marks: marks.build(), solid: solid.build(), buildings: buildings.build(), signs: signs.build(), lamps, trees }
}
export { BOX }
