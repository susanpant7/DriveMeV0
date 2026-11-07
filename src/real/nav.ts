import { nav } from '../game/nav'
import type { GEdge } from './graph'
import { edgeAt } from './graph'
import { WORLD } from './world'

/** Route state for a real city. The text fields are written into the shared `nav` object the HUD already reads. */
export const rnav = {
  route: [] as number[], // edge ids from the car's road to the destination
  k: 0,
  dest: -1, // destination node id
  pos: new Map<number, number>(), // edge id -> index in route
}

const rnd = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
const o = { x: 0, z: 0, dx: 0, dz: 0 }
const edgeName = (e: GEdge) => e.name ?? (e.hw === 'service' ? 'the service road' : e.hw === 'residential' ? 'the side street' : 'the road')

/** Dijkstra over directed edges, no U-turns. Returns the edge list, or the distance map when no target is given. */
function dijkstra(fromEdge: number, to: number | null) {
  const g = WORLD.graph!
  const dist = new Map<number, number>()
  const prev = new Map<number, number>() // edge -> previous edge
  const first = g.edges[fromEdge]
  const heap: Array<[number, number]> = [[first.len, fromEdge]]
  dist.set(fromEdge, first.len)
  const popMin = () => {
    let bi = 0
    for (let i = 1; i < heap.length; i++) if (heap[i][0] < heap[bi][0]) bi = i
    return heap.splice(bi, 1)[0]
  }
  while (heap.length) {
    const [d, eid] = popMin()
    if (d > (dist.get(eid) ?? Infinity)) continue
    const e = g.edges[eid]
    if (to !== null && e.to === to) {
      const path = [eid]
      let p = eid
      while (prev.has(p)) { p = prev.get(p)!; path.push(p) }
      return { path: path.reverse(), dist }
    }
    for (const nid of g.nodes.get(e.to)!.out) {
      const n = g.edges[nid]
      if (nid === e.reverse) continue
      const nd = d + n.len * (n.hw === 'service' ? 1.3 : 1)
      if (nd < (dist.get(nid) ?? Infinity)) { dist.set(nid, nd); prev.set(nid, eid); heap.push([nd, nid]) }
    }
  }
  return { path: null as number[] | null, dist }
}

function setRoute(path: number[]) {
  rnav.route = path
  rnav.k = 0
  rnav.pos.clear()
  path.forEach((id, i) => rnav.pos.set(id, i))
}

function newDestination(fromEdge: number) {
  const g = WORLD.graph!
  const { dist } = dijkstra(fromEdge, null)
  const far = [...dist.entries()].filter(([, d]) => d > 450 && d < 1500)
  const pool = far.length ? far : [...dist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  const [dest] = rnd(pool)
  const target = g.edges[dest].to
  rnav.dest = target
  const r = dijkstra(fromEdge, target)
  setRoute(r.path ?? [fromEdge])
}

/** Picks a start road in the connected part of the map and a destination about a kilometre away. Returns where to put the car. */
export function startRealRoute() {
  const g = WORLD.graph!
  // start near the middle of the downloaded area (the edges of the map have nothing beyond them)
  const mid = (e: GEdge) => { edgeAt(e, e.len / 2, o); return Math.hypot(o.x, o.z) < 380 }
  const candidates = g.edges.filter((e) => e.len > 70 && e.hw !== 'service' && e.hw !== 'motorway' && !e.hw.endsWith('_link') && mid(e))
  for (let tries = 0; tries < 40; tries++) {
    const e = rnd(candidates.length ? candidates : g.edges)
    const { dist } = dijkstra(e.id, null)
    if (dist.size < 60) continue
    newDestination(e.id)
    edgeAt(e, 18, o)
    const lane = e.oneWay ? Math.floor((e.lanes - 1) / 2) : e.lanes - 1
    const off = e.oneWay ? (lane - (e.lanes - 1) / 2) * 3.4 : (lane + 0.5) * 3.4
    nav.arrived = 0
    return { x: o.x - o.dz * off, z: o.z + o.dx * off, h: Math.atan2(-o.dx, -o.dz) }
  }
  const e = g.edges[0]
  edgeAt(e, Math.min(5, e.len / 2), o)
  setRoute([e.id])
  return { x: o.x, z: o.z, h: Math.atan2(-o.dx, -o.dz) }
}

const turnWord = (a: GEdge, b: GEdge): 'S' | 'L' | 'R' | 'U' => {
  edgeAt(a, a.len - 0.5, o)
  const tx = o.dx, tz = o.dz
  edgeAt(b, Math.min(1.5, b.len), o)
  const dot = tx * o.dx + tz * o.dz
  const cross = tx * o.dz - tz * o.dx
  if (dot > 0.88) return 'S'
  if (dot < -0.85) return 'U'
  return cross > 0 ? 'R' : 'L'
}

function describe(k: number): { text: string; sub: string; icon: string; dist: number } {
  const g = WORLD.graph!
  const r = rnav.route
  let dist = 0
  for (let j = k; j < r.length; j++) {
    const e = g.edges[r[j]]
    if (j === r.length - 1) return { text: 'Destination ahead', sub: edgeName(e), icon: 'F', dist: dist + e.len }
    const nx = g.edges[r[j + 1]]
    // a roundabout: count the exits until the route leaves it
    if (nx.roundabout && !e.roundabout) {
      let exits = 0, m = j + 1
      while (m < r.length && g.edges[r[m]].roundabout) {
        const node = g.nodes.get(g.edges[r[m]].to)!
        if (node.out.some((id) => !g.edges[id].roundabout)) exits++
        m++
      }
      const out = g.edges[r[Math.min(m, r.length - 1)]]
      return { text: `Roundabout: take exit ${Math.max(1, exits)}`, sub: `onto ${edgeName(out)}`, icon: `O${Math.min(4, Math.max(1, exits))}`, dist: dist + e.len }
    }
    if (!e.roundabout || !nx.roundabout) {
      const t = turnWord(e, nx)
      if (t !== 'S') return { text: t === 'L' ? 'Turn left' : t === 'R' ? 'Turn right' : 'Make a U-turn', sub: `onto ${edgeName(nx)}`, icon: t, dist: dist + e.len }
    }
    dist += e.len
    if (dist > 700) return { text: 'Continue straight', sub: `on ${edgeName(e)}`, icon: 'S', dist }
  }
  return { text: 'Continue straight', sub: '', icon: 'S', dist }
}

/** Per frame: where am I on the route, what is next, and did I just arrive or take a wrong turn? Returns a message to show. */
export function realNavUpdate(px: number, pz: number, h: number): string | null {
  const g = WORLD.graph!
  const idx = WORLD.index!
  const n = idx.nearest(px, pz)
  if (!n || n.d > n.edge.width / 2 + 6) return null
  let e = n.edge
  let s = n.s
  const fx = -Math.sin(h), fz = -Math.cos(h)
  edgeAt(e, s, o)
  if (o.dx * fx + o.dz * fz < 0 && e.reverse >= 0) { s = e.len - s; e = g.edges[e.reverse] } // driving the other way along a two-way road
  let msg: string | null = null
  const at = rnav.pos.get(e.id)
  if (at !== undefined) rnav.k = at
  else if (s > 22 && e.len - s > 4 && n.d < e.width / 2 + 1 && e.id !== rnav.route[rnav.k]) {
    // well past the junction and still on a road that is not on the route
    // left the route: plan a new one from here
    const r = dijkstra(e.id, rnav.dest)
    if (r.path) { setRoute(r.path); msg = 'Wrong turn: recalculating the route' }
    else newDestination(e.id)
  }
  const d = describe(rnav.k)
  nav.text = d.text
  nav.sub = d.sub
  nav.icon = d.icon
  nav.dist = Math.max(0, d.dist - (rnav.k < rnav.route.length ? s : 0))
  if (rnav.k === rnav.route.length - 1 && e.len - s < 14) {
    nav.arrived++
    const name = edgeName(e)
    newDestination(e.id)
    return `You have arrived: ${name}`
  }
  return msg
}
