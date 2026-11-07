import { rnav } from '../real/nav'
import { WORLD } from '../real/world'

interface Cached { id: string; major: Path2D; minor: Path2D; service: Path2D; buildings: Path2D; signals: Path2D; labels: Array<{ x: number; z: number; text: string; ang: number }> }
let cache: Cached | null = null

function build(): Cached {
  const city = WORLD.city!
  const g = WORLD.graph!
  const major = new Path2D(), minor = new Path2D(), service = new Path2D(), buildings = new Path2D(), signals = new Path2D()
  const labels: Cached['labels'] = []
  const seen = new Set<string>()
  for (const e of g.edges) {
    if (!(e.oneWay || e.id < e.reverse)) continue
    const p = e.hw === 'service' ? service : e.hw === 'residential' || e.hw === 'unclassified' || e.hw === 'living_street' ? minor : major
    for (let i = 0; i < e.pts.length; i += 2) {
      if (i === 0) p.moveTo(e.pts[i], e.pts[i + 1])
      else p.lineTo(e.pts[i], e.pts[i + 1])
    }
    if (e.name && e.len > 60 && !seen.has(e.name + Math.floor(e.pts[0] / 150) + Math.floor(e.pts[1] / 150))) {
      seen.add(e.name + Math.floor(e.pts[0] / 150) + Math.floor(e.pts[1] / 150))
      const mid = Math.floor(e.pts.length / 4) * 2
      const dx = e.pts[mid + 2] - e.pts[mid], dz = e.pts[mid + 3] - e.pts[mid + 1]
      labels.push({ x: e.pts[mid], z: e.pts[mid + 1], text: e.name, ang: Math.atan2(dz, dx) })
    }
  }
  for (const b of city.buildings) {
    for (let i = 0; i < b.p.length; i += 2) {
      if (i === 0) buildings.moveTo(b.p[i], b.p[i + 1])
      else buildings.lineTo(b.p[i], b.p[i + 1])
    }
    buildings.closePath()
  }
  for (const n of g.nodes.values()) if (n.signal) signals.rect(n.x - 3, n.z - 3, 6, 6)
  return { id: city.id, major, minor, service, buildings, signals, labels }
}

/** The real city inside the (already transformed, heading-up) map view: roads, buildings, the blue route and street names. */
export function drawRealWorld(g: CanvasRenderingContext2D, vx: number, vz: number, S: number, R: number, viewH: number) {
  if (!cache || cache.id !== WORLD.city!.id) cache = build()
  const c = cache
  g.lineJoin = 'round'
  g.lineCap = 'round'
  g.fillStyle = '#1c2a3a'
  g.fill(c.buildings)
  // casing then surface, bigger roads wider
  const draw = (p: Path2D, w: number) => {
    g.strokeStyle = '#05080c'; g.lineWidth = w + 3 / S; g.stroke(p)
    g.strokeStyle = '#56657b'; g.lineWidth = w; g.stroke(p)
  }
  draw(c.service, 4)
  draw(c.minor, 7)
  draw(c.major, 11)
  g.fillStyle = '#f5c518'
  g.fill(c.signals)
  // street names
  if (S > 0.5) {
    g.fillStyle = 'rgba(235,242,250,.9)'
    g.font = '600 11px system-ui, sans-serif'
    g.textAlign = 'center'; g.textBaseline = 'middle'
    let drawn = 0
    for (const lb of c.labels) {
      if (drawn > 12 || Math.hypot(lb.x - vx, lb.z - vz) > R * 0.8) continue
      drawn++
      g.save()
      g.translate(lb.x, lb.z)
      let a = lb.ang
      if (Math.cos(a + viewH) < 0) a += Math.PI
      g.rotate(a)
      g.scale(1 / S, 1 / S)
      g.lineWidth = 3; g.strokeStyle = 'rgba(10,15,22,.85)'; g.strokeText(lb.text, 0, 0)
      g.fillText(lb.text, 0, 0)
      g.restore()
    }
  }
  // the route
  const ge = WORLD.graph!
  const r = rnav.route
  if (rnav.k < r.length) {
    g.beginPath()
    let first = true
    for (let j = rnav.k; j < r.length; j++) {
      const e = ge.edges[r[j]]
      for (let i = j === rnav.k ? 0 : 0; i < e.pts.length; i += 2) {
        if (first) { g.moveTo(e.pts[i], e.pts[i + 1]); first = false } else g.lineTo(e.pts[i], e.pts[i + 1])
      }
    }
    g.strokeStyle = 'rgba(8,30,70,.9)'; g.lineWidth = 11 / S; g.stroke()
    g.strokeStyle = '#3b9dff'; g.lineWidth = 7.5 / S; g.stroke()
    const last = ge.edges[r[r.length - 1]]
    const lx = last.pts[last.pts.length - 2], lz = last.pts[last.pts.length - 1]
    g.fillStyle = '#ff4b4b'; g.beginPath(); g.arc(lx, lz, 9 / S, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#fff'; g.beginPath(); g.arc(lx, lz, 3.6 / S, 0, Math.PI * 2); g.fill()
  }
}
