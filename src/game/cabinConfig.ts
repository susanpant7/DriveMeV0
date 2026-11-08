import * as THREE from 'three'
import { IS_COARSE } from './device'
import type { Look } from './store'

/** Driver's eye position, relative to the car origin (car faces -z, left-hand drive). */
export const EYE = new THREE.Vector3(-0.4, 1.24, 0)

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
// mirror reflection textures: half size on phones / tablets
const RES_SIDE: [number, number] = IS_COARSE ? [960, 648] : [1300, 880]
const RES_REAR: [number, number] = IS_COARSE ? [768, 232] : [1024, 310]

// Side mirrors are aimed almost straight back so the inner edge catches your own car's
// flank, exactly as a properly adjusted door mirror does.
// on a phone the whole scene is small, so the mirrors are a little bigger (still a fixed size: they never grow or zoom)
const K = IS_COARSE ? 1.3 : 1
export const MIRRORS: MirrorCfg[] = [
  mirror('left', V(-1.2, 1.05, -0.55), [0.3 * K, 0.2 * K], RES_SIDE, V(-0.17, -0.07, 1), 1),
  // hung from the middle of the windshield header: up and to the driver's right, so it is out of sight until you glance up and across
  mirror('center', V(0.02, 1.56, -0.6), [0.3, 0.095], RES_REAR, V(0, -0.075, 1), 0),
  mirror('right', V(1.22, 1.05, -0.6), [0.33 * K, 0.22 * K], RES_SIDE, V(0.17, -0.07, 1), -1),
]

export interface LookTarget {
  yaw: number
  pitch: number
  fov: number
  lean: THREE.Vector3 // head movement (cabin space)
}

/**
 * A glance at a mirror: the head turns only part of the way (about a third to a half) and the eyes do the rest, so the
 * mirror sits off to the side of your view instead of filling it, and nothing zooms. The field of view stays constant.
 */
function glance(m: MirrorCfg, turn: number, pitchK: number, lean: THREE.Vector3): LookTarget {
  const d = m.pos.clone().sub(EYE)
  return {
    yaw: Math.atan2(-d.x, -d.z) * turn,
    pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) * pitchK,
    fov: 60.6, // the lens never zooms: your field of view is the same whichever way you look
    lean,
  }
}

/** The head direction that points straight at each mirror (yaw + = left, pitch + = up, absolute from the horizon). */
export const MIRROR_AIM: Record<'left' | 'center' | 'right', { yaw: number; pitch: number }> = (() => {
  const aim = (m: MirrorCfg) => {
    const d = m.pos.clone().sub(EYE)
    return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) }
  }
  return { left: aim(MIRRORS[0]), center: aim(MIRRORS[1]), right: aim(MIRRORS[2]) }
})()
export const FRONT_PITCH = -0.17 // the resting view: nearly level (about 10 degrees down), so the road fills most of the screen and the dash is a band at the bottom

export const LOOK_TARGETS: Record<Look, LookTarget> = {
  front: { yaw: 0, pitch: FRONT_PITCH, fov: 60.6, lean: V(0, 0, 0) },
  left: glance(MIRRORS[0], 0.5, 0.45, V(-0.05, 0, -0.02)),
  center: glance(MIRRORS[1], 0.8, 0.85, V(0.05, 0.03, 0)),
  right: glance(MIRRORS[2], 0.6, 0.45, V(0.14, 0, -0.04)),
}

/** Euler that makes a plane (normal +z) at `pos` face the driver's eye. */
export function faceEuler(pos: THREE.Vector3) {
  const n = EYE.clone().sub(pos).normalize()
  return new THREE.Euler(-Math.asin(n.y), Math.atan2(n.x, n.z), 0, 'YXZ')
}
