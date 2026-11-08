/**
 * The city: a 4x4 grid of nodes (junctions) joined by two-way roads, repeated forever
 * (the world wraps every P metres). Right-hand traffic. Pure data + geometry helpers,
 * no rendering. Coordinates: x east, z south (top-down map has north up, so north = -z).
 */

export const B = 200 // distance between junction centres
export const G = 4 // junctions per side before the map repeats
export const P = B * G // period of the world
export const LANE_W = 4.1 // 13.5 ft: a generous arterial lane (US standard is 11-12 ft)
export const LANES = 3 // lanes in each direction at a signalised junction approach
export const LANES_MID = 2 // lanes in each direction on an ordinary stretch of road
export const HALF_MID = LANES_MID * LANE_W // half the width of the ordinary 2-lane road
export const HALF_ROAD = LANES * LANE_W // half the width where a third (turn) lane is added
export const FLARE = 80 // length of the full 3-lane section before a signalised junction
export const TAPER = 30 // the road widens from 2 to 3 lanes over this distance
/** how far the road has widened (0..1) at distance d before the junction's edge */
/**
 * Roundabout entrances flare outward so each lane keeps its full width beside the splitter island.
 * [distance from the ring, half-width of the island there (= how far each lane has shifted outward)]
 */
export const RB_ISLAND: ReadonlyArray<readonly [number, number]> = [[0.6, 1.9], [9, 1.55], [20, 0.7], [29, 0.15], [30, 0]]
export function rbShift(d: number) {
  if (d <= RB_ISLAND[0][0]) return RB_ISLAND[0][1]
  for (let i = 1; i < RB_ISLAND.length; i++) {
    if (d <= RB_ISLAND[i][0]) {
      const [d0, v0] = RB_ISLAND[i - 1]
      const [d1, v1] = RB_ISLAND[i]
      return v0 + ((v1 - v0) * (d - d0)) / (d1 - d0)
    }
  }
  return 0
}
export const RB_SHIFT = RB_ISLAND[0][1]
export const flare = (d: number) => (d <= FLARE ? 1 : d >= FLARE + TAPER ? 0 : 1 - (d - FLARE) / TAPER)
export const BOX = 15 // half size of a signalled junction
export const DELTA = (15 * Math.PI) / 180
export const SPEED_LIMIT = 30 * 0.44704 // 30 mph in m/s

/** Direction indices: 0 = east, 1 = north, 2 = west, 3 = south (counter-clockwise on the map). */
export const DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [0, -1], [-1, 0], [0, 1]]
export const dirv = (d: number) => DIRS[((d % 4) + 4) % 4]

export const mod = (a: number, n: number) => ((a % n) + n) % n

/**
 * Roundabouts with fewer than four exits: the road between a roundabout and its signalised neighbour is removed (the neighbour becomes a
 * T-junction). Each entry is (i, j, d) for a road leaving node (i, j) east (d = 0) or south (d = 3).
 *   roundabout (0,0): 4 exits     (2,0): 3 exits     (0,2): 2 exits     (2,2): 1 exit
 */
const CLOSED_ROADS = new Set(['2,2,0', '2,1,3', '2,2,3', '0,1,3', '0,2,3', '1,0,0'])
/** is the road leaving node (i, j) in direction d (an "arm") closed? */
export function armClosed(i: number, j: number, d: number) {
  const dd = mod(d, 4)
  const [dx, dz] = DIRS[dd]
  return dd === 0 || dd === 3 ? CLOSED_ROADS.has(`${mod(i, G)},${mod(j, G)},${dd}`) : CLOSED_ROADS.has(`${mod(i + dx, G)},${mod(j + dz, G)},${(dd + 2) % 4}`)
}
/** how many exits does the roundabout at (i, j) have? */
export const rbExits = (i: number, j: number) => [0, 1, 2, 3].filter((d) => !armClosed(i, j, d)).length
/** wrap a coordinate difference into [-P/2, P/2) so "nearest copy" maths works */
/** the world repeats every `period` metres (the grid city); a real city does not repeat, so its period is effectively infinite */
export const WORLD_PERIOD = { v: P }
export const wrapD = (d: number) => mod(d + WORLD_PERIOD.v / 2, WORLD_PERIOD.v) - WORLD_PERIOD.v / 2
export const nodeIndex = (i: number, j: number) => mod(i, G) * G + mod(j, G)
export const nodeIJ = (n: number): [number, number] => [Math.floor(n / G), n % G]
export type NodeKind = 'round' | 'signal'
export const nodeKind = (i: number, j: number): NodeKind => (mod(i, G) % 2 === 0 && mod(j, G) % 2 === 0 ? 'round' : 'signal')

/** The roundabout designs. Each of the four roundabouts in the city is a different one. */
export type RbVariant = 'two' | 'signal' | 'single' | 'mini'
export interface RbSpec {
  variant: RbVariant
  label: string
  outer: number // outer radius of the circulating roadway (where the approach roads meet it)
  island: number // radius of the central island
  apron: number // inner edge of the circulating roadway (the truck apron fills island .. apron)
  laneR: number[] // centre radii of the circulating lanes, inner first
  signals: boolean // traffic lights at the entries
  splitter: boolean // raised splitter islands and flared entrances
  aiLanes: number[] // approach lanes (0 = left, 1 = right) that AI cars use
  domed: boolean // a mountable domed island (mini roundabout)
}
export const RB_SPECS: Record<RbVariant, RbSpec> = {
  two: { variant: 'two', label: 'Two-lane roundabout', outer: 46, island: 26.5, apron: 33.5, laneR: [36.5, 42.7], signals: false, splitter: true, aiLanes: [0, 1], domed: false },
  signal: { variant: 'signal', label: 'Signalised roundabout', outer: 50, island: 28, apron: 36.5, laneR: [39.5, 46], signals: true, splitter: true, aiLanes: [0, 1], domed: false },
  single: { variant: 'single', label: 'Single-lane roundabout', outer: 31, island: 17, apron: 21.5, laneR: [26.7], signals: false, splitter: true, aiLanes: [1], domed: false },
  mini: { variant: 'mini', label: 'Mini roundabout', outer: 19, island: 4.5, apron: 5.5, laneR: [12.4], signals: false, splitter: false, aiLanes: [1], domed: true },
}
const RB_AT: Record<string, RbVariant> = { '0,0': 'two', '2,0': 'signal', '0,2': 'two', '2,2': 'two' }
export function rbSpec(i: number, j: number): RbSpec | undefined {
  return nodeKind(i, j) === 'round' ? RB_SPECS[RB_AT[`${mod(i, G)},${mod(j, G)}`] ?? 'two'] : undefined
}
export const rbSpecOfNode = (n: number) => { const [i, j] = nodeIJ(n); return rbSpec(i, j)! }
/** do the lanes flare outward beside a splitter island at this node? */
export const flareOf = (i: number, j: number) => !!rbSpec(i, j)?.splitter
export const ringDelta = (spec: RbSpec, ringLane: number) => {
  const maxO = (spec.laneR.length === 1 ? aiOff(1) : aiOff(ringLane)) + (spec.splitter ? RB_SHIFT : 0)
  return Math.max(0.26, Math.asin(Math.min(0.9, maxO / spec.laneR[ringLane])) + 0.08)
}
export const clearance = (i: number, j: number) => rbSpec(i, j)?.outer ?? BOX
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
  laneFrom?: number // the lane only exists from this distance along the piece (the added turn lane)
  hl?: boolean // cached: can cars in the left lane turn left here?
  aiOk?: boolean // may AI cars use this lane?
  sibs?: number[] // the parallel lanes of the same road, by lane index
}

export const PIECES: Piece[] = []
export const EDGE_IDS: number[] = []
export const LINKS = {
  edgeOut: new Map<string, number>(),
  connS: new Map<string, number>(),
  connR: new Map<string, number>(),
  connL: new Map<string, number>(),
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
const ringPt = (cx: number, cz: number, th: number, r: number): Pt => [cx + r * Math.cos(th), cz - r * Math.sin(th)]
const ringTan = (th: number): Pt => [-Math.sin(th), -Math.cos(th)] // counter-clockwise travel

function arc(cx: number, cz: number, t0: number, t1: number, r: number): Pt[] {
  const n = Math.max(2, Math.ceil((r * (t1 - t0)) / 2))
  const pts: Pt[] = []
  for (let i = 0; i <= n; i++) pts.push(ringPt(cx, cz, t0 + ((t1 - t0) * i) / n, r))
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
        if (armClosed(i, j, d)) continue
        const [dx, dz] = dirv(d)
        const [rx, rz] = dirv(d - 1)
        const ni = i + dx
        const nj = j + dz
        const clrA = clearance(i, j)
        const clrB = clearance(ni, nj)
        const toKind = nodeKind(ni, nj)
        const arrive = (d + 2) % 4
        // Ordinary road: 2 lanes (0 inner, 1 outer). Approaching a signalised junction a third, outer lane (2) is added
        // for right turns. Approaching a roundabout only the outer lane enters it.
        const sibIds: number[] = []
        const segLen = B - clrA - clrB
        // breakpoints along the road where the lane shifts (it follows the splitter island at roundabout ends)
        const bps = new Set<number>([0, segLen])
        const flA = flareOf(i, j), flB = flareOf(ni, nj)
        if (flA) for (const [dd] of RB_ISLAND) if (dd < segLen) bps.add(dd)
        if (flB) for (const [dd] of RB_ISLAND) if (segLen - dd > 0) bps.add(segLen - dd)
        const sorted = [...bps].sort((p, q) => p - q)
        for (let k = 0; k < LANES; k++) {
          const o = aiOff(k)
          const pts: Pt[] = sorted.map((sv) => {
            const off = o + (flA ? rbShift(sv) : 0) + (flB ? rbShift(segLen - sv) : 0)
            return [cx + dx * (clrA + sv) + rx * off, cz + dz * (clrA + sv) + rz * off] as Pt
          })
          const rbB = rbSpec(ni, nj)
          const aiOk = k === LANES - 1 ? toKind === 'signal' : rbB ? rbB.aiLanes.includes(k) : true // the 3rd lane only exists at a signalised junction
          const id = addPiece('edge', pts, 22, {
            node: nodeIndex(ni, nj), arm: arrive, lane: k, toKind, axis: arrive % 2 === 0 ? 0 : 1, aiOk,
          })
          if (k === LANES - 1 && toKind === 'signal') PIECES[id].laneFrom = PIECES[id].len - FLARE
          LINKS.edgeOut.set(`${n}:${d}:${k}`, id)
          sibIds.push(id)
          if (aiOk) EDGE_IDS.push(id)
        }
        sibIds.forEach((id) => (PIECES[id].sibs = sibIds))
      }

      if (kind === 'signal') {
        for (let a = 0; a < 4; a++) {
          if (armClosed(i, j, a)) continue // no road arrives here
          const t = (a + 2) % 4 // travel direction of cars arriving via arm a
          const [ox, oz] = dirv(a)
          const [lx, lz] = dirv(a + 1)
          for (let k = 0; k < LANES; k++) {
            const o = aiOff(k)
            const E: Pt = [cx + ox * BOX + lx * o, cz + oz * BOX + lz * o]
            // straight: lanes 0 and 1 carry on in their own lane (lane 0 only toward a signalised exit); the added right-turn
            // lane (2) only turns right, but a driver who goes straight from it merges into lane 1
            const [sx, sz] = dirv(t)
            const [srx, srz] = dirv(t - 1)
            // a single-lane roundabout (or a mini one) has a ONE-lane entry: the left lane is closed there, so traffic in it
            // merges into the right lane while still crossing the junction
            const ahead = rbSpec(i + sx, j + sz)
            const oneLaneAhead = !!ahead && ahead.laneR.length === 1
            const toLane = k === LANES - 1 || (k === 0 && oneLaneAhead) ? 1 : k
            const exitOff = aiOff(toLane)
            const Xs: Pt = [cx + sx * BOX + srx * exitOff, cz + sz * BOX + srz * exitOff]
            if (k <= 1 && !armClosed(i, j, t)) {
              const shape: Pt[] = toLane !== k ? bez3(E, [E[0] + sx * BOX * 0.9, E[1] + sz * BOX * 0.9], [Xs[0] - sx * BOX * 0.9, Xs[1] - sz * BOX * 0.9], Xs, 12) : [E, Xs]
              LINKS.connS.set(`${n}:${a}:${k}`, addPiece('conn', shape, toLane !== k ? 11 : 17, { node: n, arm: t, lane: toLane }))
            }
            // left turn (the left-most lane only turns left)
            if (k === 0 && !armClosed(i, j, (t + 1) % 4)) {
              const e = (t + 1) % 4
              const [ex, ez] = dirv(e)
              const [erx, erz] = dirv(e - 1)
              // if the road you turn onto leads to a one-lane roundabout, turn into its right lane (the left one is closed there)
              const aheadL = rbSpec(i + ex, j + ez)
              const lLane = aheadL && aheadL.laneR.length === 1 ? 1 : 0
              const xo = aiOff(lLane)
              const Xl: Pt = [cx + ex * BOX + erx * xo, cz + ez * BOX + erz * xo]
              const ctrl: Pt = sz === 0 ? [Xl[0], E[1]] : [E[0], Xl[1]]
              LINKS.connL.set(`${n}:${a}:${k}`, addPiece('conn', bez2(E, ctrl, Xl, 16), 6.5, { node: n, arm: e, lane: lLane }))
            }
            // right turn (outer lane to outer lane)
            if (k === LANES - 1 && !armClosed(i, j, (t + 3) % 4)) {
              const e = (t + 3) % 4
              const [ex, ez] = dirv(e)
              const [erx, erz] = dirv(e - 1)
              const Xr: Pt = [cx + ex * BOX + erx * aiOff(1), cz + ez * BOX + erz * aiOff(1)]
              const ctrl: Pt = sz === 0 ? [Xr[0], E[1]] : [E[0], Xr[1]]
              LINKS.connR.set(`${n}:${a}:${k}`, addPiece('conn', bez2(E, ctrl, Xr, 12), 6.5, { node: n, arm: e, lane: 1 }))
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
          const spec = rbSpec(i, j)!
          const L = spec.laneR.length
          const sh = spec.splitter ? RB_SHIFT : 0
          const closed = armClosed(i, j, d)
          // entries: with two circulating lanes the left approach lane feeds the inner one and the right lane the outer one;
          // with a single circulating lane both approach lanes merge into it
          for (let k = 0; k < 2 && !closed; k++) {
            const o = aiOff(k)
            const rl = L === 1 ? 0 : k
            const rr = spec.laneR[rl]
            const dl = ringDelta(spec, rl)
            const P0: Pt = [cx + ox * spec.outer + lx * (o + sh), cz + oz * spec.outer + lz * (o + sh)]
            const P3 = ringPt(cx, cz, th + dl, rr)
            const tg = ringTan(th + dl)
            const h1 = 0.45 * Math.hypot(P3[0] - P0[0], P3[1] - P0[1])
            LINKS.entryC.set(`${n}:${d}:${k}`, addPiece('conn', bez3(P0, [P0[0] + tx * h1, P0[1] + tz * h1], [P3[0] - tg[0] * h1, P3[1] - tg[1] * h1], P3, 14), 6.5, { node: n, arm: d, lane: rl, entry: true }))
          }
          // exits, and the ring itself, one set per circulating lane
          for (let r = 0; r < L; r++) {
            const rr = spec.laneR[r]
            const dl = ringDelta(spec, r)
            const ko = L === 1 ? 1 : r // the outbound lane this ring lane leaves into
            const o = aiOff(ko)
            const Q0 = ringPt(cx, cz, th - dl, rr)
            const tq = ringTan(th - dl)
            const Q3: Pt = [cx + ox * spec.outer + rx * (o + sh), cz + oz * spec.outer + rz * (o + sh)]
            const h = 0.45 * Math.hypot(Q3[0] - Q0[0], Q3[1] - Q0[1])
            if (!closed) LINKS.exitC.set(`${n}:${d}:${r}`, addPiece('conn', bez3(Q0, [Q0[0] + tq[0] * h, Q0[1] + tq[1] * h], [Q3[0] - ox * h, Q3[1] - oz * h], Q3, 14), 6.5, { node: n, arm: d, lane: ko, exit: true }))
            // ring: pass arm d (exit_d -> entry_d), between d and d+1 (entry_d -> exit_{d+1})
            LINKS.ringPass.set(`${n}:${d}:${r}`, addPiece('ring', arc(cx, cz, th - dl, th + dl, rr), Math.min(7.6, Math.sqrt(2.4 * rr)), { node: n, arm: d, lane: r, ringType: 'pass' }))
            LINKS.ringBetween.set(`${n}:${d}:${r}`, addPiece('ring', arc(cx, cz, th + dl, th + Math.PI / 2 - dl, rr), Math.min(7.6, Math.sqrt(2.4 * rr)), { node: n, arm: (d + 1) % 4, lane: r, ringType: 'between' }))
          }
        }
      }
    }
  }
}
buildPieces()
// lanes that lead nowhere (T-junctions: no straight-on from the stem, no right turn into a closed road) are not used by traffic
{
  for (const p of PIECES) {
    if (p.kind !== 'edge' || p.toKind !== 'signal') continue
    const key = `${p.node}:${p.arm}:${p.lane}`
    const can = p.lane === 0 ? LINKS.connL.has(key) || LINKS.connS.has(key) : p.lane === 1 ? LINKS.connS.has(key) : LINKS.connR.has(key)
    if (!can) p.aiOk = false
  }
  for (let k = EDGE_IDS.length - 1; k >= 0; k--) if (!PIECES[EDGE_IDS[k]].aiOk) EDGE_IDS.splice(k, 1)
}

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

/**
 * Four-phase signals with protected left turns, like a real junction:
 *   1. north-south through + right turns green, their left turns RED
 *   2. north-south left turns green (arrow), their through traffic RED
 *   3. east-west through + right turns green, left turns RED
 *   4. east-west left turns green (arrow), through traffic RED
 * Each green is followed by amber and a short all-red.
 */
/**
 * Which signalised junctions have a protected left-turn arrow. The rest are "yield on green": the left lane
 * turns left on the ordinary green light, giving way to oncoming traffic (like most junctions in real cities).
 */
const ARROW_AT: Array<[number, number]> = [[1, 1], [3, 3], [1, 2], [0, 3], [3, 0], [2, 1]]
export const LEFT_ARROW = new Set(ARROW_AT.map(([i, j]) => mod(i, G) * G + mod(j, G)))
export const hasLeftArrow = (node: number) => LEFT_ARROW.has(node)
export const CYCLE = 54
const nodeOffsets: number[] = Array.from({ length: 64 }, (_, n) => ((((Math.sin(n * 91.7) * 43758.5453) % 1) + 1) % 1) * CYCLE)
const nodeOffset = (n: number) => nodeOffsets[n] ?? ((((Math.sin(n * 91.7) * 43758.5453) % 1) + 1) % 1) * CYCLE
/** 0 = green, 1 = amber, 2 = red. axis 1 = north-south approaches, 0 = east-west. move 'T' = through / right, 'L' = left turn. */
export function signalColor(node: number, axis: 0 | 1, t: number, move: 'T' | 'L' = 'T'): 0 | 1 | 2 {
  const ph = mod(t + nodeOffset(node), CYCLE)
  const a = axis === 1 ? ph : mod(ph - 27, CYCLE) // east-west runs 27 s after north-south
  // Junctions WITHOUT a left-turn arrow: one long green for the whole approach, left turns allowed on the round green
  // light but they must yield to oncoming traffic. Junctions WITH an arrow: through first, then a protected left arrow.
  if (!LEFT_ARROW.has(node)) move = 'T'
  const permissive = !LEFT_ARROW.has(node)
  const g0 = move === 'T' ? 0 : 17
  const g1 = permissive ? 23 : move === 'T' ? 13 : 23
  if (a >= g0 && a < g1) return 0
  if (a >= g1 && a < g1 + 3) return 1
  return 2
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

const LOT_PITCH = (B - 2 * (HALF_ROAD + 5)) / 3 // three lots across a block, whatever the road width
function buildLots(): Lot[] {
  const lots: Lot[] = []
  for (let i = 0; i < G; i++) {
    for (let j = 0; j < G; j++) {
      const bx0 = i * B + HALF_ROAD + 5
      const bz0 = j * B + HALF_ROAD + 5
      for (let a = 0; a < 3; a++) {
        for (let b = 0; b < 3; b++) {
          const x0 = bx0 + a * LOT_PITCH + 3
          const z0 = bz0 + b * LOT_PITCH + 3
          const x1 = x0 + LOT_PITCH - 6
          const z1 = z0 + LOT_PITCH - 6
          let park = hash(i * 3 + a, j * 3 + b) < 0.16
          for (const [ci, cj] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]]) {
            if (nodeKind(ci, cj) !== 'round') continue
            const cx = ci * B
            const cz = cj * B
            const dx = Math.max(x0 - cx, 0, cx - x1)
            const dz = Math.max(z0 - cz, 0, cz - z1)
            if (Math.hypot(dx, dz) < clearance(ci, cj) + 10) park = true
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
  return { i, j, n: nodeIndex(i, j), cx, cz, kind: nodeKind(i, j), spec: rbSpec(i, j), rx: x - cx, rz: z - cz }
}

/**
 * Half-widths of the road between node A and node B (A -> B runs east or south), at distance u from A's centre.
 * `right` is the +v side (west of a southbound road, south of an eastbound one) and `left` the other side.
 * The road only widens on the approach side of a signalised junction, where the third lane is added.
 */
export function segHalves(kA: NodeKind, kB: NodeKind, clrA: number, clrB: number, u: number, flA = kA === 'round', flB = kB === 'round') {
  const dA = u - clrA
  const dB = B - u - clrB
  return {
    right: HALF_MID + (kB === 'signal' ? (HALF_ROAD - HALF_MID) * flare(dB) : 0) + (flB ? rbShift(dB) : 0),
    left: HALF_MID + (kA === 'signal' ? (HALF_ROAD - HALF_MID) * flare(dA) : 0) + (flA ? rbShift(dA) : 0),
  }
}

export function onAsphalt(x: number, z: number) {
  const nn = nearestNode(x, z)
  if (nn.spec) {
    const r = Math.hypot(nn.rx, nn.rz)
    if (r < nn.spec.outer) return r > nn.spec.island
  } else if (Math.abs(nn.rx) < BOX + 0.2 && Math.abs(nn.rz) < BOX + 0.2) return true
  // vertical road (runs south): +v side is west
  {
    const i = Math.round(x / B)
    const lat = x - i * B
    const jA = Math.floor(z / B)
    const u = z - jA * B
    const kA = nodeKind(i, jA)
    const kB = nodeKind(i, jA + 1)
    const cA = clearance(i, jA)
    const cB = clearance(i, jA + 1)
    if (!armClosed(i, jA, 3) && u >= (kA === 'round' ? cA - 3 : cA) && u <= (kB === 'round' ? B - cB + 3 : B - cB)) {
      const h = segHalves(kA, kB, cA, cB, u, flareOf(i, jA), flareOf(i, jA + 1))
      if (Math.abs(lat) < (lat < 0 ? h.right : h.left) + 0.2) return true
    }
  }
  // horizontal road (runs east): +v side is south
  {
    const j = Math.round(z / B)
    const lat = z - j * B
    const iA = Math.floor(x / B)
    const u = x - iA * B
    const kA = nodeKind(iA, j)
    const kB = nodeKind(iA + 1, j)
    const cA = clearance(iA, j)
    const cB = clearance(iA + 1, j)
    if (!armClosed(iA, j, 0) && u >= (kA === 'round' ? cA - 3 : cA) && u <= (kB === 'round' ? B - cB + 3 : B - cB)) {
      const h = segHalves(kA, kB, cA, cB, u, flareOf(iA, j), flareOf(iA + 1, j))
      if (Math.abs(lat) < (lat > 0 ? h.right : h.left) + 0.2) return true
    }
  }
  return false
}

export function inIsland(x: number, z: number) {
  const nn = nearestNode(x, z)
  return !!nn.spec && Math.hypot(nn.rx, nn.rz) < nn.spec.island - 0.3
}
