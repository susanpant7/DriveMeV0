/**
 * The highway merge course. Everything lies along the z axis: traffic on the main highway runs north (-z, heading 0), the same way
 * the player faces at the start. x grows to the player's right.
 *
 *   z = 1500   start of the on-ramp (a one-lane road)
 *   z =  420   the gore: the ramp becomes an acceleration (merge) lane beside the right lane of the highway
 *   z =  120   the merge lane starts to taper
 *   z =   20   the merge lane ends: you must be on the highway before this
 *   z = -3500  end of the course
 */
export const LANE = 3.7
/** centres of the three northbound lanes (0 = left / fast, 2 = right / slow) */
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

export const Z_START = 903 // 0.3 mile of ramp (483 m) ahead of the gore
export const Z_RAMP_BEND = 520 // the ramp is dead straight until here, then a straight diagonal into the merge lane (no curves) // the ramp is straight until here, then bends toward the highway
export const Z_GORE = 420
export const Z_TAPER = 120
export const Z_END = 20
export const Z_FINISH = -3300 // course end
export const Z_BEGIN_NB = 1000 // the northbound carriageway exists from here on (further back it is just the ramp)
export const Z_BEGIN_SB = 1000
export const RAMP_X0 = 25.5 // the ramp runs straight, parallel to the highway, this far to the right (x)
export const ACC_X = NB_X[NB_X.length - 1] + LANE // centre of the merge lane at the gore
export const ACC_EDGE_R = ACC_X + LANE / 2 // right edge line of the merge lane (full width)

export const RAMP_SHOULDER_L = 1.2
export const RAMP_SHOULDER_R = 2.4


/** x of the centre of the ramp lane at z (for z >= Z_GORE; below that it is the merge lane) */
export function rampX(z: number) {
  if (z <= Z_GORE) return ACC_X
  if (z >= Z_RAMP_BEND) return RAMP_X0
  return ACC_X + (RAMP_X0 - ACC_X) * ((z - Z_GORE) / (Z_RAMP_BEND - Z_GORE))
}
/** heading (rad, 0 = north) of the ramp at z */
export function rampHeading(z: number) {
  if (z <= Z_GORE || z >= Z_RAMP_BEND) return 0
  const e = 0.5
  const dx = rampX(z + e) - rampX(z - e)
  return Math.atan2(dx, 2 * e) // driving north (z falling) the ramp moves toward -x, i.e. the car turns left (positive heading)
}

/** right edge line of the merge lane (the right edge of the paved lane) */
export function accRightEdge(z: number) {
  if (z >= Z_TAPER) return ACC_EDGE_R
  if (z <= Z_END) return NB_EDGE_R
  return NB_EDGE_R + (ACC_EDGE_R - NB_EDGE_R) * ((z - Z_END) / (Z_TAPER - Z_END))
}
/** is z within the span of the merge lane (gore to end)? */
export const inMergeLane = (z: number) => z <= Z_GORE && z >= Z_END

/** right edge of the northbound pavement (including the shoulder) at z */
export function nbPavementRight(z: number) {
  if (z > Z_GORE) return NB_EDGE_R + SHOULDER_R
  return accRightEdge(z) + (z >= Z_TAPER ? RAMP_SHOULDER_R : RAMP_SHOULDER_R + (SHOULDER_R - RAMP_SHOULDER_R) * (1 - (z - Z_END) / (Z_TAPER - Z_END)))
}

export type Zone = 'ramp' | 'merge' | 'highway' | 'off'

/** Is this point on paved road (lanes or shoulders)? */
export function onRoad(x: number, z: number): boolean {
  // the ramp
  if (z > Z_GORE - 0.001 && z <= Z_START + 5) {
    const cx = rampX(z)
    if (x >= cx - LANE / 2 - RAMP_SHOULDER_L && x <= cx + LANE / 2 + RAMP_SHOULDER_R) return true
  }
  // the northbound carriageway (with the merge lane beside it)
  if (z <= Z_BEGIN_NB && z >= Z_FINISH - 5) {
    if (x >= NB_EDGE_L - NB_SHOULDER_L && x <= nbPavementRight(z)) return true
  }
  // the southbound carriageway
  if (z <= Z_BEGIN_SB && z >= Z_FINISH - 5) {
    if (x >= SB_EDGE_OUT - SHOULDER_R && x <= SB_EDGE_IN + NB_SHOULDER_L) return true
  }
  return false
}

/** which lane of the northbound carriageway is x in? 0..2, 3 = the merge lane / right shoulder side, -1 = left of the lanes */
export function nbLaneAt(x: number) {
  if (x < NB_EDGE_L) return -1
  if (x > NB_EDGE_R) return NB_X.length
  return Math.min(NB_X.length - 1, Math.floor((x - NB_EDGE_L) / LANE))
}

export function zoneAt(x: number, z: number): Zone {
  if (!onRoad(x, z)) return 'off'
  if (z > Z_GORE) return 'ramp'
  if (x > NB_EDGE_R + 0.2) return 'merge'
  return 'highway'
}

/** the pose the player starts in: on the ramp, in the middle of its lane, facing along it */
export function startPose() {
  return { x: RAMP_X0, z: Z_START, h: 0 }
}

/** Where to put the player back after leaving the road: the nearest point on the ramp / merge lane, at rest, facing north. */
export function recoverPose(_x: number, z: number) {
  if (z > Z_GORE) {
    const zz = Math.min(Z_START - 10, Math.max(Z_GORE + 20, z))
    return { x: rampX(zz), z: zz, h: rampHeading(zz) }
  }
  const zz = Math.min(Z_GORE - 10, Math.max(Z_END + 60, z))
  return { x: ACC_X, z: zz, h: 0 }
}
