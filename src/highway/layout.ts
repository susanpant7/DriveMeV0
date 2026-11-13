/**
 * The highway course. Everything lies along the z axis: traffic runs north (-z, heading 0), the same way the player faces. x grows to the
 * player's right.
 *
 * The course is an endless chain of STAGES. A stage is a stretch of one named highway (say I-80 West) with several things along it:
 * entrances (on-ramps with traffic joining), exits (off-ramps, on the right or sometimes the left), a place where the highway splits into
 * two highways, a lane that ends, and stretches where you are asked to move to a particular lane. When a stage is finished the player is
 * moved to the start of the next one: straight on (the plain highway looks the same, so you do not notice), or onto the on-ramp of the
 * highway that the exit you took leads to.
 */
export const LANE = 3.7
/** centres of the five lanes (0 = left / fast, 4 = right / slow) */
export const NB_X = [0, 3.7, 7.4, 11.1, 14.8]
export const NL = NB_X.length
export const NB_EDGE_L = -1.85
export const NB_EDGE_R = 16.65
export const NB_SHOULDER_L = 1.2
export const SHOULDER_R = 3.0
/** the other carriageway, across the median (scenery: no traffic on it). Add the stage's sbOff to all of these. */
export const SB_X = [-11.0, -14.7, -18.4]
export const SB_EDGE_IN = -9.15
export const SB_EDGE_OUT = -20.25
export const MEDIAN_X = -5.5

export const Z_TOP = 2200 // the carriageways exist from here...
export const Z_FINISH = -3600 // ...to here
/** where the player is put at the start of a stage that does not begin on a ramp */
export const SPAWN_Z = 1250
/** a ramp is a straight road meeting the highway at 8 degrees, eased into it by a long gentle curve */
export const RAMP_ANGLE = (8 * Math.PI) / 180
export const RAMP_EASE = 400
export const RAMP_K = 1 / Math.cos(RAMP_ANGLE) // sideways width of the ramp measured along x
/** the extra lane beside the highway (acceleration lane after an entrance, deceleration lane before an exit): its length, and its taper */
export const ACC_LEN = 400
export const TAPER = 100
export const RAMP_SHOULDER_IN = 1.2 // on the highway side
export const RAMP_SHOULDER_OUT = 2.4
/** the ramp the player starts on: where it meets the highway and how long it is */
export const START_G = 420
export const START_LEN = 690
/** a split: how fast the right-hand branch pulls away, and how far */
export const FORK_SLOPE = 0.22
export const FORK_MAX = 40
/** centre of the extra lane on that side (1 = right, -1 = left) */
export const AUX_X = (side: 1 | -1) => (side === 1 ? NB_X[NL - 1] + LANE : NB_X[0] - LANE)

/* ------------------------------------------------------------------ */
/* What a stage is made of                                             */
/* ------------------------------------------------------------------ */
export interface Route { shield: 'I' | 'US' | 'SR'; num: string; dir: 'NORTH' | 'SOUTH' | 'EAST' | 'WEST'; city: string }
export interface Ramp {
  kind: 'on' | 'off'
  side: 1 | -1
  /** z of the gore: where the ramp meets (on) or leaves (off) the extra lane beside the highway */
  g: number
  /** length of the ramp itself */
  len: number
  /** exits: the exit number, and where it goes (another highway, or a local road by name) */
  exit?: string
  to?: Route
  name?: string
  /** the exit the player is asked to take */
  take?: boolean
  /** the entrance the player starts on */
  player?: boolean
}
export type Task =
  | { k: 'merge'; ramp: number }
  | { k: 'lane'; z0: number; z1: number; lane: number; name: string }
  | { k: 'exit'; ramp: number }
  | { k: 'fork' }
  | { k: 'drop' }
export interface Stage {
  id: number
  road: Route
  ramps: Ramp[]
  /** the highway splits: lanes 0 .. split-1 go left, the rest go right */
  fork: null | { z: number; split: number; left: Route; right: Route; want: 'left' | 'right'; exitOnly: 'left' | 'right' }
  /** a lane ends (side 1: the right lane, -1: the left lane): full width until z0, gone by z1 */
  drop: null | { side: 1 | -1; z0: number; z1: number }
  tasks: Task[]
  /** how far the other carriageway is moved away (a wide grass median, when there is a ramp on the left) */
  sbOff: number
  /** the stage is over when the player passes this */
  zEnd: number
  start: { x: number; z: number; h: number }
  /** Mixed course: the last exit leads back into the city */
  mixed: boolean
}

const cap = (s: string) => s[0] + s.slice(1).toLowerCase()
export const routeId = (r: Route) => `${r.shield === 'SR' ? 'SR' : r.shield}-${r.num}`
export const routeName = (r: Route) => `${routeId(r)} ${cap(r.dir)}`

export const HW = { s: null as unknown as Stage }

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)
/** distance along a ramp from its gore: > 0 on the ramp itself, 0 .. -ACC_LEN alongside the highway in the extra lane */
export const rampU = (r: Ramp, z: number) => (r.kind === 'on' ? z - r.g : r.g - z)
const curve = (u: number) => {
  if (u <= 0) return 0
  const t = Math.tan(RAMP_ANGLE)
  // a gentle easing curve where the ramp straightens into the extra lane, then the straight diagonal: no kink where they meet
  return u < RAMP_EASE ? (t * u * u) / (2 * RAMP_EASE) : t * (u - RAMP_EASE / 2)
}
/** x of the centre of the ramp's lane at z (the extra lane beside the highway, then the ramp curving away) */
export const rampX = (r: Ramp, z: number) => AUX_X(r.side) + r.side * curve(rampU(r, z))
export const rampHeading = (r: Ramp, z: number) => Math.atan2(rampX(r, z + 0.5) - rampX(r, z - 0.5), 1)
/** the stretch of z a ramp occupies (upstream end first) */
export const rampZ0 = (r: Ramp) => (r.kind === 'on' ? r.g + r.len : r.g + ACC_LEN)
export const rampZ1 = (r: Ramp) => (r.kind === 'on' ? r.g - ACC_LEN : r.g - r.len)
/** how wide the extra lane is at z, 0 .. 1 (it tapers away over the last 100 m) */
export const auxW = (r: Ramp, z: number) => { const u = rampU(r, z); return u >= 0 ? 1 : clamp01((u + ACC_LEN) / TAPER) }
/** the ramp whose extra lane runs alongside the highway on that side at z */
export function auxAt(side: 1 | -1, z: number): Ramp | null {
  for (const r of HW.s.ramps) if (r.side === side) { const u = rampU(r, z); if (u <= 0 && u >= -ACC_LEN) return r }
  return null
}
/** the ramp on that side that is anywhere abreast of z (its extra lane or the ramp itself) */
export function rampNear(side: 1 | -1, z: number): Ramp | null {
  for (const r of HW.s.ramps) if (r.side === side && z <= rampZ0(r) + 5 && z >= rampZ1(r) - 5) return r
  return null
}
/** outer edge line of a ramp's extra lane */
export const auxEdge = (r: Ramp, z: number) => (r.side === 1 ? NB_EDGE_R + LANE * auxW(r, z) : NB_EDGE_L - LANE * auxW(r, z))

/** x of the line between the two branches of a split (before they part) */
export const splitX = () => NB_EDGE_L + (HW.s.fork?.split ?? NL) * LANE
/** sideways distance the right-hand branch has moved away at z */
export function forkShift(z: number) {
  const f = HW.s.fork
  if (!f || z >= f.z) return 0
  return Math.min(FORK_MAX, (f.z - z) * FORK_SLOPE)
}
/** how the right-hand branch bends there (rad) */
export function forkHeading(z: number) {
  const f = HW.s.fork
  return f && z < f.z && z > f.z - FORK_MAX / FORK_SLOPE ? -Math.atan(FORK_SLOPE) : 0
}
export const laneShift = (k: number, z: number) => (HW.s.fork && k >= HW.s.fork.split ? forkShift(z) : 0)
/** how much of the ending lane is left at z, 1 .. 0 */
export function dropT(z: number) {
  const d = HW.s.drop
  return d ? clamp01((z - d.z1) / (d.z0 - d.z1)) : 1
}
export const dropLane = () => (HW.s.drop ? (HW.s.drop.side === 1 ? NL - 1 : 0) : -9)
/** the highway's own edge lines (not counting an extra lane) */
export const edgeR = (z: number) => NB_EDGE_R - (HW.s.drop?.side === 1 ? LANE * (1 - dropT(z)) : 0) + forkShift(z)
export const edgeL = (z: number) => NB_EDGE_L + (HW.s.drop?.side === -1 ? LANE * (1 - dropT(z)) : 0)
/** edges of the highway's pavement (lanes, any extra lane, shoulders) */
export function paveR(z: number) {
  const r = auxAt(1, z)
  if (r) { const w = auxW(r, z); return NB_EDGE_R + LANE * w + RAMP_SHOULDER_OUT + (SHOULDER_R - RAMP_SHOULDER_OUT) * (1 - w) }
  return edgeR(z) + SHOULDER_R
}
export function paveL(z: number) {
  const r = auxAt(-1, z)
  if (r) return NB_EDGE_L - LANE * auxW(r, z) - NB_SHOULDER_L
  return edgeL(z) - NB_SHOULDER_L
}

export interface Strip { z0: number; z1: number; l: (z: number) => number; r: (z: number) => number }
/** every piece of paved road in the current stage (z0 > z1); the other carriageway is the last one */
export function strips(): Strip[] {
  const s = HW.s
  const out: Strip[] = []
  if (s.fork) {
    const fz = s.fork.z
    out.push({ z0: Z_TOP, z1: fz, l: paveL, r: paveR })
    out.push({ z0: fz, z1: Z_FINISH, l: paveL, r: () => splitX() + NB_SHOULDER_L })
    out.push({ z0: fz, z1: Z_FINISH, l: (z) => splitX() - NB_SHOULDER_L + forkShift(z), r: paveR })
  } else out.push({ z0: Z_TOP, z1: Z_FINISH, l: paveL, r: paveR })
  for (const r of s.ramps) {
    const [a, b] = r.kind === 'on' ? [r.g + r.len + 5, r.g] : [r.g, r.g - r.len - 5]
    const wl = (LANE / 2 + (r.side === 1 ? RAMP_SHOULDER_IN : RAMP_SHOULDER_OUT)) * RAMP_K
    const wr = (LANE / 2 + (r.side === 1 ? RAMP_SHOULDER_OUT : RAMP_SHOULDER_IN)) * RAMP_K
    out.push({ z0: a, z1: b, l: (z) => rampX(r, z) - wl, r: (z) => rampX(r, z) + wr })
  }
  out.push({ z0: Z_TOP, z1: Z_FINISH, l: () => SB_EDGE_OUT + s.sbOff - SHOULDER_R, r: () => SB_EDGE_IN + s.sbOff + NB_SHOULDER_L })
  return out
}

export function onRoad(x: number, z: number): boolean {
  for (const s of strips()) if (z <= s.z0 && z >= s.z1 - 1 && x >= s.l(z) && x <= s.r(z)) return true
  return false
}

/** take the sideways shift of a split out of x, so lanes can be told apart by x alone */
export function unshiftX(x: number, z: number) {
  const f = HW.s.fork
  if (!f || z >= f.z) return x
  const sh = forkShift(z)
  return x > splitX() + sh / 2 ? x - sh : x
}
/** which lane a point is in: 0 .. 4 on the highway, 5 = the extra lane / ramp on the right, -1 = on the left */
export function laneAt(x: number, z: number): number {
  if (x > edgeR(z)) return rampNear(1, z) ? NL : NL - 1
  if (x < edgeL(z)) return rampNear(-1, z) ? -1 : 0
  return Math.max(0, Math.min(NL - 1, Math.floor((unshiftX(x, z) - NB_EDGE_L) / LANE)))
}
/** the lane nearest to a point (highway lanes that exist there, extra lanes and ramps): its centre, heading and index */
export function nearestLane(x: number, z: number): { x: number; h: number; k: number } {
  const s = HW.s
  let best = { x: NB_X[2], h: 0, k: 2 }, bd = 1e9
  for (let k = 0; k < NL; k++) {
    if (k === dropLane() && dropT(z) < 0.5) continue
    const cx = NB_X[k] + laneShift(k, z)
    const d = Math.abs(x - cx)
    if (d < bd) { bd = d; best = { x: cx, h: s.fork && k >= s.fork.split ? forkHeading(z) : 0, k } }
  }
  for (const r of s.ramps) {
    if (z > rampZ0(r) + 5 || z < rampZ1(r) - 5) continue
    if (rampU(r, z) < 0 && auxW(r, z) < 0.02) continue
    const cx = rampX(r, z)
    const d = Math.abs(x - cx)
    if (d < bd) { bd = d; best = { x: cx, h: rampHeading(r, z), k: r.side === 1 ? NL : -1 } }
  }
  return best
}

/** the pose the player starts the stage in */
export const startPose = () => HW.s.start
/** Where to put the player back after leaving the road: the nearest lane, at rest, facing along it. */
export function recoverPose(x: number, z: number) {
  const zz = Math.max(Z_FINISH + 100, Math.min(Z_TOP - 100, z))
  const n = nearestLane(x, zz)
  return { x: n.x, z: zz, h: n.h }
}

/* ------------------------------------------------------------------ */
/* Building stages                                                     */
/* ------------------------------------------------------------------ */
const ROADS: Array<[Route['shield'], string, Route['dir'], string, Route['dir'], string]> = [
  ['I', '80', 'WEST', 'San Francisco', 'EAST', 'Reno'],
  ['I', '5', 'NORTH', 'Redding', 'SOUTH', 'Los Angeles'],
  ['US', '101', 'NORTH', 'Eureka', 'SOUTH', 'San Jose'],
  ['US', '50', 'EAST', 'Lake Tahoe', 'WEST', 'Sacramento'],
  ['I', '280', 'NORTH', 'Daly City', 'SOUTH', 'Cupertino'],
  ['SR', '99', 'SOUTH', 'Fresno', 'NORTH', 'Chico'],
  ['I', '580', 'EAST', 'Stockton', 'WEST', 'Oakland'],
  ['I', '10', 'EAST', 'Phoenix', 'WEST', 'Santa Monica'],
]
const STREETS = ['Elm St', 'Riverside Dr', 'Airport Blvd', 'Main St', 'Lake Rd', 'Oak Ave', 'Mill Rd', 'Harbor Blvd', 'College Ave', 'Pine St', 'Canyon Rd', 'Market St']
const rnd = (n: number) => Math.floor(Math.random() * n)
const pick = <T,>(a: T[]) => a[rnd(a.length)]
/** a highway other than these */
export function pickRoute(...not: Array<Route | undefined>): Route {
  for (;;) {
    const r = pick(ROADS)
    if (not.some((n) => n && n.num === r[1])) continue
    return rnd(2) ? { shield: r[0], num: r[1], dir: r[2], city: r[3] } : { shield: r[0], num: r[1], dir: r[4], city: r[5] }
  }
}
export const MIXED_ROAD: Route = { shield: 'I', num: '5', dir: 'NORTH', city: 'Redding' }
export const LANE_NAMES = ['left lane', 'second lane from the left', 'centre lane', 'second lane from the right', 'right lane']

let stageId = 0
/**
 * A new stage of `road`. entry: 'main' = already on the highway; 'rampR' / 'rampL' = on an entrance ramp that joins from the right / left.
 * Along it: something every kilometre or so (an entrance, an exit to pass, a lane to move to), ending with a decision (a split, an exit to
 * take, a lane that ends).
 */
export function makeStage(road: Route, entry: 'main' | 'rampR' | 'rampL', mixed = false): Stage {
  const s: Stage = { id: ++stageId, road, ramps: [], fork: null, drop: null, tasks: [], sbOff: 0, zEnd: 0, start: { x: NB_X[2], z: SPAWN_Z, h: 0 }, mixed }
  let exitNo = 10 + rnd(70)
  const slots = entry === 'main' ? [450, -550, -1550] : [-650, -1650]
  if (entry !== 'main') {
    const side = entry === 'rampR' ? 1 : -1
    const r: Ramp = { kind: 'on', side, g: START_G, len: START_LEN, player: true }
    s.ramps.push(r)
    s.tasks.push({ k: 'merge', ramp: 0 })
    if (side === -1) s.sbOff = -90
  }
  const finalG = slots.pop()!
  // the decision at the end of the stage
  const final = mixed ? 'exitR' : (['fork', 'fork', 'fork', 'exitR', 'exitR', 'exitR', 'exitL', 'dropR', 'dropL'] as const)[rnd(9)]
  // a split: worked out first, so a "move to a lane" task along the way already leads towards the branch you want
  const split = rnd(2) ? 2 : 3
  const forkWant: 'left' | 'right' = rnd(2) ? 'left' : 'right'
  // things along the way
  for (const G of slots) {
    const what = (mixed ? ['on', 'off'] : ['on', 'off', 'lane', 'lane'])[rnd(mixed ? 2 : 4)]
    if (what === 'on') s.ramps.push({ kind: 'on', side: 1, g: G, len: 320 })
    else if (what === 'off') s.ramps.push({ kind: 'off', side: 1, g: G, len: 420, exit: String(exitNo++), name: pick(STREETS) })
    else {
      // (not right across the road just before an exit or a lane that ends on the other side)
      const ok = final === 'exitR' || final === 'dropL' ? [2, 3, 4] : final === 'exitL' || final === 'dropR' ? [0, 1, 2]
        : forkWant === 'left' ? Array.from({ length: split }, (_, i) => i) : Array.from({ length: NL - split }, (_, i) => split + i)
      const last = [...s.tasks].reverse().find((t) => t.k === 'lane') as { lane: number } | undefined
      const lane = pick(ok.length > 1 && last ? ok.filter((k) => k !== last.lane) : ok) // (never the same lane twice in a row)
      s.tasks.push({ k: 'lane', z0: G + 450, z1: G - 250, lane, name: LANE_NAMES[lane] })
    }
  }
  if (final === 'fork') {
    const other = pickRoute(road)
    const cont = rnd(5) < 3 ? road : pickRoute(road, other)
    const [left, right] = rnd(2) ? [cont, other] : [other, cont]
    // EXIT ONLY marks the branch that leaves this highway (the one that is not its continuation; if neither is, the smaller one)
    const exitOnly: 'left' | 'right' = left === road ? 'right' : right === road ? 'left' : split === 2 ? 'left' : 'right'
    s.fork = { z: finalG, split, left, right, want: forkWant, exitOnly }
    s.tasks.push({ k: 'fork' })
    s.zEnd = finalG - 650
  } else if (final === 'exitR' || final === 'exitL') {
    const side = final === 'exitR' ? 1 : -1
    const r: Ramp = mixed
      ? { kind: 'off', side, g: finalG, len: START_LEN, exit: '12', name: 'City Centre', take: true }
      : { kind: 'off', side, g: finalG, len: START_LEN, exit: `${exitNo}${'AB'[rnd(2)]}`, to: pickRoute(road), take: true }
    s.ramps.push(r)
    s.tasks.push({ k: 'exit', ramp: s.ramps.length - 1 })
    s.zEnd = finalG - 650
    if (side === -1) s.sbOff = -90
  } else if (final === 'dropR' || final === 'dropL') {
    s.drop = { side: final === 'dropR' ? 1 : -1, z0: finalG, z1: finalG - 200 }
    s.tasks.push({ k: 'drop' })
    s.zEnd = finalG - 700
  } else s.zEnd = finalG - 300
  if (entry !== 'main') {
    const r = s.ramps[0]
    const z = r.g + r.len
    const prev = HW.s
    HW.s = s // (the ramp's shape is read off the current stage)
    s.start = { x: rampX(r, z), z, h: rampHeading(r, z) }
    HW.s = prev
  }
  return s
}
HW.s = makeStage(pickRoute(), 'rampR')
if (typeof window !== 'undefined') Object.assign(window, { __hwL: { rampX, rampU, forkShift, laneAt, nearestLane, splitX, dropLane, AUX_X, NB_X, ACC_LEN } })
