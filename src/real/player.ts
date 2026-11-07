import type { GEdge } from './graph'
import { edgeAt } from './graph'
import { WORLD } from './world'

export interface Located { e: GEdge; s: number; d: number; side: number }
const o = { x: 0, z: 0, dx: 0, dz: 0 }

/** The road the car is on, in the direction it is travelling: distance along it, distance from its centreline, and which side (+ = right). */
export function locate(px: number, pz: number, h: number): Located | null {
  const n = WORLD.index!.nearest(px, pz)
  if (!n) return null
  let { edge: e, s, side } = n
  const g = WORLD.graph!
  edgeAt(e, s, o)
  if (o.dx * -Math.sin(h) + o.dz * -Math.cos(h) < 0 && e.reverse >= 0) { e = g.edges[e.reverse]; s = e.len - s; side = -side }
  return { e, s, d: n.d, side: side / (Math.hypot(o.dx, o.dz) || 1) }
}
