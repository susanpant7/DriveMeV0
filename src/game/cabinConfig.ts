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
const RES_SIDE: [number, number] = IS_COARSE ? [900, 610] : [1400, 950]
const RES_REAR: [number, number] = IS_COARSE ? [640, 195] : [800, 244]

// The left mirror sits in the lower-left of the front view, just past the A-pillar; no key is needed to see it.
// Side mirrors are aimed almost straight back so the inner edge catches your own car's
// flank, exactly as a properly adjusted door mirror does.
// on a phone the whole scene is small, so the mirrors are a little bigger (still a fixed size: they never grow or zoom)
const K = IS_COARSE ? 1.3 : 1
// on a phone the mirrors are drawn bigger and the car frame fills more of the screen, so they sit a little further out from the car
const OUT = IS_COARSE ? 0.14 : 0
export const MIRRORS: MirrorCfg[] = [
  mirror('left', V(-1.17 - OUT, 1.095, -0.9), [0.32 * K, 0.21 * K], RES_SIDE, V(-0.17, 0.02, 1), 1),
  // hung from the windshield header at the upper right of the driver's view, so it is always visible in the front view
  mirror('center', V(0.0, 1.485, -0.72), [0.27, 0.088], RES_REAR, V(0, 0.0, 1), 0),
  mirror('right', V(1.39 + OUT, 1.1, -0.9), [0.42 * K, 0.28 * K], RES_SIDE, V(0.17, 0.02, 1), -1),
]

/** The driver's own adjustment of each mirror (radians): click a mirror, then use the arrow keys. Saved between sessions. */
export const mirrorAdj: Record<'left' | 'center' | 'right', { yaw: number; pitch: number }> = (() => {
  const base = { left: { yaw: 0, pitch: 0 }, center: { yaw: 0, pitch: 0 }, right: { yaw: 0, pitch: 0 } }
  try { const v = JSON.parse(localStorage.getItem('driveme.mirrors') || 'null'); if (v) return { ...base, ...v } } catch { /* ignore */ }
  return base
})()
export const adjust = { sel: null as null | 'left' | 'center' | 'right', dragging: false }
export const saveMirrors = () => { try { localStorage.setItem('driveme.mirrors', JSON.stringify(mirrorAdj)) } catch { /* ignore */ } }
/** where each mirror (and the dash screen) currently is on screen, in pixels; filled in every frame by the camera rig */
export const mirrorScreen: Record<string, { x: number; y: number; r: number; ok: boolean }> = { left: { x: 0, y: 0, r: 0, ok: false }, center: { x: 0, y: 0, r: 0, ok: false }, carplay: { x: 0, y: 0, r: 0, ok: false } }

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

/** A repeater of the right door mirror, set into the dash at the lower right so it never blocks the view of the road. */
export const CARPLAY = { pos: V(0.008, 1.05, -0.62), rot: [-0.07, -0.17, 0] as [number, number, number], W: 0.27, H: 0.27 * (400 / 675) }

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
