import * as THREE from 'three'
import { IS_COARSE } from './device'
import type { Look } from './store'

/** Driver's eye position, relative to the car origin (car faces -z, left-hand drive). */
export const EYE = new THREE.Vector3(-0.335, 1.17, 0)

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
// mirrors are what a learner drives by: their pictures are rendered sharp (well above their size on screen)
const RES_SIDE: [number, number] = IS_COARSE ? [900, 610] : [1400, 950]
const RES_REAR: [number, number] = IS_COARSE ? [640, 195] : [800, 244]

// The mirrors are where the car model (a Toyota Camry) has them: the door mirrors on the doors at the foot of the A-pillars, the
// rear-view mirror on the windshield. Their glass is the model's own outline and real size (see carModel.ts).
// Side mirrors are aimed almost straight back so the inner edge catches your own car's flank, as a properly set door mirror does.
/** the model's glass: centre and the way it faces (used to lay the reflecting glass into the housing) */
export const GLASS: Record<'left' | 'center' | 'right', { c: THREE.Vector3; n: THREE.Vector3 }> = {
  left: { c: V(-0.883, 0.9858, -0.7259), n: V(0.3576, 0.006, 0.9339) },
  center: { c: V(0.0156, 1.1933, -0.361), n: V(0, 0.0162, 0.9999) },
  right: { c: V(0.9143, 0.9858, -0.7259), n: V(-0.3574, 0.0058, 0.9339) },
}
export const MIRRORS: MirrorCfg[] = [
  mirror('left', GLASS.left.c.clone(), [0.218, 0.129], RES_SIDE, V(-0.085, -0.012, 1), 1),
  mirror('center', GLASS.center.c.clone(), [0.233, 0.055], RES_REAR, V(0, 0.0, 1), 0),
  mirror('right', GLASS.right.c.clone(), [0.218, 0.129], RES_SIDE, V(0.045, -0.012, 1), -1),
]

/** The driver's own adjustment of each mirror (radians): click a mirror, then use the arrow keys. Saved between sessions. */
export const mirrorAdj: Record<'left' | 'center' | 'right', { yaw: number; pitch: number }> = (() => {
  const base = { left: { yaw: 0, pitch: 0 }, center: { yaw: 0, pitch: 0 }, right: { yaw: 0, pitch: 0 } }
  try { const v = JSON.parse(localStorage.getItem('driveme.mirrors2') || 'null'); if (v) return { ...base, ...v } } catch { /* ignore */ }
  return base
})()
export const adjust = { sel: null as null | 'left' | 'center' | 'right', dragging: false }
export const saveMirrors = () => { try { localStorage.setItem('driveme.mirrors2', JSON.stringify(mirrorAdj)) } catch { /* ignore */ } }
/** where each mirror (and the dash screen) currently is on screen, in pixels; filled in every frame by the camera rig */
export const mirrorScreen: Record<string, { x: number; y: number; r: number; ok: boolean }> = { left: { x: 0, y: 0, r: 0, ok: false }, center: { x: 0, y: 0, r: 0, ok: false }, right: { x: 0, y: 0, r: 0, ok: false } }

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

/** The car's centre screen (map; a repeater of the right door mirror while indicating right). */
export const CARPLAY = { pos: V(0.031, 0.903, -0.7455), rot: [-0.367, 0, 0] as [number, number, number], W: 0.232, H: 0.15 }

/** The head direction that points straight at each mirror (yaw + = left, pitch + = up, absolute from the horizon). */
export const MIRROR_AIM: Record<'left' | 'center' | 'right', { yaw: number; pitch: number }> = (() => {
  const aim = (m: MirrorCfg) => {
    const d = m.pos.clone().sub(EYE)
    return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) }
  }
  return { left: aim(MIRRORS[0]), center: aim(MIRRORS[1]), right: aim(MIRRORS[2]) }
})()
/** The resting view is turned a little to the left so the whole left mirror sits on screen (the scene shifts right). */
export const FRONT_YAW = 0
export const FRONT_PITCH = -0.17 // the resting view: nearly level (about 10 degrees down), so the road fills most of the screen and the dash is a band at the bottom

export const LOOK_TARGETS: Record<Look, LookTarget> = {
  front: { yaw: FRONT_YAW, pitch: FRONT_PITCH, fov: 60.6, lean: V(0, 0, 0) },
  left: glance(MIRRORS[0], 0.5, 0.45, V(-0.05, 0, -0.02)),
  center: glance(MIRRORS[1], 0.8, 0.85, V(0.05, 0.03, 0)),
  right: glance(MIRRORS[2], 0.62, 0.45, V(0.14, 0, -0.04)),
  // A / D: a shoulder check over the left / right blind spot (head turned right round)
  blindL: { yaw: 2.3, pitch: -0.1, fov: 60.6, lean: V(-0.06, 0.02, 0.06) },
  blindR: { yaw: -2.3, pitch: -0.1, fov: 60.6, lean: V(0.1, 0.02, 0.06) },
}

/** Euler that makes a plane (normal +z) at `pos` face the driver's eye. */
export function faceEuler(pos: THREE.Vector3) {
  const n = EYE.clone().sub(pos).normalize()
  return new THREE.Euler(-Math.asin(n.y), Math.atan2(n.x, n.z), 0, 'YXZ')
}
