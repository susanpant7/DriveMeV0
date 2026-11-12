/**
 * The city: a 4x4 grid of nodes (junctions) joined by two-way roads, repeated forever
 * (the world wraps every P metres). Right-hand traffic. Pure data + geometry helpers,
 * no rendering. Coordinates: x east, z south (top-down map has north up, so north = -z).
 */

export const B = 250 // distance between junction centres
export const G = 4 // junctions per side before the map repeats
export const P = B * G // period of the world
export const LANE_W = 5.2 // 17 ft: a very generous lane (US standard is 11-12 ft)
/** Lane indices on a road: 0 and 1 are the two ordinary lanes (0 nearer the centre). Approaching a signalised junction extra lanes may open:
 *  2 = left-turn lane beside lane 0, 3 = a second left-turn lane beside that, 4 = right-turn-only lane outside lane 1. */
export const LANES = 5
export const L_LEFT = 2, L_LEFT2 = 3, L_RIGHT = 4
export const LANES_MID = 2 // lanes in each direction on an ordinary stretch of road
export const HALF_MID = LANES_MID * LANE_W // half the width of the ordinary 2-lane road
export const HALF_ROAD = 4 * LANE_W // half the width of the widest junction approach (two ordinary lanes + two turn lanes)
export const MED0 = 100, MED1 = 140 // the median at a signalised junction: full width within MED0 m of it, gone by MED1
export const FLARE = 80 // length of the full 3-lane section before a signalised junction
export const TAPER = 30 // the road widens from 2 to 3 lanes over this distance
/** how far the road has widened (0..1) at distance d before the junction's edge */
/**
 * Roundabout entrances flare outward so each lane keeps its full width beside the splitter island.
 * [distance from the ring, half-width of the island there (= how far each lane has shifted outward)]
 */
export const RB_ISLAND: ReadonlyArray<readonly [number, number]> = [[0.6, 2.7], [9, 2.2], [20, 1.0], [29, 0.2], [30, 0]] // a wider flare: the entry road is wider than the ordinary road
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
export const BOX = 32 // half size of a signalised junction (its four corners are rounded)
/** half width of the widened approach road at the junction, and the radius of the rounded corners (BOX minus that half width) */
export const CORNER_H = 3 * LANE_W + 0.5
export const CORNER_R = BOX - CORNER_H
export const SPEED_LIMIT = 30 * 0.44704 // 30 mph in m/s
/** the limit on the course being driven: 25 mph on residential streets, 30 mph in town */
export const speedLimit = () => (LAYOUT.kind === 'res' ? 25 : 30) * 0.44704

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
/** the roundabout course: every junction is a roundabout with four exits, and there are no buildings (open country) */
/** which course the grid is laid out as:
 *   mixed  = traffic lights, roundabouts and a few stop / yield junctions      lights = traffic lights everywhere (city)
 *   rb     = roundabouts only (open country)                                 res    = residential streets: stop, all-way stop and yield signs */
export type LayoutKind = 'mixed' | 'lights' | 'rb' | 'res'
export const LAYOUT = { rb: false, kind: 'mixed' as LayoutKind, version: 0 }
const CLOSED_LIGHTS = new Set(['1,1,0', '2,3,3'])
const CLOSED_RES = new Set(['0,1,0', '2,2,3', '3,0,0'])
/** the roundabout course: a mix of designs, some with only three or two exits (these roads are closed) */
const CLOSED_RB = new Set(['0,0,0', '2,1,0', '1,2,3', '3,3,3', '2,3,0'])
export function armClosed(i: number, j: number, d: number) {
  const set = LAYOUT.rb ? CLOSED_RB : LAYOUT.kind === 'lights' ? CLOSED_LIGHTS : LAYOUT.kind === 'res' ? CLOSED_RES : CLOSED_ROADS
  const dd = mod(d, 4)
  const [dx, dz] = DIRS[dd]
  return dd === 0 || dd === 3 ? set.has(`${mod(i, G)},${mod(j, G)},${dd}`) : set.has(`${mod(i + dx, G)},${mod(j + dz, G)},${(dd + 2) % 4}`)
}
/** How a signalised junction's approaches are laid out (every arm of a junction is the same):
 *  nL = how many left-turn-only lanes open up in the median (0: the left lane is shared left + straight on), rOnly = an extra right-turn-only lane. */
export interface JType {
  nL: 0 | 1 | 2
  rOnly: boolean
  label: string
  mw: number // half-width of the median in lanes (the carriageway sits this far out from the centre line)
  centre: boolean // a centre-turn-lane avenue: ONE shared lane down the middle (left-turn lane at junctions, two-way turn lane between them)
}
// The median is a property of the whole avenue, so no lane ever shifts sideways along a road or across a junction: lanes are only ever
// ADDED beside the existing ones (left-turn lanes inside the median, a right-turn lane on the outside). Avenues that meet a roundabout
// have no median (the left lane there is shared: left + straight on).
/** the north-south avenue (by i) that has a centre two-way turn lane and unsignalised side streets */
export const CENTRE_COL = 3
const ROW_NL: Array<0 | 1 | 2> = [0, 2, 0, 1] // east-west avenues (by j): left-turn lanes on their approaches
const COL_NL: Array<0 | 1 | 2> = [0, 1, 0, 1] // north-south avenues (by i)
const ROW_NL_CITY: Array<0 | 1 | 2> = [1, 2, 1, 1]
const COL_NL_CITY: Array<0 | 1 | 2> = [1, 1, 0, 1]
/** layout of the approaches along one axis of a junction (0 = the east-west road, 1 = the north-south road) */
export function jTypeOf(i: number, j: number, axis: number): JType | null {
  if (nodeKind(i, j) !== 'signal') return null
  const mi = mod(i, G), mj = mod(j, G)
  if (LAYOUT.kind === 'res') return { nL: 0, rOnly: false, label: '', mw: 0, centre: false } // plain residential streets
  // the city course has no roundabouts, so most of its avenues have a median with left-turn lanes
  const nL = LAYOUT.kind === 'lights' ? (axis === 1 ? COL_NL_CITY[mi] : ROW_NL_CITY[mj]) : axis === 1 ? COL_NL[mi] : ROW_NL[mj]
  const centre = axis === 1 && mi === CENTRE_COL
  const rOnly = !centre && nL < 2 && (mi * 3 + mj * 5 + axis * 2) % 3 === 0
  return { nL, rOnly, label: '', mw: centre ? 0.5 : nL, centre }
}
/** half-width of the approach to a signalised junction right at the junction (to the outer lane edge) */
export const jHalf = (t: JType) => LANE_W * (2 + t.mw + (t.rOnly ? 1 : 0))
/** The lanes of an approach at the stop line, left to right: lane index, its centre (m from the centre line) and what it may do. */
export function jLanes(t: JType): Array<{ lane: number; lat: number; use: 'L' | 'SL' | 'S' | 'SR' | 'R' }> {
  const m = t.mw * LANE_W, W = LANE_W
  const out: Array<{ lane: number; lat: number; use: 'L' | 'SL' | 'S' | 'SR' | 'R' }> = []
  if (t.nL === 2) out.push({ lane: L_LEFT2, lat: m - 1.5 * W, use: 'L' })
  if (t.nL >= 1) out.push({ lane: L_LEFT, lat: t.centre ? 0 : m - 0.5 * W, use: 'L' })
  out.push({ lane: 0, lat: m + 0.5 * W, use: t.nL === 0 ? 'SL' : 'S' })
  out.push({ lane: 1, lat: m + 1.5 * W, use: t.rOnly ? 'S' : 'SR' })
  if (t.rOnly) out.push({ lane: L_RIGHT, lat: m + 2.5 * W, use: 'R' })
  return out
}
/** wrap a coordinate difference into [-P/2, P/2) so "nearest copy" maths works */
/** the world repeats every `period` metres (the grid city); a real city does not repeat, so its period is effectively infinite */
export const WORLD_PERIOD = { v: P }
export const wrapD = (d: number) => mod(d + WORLD_PERIOD.v / 2, WORLD_PERIOD.v) - WORLD_PERIOD.v / 2
export const nodeIndex = (i: number, j: number) => mod(i, G) * G + mod(j, G)
export const nodeIJ = (n: number): [number, number] => [Math.floor(n / G), n % G]
export type NodeKind = 'round' | 'signal'
export const nodeKind = (i: number, j: number): NodeKind => (LAYOUT.rb || (LAYOUT.kind === 'mixed' && mod(i, G) % 2 === 0 && mod(j, G) % 2 === 0) ? 'round' : 'signal')

/** How a crossroads ('signal' kind node) is controlled: traffic lights, an all-way stop, a two-way stop or yield signs.
 *  For the last two, `major` is the axis (0 = east-west road, 1 = north-south road) that has priority and does not stop. */
export type CtrlType = 'light' | 'allway' | 'twoway' | 'yield'
const CTRL_MIXED: Record<string, { type: CtrlType; major: 0 | 1 }> = {
  '1,0': { type: 'twoway', major: 1 }, '3,2': { type: 'twoway', major: 1 }, '0,3': { type: 'yield', major: 0 }, '2,3': { type: 'allway', major: 0 },
}
export function nodeCtrl(i: number, j: number): { type: CtrlType; major: 0 | 1 } {
  const mi = mod(i, G), mj = mod(j, G)
  if (LAYOUT.kind === 'res') {
    const t = (mi + 2 * mj) % 4
    return t === 0 ? { type: 'allway', major: 0 } : t === 1 ? { type: 'twoway', major: 0 } : t === 2 ? { type: 'yield', major: 1 } : { type: 'twoway', major: 1 }
  }
  if (LAYOUT.kind === 'mixed') return CTRL_MIXED[`${mi},${mj}`] ?? { type: 'light', major: 0 }
  return { type: 'light', major: 0 }
}
/** what a driver arriving at a crossroads along `axis` faces: a traffic light, a STOP sign, a YIELD sign, or nothing (the priority road) */
export type ArmCtrl = 'light' | 'stop' | 'yield' | 'free'
export function armCtrl(node: number, axis: number): ArmCtrl {
  const [i, j] = nodeIJ(node)
  const c = nodeCtrl(i, j)
  if (c.type === 'light') return 'light'
  if (c.type === 'allway') return 'stop'
  return axis === c.major ? 'free' : c.type === 'twoway' ? 'stop' : 'yield'
}

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
/** the roundabout course: two-lane, signalised, single-lane and mini roundabouts, spread around the loop */
const RB_AT_RB: Record<string, RbVariant> = {
  '0,0': 'two', '1,0': 'single', '2,0': 'signal', '3,0': 'mini',
  '0,1': 'mini', '1,1': 'two', '2,1': 'single', '3,1': 'two',
  '0,2': 'two', '1,2': 'signal', '2,2': 'two', '3,2': 'single',
  '0,3': 'single', '1,3': 'two', '2,3': 'mini', '3,3': 'two',
}
const RB_AT: Record<string, RbVariant> = { '0,0': 'two', '2,0': 'signal', '0,2': 'two', '2,2': 'two' }
export function rbSpec(i: number, j: number): RbSpec | undefined {
  if (LAYOUT.rb) return RB_SPECS[RB_AT_RB[`${mod(i, G)},${mod(j, G)}`] ?? 'two']
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
        // approaching a signalised junction the through lanes shift outward over the taper to make room for the new left-turn lane
        if (toKind === 'signal') { if (segLen - FLARE - TAPER > 0) bps.add(segLen - FLARE - TAPER); if (segLen - FLARE > 0) bps.add(segLen - FLARE) }
        // where the median starts and stops changing width
        const tA = jTypeOf(i, j, d % 2), tB = jTypeOf(ni, nj, d % 2)
        for (const dd of tA && tB ? [80, segLen - 80] : [MED0, MED1]) { if (tA && dd < segLen) bps.add(dd); if (tB && segLen - dd > 0) bps.add(segLen - dd) }
        const sorted = [...bps].sort((p, q) => p - q)
        for (let k = 0; k < LANES; k++) {
          const pts: Pt[] = sorted.map((sv) => {
            // Each carriageway sits the median's width out from the centre line, so the through lanes (0, 1) run dead straight across a
            // junction. The left-turn lanes (2, and 3 beside it) open up inside the median; the right-turn lane (4) opens outside lane 1.
            const med = medW(tA, tB, clrA, clrB, clrA + sv)
            const dB = segLen - sv
            const f = tB && tB.nL ? pocketW(tB, dB, med) / (tB.nL * LANE_W) : 0
            const base = k === L_LEFT ? (tB?.centre ? 0 : med - 0.5 * LANE_W * f) : k === L_LEFT2 ? med - 1.5 * LANE_W * f : k === L_RIGHT ? med + 1.5 * LANE_W + LANE_W * flare(dB) : med + aiOff(k)
            const off = base + (flA ? rbShift(sv) : 0) + (flB ? rbShift(segLen - sv) : 0)
            return [cx + dx * (clrA + sv) + rx * off, cz + dz * (clrA + sv) + rz * off] as Pt
          })
          const rbB = rbSpec(ni, nj)
          // the turn lanes only exist at a signalised junction of the right type
          const aiOk = k === L_LEFT ? !!tB && tB.nL >= 1 : k === L_LEFT2 ? !!tB && tB.nL === 2 : k === L_RIGHT ? !!tB && tB.rOnly : rbB ? rbB.aiLanes.includes(k) : true
          const id = addPiece('edge', pts, 22, {
            node: nodeIndex(ni, nj), arm: arrive, lane: k, toKind, axis: arrive % 2 === 0 ? 0 : 1, aiOk,
          })
          if (k >= 2) PIECES[id].laneFrom = PIECES[id].len - FLARE
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
          const jt = jTypeOf(i, j, a % 2)!
          const m = jt.mw * LANE_W
          const mOut = jTypeOf(i, j, (a + 1) % 2)!.mw * LANE_W // the median of the cross road, which turning traffic drives out along // the median: every lane sits this far out, on the way in and on the way out
          // which lanes may do what (see JType): left turns from the pocket lane(s), or from lane 0 when there is no pocket;
          // right turns from the right-turn-only lane, or from lane 1 when there is none
          const leftFrom: Array<[number, number]> = jt.nL === 0 ? [[0, 0]] : jt.nL === 1 ? [[L_LEFT, 0]] : [[L_LEFT2, 0], [L_LEFT, 1]] // [from lane, into lane]
          const rightFrom = jt.rOnly ? L_RIGHT : 1
          for (let k = 0; k < LANES; k++) {
            if ((k === L_LEFT && jt.nL < 1) || (k === L_LEFT2 && jt.nL < 2) || (k === L_RIGHT && !jt.rOnly)) continue
            const o = k === L_LEFT ? (jt.centre ? 0 : m - 0.5 * LANE_W) : k === L_LEFT2 ? m - 1.5 * LANE_W : k === L_RIGHT ? m + 2.5 * LANE_W : m + aiOff(k)
            const E: Pt = [cx + ox * BOX + lx * o, cz + oz * BOX + lz * o]
            // straight: lanes 0 and 1 carry on dead straight into their own lane of the road beyond
            const [sx, sz] = dirv(t)
            const [srx, srz] = dirv(t - 1)
            // a single-lane roundabout (or a mini one) has a ONE-lane entry: the left lane is closed there, so traffic in it
            // merges into the right lane while still crossing the junction
            const ahead = rbSpec(i + sx, j + sz)
            const oneLaneAhead = !!ahead && ahead.laneR.length === 1
            const toLane = k === 0 && oneLaneAhead ? 1 : k
            const exitOff = aiOff(toLane) + m
            const Xs: Pt = [cx + sx * BOX + srx * exitOff, cz + sz * BOX + srz * exitOff]
            if (k <= 1 && !armClosed(i, j, t)) {
              const shape: Pt[] = bez3(E, [E[0] + sx * BOX * 0.9, E[1] + sz * BOX * 0.9], [Xs[0] - sx * BOX * 0.9, Xs[1] - sz * BOX * 0.9], Xs, 12)
              LINKS.connS.set(`${n}:${a}:${k}`, addPiece('conn', shape, 14, { node: n, arm: t, lane: toLane }))
            }
            // left turn
            const lf = leftFrom.find(([from]) => from === k)
            if (lf && !armClosed(i, j, (t + 1) % 4)) {
              const e = (t + 1) % 4
              const [ex, ez] = dirv(e)
              const [erx, erz] = dirv(e - 1)
              // if the road you turn onto leads to a one-lane roundabout, turn into its right lane (the left one is closed there)
              const aheadL = rbSpec(i + ex, j + ez)
              const lLane = aheadL && aheadL.laneR.length === 1 ? 1 : lf[1]
              const xo = aiOff(lLane) + mOut
              const Xl: Pt = [cx + ex * BOX + erx * xo, cz + ez * BOX + erz * xo]
              const ctrl: Pt = sz === 0 ? [Xl[0], E[1]] : [E[0], Xl[1]]
              LINKS.connL.set(`${n}:${a}:${k}`, addPiece('conn', bez2(E, ctrl, Xl, 16), 6.5, { node: n, arm: e, lane: lLane }))
            }
            // right turn
            if (k === rightFrom && !armClosed(i, j, (t + 3) % 4)) {
              const e = (t + 3) % 4
              const [ex, ez] = dirv(e)
              const [erx, erz] = dirv(e - 1)
              const Xr: Pt = [cx + ex * BOX + erx * (aiOff(1) + mOut), cz + ez * BOX + erz * (aiOff(1) + mOut)]
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
function buildAll() {
  PIECES.length = 0
  EDGE_IDS.length = 0
  for (const m of Object.values(LINKS)) m.clear()
  buildPieces()
// lanes that lead nowhere (T-junctions: no straight-on from the stem, no right turn into a closed road) are not used by traffic
{
  for (const p of PIECES) {
    if (p.kind !== 'edge' || p.toKind !== 'signal') continue
    const key = `${p.node}:${p.arm}:${p.lane}`
    const can = LINKS.connL.has(key) || LINKS.connS.has(key) || LINKS.connR.has(key)
    if (!can) p.aiOk = false
  }
  for (let k = EDGE_IDS.length - 1; k >= 0; k--) if (!PIECES[EDGE_IDS[k]].aiOk) EDGE_IDS.splice(k, 1)
}
}
buildAll()
/** switch between the city and the roundabout course (rebuilds the road data; returns true if anything changed) */
export function setLayout(kind: LayoutKind) {
  if (LAYOUT.kind === kind) return false
  LAYOUT.kind = kind
  LAYOUT.rb = kind === 'rb'
  LAYOUT.version++
  buildAll()
  LOTS.length = 0
  LOTS.push(...buildLots())
  return true
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
  // Heading: blend the direction of this segment with its neighbours' (tangent at each vertex, interpolated along the segment) so a
  // car sweeps round a bend smoothly instead of turning in small steps at every vertex.
  const sd = (k: number, o: number) => {
    const a = Math.min(Math.max(k, 1), cum.length - 1)
    return o === 0 ? x[a] - x[a - 1] : z[a] - z[a - 1]
  }
  const nrm = (ax: number, az: number, bx: number, bz: number, out2: number[]) => {
    const la = Math.hypot(ax, az) || 1
    const lb = Math.hypot(bx, bz) || 1
    const tx = ax / la + bx / lb
    const tz = az / la + bz / lb
    const l = Math.hypot(tx, tz) || 1
    out2[0] = tx / l
    out2[1] = tz / l
  }
  nrm(sd(i - 1, 0), sd(i - 1, 1), sd(i, 0), sd(i, 1), T0)
  nrm(sd(i, 0), sd(i, 1), sd(i + 1, 0), sd(i + 1, 1), T1)
  const hx = T0[0] + (T1[0] - T0[0]) * t
  const hz = T0[1] + (T1[1] - T0[1]) * t
  const hl = Math.hypot(hx, hz) || 1
  out.dx = hx / hl
  out.dz = hz / hl
}
const T0 = [0, 0]
const T1 = [0, 0]

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
export const hasLeftArrow = (node: number, axis: number) => {
  const t = jTypeOf(Math.floor(node / G), node % G, axis)
  return !!t && (t.nL === 2 || (t.nL === 1 && LEFT_ARROW.has(node))) // a shared left lane has no arrow; two left-turn lanes always have one
}
export const CYCLE = 54
const nodeOffsets: number[] = Array.from({ length: 64 }, (_, n) => ((((Math.sin(n * 91.7) * 43758.5453) % 1) + 1) % 1) * CYCLE)
const nodeOffset = (n: number) => nodeOffsets[n] ?? ((((Math.sin(n * 91.7) * 43758.5453) % 1) + 1) % 1) * CYCLE
/** 0 = green, 1 = amber, 2 = red. axis 1 = north-south approaches, 0 = east-west. move 'T' = through / right, 'L' = left turn. */
export function signalColor(node: number, axis: 0 | 1, t: number, move: 'T' | 'L' = 'T'): 0 | 1 | 2 {
  const ph = mod(t + nodeOffset(node), CYCLE)
  const a = axis === 1 ? ph : mod(ph - 27, CYCLE) // east-west runs 27 s after north-south
  // Junctions WITHOUT a left-turn arrow: one long green for the whole approach, left turns allowed on the round green
  // light but they must yield to oncoming traffic. Junctions WITH an arrow: through first, then a protected left arrow.
  if (!hasLeftArrow(node, axis)) move = 'T'
  const permissive = !hasLeftArrow(node, axis)
  const g0 = move === 'T' ? 0 : 15.5
  const g1 = permissive ? 21 : move === 'T' ? 11.5 : 23 // a plain green ends early: waiting left-turners clear the junction before the cross street goes
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
          if (stubsOn() && b === 1 && ((i === CENTRE_COL && a === 0) || (i === mod(CENTRE_COL - 1, G) && a === 2))) continue // a side street and its car park are here
          let park = LAYOUT.rb || hash(i * 3 + a, j * 3 + b) < (LAYOUT.kind === 'res' ? 0.3 : 0.16)
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
            h: LAYOUT.kind === 'res' ? 6 + hash(i * 3 + a, j * 3 + b, 2) * 6 : 10 + hash(i * 3 + a, j * 3 + b, 2) * 38, // low houses on residential streets
            color: PALETTE[Math.floor(hash(i * 3 + a, j * 3 + b, 3) * PALETTE.length)],
            park,
          })
        }
      }
    }
  }
  return lots
}
export const LOTS: Lot[] = buildLots()

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

/** Width (m) of the median on each side of the centre line at distance u from A. Every carriageway sits this far out from the centre
 *  line, so the through lanes run dead straight across a junction; the junction's left-turn lanes open up inside the median. The median
 *  belongs to the signalised junctions: between two of them it blends from one junction's width to the other's, towards a roundabout it
 *  closes up and the road is an ordinary two-lanes-each-way road. */
export function medW(tA: JType | null, tB: JType | null, clrA: number, clrB: number, u: number) {
  const ss = !!tA && !!tB
  const R0 = ss ? 80 : MED0, R1 = ss ? B - clrA - clrB - 80 : MED1
  const ramp = (d: number) => (d <= R0 ? 1 : d >= R1 ? 0 : 1 - (d - R0) / (R1 - R0))
  return LANE_W * ((tA?.mw ?? 0) * ramp(u - clrA) + (tB?.mw ?? 0) * ramp(B - u - clrB))
}
/** width (m) of the left-turn pocket(s) of junction type t, d metres before its edge, given the median width there */
export function pocketW(t: JType | null, d: number, med: number) { return t && !t.centre ? Math.min(t.nL * LANE_W * flare(d), med) : 0 }

/**
 * Half-widths of the road between node A and node B (A -> B runs east or south), at distance u from A's centre.
 * `right` is the +v side (west of a southbound road, south of an eastbound one) and `left` the other side.
 * The road only widens on the approach side of a signalised junction, where the third lane is added.
 */
export function segHalves(kA: NodeKind, kB: NodeKind, clrA: number, clrB: number, u: number, flA = kA === 'round', flB = kB === 'round', tA: JType | null = null, tB: JType | null = null) {
  const dA = u - clrA
  const dB = B - u - clrB
  return {
    // the median, the roundabout flare (BOTH carriageways move outward beside the splitter island) and, on the side that approaches
    // a junction with one, the right-turn-only lane
    right: HALF_MID + medW(tA, tB, clrA, clrB, u) + Math.max(flA ? rbShift(dA) : 0, flB ? rbShift(dB) : 0) + (tB?.rOnly ? LANE_W * flare(dB) : 0),
    left: HALF_MID + medW(tA, tB, clrA, clrB, u) + Math.max(flA ? rbShift(dA) : 0, flB ? rbShift(dB) : 0) + (tA?.rOnly ? LANE_W * flare(dA) : 0),
  }
}


/** Pavement half-widths (incl. the 0.5 m edge) of the road arm `d` of node (i,j) where it meets the junction box, measured on its
 *  [+z or -x side ("r"), -z or +x side ("l")]. The junction's corners join these real road edges. */
function armEdge(i: number, j: number, d: number): [number, number] {
  const def = jHalf(jTypeOf(i, j, d % 2) ?? { nL: 0, rOnly: false, label: '', mw: 0, centre: false }) + 0.5
  if (armClosed(i, j, d)) return [def, def]
  const [dx, dz] = dirv(d)
  const fwd = d === 0 || d === 3
  const ai = fwd ? i : i + dx, aj = fwd ? j : j + dz // the road runs from A (east or south end... the lower index) to B
  const dd = fwd ? d : (d + 2) % 4
  const [ex, ez] = dirv(dd)
  const kA = nodeKind(ai, aj), kB = nodeKind(ai + ex, aj + ez)
  const cA = clearance(ai, aj), cB = clearance(ai + ex, aj + ez)
  const u = fwd ? cA : B - cB
  const h = segHalves(kA, kB, cA, cB, u, flareOf(ai, aj), flareOf(ai + ex, aj + ez), jTypeOf(ai, aj, dd % 2), jTypeOf(ai + ex, aj + ez, dd % 2))
  return [h.right + 0.5, h.left + 0.5]
}
const outlines = new Map<string, Array<[number, number]>>()
/** Outline of a signalised junction relative to its centre: the four road mouths joined by rounded kerb returns that start exactly
 *  on each road's edge. Corners are returned too (as index ranges) so the white edge line can follow them. */
export function junctionOutline(i: number, j: number): { pts: Array<[number, number]>; corners: Array<Array<[number, number]>> } {
  const key = `${LAYOUT.version}:${mod(i, G)},${mod(j, G)}`
  const hit = outlines.get(key)
  if (hit) return hit as never
  const eE = armEdge(i, j, 0), eN = armEdge(i, j, 1), eW = armEdge(i, j, 2), eS = armEdge(i, j, 3)
  // x-arms (east/west): edge on the z side sz; z-arms (south/north): edge on the x side sx
  const xe = (sx: number, sz: number) => (sx > 0 ? eE : eW)[sz > 0 ? 0 : 1]
  const ze = (sx: number, sz: number) => (sz > 0 ? eS : eN)[sx > 0 ? 1 : 0] // south: r = west, l = east; north the same
  const K = 0.5523
  const curve = (sx: number, sz: number): Array<[number, number]> => {
    const a = xe(sx, sz), b = ze(sx, sz)
    const P0: [number, number] = [sx * BOX, sz * a], P3: [number, number] = [sx * b, sz * BOX]
    const P1: [number, number] = [sx * (BOX - K * (BOX - b)), sz * a], P2: [number, number] = [sx * b, sz * (BOX - K * (BOX - a))]
    const out: Array<[number, number]> = []
    for (let k = 0; k <= 16; k++) {
      const t = k / 16, u = 1 - t
      out.push([u * u * u * P0[0] + 3 * u * u * t * P1[0] + 3 * u * t * t * P2[0] + t * t * t * P3[0], u * u * u * P0[1] + 3 * u * u * t * P1[1] + 3 * u * t * t * P2[1] + t * t * t * P3[1]])
    }
    return out // P0 (on the east/west road) to P3 (on the south/north road)
  }
  const ne = curve(1, -1), se = curve(1, 1), sw = curve(-1, 1), nw = curve(-1, -1)
  const pts = [...[...ne].reverse(), ...se, ...[...sw].reverse(), ...nw]
  const res = { pts, corners: [ne, se, sw, nw] }
  outlines.set(key, res.pts as never)
  outlines.set(key, res as never)
  return res
}
const inPoly = (x: number, z: number, p: Array<[number, number]>) => {
  let c = false
  for (let a = 0, b = p.length - 1; a < p.length; b = a++) if (p[a][1] > z !== p[b][1] > z && x < ((p[b][0] - p[a][0]) * (z - p[a][1])) / (p[b][1] - p[a][1]) + p[a][0]) c = !c
  return c
}

/** A one-lane roundabout: the approach's left lane is physically closed by a raised island that starts as a point 130 m out and
 *  widens until it fills the lane at 60 m, so the two lanes really merge into one. Returns the island's sideways span (metres from the
 *  road centre, positive) at `back` metres before the roundabout, or null. */
export const WEDGE_LEN = 130
export const WEDGE_FULL = 60
export function wedgeSpan(back: number, flare: boolean): [number, number] | null {
  if (back < 1.2 || back >= WEDGE_LEN) return null
  const sh = flare ? rbShift(back) : 0
  const vIn = 0.45 + sh, vFull = LANE_W - 0.05 + sh
  const f = back <= WEDGE_FULL ? 1 : (WEDGE_LEN - back) / (WEDGE_LEN - WEDGE_FULL)
  return [vIn, vIn + f * (vFull - vIn)]
}
const wedgeHit = (back: number, v: number, rb: RbSpec | undefined) => {
  if (!rb || rb.laneR.length !== 1) return false
  const s = wedgeSpan(back, rb.splitter)
  return !!s && v >= s[0] && v <= s[1]
}

/** Side streets off the centre-turn-lane avenue: one each side at the middle of every block, ending in a small car park. Measured from
 *  the avenue's centre line: the street runs from the road edge out to STUB.end, the car park from STUB.lot0 to STUB.lot1. */
export const STUB = { u: B / 2, half: 4.6, end: 60, lot0: 56, lot1: 86, lotHalf: 24 }
export function stubsOn() { return LAYOUT.kind === 'mixed' || LAYOUT.kind === 'lights' }
function onStub(x: number, z: number) {
  if (!stubsOn()) return false
  const dx = Math.abs(wrapD(x - CENTRE_COL * B)), zc = Math.abs(mod(z, B) - STUB.u)
  return (zc < STUB.half && dx < STUB.end) || (zc < STUB.lotHalf && dx > STUB.lot0 && dx < STUB.lot1)
}

/** The curved kerb that sweeps each road into a roundabout: a fillet of radius Rf between the road's edge and the ring's outer edge.
 *  In the arm's own frame (u outward from the centre, v sideways) its centre is at (uc, +/-(hwC + Rf)); it touches the road edge at u = uc. */
export function rbFillet(spec: RbSpec) {
  const Rf = Math.min(14, Math.max(5, spec.outer * 0.3))
  const hwM = HALF_MID + 0.5 + (spec.splitter ? RB_SHIFT : 0)
  let hwC = hwM, uc = 0
  for (let k = 0; k < 3; k++) {
    uc = Math.sqrt((spec.outer + Rf) ** 2 - (hwC + Rf) ** 2)
    hwC = HALF_MID + 0.5 + (spec.splitter ? rbShift(Math.max(0, uc - spec.outer)) : 0)
  }
  return { Rf, uc, hwC, hwM, ang: Math.atan2(hwC + Rf, uc) }
}

export function onAsphalt(x: number, z: number) {
  if (onStub(x, z)) return true
  const nn = nearestNode(x, z)
  if (nn.spec) {
    const r = Math.hypot(nn.rx, nn.rz)
    if (r < nn.spec.outer) return r > nn.spec.island
    // the flared mouths: between the road edge, the ring and the curved kerb
    const f = rbFillet(nn.spec)
    if (r < nn.spec.outer + f.Rf + 2) for (let d = 0; d < 4; d++) {
      if (armClosed(nn.i, nn.j, d)) continue
      const [dx, dz] = dirv(d)
      const u = nn.rx * dx + nn.rz * dz, av = Math.abs(-nn.rx * dz + nn.rz * dx)
      if (u > 0 && u <= f.uc && av * f.uc <= (f.hwC + f.Rf) * u && Math.hypot(u - f.uc, av - (f.hwC + f.Rf)) >= f.Rf - 0.2) return true
    }
  } else if (Math.abs(nn.rx) < BOX + 0.2 && Math.abs(nn.rz) < BOX + 0.2) {
    // the junction is a cross with rounded corners
    return inPoly(nn.rx, nn.rz, junctionOutline(nn.i, nn.j).pts)
  }
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
      const h = segHalves(kA, kB, cA, cB, u, flareOf(i, jA), flareOf(i, jA + 1), jTypeOf(i, jA, 1), jTypeOf(i, jA + 1, 1))
      if (wedgeHit(B - cB - u, -lat, rbSpec(i, jA + 1)) || wedgeHit(u - cA, lat, rbSpec(i, jA))) return false // on the island that closes a lane
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
      const h = segHalves(kA, kB, cA, cB, u, flareOf(iA, j), flareOf(iA + 1, j), jTypeOf(iA, j, 0), jTypeOf(iA + 1, j, 0))
      if (wedgeHit(B - cB - u, lat, rbSpec(iA + 1, j)) || wedgeHit(u - cA, -lat, rbSpec(iA, j))) return false
      if (Math.abs(lat) < (lat > 0 ? h.right : h.left) + 0.2) return true
    }
  }
  return false
}

export function inIsland(x: number, z: number) {
  const nn = nearestNode(x, z)
  return !!nn.spec && Math.hypot(nn.rx, nn.rz) < nn.spec.island - 0.3
}
