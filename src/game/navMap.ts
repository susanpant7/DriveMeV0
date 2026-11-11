import { LAYOUT, junctionOutline, armClosed, B, HORIZONTAL_NAMES, LOTS, P, VERTICAL_NAMES, clearance, dirv, flareOf, G, mod, nodeKind, rbSpec, ringDelta, segHalves } from './map'
import { fmtDist, nav, type Step } from './nav'
import { sim } from './sim'

/* ------------------------------------------------------------------ */
/* Static map geometry, built once as Path2D (one period of the city)  */
/* ------------------------------------------------------------------ */
interface MapPaths {
  land: Path2D
  parks: Path2D
  buildings: Path2D
  roads: Path2D
  centre: Path2D
  islands: Path2D
  domes: Path2D
  aprons: Path2D
  signals: Path2D
  labels: Array<{ x: number; z: number; ang: number; text: string }>
}
let paths: MapPaths | null = null
let pathsVer = -1

type V2 = [number, number]
const at = (ax: number, az: number, d: number, u: number, v: number): V2 => {
  const [dx, dz] = dirv(d), [rx, rz] = dirv(d - 1)
  return [ax + dx * u + rx * v, az + dz * u + rz * v]
}

function buildPaths(): MapPaths {
  const land = new Path2D(), parks = new Path2D(), buildings = new Path2D(), roads = new Path2D(), centre = new Path2D()
  const islands = new Path2D(), domes = new Path2D(), aprons = new Path2D(), signals = new Path2D()
  const labels: MapPaths['labels'] = []
  for (const l of LOTS) {
    if (l.park) parks.rect(l.x0, l.z0, l.x1 - l.x0, l.z1 - l.z0)
    else {
      land.rect(l.x0, l.z0, l.x1 - l.x0, l.z1 - l.z0)
      buildings.rect(l.bx0, l.bz0, l.bx1 - l.bx0, l.bz1 - l.bz0)
    }
  }
  for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) {
    const cx = i * B, cz = j * B
    const spec = rbSpec(i, j)
    if (spec) {
      roads.moveTo(cx + spec.outer, cz)
      roads.arc(cx, cz, spec.outer, 0, Math.PI * 2)
      if (spec.domed) {
        domes.moveTo(cx + spec.island, cz)
        domes.arc(cx, cz, spec.island, 0, Math.PI * 2)
      } else {
        aprons.moveTo(cx + spec.apron, cz)
        aprons.arc(cx, cz, spec.apron, 0, Math.PI * 2)
        islands.moveTo(cx + spec.island, cz)
        islands.arc(cx, cz, spec.island, 0, Math.PI * 2)
      }
    } else {
      const { pts } = junctionOutline(i, j)
      pts.forEach(([x, z], k) => (k === 0 ? roads.moveTo(cx + x, cz + z) : roads.lineTo(cx + x, cz + z)))
      roads.closePath()
      signals.rect(cx - 5, cz - 5, 10, 10)
    }
    for (const d of [0, 3]) {
      if (armClosed(i, j, d)) continue
      const [dx, dz] = dirv(d)
      const kA = nodeKind(i, j), kB = nodeKind(i + dx, j + dz)
      const cA = clearance(i, j), cB = clearance(i + dx, j + dz)
      const fA = flareOf(i, j), fB = flareOf(i + dx, j + dz)
      const u0 = kA === 'round' ? cA - 3 : cA
      const u1 = kB === 'round' ? B - cB + 3 : B - cB
      const left: V2[] = [], right: V2[] = []
      for (let u = u0; u <= u1 + 0.01; u += 4) {
        const uu = Math.min(u, u1)
        const h = segHalves(kA, kB, cA, cB, uu, fA, fB)
        right.push(at(cx, cz, d, uu, h.right + 0.5))
        left.push(at(cx, cz, d, uu, -(h.left + 0.5)))
      }
      const poly = [...left, ...right.reverse()]
      poly.forEach(([x, z], k) => (k ? roads.lineTo(x, z) : roads.moveTo(x, z)))
      roads.closePath()
      const [x0, z0] = at(cx, cz, d, u0, 0), [x1, z1] = at(cx, cz, d, u1, 0)
      centre.moveTo(x0, z0)
      centre.lineTo(x1, z1)
      const [mx, mz] = at(cx, cz, d, (cA + (B - cB)) / 2, 0)
      labels.push({ x: mx, z: mz, ang: d === 0 ? 0 : Math.PI / 2, text: d === 0 ? HORIZONTAL_NAMES[mod(j, 4)] : VERTICAL_NAMES[mod(i, 4)] })
    }
  }
  return { land, parks, buildings, roads, centre, islands, domes, aprons, signals, labels }
}

/* ------------------------------------------------------------------ */
/* The route, following the real shape of every junction and roundabout */
/* ------------------------------------------------------------------ */
function bez2(p0: V2, p1: V2, p2: V2, n: number): V2[] {
  const out: V2[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t
    out.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]])
  }
  return out
}

function stepPath(st: Step): V2[] {
  const cx = st.i * B, cz = st.j * B
  const clr = clearance(st.i, st.j)
  const [ax, az] = dirv(st.din), [ox, oz] = dirv(st.out)
  const A: V2 = [cx - ax * clr, cz - az * clr]
  const X: V2 = [cx + ox * clr, cz + oz * clr]
  const spec = rbSpec(st.i, st.j)
  if (!spec) {
    if (st.out === st.din) return [A, X]
    return bez2(A, [cx, cz], X, 10) // rounded corner through the junction
  }
  // roundabout: in along the arm, round the ring counter-clockwise (an arc), out along the exit arm
  const rr = spec.laneR.reduce((p, q) => p + q, 0) / spec.laneR.length
  const dl = ringDelta(spec, spec.laneR.length - 1)
  const th0 = (((st.din + 2) % 4) * Math.PI) / 2
  let sweep = mod((st.out * Math.PI) / 2 - th0, Math.PI * 2)
  if (sweep < 0.01) sweep = Math.PI * 2
  const ring = (th: number): V2 => [cx + rr * Math.cos(th), cz - rr * Math.sin(th)]
  const tIn = th0 + dl, tOut = th0 + sweep - dl
  const pts: V2[] = []
  const hIn = 0.45 * Math.hypot(ring(tIn)[0] - A[0], ring(tIn)[1] - A[1])
  const inTan: V2 = [-Math.sin(tIn), -Math.cos(tIn)]
  const tanIn: V2 = [ax, az]
  for (const q of bez3(A, [A[0] + tanIn[0] * hIn, A[1] + tanIn[1] * hIn], [ring(tIn)[0] - inTan[0] * hIn, ring(tIn)[1] - inTan[1] * hIn], ring(tIn), 10)) pts.push(q)
  const steps = Math.max(4, Math.ceil(((tOut - tIn) * rr) / 3))
  for (let k = 1; k < steps; k++) pts.push(ring(tIn + ((tOut - tIn) * k) / steps))
  const outTan: V2 = [-Math.sin(tOut), -Math.cos(tOut)]
  const hOut = 0.45 * Math.hypot(X[0] - ring(tOut)[0], X[1] - ring(tOut)[1])
  for (const q of bez3(ring(tOut), [ring(tOut)[0] + outTan[0] * hOut, ring(tOut)[1] + outTan[1] * hOut], [X[0] - ox * hOut, X[1] - oz * hOut], X, 10)) pts.push(q)
  return pts
}
function bez3(p0: V2, p1: V2, p2: V2, p3: V2, n: number): V2[] {
  const out: V2[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ])
  }
  return out
}

function routePoints(px: number, pz: number): V2[] {
  // roundabout course: only the roundabout you are working on; the next one appears once this one is done
  const steps = nav.mode === 'roundabout' ? nav.steps.slice(nav.k, nav.k + 1) : nav.steps.slice(nav.k)
  if (!steps.length) return []
  const pts: V2[] = []
  steps.forEach((st) => stepPath(st).forEach((q) => pts.push(q)))
  // start on the road axis ahead of the player (so the line sits on the road, not beside the car)
  const [ax, az] = dirv(steps[0].din)
  const A = pts[0]
  const along = (A[0] - px) * ax + (A[1] - pz) * az
  const start: V2 = along > 0 ? [A[0] - ax * along, A[1] - az * along] : [px, pz]
  return [start, ...pts]
}

/* ------------------------------------------------------------------ */
/* Drawing                                                              */
/* ------------------------------------------------------------------ */
const view = { x: 0, z: 0, h: 0, s: 0.9, init: false }

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath()
}

function drawIcon(g: CanvasRenderingContext2D, icon: string, cx: number, cy: number, s: number) {
  g.save()
  g.translate(cx, cy)
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'
  g.lineWidth = s * 0.17; g.lineCap = 'round'; g.lineJoin = 'round'
  const head = (x: number, y: number, ang: number) => {
    g.save(); g.translate(x, y); g.rotate(ang)
    g.beginPath(); g.moveTo(s * 0.34, 0); g.lineTo(-s * 0.12, -s * 0.3); g.lineTo(-s * 0.12, s * 0.3); g.closePath(); g.fill()
    g.restore()
  }
  if (icon === 'S') { g.beginPath(); g.moveTo(0, s * 0.45); g.lineTo(0, -s * 0.18); g.stroke(); head(0, -s * 0.22, -Math.PI / 2) }
  else if (icon === 'L' || icon === 'R') {
    const d = icon === 'L' ? -1 : 1
    g.beginPath(); g.moveTo(0, s * 0.45); g.lineTo(0, -s * 0.02); g.quadraticCurveTo(0, -s * 0.2, d * s * 0.18, -s * 0.2); g.lineTo(d * s * 0.2, -s * 0.2); g.stroke()
    head(d * s * 0.26, -s * 0.2, d < 0 ? Math.PI : 0)
  } else if (icon === 'M') {
    // merge: two lanes joining
    g.beginPath(); g.moveTo(-s * 0.18, s * 0.45); g.lineTo(-s * 0.18, -s * 0.12); g.stroke()
    g.beginPath(); g.moveTo(s * 0.2, s * 0.45); g.quadraticCurveTo(s * 0.2, s * 0.02, -s * 0.12, -s * 0.12); g.stroke()
    head(-s * 0.18, -s * 0.2, -Math.PI / 2)
  } else if (icon === 'U') { g.beginPath(); g.moveTo(s * 0.2, s * 0.45); g.lineTo(s * 0.2, -s * 0.05); g.arc(0, -s * 0.05, s * 0.2, 0, Math.PI, true); g.lineTo(-s * 0.2, s * 0.15); g.stroke(); head(-s * 0.2, s * 0.2, Math.PI / 2) }
  else if (icon === 'F') {
    g.beginPath(); g.moveTo(-s * 0.2, s * 0.45); g.lineTo(-s * 0.2, -s * 0.4); g.stroke()
    g.fillStyle = '#ff4b4b'; g.beginPath(); g.moveTo(-s * 0.2, -s * 0.4); g.lineTo(s * 0.35, -s * 0.22); g.lineTo(-s * 0.2, -s * 0.04); g.closePath(); g.fill()
  } else if (icon[0] === 'O') {
    g.lineWidth = s * 0.12
    g.beginPath(); g.arc(0, s * 0.02, s * 0.28, 0, Math.PI * 2); g.stroke()
    const exit = Number(icon[1])
    const ang = [0, -Math.PI / 2, Math.PI, Math.PI / 2][exit === 1 ? 0 : exit === 2 ? 1 : exit === 3 ? 2 : 3]
    g.strokeStyle = '#3b9dff'; g.lineWidth = s * 0.16
    g.beginPath(); g.moveTo(0, s * 0.02); g.lineTo(Math.cos(ang) * s * 0.5, s * 0.02 + Math.sin(ang) * s * 0.5); g.stroke()
    g.fillStyle = '#fff'; g.font = `700 ${s * 0.3}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText(String(exit), 0, s * 0.04)
    g.strokeStyle = '#fff'; g.lineWidth = s * 0.1; g.beginPath(); g.moveTo(0, s * 0.52); g.lineTo(0, s * 0.3); g.stroke()
  }
  g.restore()
}

const angDiff = (a: number, b: number) => ((((b - a) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI

/** Heading-up navigation map. Called a few times per frame-budget; `dt` smooths the camera so nothing jitters. */
/** The turn instruction banner (icon, street, distance). Also used alone on phones, where there is no map. */
export function drawBanner(g: CanvasRenderingContext2D, w: number, units: 'kmh' | 'mph', compact: boolean) {
  if (nav.text) {
    const bh = compact ? 46 : 58
    g.fillStyle = 'rgba(10,15,23,.94)'
    roundRect(g, 8, 8, w - 16, bh, 11); g.fill()
    g.fillStyle = '#1f6fe0'
    roundRect(g, 12, 12, bh - 8, bh - 8, 9); g.fill()
    drawIcon(g, nav.icon, 12 + (bh - 8) / 2, 12 + (bh - 8) / 2, bh - 16)
    const tx = 12 + bh - 8 + 8
    g.textAlign = 'left'; g.textBaseline = 'alphabetic'
    g.fillStyle = '#fff'; g.font = `700 ${compact ? 13 : 16}px system-ui, sans-serif`
    g.fillText(nav.text, tx, compact ? 28 : 32, w - tx - 62)
    g.fillStyle = '#9fb4cf'; g.font = `500 ${compact ? 10.5 : 12}px system-ui, sans-serif`
    g.fillText(nav.sub, tx, compact ? 42 : 51, w - tx - 62)
    g.textAlign = 'right'; g.fillStyle = '#fff'; g.font = `700 ${compact ? 14 : 18}px system-ui, sans-serif`
    g.fillText(fmtDist(nav.dist, units), w - 14, compact ? 36 : 42)
  }
}

export function drawNavMap(g: CanvasRenderingContext2D, w: number, h: number, dt: number, units: 'kmh' | 'mph', compact = false, banner = true) {
  if (!paths || pathsVer !== LAYOUT.version) { paths = buildPaths(); pathsVer = LAYOUT.version }
  const pth = paths

  // smoothed camera (position, heading, zoom out with speed)
  const targetS = (compact ? 0.62 : 0.85) * (1 - Math.min(0.45, sim.speed / 40))
  if (!view.init) { view.x = sim.x; view.z = sim.z; view.h = sim.h; view.s = targetS; view.init = true }
  const k = 1 - Math.exp(-10 * Math.min(dt, 0.1))
  view.x += (sim.x - view.x) * k
  view.z += (sim.z - view.z) * k
  view.h += angDiff(view.h, sim.h) * k
  view.s += (targetS - view.s) * (1 - Math.exp(-2 * Math.min(dt, 0.1)))
  const S = view.s

  g.save()
  roundRect(g, 0, 0, w, h, 14)
  g.clip()
  g.fillStyle = '#0e151e'
  g.fillRect(0, 0, w, h)

  const cx = w / 2, cy = h * 0.68
  g.translate(cx, cy)
  g.rotate(view.h)
  g.scale(S, S)
  g.translate(-view.x, -view.z)

  const R = Math.hypot(w, h) / S * 0.75
  const ci0 = Math.floor((view.x - R) / P), ci1 = Math.floor((view.x + R) / P)
  const cj0 = Math.floor((view.z - R) / P), cj1 = Math.floor((view.z + R) / P)
  const copies: V2[] = []
  for (let ci = ci0; ci <= ci1; ci++) for (let cj = cj0; cj <= cj1; cj++) copies.push([ci * P, cj * P])

  g.lineJoin = 'round'
  for (const [ox, oz] of copies) {
    g.save()
    g.translate(ox, oz)
    g.fillStyle = '#16212e'; g.fill(pth.land)
    g.fillStyle = '#1c2a22'; g.fill(pth.parks)
    g.fillStyle = '#1d2a3a'; g.fill(pth.buildings)
    // road casing, then road surface (so intersections look joined)
    g.strokeStyle = '#05080c'; g.lineWidth = 3.2 / S; g.stroke(pth.roads)
    g.fillStyle = '#56657b'; g.fill(pth.roads)
    g.fillStyle = '#6a5f55'; g.fill(pth.aprons)
    g.fillStyle = '#1f4a30'; g.fill(pth.islands)
    g.fillStyle = '#7d8794'; g.fill(pth.domes)
    g.strokeStyle = 'rgba(255,214,70,.55)'; g.lineWidth = 1 / S; g.setLineDash([6 / S, 7 / S]); g.stroke(pth.centre); g.setLineDash([])
    g.fillStyle = '#f5c518'; g.fill(pth.signals)
    g.restore()
  }

  // street names along the roads, kept upright
  if (S > 0.5) {
    g.fillStyle = 'rgba(235,242,250,.9)'
    g.font = '600 11px system-ui, sans-serif'
    g.textAlign = 'center'; g.textBaseline = 'middle'
    let drawn = 0
    for (const [ox, oz] of copies) {
      for (const lb of pth.labels) {
        const wx = lb.x + ox, wz = lb.z + oz
        const dd = Math.hypot(wx - view.x, wz - view.z)
        if (dd > R * 0.85 || drawn > 14) continue
        drawn++
        g.save()
        g.translate(wx, wz)
        let a = lb.ang
        const screen = a + view.h
        if (Math.cos(screen) < 0) a += Math.PI // never upside down
        g.rotate(a)
        g.scale(1 / S, 1 / S)
        g.lineWidth = 3; g.strokeStyle = 'rgba(10,15,22,.85)'; g.strokeText(lb.text, 0, 0)
        g.fillText(lb.text, 0, 0)
        g.restore()
      }
    }
  }

  // the route
  const pts = routePoints(sim.x, sim.z)
  if (pts.length > 1) {
    g.lineCap = 'round'
    g.beginPath()
    pts.forEach(([x, z], i) => (i ? g.lineTo(x, z) : g.moveTo(x, z)))
    g.strokeStyle = 'rgba(8,30,70,.9)'; g.lineWidth = 11 / S; g.stroke()
    g.strokeStyle = '#3b9dff'; g.lineWidth = 7.5 / S; g.stroke()
    // direction chevrons
    g.fillStyle = 'rgba(255,255,255,.9)'
    let acc = 14 / S
    for (let i = 1; i < pts.length; i++) {
      const [x0, z0] = pts[i - 1], [x1, z1] = pts[i]
      const seg = Math.hypot(x1 - x0, z1 - z0)
      if (seg < 1e-6) continue
      let t = acc
      while (t < seg) {
        const px = x0 + ((x1 - x0) * t) / seg, pz = z0 + ((z1 - z0) * t) / seg
        const a = Math.atan2(z1 - z0, x1 - x0)
        g.save(); g.translate(px, pz); g.rotate(a); g.scale(1 / S, 1 / S)
        g.beginPath(); g.moveTo(4, 0); g.lineTo(-3, -3.4); g.lineTo(-1.2, 0); g.lineTo(-3, 3.4); g.closePath(); g.fill()
        g.restore()
        t += 34 / S
      }
      acc = t - seg
    }
    const last = pts[pts.length - 1]
    g.fillStyle = '#ff4b4b'; g.beginPath(); g.arc(last[0], last[1], 9 / S, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#fff'; g.beginPath(); g.arc(last[0], last[1], 3.6 / S, 0, Math.PI * 2); g.fill()
  }
  g.restore()

  // you: a navigation arrow with a soft halo
  g.save()
  roundRect(g, 0, 0, w, h, 14)
  g.clip()
  g.translate(cx, cy)
  g.fillStyle = 'rgba(70,160,255,.22)'; g.beginPath(); g.arc(0, 0, 20, 0, Math.PI * 2); g.fill()
  g.fillStyle = '#ffffff'; g.strokeStyle = '#0b1a33'; g.lineWidth = 2.2
  g.beginPath(); g.moveTo(0, -15); g.lineTo(11, 12); g.lineTo(0, 6); g.lineTo(-11, 12); g.closePath(); g.fill(); g.stroke()
  g.restore()

  g.save()
  roundRect(g, 0, 0, w, h, 14)
  g.clip()
  // compass
  const ca = { x: w - 22, y: h - 22 }
  g.fillStyle = 'rgba(8,12,18,.82)'; g.beginPath(); g.arc(ca.x, ca.y, 14, 0, Math.PI * 2); g.fill()
  g.fillStyle = '#ff6b6b'; g.font = '700 11px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillText('N', ca.x + Math.sin(view.h) * 7, ca.y - Math.cos(view.h) * 7)
  if (banner) drawBanner(g, w, units, compact)
  g.restore()
}

