/**
 * The highway course. Everything is laid out along the z axis, as if the highway were straight: traffic runs north (-z, heading 0), the
 * same way the player faces, and x grows to the player's right ("road coordinates"). The highway itself then bends gently: in the world
 * every point is moved sideways by C(z) (long, gentle curves with straight stretches between them). Drawing, the traffic and your car
 * work in the world; the lanes, ramps and rules are worked out in road coordinates (toRoadX).
 *
 * A highway is five lanes wide where it has entrances, exits and splits, and narrows in between (the right lane ends, then the next):
 * four lanes, three, sometimes two, widening again before the next exit.
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
export const Z_FINISH = -5600 // ...to here
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
/** a split: how far the right-hand branch pulls away, and over how long (a long, smooth S: it eases away and eases straight again) */
export const FORK_MAX = 40
export const FORK_LEN = 700
/** the branch's sideways distance d metres past the split (0 .. FORK_MAX), and its slope there */
export const forkCurve = (d: number) => { const t = Math.max(0, Math.min(1, d / FORK_LEN)); return FORK_MAX * t * t * (3 - 2 * t) }
const forkSlope = (d: number) => { const t = Math.max(0, Math.min(1, d / FORK_LEN)); return (FORK_MAX * 6 * t * (1 - t)) / FORK_LEN }
/** centre of the extra lane on that side (1 = right, -1 = left) */
export const AUX_X = (side: 1 | -1) => (side === 1 ? NB_X[NL - 1] + LANE : NB_X[0] - LANE)

/* ------------------------------------------------------------------ */
/* What a stage is made of                                             */
/* ------------------------------------------------------------------ */
/** a highway, by its number in the practice (H1, H2, ...), or the city (the Mixed course's way off the highway) */
export interface Route { name: string; n: number }
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
  | { k: 'drop'; i: number }
export interface Stage {
  id: number
  road: Route
  ramps: Ramp[]
  /** the highway splits: lanes 0 .. split-1 go left, the rest go right */
  fork: null | { z: number; split: number; left: Route; right: Route; want: 'left' | 'right'; exitOnly: 'left' | 'right' }
  /** the right lane ends (lane `lane` tapers away between z0 and z1), and where a lane is added on the right again */
  drops: LaneEv[]
  adds: LaneEv[]
  /** the highway's gentle bends: each one moves it A metres sideways over len metres starting at z0 (a long S: curve, then straight) */
  bends: Bend[]
  tasks: Task[]
  /** how far the other carriageway is moved away (a wide grass median, when there is a ramp on the left) */
  sbOff: number
  /** the stage is over when the player passes this */
  zEnd: number
  start: { x: number; z: number; h: number }
  /** Mixed course: the last exit leads back into the city */
  mixed: boolean
  /** how the stage ends: lanes that split off to the next highway, or an exit; and where that leads */
  final: 'fork' | 'exit'
  to: Route
}

export interface LaneEv { z0: number; z1: number; lane: number }
export interface Bend { z0: number; len: number; A: number }
export const routeName = (r: Route) => r.name

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
/**
 * The long ramps (the one you start on, the exit you take) run straight for their last stretch, parallel to the highway: the end of an
 * exit ramp and the start of the next highway's entrance ramp then line up, and you drive from one onto the other without stopping.
 */
const END_ST = 120, END_E = 150
function rampCurve(r: Ramp, u: number) {
  if (r.len < START_LEN || u <= 0) return curve(u)
  const A = r.len - END_ST - END_E
  if (u <= A) return curve(u)
  const t = Math.tan(RAMP_ANGLE)
  const slope = A < RAMP_EASE ? (t * A) / RAMP_EASE : t
  const v = Math.min(u - A, END_E)
  return curve(A) + slope * (v - (v * v) / (2 * END_E)) // the heading eases back to straight, then stays straight
}
/** x of the centre of the ramp's lane at z (the extra lane beside the highway, then the ramp curving away) */
export const rampX = (r: Ramp, z: number) => AUX_X(r.side) + r.side * rampCurve(r, rampU(r, z))
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
  return forkCurve(f.z - z)
}
/** how the right-hand branch bends there (rad) */
export function forkHeading(z: number) {
  const f = HW.s.fork
  return f && z < f.z ? -Math.atan(forkSlope(f.z - z)) : 0
}
export const laneShift = (k: number, z: number) => (HW.s.fork && k >= HW.s.fork.split ? forkShift(z) : 0)
/** how many lanes the highway has at z (a fraction while one tapers away or opens up): 2 .. 5 */
export function lanesAt(z: number) {
  let n = NL
  for (const d of HW.s.drops) n -= clamp01((d.z0 - z) / (d.z0 - d.z1))
  for (const a of HW.s.adds) n += clamp01((a.z0 - z) / (a.z0 - a.z1))
  return n
}
/** how much of lane k is there at z: 1 = full width, 0 = none */
export const laneW = (k: number, z: number) => clamp01(lanesAt(z) - k)
/** lane k is there, full width, from z on for at least `ahead` metres */
export const laneOpen = (k: number, z: number, ahead = 0) => laneW(k, z) >= 1 && lanesAt(z - ahead) >= k + 1 - 1e-6
/** the highway's own edge lines (not counting an extra lane): the right one follows the lanes that end and are added */
export const edgeR = (z: number) => NB_EDGE_L + LANE * lanesAt(z) + forkShift(z)
export const edgeL = (_z: number) => NB_EDGE_L

/* ---- the bends: world x = road x + C(z) ---- */
const ss = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))
const ssd = (t: number) => (t <= 0 || t >= 1 ? 0 : 6 * t * (1 - t))
/** how far the highway has moved sideways at z (m) */
export function C(z: number) {
  let c = 0
  for (const b of HW.s.bends) c += b.A * ss((b.z0 - z) / b.len)
  return c
}
/** the highway's heading at z (rad, the same sense as a car's heading: positive = turned left of north) */
export function hC(z: number) {
  let d = 0 // dC/d(distance travelled north)
  for (const b of HW.s.bends) d += (b.A / b.len) * ssd((b.z0 - z) / b.len)
  return -Math.atan(d)
}
/** world x -> road x, and back */
export const toRoadX = (x: number, z: number) => x - C(z)
export const toWorldX = (x: number, z: number) => x + C(z)
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
/** the same, for a point in the world */
export const onRoadW = (x: number, z: number) => onRoad(toRoadX(x, z), z)

/** take the sideways shift of a split out of x, so lanes can be told apart by x alone */
export function unshiftX(x: number, z: number) {
  const f = HW.s.fork
  if (!f || z >= f.z) return x
  const sh = forkShift(z)
  return x > splitX() + sh / 2 ? x - sh : x
}
/** which lane a point is in: 0 .. 4 on the highway, 5 = the extra lane / ramp on the right, -1 = on the left */
export function laneAt(x: number, z: number): number {
  const last = Math.max(0, Math.ceil(lanesAt(z) - 1e-6) - 1)
  if (x > edgeR(z)) return rampNear(1, z) ? NL : last
  if (x < edgeL(z)) return rampNear(-1, z) ? -1 : 0
  return Math.max(0, Math.min(last, Math.floor((unshiftX(x, z) - NB_EDGE_L) / LANE)))
}
/** the lane nearest to a point (highway lanes that exist there, extra lanes and ramps): its centre, heading and index */
export function nearestLane(x: number, z: number): { x: number; h: number; k: number } {
  const s = HW.s
  let best = { x: NB_X[2], h: 0, k: 2 }, bd = 1e9
  for (let k = 0; k < NL; k++) {
    if (laneW(k, z) < 0.5) continue // (a lane that is ending, or not open yet)
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

/** the pose the player starts the stage in (world) */
export const startPose = () => ({ x: toWorldX(HW.s.start.x, HW.s.start.z), z: HW.s.start.z, h: HW.s.start.h + hC(HW.s.start.z) })
/** Where to put the player back after leaving the road (world in and out): the nearest lane, at rest, facing along it. */
export function recoverPose(x: number, z: number) {
  const zz = Math.max(Z_FINISH + 100, Math.min(Z_TOP - 100, z))
  const n = nearestLane(toRoadX(x, zz), zz)
  return { x: toWorldX(n.x, zz), z: zz, h: n.h + hC(zz) }
}

/* ------------------------------------------------------------------ */
/* Building stages                                                     */
/* ------------------------------------------------------------------ */
export const hwRoute = (n: number): Route => ({ name: `H${n}`, n })
export const CITY: Route = { name: 'City Centre', n: 0 }
export const MIXED_ROAD = hwRoute(1)
export const LANE_NAMES = ['left lane', 'second lane from the left', 'centre lane', 'second lane from the right', 'right lane']
const rnd = (n: number) => Math.floor(Math.random() * n)
const pick = <T,>(a: T[]) => a[rnd(a.length)]

let stageId = 0
const DROP_TAPER = 220, ADD_TAPER = 180
/**
 * A new stage of `road`.
 * entry 'ramp': you join it from an entrance on the right (merge); 'main': you are already on it.
 * final 'fork': it ends where its left-most or right-most two lanes split off to the next highway (`to`); 'exit': it ends at an exit on
 * the right that leads to the next highway's entrance.
 * In between, the highway narrows: the right lane ends, then the next (down to three lanes, sometimes two), and later lanes are added
 * on the right again, so it is five lanes wide for the exit or split at the end. "Move to a lane" tasks come along the way, and the
 * highway bends gently here and there.
 */
export function makeStage(road: Route, entry: 'ramp' | 'main', final: 'fork' | 'exit', to: Route, mixed = false): Stage {
  const s: Stage = { id: ++stageId, road, ramps: [], fork: null, drops: [], adds: [], bends: [], tasks: [], sbOff: 0, zEnd: 0, start: { x: NB_X[2], z: SPAWN_Z, h: 0 }, mixed, final, to }
  const ramp = entry === 'ramp'
  if (ramp) {
    s.ramps.push({ kind: 'on', side: 1, g: START_G, len: START_LEN, player: true })
    s.tasks.push({ k: 'merge', ramp: 0 })
  } else s.ramps.push({ kind: 'on', side: 1, g: 760, len: 320 }) // traffic joining near the start
  // the lanes: five, then the right lane ends, and the next... then they are added back
  let z = ramp ? -150 : 250
  let n = NL
  const least = rnd(3) === 0 ? 2 : 3
  while (n > least) { s.drops.push({ z0: z, z1: z - DROP_TAPER, lane: n - 1 }); s.tasks.push({ k: 'drop', i: s.drops.length - 1 }); n--; z -= 650 }
  const lowFrom = s.drops[s.drops.length - 1].z1, lowTo = z
  while (n < NL) { s.adds.push({ z0: z, z1: z - ADD_TAPER, lane: n }); n++; z -= 350 }
  const zFull = z // five lanes again from here
  const finalG = zFull - 1250
  // "move to a lane": on the narrow stretch (only lanes that are there all the way), and once more as the lanes are added back
  const prev = HW.s
  HW.s = s
  const forkSide: 'left' | 'right' = rnd(2) ? 'left' : 'right'
  const pickLane = (z0: number, z1: number, want: number[]) => {
    let open = NL
    for (let zz = z0; zz >= z1; zz -= 20) open = Math.min(open, Math.floor(lanesAt(zz) + 1e-6))
    const ok = want.filter((k) => k < open)
    const last = [...s.tasks].reverse().find((t) => t.k === 'lane') as { lane: number } | undefined
    const c = last ? ok.filter((k) => k !== last.lane) : ok
    return c.length ? pick(c) : -1
  }
  const addTask = (z0: number, z1: number, want: number[]) => { const k = pickLane(z0, z1, want); if (k >= 0) s.tasks.push({ k: 'lane', z0, z1, lane: k, name: LANE_NAMES[k] }) }
  addTask(lowFrom - 30, Math.max(lowTo + 60, lowFrom - 600), [0, 1, 2])
  addTask(zFull + 850, zFull + 250, final === 'exit' || forkSide === 'right' ? [2, 3, 4] : [0, 1, 2]) // (before the signs for the exit or split begin)
  // the end: the split or the exit (and, sometimes, traffic joining shortly before it)
  if (rnd(2)) s.ramps.push({ kind: 'on', side: 1, g: zFull - 150, len: 320 })
  if (final === 'fork') {
    // the left-most 2 lanes or the right-most 2 lanes become the next highway; the others carry on as this one
    const split = forkSide === 'left' ? 2 : 3
    const [left, right] = forkSide === 'left' ? [to, road] : [road, to]
    s.fork = { z: finalG, split, left, right, want: forkSide, exitOnly: forkSide }
    s.tasks.push({ k: 'fork' })
    s.zEnd = finalG - FORK_LEN - 80 // (past the end of the split's curve: the branches run straight again)
  } else {
    s.ramps.push({ kind: 'off', side: 1, g: finalG, len: START_LEN, exit: '', to, take: true })
    s.tasks.push({ k: 'exit', ramp: s.ramps.length - 1 })
    s.zEnd = finalG - 650
  }
  // the order the tasks come in, along the road
  const tz = (t: Task) => (t.k === 'merge' ? 9999 : t.k === 'lane' ? t.z0 : t.k === 'drop' ? s.drops[t.i].z0 + 900 : t.k === 'exit' ? s.ramps[t.ramp].g + 2000 : (s.fork?.z ?? 0) + 1300)
  s.tasks.sort((a, b) => tz(b) - tz(a))
  // gentle bends between the start and the final approach (straight where you join, and for the exit or split at the end)
  {
    let bz = 150
    while (bz - 900 > zFull + 250) {
      const len = 900 + rnd(500)
      if (bz - len < zFull + 250) break
      if (rnd(4)) s.bends.push({ z0: bz, len, A: (30 + rnd(45)) * (rnd(2) ? 1 : -1) })
      bz -= len + 150 + rnd(350)
    }
  }
  if (ramp) {
    const r = s.ramps[0]
    const zs = r.g + r.len
    s.start = { x: rampX(r, zs), z: zs, h: rampHeading(r, zs) }
  }
  HW.s = prev
  return s
}
/** the first stage of a practice: onto H1 from its entrance, then the lanes that split off to H2 */
export const firstStage = () => makeStage(hwRoute(1), 'ramp', 'fork', hwRoute(2))
HW.s = firstStage()
if (typeof window !== 'undefined') Object.assign(window, { __hwL: { makeStage, hwRoute, rampX, rampU, forkShift, laneAt, nearestLane, splitX, lanesAt, laneOpen, C, hC, AUX_X, NB_X, ACC_LEN } })
