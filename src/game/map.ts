/**
 * The city: a 4x4 grid of nodes (junctions) joined by two-way roads, repeated forever
 * (the world wraps every P metres). Right-hand traffic. Pure data + geometry helpers,
 * no rendering. Coordinates: x east, z south (top-down map has north up, so north = -z).
 */

export const B = 200 // distance between junction centres
export const G = 4 // junctions per side before the map repeats
export const P = B * G // period of the world
export const LANE_W = 3.5
export const LANES = 3 // lanes in each direction
export const HALF_ROAD = LANES * LANE_W // 10.5: half the width of the asphalt
export const BOX = 11 // half size of a signalled junction
export const RING_R = 28 // roundabout lane centre radius
export const RING_OUT = 34 // roundabout outer edge
export const ISLAND_R = 23 // central island
export const DELTA = (15 * Math.PI) / 180

/** Direction indices: 0 = east, 1 = north, 2 = west, 3 = south (counter-clockwise on the map). */
export const DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [0, -1], [-1, 0], [0, 1]]
export const dirv = (d: number) => DIRS[((d % 4) + 4) % 4]

export const mod = (a: number, n: number) => ((a % n) + n) % n
/** wrap a coordinate difference into [-P/2, P/2) so "nearest copy" maths works */
export const wrapD = (d: number) => mod(d + P / 2, P) - P / 2
export const nodeIndex = (i: number, j: number) => mod(i, G) * G + mod(j, G)
export const nodeIJ = (n: number): [number, number] => [Math.floor(n / G), n % G]
export type NodeKind = 'round' | 'signal'
export const nodeKind = (i: number, j: number): NodeKind => (mod(i, G) % 2 === 0 && mod(j, G) % 2 === 0 ? 'round' : 'signal')
export const clearance = (i: number, j: number) => (nodeKind(i, j) === 'round' ? RING_OUT : BOX)
export const laneOff = (k: number) => LANE_W / 2 + LANE_W * k
export const aiOff = laneOff

export const VERTICAL_NAMES = ['Oak St', 'Elm Ave', 'Pine Rd', 'Maple St']
export const HORIZONTAL_NAMES = ['1st Ave', '2nd Ave', '3rd Ave', '4th Ave']

/* ------------------------------------------------------------------ */
/* Lane pieces: the paths AI cars follow                               */
/* ------------------------------------------------------------------ */

export interface Piece {
  id: number
  kind: 'edge' | 'conn' | 'ring'
  x: number[]
  z: number[]
  cum: number[]
  len: number
  vmax: number
  node: number // node this piece leads into (edge) or lies in (conn / ring)
  arm: number // edge: arrival arm; conn: entry / exit arm; ring: arm at the segment end
  lane: number
  toKind?: NodeKind
  axis?: 0 | 1 // signalled approach: 0 = east-west, 1 = north-south
  entry?: boolean
  exit?: boolean
  ringType?: 'between' | 'pass'
  aiOk?: boolean // may AI cars use this lane?
}

export const PIECES: Piece[] = []
export const EDGE_IDS: number[] = []
export const LINKS = {
  edgeOut: new Map<string, number>(),
  connS: new Map<string, number>(),
  connR: new Map<string, number>(),
  entryC: new Map<string, number>(),
  exitC: new Map<string, number>(),
  ringPass: new Map<string, number>(),
  ringBetween: new Map<string, number>(),
}

type Pt = [number, number]

function addPiece(kind: Piece['kind'], pts: Pt[], vmax: number, extra: Partial<Piece>): number {
  const x: number[] = []
  const z: number[] = []
  const cum: number[] = [0]
  pts.forEach(([px, pz], i) => {
    x.push(px)
    z.push(pz)
    if (i) cum.push(cum[i - 1] + Math.hypot(px - pts[i - 1][0], pz - pts[i - 1][1]))
  })
  const id = PIECES.length
  PIECES.push({ id, kind, x, z, cum, len: cum[cum.length - 1], vmax, node: -1, arm: 0, lane: 0, ...extra })
  return id
}

const bez3 = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, n: number): Pt[] => {
  const out: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ])
  }
  return out
}
const bez2 = (p0: Pt, p1: Pt, p2: Pt, n: number): Pt[] => {
  const out: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]])
  }
  return out
}
const ringPt = (cx: number, cz: number, th: number, r = RING_R): Pt => [cx + r * Math.cos(th), cz - r * Math.sin(th)]
const ringTan = (th: number): Pt => [-Math.sin(th), -Math.cos(th)] // counter-clockwise travel

function arc(cx: number, cz: number, t0: number, t1: number): Pt[] {
  const n = Math.max(2, Math.ceil((RING_R * (t1 - t0)) / 2))
  const pts: Pt[] = []
  for (let i = 0; i <= n; i++) pts.push(ringPt(cx, cz, t0 + ((t1 - t0) * i) / n))
  return pts
}

function buildPieces() {
  for (let i = 0; i < G; i++) {
    for (let j = 0; j < G; j++) {
      const n = nodeIndex(i, j)
      const cx = i * B
      const cz = j * B
      const kind = nodeKind(i, j)

      // roads leaving this node in each direction
      for (let d = 0; d < 4; d++) {
        const [dx, dz] = dirv(d)
        const [rx, rz] = dirv(d - 1)
        const ni = i + dx
        const nj = j + dz
        const clrA = clearance(i, j)
        const clrB = clearance(ni, nj)
        const toKind = nodeKind(ni, nj)
        const arrive = (d + 2) % 4
        // roads whose junctions are all signalled can carry traffic in every lane; roads that meet a
        // roundabout every other junction only use the outer lane (roundabout entries are single-lane)
        const allSignal = d % 2 === 0 ? mod(j, 2) === 1 : mod(i, 2) === 1
        for (let k = 0; k < LANES; k++) {
          const o = aiOff(k)
          const a: Pt = [cx + dx * clrA + rx * o, cz + dz * clrA + rz * o]
          const b: Pt = [cx + dx * (B - clrB) + rx * o, cz + dz * (B - clrB) + rz * o]
          const aiOk = allSignal || k === LANES - 1
          const id = addPiece('edge', [a, b], 14, {
            node: nodeIndex(ni, nj), arm: arrive, lane: k, toKind, axis: arrive % 2 === 0 ? 0 : 1, aiOk,
          })
          LINKS.edgeOut.set(`${n}:${d}:${k}`, id)
          if (aiOk) EDGE_IDS.push(id)
        }
      }

      if (kind === 'signal') {
        for (let a = 0; a < 4; a++) {
          const t = (a + 2) % 4 // travel direction of cars arriving via arm a
          const [ox, oz] = dirv(a)
          const [lx, lz] = dirv(a + 1)
          for (let k = 0; k < LANES; k++) {
            const o = aiOff(k)
            const E: Pt = [cx + ox * BOX + lx * o, cz + oz * BOX + lz * o]
            // straight (inner lanes never run toward a roundabout, so no connector is needed there)
            const [sx, sz] = dirv(t)
            const [srx, srz] = dirv(t - 1)
            const Xs: Pt = [cx + sx * BOX + srx * o, cz + sz * BOX + srz * o]
            if (!(nodeKind(i + sx, j + sz) === 'round' && k < LANES - 1)) {
              LINKS.connS.set(`${n}:${a}:${k}`, addPiece('conn', [E, Xs], 13, { node: n, arm: t, lane: k }))
            }
            // right turn (outer lane to outer lane)
            if (k === LANES - 1) {
              const e = (t + 3) % 4
              const [ex, ez] = dirv(e)
              const [erx, erz] = dirv(e - 1)
              const Xr: Pt = [cx + ex * BOX + erx * o, cz + ez * BOX + erz * o]
              const ctrl: Pt = sz === 0 ? [Xr[0], E[1]] : [E[0], Xr[1]]
              LINKS.connR.set(`${n}:${a}:${k}`, addPiece('conn', bez2(E, ctrl, Xr, 12), 6.5, { node: n, arm: e, lane: k }))
            }
          }
        }
      } else {
        for (let d = 0; d < 4; d++) {
          const th = (d * Math.PI) / 2
          const [ox, oz] = dirv(d)
          const [lx, lz] = dirv(d + 1)
          const [rx, rz] = dirv(d - 1)
          const t = (d + 2) % 4
          const [tx, tz] = dirv(t)
          for (let k = LANES - 1; k < LANES; k++) {
            const o = aiOff(k)
            {
            // entry: arm lane end -> ring at (arm angle + DELTA)
            const P0: Pt = [cx + ox * RING_OUT + lx * o, cz + oz * RING_OUT + lz * o]
            const P3 = ringPt(cx, cz, th + DELTA)
            const tg = ringTan(th + DELTA)
            const h1 = 0.45 * Math.hypot(P3[0] - P0[0], P3[1] - P0[1])
            LINKS.entryC.set(`${n}:${d}:${k}`, addPiece('conn', bez3(P0, [P0[0] + tx * h1, P0[1] + tz * h1], [P3[0] - tg[0] * h1, P3[1] - tg[1] * h1], P3, 14), 6.5, { node: n, arm: d, lane: k, entry: true }))
            }
            // exit: ring at (arm angle - DELTA) -> arm lane start
            const Q0 = ringPt(cx, cz, th - DELTA)
            const tq = ringTan(th - DELTA)
            const Q3: Pt = [cx + ox * RING_OUT + rx * o, cz + oz * RING_OUT + rz * o]
            const h = 0.45 * Math.hypot(Q3[0] - Q0[0], Q3[1] - Q0[1])
            LINKS.exitC.set(`${n}:${d}:${k}`, addPiece('conn', bez3(Q0, [Q0[0] + tq[0] * h, Q0[1] + tq[1] * h], [Q3[0] - ox * h, Q3[1] - oz * h], Q3, 14), 6.5, { node: n, arm: d, lane: k, exit: true }))
          }
          // ring: pass arm d (exit_d -> entry_d), between d and d+1 (entry_d -> exit_{d+1})
          LINKS.ringPass.set(`${n}:${d}`, addPiece('ring', arc(cx, cz, th - DELTA, th + DELTA), 7, { node: n, arm: d, ringType: 'pass' }))
          LINKS.ringBetween.set(`${n}:${d}`, addPiece('ring', arc(cx, cz, th + DELTA, th + Math.PI / 2 - DELTA), 7, { node: n, arm: (d + 1) % 4, ringType: 'between' }))
        }
      }
    }
  }
}
buildPieces()

/** Position and unit direction at distance `s` along a piece. */
export function pieceAt(p: Piece, s: number, out: { x: number; z: number; dx: number; dz: number }) {
  const { x, z, cum } = p
  if (s < 0) s = 0
  if (s > p.len) s = p.len
  let i = 1
  while (i < cum.length - 1 && cum[i] < s) i++
  const seg = cum[i] - cum[i - 1] || 1
  const t = (s - cum[i - 1]) / seg
  out.x = x[i - 1] + (x[i] - x[i - 1]) * t
  out.z = z[i - 1] + (z[i] - z[i - 1]) * t
  const dx = x[i] - x[i - 1]
  const dz = z[i] - z[i - 1]
  const l = Math.hypot(dx, dz) || 1
  out.dx = dx / l
  out.dz = dz / l
}

/* ------------------------------------------------------------------ */
/* Traffic signals                                                     */
/* ------------------------------------------------------------------ */

export const CYCLE = 40
const nodeOffset = (n: number) => ((((Math.sin(n * 91.7) * 43758.5453) % 1) + 1) % 1) * CYCLE
/** 0 = green, 1 = amber, 2 = red. axis 1 = north-south approaches, 0 = east-west. */
export function signalColor(node: number, axis: 0 | 1, t: number): 0 | 1 | 2 {
  const ph = mod(t + nodeOffset(node), CYCLE)
  const a = axis === 1 ? ph : mod(ph - 20, CYCLE)
  return a < 15 ? 0 : a < 18 ? 1 : 2
}

/* ------------------------------------------------------------------ */
/* Buildings                                                           */
/* ------------------------------------------------------------------ */

export interface Lot {
  x0: number
  z0: number
  x1: number
  z1: number // lot / plaza rectangle
  bx0: number
  bz0: number
  bx1: number
  bz1: number // building footprint
  h: number
  color: [number, number, number]
  park: boolean
}

const hash = (a: number, b: number, c = 0) => {
  const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453
  return x - Math.floor(x)
}
export const hashN = hash

const PALETTE: Array<[number, number, number]> = [
  [0.82, 0.76, 0.68], [0.72, 0.62, 0.55], [0.62, 0.66, 0.72], [0.78, 0.78, 0.76],
  [0.66, 0.5, 0.44], [0.55, 0.6, 0.55], [0.85, 0.82, 0.72], [0.5, 0.55, 0.65],
]

function buildLots(): Lot[] {
  const lots: Lot[] = []
  for (let i = 0; i < G; i++) {
    for (let j = 0; j < G; j++) {
      const bx0 = i * B + HALF_ROAD + 5
      const bz0 = j * B + HALF_ROAD + 5
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) {
          const x0 = bx0 + a * 56 + 3.5
          const z0 = bz0 + b * 56 + 3.5
          const x1 = x0 + 50
          const z1 = z0 + 50
          let park = hash(i * 3 + a, j * 3 + b) < 0.16
          for (const [ci, cj] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]]) {
            if (nodeKind(ci, cj) !== 'round') continue
            const cx = ci * B
            const cz = cj * B
            const dx = Math.max(x0 - cx, 0, cx - x1)
            const dz = Math.max(z0 - cz, 0, cz - z1)
            if (Math.hypot(dx, dz) < RING_OUT + 10) park = true
          }
          const inset = 3 + hash(i * 3 + a, j * 3 + b, 1) * 6
          lots.push({
            x0, z0, x1, z1,
            bx0: x0 + inset, bz0: z0 + inset, bx1: x1 - inset, bz1: z1 - inset,
            h: 10 + hash(i * 3 + a, j * 3 + b, 2) * 38,
            color: PALETTE[Math.floor(hash(i * 3 + a, j * 3 + b, 3) * PALETTE.length)],
            park,
          })
        }
      }
    }
  }
  return lots
}
export const LOTS = buildLots()

/** Is this point (any world coordinates) inside a building? */
export function insideBuilding(x: number, z: number) {
  const xm = mod(x, P)
  const zm = mod(z, P)
  // lots are laid out per block: index them directly
  const i = Math.floor(xm / B)
  const j = Math.floor(zm / B)
  for (let k = 0; k < 9; k++) {
    const l = LOTS[(i * G + j) * 9 + k]
    if (!l.park && xm > l.bx0 && xm < l.bx1 && zm > l.bz0 && zm < l.bz1) return true
  }
  return false
}

/* ------------------------------------------------------------------ */
/* Queries for the player                                              */
/* ------------------------------------------------------------------ */

export function nearestNode(x: number, z: number) {
  const i = Math.round(x / B)
  const j = Math.round(z / B)
  const cx = i * B
  const cz = j * B
  return { i, j, n: nodeIndex(i, j), cx, cz, kind: nodeKind(i, j), rx: x - cx, rz: z - cz }
}

export function onAsphalt(x: number, z: number) {
  const xm = mod(x + B / 2, B) - B / 2
  const zm = mod(z + B / 2, B) - B / 2
  if (Math.abs(xm) < HALF_ROAD + 0.2 || Math.abs(zm) < HALF_ROAD + 0.2) return true
  const nn = nearestNode(x, z)
  if (nn.kind === 'round') {
    const r = Math.hypot(nn.rx, nn.rz)
    if (r < RING_OUT && r > ISLAND_R) return true
  }
  return false
}

export function inIsland(x: number, z: number) {
  const nn = nearestNode(x, z)
  return nn.kind === 'round' && Math.hypot(nn.rx, nn.rz) < ISLAND_R - 0.3
}
