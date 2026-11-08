import * as THREE from 'three'
import { hasLeftArrow, onAsphalt, FLARE, HALF_MID, RB_SHIFT, TAPER, flareOf, rbShift, rbSpec, segHalves, B, BOX, G, HALF_ROAD, HORIZONTAL_NAMES, LANE_W, LOTS, VERTICAL_NAMES, clearance, dirv, hashN, laneOff, nodeIndex, nodeKind } from './map'

type V3 = [number, number, number]
type V2 = [number, number]

/** Accumulates triangles (position, normal, uv, colour) into one BufferGeometry. */
const CH = 4 // chunks per side (each B metres) so far-away parts of the city can be culled
const chunkOf = (x: number, z: number) => Math.min(CH - 1, Math.max(0, Math.floor(x / B))) * CH + Math.min(CH - 1, Math.max(0, Math.floor(z / B)))

interface Buf { pos: number[]; nor: number[]; uv: number[]; col: number[] }
/** Transparent dark marks laid over the asphalt: tyre tracks, repair patches and cracks (RGBA vertex colours). */
export class Wear {
  bufs: Array<{ pos: number[]; col: number[] }> = Array.from({ length: CH * CH }, () => ({ pos: [], col: [] }))
  quad(a: V2, b: V2, c: V2, d: V2, y: number, alpha: number, shade = 0) {
    const buf = this.bufs[chunkOf((a[0] + c[0]) / 2, (a[1] + c[1]) / 2)]
    for (const p of [a, b, c, a, c, d]) { buf.pos.push(p[0], y, p[1]); buf.col.push(shade, shade, shade, alpha) }
  }
  build(): THREE.BufferGeometry[] {
    return this.bufs.filter((b) => b.pos.length).map((b) => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3))
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 4))
      const n = new Float32Array(b.pos.length)
      for (let i = 1; i < n.length; i += 3) n[i] = 1
      g.setAttribute('normal', new THREE.BufferAttribute(n, 3))
      g.computeBoundingSphere()
      return g
    })
  }
}

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
export const ATLAS_H = 1280
const cell = (i: number): Rect => ({ x: i * 256, y: 0, w: 256, h: 256 })
const cell2 = (i: number): Rect => ({ x: i * 256, y: 896, w: 256, h: 256 })
export const SIGN = { leftYield: cell2(5), stopHere: cell2(3), only: cell2(4), speed: cell(0), yield: cell(1), rbWarn: cell(2), sigWarn: cell(3), ped: cell(4), rbMust: cell(5), chevron: cell(6), lanes: cell(7), rbLanes: cell2(0), keepRight: cell2(1), rightOnly: cell2(2) }
export const PLATE = (i: number): Rect => ({ x: i * 256, y: 256, w: 256, h: 128 })
export const PANEL = (i: number): Rect => ({ x: (i % 4) * 512, y: 384 + Math.floor(i / 4) * 256, w: 512, h: 256 })

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
  // roundabout lane-use sign: left lane straight + left, right lane straight + right
  {
    const r = SIGN.rbLanes
    g.fillStyle = '#fff'; roundRect(g, r.x + 8, r.y + 8, 240, 240, 16); g.fill()
    g.strokeStyle = '#111'; g.lineWidth = 8; roundRect(g, r.x + 16, r.y + 16, 224, 224, 10); g.stroke()
    g.fillStyle = '#111'; g.strokeStyle = '#111'; g.lineWidth = 15; g.lineCap = 'butt'
    const lane = (cx: number, dir: -1 | 1) => {
      const bx = r.x + cx, by = r.y + 220
      g.beginPath(); g.moveTo(bx, by); g.lineTo(bx, by - 112); g.stroke()
      g.beginPath(); g.moveTo(bx - 25, by - 112); g.lineTo(bx + 25, by - 112); g.lineTo(bx, by - 162); g.closePath(); g.fill() // straight
      g.beginPath(); g.moveTo(bx, by - 66); g.lineTo(bx + dir * 34, by - 100); g.stroke() // branch
      g.beginPath(); g.moveTo(bx + dir * 14, by - 126); g.lineTo(bx + dir * 62, by - 126); g.lineTo(bx + dir * 62, by - 78); g.closePath(); g.fill()
    }
    lane(88, -1); lane(172, 1)
  }
  // keep right (island nose)
  {
    const r = SIGN.keepRight
    g.fillStyle = '#fff'; roundRect(g, r.x + 40, r.y + 8, 176, 240, 14); g.fill()
    g.strokeStyle = '#111'; g.lineWidth = 8; roundRect(g, r.x + 48, r.y + 16, 160, 224, 9); g.stroke()
    g.fillStyle = '#111'; g.strokeStyle = '#111'; g.lineWidth = 22; g.lineCap = 'butt'
    g.beginPath(); g.moveTo(r.x + 104, r.y + 52); g.lineTo(r.x + 104, r.y + 120); g.lineTo(r.x + 158, r.y + 168); g.stroke()
    g.beginPath(); g.moveTo(r.x + 128, r.y + 150); g.lineTo(r.x + 186, r.y + 150); g.lineTo(r.x + 168, r.y + 208); g.closePath(); g.fill()
  }
  // right lane must turn right
  {
    const r = SIGN.rightOnly
    g.fillStyle = '#fff'; roundRect(g, r.x + 30, r.y + 8, 196, 240, 14); g.fill()
    g.strokeStyle = '#111'; g.lineWidth = 7; roundRect(g, r.x + 38, r.y + 16, 180, 224, 9); g.stroke()
    g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '800 38px Arial, sans-serif'
    ;['RIGHT', 'LANE', 'MUST', 'TURN', 'RIGHT'].forEach((t, i) => g.fillText(t, r.x + 128, r.y + 50 + i * 40))
  }
  // R10-12 "LEFT TURN YIELD ON GREEN": white sign, black left-turn arrow and red legend
  {
    const r = SIGN.leftYield
    g.fillStyle = '#fff'; roundRect(g, r.x + 30, r.y + 8, 196, 240, 14); g.fill()
    g.strokeStyle = '#111'; g.lineWidth = 7; roundRect(g, r.x + 38, r.y + 16, 180, 224, 9); g.stroke()
    // green disc with a left-turn arrow
    g.fillStyle = '#1b9a3f'; g.beginPath(); g.arc(r.x + 128, r.y + 82, 40, 0, 7); g.fill()
    g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 11; g.lineCap = 'butt'
    g.beginPath(); g.moveTo(r.x + 138, r.y + 104); g.lineTo(r.x + 138, r.y + 74); g.lineTo(r.x + 118, r.y + 74); g.stroke()
    g.beginPath(); g.moveTo(r.x + 118, r.y + 60); g.lineTo(r.x + 100, r.y + 74); g.lineTo(r.x + 118, r.y + 88); g.closePath(); g.fill()
    g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '800 31px Arial, sans-serif'
    ;['LEFT TURN', 'YIELD', 'ON GREEN'].forEach((t, i) => g.fillText(t, r.x + 128, r.y + 150 + i * 32, 170))
  }
  // "STOP HERE ON RED"
  {
    const r = SIGN.stopHere
    g.fillStyle = '#fff'; roundRect(g, r.x + 30, r.y + 8, 196, 240, 14); g.fill()
    g.strokeStyle = '#111'; g.lineWidth = 7; roundRect(g, r.x + 38, r.y + 16, 180, 224, 9); g.stroke()
    g.fillStyle = '#d8251d'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '800 40px Arial, sans-serif'
    ;['STOP', 'HERE', 'ON', 'RED'].forEach((t, i) => g.fillText(t, r.x + 128, r.y + 60 + i * 50))
  }
  // "ONLY" pavement text (white on transparent: laid flat on turn-only lanes)
  {
    const r = SIGN.only
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 104px Arial, sans-serif'
    g.fillText('ONLY', r.x + 128, r.y + 128, 244)
  }
  // street name plates
  ;[...VERTICAL_NAMES, ...HORIZONTAL_NAMES].forEach((name, i) => {
    const r = PLATE(i)
    g.fillStyle = '#0b6b3a'; g.fillRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8)
    g.strokeStyle = '#fff'; g.lineWidth = 5; g.strokeRect(r.x + 10, r.y + 10, r.w - 20, r.h - 20)
    g.fillStyle = '#fff'; g.font = '700 48px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText(name, r.x + r.w / 2, r.y + r.h / 2 + 3)
  })
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
const ARROW_SHAPES: Record<'L' | 'S' | 'R' | 'SR' | 'SL', Pt2[][]> = (() => {
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
  const sl: Pt2[][] = sr.map((poly) => poly.map(([a, b]) => [a, -b] as Pt2))
  return { S: straight, L: turn(-1), R: turn(1), SR: sr, SL: sl }
})()

/** every sign / signal post placed (for checking that none stands on the road) */
export const DEBUG_POSTS: Array<[number, number, number]> = []
/** every tree placed (for the same check) */
export const DEBUG_TREES: Array<{ x: number; z: number }> = []

export function buildCity() {
  const asphalt = new MB(), marks = new MB(), solid = new MB(), buildings = new MB(), signs = new MB(), wear = new Wear()
  const lamps: LampDef[] = []
  const trees: TreeDef[] = []
  const WHITE: V3 = [0.92, 0.92, 0.9], YELLOW: V3 = [0.95, 0.75, 0.1]
  const CONC: V3 = [0.44, 0.45, 0.47], POLE: V3 = [0.45, 0.47, 0.5]
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
  /** a (tapered) round tube between two points */
  const tube = (p0: V3, p1: V3, r0: number, r1: number, color: V3, seg = 10) => {
    const dir = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])
    const len = dir.length()
    const g = new THREE.CylinderGeometry(r1, r0, len, seg)
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()))
    g.translate((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2)
    solid.addGeometry(g, color)
  }
  const HOUSING: V3 = [0.055, 0.056, 0.062]
  const sectionShape = (() => {
    const w = 0.44, h = 0.47, r = 0.1
    const sh = new THREE.Shape()
    sh.moveTo(-w / 2 + r, -h / 2); sh.lineTo(w / 2 - r, -h / 2); sh.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r)
    sh.lineTo(w / 2, h / 2 - r); sh.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); sh.lineTo(-w / 2 + r, h / 2)
    sh.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); sh.lineTo(-w / 2, -h / 2 + r); sh.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2)
    return sh
  })()
  /**
   * A three-section traffic signal head facing (ox, oz): rounded black housing, a retroreflective-edged backplate and a
   * tunnel visor over every lens. Returns the three lens positions (top, middle, bottom).
   */
  const signalHead = (hx: number, hz: number, yc: number, ox: number, oz: number) => {
    const yaw = Math.atan2(ox, oz)
    const rxv = oz, rzv = -ox
    const place = (g: THREE.BufferGeometry, color: V3) => {
      g.rotateY(yaw)
      g.translate(hx, yc, hz)
      solid.addGeometry(g, color)
    }
    // three separate housing sections with a hairline gap between them, like a real modular head
    for (let l = 0; l < 3; l++) {
      const sec = new THREE.ExtrudeGeometry(sectionShape, { depth: 0.27, bevelEnabled: true, bevelSize: 0.014, bevelThickness: 0.016, bevelSegments: 3, curveSegments: 8 })
      sec.translate(0, 0.5 - l * 0.5, -0.135)
      place(sec, HOUSING)
      // the ring (bezel) around each lens and a small hinge on the side of the section
      const bez = new THREE.TorusGeometry(0.178, 0.016, 8, 28)
      bez.translate(0, 0.5 - l * 0.5, 0.158)
      place(bez, [0.1, 0.1, 0.11])
      solid.box(hx + rxv * 0.235, yc + 0.5 - l * 0.5, hz + rzv * 0.235, 0.025, 0.1, 0.05, yaw, [0.12, 0.12, 0.13])
    }
    // slim brackets joining the sections, top and bottom caps
    for (const yy of [0.75, -0.75]) solid.box(hx - ox * 0.0, yc + yy, hz - oz * 0.0, 0.34, 0.05, 0.3, yaw, HOUSING)
    // backplate with a yellow reflective border
    solid.box(hx - ox * 0.14, yc, hz - oz * 0.14, 0.88, 1.95, 0.035, yaw, HOUSING)
    for (const [dx, dy, w, hh] of [[0, 0.96, 0.88, 0.05], [0, -0.96, 0.88, 0.05], [-0.415, 0, 0.05, 1.95], [0.415, 0, 0.05, 1.95]]) {
      solid.box(hx - ox * 0.117 + rxv * dx, yc + dy, hz - oz * 0.117 + rzv * dx, w, hh, 0.012, yaw, YELLOW)
    }
    // long tunnel visors over every lens (open at the bottom), a touch lighter than the housing so they read
    for (let l = 0; l < 3; l++) {
      const v = new THREE.CylinderGeometry(0.215, 0.215, 0.42, 20, 1, true, Math.PI / 2 - 0.62, Math.PI + 1.24)
      v.rotateX(Math.PI / 2)
      v.translate(0, 0.5 - l * 0.5, 0.36)
      place(v, [0.075, 0.078, 0.085])
      // inside of the visor is matte black
      const inner = new THREE.CylinderGeometry(0.205, 0.205, 0.4, 20, 1, true, Math.PI / 2 - 0.58, Math.PI + 1.16)
      inner.rotateX(Math.PI / 2)
      inner.translate(0, 0.5 - l * 0.5, 0.36)
      place(inner, [0.012, 0.012, 0.014])
    }
  }
  const post = (x: number, z: number, h: number, t = 0.09, color = POLE) => {
    DEBUG_POSTS.push([x, z, h])
    solid.box(x, 0, z, t, h, t, 0, color)
  }

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
      const rs = rbSpec(i, j)!
      const ring = new THREE.RingGeometry(rs.island - 1, rs.outer, 72, 1)
      ring.rotateX(-Math.PI / 2)
      ring.translate(cx, 0.001, cz)
      asphalt.addGeometry(ring, [1, 1, 1], 4)
    }
    for (const d of [0, 3]) {
      const [dx, dz] = dirv(d)
      const kA = nodeKind(i, j), kB = nodeKind(i + dx, j + dz)
      const cA = clearance(i, j), cB = clearance(i + dx, j + dz)
      const fA = flareOf(i, j), fB = flareOf(i + dx, j + dz)
      const sgA = (u: number) => segHalves(kA, kB, cA, cB, u, fA, fB)
      const u0 = kA === 'round' ? cA - 3 : cA
      const u1 = kB === 'round' ? B - cB + 3 : B - cB
      for (let u = u0; u < u1 - 0.01; u += 4) {
        const ue = Math.min(u + 4, u1)
        const h0 = sgA(u), h1 = sgA(ue)
        asphalt.upQuad([at(cx, cz, d, u, h0.right + 0.5), at(cx, cz, d, ue, h1.right + 0.5), at(cx, cz, d, ue, -(h1.left + 0.5)), at(cx, cz, d, u, -(h0.left + 0.5))], 0, [1, 1, 1])
      }
    }
  }

  // ---------------- markings, kerbs, per-edge props ----------------
  const mk = (ax: number, az: number, d: number, u0: number, u1: number, v0: number, v1: number, color: V3, y = 0.02) =>
    marks.upQuad([at(ax, az, d, u0, v0), at(ax, az, d, u1, v0), at(ax, az, d, u1, v1), at(ax, az, d, u0, v1)], y, color)

  /** painted arrow on a lane: tail at road coordinate u0, pointing along `ds` (+1/-1), lane centre at v0 */
  const arrow = (ax: number, az: number, d: number, u0: number, ds: 1 | -1, v0: number, kind: 'L' | 'S' | 'R' | 'SR' | 'SL') => {
    for (const poly of ARROW_SHAPES[kind]) {
      const pts = poly.map(([a, b]) => at(ax, az, d, u0 + ds * a, v0 + ds * b))
      if (pts.length === 3) marks.upQuad([pts[0], pts[1], pts[2], pts[2]], 0.02, WHITE)
      else marks.upQuad([pts[0], pts[1], pts[2], pts[3]], 0.02, WHITE)
    }
  }
  /** flat text on the road: the quad's "up" points the way the lane travels, its "right" is the driver's right */
  const roadText = (ax: number, az: number, d: number, uTail: number, ds: 1 | -1, vCentre: number, width: number, length: number, r: Rect) => {
    const vR = vCentre + ds * (width / 2), vL = vCentre - ds * (width / 2)
    const uv = rectUV(r)
    const p = (u: number, v: number): V3 => { const [x, z] = at(ax, az, d, u, v); return [x, 0.026, z] }
    signs.quad(p(uTail, vL), p(uTail, vR), p(uTail + ds * length, vR), p(uTail + ds * length, vL), uv[0], uv[1], uv[2], uv[3], [1, 1, 1])
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
      const fA = flareOf(i, j), fB = flareOf(i + dx, j + dz) // lanes flare beside a splitter island at these ends
      const sgh = (u: number) => segHalves(kA, kB, S0, B - S1, u, fA, fB)
      mk(ax, az, d, S0, S1, -0.27, -0.13, YELLOW)
      mk(ax, az, d, S0, S1, 0.13, 0.27, YELLOW)
      // dashed divider between the two ordinary lanes, both directions
      const shiftAt = (u: number) => Math.max(fA ? rbShift(u - S0) : 0, fB ? rbShift(S1 - u) : 0)
      for (const sg of [-1, 1]) {
        for (let u = S0 + 4; u + 3 < S1 - 12; u += 12) {
          const v0 = sg * (LANE_W + shiftAt(u)), v1 = sg * (LANE_W + shiftAt(u + 3))
          marks.upQuad([at(ax, az, d, u, v0 - 0.075), at(ax, az, d, u + 3, v1 - 0.075), at(ax, az, d, u + 3, v1 + 0.075), at(ax, az, d, u, v0 + 0.075)], 0.02, WHITE)
        }
      }
      // the added right-turn lane: its own dashed divider, only where that lane exists
      if (kB === 'signal') for (let u = S1 - FLARE + 2; u + 3 < S1 - 12; u += 12) mk(ax, az, d, u, u + 3, 2 * LANE_W - 0.075, 2 * LANE_W + 0.075, WHITE)
      if (kA === 'signal') for (let u = S0 + 12; u + 3 < S0 + FLARE - 2; u += 12) mk(ax, az, d, u, u + 3, -2 * LANE_W - 0.075, -2 * LANE_W + 0.075, WHITE)
      // edge lines follow the widening road
      for (let u = S0; u < S1 - 0.01; u += 3) {
        const ue = Math.min(u + 3, S1)
        const h0 = sgh(u), h1 = sgh(ue)
        marks.upQuad([at(ax, az, d, u, h0.right - 0.35), at(ax, az, d, ue, h1.right - 0.35), at(ax, az, d, ue, h1.right - 0.15), at(ax, az, d, u, h0.right - 0.15)], 0.02, WHITE)
        marks.upQuad([at(ax, az, d, u, -(h0.left - 0.15)), at(ax, az, d, ue, -(h1.left - 0.15)), at(ax, az, d, ue, -(h1.left - 0.35)), at(ax, az, d, u, -(h0.left - 0.35))], 0.02, WHITE)
      }
      // stop lines + zebra crossings at both ends
      const roundEnd1 = nodeKind(i + dx, j + dz) === 'round'
      const roundEnd0 = nodeKind(i, j) === 'round'
      if (!roundEnd1) mk(ax, az, d, S1 - 2.3, S1 - 1.7, 0.4, HALF_ROAD - 0.1, WHITE)
      if (!roundEnd0) mk(ax, az, d, S0 + 1.7, S0 + 2.3, -HALF_ROAD + 0.1, -0.4, WHITE)
      const rbA = rbSpec(i, j), rbB = rbSpec(i + dx, j + dz)
      // a signalised roundabout has a stop bar before the crosswalk
      if (rbB?.signals) mk(ax, az, d, S1 - 18.4, S1 - 17.8, rbShift(18) + 0.2, HALF_MID + rbShift(18) - 0.1, WHITE)
      if (rbA?.signals) mk(ax, az, d, S0 + 17.8, S0 + 18.4, -(HALF_MID + rbShift(18) - 0.1), -(rbShift(18) + 0.2), WHITE)
      // roundabout entries: a yield line of white triangles ("shark teeth") pointing at approaching drivers,
      // and a raised splitter island that separates entering from leaving traffic
      const teeth = (uEnd: number, ds: 1 | -1, vSign: 1 | -1, flareEnd: boolean) => {
        const sh = flareEnd ? rbShift(2.5) : 0
        for (let v = sh + 0.3; v < HALF_MID + sh - 0.3; v += 0.9) {
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
        // "keep right" sign on the island, facing the approaching traffic
        const sgn = at(ax, az, d, uEnd - ds * 27.6, 0)
        const fd = dirv(d)
        post(sgn[0], sgn[1], 1.35, 0.07)
        signQuad(sgn[0] + fd[0] * -ds * 0.06, 1.25, sgn[1] + fd[1] * -ds * 0.06, 0.62, 0.78, ds === 1 ? [-fd[0], -fd[1]] : [fd[0], fd[1]], SIGN.keepRight)
      }
      // a painted splitter (no raised island) at mini roundabouts
      const paintedIsland = (uEnd: number, ds: 1 | -1) => {
        const pts: Pt2[] = [[0.6, -1.4], [0.6, 1.4], [6, 1.0], [11, 0.1], [6, -1.0]]
        const shape = new THREE.Shape()
        pts.forEach(([a, b], k) => {
          const [wx, wz] = at(ax, az, d, uEnd - ds * a, b)
          if (k) shape.lineTo(wx, -wz)
          else shape.moveTo(wx, -wz)
        })
        shape.closePath()
        const g = new THREE.ShapeGeometry(shape)
        g.rotateX(-Math.PI / 2)
        g.translate(0, 0.027, 0)
        marks.addGeometry(g, [0.82, 0.82, 0.78], 3)
      }
      if (roundEnd1) { teeth(S1, 1, 1, fB); if (fB) island(S1, 1); else paintedIsland(S1, 1) }
      if (roundEnd0) { teeth(S0, -1, -1, fA); if (fA) island(S0, -1); else paintedIsland(S0, -1) }
      // painted lane arrows: signal approach = left / straight / right-only; roundabout approach (2 lanes) = left lane straight + left, right lane straight + right.
      const endKinds = (round: boolean, twoLane: boolean): Array<'L' | 'S' | 'R' | 'SL' | 'SR'> => (round ? (twoLane ? ['SL', 'SR'] : ['S', 'SR']) : ['L', 'S', 'R'])
      for (const [uEnd, ds, round, v0sign] of [[S1, 1, nodeKind(i + dx, j + dz) === 'round', 1], [S0, -1, nodeKind(i, j) === 'round', -1]] as Array<[number, 1 | -1, boolean, 1 | -1]>) {
        const rbE = uEnd === S1 ? rbB : rbA
        const flE = uEnd === S1 ? fB : fA
        endKinds(round, (rbE?.laneR.length ?? 2) === 2).forEach((kind, k) => {
          for (const back of [20, 58]) arrow(ax, az, d, uEnd - ds * back, ds, v0sign * (laneOff(k) + (round && flE ? rbShift(back) : 0)), kind)
        })
      }
      // "ONLY" on the turn-only lanes (left lane and the added right lane) of a signalised approach
      for (const [uEnd, ds, sig, v0sign] of [[S1, 1, kB === 'signal', 1], [S0, -1, kA === 'signal', -1]] as Array<[number, 1 | -1, boolean, 1 | -1]>) {
        if (!sig) continue
        for (const k of [0, 2]) roadText(ax, az, d, uEnd - ds * 38, ds, v0sign * laneOff(k), 2.2, 4.6, SIGN.only)
      }
      // crosswalks: across the full road width at that end (3 lanes on the approach to a signal, 2 elsewhere)
      const cwB = fB ? rbShift(13.5) : 0 // where a roundabout crosswalk sits
      const cwA = fA ? rbShift(13.5) : 0
      const ext1 = kB === 'signal' ? HALF_ROAD - 0.3 : HALF_MID - 0.2 + cwB
      const ext0 = kA === 'signal' ? HALF_ROAD - 0.3 : HALF_MID - 0.2 + cwA
      const back1 = HALF_MID - 0.2 + cwB // the other (leaving) side of the road
      const back0 = HALF_MID - 0.2 + cwA
      for (let v = -back1; v <= ext1; v += 1.2) {
        const o1 = roundEnd1 ? 7.4 : 0 // one car length back from a roundabout's yield line
        mk(ax, az, d, S1 - 7.6 - o1, S1 - 4.6 - o1, v - 0.3, v + 0.3, WHITE)
      }
      for (let v = -ext0; v <= back0; v += 1.2) {
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
            const h = sgh((u + um) / 2)
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
      // speed-limit signs on the right-hand verge in both directions, mid-block. Each one stands where ITS side of the
      // road is still 2 lanes wide (not inside the widened approach to a signalised junction or a roundabout flare).
      {
        const fdv = dirv(d)
        const mid = (S0 + S1) / 2
        const uPlus = Math.max(S0 + 36, kB === 'signal' ? S1 - FLARE - TAPER - 8 : mid) // right side: widens before node B
        const uMinus = Math.min(S1 - 36, kA === 'signal' ? S0 + FLARE + TAPER + 8 : mid) // left side: widens after node A
        for (const sgv of [1, -1] as const) {
          const uSign = sgv === 1 ? uPlus : uMinus
          const [sx, sz] = at(ax, az, d, uSign, sgv * ((sgv === 1 ? sgh(uSign).right : sgh(uSign).left) + 1.7)) // beside the road as wide as it is right there
          post(sx, sz, 2.4)
          signQuad(sx - fdv[0] * sgv * 0.08, 2.15, sz - fdv[1] * sgv * 0.08, 0.85, 1.05, [-fdv[0] * sgv, -fdv[1] * sgv], SIGN.speed)
        }
      }
      // street trees
      for (let u = S0 + 14; u < S1 - 10; u += 26) {
        treeAlong(ax, az, d, u, HALF_ROAD + 5, 0.9 + hashN(ax + u, az, 5) * 0.4)
        treeAlong(ax, az, d, u + 13, -(HALF_ROAD + 5), 0.9 + hashN(ax + u, az, 6) * 0.4)
      }
      // ---- realistic road surface: worn tyre tracks in every lane, repair patches, tar-filled cracks ----
      {
        const LIGHT: V3 = [0.5, 0.5, 0.52]
        const track = (v: number, w: number, a: number) => {
          for (let u = S0 + 6; u < S1 - 6; u += 5) {
            const ue = Math.min(u + 5, S1 - 6)
            wear.quad(at(ax, az, d, u, v - w / 2), at(ax, az, d, ue, v - w / 2), at(ax, az, d, ue, v + w / 2), at(ax, az, d, u, v + w / 2), 0.012, a)
          }
        }
        for (const sg of [-1, 1] as const) {
          for (let k = 0; k < 2; k++) {
            const c = sg * laneOff(k)
            track(c - 0.85, 0.72, 0.17) // left wheel track
            track(c + 0.85, 0.72, 0.17) // right wheel track
            track(c, 0.5, 0.06) // oil drip down the middle of the lane
          }
        }
        // patches (a different, slightly darker or lighter square of asphalt) and cracks
        for (let u = S0 + 12; u < S1 - 12; u += 17 + hashN(ax + u, az, 9) * 20) {
          const r1 = hashN(ax + u, az + 3, 10), r2 = hashN(ax + u, az + 5, 11), r3 = hashN(ax + u, az + 7, 12)
          const lane = (r1 < 0.5 ? -1 : 1) * (laneOff(r2 < 0.5 ? 0 : 1) + (r3 - 0.5) * 1.4)
          const L = 1.6 + r2 * 3.4, W = 1.2 + r3 * 1.8
          wear.quad(at(ax, az, d, u, lane - W / 2), at(ax, az, d, u + L, lane - W / 2), at(ax, az, d, u + L, lane + W / 2), at(ax, az, d, u, lane + W / 2), 0.013, 0.28 + r1 * 0.2, r2 < 0.35 ? 0.25 : 0)
          // a hairline crack running across the patch
          wear.quad(at(ax, az, d, u - 1, lane + W / 2 + 0.1), at(ax, az, d, u + L + 2, lane + W / 2 + 0.16), at(ax, az, d, u + L + 2, lane + W / 2 + 0.22), at(ax, az, d, u - 1, lane + W / 2 + 0.16), 0.014, 0.5)
        }
        // transverse tar seams every ~12 m across both directions
        for (let u = S0 + 9; u < S1 - 8; u += 11.7) {
          wear.quad(at(ax, az, d, u, -HALF_MID), at(ax, az, d, u + 0.09, -HALF_MID), at(ax, az, d, u + 0.09, HALF_MID), at(ax, az, d, u, HALF_MID), 0.014, 0.35)
        }
        void LIGHT
        // concrete gutter along both kerbs (the strip of water channel between the asphalt and the kerb)
        for (const sg of [-1, 1] as const) {
          const e0 = (u: number) => (sg === 1 ? sgh(u).right : sgh(u).left)
          for (let u = S0; u < S1 - 0.01; u += 4) {
            const ue = Math.min(u + 4, S1)
            const a0 = sg * (e0(u) + 0.02), a1 = sg * (e0(u) + 0.55), b0 = sg * (e0(ue) + 0.02), b1 = sg * (e0(ue) + 0.55)
            marks.upQuad([at(ax, az, d, u, a0), at(ax, az, d, ue, b0), at(ax, az, d, ue, b1), at(ax, az, d, u, a1)], 0.016, [0.58, 0.58, 0.6])
          }
        }
      }
      // ---- street lamps (cobra-head on a curved arm), alternating sides every ~46 m ----
      for (let u = S0 + 26; u < S1 - 26; u += 46) {
        const sg: 1 | -1 = Math.floor((u - S0) / 46) % 2 ? 1 : -1
        const off = (sg === 1 ? sgh(u).right : sgh(u).left) + 2.4
        const [lx, lz] = at(ax, az, d, u, sg * off)
        const horizontal = dz === 0
        DEBUG_POSTS.push([lx, lz, 8.5])
        solid.box(lx, 0, lz, 0.26, 0.5, 0.26, 0, [0.35, 0.36, 0.38]) // base
        solid.box(lx, 0.5, lz, 0.18, 8.1, 0.18, 0, [0.5, 0.52, 0.55]) // pole
        const [ax2, az2] = at(ax, az, d, u, sg * (off - 1.5))
        solid.box(ax2, 8.5, az2, horizontal ? 0.12 : 3.0, 0.12, horizontal ? 3.0 : 0.12, 0, [0.5, 0.52, 0.55]) // mast arm over the road
        const [hx2, hz2] = at(ax, az, d, u, sg * (off - 2.9))
        solid.box(hx2, 8.38, hz2, horizontal ? 0.5 : 1.0, 0.18, horizontal ? 1.0 : 0.5, 0, [0.62, 0.64, 0.66]) // luminaire housing
        solid.box(hx2, 8.3, hz2, horizontal ? 0.42 : 0.86, 0.04, horizontal ? 0.86 : 0.42, 0, [0.95, 0.9, 0.7]) // lens
      }
      // ---- fire hydrants and kerbside furniture, one every ~90 m ----
      for (let u = S0 + 40; u < S1 - 30; u += 90) {
        const sg: 1 | -1 = hashN(ax + u, az, 20) < 0.5 ? 1 : -1
        const [hx3, hz3] = at(ax, az, d, u, sg * ((sg === 1 ? sgh(u).right : sgh(u).left) + 1.0))
        DEBUG_POSTS.push([hx3, hz3, 0.7])
        solid.box(hx3, 0, hz3, 0.28, 0.7, 0.28, 0, [0.75, 0.12, 0.1]) // hydrant body
        solid.box(hx3, 0.7, hz3, 0.34, 0.12, 0.34, 0, [0.8, 0.14, 0.12]) // cap
        solid.box(hx3, 0.35, hz3, 0.55, 0.14, 0.14, 0, [0.7, 0.1, 0.09]) // side nozzles
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
      // dashed turn-guide lines through the junction box: they show the path of a left turn (left lane) and a right turn
      const guide = (S: V2, E: V2, ctrl: V2, X: V2) => {
        const pts: V2[] = [S, E]
        for (let t = 1 / 26; t <= 1.0001; t += 1 / 26) {
          const u = 1 - t
          pts.push([u * u * E[0] + 2 * u * t * ctrl[0] + t * t * X[0], u * u * E[1] + 2 * u * t * ctrl[1] + t * t * X[1]])
        }
        let acc = 0
        for (let q = 1; q < pts.length; q++) {
          const [x0, z0] = pts[q - 1], [x1, z1] = pts[q]
          const sl = Math.hypot(x1 - x0, z1 - z0)
          if (sl > 1e-6 && acc % 3.2 < 1.6) {
            const nx = (-(z1 - z0) / sl) * 0.075, nz = ((x1 - x0) / sl) * 0.075
            marks.upQuad([[x0 - nx, z0 - nz], [x1 - nx, z1 - nz], [x1 + nx, z1 + nz], [x0 + nx, z0 + nz]], 0.02, WHITE)
          }
          acc += sl
        }
      }
      for (let ar = 0; ar < 4; ar++) {
        const tt = (ar + 2) % 4
        const [aox, aoz] = dirv(ar), [alx, alz] = dirv(ar + 1)
        const stz = dirv(tt)[1]
        for (const [k, e, exitLane] of [[0, (tt + 1) % 4, 0], [2, (tt + 3) % 4, 1]] as Array<[number, number, number]>) {
          const o = laneOff(k)
          const E: V2 = [cx + aox * BOX + alx * o, cz + aoz * BOX + alz * o]
          const [eox, eoz] = dirv(e), [erx, erz] = dirv(e - 1)
          const X: V2 = [cx + eox * BOX + erx * laneOff(exitLane), cz + eoz * BOX + erz * laneOff(exitLane)]
          // start at the stop line (where the lane ends), run straight to the box edge, then curve into the exit lane
          const S: V2 = [E[0] + aox * 1.6, E[1] + aoz * 1.6]
          guide(S, E, stz === 0 ? [X[0], E[1]] : [E[0], X[1]], X)
        }
      }
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) solid.box(cx + sx * (BOX + 7.2), 0, cz + sz * (BOX + 7.2), 14, 0.15, 14, 0, CONC)
    } else {
      const spec = rbSpec(i, j)!
      const L = spec.laneR.length
      const rMid = spec.laneR.reduce((p, q) => p + q, 0) / L
      // central island
      if (spec.domed) {
        // mini roundabout: a small mountable dome ringed with white paint
        const dome = new THREE.SphereGeometry(spec.island, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2)
        dome.scale(1, 0.05, 1)
        dome.translate(cx, 0.03, cz)
        solid.addGeometry(dome, [0.62, 0.62, 0.64])
        const paint = new THREE.RingGeometry(spec.island, spec.apron, 40, 1)
        paint.rotateX(-Math.PI / 2)
        paint.translate(cx, 0.028, cz)
        marks.addGeometry(paint, [0.82, 0.82, 0.78], 3)
        const ringLine = new THREE.RingGeometry(spec.apron - 0.2, spec.apron, 40, 1)
        ringLine.rotateX(-Math.PI / 2)
        ringLine.translate(cx, 0.03, cz)
        marks.addGeometry(ringLine, [0.95, 0.95, 0.92], 3)
      } else {
        const kerb = new THREE.CylinderGeometry(spec.island, spec.island, 0.22, 56)
        kerb.translate(cx, 0.11, cz)
        solid.addGeometry(kerb, [0.6, 0.6, 0.62])
        const grass = new THREE.CylinderGeometry(spec.island - 0.7, spec.island - 0.7, 0.05, 56)
        grass.translate(cx, 0.245, cz)
        solid.addGeometry(grass, [0.2, 0.42, 0.16])
        const nTrees = Math.max(1, Math.round(spec.island / 4))
        for (let k = 0; k < Math.min(6, nTrees); k++) trees.push({ x: cx + Math.cos(k * 2.1 + 0.7) * spec.island * 0.45, z: cz + Math.sin(k * 2.1 + 0.7) * spec.island * 0.45, s: 1.1 + (k % 2) * 0.3 })
        trees.push({ x: cx, z: cz, s: 1.5 })
        // truck apron: the mountable ring around the central island
        const apron = new THREE.RingGeometry(spec.island - 0.1, spec.apron, 72, 1)
        apron.rotateX(-Math.PI / 2)
        apron.translate(cx, 0.028, cz)
        marks.addGeometry(apron, [0.4, 0.36, 0.33], 3)
        const apronEdge = new THREE.RingGeometry(spec.apron - 0.3, spec.apron, 72, 1)
        apronEdge.rotateX(-Math.PI / 2)
        apronEdge.translate(cx, 0.03, cz)
        marks.addGeometry(apronEdge, [0.9, 0.9, 0.87], 3)
      }
      const armHalf = Math.asin(Math.min(0.95, (HALF_MID + (spec.splitter ? RB_SHIFT : 0) + 1.0) / spec.outer)) + 0.06 // angular half-width of an arm mouth
      // dashed line between two circulating lanes (not drawn across the arm mouths)
      const armDist = (th: number) => {
        const m = ((th % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2)
        return Math.min(m, Math.PI / 2 - m)
      }
      if (L === 2) {
        for (let th = 0; th < Math.PI * 2; th += 6 / rMid) {
          const t1 = th + 3 / rMid
          if (armDist(th) < armHalf + 0.1 || armDist(t1) < armHalf + 0.1) continue
          const P = (r: number, t: number): V2 => [cx + r * Math.cos(t), cz - r * Math.sin(t)]
          marks.upQuad([P(rMid - 0.075, th), P(rMid - 0.075, t1), P(rMid + 0.075, t1), P(rMid + 0.075, th)], 0.02, WHITE)
        }
      }
      // curved counter-clockwise arrows in each lane, between the arms (they follow the curve of the ring)
      if (!spec.domed) {
        for (let q = 0; q < 4; q++) {
          for (const lr of spec.laneR) {
            const thc = (q * Math.PI) / 2 + Math.PI / 4
            const sc = Math.min(1, (lr * (Math.PI / 2 - 2 * (armHalf + 0.15))) / 9) // shorter arrows on small rings
            const P = (sArc: number, dr: number): V2 => {
              const t = thc + (sArc * sc) / lr
              return [cx + (lr + dr) * Math.cos(t), cz - (lr + dr) * Math.sin(t)]
            }
            for (let sArc = -3.4; sArc < 1.6 - 0.01; sArc += 0.8) {
              const e = Math.min(sArc + 0.8, 1.6)
              marks.upQuad([P(sArc, -0.14), P(e, -0.14), P(e, 0.14), P(sArc, 0.14)], 0.03, WHITE)
            }
            marks.upQuad([P(1.5, -0.66), P(1.5, 0.66), P(3.6, 0), P(3.6, 0)], 0.03, WHITE) // arrowhead
          }
        }
      }
      // kerbed pavement around the outside, between the arms
      for (let q = 0; q < 4; q++) {
        const a0 = (q * Math.PI) / 2 + armHalf, a1 = ((q + 1) * Math.PI) / 2 - armHalf
        const sh = new THREE.Shape()
        sh.absarc(cx, -cz, spec.outer + 4, a0, a1, false)
        sh.absarc(cx, -cz, spec.outer + 0.1, a1, a0, true)
        const g = new THREE.ExtrudeGeometry(sh, { depth: 0.15, bevelEnabled: false, curveSegments: 14 })
        g.rotateX(-Math.PI / 2)
        solid.addGeometry(g, CONC)
        // outer edge line along the kerb
        const m = 10
        for (let w = 0; w < m; w++) {
          const e0 = a0 + ((a1 - a0) * w) / m, e1 = a0 + ((a1 - a0) * (w + 1)) / m
          const p = (r: number, a: number): V2 => [cx + r * Math.cos(a), cz - r * Math.sin(a)]
          marks.upQuad([p(spec.outer - 0.5, e0), p(spec.outer - 0.5, e1), p(spec.outer - 0.3, e1), p(spec.outer - 0.3, e0)], 0.02, WHITE)
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

      // roadside signs on the right-hand verge
      const side = (u: number, h: number, w: number, hh: number, r: Rect) => {
        // beside the road: the verge starts further out where the roundabout entrance flares
        const [x, z] = P(u, HW + 1.7 + (flareOf(i, j) ? rbShift(u - clr) : 0))
        post(x, z, h)
        signQuad(x + ox * 0.08, h + hh / 2 - 0.1, z + oz * 0.08, w, hh, face, r)
      }
      // advance street-name sign, well before the junction: the name of the road you are about to meet
      {
        const [ax2, az2] = P(clr + 78, HW + 1.9 + (flareOf(i, j) ? rbShift(78) : 0))
        post(ax2, az2, 3.0, 0.11)
        signQuad(ax2 + ox * 0.09, 2.45, az2 + oz * 0.09, 1.9, 0.95, face, PLATE(crossIdx))
      }
      side(clr + 62, 2.6, 1.1, 1.1, kind === 'signal' ? SIGN.sigWarn : SIGN.rbWarn)
      side(clr + 30, 2.4, 0.85, 1.05, SIGN.speed)
      side(clr + 11, 2.3, 0.95, 0.95, SIGN.ped)
      if (kind === 'signal') side(clr + 19, 2.1, 0.6, 0.75, SIGN.stopHere)
      if (kind === 'signal') {
        side(clr + 46, 2.5, 1.3, 1.3, SIGN.lanes) // lane-use sign (matches the painted arrows)
        // "right lane must turn right", where the added lane begins
        const [rx2, rz2] = P(clr + FLARE + TAPER + 5, HALF_MID + 2.1)
        post(rx2, rz2, 2.5)
        signQuad(rx2 + ox * 0.08, 2.15, rz2 + oz * 0.08, 0.8, 0.98, face, SIGN.rightOnly)
      } else if (rbSpec(i, j)!.laneR.length === 2) side(clr + 50, 2.5, 1.3, 1.3, SIGN.rbLanes) // roundabout lane-use sign (matches the painted arrows)

      if (kind === 'signal') {
        // Signals hang ACROSS the road on the FAR side of the junction, facing the waiting traffic: a tapered pole on the far
        // verge with a mast arm over the lanes and one three-section head per lane, plus a pole head at the far-left corner.
        const uf = -(clr + 1.5)
        const qEdge = HALF_ROAD + 1.7
        const axis = a % 2 === 0 ? 0 : 1
        const lensY = [0.5, 0, -0.5]
        const [px, pz] = P(uf, qEdge)
        const top = 5.45
        tube([px, 0.35, pz], [px, top, pz], 0.25, 0.14, POLE, 14)
        // base plate with bolts, a hand-hole cover and a pedestrian push-button
        tube([px, 0, pz], [px, 0.4, pz], 0.4, 0.3, [0.4, 0.41, 0.44], 14)
        for (const [bx, bz] of [[0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]]) solid.box(px + bx, 0.4, pz + bz, 0.06, 0.07, 0.06, 0, [0.7, 0.72, 0.75])
        solid.box(px - rx * 0.21, 1.15, pz - rz * 0.21, 0.1, 0.16, 0.1, yaw, [0.95, 0.78, 0.1])
        solid.box(px - rx * 0.26, 1.15, pz - rz * 0.26, 0.05, 0.1, 0.1, yaw, [0.1, 0.1, 0.1])
        const midQ = qEdge * 0.5, endQ = 0.4
        const [m1x, m1z] = P(uf, midQ), [m2x, m2z] = P(uf, endQ)
        tube([px, top - 0.05, pz], [m1x, top - 0.3, m1z], 0.17, 0.12, POLE, 12)
        tube([m1x, top - 0.3, m1z], [m2x, top - 0.14, m2z], 0.12, 0.085, POLE, 12)
        // gusset where the arm meets the pole
        tube([px, top - 1.0, pz], [m1x * 0.15 + px * 0.85, top - 0.45, m1z * 0.15 + pz * 0.85], 0.05, 0.05, POLE, 6)
        ;[laneOff(0), laneOff(1), laneOff(2)].forEach((q, lane) => {
          const [hx, hz] = P(uf, q)
          const yc = 3.9
          // hanger from the arm to the head
          const armY = top - 0.28 + ((midQ - q) / (midQ - endQ)) * 0.16
          tube([hx, armY, hz], [hx, yc + 0.78, hz], 0.04, 0.04, POLE, 6)
          signalHead(hx, hz, yc, ox, oz)
          // the left lane has its own left-turn ARROW signal; the other lanes show the through signal
          for (let l = 0; l < 3; l++) lamps.push({ x: hx + ox * 0.165, y: yc + lensY[l], z: hz + oz * 0.165, yaw, node: n, axis, l, arrow: lane === 0 && hasLeftArrow(n) })
        })
        // far-left corner pole: a second head, seen from the right-hand lanes too
        const [lx, lz] = P(uf, -qEdge)
        tube([lx, 0.3, lz], [lx, 4.4, lz], 0.2, 0.12, POLE, 12)
        tube([lx, 0, lz], [lx, 0.35, lz], 0.34, 0.26, [0.4, 0.41, 0.44], 12)
        signalHead(lx, lz, 3.1, ox, oz)
        for (let l = 0; l < 3; l++) lamps.push({ x: lx + ox * 0.165, y: 3.1 + lensY[l], z: lz + oz * 0.165, yaw, node: n, axis, l, arrow: false })
        // junctions without a left arrow: "LEFT TURN YIELD ON GREEN" on the mast arm over the left lane
        if (!hasLeftArrow(n)) {
          const [ysx, ysz] = P(uf, laneOff(0))
          signQuad(ysx + ox * 0.16, 6.15, ysz + oz * 0.16, 0.8, 0.98, face, SIGN.leftYield)
        }
        // street-name blade on the mast arm
        const [nx, nz] = P(uf, qEdge * 0.62)
        signQuad(nx + ox * 0.15, 5.85, nz + oz * 0.15, 2.2, 1.1, face, PLATE(crossIdx))
      } else {
        // give way + roundabout signs at the entry, chevrons on the island
        const rsp = rbSpec(i, j)!
        const [yx, yz] = P(clr + 2.5, HW + 1.7 + (rsp.splitter ? rbShift(2.5) : 0))
        post(yx, yz, 3.9)
        signQuad(yx + ox * 0.08, 2.6, yz + oz * 0.08, 1.1, 1.1, face, SIGN.yield)
        signQuad(yx + ox * 0.08, 3.75, yz + oz * 0.08, 0.95, 0.95, face, SIGN.rbMust)
        if (rsp.signals) {
          const axis = a % 2 === 0 ? 0 : 1
          const lensY = [0.5, 0, -0.5]
          const uh = clr + 18.5
          const sh = rbShift(18.5)
          for (const q of [HALF_MID + sh + 1.3, 0]) {
            const [hx, hz] = P(uh, q)
            tube([hx, 0, hz], [hx, 4.3, hz], 0.2, 0.12, POLE, 10)
            signalHead(hx, hz, 3.0, ox, oz)
            for (let l = 0; l < 3; l++) lamps.push({ x: hx + ox * 0.165, y: 3.0 + lensY[l], z: hz + oz * 0.165, yaw, node: n, axis, l, arrow: false })
          }
        }
        if (!rsp.domed) {
          const [qx, qz] = [cx + ox * (rsp.island - 0.3), cz + oz * (rsp.island - 0.3)]
          post(qx, qz, 1.5, 0.08)
          signQuad(qx + ox * 0.06, 1.35, qz + oz * 0.06, 1.8, 1.35, face, SIGN.chevron)
        }
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

  // no tree may stand on the road (or touch its edge): test each against the real road surface and drop the ones that do
  for (let k = trees.length - 1; k >= 0; k--) {
    const t = trees[k]
    if ([[0, 0], [2.2, 0], [-2.2, 0], [0, 2.2], [0, -2.2]].some(([dx, dz]) => onAsphalt(t.x + dx, t.z + dz))) trees.splice(k, 1)
  }
  trees.forEach((t) => DEBUG_TREES.push({ x: t.x, z: t.z }))
  return { asphalt: asphalt.build(), marks: marks.build(), solid: solid.build(), buildings: buildings.build(), signs: signs.build(), wear: wear.build(), lamps, trees }
}
export { BOX }
