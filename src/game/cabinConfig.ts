import * as THREE from 'three'
import type { Look } from './store'

/** Driver's eye position, relative to the car origin (car faces -z, left-hand drive). */
export const EYE = new THREE.Vector3(-0.4, 1.2, 0)

export interface MirrorCfg {
  id: Exclude<Look, 'front'>
  pos: THREE.Vector3
  size: [number, number]
  quat: THREE.Quaternion // orientation of the glass (plane normal is its local +z)
  res: [number, number] // reflection texture resolution
  inner: 1 | -1 | 0 // glass-local side that faces the car body (side mirrors)
}

/**
 * A mirror is a flat reflector. Its angle is chosen so that a ray from the driver's
 * eye bounces to `aimDir` (where the driver "wants" to look behind the car). That
 * is exactly how a real mirror is adjusted, and the blind spot falls out of the
 * optics instead of being faked.
 */
function mirror(id: MirrorCfg['id'], pos: THREE.Vector3, size: [number, number], res: [number, number], aimDir: THREE.Vector3, inner: 1 | -1 | 0): MirrorCfg {
  const d = pos.clone().sub(EYE).normalize() // incoming ray
  const n = aimDir.clone().normalize().sub(d).normalize() // mirror normal (faces the eye)
  return { id, pos, size, res, inner, quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n) }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

// Side mirrors are aimed almost straight back so the inner edge catches your own car's
// flank, exactly as a properly adjusted door mirror does.
export const MIRRORS: MirrorCfg[] = [
  mirror('left', V(-1.08, 1.05, -0.55), [0.4, 0.27], [1300, 880], V(-0.07, -0.02, 1), 1),
  mirror('center', V(-0.3, 1.42, -0.62), [0.38, 0.115], [1024, 310], V(0, 0.03, 1), 0),
  mirror('right', V(1.03, 1.05, -0.6), [0.42, 0.28], [1300, 870], V(0.07, -0.02, 1), -1),
]

export interface LookTarget {
  yaw: number
  pitch: number
  fov: number
  lean: THREE.Vector3 // head movement (cabin space)
}

/**
 * A glance turns the head only part of the way and the eyes do the rest, so the
 * mirror ends up off to the side of the view instead of filling it. No zoom.
 */
function glance(m: MirrorCfg, turn: number, pitchK: number, lean: THREE.Vector3): LookTarget {
  const d = m.pos.clone().sub(EYE)
  return {
    yaw: Math.atan2(-d.x, -d.z) * turn,
    pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) * pitchK,
    fov: 62,
    lean,
  }
}

export const LOOK_TARGETS: Record<Look, LookTarget> = {
  front: { yaw: 0, pitch: -0.245, fov: 76, lean: V(0, 0, 0) },
  left: glance(MIRRORS[0], 0.8, 0.6, V(-0.16, 0, -0.05)),
  center: glance(MIRRORS[1], 0.5, 0.5, V(0.02, 0.03, 0)),
  right: glance(MIRRORS[2], 0.92, 0.6, V(0.32, 0, -0.07)),
}

/** Euler that makes a plane (normal +z) at `pos` face the driver's eye. */
export function faceEuler(pos: THREE.Vector3) {
  const n = EYE.clone().sub(pos).normalize()
  return new THREE.Euler(-Math.asin(n.y), Math.atan2(n.x, n.z), 0, 'YXZ')
}
