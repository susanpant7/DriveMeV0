/** Real-city road network built from baked OpenStreetMap data (see scripts/bake-city.mjs). Pure data, no rendering. */

export interface RawRoad { h: string; n?: string; l?: number; o?: 1 | -1; v?: number; r?: 1; k: number[] }
export interface RawBuilding { h: number; p: number[] }
export interface CityData {
  id: string
  name: string
  hand: 'right' | 'left'
  bbox: number[]
  origin: [number, number]
  size: [number, number]
  nodes: Record<string, [number, number]>
  roads: RawRoad[]
  signals: number[]
  stops: number[]
  crossings: number[]
  buildings: RawBuilding[]
  attribution: string
}

export interface GNode {
  id: number
  x: number
  z: number
  signal: boolean
  stop: boolean
  crossing: boolean
  out: number[] // directed edge ids leaving this node
  inn: number[] // directed edge ids arriving
  roundabout: boolean
}

/** A directed edge: one carriageway between two junctions, with its own lane count. */
export interface GEdge {
  id: number
  from: number
  to: number
  pts: number[] // x, z pairs along the carriageway centreline (right-hand lane offsets are applied by the consumer)
  cum: number[]
  len: number
  hw: string
  name?: string
  lanes: number // lanes in this direction
  width: number // full paved width of the road this edge belongs to (both directions)
  speed: number // m/s
  roundabout: boolean
  oneWay: boolean
  reverse: number // id of the opposite-direction edge, or -1
}

export interface Graph {
  nodes: Map<number, GNode>
  edges: GEdge[]
  bounds: { x0: number; z0: number; x1: number; z1: number }
}

const LANE_W = 3.4
const DEFAULT_LANES: Record<string, number> = { motorway: 3, trunk: 2, primary: 2, secondary: 2, tertiary: 1, unclassified: 1, residential: 1, living_street: 1, service: 1 }
const DEFAULT_MPH: Record<string, number> = { motorway: 65, trunk: 55, primary: 35, secondary: 30, tertiary: 25, unclassified: 25, residential: 25, living_street: 15, service: 15 }
const base = (hw: string) => hw.replace('_link', '')
export const isDrivable = (hw: string) => hw in DEFAULT_LANES || base(hw) in DEFAULT_LANES

export function buildGraph(city: CityData): Graph {
  const pos = (id: number) => city.nodes[id]
  const signals = new Set(city.signals)
  const stops = new Set(city.stops)
  const crossings = new Set(city.crossings)

  // which OSM nodes are junctions: used by 2+ ways, or a way end, or carry a signal / stop sign
  const uses = new Map<number, number>()
  const roads = city.roads.filter((r) => r.k.length >= 2 && r.k.every((k) => pos(k)) && isDrivable(r.h))
  for (const r of roads) for (const k of r.k) uses.set(k, (uses.get(k) ?? 0) + 1)
  const isJunction = (k: number, i: number, len: number) => i === 0 || i === len - 1 || (uses.get(k) ?? 0) > 1 || signals.has(k) || stops.has(k)

  const nodes = new Map<number, GNode>()
  const node = (k: number): GNode => {
    let n = nodes.get(k)
    if (!n) {
      const [x, z] = pos(k)
      n = { id: k, x, z, signal: signals.has(k), stop: stops.has(k), crossing: crossings.has(k), out: [], inn: [], roundabout: false }
      nodes.set(k, n)
    }
    return n
  }

  const edges: GEdge[] = []
  const addEdge = (from: number, to: number, pts: number[], r: RawRoad, lanes: number, width: number, oneWay: boolean) => {
    const cum = [0]
    for (let i = 2; i < pts.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]))
    const mph = r.v ?? DEFAULT_MPH[base(r.h)] ?? 25
    const e: GEdge = { id: edges.length, from, to, pts, cum, len: cum[cum.length - 1], hw: r.h, name: r.n, lanes, width, speed: (mph * 0.44704), roundabout: !!r.r, oneWay, reverse: -1 }
    edges.push(e)
    node(from).out.push(e.id)
    node(to).inn.push(e.id)
    if (r.r) { node(from).roundabout = true; node(to).roundabout = true }
    return e
  }

  for (const r of roads) {
    const oneWay = r.o !== undefined || !!r.r
    const total = r.l ?? DEFAULT_LANES[base(r.h)] * (oneWay ? 1 : 2)
    const perDir = oneWay ? Math.max(1, total) : Math.max(1, Math.round(total / 2))
    const width = (oneWay ? perDir : perDir * 2) * LANE_W
    let start = 0
    for (let i = 1; i < r.k.length; i++) {
      if (!isJunction(r.k[i], i, r.k.length)) continue
      const ids = r.k.slice(start, i + 1)
      const pts = ids.flatMap((k) => pos(k))
      const rev = [...ids].reverse().flatMap((k) => pos(k))
      if (r.o === -1) {
        addEdge(ids[ids.length - 1], ids[0], rev, r, perDir, width, true)
      } else if (oneWay) {
        addEdge(ids[0], ids[ids.length - 1], pts, r, perDir, width, true)
      } else {
        const a = addEdge(ids[0], ids[ids.length - 1], pts, r, perDir, width, false)
        const b = addEdge(ids[ids.length - 1], ids[0], rev, r, perDir, width, false)
        a.reverse = b.id
        b.reverse = a.id
      }
      start = i
    }
  }

  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity
  for (const n of nodes.values()) { x0 = Math.min(x0, n.x); z0 = Math.min(z0, n.z); x1 = Math.max(x1, n.x); z1 = Math.max(z1, n.z) }
  return { nodes, edges, bounds: { x0, z0, x1, z1 } }
}

/** Position and unit tangent at distance s along an edge's centreline. */
export function edgeAt(e: GEdge, s: number, out: { x: number; z: number; dx: number; dz: number }) {
  const { pts, cum } = e
  if (s < 0) s = 0
  if (s > e.len) s = e.len
  let i = 1
  while (i < cum.length - 1 && cum[i] < s) i++
  const seg = cum[i] - cum[i - 1] || 1
  const t = (s - cum[i - 1]) / seg
  const ax = pts[(i - 1) * 2], az = pts[(i - 1) * 2 + 1], bx = pts[i * 2], bz = pts[i * 2 + 1]
  out.x = ax + (bx - ax) * t
  out.z = az + (bz - az) * t
  const l = Math.hypot(bx - ax, bz - az) || 1
  out.dx = (bx - ax) / l
  out.dz = (bz - az) / l
}

/** Uniform grid over the road segments, for "how far am I from the road" queries. */
export class RoadIndex {
  private cell = 40
  private cells = new Map<string, Array<[number, number]>>() // key -> [edge id, segment index]
  constructor(private g: Graph) {
    for (const e of g.edges) {
      if (e.oneWay === false && e.id > e.reverse) continue // the two directions share the same centreline
      for (let i = 0; i < e.pts.length - 2; i += 2) {
        const minx = Math.min(e.pts[i], e.pts[i + 2]) - e.width, maxx = Math.max(e.pts[i], e.pts[i + 2]) + e.width
        const minz = Math.min(e.pts[i + 1], e.pts[i + 3]) - e.width, maxz = Math.max(e.pts[i + 1], e.pts[i + 3]) + e.width
        for (let cx = Math.floor(minx / this.cell); cx <= Math.floor(maxx / this.cell); cx++) for (let cz = Math.floor(minz / this.cell); cz <= Math.floor(maxz / this.cell); cz++) {
          const k = cx + ',' + cz
          let l = this.cells.get(k)
          if (!l) this.cells.set(k, (l = []))
          l.push([e.id, i / 2])
        }
      }
    }
  }
  /** nearest road: its edge, the distance from the centreline and whether (x, z) is on the paved surface */
  nearest(x: number, z: number) {
    const list = this.cells.get(Math.floor(x / this.cell) + ',' + Math.floor(z / this.cell))
    let best: { edge: GEdge; d: number; s: number; side: number } | null = null
    if (!list) return null
    for (const [eid, si] of list) {
      const e = this.g.edges[eid]
      const ax = e.pts[si * 2], az = e.pts[si * 2 + 1], bx = e.pts[si * 2 + 2], bz = e.pts[si * 2 + 3]
      const vx = bx - ax, vz = bz - az
      const l2 = vx * vx + vz * vz || 1
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / l2))
      const px = ax + vx * t, pz = az + vz * t
      const d = Math.hypot(x - px, z - pz)
      if (!best || d < best.d) best = { edge: e, d, s: e.cum[si] + t * (e.cum[si + 1] - e.cum[si]), side: (x - px) * -vz + (z - pz) * vx }
    }
    return best
  }
  onRoad(x: number, z: number) {
    const n = this.nearest(x, z)
    return !!n && n.d <= n.edge.width / 2 + 0.3
  }
}
