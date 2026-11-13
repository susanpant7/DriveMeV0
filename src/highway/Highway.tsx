import { useEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useGame } from '../game/store'
import {
  ACC_LEN, HW, LANE, MEDIAN_X, NB_EDGE_L, NB_EDGE_R, NB_SHOULDER_L, NB_X, NL, RAMP_K, SB_EDGE_IN, SB_EDGE_OUT, SHOULDER_R, TAPER, Z_FINISH, Z_TOP,
  auxAt, auxEdge, dropLane, edgeL, edgeR, forkShift, paveL, paveR, rampU, rampX, rampZ0, rampZ1, routeId, splitX, strips, type Ramp, type Route,
} from './layout'

type V3 = [number, number, number]
const CHUNK = 200
const chunkOf = (z: number) => Math.floor((z - Z_FINISH + 100) / CHUNK)
const NCH = Math.ceil((Z_TOP - Z_FINISH + 300) / CHUNK) + 1

/** geometry collected per 200 m chunk so only the stretch you can see is drawn */
class Buf {
  pos: number[][] = Array.from({ length: NCH }, () => [])
  nor: number[][] = Array.from({ length: NCH }, () => [])
  uv: number[][] = Array.from({ length: NCH }, () => [])
  col: number[][] = Array.from({ length: NCH }, () => [])
  tri(a: V3, b: V3, c: V3, n: V3, color: V3) {
    const k = Math.max(0, Math.min(NCH - 1, chunkOf((a[2] + b[2] + c[2]) / 3)))
    ;[a, b, c].forEach((p) => {
      this.pos[k].push(p[0], p[1], p[2])
      this.nor[k].push(n[0], n[1], n[2])
      this.uv[k].push(p[0] / 4, p[2] / 4)
      this.col[k].push(color[0], color[1], color[2])
    })
  }
  flat(a: [number, number], b: [number, number], c: [number, number], d: [number, number], y: number, color: V3) {
    const A: V3 = [a[0], y, a[1]], B: V3 = [b[0], y, b[1]], C: V3 = [c[0], y, c[1]], D: V3 = [d[0], y, d[1]]
    const up: V3 = [0, 1, 0]
    this.tri(A, B, C, up, color)
    this.tri(A, C, D, up, color)
  }
  box(x: number, y0: number, z: number, w: number, h: number, d: number, color: V3) {
    const x0 = x - w / 2, x1 = x + w / 2, y1 = y0 + h, z0 = z - d / 2, z1 = z + d / 2
    const q = (a: V3, b: V3, c: V3, dd: V3, n: V3, shade = 1) => {
      const col: V3 = [color[0] * shade, color[1] * shade, color[2] * shade]
      this.tri(a, b, c, n, col)
      this.tri(a, c, dd, n, col)
    }
    q([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], 1)
    q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], 0.85)
    q([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], 0.85)
    q([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], 0.75)
    q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], 0.75)
  }
  build(): THREE.BufferGeometry[] {
    const out: THREE.BufferGeometry[] = []
    for (let k = 0; k < NCH; k++) {
      if (!this.pos[k].length) continue
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos[k], 3))
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor[k], 3))
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv[k], 2))
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.col[k], 3))
      g.computeBoundingSphere()
      out.push(g)
    }
    return out
  }
}

const WHITE: V3 = [0.9, 0.9, 0.88]
const YELLOW: V3 = [0.95, 0.74, 0.1]
const GUARD: V3 = [0.62, 0.64, 0.67]
const POST: V3 = [0.45, 0.46, 0.48]
const BARRIER: V3 = [0.6, 0.6, 0.6]
const STEEL: V3 = [0.55, 0.57, 0.6]

function strip(buf: Buf, z0: number, z1: number, step: number, edges: (z: number) => [number, number], y: number, color: V3) {
  for (let z = z0; z > z1 + 0.001; z -= step) {
    const zn = Math.max(z - step, z1)
    const [al, ar] = edges(z)
    const [bl, br] = edges(zn)
    buf.flat([al, z], [ar, z], [br, zn], [bl, zn], y, color)
  }
}
/** a line of constant width along an x(z) path; dashes optional */
function line(buf: Buf, z0: number, z1: number, xAt: (z: number) => number, w: number, color: V3, dash?: [number, number], step = 6) {
  const y = 0.02
  if (!dash) {
    for (let z = z0; z > z1 + 0.001; z -= step) {
      const zn = Math.max(z - step, z1)
      buf.flat([xAt(z) - w / 2, z], [xAt(z) + w / 2, z], [xAt(zn) + w / 2, zn], [xAt(zn) - w / 2, zn], y, color)
    }
    return
  }
  const [on, off] = dash
  for (let z = z0; z > z1 + 0.001; z -= on + off) {
    const ze = Math.max(z - on, z1)
    buf.flat([xAt(z) - w / 2, z], [xAt(z) + w / 2, z], [xAt(ze) + w / 2, ze], [xAt(ze) - w / 2, ze], y, color)
  }
}
const inRamp = (r: Ramp, z: number) => z <= rampZ0(r) && z >= rampZ1(r)

/** where the overpasses go: clear of every ramp */
function overpassZs() {
  const out: number[] = []
  for (const oz of [1700, 900, -300, -1200, -2100, -3000]) if (!HW.s.ramps.some((r) => oz < rampZ0(r) + 60 && oz > rampZ1(r) - 60) && !(HW.s.fork && Math.abs(oz - HW.s.fork.z + 100) < 260)) out.push(oz)
  return out.slice(0, 3)
}

export function buildHighway() {
  const s = HW.s
  const asphalt = new Buf(), marks = new Buf(), solid = new Buf()
  const ASPH: V3 = [1, 1, 1]

  // ---- pavement ----
  for (const st of strips()) strip(asphalt, st.z0, st.z1, 10, (z) => [st.l(z), st.r(z)], 0, ASPH)

  // ---- markings ----
  // the left edge (yellow) and the right edge (white) follow a lane that ends; where an extra lane runs beside the highway the edge is a
  // wide dashed line instead (the extra lane's own edge is solid)
  const auxR = (z: number) => auxAt(1, z), auxL = (z: number) => auxAt(-1, z)
  for (let z = Z_TOP; z > Z_FINISH; z -= 6) {
    const zn = z - 6, zm = z - 3
    const seg = (xAt: (z: number) => number, w: number, col: V3, dashed: boolean) => {
      const ze = dashed ? z - 3 : zn
      if (dashed && Math.floor(z / 6) % 2) return
      marks.flat([xAt(z) - w / 2, z], [xAt(z) + w / 2, z], [xAt(ze) + w / 2, ze], [xAt(ze) - w / 2, ze], 0.02, col)
    }
    // right side
    const ar = auxR(zm)
    if (ar && rampU(ar, zm) < -2) { seg(() => NB_EDGE_R, 0.3, WHITE, true); seg((zz) => auxEdge(ar, zz), 0.18, WHITE, false) }
    else seg(edgeR, 0.18, WHITE, false)
    // left side
    const al = auxL(zm)
    if (al && rampU(al, zm) < -2) { seg(() => NB_EDGE_L, 0.3, WHITE, true); seg((zz) => auxEdge(al, zz), 0.18, YELLOW, false) }
    else seg(edgeL, 0.18, YELLOW, false)
  }
  // lane dividers (a lane that ends loses its divider where it tapers; a split turns the divider between the branches into two solid edges)
  const f = s.fork
  for (let k = 1; k < NL; k++) {
    const x = NB_EDGE_L + k * LANE
    const shiftK = (z: number) => (f && k > f.split ? forkShift(z) : 0)
    const dropHere = (k === 1 && dropLane() === 0) || (k === NL - 1 && dropLane() === NL - 1)
    const zEndDash = dropHere && s.drop ? s.drop.z0 : Z_FINISH // (where the lane starts to taper the edge line takes over)
    if (f && k === f.split) {
      line(marks, Z_TOP, f.z + 300, () => x, 0.15, WHITE, [3, 9])
      line(marks, f.z + 300, f.z, () => x, 0.3, WHITE, [3, 3]) // wide dotted: the lanes are about to part
      line(marks, f.z, Z_FINISH, () => x - 0.3, 0.18, WHITE, undefined, 12)
      line(marks, f.z, Z_FINISH, (z) => x + forkShift(z) + 0.3, 0.18, YELLOW, undefined, 12)
      for (let z = f.z; z > f.z - 60; z -= 6) marks.flat([x - 0.3, z], [x + 0.3 + forkShift(z - 3), z - 3], [x + 0.5 + forkShift(z - 3), z - 3], [x - 0.1, z], 0.02, WHITE)
    } else {
      // where the lane beside a dropping lane is nearly gone the line becomes the new edge (drawn above), so the dashes stop there
      line(marks, Z_TOP, zEndDash, (z) => x + shiftK(z), 0.15, WHITE, [3, 9])
    }
  }
  // the lane that ends: chevrons across it where it tapers away
  if (s.drop) {
    const d = s.drop
    for (let z = d.z0 - 20; z > d.z1 + 10; z -= 1.8) {
      if (d.side === 1) marks.flat([edgeR(z) - 0.2, z], [edgeR(z) - 0.75, z], [edgeR(z - 0.9) - 0.75, z - 0.9], [edgeR(z - 0.9) - 0.2, z - 0.9], 0.02, WHITE)
      else marks.flat([edgeL(z) + 0.2, z], [edgeL(z) + 0.75, z], [edgeL(z - 0.9) + 0.75, z - 0.9], [edgeL(z - 0.9) + 0.2, z - 0.9], 0.02, YELLOW)
    }
    // lane-reduction arrows painted in the ending lane
    const lx = d.side === 1 ? NB_X[NL - 1] : NB_X[0]
    for (const z of [d.z0 + 160, d.z0 + 40]) {
      const sgn = -d.side
      marks.flat([lx - 0.15, z], [lx + 0.15, z], [lx + 0.15 + sgn * 0.9, z - 5], [lx - 0.15 + sgn * 0.9, z - 5], 0.02, WHITE)
      marks.flat([lx + sgn * 0.4, z - 4.2], [lx + sgn * 1.6, z - 5.2], [lx + sgn * 0.9, z - 6.8], [lx + sgn * 0.9, z - 6.8], 0.02, WHITE)
    }
  }
  // ramps: their own edges (yellow on the left, white on the right), and the gore where they meet the highway
  for (const r of s.ramps) {
    const [a, b] = r.kind === 'on' ? [r.g + r.len + 5, r.g - 2] : [r.g + 2, r.g - r.len - 5]
    line(marks, a, b, (z) => rampX(r, z) - (LANE / 2) * RAMP_K, 0.18, r.side === 1 ? YELLOW : WHITE, undefined, 8)
    line(marks, a, b, (z) => rampX(r, z) + (LANE / 2) * RAMP_K, 0.18, r.side === 1 ? WHITE : YELLOW, undefined, 8)
    // gore chevrons in the triangle between the ramp and the highway
    const inner = (z: number) => rampX(r, z) - r.side * (LANE / 2) * RAMP_K
    const hwEdge = r.side === 1 ? NB_EDGE_R : NB_EDGE_L
    for (let u = 6; u < 150; u += 7) {
      const z = r.kind === 'on' ? r.g + u : r.g - u
      const zz = r.kind === 'on' ? z + 2.5 : z - 2.5
      const xa = hwEdge + r.side * 0.2, xb = inner(z) - r.side * 0.2
      if ((xb - xa) * r.side < 0.4) continue
      marks.flat([xa, z], [xb, zz], [xb, zz + (r.kind === 'on' ? 0.6 : -0.6)], [xa, z + (r.kind === 'on' ? 0.6 : -0.6)], 0.02, WHITE)
    }
    // painted arrows in the extra lane: on an entrance, pointing into the highway; on an exit, the "exit only" arrows
    const ax = r.side === 1 ? NB_X[NL - 1] + LANE : NB_X[0] - LANE
    for (const u of r.kind === 'on' ? [-60, -220] : [-300, -150]) {
      const z = r.kind === 'on' ? r.g + u : r.g - u
      if (r.kind === 'on') {
        const sgn = -r.side
        marks.flat([ax - 0.15, z], [ax + 0.15, z], [ax + 0.15 + sgn * 0.9, z - 5], [ax - 0.15 + sgn * 0.9, z - 5], 0.02, WHITE)
        marks.flat([ax + sgn * 0.4, z - 4.2], [ax + sgn * 1.6, z - 5.2], [ax + sgn * 0.9, z - 6.8], [ax + sgn * 0.9, z - 6.8], 0.02, WHITE)
      } else {
        marks.flat([ax - 0.15, z], [ax + 0.15, z], [ax + 0.15, z - 4], [ax - 0.15, z - 4], 0.02, WHITE)
        marks.flat([ax - 0.6, z - 4], [ax + 0.6, z - 4], [ax, z - 6.2], [ax, z - 6.2], 0.02, WHITE)
      }
    }
  }
  // the other carriageway (scenery): white right edge, dashed dividers, yellow left edge
  const so = s.sbOff
  line(marks, Z_TOP, Z_FINISH, () => SB_EDGE_OUT + so, 0.18, WHITE, undefined, 40)
  for (const x of [-12.85, -16.55]) line(marks, Z_TOP, Z_FINISH, () => x + so, 0.15, WHITE, [3, 9])
  line(marks, Z_TOP, Z_FINISH, () => SB_EDGE_IN + so, 0.18, YELLOW, undefined, 40)

  // ---- barriers and guard rails ----
  const rail = (z0: number, z1: number, xOf: (z: number) => number, skip?: (z: number) => boolean) => {
    for (let z = z0; z > z1; z -= 4) {
      if (skip && skip(z)) continue
      const px = xOf(z)
      solid.box(px, 0, z, 0.08, 0.2, 4.0, GUARD)
      solid.box(px, 0.45, z, 0.08, 0.2, 4.0, GUARD)
      solid.box(px, 0, z - 2, 0.1, 0.8, 0.1, POST)
    }
  }
  const nearRampSide = (side: 1 | -1) => (z: number) => s.ramps.some((r) => r.side === side && z < rampZ0(r) + 8 && z > rampZ1(r) - 8)
  if (so === 0) for (let z = Z_TOP; z > Z_FINISH; z -= 6) { if (!nearRampSide(-1)(z)) solid.box(MEDIAN_X, 0, z, 0.55, 0.85, 6.0, BARRIER) }
  else { rail(Z_TOP, Z_FINISH, (z) => paveL(z) - 0.4, nearRampSide(-1)); rail(Z_TOP, Z_FINISH, () => SB_EDGE_IN + so + NB_SHOULDER_L + 0.4) }
  rail(Z_TOP, Z_FINISH, (z) => paveR(z) + 0.4, (z) => nearRampSide(1)(z) || (!!f && z < f.z && z > f.z - 400))
  if (f) {
    rail(f.z - 400, Z_FINISH, (z) => paveR(z) + 0.4)
    for (let z = f.z - 30; z > f.z - FORK_SPAN; z -= 6) solid.box(splitX() + forkShift(z) / 2, 0, z, 0.5, 0.8, 6, BARRIER)
  }
  // the outer side of each ramp
  for (const r of s.ramps) {
    const [a, b] = r.kind === 'on' ? [r.g + r.len, r.g + 120] : [r.g - 120, r.g - r.len]
    rail(a, b, (z) => rampX(r, z) + r.side * ((LANE / 2 + 2.4) * RAMP_K + 0.4))
  }
  rail(Z_TOP, Z_FINISH, () => SB_EDGE_OUT + so - SHOULDER_R - 0.4)
  // cross-road overpasses: a deck on pillars over the whole highway, with parapets and a road on top
  for (const oz of overpassZs()) {
    const x0 = SB_EDGE_OUT + so - 16, x1 = paveR(oz) + 30, w = x1 - x0, cx = (x0 + x1) / 2
    solid.box(cx, 5.6, oz, w, 1.1, 16, [0.58, 0.58, 0.6])
    solid.box(cx, 6.7, oz - 7.6, w, 0.9, 0.4, [0.62, 0.62, 0.64])
    solid.box(cx, 6.7, oz + 7.6, w, 0.9, 0.4, [0.62, 0.62, 0.64])
    asphalt.flat([x0, oz + 7.2], [x1, oz + 7.2], [x1, oz - 7.2], [x0, oz - 7.2], 6.7, ASPH)
    marks.flat([x0, oz + 0.1], [x1, oz + 0.1], [x1, oz - 0.1], [x0, oz - 0.1], 6.72, YELLOW)
    const pillars = [SB_EDGE_OUT + so - SHOULDER_R - 3, paveL(oz) - 2.2, paveR(oz) + 2.5]
    if (so !== 0) pillars.push(SB_EDGE_IN + so + 3)
    for (const px of pillars) solid.box(px, 0, oz, 1.1, 5.6, 3, [0.6, 0.6, 0.62])
  }
  // sign gantries (the structure; the faces are drawn with the signs)
  for (const g of gantries()) {
    const xl = g.x0 - 1.4, xr = g.x1 + 1.4
    for (const px of [xl, xr]) solid.box(px, 0, g.z - 0.5, 0.45, 9.4, 0.45, STEEL)
    for (const y of [6.3, 8.6]) solid.box((xl + xr) / 2, y, g.z - 0.6, xr - xl, 0.3, 0.3, STEEL)
  }
  return { asphalt: asphalt.build(), marks: marks.build(), solid: solid.build() }
}
const FORK_SPAN = 40 / 0.22

/* ================================ signs ================================ */
/**
 * Real-looking US highway signs, drawn for each stage: overhead guide signs on gantries (with the exit tab, route shields, the direction,
 * the city, the distance, and yellow EXIT ONLY panels with an arrow over each lane), the exit sign in the gore, warning signs for merging
 * traffic and lanes that end, and the speed limit.
 */
type Draw = (g: CanvasRenderingContext2D, W: number, H: number) => void
interface Sign { x: number; y: number; z: number; w: number; h: number; draw: Draw; post?: 'one' | 'two' }
const PX = 72 // texture pixels per metre
const FONT = '"Arial Narrow", "Roboto Condensed", "Helvetica Neue", Arial, sans-serif'
const GREEN = '#00653a'

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { g.beginPath(); g.roundRect(x, y, w, h, r) }
function fitText(g: CanvasRenderingContext2D, t: string, x: number, y: number, size: number, maxW: number, weight = 700) {
  g.font = `${weight} ${size}px ${FONT}`
  const w = g.measureText(t).width
  if (w > maxW) g.font = `${weight} ${Math.floor((size * maxW) / w)}px ${FONT}`
  g.fillText(t, x, y)
}
/** a route shield: Interstate (red and blue), US route (white, black outline) or state route (white on green) */
function shield(g: CanvasRenderingContext2D, r: Route, cx: number, cy: number, S: number) {
  g.save(); g.translate(cx, cy)
  g.textAlign = 'center'; g.textBaseline = 'middle'
  if (r.shield === 'I') {
    const path = () => { g.beginPath(); g.moveTo(-S * 0.5, -S * 0.42); g.quadraticCurveTo(0, -S * 0.56, S * 0.5, -S * 0.42); g.bezierCurveTo(S * 0.55, S * 0.05, S * 0.35, S * 0.38, 0, S * 0.52); g.bezierCurveTo(-S * 0.35, S * 0.38, -S * 0.55, S * 0.05, -S * 0.5, -S * 0.42); g.closePath() }
    g.fillStyle = '#fff'; path(); g.fill()
    g.save(); g.scale(0.88, 0.88); path(); g.clip()
    g.fillStyle = '#003f87'; g.fillRect(-S, -S, 2 * S, 2 * S)
    g.fillStyle = '#c8102e'; g.fillRect(-S, -S, 2 * S, S * 0.75)
    g.fillStyle = '#fff'; g.font = `700 ${S * 0.13}px ${FONT}`; g.fillText('INTERSTATE', 0, -S * 0.33)
    g.restore()
    g.fillStyle = '#fff'; fitText(g, r.num, 0, S * 0.12, S * 0.46, S * 0.75)
  } else if (r.shield === 'US') {
    g.fillStyle = '#000'; roundRect(g, -S * 0.5, -S * 0.5, S, S, S * 0.06); g.fill()
    const path = () => { g.beginPath(); g.moveTo(-S * 0.42, -S * 0.42); g.lineTo(S * 0.42, -S * 0.42); g.bezierCurveTo(S * 0.46, -S * 0.1, S * 0.38, S * 0.3, 0, S * 0.44); g.bezierCurveTo(-S * 0.38, S * 0.3, -S * 0.46, -S * 0.1, -S * 0.42, -S * 0.42); g.closePath() }
    g.fillStyle = '#fff'; path(); g.fill()
    g.fillStyle = '#000'; fitText(g, r.num, 0, -S * 0.02, S * 0.42, S * 0.7)
  } else {
    g.fillStyle = '#fff'; roundRect(g, -S * 0.45, -S * 0.45, S * 0.9, S * 0.9, S * 0.2); g.fill()
    g.fillStyle = GREEN; roundRect(g, -S * 0.38, -S * 0.38, S * 0.76, S * 0.76, S * 0.15); g.fill()
    g.fillStyle = '#fff'; fitText(g, r.num, 0, S * 0.02, S * 0.4, S * 0.62)
  }
  g.restore()
}
/** a green guide panel with a white border; an optional exit tab on top (left or right) */
function panel(g: CanvasRenderingContext2D, W: number, H: number, tab?: { text: string; side: 'left' | 'right'; yellow?: string }) {
  const tabH = tab ? H * 0.2 : 0
  const b = Math.max(6, W * 0.012)
  if (tab) {
    const tw = W * 0.42, tx = tab.side === 'right' ? W - tw : 0
    g.fillStyle = GREEN; roundRect(g, tx, 0, tw, tabH + b * 2, b * 2); g.fill()
    g.strokeStyle = '#fff'; g.lineWidth = b * 0.7; roundRect(g, tx + b * 0.8, b * 0.8, tw - b * 1.6, tabH + b * 2, b * 1.5); g.stroke()
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; fitText(g, tab.text, tx + tw / 2, tabH * 0.58, tabH * 0.72, tw * 0.85)
    if (tab.yellow) { // LEFT EXIT: a yellow plate beside the tab
      const yw = W * 0.3, yx = tab.side === 'left' ? tw + b : W - tw - yw - b
      g.fillStyle = '#f7c600'; roundRect(g, yx, b, yw, tabH, b); g.fill()
      g.fillStyle = '#000'; fitText(g, tab.yellow, yx + yw / 2, tabH * 0.58, tabH * 0.65, yw * 0.85)
    }
  }
  g.fillStyle = GREEN; roundRect(g, 0, tabH, W, H - tabH, b * 2); g.fill()
  g.strokeStyle = '#fff'; g.lineWidth = b * 0.7; roundRect(g, b * 0.8, tabH + b * 0.8, W - b * 1.6, H - tabH - b * 1.6, b * 1.5); g.stroke()
  return tabH
}
/** a white arrow pointing down (over a lane), up (straight on) or up and to one side (an exit) */
function arrow(g: CanvasRenderingContext2D, x: number, y: number, S: number, dir: 'down' | 'up' | 'upR' | 'upL', col = '#fff') {
  g.save(); g.translate(x, y)
  g.rotate(dir === 'down' ? Math.PI : dir === 'upR' ? Math.PI / 4 : dir === 'upL' ? -Math.PI / 4 : 0)
  g.fillStyle = col
  g.beginPath()
  g.moveTo(0, -S * 0.5); g.lineTo(S * 0.32, -S * 0.12); g.lineTo(S * 0.1, -S * 0.12); g.lineTo(S * 0.1, S * 0.5); g.lineTo(-S * 0.1, S * 0.5); g.lineTo(-S * 0.1, -S * 0.12); g.lineTo(-S * 0.32, -S * 0.12)
  g.closePath(); g.fill()
  g.restore()
}
/** shield, direction and city stacked in the middle of a guide sign */
function routeBlock(g: CanvasRenderingContext2D, r: Route, cx: number, top: number, W: number, H: number) {
  g.textAlign = 'center'; g.textBaseline = 'middle'
  const S = Math.min(H * 0.46, W * 0.3)
  // the shield and the direction side by side, centred together
  g.font = `700 ${S * 0.5}px ${FONT}`
  const gap = S * 0.18
  const tw = Math.min(g.measureText(r.dir).width, W * 0.9 - S - gap)
  const x0 = cx - (S + gap + tw) / 2
  shield(g, r, x0 + S / 2, top + S * 0.58, S)
  g.fillStyle = '#fff'; g.textAlign = 'left'; fitText(g, r.dir, x0 + S + gap, top + S * 0.6, S * 0.5, tw)
  g.textAlign = 'center'; fitText(g, r.city, cx, top + S * 1.42, S * 0.44, W * 0.9, 700)
  return top + S * 1.78
}
/** the yellow EXIT ONLY band at the foot of a guide sign, with an arrow over each lane that must leave */
function exitOnly(g: CanvasRenderingContext2D, W: number, H: number, lanes: number[], label = 'EXIT ONLY') {
  const bh = H * 0.24
  const b = Math.max(6, W * 0.012)
  g.fillStyle = '#f7c600'; roundRect(g, b * 2, H - bh - b * 2, W - b * 4, bh, b); g.fill()
  g.fillStyle = '#000'; g.textAlign = 'center'; g.textBaseline = 'middle'
  const n = lanes.length
  if (n === 1) {
    arrow(g, W * 0.18, H - bh / 2 - b * 2, bh * 0.82, 'down', '#000')
    fitText(g, label, W * 0.55, H - bh / 2 - b * 2, bh * 0.62, W * 0.55)
  } else {
    lanes.forEach((_, i) => arrow(g, (W * (i + 0.5)) / n, H - bh / 2 - b * 2, bh * 0.82, 'down', '#000'))
    // the words go between the arrows
    if (n === 2) fitText(g, label, W / 2, H - bh / 2 - b * 2, bh * 0.6, W / 2 - bh)
    else for (let i = 0; i < n - 1; i++) fitText(g, i % 2 ? 'ONLY' : 'EXIT', (W * (i + 1)) / n, H - bh / 2 - b * 2, bh * 0.55, W / n - bh)
  }
  return H - bh - b * 2
}
function diamond(text: string[]): Draw {
  return (g, W, H) => {
    g.fillStyle = '#f7c600'; g.strokeStyle = '#111'; g.lineWidth = W * 0.035
    g.beginPath(); g.moveTo(W / 2, 2); g.lineTo(W - 2, H / 2); g.lineTo(W / 2, H - 2); g.lineTo(2, H / 2); g.closePath(); g.fill()
    g.beginPath(); g.moveTo(W / 2, W * 0.06); g.lineTo(W - W * 0.06, H / 2); g.lineTo(W / 2, H - W * 0.06); g.lineTo(W * 0.06, H / 2); g.closePath(); g.stroke()
    g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'
    text.forEach((t, i) => fitText(g, t, W / 2, H / 2 + (i - (text.length - 1) / 2) * H * 0.15, H * 0.13, W * 0.56))
  }
}
const whiteSign = (lines: Array<[string, number]>): Draw => (g, W, H) => {
  g.fillStyle = '#fff'; roundRect(g, 0, 0, W, H, W * 0.05); g.fill()
  g.strokeStyle = '#111'; g.lineWidth = W * 0.025; roundRect(g, W * 0.03, W * 0.03, W - W * 0.06, H - W * 0.06, W * 0.04); g.stroke()
  g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle'
  let y = H * 0.08
  const tot = lines.reduce((a, [, s]) => a + s, 0)
  for (const [t, sz] of lines) { const hh = (H * 0.84 * sz) / tot; fitText(g, t, W / 2, y + hh / 2, hh * 0.78, W * 0.86); y += hh }
}

interface Gantry { z: number; x0: number; x1: number }
/** the two places a decision is signed overhead: 1/2 mile before, and where the lanes part */
function gantries(): Gantry[] {
  const s = HW.s, out: Gantry[] = []
  const take = s.ramps.find((r) => r.take)
  if (take) for (const z of [take.g + ACC_LEN + 800, take.g + ACC_LEN - TAPER - 30]) out.push({ z, x0: Math.min(NB_EDGE_L, paveL(z) + 1), x1: Math.max(NB_EDGE_R, paveR(z) - 1) })
  if (s.fork) for (const z of [s.fork.z + 900, s.fork.z + 260]) out.push({ z, x0: NB_EDGE_L, x1: NB_EDGE_R })
  return out
}
const laneSpan = (a: number, b: number) => ({ x: (NB_X[a] + NB_X[b]) / 2, w: (b - a + 1) * LANE - 0.5 })

function stageSigns(): Sign[] {
  const s = HW.s
  const out: Sign[] = []
  const ROAD = s.road
  const right = (z: number) => paveR(z) + 2.6
  const left = (z: number) => paveL(z) - 2.6
  const side = (sd: 1 | -1) => (sd === 1 ? right : left)
  const guideH = 4.2, gy = 5.4

  // the entrance you start on: where it leads, the ramp speed, and MERGE where it joins
  for (const r of s.ramps.filter((r) => r.player)) {
    const z0 = r.g + r.len
    const rx = (z: number) => rampX(r, z) + r.side * ((LANE / 2 + 2.4) * RAMP_K + 1.6)
    out.push({ x: rx(z0 - 90), y: 1.8, z: z0 - 90, w: 3.6, h: 3.0, post: 'two', draw: (g, W, H) => { panel(g, W, H); routeBlock(g, ROAD, W / 2, H * 0.08, W, H) } })
    out.push({ x: rx(r.g + 160), y: 1.6, z: r.g + 160, w: 2.1, h: 2.1, post: 'one', draw: diamond(['MERGE']) })
  }
  // other entrances: a warning for traffic on the highway
  for (const r of s.ramps.filter((r) => r.kind === 'on' && !r.player)) {
    out.push({ x: side(r.side)(r.g + 380), y: 1.6, z: r.g + 380, w: 2.1, h: 2.1, post: 'one', draw: diamond(['MERGING', 'TRAFFIC']) })
    out.push({ x: rampX(r, r.g + 200) + r.side * 6, y: 1.6, z: r.g + 200, w: 2.1, h: 2.1, post: 'one', draw: diamond(['MERGE']) })
  }
  // exits
  for (const r of s.ramps.filter((r) => r.kind === 'off')) {
    const label = `EXIT ${r.exit}`
    const tabSide = r.side === 1 ? 'right' : 'left'
    const yellow = r.side === -1 ? 'LEFT' : undefined
    const dest = r.to ? routeId(r.to) + ' ' + r.to.dir : r.name ?? ''
    if (!r.take) {
      // a local exit: a big sign beside the road 1/2 mile and 1/4 mile before
      for (const [dz, dist] of [[800, '1/2 MILE'], [400, '1/4 MILE']] as const) {
        const z = r.g + ACC_LEN + dz
        if (z > Z_TOP - 20) continue
        out.push({ x: side(r.side)(z) + r.side * 2, y: 2.0, z, w: 6.4, h: 4.0, post: 'two', draw: (g, W, H) => {
          const t = panel(g, W, H, { text: label, side: tabSide, yellow })
          g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'
          fitText(g, dest, W / 2, t + (H - t) * 0.33, (H - t) * 0.3, W * 0.86)
          fitText(g, dist, W / 2, t + (H - t) * 0.72, (H - t) * 0.24, W * 0.7)
        } })
      }
    }
    // the exit sign in the gore, where the ramp leaves
    const zg = r.g - 200
    const gx = ((r.side === 1 ? edgeR(zg) + SHOULDER_R : edgeL(zg) - NB_SHOULDER_L) + rampX(r, zg) - r.side * (LANE / 2 + 1.2) * RAMP_K) / 2
    out.push({ x: gx, y: 1.6, z: zg, w: 2.6, h: 1.8, post: 'two', draw: (g, W, H) => {
      panel(g, W, H)
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'
      fitText(g, 'EXIT', W * 0.5, H * 0.3, H * 0.3, W * 0.6)
      fitText(g, String(r.exit), W * 0.5, H * 0.66, H * 0.34, W * 0.6)
      arrow(g, r.side === 1 ? W * 0.84 : W * 0.16, H * 0.5, H * 0.5, r.side === 1 ? 'upR' : 'upL')
    } })
    // the exit you are to take: overhead signs (1/2 mile before, and over the exit lane where it begins)
    if (r.take) {
      const [g1, g2] = gantries()
      const edgeLane = r.side === 1 ? NL - 1 : 0
      const sp = laneSpan(edgeLane, edgeLane)
      const auxX = r.side === 1 ? NB_X[NL - 1] + LANE : NB_X[0] - LANE
      const drawDest = (g: CanvasRenderingContext2D, W: number, _H: number, top: number, bottom: number) => {
        if (r.to) return routeBlock(g, r.to, W / 2, top + (bottom - top) * 0.04, W, (bottom - top) * 1.05)
        g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'
        fitText(g, dest, W / 2, top + (bottom - top) * 0.4, (bottom - top) * 0.32, W * 0.86)
        return 0
      }
      // 1/2 mile: over the right (or left) lane, with the distance
      out.push({ x: sp.x + r.side * 1.2, y: gy, z: g1.z, w: 6.2, h: guideH, draw: (g, W, H) => {
        const t = panel(g, W, H, { text: label, side: tabSide, yellow })
        drawDest(g, W, H, t, H * 0.78)
        g.fillStyle = '#fff'; fitText(g, '1/2 MILE', W / 2, H * 0.88, H * 0.12, W * 0.6)
      } })
      // and what the highway itself leads to, over the other lanes
      const thru = r.side === 1 ? laneSpan(0, NL - 2) : laneSpan(1, NL - 1)
      out.push({ x: thru.x, y: gy, z: g1.z, w: 7.2, h: guideH * 0.8, draw: (g, W, H) => { panel(g, W, H); routeBlock(g, ROAD, W / 2, H * 0.06, W, H * 1.05) } })
      // where the exit lane begins: EXIT ONLY over it
      out.push({ x: auxX, y: gy, z: g2.z, w: 5.4, h: guideH + 0.6, draw: (g, W, H) => {
        const t = panel(g, W, H, { text: label, side: tabSide, yellow })
        const bot = exitOnly(g, W, H, [0])
        drawDest(g, W, H, t, bot)
      } })
      out.push({ x: thru.x, y: gy, z: g2.z, w: 7.2, h: guideH * 0.8, draw: (g, W, H) => {
        panel(g, W, H)
        const n = NL - 1
        const bot = routeBlock(g, ROAD, W / 2, H * 0.04, W, H * 0.68)
        for (let i = 0; i < n; i++) arrow(g, (W * (i + 0.5)) / n, (bot + H) / 2 - H * 0.02, H * 0.24, 'down')
      } })
    }
  }
  // the split: overhead signs for both branches; the branch that leaves the highway is EXIT ONLY
  if (s.fork) {
    const fk = s.fork
    const [g1, g2] = gantries().slice(-2)
    const L = laneSpan(0, fk.split - 1), Rr = laneSpan(fk.split, NL - 1)
    const lanesL = Array.from({ length: fk.split }, (_, i) => i), lanesR = Array.from({ length: NL - fk.split }, (_, i) => fk.split + i)
    for (const [gz, dist] of [[g1.z, true], [g2.z, false]] as const) {
      for (const [br, sp, lanes, side] of [[fk.left, L, lanesL, 'left'], [fk.right, Rr, lanesR, 'right']] as const) {
        const only = fk.exitOnly === side
        out.push({ x: sp.x, y: gy, z: gz, w: sp.w, h: guideH + (only ? 0.7 : 0), draw: (g, W, H) => {
          const t = only ? panel(g, W, H, { text: `EXIT ${30 + (s.id % 50)}`, side: side === 'right' ? 'right' : 'left', yellow: side === 'left' ? 'LEFT' : undefined }) : panel(g, W, H)
          const bot = only ? exitOnly(g, W, H, lanes as number[]) : H
          const end = routeBlock(g, br, W / 2, t + (bot - t) * 0.03, W, (bot - t) * (dist ? 0.82 : only ? 0.95 : 0.7))
          g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'
          if (dist) fitText(g, '1/2 MILE', W / 2, (end + bot) / 2, (bot - end) * 0.55, W * 0.6)
          else if (!only) (lanes as number[]).forEach((_, i) => arrow(g, (W * (i + 0.5)) / lanes.length, (end + bot) / 2, Math.max(H * 0.16, (bot - end) * 0.8), 'down'))
        } })
      }
    }
  }
  // a lane that ends
  if (s.drop) {
    const d = s.drop
    const word = d.side === 1 ? 'RIGHT' : 'LEFT'
    const other = d.side === 1 ? 'LEFT' : 'RIGHT'
    const at = side(d.side)
    out.push({ x: at(d.z0 + 700), y: 1.6, z: d.z0 + 700, w: 2.2, h: 2.2, post: 'one', draw: diamond([word, 'LANE', 'ENDS']) })
    out.push({ x: at(d.z0 + 400), y: 1.6, z: d.z0 + 400, w: 2.4, h: 2.8, post: 'two', draw: whiteSign([[`${word} LANE`, 1], ['ENDS', 1], [`MERGE ${other}`, 1]]) })
    out.push({ x: at(d.z0 + 150), y: 1.6, z: d.z0 + 150, w: 2.2, h: 2.2, post: 'one', draw: diamond(['LANE', 'ENDS', `MERGE ${other}`]) })
  }
  // speed limits, KEEP RIGHT, and a shield to tell you which highway you are on
  for (let z = 900; z > Z_FINISH + 200; z -= 1100) {
    if (s.ramps.some((r) => r.side === 1 && z < rampZ0(r) + 40 && z > rampZ1(r) - 40)) continue
    out.push({ x: right(z), y: 1.6, z, w: 1.4, h: 1.75, post: 'one', draw: whiteSign([['SPEED', 1], ['LIMIT', 1], ['70', 2.3]]) })
  }
  {
    const z = 300
    if (!s.ramps.some((r) => r.side === 1 && z < rampZ0(r) + 40 && z > rampZ1(r) - 40)) out.push({ x: right(z), y: 1.6, z, w: 1.5, h: 1.9, post: 'one', draw: whiteSign([['SLOWER', 1], ['TRAFFIC', 1], ['KEEP', 1], ['RIGHT', 1]]) })
  }
  for (const z of [s.start.z - 350, -1100]) {
    if (s.ramps.some((r) => r.side === 1 && z < rampZ0(r) + 40 && z > rampZ1(r) - 40)) continue
    if (z > Z_TOP - 50 || z < Z_FINISH + 100) continue
    out.push({ x: right(z), y: 1.6, z, w: 1.3, h: 1.6, post: 'one', draw: (g, W, H) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, W, H * 0.3)
      g.fillStyle = '#000'; g.textAlign = 'center'; g.textBaseline = 'middle'; fitText(g, ROAD.dir, W / 2, H * 0.16, H * 0.2, W * 0.9)
      g.fillStyle = '#fff'; g.fillRect(0, H * 0.3, W, H * 0.7)
      shield(g, ROAD, W / 2, H * 0.65, Math.min(W, H * 0.68))
    } })
  }
  return out
}

/** pack the sign faces into one texture and make a quad for each (facing you as you drive north) */
function signMesh(items: Sign[], maxAniso: number) {
  // shelf packing into a 2048-wide atlas
  const AW = 2048
  let x = 0, y = 0, rowH = 0
  const boxes = items.map((it) => {
    let w = Math.round(it.w * PX), h = Math.round(it.h * PX)
    if (w > AW - 4) { const k = (AW - 4) / w; w = Math.floor(w * k); h = Math.floor(h * k) }
    if (x + w + 4 > AW) { x = 0; y += rowH + 4; rowH = 0 }
    const b = { x, y, w, h }
    x += w + 4
    rowH = Math.max(rowH, h)
    return b
  })
  const AH = Math.min(4096, 1 << Math.ceil(Math.log2(Math.max(64, y + rowH + 4))))
  const c = document.createElement('canvas')
  c.width = AW; c.height = AH
  const g = c.getContext('2d')!
  items.forEach((it, i) => { const b = boxes[i]; g.save(); g.translate(b.x, b.y); g.beginPath(); g.rect(0, 0, b.w, b.h); g.clip(); it.draw(g, b.w, b.h); g.restore() })
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = Math.min(8, maxAniso)
  tex.generateMipmaps = true
  tex.minFilter = THREE.LinearMipmapLinearFilter
  const pos: number[] = [], uv: number[] = [], nor: number[] = [], idx: number[] = []
  const posts: Array<[number, number, number]> = [] // x, z, height
  items.forEach((it, i) => {
    const b = boxes[i]
    const u0 = b.x / AW, u1 = (b.x + b.w) / AW, v0 = 1 - (b.y + b.h) / AH, v1 = 1 - b.y / AH
    const x0 = it.x - it.w / 2, x1 = it.x + it.w / 2, y0 = it.y, y1 = it.y + it.h
    pos.push(x0, y0, it.z, x1, y0, it.z, x1, y1, it.z, x0, y1, it.z)
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1)
    for (let k = 0; k < 4; k++) nor.push(0, 0, 1)
    idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3)
    if (it.post === 'one') posts.push([it.x, it.z, it.y + it.h * 0.9])
    else if (it.post === 'two') { posts.push([x0 + it.w * 0.2, it.z, it.y + it.h * 0.9]); posts.push([x1 - it.w * 0.2, it.z, it.y + it.h * 0.9]) }
  })
  // a grey back on every sign
  const n0 = items.length * 4
  items.forEach((it, i) => {
    const x0 = it.x - it.w / 2, x1 = it.x + it.w / 2, y0 = it.y, y1 = it.y + it.h, z = it.z - 0.03
    pos.push(x1, y0, z, x0, y0, z, x0, y1, z, x1, y1, z)
    for (let k = 0; k < 4; k++) { uv.push(1, 0); nor.push(0, 0, -1) }
    const o = n0 + i * 4
    idx.push(o, o + 1, o + 2, o, o + 2, o + 3)
  })
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  geo.setIndex(idx)
  geo.addGroup(0, items.length * 6, 0)
  geo.addGroup(items.length * 6, items.length * 6, 1)
  return { geo, tex, posts }
}

/** The stage being driven, drawn in 200 m chunks. Rebuilt whenever a new stage begins. */
export function Highway() {
  const maxAniso = useThree((s) => s.gl.capabilities.getMaxAnisotropy())
  const version = useGame((s) => s.hwVersion)
  const data = useMemo(() => buildHighway(), [version])
  const res = useMemo(() => {
    const loader = new THREE.TextureLoader()
    const load = (name: string, srgb: boolean) => {
      const t = loader.load(`/tex/asphalt_${name}.jpg`)
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.anisotropy = Math.min(8, maxAniso)
      if (srgb) t.colorSpace = THREE.SRGBColorSpace
      return t
    }
    return {
      asphalt: new THREE.MeshStandardMaterial({ map: load('diff', true), normalMap: load('nor_gl', false), roughnessMap: load('rough', false), color: '#85858a', normalScale: new THREE.Vector2(1.3, 1.3) }),
      marks: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.1 }),
      back: new THREE.MeshStandardMaterial({ color: '#8a8f96', roughness: 0.6, metalness: 0.5 }),
    }
  }, [maxAniso])
  useEffect(() => () => { res.asphalt.map?.dispose() }, [res])
  useEffect(() => () => { [...data.asphalt, ...data.marks, ...data.solid].forEach((g) => g.dispose()) }, [data])

  const signs = useMemo(() => {
    const m = signMesh(stageSigns(), maxAniso)
    // (signs are lit like everything else, but never darker than they would be in daylight: retroreflective sheeting)
    const face = new THREE.MeshStandardMaterial({ map: m.tex, alphaTest: 0.5, roughness: 0.6, emissive: '#ffffff', emissiveMap: m.tex, emissiveIntensity: 0.18 })
    return { ...m, face }
  }, [version, maxAniso])
  useEffect(() => () => { signs.geo.dispose(); signs.tex.dispose(); signs.face.dispose() }, [signs])

  // trees on both sides, kept well clear of every road and ramp
  const trees = useMemo(() => {
    const out: Array<[number, number, number]> = []
    let seed = 7 + version
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const all = strips()
    const clear = (tx: number, tz: number) => !all.some((st) => tz <= st.z0 + 12 && tz >= st.z1 - 12 && tx > st.l(tz) - 9 && tx < st.r(tz) + 9)
    const so = HW.s.sbOff
    for (let z = Z_TOP; z > Z_FINISH; z -= 14 + rnd() * 16) {
      const cand: Array<[number, number, number]> = [
        [paveR(z) + 12 + rnd() * 60, z + rnd() * 6, 0.8 + rnd() * 0.9],
        [SB_EDGE_OUT + so - SHOULDER_R - 8 - rnd() * 50, z + rnd() * 6, 0.8 + rnd() * 0.9],
        [paveR(z) + 40 + rnd() * 70, z + rnd() * 6, 0.8 + rnd() * 0.9],
      ]
      if (so !== 0) cand.push([paveL(z) - 10 - rnd() * 60, z, 0.8 + rnd() * 0.9])
      for (const t of cand) if (clear(t[0], t[1])) out.push(t)
    }
    return out
  }, [version])
  const treeMesh = useMemo(() => {
    const trunk = new THREE.CylinderGeometry(0.22, 0.3, 3, 6); trunk.translate(0, 1.5, 0)
    const crown = new THREE.IcosahedronGeometry(2.4, 0); crown.translate(0, 4.6, 0)
    const m1 = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: '#4a3524', roughness: 1 }), Math.max(1, trees.length))
    const m2 = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ color: '#2f6b2f', roughness: 0.95, flatShading: true }), Math.max(1, trees.length))
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3()
    trees.forEach(([x, z, k], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 1.7)
      m.compose(p.set(x, 0, z), q, sc.set(k, k, k))
      m1.setMatrixAt(i, m)
      m2.setMatrixAt(i, m)
    })
    m1.count = m2.count = trees.length
    m1.frustumCulled = m2.frustumCulled = false
    return [m1, m2]
  }, [trees])
  useEffect(() => () => { treeMesh.forEach((m) => { m.geometry.dispose(); (m.material as THREE.Material).dispose() }) }, [treeMesh])
  const postMesh = useMemo(() => {
    const g = new THREE.BoxGeometry(0.12, 1, 0.12); g.translate(0, 0.5, 0)
    const m = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: '#6c7077', roughness: 0.6, metalness: 0.4 }), Math.max(1, signs.posts.length))
    const mat = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3(), q = new THREE.Quaternion()
    signs.posts.forEach(([x, z, h], i) => { mat.compose(p.set(x, 0, z - 0.06), q, s.set(1, h, 1)); m.setMatrixAt(i, mat) })
    m.count = signs.posts.length
    m.frustumCulled = false
    return m
  }, [signs])
  useEffect(() => () => { postMesh.geometry.dispose(); (postMesh.material as THREE.Material).dispose() }, [postMesh])

  return (
    <group>
      {data.asphalt.map((g, i) => <mesh key={'a' + i} geometry={g} material={res.asphalt} receiveShadow />)}
      {data.marks.map((g, i) => <mesh key={'m' + i} geometry={g} material={res.marks} renderOrder={1} />)}
      {data.solid.map((g, i) => <mesh key={'s' + i} geometry={g} material={res.solid} />)}
      <mesh geometry={signs.geo} material={[signs.face, res.back]} />
      <primitive object={postMesh} />
      <primitive object={treeMesh[0]} />
      <primitive object={treeMesh[1]} />
    </group>
  )
}
void inRamp
