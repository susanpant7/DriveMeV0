import * as THREE from 'three'
import { SIGNAL_HEADS } from './signalHeads'
import { noTurnOnRed, leftSignal, headLayout, streetMph, bendAt, roadPoint, laneC, LAYOUT, RAMP_AT, RAMP_HALF, RAMP_I, RAMP_J, rampLine, nodeX, nodeZ, roadLen, stubZ, armCtrl, armOne, armBase, resStyle, PARKED, PARKED_KINDS, PARKED_COLORS, PARK_W, RES_LANE_W, flare, WEDGE_FULL, WEDGE_LEN, wedgeSpan, junctionOutline, medW, pocketW, jTypeOf, jHalf, jLanes, rbFillet, STUB, stubsOn, armClosed, hasLeftArrow, onAsphalt, HALF_MID, RB_ISLAND, RB_SHIFT, flareOf, rbShift, rbSpec, segHalves, B, BOX, G, HALF_ROAD, HORIZONTAL_NAMES, LANE_W, LOTS, VERTICAL_NAMES, clearance, dirv, hashN, laneOff, nodeIndex, nodeKind, CENTRE_COL } from './map'

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
export const ATLAS_H = 1536
const cell = (i: number): Rect => ({ x: i * 256, y: 0, w: 256, h: 256 })
const cell2 = (i: number): Rect => ({ x: i * 256, y: 896, w: 256, h: 256 })
const cell3 = (i: number): Rect => ({ x: i * 256, y: 1280, w: 256, h: 256 })
const cell4 = (i: number): Rect => ({ x: i * 256, y: 384, w: 256, h: 256 })
export const SIGN = { leftYield: cell2(5), stopHere: cell2(3), only: cell2(4), speed: cell(0), yield: cell(1), rbWarn: cell(2), sigWarn: cell(3), ped: cell(4), rbMust: cell(5), chevron: cell(6), lanes: cell(7), rbLanes: cell2(0), keepRight: cell2(1), rightOnly: cell2(2), laneEnds: cell2(6), laneEndsText: cell2(7), speed25: cell3(6), speed15: cell4(0), speed10: cell4(1), noRed: cell4(2), speed40: cell4(3), speed45: cell4(4), speed50: cell4(5), stop: cell3(0), allWay: cell3(1), stopAhead: cell3(2), yieldAhead: cell3(3), crossTraffic: cell3(4), stopText: cell3(5), hwEntrance: cell3(7) }
/** the speed-limit sign for a limit in mph */
const limitSign = (mph: number) => (mph <= 10 ? SIGN.speed10 : mph <= 15 ? SIGN.speed15 : mph <= 25 ? SIGN.speed25 : mph <= 30 ? SIGN.speed : mph <= 40 ? SIGN.speed40 : mph <= 45 ? SIGN.speed45 : SIGN.speed50)
export const PLATE = (i: number): Rect => ({ x: i * 256, y: 256, w: 256, h: 128 })

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
  drawLimit(g, units, SIGN.speed, 30)
  drawLimit(g, units, SIGN.speed25, 25)
  drawLimit(g, units, SIGN.speed15, 15)
  drawLimit(g, units, SIGN.speed10, 10)
  drawLimit(g, units, SIGN.speed40, 40)
  drawLimit(g, units, SIGN.speed45, 45)
  drawLimit(g, units, SIGN.speed50, 50)
}
function drawLimit(g: CanvasRenderingContext2D, units: 'kmh' | 'mph', r: Rect, mph: number) {
  const { x, y, w, h } = r
  g.clearRect(x, y, w, h)
  g.fillStyle = '#fff'; roundRect(g, x + 4, y + 4, w - 8, h - 8, 16); g.fill()
  g.strokeStyle = '#111'; g.lineWidth = 9; roundRect(g, x + 12, y + 12, w - 24, h - 24, 10); g.stroke()
  g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'
  g.font = '700 38px Arial, sans-serif'
  g.fillText('SPEED', x + 128, y + 52)
  g.fillText('LIMIT', x + 128, y + 90)
  g.font = '700 118px Arial, sans-serif'
  g.fillText(units === 'mph' ? String(mph) : String({ 10: 15, 15: 25, 25: 40, 30: 50, 40: 60, 45: 70, 50: 80 }[mph] ?? Math.round(mph * 1.609)), x + 128, y + 172)
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
  // W4-2 "lane ends": the left of two lanes merges into the right lane
  diamond(SIGN.laneEnds)
  {
    const r = SIGN.laneEnds
    g.strokeStyle = '#111'; g.fillStyle = '#111'; g.lineCap = 'butt'
    g.lineWidth = 12
    g.beginPath(); g.moveTo(r.x + 150, r.y + 205); g.lineTo(r.x + 150, r.y + 80); g.stroke() // the lane that continues
    g.lineWidth = 10
    g.beginPath(); g.moveTo(r.x + 100, r.y + 205); g.lineTo(r.x + 100, r.y + 140); g.quadraticCurveTo(r.x + 100, r.y + 115, r.x + 136, r.y + 92); g.stroke() // the lane that ends
    g.beginPath(); g.moveTo(r.x + 150, r.y + 52); g.lineTo(r.x + 124, r.y + 88); g.lineTo(r.x + 176, r.y + 88); g.closePath(); g.fill()
  }
  // plate under it: "LEFT LANE ENDS / MERGE RIGHT"
  {
    const r = SIGN.laneEndsText
    g.fillStyle = '#f7c600'; roundRect(g, r.x + 8, r.y + 60, 240, 136, 14); g.fill()
    g.strokeStyle = '#111'; g.lineWidth = 8; roundRect(g, r.x + 16, r.y + 68, 224, 120, 9); g.stroke()
    g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '800 34px Arial, sans-serif'
    g.fillText('LEFT LANE', r.x + 128, r.y + 100, 200); g.fillText('ENDS', r.x + 128, r.y + 134, 200); g.font = '800 30px Arial, sans-serif'; g.fillText('MERGE RIGHT', r.x + 128, r.y + 168, 204)
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
    lane(62, 'L'); lane(118, 'S'); lane(170, 'SR')
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
  // STOP (red octagon), its "ALL WAY" plaque, the "stop ahead" / "yield ahead" warnings and "CROSS TRAFFIC DOES NOT STOP"
  {
    const oct = (cx: number, cy: number, R: number) => { g.beginPath(); for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + (k * Math.PI) / 4; const X = cx + R * Math.cos(a), Y = cy + R * Math.sin(a); if (k) g.lineTo(X, Y); else g.moveTo(X, Y) } g.closePath() }
    let r = SIGN.stop
    g.fillStyle = '#fff'; oct(r.x + 128, r.y + 128, 126); g.fill()
    g.fillStyle = '#c8181c'; oct(r.x + 128, r.y + 128, 114); g.fill()
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '800 84px Arial, sans-serif'
    g.fillText('STOP', r.x + 128, r.y + 134, 190)
    r = SIGN.allWay
    g.fillStyle = '#c8181c'; roundRect(g, r.x + 8, r.y + 78, 240, 100, 12); g.fill()
    g.strokeStyle = '#fff'; g.lineWidth = 6; roundRect(g, r.x + 16, r.y + 86, 224, 84, 8); g.stroke()
    g.fillStyle = '#fff'; g.font = '800 58px Arial, sans-serif'; g.fillText('ALL WAY', r.x + 128, r.y + 131, 200)
    r = SIGN.stopAhead
    diamond(r)
    g.fillStyle = '#c8181c'; oct(r.x + 128, r.y + 150, 40); g.fill()
    g.strokeStyle = '#111'; g.fillStyle = '#111'; g.lineWidth = 12; g.beginPath(); g.moveTo(r.x + 128, r.y + 104); g.lineTo(r.x + 128, r.y + 74); g.stroke()
    g.beginPath(); g.moveTo(r.x + 128, r.y + 44); g.lineTo(r.x + 106, r.y + 76); g.lineTo(r.x + 150, r.y + 76); g.closePath(); g.fill()
    r = SIGN.yieldAhead
    diamond(r)
    g.fillStyle = '#c8181c'; g.beginPath(); g.moveTo(r.x + 84, r.y + 120); g.lineTo(r.x + 172, r.y + 120); g.lineTo(r.x + 128, r.y + 192); g.closePath(); g.fill()
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(r.x + 106, r.y + 133); g.lineTo(r.x + 150, r.y + 133); g.lineTo(r.x + 128, r.y + 168); g.closePath(); g.fill()
    g.strokeStyle = '#111'; g.fillStyle = '#111'; g.lineWidth = 12; g.beginPath(); g.moveTo(r.x + 128, r.y + 108); g.lineTo(r.x + 128, r.y + 76); g.stroke()
    g.beginPath(); g.moveTo(r.x + 128, r.y + 46); g.lineTo(r.x + 106, r.y + 78); g.lineTo(r.x + 150, r.y + 78); g.closePath(); g.fill()
    r = SIGN.crossTraffic
    g.fillStyle = '#f7c600'; roundRect(g, r.x + 8, r.y + 60, 240, 136, 14); g.fill()
    g.strokeStyle = '#111'; g.lineWidth = 7; roundRect(g, r.x + 16, r.y + 68, 224, 120, 9); g.stroke()
    g.fillStyle = '#111'; g.font = '800 32px Arial, sans-serif'
    ;['CROSS TRAFFIC', 'DOES NOT', 'STOP'].forEach((tx, k) => g.fillText(tx, r.x + 128, r.y + 96 + k * 34, 206))
    // "STOP" painted on the road before the line (white on transparent)
    r = SIGN.stopText
    g.fillStyle = '#fff'; g.font = '800 104px Arial, sans-serif'; g.fillText('STOP', r.x + 128, r.y + 128, 244)
  }
  // green guide sign for the highway entrance: route shield, "NORTH", "ENTRANCE" and an arrow up to the right
  {
    const r = SIGN.hwEntrance
    g.fillStyle = '#0b6b3a'; roundRect(g, r.x + 6, r.y + 24, 244, 208, 16); g.fill()
    g.strokeStyle = '#fff'; g.lineWidth = 6; roundRect(g, r.x + 14, r.y + 32, 228, 192, 11); g.stroke()
    // interstate shield
    g.fillStyle = '#fff'; g.beginPath(); g.moveTo(r.x + 46, r.y + 52); g.lineTo(r.x + 110, r.y + 52); g.quadraticCurveTo(r.x + 114, r.y + 104, r.x + 78, r.y + 124); g.quadraticCurveTo(r.x + 42, r.y + 104, r.x + 46, r.y + 52); g.fill()
    g.fillStyle = '#1a3f9c'; g.beginPath(); g.moveTo(r.x + 51, r.y + 70); g.lineTo(r.x + 105, r.y + 70); g.quadraticCurveTo(r.x + 108, r.y + 101, r.x + 78, r.y + 118); g.quadraticCurveTo(r.x + 48, r.y + 101, r.x + 51, r.y + 70); g.fill()
    g.fillStyle = '#c8181c'; g.fillRect(r.x + 49, r.y + 56, 58, 12)
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '800 30px Arial, sans-serif'; g.fillText('5', r.x + 78, r.y + 94)
    g.font = '800 30px Arial, sans-serif'; g.fillText('NORTH', r.x + 178, r.y + 88, 120)
    g.font = '800 28px Arial, sans-serif'; g.fillText('ENTRANCE', r.x + 128, r.y + 156, 210)
    g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 9
    g.beginPath(); g.moveTo(r.x + 108, r.y + 212); g.lineTo(r.x + 140, r.y + 186); g.stroke()
    g.beginPath(); g.moveTo(r.x + 154, r.y + 174); g.lineTo(r.x + 128, r.y + 178); g.lineTo(r.x + 148, r.y + 198); g.closePath(); g.fill()
  }
  // "NO TURN ON RED": black on white, a red circle and slash over a right-turn arrow
  {
    const r = SIGN.noRed
    g.fillStyle = '#fff'; roundRect(g, r.x + 28, r.y + 6, 200, 244, 12); g.fill()
    g.strokeStyle = '#111'; g.lineWidth = 6; roundRect(g, r.x + 36, r.y + 14, 184, 228, 8); g.stroke()
    g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '800 34px Arial, sans-serif'
    g.fillText('NO TURN', r.x + 128, r.y + 172, 170); g.fillText('ON RED', r.x + 128, r.y + 212, 170)
    const cx = r.x + 128, cy = r.y + 86
    g.strokeStyle = '#111'; g.fillStyle = '#111'; g.lineWidth = 11; g.lineCap = 'butt'
    g.beginPath(); g.moveTo(cx - 16, cy + 44); g.lineTo(cx - 16, cy); g.quadraticCurveTo(cx - 16, cy - 16, cx + 6, cy - 16); g.lineTo(cx + 18, cy - 16); g.stroke()
    g.beginPath(); g.moveTo(cx + 36, cy - 16); g.lineTo(cx + 14, cy - 34); g.lineTo(cx + 14, cy + 2); g.closePath(); g.fill()
    g.strokeStyle = '#d8251d'; g.lineWidth = 10
    g.beginPath(); g.arc(cx, cy, 52, 0, Math.PI * 2); g.stroke()
    g.beginPath(); g.moveTo(cx - 37, cy - 37); g.lineTo(cx + 37, cy + 37); g.stroke()
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
/** spacing between the three lenses of a signal head (metres), and how far in front of the lens plane the lamp is drawn */
/** the signal heads are drawn this much bigger than life so they read from the stop line */
const HS = 2.3 // big, clear signal heads
export const HEAD_LENSY = [0.417 * HS, 0, -0.417 * HS]
export const HEAD_LAMP = 0.04 * HS
export const HEAD_LAMP_SCALE = 0.95 * HS
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer

export interface LampDef { x: number; y: number; z: number; yaw: number; node: number; axis: 0 | 1; l: number; arrow: boolean }
export interface TreeDef { x: number; z: number; s: number }

type Pt2 = [number, number]
/** polygons (in the lane's travel frame: a = forward, b = toward the travel-right) for each arrow kind */
const ARROW_SHAPES: Record<'L' | 'S' | 'R' | 'SR' | 'SL' | 'M', Pt2[][]> = (() => {
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
  // merge arrow: a short shaft that bends towards the right (travel-right) lane, with an arrowhead
  const m: Pt2[][] = [[[0, -0.15], [1.5, -0.15], [1.5, 0.15], [0, 0.15]], [[1.3, -0.15], [1.3, 0.15], [3.2, 1.65], [3.2, 1.35]], [[2.69, 1.94], [3.55, 1.98], [3.31, 1.16]]]
  return { S: straight, L: turn(-1), R: turn(1), SR: sr, SL: sl, M: m }
})()

/** every sign / signal post placed (for checking that none stands on the road) */
export const DEBUG_POSTS: Array<[number, number, number]> = []
/** every tree placed (for the same check) */
export const DEBUG_TREES: Array<{ x: number; z: number }> = []

export function buildCity() {
  const asphalt = new MB(), marks = new MB(), solid = new MB(), buildings = new MB(), signs = new MB(), wear = new Wear()
  const lamps: LampDef[] = []
  const trees: TreeDef[] = []
  PARKED.length = 0
  const WHITE: V3 = [0.92, 0.92, 0.9], YELLOW: V3 = [0.95, 0.75, 0.1]
  const POLE: V3 = [0.45, 0.47, 0.5]
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
  // Signal heads are the Econolite models (simplified): housing, visors and, for the left-arrow head, the orange "LEFT TURN" plate.
  // The lamps themselves are drawn separately (they change colour), one lens every HEAD_LENS metres.
  const headGeos = (['through', 'left'] as const).map((k) => SIGNAL_HEADS[k].map((part) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b64(part.p)), 3))
    g.setIndex(new THREE.BufferAttribute(new Uint16Array(b64(part.i)), 1))
    g.computeVertexNormals()
    return { g, color: part.c as V3 }
  }))
  const signalHead = (hx: number, hz: number, yc: number, ox: number, oz: number, leftArrow = false) => {
    const yaw = Math.atan2(ox, oz)
    headGeos[leftArrow ? 1 : 0].forEach(({ g: base, color }, part) => {
      const g = base.clone()
      // thinner border: slimmer housing, and a smaller "LEFT TURN" plate around the lenses
      if (leftArrow && part === 1) g.scale(0.62 * HS, 0.78 * HS, HS)
      else g.scale(0.86 * HS, HS, 0.8 * HS)
      g.rotateY(yaw)
      g.translate(hx, yc, hz)
      solid.addGeometry(g, color)
    })
  }
  const post = (x: number, z: number, h: number, t = 0.09, color = POLE) => {
    DEBUG_POSTS.push([x, z, h])
    solid.box(x, 0, z, t, h, t, 0, color)
  }

  // ---- a detached house: walls, a pitched roof along the street, front door and windows facing the street, chimney, driveway to the
  // kerb, a mailbox and a tree. (hx, hz) is its centre; local x runs along the street, local +z away from it (yaw from the street's
  // direction); `drive` is how far its front is from the kerb. ----
  const WALLS: V3[] = [[0.86, 0.82, 0.72], [0.78, 0.72, 0.62], [0.9, 0.9, 0.86], [0.7, 0.76, 0.8], [0.8, 0.66, 0.56], [0.74, 0.8, 0.7], [0.92, 0.88, 0.8]]
  const ROOFS: V3[] = [[0.36, 0.2, 0.16], [0.26, 0.27, 0.3], [0.42, 0.3, 0.22], [0.2, 0.24, 0.28], [0.3, 0.32, 0.36]]
  const house = (hx: number, hz: number, yaw: number, w: number, dp: number, drive: number, rnd: (k: number) => number) => {
    const c = Math.cos(yaw), sn = Math.sin(yaw)
    const W = (lx: number, lz: number): V2 => [hx + lx * c + lz * sn, hz - lx * sn + lz * c] // local -> world
    const wallH = 3.0 + (rnd(1) < 0.35 ? 2.8 : 0) // some have two floors
    const wall = WALLS[Math.floor(rnd(2) * WALLS.length)], roof = ROOFS[Math.floor(rnd(3) * ROOFS.length)]
    solid.box(hx, 0, hz, w, wallH, dp, yaw, wall)
    // pitched roof: a triangular prism, ridge along the street, with a little overhang
    const span = dp + 1.0, len = w + 1.0, rise = 2.1 + rnd(4) * 0.8
    const rg = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-span / 2, 0), new THREE.Vector2(span / 2, 0), new THREE.Vector2(0, rise)]), { depth: len, bevelEnabled: false })
    rg.translate(0, 0, -len / 2)
    rg.rotateY(Math.PI / 2 + yaw)
    rg.translate(hx, wallH, hz)
    solid.addGeometry(rg, roof)
    // front (towards the street): door, two windows; a chimney
    const [dx, dz] = W(rnd(5) < 0.5 ? -1.6 : 1.6, -dp / 2 - 0.03)
    solid.box(dx, 0, dz, 1.1, 2.1, 0.08, yaw, [0.32, 0.2, 0.14])
    for (const ox of [-w / 2 + 2.2, w / 2 - 2.2]) { const [wx, wz] = W(ox, -dp / 2 - 0.03); solid.box(wx, 1.0, wz, 1.6, 1.2, 0.08, yaw, [0.58, 0.7, 0.82]) }
    { const [cx2, cz2] = W(w * 0.3, dp * 0.15); solid.box(cx2, wallH + 0.6, cz2, 0.7, 2.2, 0.7, yaw, [0.5, 0.32, 0.26]) }
    // driveway from the garage side down to the kerb, and a mailbox at the end of it
    const gx = rnd(6) < 0.5 ? -w / 2 + 1.8 : w / 2 - 1.8
    { const [px, pz] = W(gx, -dp / 2 - drive / 2); solid.box(px, 0, pz, 3.2, 0.05, drive, yaw, [0.55, 0.55, 0.57]) }
    { const [mx, mz] = W(gx + (gx < 0 ? 2.4 : -2.4), -dp / 2 - drive + 0.5); solid.box(mx, 0, mz, 0.09, 1.05, 0.09, yaw, [0.3, 0.3, 0.32]); solid.box(mx, 1.05, mz, 0.24, 0.24, 0.48, yaw, [0.15, 0.17, 0.2]) }
    // a tree in the front garden, another in the back
    { const [tx, tz] = W(-gx * 0.9, -dp / 2 - drive * 0.5); trees.push({ x: tx, z: tz, s: 0.65 + rnd(7) * 0.4 }) }
    if (rnd(8) < 0.7) { const [tx, tz] = W((rnd(9) - 0.5) * w, dp / 2 + 6 + rnd(10) * 6); trees.push({ x: tx, z: tz, s: 0.7 + rnd(11) * 0.5 }) }
    return gx // the side (local x) the driveway is on
  }
  // a parked car (drawn with the real car models, with the traffic): where it is, which way the street runs, which car and colour
  const parkedCar = (x: number, z: number, tx: number, tz: number, k: number) => {
    const h = hashN(x, z, k), h2 = hashN(z, x, k + 3)
    PARKED.push({ x, z, tx, tz, kind: PARKED_KINDS[Math.floor(h * PARKED_KINDS.length)], color: PARKED_COLORS[Math.floor(h2 * PARKED_COLORS.length)] })
  }
  // a point on a road (u along it from the node at ax, az; v to the right of its centre line): residential streets may bend
  const at = (ax: number, az: number, d: number, u: number, v: number): V2 => roadPoint(ax, az, d, u, v)
  // ---------------- roads ----------------
  // Ordinary roads are 2 lanes each way; on the approach to a signalised junction the road widens (outward) for a third lane.
  for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
    const cx = nodeX(i), cz = nodeZ(j)
    if (nodeKind(i, j) === 'signal') {
      // the four road mouths joined by rounded kerb returns that start exactly on each road's edge
      const { pts, corners } = junctionOutline(i, j)
      const sh = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(cx + x, -(cz + z))))
      const g = new THREE.ShapeGeometry(sh)
      g.rotateX(-Math.PI / 2)
      g.translate(0, 0.0005, 0)
      asphalt.addGeometry(g, [1, 1, 1], 4)
      // white edge line following each kerb return (0.65 .. 0.85 m inside the pavement edge, like the road edge lines)
      for (const cv of corners) for (let k = 0; k < cv.length - 1; k++) {
        const [x0, z0] = cv[k], [x1, z1] = cv[k + 1]
        const tx = x1 - x0, tz = z1 - z0, tl = Math.hypot(tx, tz) || 1
        let nx = -tz / tl, nz = tx / tl
        if (nx * (-x0) + nz * (-z0) < 0) { nx = -nx; nz = -nz } // towards the junction centre
        const q = (x: number, z: number, o: number): [number, number] => [cx + x + nx * o, cz + z + nz * o]
        marks.upQuad([q(x0, z0, 0.65), q(x1, z1, 0.65), q(x1, z1, 0.85), q(x0, z0, 0.85)], 0.02, WHITE)
      }
    }
    else {
      const rs = rbSpec(i, j)!
      const ring = new THREE.RingGeometry(rs.island - 1, rs.outer, 72, 1)
      ring.rotateX(-Math.PI / 2)
      ring.translate(cx, 0.001, cz)
      asphalt.addGeometry(ring, [1, 1, 1], 4)
    }
    for (const d of [0, 3]) {
      if (armClosed(i, j, d)) continue // this road is closed (roundabouts with fewer exits)
      const [dx, dz] = dirv(d)
      const kA = nodeKind(i, j), kB = nodeKind(i + dx, j + dz)
      const cA = clearance(i, j, d % 2), cB = clearance(i + dx, j + dz, d % 2)
      const fA = flareOf(i, j), fB = flareOf(i + dx, j + dz)
      const L = roadLen(i, j, d)
      const sgA = (u: number) => segHalves(kA, kB, cA, cB, u, fA, fB, jTypeOf(i, j, d % 2), jTypeOf(i + dx, j + dz, d % 2), L, armBase(i, j, d))
      const u0 = kA === 'round' ? cA - 3 : cA
      const u1 = kB === 'round' ? L - cB + 3 : L - cB
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
  const arrow = (ax: number, az: number, d: number, u0: number, ds: 1 | -1, v0: number, kind: 'L' | 'S' | 'R' | 'SR' | 'SL' | 'M') => {
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
    const ax = nodeX(i), az = nodeZ(j)
    for (const d of [0, 3]) {
      if (armClosed(i, j, d)) continue // this road is closed (roundabouts with fewer exits)
      const [dx, dz] = dirv(d)
      const clrA = clearance(i, j, d % 2), clrB = clearance(i + dx, j + dz, d % 2)
      const L = roadLen(i, j, d), STUBU = L / 2 // the side streets are halfway along
      const one = armOne(i, j, d) // a one-lane residential street
      const S0 = clrA, S1 = L - clrB
      const kA = nodeKind(i, j), kB = nodeKind(i + dx, j + dz)
      const fA = flareOf(i, j), fB = flareOf(i + dx, j + dz) // lanes flare beside a splitter island at these ends
      const tA = jTypeOf(i, j, d % 2), tB = jTypeOf(i + dx, j + dz, d % 2)
      const sgh = (u: number) => segHalves(kA, kB, S0, L - S1, u, fA, fB, tA, tB, L, armBase(i, j, d))
      const style = resStyle(d % 2, d % 2 === 0 ? j : i) // the kind of residential street (null: a town road)
      const rbA = rbSpec(i, j), rbB = rbSpec(i + dx, j + dz)
      // Each carriageway sits one lane out from the centre line (the median) so the through lanes run straight across junctions. The median's
      // two edge lines (yellow) meet in the middle as the left-turn lanes open up in it near a signalised junction.
      const medAt = (u: number) => medW(tA, tB, S0, L - S1, u, L)
      const aSh = (u: number) => pocketW(tA, u - S0, medAt(u)) // width of the left-turn lane(s) at A's end
      const bSh = (u: number) => pocketW(tB, S1 - u, medAt(u))
      const centreRd = !!tA?.centre && !!tB?.centre
      if (centreRd) {
        // CENTRE TURN LANE: one shared lane down the middle. Near each junction it is that approach's left-turn lane; in between it is a
        // two-way left-turn lane (solid yellow outside, broken yellow inside) from which either direction may turn into the side streets.
        const PK = 50, h = LANE_W / 2
        for (let u = S0; u < S1 - 0.01; u += 3) {
          const ue = Math.min(u + 3, S1), dA = u - S0, dB = S1 - ue
          const twoWay = dA >= PK && dB >= PK
          for (const sg of [1, -1]) {
            const own = sg === 1 ? dB < PK : dA < PK // this side's own left-turn lane: a white lane line
            if (own) mk(ax, az, d, u, ue, sg * h - 0.075, sg * h + 0.075, WHITE)
            else {
              mk(ax, az, d, u, ue, sg * h - 0.07, sg * h + 0.07, YELLOW)
              if (!twoWay) mk(ax, az, d, u, ue, sg * (h - 0.34) - 0.07, sg * (h - 0.34) + 0.07, YELLOW) // double yellow beside the other side's turn lane
              else if (Math.floor((u - S0) / 3) % 3 === 0) mk(ax, az, d, u, ue, sg * (h - 0.34) - 0.07, sg * (h - 0.34) + 0.07, YELLOW) // broken inner line
            }
          }
        }
        // pairs of opposing left-turn arrows in the two-way section
        for (const uu of [STUBU - 24, STUBU + 24]) { arrow(ax, az, d, uu + 2.5, 1, 0, 'L'); arrow(ax, az, d, uu - 2.5, -1, 0, 'L') }
      }
      for (let u = S0; !centreRd && style !== 'dense' && style !== 'quiet' && u < S1 - 0.01; u += 3) { // (quiet and dense residential streets have no lines)
        const ue = Math.min(u + 3, S1)
        if (style === 'normal') {
          // two lanes separated by a broken yellow line (3 m dashes, 6 m gaps)
          if (Math.floor((u - S0) / 3) % 3 === 0) marks.upQuad([at(ax, az, d, u, -0.07), at(ax, az, d, ue, -0.07), at(ax, az, d, ue, 0.07), at(ax, az, d, u, 0.07)], 0.02, YELLOW)
          continue
        }
        const yAB = (x: number) => Math.max(0, medAt(x) - bSh(x)), yBA = (x: number) => -Math.max(0, medAt(x) - aSh(x))
        marks.upQuad([at(ax, az, d, u, yAB(u) + 0.13), at(ax, az, d, ue, yAB(ue) + 0.13), at(ax, az, d, ue, yAB(ue) + 0.27), at(ax, az, d, u, yAB(u) + 0.27)], 0.02, YELLOW)
        marks.upQuad([at(ax, az, d, u, yBA(u) - 0.27), at(ax, az, d, ue, yBA(ue) - 0.27), at(ax, az, d, ue, yBA(ue) - 0.13), at(ax, az, d, u, yBA(u) - 0.13)], 0.02, YELLOW)
      }
      // the median itself is a raised, planted island (kerb + grass) wherever it is wide enough: the left-turn lanes are cut into it
      {
        const yAB = (x: number) => Math.max(0, medAt(x) - bSh(x)), yBA = (x: number) => -Math.max(0, medAt(x) - aSh(x))
        let run: Array<[number, number, number]> = []
        const flush = () => {
          if (run.length >= 2) for (const [inset, h, col] of [[0, 0.16, [0.62, 0.62, 0.64]], [0.28, 0.19, [0.24, 0.46, 0.2]]] as Array<[number, number, V3]>) {
            const top: V2[] = [], bot: V2[] = []
            for (const [u, lo, hi] of run) if (hi - lo > 2 * inset + 0.1) { top.push(at(ax, az, d, u, hi - inset)); bot.push(at(ax, az, d, u, lo + inset)) }
            if (top.length < 2) continue
            const shp = new THREE.Shape([...top, ...bot.reverse()].map(([x, z]) => new THREE.Vector2(x, -z)))
            const g = new THREE.ExtrudeGeometry(shp, { depth: h, bevelEnabled: false })
            g.rotateX(-Math.PI / 2)
            solid.addGeometry(g, col)
          }
          run = []
        }
        for (let u = S0 + 5; u <= S1 - 5 + 0.01; u += 2.5) {
          const lo = yBA(u) + 0.5, hi = yAB(u) - 0.5
          if (hi - lo > 0.35 && !centreRd) run.push([u, lo, hi])
          else flush()
        }
        flush()
      }
      // dashed divider between the two ordinary lanes, both directions
      const shiftAt = (u: number) => Math.max(fA ? rbShift(u - S0) : 0, fB ? rbShift(S1 - u) : 0)
      for (const sg of one ? [] : [-1, 1]) {
        // near a roundabout the divider is drawn closer together (3 m dash, 3 m gap) and right up to the entry line
        const uLo = S0 + (kA === 'round' && sg === -1 ? 3 : 4), uHi = S1 - (kB === 'round' && sg === 1 ? 4 : 12)
        for (let u = uLo; u + 3 < uHi; ) {
          const v0 = sg * (LANE_W + medAt(u) + shiftAt(u)), v1 = sg * (LANE_W + medAt(u + 3) + shiftAt(u + 3))
          marks.upQuad([at(ax, az, d, u, v0 - 0.075), at(ax, az, d, u + 3, v1 - 0.075), at(ax, az, d, u + 3, v1 + 0.075), at(ax, az, d, u, v0 + 0.075)], 0.02, WHITE)
          const toRound = sg === 1 ? (kB === 'round' ? S1 - u : 1e9) : kA === 'round' ? u - S0 : 1e9
          u += toRound < 70 ? 6 : 12
        }
      }
      // the left-turn lane's own dashed divider (the median's edge, where the pocket lane meets the first through lane)
      for (let u = S0 + 4; u + 3 < S1 - 12; u += 12) {
        if (tB && bSh(u + 3) > 0.4) mk(ax, az, d, u, u + 3, medAt(u) - 0.075, medAt(u) + 0.075, WHITE)
        if (tA && aSh(u) > 0.4) mk(ax, az, d, u, u + 3, -medAt(u) - 0.075, -medAt(u) + 0.075, WHITE)
        // between two left-turn lanes
        if (tB?.nL === 2 && bSh(u + 3) > 1.5 * LANE_W) mk(ax, az, d, u, u + 3, medAt(u) - bSh(u) / 2 - 0.075, medAt(u) - bSh(u) / 2 + 0.075, WHITE)
        if (tA?.nL === 2 && aSh(u) > 1.5 * LANE_W) mk(ax, az, d, u, u + 3, -(medAt(u) - aSh(u) / 2) - 0.075, -(medAt(u) - aSh(u) / 2) + 0.075, WHITE)
        // the right-turn-only lane's divider
        if (tB?.rOnly && flare(S1 - u - 3) > 0.25) mk(ax, az, d, u, u + 3, medAt(u) + 2 * LANE_W - 0.075, medAt(u) + 2 * LANE_W + 0.075, WHITE)
        if (tA?.rOnly && flare(u - S0) > 0.25) mk(ax, az, d, u, u + 3, -(medAt(u) + 2 * LANE_W) - 0.075, -(medAt(u) + 2 * LANE_W) + 0.075, WHITE)
      }
      // houses along both sides of a residential street, facing it (they follow its bends)
      if (one) {
        const rr = (u: number, k: number) => hashN(ax * 0.37 + u * 1.7, az * 0.53 + d, k)
        for (const sg of [1, -1] as const) {
          // (no houses near a roundabout: it stands in open ground, with room to see the traffic going round)
          for (let u = S0 + (kA === 'round' ? 75 : 24) + rr(sg, 0) * 6; u < S1 - (kB === 'round' ? 75 : 22); ) {
            const w = 11 + rr(u, 1) * 4, dp = 8.5 + rr(u, 2) * 2.5, drive = 6.5 + rr(u, 3) * 3
            const edge = sg === 1 ? sgh(u).right : sgh(u).left
            const [p0x, p0z] = at(ax, az, d, u - 1, 0), [p1x, p1z] = at(ax, az, d, u + 1, 0)
            const tl = Math.hypot(p1x - p0x, p1z - p0z) || 1
            const yaw = Math.atan2(-(p1z - p0z) / tl, (p1x - p0x) / tl) + (sg === 1 ? 0 : Math.PI) // local +z points away from the street
            const [hx, hz] = at(ax, az, d, u, sg * (edge + 1.2 + drive + dp / 2))
            const gx = house(hx, hz, yaw, w, dp, drive + 1.2, (k) => rr(u + 0.5, 10 + k))
            // a dense street: a car parked at the kerb in front of most houses (clear of the driveway)
            if (style === 'dense' && rr(u, 5) < 0.45 && !(kA === 'round' && u < S0 + 95) && !(kB === 'round' && u > S1 - 95)) {
              const uc = u - sg * gx * 0.55, [q0x, q0z] = at(ax, az, d, uc - 1, 0), [q1x, q1z] = at(ax, az, d, uc + 1, 0)
              const ql = Math.hypot(q1x - q0x, q1z - q0z) || 1
              const [px, pz] = at(ax, az, d, uc, sg * (RES_LANE_W + PARK_W / 2))
              parkedCar(px, pz, (q1x - q0x) / ql, (q1z - q0z) / ql, Math.floor(u))
            }
            // gardens between the houses: tight on a dense street, wide where there are fewer houses
            u += w + (style === 'dense' ? 3 + rr(u, 4) * 3 : style === 'centre' ? 16 + rr(u, 4) * 14 : 9 + rr(u, 4) * 8)
          }
        }
      }
      // edge lines follow the widening road (they hand over to the curved kerb where the road sweeps into a roundabout)
      const clipA = rbA ? Math.max(0, rbFillet(rbA, armBase(i, j, d)).uc - S0) : 0, clipB = rbB ? Math.max(0, rbFillet(rbB, armBase(i, j, d)).uc - (L - S1)) : 0
      for (let u = S0 + clipA; u < S1 - clipB - 0.01; u += 3) {
        const ue = Math.min(u + 3, S1 - clipB)
        const h0 = sgh(u), h1 = sgh(ue)
        if (centreRd && stubsOn() && u + 1.5 > STUBU - STUB.half - 3 && u + 1.5 < STUBU + STUB.half + 3) continue // the mouth of a side street
        if (style === 'dense' || style === 'quiet') continue // quiet and dense residential streets have no edge lines either
        const rampMouth = LAYOUT.kind === 'mixed' && d === 0 && i === RAMP_I && j === RAMP_J && u + 1.5 > RAMP_AT - 32 && u < RAMP_AT + 6
        if (!rampMouth) marks.upQuad([at(ax, az, d, u, h0.right - 0.35), at(ax, az, d, ue, h1.right - 0.35), at(ax, az, d, ue, h1.right - 0.15), at(ax, az, d, u, h0.right - 0.15)], 0.02, WHITE)
        marks.upQuad([at(ax, az, d, u, -(h0.left - 0.15)), at(ax, az, d, ue, -(h1.left - 0.15)), at(ax, az, d, ue, -(h1.left - 0.35)), at(ax, az, d, u, -(h0.left - 0.35))], 0.02, WHITE)
      }
      // stop lines + zebra crossings at both ends
      const roundEnd1 = nodeKind(i + dx, j + dz) === 'round'
      const roundEnd0 = nodeKind(i, j) === 'round'
      const ctlB = tB ? armCtrl(nodeIndex(i + dx, j + dz), d % 2) : 'free', ctlA = tA ? armCtrl(nodeIndex(i, j), d % 2) : 'free'
      if (tB && (ctlB === 'light' || ctlB === 'stop')) mk(ax, az, d, S1 - 2.3, S1 - 1.7, tB.centre ? -LANE_W / 2 + 0.2 : 0.4, jHalf(tB) - 0.1, WHITE)
      if (tA && (ctlA === 'light' || ctlA === 'stop')) mk(ax, az, d, S0 + 1.7, S0 + 2.3, -jHalf(tA) + 0.1, tA.centre ? LANE_W / 2 - 0.2 : -0.4, WHITE)
      // a signalised roundabout has a stop bar before the crosswalk
      if (rbB?.signals) mk(ax, az, d, S1 - 18.4, S1 - 17.8, rbShift(18) + 0.2, HALF_MID + rbShift(18) - 0.1, WHITE)
      if (rbA?.signals) mk(ax, az, d, S0 + 17.8, S0 + 18.4, -(HALF_MID + rbShift(18) - 0.1), -(rbShift(18) + 0.2), WHITE)
      // roundabout entries: a yield line of white triangles ("shark teeth") pointing at approaching drivers,
      // and a raised splitter island that separates entering from leaving traffic
      const teeth = (uEnd: number, ds: 1 | -1, vSign: 1 | -1, flareEnd: boolean, minV = 0) => {
        const sh = flareEnd ? rbShift(2.5) : 0
        for (let v = sh + 0.3 + minV; v < HALF_MID + sh - 0.3; v += 0.9) {
          const p0 = at(ax, az, d, uEnd - ds * 2.1, vSign * v)
          const p1 = at(ax, az, d, uEnd - ds * 2.1, vSign * (v + 0.6))
          const p2 = at(ax, az, d, uEnd - ds * 3.0, vSign * (v + 0.3)) // the tip points back at the approaching car
          marks.upQuad([p0, p1, p2, p2], 0.02, WHITE)
        }
      }
      const island = (uEnd: number, ds: 1 | -1) => {
        const half = RB_ISLAND.slice(0, 4) // [distance from the ring, half-width] down to the nose
        const pts: Pt2[] = [[0.6, -half[0][1]], ...half.map(([a, b]) => [a, b] as Pt2), ...half.slice(1, 3).reverse().map(([a, b]) => [a, -b] as Pt2)]
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
        // planted (grass) top inside the kerb, like a real splitter island
        const gin: Pt2[] = [[1.0, -(half[0][1] - 0.4)], [1.0, half[0][1] - 0.4], [9, half[1][1] - 0.4], [19, half[2][1] - 0.38], [24, 0.12], [19, -(half[2][1] - 0.38)], [9, -(half[1][1] - 0.4)]]
        const gsh = new THREE.Shape(gin.map(([a, b]) => { const [wx, wz] = at(ax, az, d, uEnd - ds * a, b); return new THREE.Vector2(wx, -wz) }))
        const gg = new THREE.ExtrudeGeometry(gsh, { depth: 0.2, bevelEnabled: false })
        gg.rotateX(-Math.PI / 2)
        solid.addGeometry(gg, [0.24, 0.46, 0.2])
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
      // zebra crossing across each arm, a car length back from the yield line (it passes through a gap either side of the splitter island)
      const zebra = (uEnd: number, ds: 1 | -1, spec: NonNullable<ReturnType<typeof rbSpec>>) => {
        const back = spec.signals ? 12.5 : 6.5
        const isl = (spec.splitter ? rbShift(back + 1.5) : 1.1) + 0.45
        const edge = sgh(uEnd - ds * (back + 1.5))
        for (const sg of [-1, 1] as const) {
          const lim = (sg === 1 ? edge.right : edge.left) - 0.75
          // on a one-lane roundabout the entry's left lane is a raised island there: no stripes on it
          const wedge = sg === ds && spec.laneR.length === 1 && !one ? wedgeSpan(back + 1.5, spec.splitter) : null
          for (let v = isl; v + 0.55 < lim; v += 1.15) {
            if (wedge && v + 0.55 > wedge[0] - 0.3 && v < wedge[1] + 0.3) continue
            mk(ax, az, d, uEnd - ds * (back + 3), uEnd - ds * back, sg * v, sg * (v + 0.55), WHITE)
          }
        }
      }
      if (roundEnd1 && rbB) zebra(S1, 1, rbB)
      if (roundEnd0 && rbA) zebra(S0, -1, rbA)
      if (ctlB === 'yield') teeth(S1, 1, 1, false)
      if (ctlA === 'yield') teeth(S0, -1, -1, false)
      if (roundEnd1) { teeth(S1, 1, 1, fB, rbB && rbB.laneR.length === 1 && !one ? LANE_W : 0); if (fB) island(S1, 1); else paintedIsland(S1, 1) }
      if (roundEnd0) { teeth(S0, -1, -1, fA, rbA && rbA.laneR.length === 1 && !one ? LANE_W : 0); if (fA) island(S0, -1); else paintedIsland(S0, -1) }
      // painted lane arrows: signal approach = left / straight / right-only; roundabout approach (2 lanes) = left lane straight + left, right lane straight + right.
      // a one-lane roundabout has a one-lane entry: the left lane is closed (hatched) and only the right lane is open
      const endKinds = (round: boolean, twoLane: boolean): Array<'L' | 'S' | 'R' | 'SL' | 'SR' | null> => (round ? (one ? ['S'] : twoLane ? ['SL', 'SR'] : [null, 'S']) : ['L', 'S', 'SR'])
      for (const [uEnd, ds, round, v0sign] of [[S1, 1, nodeKind(i + dx, j + dz) === 'round', 1], [S0, -1, nodeKind(i, j) === 'round', -1]] as Array<[number, 1 | -1, boolean, 1 | -1]>) {
        const rbE = uEnd === S1 ? rbB : rbA
        const flE = uEnd === S1 ? fB : fA
        const twoLane = (rbE?.laneR.length ?? 2) === 2
        const tE = uEnd === S1 ? tB : tA
        if (tE) for (const ln of jLanes(tE)) {
          // lane-use arrows of this junction's layout (turn-only lanes also say ONLY)
          // (a residential street's single lane has no arrows: only its centre turn lane is marked)
          if (ln.use !== 'SLR' && !(one && ln.use !== 'L')) for (const back of [20, 58]) arrow(ax, az, d, uEnd - ds * back, ds, v0sign * ln.lat, ln.use)
          if (ln.use === 'L' || ln.use === 'R') roadText(ax, az, d, uEnd - ds * 38, ds, v0sign * ln.lat, 2.2, 4.6, SIGN.only)
          if ((uEnd === S1 ? ctlB : ctlA) === 'stop') roadText(ax, az, d, uEnd - ds * 8, ds, v0sign * ln.lat, 2.6, 3.4, SIGN.stopText) // STOP painted before the line
        }
        else endKinds(round, twoLane).forEach((kind, k) => {
          if (!kind) return
          for (const back of [20, 58]) arrow(ax, az, d, uEnd - ds * back, ds, v0sign * (laneC(k, one) + (round && flE ? rbShift(back) : 0)), kind)
        })
        if (round && !twoLane && !one) {
          // The left lane really ends: a raised island starts as a point 130 m out and widens until it fills the lane at 60 m, so the
          // two lanes merge into one (like a zipper merge). Merge arrows and signs warn well before it.
          const pts = (inset: number): Array<[number, number]> => {
            const a: Array<[number, number]> = [], bk: Array<[number, number]> = []
            for (let back = WEDGE_LEN - 0.5; back >= 1.2; back -= back > WEDGE_FULL ? 4 : 10) {
              const sp = wedgeSpan(back, !!flE)
              if (!sp || sp[1] - sp[0] < 2 * inset + 0.05) continue
              a.push(at(ax, az, d, uEnd - ds * back, v0sign * (sp[0] + inset)))
              bk.push(at(ax, az, d, uEnd - ds * back, v0sign * (sp[1] - inset)))
            }
            return [...a, ...bk.reverse()]
          }
          for (const [inset, h, color] of [[0, 0.16, [0.62, 0.62, 0.64]], [0.3, 0.19, [0.32, 0.46, 0.26]]] as Array<[number, number, V3]>) {
            const poly = pts(inset)
            if (poly.length < 3) continue
            const shp = new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, -z)))
            const g = new THREE.ExtrudeGeometry(shp, { depth: h, bevelEnabled: false })
            g.rotateX(-Math.PI / 2)
            solid.addGeometry(g, color)
          }
          // merge arrows in the closing lane, well before the taper
          for (const back of [158, 140]) arrow(ax, az, d, uEnd - ds * back, ds, v0sign * (laneOff(0) + (flE ? rbShift(back) : 0)), 'M')
        }
      }
      // speed-limit signs on the right-hand verge in both directions, mid-block. Each one stands where ITS side of the
      // road is still 2 lanes wide (not inside the widened approach to a signalised junction or a roundabout flare).
      {
        const fdv = dirv(d)
        const mid = (S0 + S1) / 2
        const uPlus = Math.max(S0 + 36, mid) // signs stand mid-block, clear of the junctions
        const uMinus = Math.min(S1 - 36, mid)
        for (const sgv of [1, -1] as const) {
          const uSign = sgv === 1 ? uPlus : uMinus
          const [sx, sz] = at(ax, az, d, uSign, sgv * ((sgv === 1 ? sgh(uSign).right : sgh(uSign).left) + 1.7)) // beside the road as wide as it is right there
          post(sx, sz, 2.4)
          signQuad(sx - fdv[0] * sgv * 0.08, 2.15, sz - fdv[1] * sgv * 0.08, 0.85, 1.05, [-fdv[0] * sgv, -fdv[1] * sgv], limitSign(streetMph(d % 2, d % 2 === 0 ? j : i)))
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
          for (let k = 0; k < (one ? 1 : 2); k++) {
            const c = sg * laneC(k, one)
            track(c - 0.85, 0.72, 0.17) // left wheel track
            track(c + 0.85, 0.72, 0.17) // right wheel track
            track(c, 0.5, 0.06) // oil drip down the middle of the lane
          }
        }
        // patches (a different, slightly darker or lighter square of asphalt) and cracks
        for (let u = S0 + 12; u < S1 - 12; u += 17 + hashN(ax + u, az, 9) * 20) {
          const r1 = hashN(ax + u, az + 3, 10), r2 = hashN(ax + u, az + 5, 11), r3 = hashN(ax + u, az + 7, 12)
          const lane = (r1 < 0.5 ? -1 : 1) * (laneC(r2 < 0.5 || one ? 0 : 1, one) + (r3 - 0.5) * (one ? 0.8 : 1.4))
          const L = 1.6 + r2 * 3.4, W = 1.2 + r3 * 1.8
          wear.quad(at(ax, az, d, u, lane - W / 2), at(ax, az, d, u + L, lane - W / 2), at(ax, az, d, u + L, lane + W / 2), at(ax, az, d, u, lane + W / 2), 0.013, 0.28 + r1 * 0.2, r2 < 0.35 ? 0.25 : 0)
          // a hairline crack running across the patch
          wear.quad(at(ax, az, d, u - 1, lane + W / 2 + 0.1), at(ax, az, d, u + L + 2, lane + W / 2 + 0.16), at(ax, az, d, u + L + 2, lane + W / 2 + 0.22), at(ax, az, d, u - 1, lane + W / 2 + 0.16), 0.014, 0.5)
        }
        // transverse tar seams every ~12 m across both directions
        for (let u = S0 + 9; u < S1 - 8; u += 11.7) {
          wear.quad(at(ax, az, d, u, -armBase(i, j, d)), at(ax, az, d, u + 0.09, -armBase(i, j, d)), at(ax, az, d, u + 0.09, armBase(i, j, d)), at(ax, az, d, u, armBase(i, j, d)), 0.014, 0.35)
        }
        void LIGHT
        // concrete gutter along both kerbs (the strip of water channel between the asphalt and the kerb)
        for (const sg of [-1, 1] as const) {
          const e0 = (u: number) => (sg === 1 ? sgh(u).right : sgh(u).left)
          for (let u = S0 + clipA; u < S1 - clipB - 0.01; u += 4) {
            const ue = Math.min(u + 4, S1 - clipB)
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
    const cx = nodeX(i), cz = nodeZ(j)
    const n = nodeIndex(i, j)
    const kind = nodeKind(i, j)

    if (kind === 'signal') {
      // dashed turn-guide lines through the junction box: they show the path of a left turn (new left lane) only
      const guide = (S: V2, E: V2, ctrl: V2, X: V2) => {
        // sample the path finely, then lay short even dashes along it (0.6 m paint, 0.9 m gap: a dotted extension line, as on real roads)
        const pts: V2[] = [S]
        for (let k = 0; k <= 160; k++) {
          const t = k / 160, u = 1 - t
          pts.push([u * u * E[0] + 2 * u * t * ctrl[0] + t * t * X[0], u * u * E[1] + 2 * u * t * ctrl[1] + t * t * X[1]])
        }
        const DASH = 0.6, PERIOD = 1.5
        let acc = 0, start: V2 | null = null
        for (let q = 1; q < pts.length; q++) {
          const [x0, z0] = pts[q - 1], [x1, z1] = pts[q]
          const sl = Math.hypot(x1 - x0, z1 - z0)
          if (sl < 1e-6) continue
          const on = acc % PERIOD < DASH
          if (on && !start) start = [x0, z0]
          if (start && (!on || q === pts.length - 1)) {
            const dl = Math.hypot(x0 - start[0], z0 - start[1])
            if (dl > 0.05) {
              const nx = (-(z0 - start[1]) / dl) * 0.075, nz = ((x0 - start[0]) / dl) * 0.075
              marks.upQuad([[start[0] - nx, start[1] - nz], [x0 - nx, z0 - nz], [x0 + nx, z0 + nz], [start[0] + nx, start[1] + nz]], 0.02, WHITE)
            }
            start = null
          }
          acc += sl
        }
      }
      for (let ar = 0; ar < 4; ar++) {
        const tt = (ar + 2) % 4
        const [aox, aoz] = dirv(ar), [alx, alz] = dirv(ar + 1)
        const stz = dirv(tt)[1]
        // Guides run along the lane EDGE on the side toward the other lanes, not down the lane's middle: a left turn starts on the
        // line between the left lane and its neighbour (at the stop line) and sweeps in one wide curve onto the matching line of the
        // lane it turns into; a right turn does the same from the line between the right-turn lane and its neighbour.
        // one per left-turning lane, from the right-hand end of that lane's stop line onto the same edge of the lane it turns into
        const jt = jTypeOf(i, j, ar % 2)!, mIn = jt.mw * LANE_W, mOut = jTypeOf(i, j, (ar + 1) % 2)!.mw * LANE_W
        const e1 = (tt + 1) % 4
        const lefts: Array<[number, number, number]> = jt.nL === 2 ? [[e1, mIn - LANE_W, mOut + LANE_W], [e1, mIn, mOut + 2 * LANE_W]] : jt.nL === 1 ? [[e1, mIn, mOut + LANE_W]] : [[e1, mIn + LANE_W, mOut + LANE_W]]
        if (armClosed(i, j, ar) || armClosed(i, j, (tt + 1) % 4)) continue
        if (jt.one || jTypeOf(i, j, (ar + 1) % 2)!.one) continue // residential junctions have no turn-guide lines
        for (const [e, oEdge, xEdge] of lefts) {
          const o = oEdge
          const bIn = clearance(i, j, ar % 2), bOut = clearance(i, j, e % 2)
          const E: V2 = [cx + aox * bIn + alx * o, cz + aoz * bIn + alz * o]
          const [eox, eoz] = dirv(e), [erx, erz] = dirv(e - 1)
          const X: V2 = [cx + eox * bOut + erx * xEdge, cz + eoz * bOut + erz * xEdge]
          // start at the stop line (where the lane ends), run straight to the box edge, then curve into the exit lane
          const S: V2 = [E[0] + aox * 1.6, E[1] + aoz * 1.6]
          guide(S, E, stz === 0 ? [X[0], E[1]] : [E[0], X[1]], X)
        }
      }
    } else {
      const spec = rbSpec(i, j)!
      const L = spec.laneR.length
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
      // two circulating lanes are separated by a dotted white circle all the way round (it only stops across the mouths of the roads that
      // really open onto the roundabout, where traffic crosses it)
      if (L === 2) {
        const rd = (spec.laneR[0] + spec.laneR[1]) / 2
        const nDash = Math.max(12, Math.round((2 * Math.PI * rd) / 5.2)) // one dash + gap every ~5 m, a whole number round the circle
        const step = (Math.PI * 2) / nDash
        const pt = (r: number, a: number): V2 => [cx + r * Math.cos(a), cz - r * Math.sin(a)]
        for (let k = 0; k < nDash; k++) {
          const t0 = k * step, t1 = t0 + step * 0.5
          const mid = (t0 + t1) / 2
          void mid // the dotted circle runs unbroken all the way round
          marks.upQuad([pt(rd - 0.1, t0), pt(rd - 0.1, t1), pt(rd + 0.1, t1), pt(rd + 0.1, t0)], 0.02, WHITE)
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
            // lane-use branch off the shaft, so each lane reads "carry on round + exit": the inner lane also turns left (towards the island),
            // the outer lane also turns right (out of the roundabout)
            const innerLane = spec.laneR.length > 1 && lr === spec.laneR[0]
            const dir = innerLane ? -1 : 1
            const s0 = -2.2, s1 = 0.9, dEnd = dir * 1.7
            const vl = Math.hypot(s1 - s0, dEnd), vs = (s1 - s0) / vl, vd = dEnd / vl
            const w = 0.14
            marks.upQuad([P(s0, 0 - w * 0.9), P(s0, 0 + w * 0.9), P(s1 + vd * -w, dEnd + vs * w), P(s1 + vd * w, dEnd - vs * w)], 0.03, WHITE)
            marks.upQuad([P(s1 + vd * 0.6, dEnd - vs * 0.6), P(s1 - vd * 0.6, dEnd + vs * 0.6), P(s1 + vs * 1.3, dEnd + vd * 1.3), P(s1 + vs * 1.3, dEnd + vd * 1.3)], 0.03, WHITE) // arrowhead
          }
        }
      }
      // Curved kerbs sweep every road into the ring (a flared mouth, as on a real roundabout), with a white edge line round the outside
      {
        const gaps: Array<[number, number]> = []
        for (let d = 0; d < 4; d++) {
          if (armClosed(i, j, d)) continue
          const f = rbFillet(spec, armBase(i, j, d)) // each mouth fits the road on its arm (a residential street is narrow)
          const [dx, dz] = dirv(d)
          const L2 = (u: number, v: number): V2 => [cx + dx * u - dz * v, cz + dz * u + dx * v]
          gaps.push([(d * Math.PI) / 2 - f.ang, (d * Math.PI) / 2 + f.ang])
          for (const sg of [-1, 1]) {
            const C: V2 = [f.uc, sg * (f.hwC + f.Rf)]
            const p1 = Math.atan2(-sg, 0), p2raw = Math.atan2(-C[1], -C[0])
            let dp = p2raw - p1
            dp = Math.atan2(Math.sin(dp), Math.cos(dp))
            const N = 14
            const arc = (rad: number, k: number): V2 => { const p = p1 + (dp * k) / N; return [C[0] + rad * Math.cos(p), C[1] + rad * Math.sin(p)] }
            const poly: V2[] = []
            for (let k = 0; k <= N; k++) poly.push(arc(f.Rf, k))
            const bT = Math.atan2(C[1], C[0]), um = Math.sqrt(Math.max(0, spec.outer ** 2 - f.hwM ** 2)), bM = Math.atan2(sg * (f.hwM - 0.8), um)
            for (let k = 0; k <= 6; k++) { const bb = bT + ((bM - bT) * k) / 6; poly.push([(spec.outer - 0.4) * Math.cos(bb), (spec.outer - 0.4) * Math.sin(bb)]) }
            poly.push([f.uc, sg * (f.hwC - 0.8)])
            const shp = new THREE.Shape(poly.map(([u, v]) => { const [x, z] = L2(u, v); return new THREE.Vector2(x, -z) }))
            const g = new THREE.ShapeGeometry(shp)
            g.rotateX(-Math.PI / 2)
            g.translate(0, 0.0006, 0)
            asphalt.addGeometry(g, [1, 1, 1], 4)
            for (let k = 0; k < N; k++) {
              const q = (rad: number, kk: number) => L2(...arc(rad, kk))
              marks.upQuad([q(f.Rf + 0.15, k), q(f.Rf + 0.15, k + 1), q(f.Rf + 0.35, k + 1), q(f.Rf + 0.35, k)], 0.02, WHITE)
              marks.upQuad([q(f.Rf - 0.55, k), q(f.Rf - 0.55, k + 1), q(f.Rf - 0.02, k + 1), q(f.Rf - 0.02, k)], 0.016, [0.58, 0.58, 0.6]) // gutter
            }
          }
        }
        // the ring's outer edge line, everywhere except across the road mouths
        const p = (r: number, a: number): V2 => [cx + r * Math.cos(a), cz - r * Math.sin(a)]
        const M = 120
        for (let k = 0; k < M; k++) {
          const a0 = (k / M) * Math.PI * 2, a1 = ((k + 1) / M) * Math.PI * 2, am = (a0 + a1) / 2
          if (gaps.some(([g0, g1]) => { const c = (g0 + g1) / 2; return Math.abs(Math.atan2(Math.sin(am - c), Math.cos(am - c))) < (g1 - g0) / 2 })) continue
          marks.upQuad([p(spec.outer - 0.35, a0), p(spec.outer - 0.35, a1), p(spec.outer - 0.15, a1), p(spec.outer - 0.15, a0)], 0.02, WHITE)
          marks.upQuad([p(spec.outer + 0.02, a0), p(spec.outer + 0.02, a1), p(spec.outer + 0.55, a1), p(spec.outer + 0.55, a0)], 0.016, [0.58, 0.58, 0.6])
        }
      }
    }

    for (let a = 0; a < 4; a++) {
      if (armClosed(i, j, a)) continue
      const [ox, oz] = dirv(a)
      const [rx, rz] = dirv(a + 1) // right of the inbound travel direction
      const P = (u: number, q: number): V2 => { const qb = q - bendAt(cx, cz, a, u); return [cx + ox * u + rx * qb, cz + oz * u + rz * qb] } // (q: right of the inbound driver)
      const face: V2 = [ox, oz]
      const crossIdx = a % 2 === 0 ? i : 4 + j // road that crosses the one being driven along
      const yaw = Math.atan2(ox, oz)
      // half-width of the road u metres out along this arm: it is wider wherever the median is present (towards a signalised junction),
      // so signs always stand on the verge, never in a lane
      const [nbx, nbz] = dirv(a)
      const clr = clearance(i, j, a % 2) // where this approach ends
      const clrNb = clearance(i + nbx, j + nbz, a % 2)
      const jt = jTypeOf(i, j, a % 2), jtNb = jTypeOf(i + nbx, j + nbz, a % 2)
      const Lnb = roadLen(i, j, a)
      const oneHere = armOne(i, j, a)
      const HWat = (u: number) => armBase(i, j, a) + medW(jt, jtNb, clr, clrNb, u, Lnb) + (jt?.rOnly ? LANE_W * flare(u - clr) : 0)
      const HW = HWat(clr + 2.5)

      // roadside signs on the right-hand verge
      const side = (u: number, h: number, w: number, hh: number, r: Rect) => {
        // beside the road: the verge starts further out where the roundabout entrance flares
        const [x, z] = P(u, HWat(u) + 1.7 + (flareOf(i, j) ? rbShift(u - clr) : 0))
        post(x, z, h)
        signQuad(x + ox * 0.08, h + hh / 2 - 0.1, z + oz * 0.08, w, hh, face, r)
      }
      // advance street-name sign, well before the junction: the name of the road you are about to meet
      {
        const [ax2, az2] = P(clr + 78, HWat(clr + 78) + 1.9 + (flareOf(i, j) ? rbShift(78) : 0))
        post(ax2, az2, 3.0, 0.11)
        signQuad(ax2 + ox * 0.09, 2.45, az2 + oz * 0.09, 1.9, 0.95, face, PLATE(crossIdx))
      }
      const ctl = kind === 'signal' ? armCtrl(n, a % 2) : 'light'
      if (kind !== 'signal') side(clr + 62, 2.6, 1.5, 1.5, SIGN.rbWarn)
      else if (ctl === 'light') side(clr + 62, 2.6, 1.1, 1.1, SIGN.sigWarn)
      else if (ctl !== 'free') side(clr + 62, 2.6, 1.3, 1.3, ctl === 'stop' ? SIGN.stopAhead : SIGN.yieldAhead)
      if (kind !== 'signal') side(clr + 120, 2.6, 1.5, 1.5, SIGN.rbWarn) // an early warning as well
      side(clr + 30, 2.4, 0.85, 1.05, limitSign(streetMph(a % 2, a % 2 === 0 ? j : i)))
      // ...and one just after the junction for traffic leaving along this road (on its right, facing it): the new road's limit
      {
        const uo = clr + 22
        const [sx2, sz2] = P(uo, -(HWat(uo) + 1.8 + (flareOf(i, j) ? rbShift(uo - clr) : 0)))
        post(sx2, sz2, 2.9)
        signQuad(sx2 - ox * 0.08, 2.4 + 1.05 / 2 - 0.1, sz2 - oz * 0.08, 0.85, 1.05, [-ox, -oz], limitSign(streetMph(a % 2, a % 2 === 0 ? j : i)))
      }
      if (kind === 'signal' && ctl === 'light') side(clr + 19, 2.1, 0.6, 0.75, SIGN.stopHere)
      if (kind === 'signal') {
        if (jt && jt.nL === 1 && !jt.rOnly && !jt.one) side(clr + 46, 2.5, 1.3, 1.3, SIGN.lanes) // lane-use sign (matches the painted arrows of the 3-lane layout)
      } else if (rbSpec(i, j)!.laneR.length === 2) side(clr + 50, 2.5, 1.7, 1.7, SIGN.rbLanes) // roundabout lane-use sign (matches the painted arrows)
      else if (!oneHere) {
        // one-lane roundabout: warn that the left lane ends and traffic must merge right, well before it
        side(clr + 150, 2.6, 1.1, 1.1, SIGN.laneEnds)
        side(clr + 128, 1.7, 1.3, 1.3, SIGN.laneEndsText)
        side(clr + 96, 2.6, 1.1, 1.1, SIGN.laneEnds)
      }

      if (kind === 'signal' && ctl !== 'light') {
        // STOP / YIELD sign on the right-hand verge at the line (and a second one on the left, so it is seen from every lane)
        if (ctl !== 'free') {
          const allWay = armCtrl(n, 1 - (a % 2)) === 'stop'
          for (const sd of [1, -1]) {
            const [sx, sz] = P(clr + 3.2, sd * (HWat(clr + 3.2) + 1.6))
            post(sx, sz, 3.6, 0.1)
            if (ctl === 'stop') {
              signQuad(sx + ox * 0.09, 3.0, sz + oz * 0.09, 1.5, 1.5, face, SIGN.stop)
              if (allWay) signQuad(sx + ox * 0.09, 2.0, sz + oz * 0.09, 1.0, 1.0, face, SIGN.allWay)
              else if (sd === 1) signQuad(sx + ox * 0.09, 1.9, sz + oz * 0.09, 1.25, 1.25, face, SIGN.crossTraffic)
            } else signQuad(sx + ox * 0.09, 2.9, sz + oz * 0.09, 1.6, 1.6, face, SIGN.yield)
          }
        }
      } else if (kind === 'signal') {
        // Signals hang ACROSS the road on the FAR side of the junction, facing the waiting traffic: a tapered pole on the far
        // verge with a mast arm over the lanes and one three-section head per lane, plus a pole head at the far-left corner.
        const uf = -(clr + 1.5)
        const lanesHere = jLanes(jt!)
        const qEdge = jHalf(jt!) + 1.7
        const axis = a % 2 === 0 ? 0 : 1
        const lensY = HEAD_LENSY
        const [px, pz] = P(uf, qEdge)
        const top = 8.3 // the mast arm: signal heads hang well above the traffic, as on a real signal pole
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
        // Which heads hang over this approach (as on real roads, junctions differ):
        //  ball  - three round lights, for going straight on and turning right (and left, where there is no arrow)
        //  arrow - three ARROW lights (red, yellow, green) for the left-turn lane(s): it rules that lane, whatever the round lights show
        //  dog   - five lights: the round ones plus a yellow and a green arrow beside them (turn on the arrow, or on the round green after giving way)
        // either one head over every lane, or an arrow head over the left-turn lanes and one or two round heads over the rest together.
        const ls = leftSignal(n, a % 2)
        const heads: Array<{ q: number; kind: 'ball' | 'arrow' | 'dog' }> = []
        const leftKind = ls === 'both' ? 'dog' : 'arrow'
        const leftLanes = lanesHere.filter((ln) => ln.use === 'L'), others = lanesHere.filter((ln) => ln.use !== 'L')
        if (headLayout(n, a % 2) === 'perLane') {
          for (const ln of lanesHere) heads.push({ q: ln.lat, kind: ln.use === 'L' && ls !== 'none' ? leftKind : 'ball' })
        } else {
          if (leftLanes.length && ls !== 'none') heads.push({ q: leftLanes.reduce((s2, ln) => s2 + ln.lat, 0) / leftLanes.length, kind: leftKind })
          const lats = others.map((ln) => ln.lat)
          if (lats.length >= 3 || !heads.length) {
            // two round heads (a road always has at least two signal faces)
            const lo = lats.length > 1 ? lats[0] : lats[0] - 1.3, hi = lats.length > 1 ? lats[lats.length - 1] : lats[0] + 1.3
            heads.push({ q: lo, kind: 'ball' }, { q: hi, kind: 'ball' })
          } else heads.push({ q: lats.reduce((s2, v) => s2 + v, 0) / lats.length, kind: 'ball' })
        }
        for (const { q, kind: hk } of heads) {
          const yc = 6.5
          // the five-light head: the round lights hang half a head to the right, the two arrows beside their lower two lights
          const qb = hk === 'dog' ? q + 0.21 * HS : q
          const [hx, hz] = P(uf, qb)
          // hanger from the arm to the head
          const armY = top - 0.28 + ((midQ - q) / (midQ - endQ)) * 0.16
          tube([hx, armY, hz], [hx, yc + 0.66 * HS, hz], 0.04, 0.04, POLE, 6)
          signalHead(hx, hz, yc, ox, oz, hk === 'arrow')
          for (let l = 0; l < 3; l++) lamps.push({ x: hx + ox * HEAD_LAMP, y: yc + lensY[l], z: hz + oz * HEAD_LAMP, yaw, node: n, axis, l, arrow: hk === 'arrow' })
          if (hk === 'dog') {
            const [ax2, az2] = P(uf, qb - 0.4 * HS)
            solid.box(ax2 - ox * 0.12, yc + lensY[2] - 0.21 * HS, az2 - oz * 0.12, 0.4 * HS, 0.84 * HS, 0.3, yaw, [0.03, 0.032, 0.03])
            for (let l = 1; l < 3; l++) lamps.push({ x: ax2 + ox * HEAD_LAMP, y: yc + lensY[l], z: az2 + oz * HEAD_LAMP, yaw, node: n, axis, l, arrow: true })
          }
        }
        // "NO TURN ON RED" on the mast arm beside the right-hand signal
        if (noTurnOnRed(n, a % 2)) {
          // big, beside the right-hand signal at signal height...
          const [nx2, nz2] = P(uf, lanesHere[lanesHere.length - 1].lat + 2.4)
          signQuad(nx2 + ox * 0.15, 6.6, nz2 + oz * 0.15, 1.5, 1.85, face, SIGN.noRed)
          // ...and again at eye level on the right-hand roadside, just before the stop line, where you wait
          const ur = clr + 6
          const [rx2, rz2] = P(ur, HWat(ur) + 1.6)
          post(rx2, rz2, 3.0, 0.1)
          signQuad(rx2 + ox * 0.09, 2.15, rz2 + oz * 0.09, 1.2, 1.48, face, SIGN.noRed)
        }
        // far-left corner pole: a second head, seen from the right-hand lanes too
        const [lx, lz] = P(uf, -qEdge)
        tube([lx, 0.3, lz], [lx, 6.2, lz], 0.2, 0.12, POLE, 12)
        tube([lx, 0, lz], [lx, 0.35, lz], 0.34, 0.26, [0.4, 0.41, 0.44], 12)
        signalHead(lx, lz, 4.5, ox, oz)
        for (let l = 0; l < 3; l++) lamps.push({ x: lx + ox * HEAD_LAMP, y: 4.5 + lensY[l], z: lz + oz * HEAD_LAMP, yaw, node: n, axis, l, arrow: false })
        // junctions without a left arrow: "LEFT TURN YIELD ON GREEN" on the mast arm over the left lane
        if (!hasLeftArrow(n, a % 2)) {
          const [ysx, ysz] = P(uf, lanesHere[0].lat)
          signQuad(ysx + ox * 0.16, 9.05, ysz + oz * 0.16, 0.8, 0.98, face, SIGN.leftYield)
        }
        // street-name blade on the mast arm
        const [nx, nz] = P(uf, qEdge * 0.62)
        signQuad(nx + ox * 0.15, 8.8, nz + oz * 0.15, 2.2, 1.1, face, PLATE(crossIdx))
      } else {
        // give way + roundabout signs at the entry, chevrons on the island
        const rsp = rbSpec(i, j)!
        const [yx, yz] = P(clr + 2.5, HW + 1.7 + (rsp.splitter ? rbShift(2.5) : 0))
        post(yx, yz, 3.9)
        signQuad(yx + ox * 0.08, 2.6, yz + oz * 0.08, 1.4, 1.4, face, SIGN.yield)
        signQuad(yx + ox * 0.08, 4.0, yz + oz * 0.08, 1.2, 1.2, face, SIGN.rbMust)
        if (rsp.signals) {
          const axis = a % 2 === 0 ? 0 : 1
          const lensY = HEAD_LENSY
          const uh = clr + 18.5
          const sh = rbShift(18.5)
          for (const q of [HALF_MID + sh + 1.3, 0]) {
            const [hx, hz] = P(uh, q)
            tube([hx, 0, hz], [hx, 6.1, hz], 0.2, 0.12, POLE, 10)
            signalHead(hx, hz, 4.4, ox, oz)
            for (let l = 0; l < 3; l++) lamps.push({ x: hx + ox * HEAD_LAMP, y: 4.4 + lensY[l], z: hz + oz * HEAD_LAMP, yaw, node: n, axis, l, arrow: false })
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

  // ---------------- side streets off the centre-turn-lane avenue (no signals: stop, then turn) ----------------
  if (stubsOn()) {
    const acx = nodeX(CENTRE_COL)
    const hw = HALF_MID + LANE_W / 2 // the avenue's half-width there
    for (let j = 0; j < G; j++) for (const sg of [-1, 1]) {
      const zc = stubZ(j)
      const X = (q: number) => acx + sg * q
      // the street, then its car park
      asphalt.rect(Math.min(X(hw - 0.2), X(STUB.end)), zc - STUB.half, Math.max(X(hw - 0.2), X(STUB.end)), zc + STUB.half, 0, [1, 1, 1])
      asphalt.rect(Math.min(X(STUB.lot0), X(STUB.lot1)), zc - STUB.lotHalf, Math.max(X(STUB.lot0), X(STUB.lot1)), zc + STUB.lotHalf, 0, [1, 1, 1])
      const q = (q0: number, z0: number, q1: number, z1: number, col: V3) => marks.upQuad([[X(q0), z0], [X(q1), z0], [X(q1), z1], [X(q0), z1]], 0.02, col)
      // edge lines, a broken yellow centre line and a stop line where the street meets the avenue (on the side of traffic coming out)
      for (const e of [-1, 1]) q(hw + 0.6, zc + e * (STUB.half - 0.35), STUB.lot0, zc + e * (STUB.half - 0.15), WHITE)
      for (let u = hw + 6; u + 2 < STUB.lot0; u += 5) q(u, zc - 0.07, u + 2, zc + 0.07, YELLOW)
      const outSide = sg === 1 ? -1 : 1 // cars drive on the right: leaving the east street they are on its north half, the west street its south half
      q(hw + 1.2, zc + (outSide === 1 ? 0.3 : -STUB.half + 0.4), hw + 1.8, zc + (outSide === 1 ? STUB.half - 0.4 : -0.3), WHITE)
      // parking bays down both sides of the car park
      for (const e of [-1, 1]) for (let u = STUB.lot0 + 2; u < STUB.lot1 - 1; u += 2.8) q(u, zc + e * (STUB.lotHalf - 5.5), u + 0.12, zc + e * (STUB.lotHalf - 0.6), WHITE)
      // a give-way sign facing the driver coming out
      const sx = X(hw + 2.6), sz = zc + outSide * (STUB.half + 1.2)
      post(sx, sz, 2.4)
      signQuad(sx + sg * 0.08, 2.2, sz, 0.95, 0.95, [sg, 0], SIGN.yield)
    }
  }

  // ---------------- the highway entrance (Mixed course) ----------------
  if (LAYOUT.kind === 'mixed') {
    const { pts } = rampLine()
    const side = (k: number, off: number): V2 => {
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)]
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1
      return [pts[k][0] - (dz / l) * off, pts[k][1] + (dx / l) * off] // + = right of the direction of travel
    }
    for (let k = 1; k < pts.length; k++) {
      asphalt.upQuad([side(k - 1, -RAMP_HALF), side(k, -RAMP_HALF), side(k, RAMP_HALF), side(k - 1, RAMP_HALF)], 0.004, [1, 1, 1])
      // edge lines: the outer one all along; the inner one only once the ramp has left the road (a broken line beside the road before that)
      marks.upQuad([side(k - 1, RAMP_HALF - 0.35), side(k, RAMP_HALF - 0.35), side(k, RAMP_HALF - 0.15), side(k - 1, RAMP_HALF - 0.15)], 0.024, WHITE)
      if (k > 10) marks.upQuad([side(k - 1, -RAMP_HALF + 0.15), side(k, -RAMP_HALF + 0.15), side(k, -RAMP_HALF + 0.35), side(k - 1, -RAMP_HALF + 0.35)], 0.024, WHITE)
      else if (k > 3 && k % 2 === 0) marks.upQuad([side(k - 1, -RAMP_HALF + 0.1), side(k, -RAMP_HALF + 0.1), side(k, -RAMP_HALF + 0.3), side(k - 1, -RAMP_HALF + 0.3)], 0.024, WHITE)
    }
    // guide signs: one in advance, one at the point where the ramp leaves (both face eastbound traffic)
    const cx = nodeX(RAMP_I)
    for (const [u, big] of [[RAMP_AT - 62, 2.6], [RAMP_AT + 14, 2.2]] as Array<[number, number]>) {
      const zEdge = u < RAMP_AT ? pts[0][1] + 2.4 : pts[11][1] + RAMP_HALF + 2.5 // on the verge beside the road / beside the ramp
      post(cx + u, zEdge, 3.4 + big / 2, 0.12)
      signQuad(cx + u - 0.1, 2.4 + big / 2, zEdge, big, big, [-1, 0], SIGN.hwEntrance)
    }
  }

  // ---------------- blocks: plazas, buildings, parks ----------------
  for (const l of LOTS) {
    if (l.empty) continue
    if (l.park) {
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
        trees.push({ x: l.x0 + 8 + a * 18 + hashN(l.x0, a, b) * 5, z: l.z0 + 8 + b * 18 + hashN(l.z0, b, a) * 5, s: 0.9 + hashN(a, b, l.x0) * 0.6 })
      }
      continue
    }
    if (l.res) {
      // residential block: the houses line the streets (see above); the middle of the block is back gardens with trees
      for (let k = 0; k < 4; k++) trees.push({ x: l.x0 + (l.x1 - l.x0) * (0.25 + hashN(l.x0, l.z0, k) * 0.5), z: l.z0 + (l.z1 - l.z0) * (0.25 + hashN(l.z0, l.x0, k + 5) * 0.5), s: 0.8 + hashN(l.x0 + k, l.z0, 9) * 0.5 })
      continue
    }
    solid.box((l.x0 + l.x1) / 2, 0, (l.z0 + l.z1) / 2, l.x1 - l.x0, 0.08, l.z1 - l.z0, 0, [0.55, 0.56, 0.58])
    const bw = l.bx1 - l.bx0, bd = l.bz1 - l.bz0, bcx = (l.bx0 + l.bx1) / 2, bcz = (l.bz0 + l.bz1) / 2
    buildings.box(bcx, 0.08, bcz, bw, l.h, bd, 0, l.color, true)
    solid.box(bcx, 0.08, bcz, bw + 2, 5, bd + 2, 0, [0.3, 0.31, 0.33]) // dark podium / shopfront band
    solid.box(bcx, 0.08 + l.h, bcz, bw * 0.3, 2.2, bd * 0.3, 0, [0.42, 0.43, 0.45]) // roof plant
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
