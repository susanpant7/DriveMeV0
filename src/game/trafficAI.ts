import { B, EDGE_IDS, LINKS, P, PIECES, RING_R, mod, nodeIJ, pieceAt, signalColor, wrapD, type Piece } from './map'

export const MAX_CARS = 400
export const CAR_L = 4.4
export const CAR_W = 1.9
const COLORS = ['#2e86de', '#f1c40f', '#ecf0f1', '#27ae60', '#8e44ad', '#e67e22', '#34495e', '#16a085', '#c0392b', '#95a5a6']

export interface AiCar {
  id: number
  active: boolean
  piece: number
  s: number
  speed: number
  v0: number
  lane: number
  exitArm: number
  x: number // wrapped into [0, P)
  z: number
  h: number // heading (rad, same convention as the player: forward = (-sin h, -cos h))
  color: string
  stuck: number
  ghost: number
  braking: boolean
  behindPlayer: boolean
  kind: number // body type: 0 sedan, 1 SUV, 2 van
}

export const cars: AiCar[] = []
const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
const tmp = { x: 0, z: 0, dx: 0, dz: 0 }

export interface Obstacle {
  x: number
  z: number
  h: number
  speed: number
}

function place(c: AiCar) {
  pieceAt(PIECES[c.piece], c.s, tmp)
  c.x = mod(tmp.x, P)
  c.z = mod(tmp.z, P)
  c.h = Math.atan2(-tmp.dx, -tmp.dz)
}

function spawn(c: AiCar, player: Obstacle | null) {
  for (let tries = 0; tries < 30; tries++) {
    const pid = pick(EDGE_IDS)
    const p = PIECES[pid]
    const s = rand(12, p.len - 12)
    pieceAt(p, s, tmp)
    const x = mod(tmp.x, P)
    const z = mod(tmp.z, P)
    if (player && Math.hypot(wrapD(x - player.x), wrapD(z - player.z)) < 70) continue
    if (cars.some((o) => o !== c && o.active && Math.hypot(wrapD(x - o.x), wrapD(z - o.z)) < 8)) continue
    c.piece = pid
    c.s = s
    c.lane = p.lane
    c.v0 = rand(10.5, 13.5)
    c.speed = c.v0 * 0.8
    c.color = pick(COLORS)
    const r = Math.random()
    c.kind = r < 0.6 ? 0 : r < 0.92 ? 1 : 2
    c.stuck = 0
    c.ghost = 0
    place(c)
    return true
  }
  return false
}

export function initTraffic() {
  cars.length = 0
  for (let i = 0; i < MAX_CARS; i++) {
    cars.push({ id: i, active: false, piece: 0, s: 0, speed: 0, v0: 12, lane: 0, exitArm: 0, x: 0, z: 0, h: 0, color: COLORS[0], stuck: 0, ghost: 0, braking: false, behindPlayer: false, kind: 0 })
  }
}
initTraffic()

export function setActiveCount(n: number, player: Obstacle | null) {
  cars.forEach((c, i) => {
    const want = i < n
    if (want && !c.active) {
      c.active = spawn(c, player)
    } else if (!want) c.active = false
  })
}

/* ---------------- routing ---------------- */
function chooseNext(c: AiCar, p: Piece): number | undefined {
  const L = LINKS
  if (p.kind === 'edge') {
    if (p.toKind === 'signal') {
      const key = `${p.node}:${p.arm}:${p.lane}`
      const right = L.connR.get(key)
      if (right !== undefined && Math.random() < 0.4) return right
      return L.connS.get(key)
    }
    c.exitArm = (p.arm + 1 + Math.floor(Math.random() * 3)) % 4
    return L.entryC.get(`${p.node}:${p.arm}:${p.lane}`)
  }
  if (p.kind === 'conn') {
    if (p.entry) return L.ringBetween.get(`${p.node}:${p.arm}`)
    return L.edgeOut.get(`${p.node}:${p.arm}:${p.lane}`)
  }
  // ring
  if (p.ringType === 'between') {
    if (c.exitArm === p.arm) return L.exitC.get(`${p.node}:${p.arm}:2`)
    return L.ringPass.get(`${p.node}:${p.arm}`)
  }
  return L.ringBetween.get(`${p.node}:${p.arm}`)
}

/** Is any vehicle circulating just upstream of this roundabout entry? */
export function ringBusy(node: number, arm: number, player: Obstacle | null): boolean {
  const [i, j] = nodeIJ(node)
  const cx = i * B
  const cz = j * B
  const entryAng = (arm * Math.PI) / 2
  const check = (x: number, z: number) => {
    const dx = wrapD(x - cx)
    const dz = wrapD(z - cz)
    const r = Math.hypot(dx, dz)
    if (r > RING_R + 6 || r < RING_R - 8) return false
    const ang = Math.atan2(-dz, dx)
    const d = mod(entryAng - ang, Math.PI * 2)
    return d < 1.2 || d > Math.PI * 2 - 0.1
  }
  for (const c of cars) {
    if (!c.active) continue
    const p = PIECES[c.piece]
    if (p.kind !== 'ring' || p.node !== node) continue
    if (check(c.x, c.z)) return true
  }
  return !!player && check(player.x, player.z)
}

/* ---------------- IDM car following ---------------- */
function idm(v: number, v0: number, gap: number, dv: number) {
  const a = 2.2
  const b = 3.2
  const free = 1 - Math.pow(v / v0, 4)
  let inter = 0
  if (gap < 1e8) {
    const sStar = 2.2 + Math.max(0, v * 1.3 + (v * dv) / (2 * Math.sqrt(a * b)))
    inter = (sStar / Math.max(gap, 0.1)) ** 2
  }
  return Math.max(-9, a * (free - inter))
}

// spatial grid so each car only looks at its neighbours (hundreds of cars stay cheap)
const CELL = 50
const CN = P / CELL
const grid: number[][] = Array.from({ length: CN * CN }, () => [])
const cellOf = (x: number, z: number) => (Math.floor(x / CELL) % CN) * CN + (Math.floor(z / CELL) % CN)

export function stepTraffic(dt: number, t: number, player: Obstacle) {
  for (const g of grid) g.length = 0
  for (let i = 0; i < cars.length; i++) if (cars[i].active) grid[cellOf(cars[i].x, cars[i].z)].push(i)

  for (const c of cars) {
    if (!c.active) continue
    const p = PIECES[c.piece]
    const fx = -Math.sin(c.h)
    const fz = -Math.cos(c.h)
    let gap = 1e9
    let lv = 0
    c.behindPlayer = false

    // 1. vehicle ahead (cone test, works for crossing traffic and the player too)
    if (c.ghost <= 0) {
      const consider = (ox: number, oz: number, speed: number, isPlayer = false) => {
        const rx = wrapD(ox - c.x)
        const rz = wrapD(oz - c.z)
        const along = rx * fx + rz * fz
        if (along < 0.5 || along > 45) return
        const lat = Math.abs(rx * -fz + rz * fx)
        if (lat > 1.7 + along * 0.04) return
        const g = along - CAR_L
        if (g < gap) {
          gap = g
          lv = speed
          c.behindPlayer = isPlayer
        }
      }
      const gx = Math.floor(c.x / CELL)
      const gz = Math.floor(c.z / CELL)
      for (let ix = -1; ix <= 1; ix++) {
        for (let iz = -1; iz <= 1; iz++) {
          for (const oi of grid[mod(gx + ix, CN) * CN + mod(gz + iz, CN)]) {
            const o = cars[oi]
            if (o === c) continue
            // circulating traffic has priority: ignore cars still waiting to join the ring
            if (p.kind === 'ring') {
              const op = PIECES[o.piece]
              if (op.kind === 'conn' && op.entry) continue
            }
            consider(o.x, o.z, o.speed)
          }
        }
      }
      consider(player.x, player.z, player.speed, true)
    }

    // 2. red / amber light at the end of this road
    let vcap = p.vmax
    const toEnd = p.len - c.s
    if (p.kind === 'edge') {
      if (p.toKind === 'signal') {
        const dist = toEnd - 3.9
        const col = signalColor(p.node, p.axis as 0 | 1, t)
        if (dist > -0.5 && (col === 2 || (col === 1 && dist > (c.speed * c.speed) / 7 + 1))) {
          if (dist < gap) {
            gap = Math.max(dist, 0.05)
            lv = 0
          }
        }
      } else if (toEnd < 35) {
        vcap = Math.min(vcap, 8)
        // give way to traffic already on the roundabout
        const entry = PIECES[LINKS.entryC.get(`${p.node}:${p.arm}:${p.lane}`)!]
        if (ringBusy(p.node, p.arm, player)) {
          const dist = toEnd + entry.len - 3
          if (dist < gap) {
            gap = Math.max(dist, 0.05)
            lv = 0
          }
        }
      }
    } else if (p.kind === 'conn' && p.entry && ringBusy(p.node, p.arm, player)) {
      const dist = toEnd - 3
      if (dist < gap) {
        gap = Math.max(dist, 0.05)
        lv = 0
      }
    }

    const v0 = Math.min(c.v0, vcap)
    const acc = idm(c.speed, v0, gap, c.speed - lv)
    c.braking = acc < -1
    c.speed = Math.max(0, c.speed + acc * dt)
    c.s += c.speed * dt

    // stuck breaker (rare deadlocks between crossing cars)
    if (c.speed < 0.2 && gap < 12 && !c.behindPlayer && !(p.kind === 'edge' && p.toKind === 'signal')) c.stuck += dt
    else c.stuck = 0
    if (c.stuck > 20) {
      c.ghost = 4
      c.stuck = 0
    }
    if (c.ghost > 0) c.ghost -= dt

    // move on to the next piece
    let guard = 0
    while (c.s >= PIECES[c.piece].len && guard++ < 3) {
      const cur = PIECES[c.piece]
      const nxt = chooseNext(c, cur)
      if (nxt === undefined) {
        spawn(c, player)
        break
      }
      c.s -= cur.len
      c.piece = nxt
    }
    place(c)
  }
}

