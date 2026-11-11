/**
 * The highway course. Everything lies along the z axis: traffic on the main highway runs north (-z, heading 0), the same way the player
 * faces. x grows to the player's right. The course is endless: it is a sequence of scenarios (a merge from an on-ramp, an exit, a fork
 * into another highway). Each scenario is laid out in the same coordinates; when one is finished the player is moved back to the start
 * of the next one (the plain highway looks identical, so you never notice).
 */
export type HwType = 'merge' | 'exit' | 'fork' | 'lanedrop'
export const scen = { type: 'merge' as HwType }

export const LANE = 3.7
/** centres of the five northbound lanes (0 = left / fast, 4 = right / slow) */
export const NB_X = [0, 3.7, 7.4, 11.1, 14.8]
export const NB_EDGE_L = -1.85
export const NB_EDGE_R = 16.65
export const NB_SHOULDER_L = 1.2
export const SHOULDER_R = 3.0
/** southbound lanes (the other carriageway, across the median) */
export const SB_X = [-11.0, -14.7, -18.4]
export const SB_EDGE_IN = -9.15
export const SB_EDGE_OUT = -20.25
export const MEDIAN_X = -5.5

export const Z_TOP = 2200 // the carriageways exist from here...
export const Z_FINISH = -3600 // ...to here
export const Z_START = 1110 // merge: start of the on-ramp (a long run up to the gore, about 0.43 mile)
export const Z_GORE = 420 // merge space: where the ramp becomes the merge lane
/** the ramp is one straight road meeting the highway at 8 degrees */
export const RAMP_ANGLE = (8 * Math.PI) / 180
export const RAMP_EASE = 400 // length of the long, gentle curve where the ramp straightens into the merge lane
export const RAMP_K = 1 / Math.cos(RAMP_ANGLE) // sideways width of the ramp measured along x
export const Z_TAPER = 120
export const Z_END = 20 // merge: the merge lane ends
export const ACC_X = NB_X[NB_X.length - 1] + LANE // centre of the merge / exit lane
export const ACC_EDGE_R = ACC_X + LANE / 2
export const RAMP_SHOULDER_L = 1.2
export const RAMP_SHOULDER_R = 2.4
/** exits are a merge seen the other way round: real z = EXIT_C - merge-space z */
export const EXIT_C = 720
/** fork: where the right two lanes leave the highway, and how fast they pull away */
export const FORK_Z = 350
export const FORK_SLOPE = 0.22
export const FORK_MAX = 40
/** lane drop: the right lane is full width until LD0, then tapers away by LD1 */
export const LD0 = 450
export const LD1 = 250
export const laneDropT = (z: number) => (scen.type !== 'lanedrop' ? 1 : clamp01((z - LD1) / (LD0 - LD1)))
/** x of the right edge line of the highway (it closes in on the right lane when that lane ends) */
export const edgeLineX = (z: number) => NB_EDGE_R - LANE * (1 - laneDropT(z))

/** where the player is put at the start of a scenario that does not begin on a ramp */
export const SPAWN_Z = 1250

const mz = (z: number) => (scen.type === 'exit' ? EXIT_C - z : z)
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)

/** sideways distance the two right lanes have moved away from the highway at z (fork only) */
export function forkShift(z: number) {
  if (scen.type !== 'fork' || z >= FORK_Z) return 0
  return Math.min(FORK_MAX, (FORK_Z - z) * FORK_SLOPE)
}
/** how the road bends there (rad): the right branch turns away to the right while it is pulling away */
export function forkHeading(z: number) {
  return scen.type === 'fork' && z < FORK_Z && z > FORK_Z - FORK_MAX / FORK_SLOPE ? -Math.atan(FORK_SLOPE) : 0
}

/** x of the centre of the ramp lane at z (merge / exit) */
export function rampX(z: number) {
  const m = mz(z)
  if (m <= Z_GORE) return ACC_X
  // a gentle easing curve where the ramp straightens out into the merge lane (heading changes smoothly from 10 degrees to 0),
  // then the straight diagonal; this is how real acceleration lanes are drawn: no kink where they meet the highway
  const d = m - Z_GORE, t = Math.tan(RAMP_ANGLE)
  return d < RAMP_EASE ? ACC_X + (t * d * d) / (2 * RAMP_EASE) : ACC_X + t * (d - RAMP_EASE / 2)
}
export function rampHeading(z: number) {
  const e = 0.5
  return Math.atan2(rampX(z + e) - rampX(z - e), 2 * e)
}
/** right edge line of the extra (merge / exit) lane */
export function accRightEdge(z: number) {
  const m = mz(z)
  if (m >= Z_TAPER) return ACC_EDGE_R
  if (m <= Z_END) return NB_EDGE_R
  return NB_EDGE_R + (ACC_EDGE_R - NB_EDGE_R) * ((m - Z_END) / (Z_TAPER - Z_END))
}
/** right edge of the northbound pavement (including the shoulder) at z */
export function nbPavementRight(z: number) {
  if (scen.type === 'fork') return NB_EDGE_R + SHOULDER_R + forkShift(z)
  if (scen.type === 'lanedrop') return edgeLineX(z) + SHOULDER_R
  const m = mz(z)
  if (m > Z_GORE) return NB_EDGE_R + SHOULDER_R
  const t = clamp01((m - Z_END) / (Z_TAPER - Z_END))
  return accRightEdge(z) + RAMP_SHOULDER_R + (SHOULDER_R - RAMP_SHOULDER_R) * (1 - t)
}

export interface Strip { z0: number; z1: number; l: (z: number) => number; r: (z: number) => number }
/** every piece of paved road in the current scenario (z0 > z1) */
export function strips(): Strip[] {
  const out: Strip[] = []
  const hwLeft = NB_EDGE_L - NB_SHOULDER_L
  if (scen.type === 'fork') {
    const midR = NB_X[2] + LANE / 2 + NB_SHOULDER_L
    out.push({ z0: Z_TOP, z1: FORK_Z, l: () => hwLeft, r: () => NB_EDGE_R + SHOULDER_R })
    out.push({ z0: FORK_Z, z1: Z_FINISH, l: () => hwLeft, r: () => midR })
    out.push({ z0: FORK_Z, z1: Z_FINISH, l: (z) => NB_X[2] + LANE / 2 - NB_SHOULDER_L + forkShift(z), r: (z) => NB_EDGE_R + SHOULDER_R + forkShift(z) })
  } else if (scen.type === 'lanedrop') {
    out.push({ z0: Z_TOP, z1: Z_FINISH, l: () => hwLeft, r: nbPavementRight })
  } else {
    out.push({ z0: Z_TOP, z1: Z_FINISH, l: () => hwLeft, r: nbPavementRight })
    const [a, b] = scen.type === 'exit' ? [EXIT_C - Z_GORE, EXIT_C - Z_START - 5] : [Z_START + 5, Z_GORE]
    out.push({ z0: a, z1: b, l: (z) => rampX(z) - (LANE / 2 + RAMP_SHOULDER_L) * RAMP_K, r: (z) => rampX(z) + (LANE / 2 + RAMP_SHOULDER_R) * RAMP_K })
  }
  out.push({ z0: Z_TOP, z1: Z_FINISH, l: () => SB_EDGE_OUT - SHOULDER_R, r: () => SB_EDGE_IN + NB_SHOULDER_L })
  return out
}

export function onRoad(x: number, z: number): boolean {
  for (const s of strips()) if (z <= s.z0 && z >= s.z1 - 1 && x >= s.l(z) && x <= s.r(z)) return true
  return false
}

/** the pose the player starts in */
export function startPose() {
  if (scen.type === 'merge') return { x: rampX(Z_START), z: Z_START, h: rampHeading(Z_START) }
  if (scen.type === 'lanedrop') return { x: NB_X[4], z: SPAWN_Z, h: 0 }
  return { x: NB_X[2], z: SPAWN_Z, h: 0 }
}

/** Where to put the player back after leaving the road: the nearest sensible lane, at rest, facing along it. */
export function recoverPose(_x: number, z: number) {
  if (scen.type === 'merge') {
    if (z > Z_GORE) {
      const zz = Math.min(Z_START - 10, Math.max(Z_GORE + 20, z))
      return { x: rampX(zz), z: zz, h: rampHeading(zz) }
    }
    const zz = Math.min(Z_GORE - 10, Math.max(Z_END + 60, z))
    return { x: ACC_X, z: zz, h: 0 }
  }
  return { x: NB_X[2], z: Math.min(z, SPAWN_Z), h: 0 }
}
