import { B, EDGE_IDS, LANES, LANE_W, LINKS, P, PIECES, SPEED_LIMIT, mod, nodeIJ, rbSpecOfNode, pieceAt, signalColor, wrapD, type Piece } from './map'

export const MAX_CARS = 900
export const CAR_L = 4.4
export const CAR_W = 1.82
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
  kind: number // body type: 0 sedan, 1 pickup, 2 van, 3 Challenger, 4 Impala, 5 Volga
  style: 0 | 1 // 0 = cruiser (keeps right, at the speed limit), 1 = fast (prefers the left lanes)
  pref: number // desired speed before the lane limit is applied (m/s)
  plan: 'L' | 'S' | 'R' // what this car intends to do at the next signalled junction
  turnSig: -1 | 0 | 1 // indicator for a junction turn / roundabout exit
  lcSig: -1 | 0 | 1 // indicator for a lane change
  sig: -1 | 0 | 1 // what the indicator lamps show (read by the renderer)
  lcWant: -1 | 0 | 1 // lane change being prepared (indicator on, waiting for a gap)
  lcPrep: number
  lcT: number // progress of a lane change in seconds, -1 when not changing
  lcDur: number
  lat0: number // lateral offset (m, right positive) at the start of the lane change
  cool: number // seconds before this car may consider another lane change
  waitL: number // how long a left-turner has been waiting for a gap
  rbWait: number // 1 while waiting at a roundabout yield line
  cGap: number // cached leader search result (refreshed every other frame)
  cLv: number
  cBP: boolean
  np: number | undefined // cached next piece
  np2: number | undefined // and the one after it
  npPiece: number
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
  let x = tmp.x
  let z = tmp.z
  let yaw = 0
  if (c.lcT >= 0) {
    const u = Math.min(1, c.lcT / c.lcDur)
    const lat = c.lat0 * (1 - u * u * (3 - 2 * u))
    const vlat = (-c.lat0 * 6 * u * (1 - u)) / c.lcDur // rightward speed
    x += -tmp.dz * lat // right of travel = (-dz, dx)
    z += tmp.dx * lat
    yaw = -Math.atan2(vlat, Math.max(c.speed, 2))
  }
  c.x = mod(x, P)
  c.z = mod(z, P)
  c.h = Math.atan2(-tmp.dx, -tmp.dz) + yaw
}

/* ---------------- lanes, plans and manoeuvres ---------------- */
const leftExitOk = (p: Piece) => {
  const e = (((p.arm + 2) % 4) + 1) % 4
  const ex = LINKS.edgeOut.get(`${p.node}:${e}:0`)
  return ex !== undefined && !!PIECES[ex].aiOk
}
/** May AI cars use lane k of this road (at distance s along it)? The added right-turn lane only exists near the junction. */
const laneOk = (p: Piece, k: number, s?: number) => {
  if (k < 0 || k >= LANES || !p.sibs) return false
  const q = PIECES[p.sibs[k]]
  if (!q.aiOk) return false
  if (s !== undefined && q.laneFrom !== undefined && s < q.laneFrom + 3) return false
  return true
}
const hasLeft = (p: Piece) => {
  if (p.hl === undefined) p.hl = p.toKind === 'signal' && laneOk(p, 0) && LINKS.connL.has(`${p.node}:${p.arm}:0`) && leftExitOk(p)
  return p.hl
}

/** What the car will actually do at the end of this road. The lane it is in decides: the left lane turns left. */
function maneuver(_c: AiCar, p: Piece): 'L' | 'S' | 'R' {
  if (p.toKind !== 'signal') return 'S'
  if (p.lane === 0 && hasLeft(p)) return 'L'
  if (p.lane === LANES - 1) return 'R' // the added outer lane is a right-turn lane
  return 'S'
}

function planEdge(c: AiCar, p: Piece) {
  c.plan = 'S'
  if (p.kind !== 'edge' || p.toKind !== 'signal') return
  const r = Math.random()
  if (r < 0.18 && hasLeft(p)) c.plan = 'L'
  else if (r < 0.4) c.plan = 'R'
}

function reqLane(c: AiCar, p: Piece) {
  if (c.plan === 'L' && hasLeft(p)) return 0
  if (c.plan === 'R') return LANES - 1
  return 1 // straight on: the middle (outer through) lane
}

/** Right lane: at (or just under) the speed limit. Left lanes may go faster. */
function laneV0(c: AiCar, lane: number) {
  if (lane >= 1) return Math.min(c.pref, SPEED_LIMIT * 0.99) // right / outer lane: at the speed limit
  return Math.min(c.pref, 16.5) // inner lane: may go a little faster
}

/** Cars live in a window around the player: they spawn between WIN_MIN and WIN_MAX away and are recycled once they fall behind. */
export const WIN_MAX = 340
const WIN_RECYCLE = 375
function spawn(c: AiCar, player: Obstacle | null, minD = 70) {
  for (let tries = 0; tries < 80; tries++) {
    const pid = pick(EDGE_IDS)
    const p = PIECES[pid]
    const s = rand(12, p.len - 12)
    pieceAt(p, s, tmp)
    const x = mod(tmp.x, P)
    const z = mod(tmp.z, P)
    if (p.toKind === 'signal' && p.lane === 0 && !hasLeft(p)) continue // the left lane is a left-turn lane
    if (p.laneFrom !== undefined && s < p.laneFrom + 4) continue // the added right-turn lane only exists near the junction
    if (player) {
      const dd = Math.hypot(wrapD(x - player.x), wrapD(z - player.z))
      if (dd < minD || dd > WIN_MAX) continue
    }
    if (cars.some((o) => o !== c && o.active && Math.hypot(wrapD(x - o.x), wrapD(z - o.z)) < 8)) continue
    c.piece = pid
    c.s = s
    c.lane = p.lane
    c.style = Math.random() < 0.7 ? 0 : 1
    c.pref = c.style === 0 ? rand(12.4, 13.3) : rand(15, 19)
    c.v0 = laneV0(c, p.lane)
    c.speed = c.v0 * 0.85
    c.lcT = -1
    c.lcSig = 0
    c.lcWant = 0
    c.sig = 0
    c.turnSig = 0
    c.cool = rand(0.5, 5)
    c.waitL = 0
    c.rbWait = 0
    planEdge(c, p)
    if (p.toKind === 'signal') c.plan = p.lane === LANES - 1 ? 'R' : p.lane === 0 && hasLeft(p) ? 'L' : 'S'
    c.color = pick(COLORS)
    const r = Math.random()
    // body type: sedans most common, then pickups and vans; a few classics and sports cars for variety
    c.kind = r < 0.5 ? 0 : r < 0.72 ? 1 : r < 0.82 ? 2 : r < 0.88 ? 3 : r < 0.93 ? 4 : 5
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
    cars.push({ id: i, active: false, piece: 0, s: 0, speed: 0, v0: 12, lane: 0, exitArm: 0, x: 0, z: 0, h: 0, color: COLORS[0], stuck: 0, ghost: 0, braking: false, behindPlayer: false, kind: 0, style: 0, pref: 12, plan: 'S', turnSig: 0, lcSig: 0, sig: 0, lcWant: 0, lcPrep: 0, lcT: -1, lcDur: 2.8, lat0: 0, cool: 0, waitL: 0, rbWait: 0, cGap: 1e9, cLv: 0, cBP: false, np: undefined, np2: undefined, npPiece: -1 })
  }
}
initTraffic()

let targetCars = 0
export function setActiveCount(n: number, player: Obstacle | null) {
  targetCars = n
  cars.forEach((c, i) => {
    const want = i < n
    if (want && !c.active) {
      c.active = spawn(c, player, 55)
    } else if (!want) c.active = false
  })
}

/* ---------------- routing ---------------- */
/** The piece this car will drive onto next (no side effects, so it can be used to look ahead). */
function nextPiece(c: AiCar, p: Piece): number | undefined {
  const L = LINKS
  if (p.kind === 'edge') {
    const key = `${p.node}:${p.arm}:${p.lane}`
    if (p.toKind === 'signal') {
      const m = maneuver(c, p)
      if (m === 'L') return L.connL.get(key)
      if (m === 'R') {
        const right = L.connR.get(key)
        if (right !== undefined) return right
      }
      return L.connS.get(key)
    }
    return L.entryC.get(key)
  }
  if (p.kind === 'conn') {
    if (p.entry) return L.ringBetween.get(`${p.node}:${p.arm}:${p.lane}`)
    return L.edgeOut.get(`${p.node}:${p.arm}:${p.lane}`)
  }
  if (p.ringType === 'between') {
    if (c.exitArm === p.arm) return L.exitC.get(`${p.node}:${p.arm}:${p.lane}`) // leave from the lane we are in
    return L.ringPass.get(`${p.node}:${p.arm}:${p.lane}`)
  }
  return L.ringBetween.get(`${p.node}:${p.arm}:${p.lane}`)
}

function chooseNext(c: AiCar, p: Piece): number | undefined {
  if (p.kind === 'edge' && p.toKind !== 'signal') {
    if (rbSpecOfNode(p.node).laneR.length === 1) {
      c.exitArm = (p.arm + 1 + Math.floor(Math.random() * 3)) % 4 // one circulating lane: any exit
    } else {
      // right lane: first exit (right turn) or straight on; left lane: straight on or the third exit (left turn)
      c.exitArm = (p.arm + (p.lane === 1 ? 1 : 2) + Math.floor(Math.random() * 2)) % 4
    }
  }
  return nextPiece(c, p)
}

/** Is any vehicle circulating just upstream of this roundabout entry? */
export function ringBusy(node: number, arm: number, player: Obstacle | null): boolean {
  const [i, j] = nodeIJ(node)
  const cx = i * B
  const cz = j * B
  const spec = rbSpecOfNode(node)
  const rMid = spec.laneR.reduce((a, b) => a + b, 0) / spec.laneR.length
  const win = Math.min(2.6, Math.max(1.2, 55 / rMid)) // look back about 55 m along the ring
  const entryAng = (arm * Math.PI) / 2
  const check = (x: number, z: number) => {
    const dx = wrapD(x - cx)
    const dz = wrapD(z - cz)
    const r = Math.hypot(dx, dz)
    if (r > spec.outer + 3 || r < spec.apron - 3) return false
    const ang = Math.atan2(-dz, dx)
    const d = mod(entryAng - ang, Math.PI * 2)
    return d < win || d > Math.PI * 2 - 0.2
  }
  for (const ci of ringCars.get(node) ?? []) {
    const c = cars[ci]
    if (!check(c.x, c.z)) continue
    // a car that is about to leave the roundabout before it reaches this entry is no conflict
    const ang = Math.atan2(-wrapD(c.z - cz), wrapD(c.x - cx))
    const toExit = mod((c.exitArm * Math.PI) / 2 - ang, Math.PI * 2)
    const toEntry = mod(entryAng - ang, Math.PI * 2)
    if (toExit < toEntry - 0.1 && c.exitArm !== arm) continue
    return true
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

const ringCars = new Map<number, number[]>() // car indices circulating in each roundabout
// spatial grid so each car only looks at its neighbours (hundreds of cars stay cheap)
const CELL = 50
const CN = P / CELL
const grid: number[][] = Array.from({ length: CN * CN }, () => [])
const cellOf = (x: number, z: number) => (Math.floor(x / CELL) % CN) * CN + (Math.floor(z / CELL) % CN)


/** Is the target lane free of other cars (and the player) alongside, ahead and behind? */
function laneSafe(c: AiCar, p: Piece, dir: -1 | 1, player: Obstacle): boolean {
  const target = p.lane + dir
  if (!laneOk(p, target, c.s)) return false
  const sib = p.sibs![target]
  const gx = Math.floor(c.x / CELL)
  const gz = Math.floor(c.z / CELL)
  for (let ix = -1; ix <= 1; ix++) {
    for (let iz = -1; iz <= 1; iz++) {
      for (const oi of grid[mod(gx + ix, CN) * CN + mod(gz + iz, CN)]) {
        const o = cars[oi]
        if (o === c || o.piece !== sib) continue
        const ds = o.s - c.s
        if (ds >= 0) {
          if (ds < 9 + Math.max(0, c.speed - o.speed) * 2.2) return false
        } else if (-ds < 9 + Math.max(0, o.speed - c.speed) * 2.2) return false
      }
    }
  }
  const fx = -Math.sin(c.h)
  const fz = -Math.cos(c.h)
  const rx = wrapD(player.x - c.x)
  const rz = wrapD(player.z - c.z)
  const along = rx * fx + rz * fz
  const lat = rx * -fz + rz * fx
  if (Math.abs(lat - dir * LANE_W) < 2.4) {
    if (along >= 0 ? along < 9 + Math.max(0, c.speed - player.speed) * 2.2 : -along < 9 + Math.max(0, player.speed - c.speed) * 2.2) return false
  }
  return true
}

function startChange(c: AiCar, p: Piece, dir: -1 | 1) {
  const target = p.lane + dir
  c.lat0 = -dir * LANE_W // the new lane's centre is dir*LANE_W to the right of where the car is
  c.lcT = 0
  c.lcDur = 2.8
  c.piece = p.sibs![target]
  c.lane = target
  c.v0 = laneV0(c, target)
}

function decideLane(c: AiCar, p: Piece, gap: number, lv: number, toEnd: number) {
  let want: -1 | 0 | 1 = 0
  let urgent = false
  if (p.toKind === 'signal') {
    const req = reqLane(c, p)
    if (p.lane !== req) {
      want = req > p.lane ? 1 : -1
      urgent = true
    } else if (p.lane === 1 && toEnd > 140 && gap < 32 && lv < c.pref * 0.88 && laneOk(p, 0, c.s)) {
      want = -1 // overtake a slower car on the left, well before the junction
    }
  }
  if (want && laneOk(p, p.lane + want, c.s)) {
    c.lcWant = want
    c.lcSig = want
    c.lcPrep = urgent ? 0.9 : 1.4
  } else c.cool = 0.5
}

/** Don't enter a junction if the road beyond it is jammed (keep the box clear). */
function exitBlocked(c: AiCar, p: Piece): boolean {
  const m = maneuver(c, p)
  const key = `${p.node}:${p.arm}:${p.lane}`
  const conn = PIECES[(m === 'L' ? LINKS.connL.get(key) : m === 'R' ? LINKS.connR.get(key) : LINKS.connS.get(key)) ?? -1]
  if (!conn) return false
  const exitId = LINKS.edgeOut.get(`${conn.node}:${conn.arm}:${conn.lane}`)
  if (exitId === undefined) return false
  const [ji, jj] = nodeIJ(p.node)
  const gx = Math.floor((ji * B) / CELL)
  const gz = Math.floor((jj * B) / CELL)
  for (let ix = -1; ix <= 1; ix++) {
    for (let iz = -1; iz <= 1; iz++) {
      for (const oi of grid[mod(gx + ix, CN) * CN + mod(gz + iz, CN)]) {
        const o = cars[oi]
        if (o !== c && o.piece === exitId && o.s < 16 && o.speed < 2.5) return true
      }
    }
  }
  return false
}

/** Would a left-turner at the stop line cut across oncoming traffic? */
function leftConflict(c: AiCar, p: Piece, t: number, player: Obstacle): boolean {
  const [ji, jj] = nodeIJ(p.node)
  const cx = ji * B
  const cz = jj * B
  const gx = Math.floor(cx / CELL)
  const gz = Math.floor(cz / CELL)
  const fx = -Math.sin(c.h)
  const fz = -Math.cos(c.h)
  const opp = (p.arm + 2) % 4
  for (let ix = -1; ix <= 1; ix++) {
    for (let iz = -1; iz <= 1; iz++) {
      for (const oi of grid[mod(gx + ix, CN) * CN + mod(gz + iz, CN)]) {
        const o = cars[oi]
        if (o === c) continue
        const op = PIECES[o.piece]
        if (op.kind === 'edge' && op.node === p.node && op.arm === opp) {
          // oncoming and about to enter, with a light that isn't red, and not turning left itself
          const left = op.len - o.s
          if (left < 75 && left / Math.max(o.speed, 2.5) < 5 && signalColor(p.node, op.axis as 0 | 1, t, 'T') !== 2 && maneuver(o, op) !== 'L') return true
        } else if (op.kind === 'conn' && op.node === p.node && o.speed > 0.8) {
          const ofx = -Math.sin(o.h)
          const ofz = -Math.cos(o.h)
          if (ofx * fx + ofz * fz < -0.5 && Math.hypot(wrapD(o.x - cx), wrapD(o.z - cz)) < 15) return true
        }
      }
    }
  }
  const pdx = wrapD(player.x - cx)
  const pdz = wrapD(player.z - cz)
  const pfx = -Math.sin(player.h)
  const pfz = -Math.cos(player.h)
  return player.speed > 1 && pfx * fx + pfz * fz < -0.5 && Math.hypot(pdx, pdz) < 40
}

let frameNo = 0
export function stepTraffic(dt: number, t: number, player: Obstacle) {
  frameNo++
  // top the population up to the chosen level (a spawn attempt can fail when roads are crowded)
  let budget = 6
  for (let i = 0; i < targetCars && budget > 0; i++) {
    if (!cars[i].active) {
      budget--
      cars[i].active = spawn(cars[i], player, 150)
    }
  }
  for (const g of grid) g.length = 0
  for (const l of ringCars.values()) l.length = 0
  for (let i = 0; i < cars.length; i++) {
    const cc = cars[i]
    if (!cc.active) continue
    grid[cellOf(cc.x, cc.z)].push(i)
    const pp = PIECES[cc.piece]
    if (pp.kind === 'ring') {
      let l = ringCars.get(pp.node)
      if (!l) ringCars.set(pp.node, (l = []))
      l.push(i)
    }
  }

  for (const c of cars) {
    if (!c.active) continue
    if (Math.hypot(wrapD(c.x - player.x), wrapD(c.z - player.z)) > WIN_RECYCLE) {
      spawn(c, player, 190) // reappear far ahead / behind, out of sight
      if (Math.hypot(wrapD(c.x - player.x), wrapD(c.z - player.z)) > WIN_RECYCLE) continue // no free spot yet: try again next frame
    }
    const p = PIECES[c.piece]
    const fx = -Math.sin(c.h)
    const fz = -Math.cos(c.h)
    let gap = 1e9
    let lv = 0
    c.behindPlayer = false

    // 1. vehicle ahead (cone test, works for crossing traffic and the player too)
    if (c.npPiece !== c.piece) {
      c.np = nextPiece(c, p)
      c.np2 = c.np !== undefined ? nextPiece(c, PIECES[c.np]) : undefined
      c.npPiece = c.piece
    }
    const np = c.np
    const np2 = c.np2
    // the neighbour search is the expensive part: refresh it every other frame per car (16 ms of staleness is invisible)
    if (((frameNo + c.id) & 1) !== 0) {
      gap = c.cGap
      lv = c.cLv
      c.behindPlayer = c.cBP
    } else {
      const consider = (ox: number, oz: number, speed: number, isPlayer = false) => {
        let rx = ox - c.x
        let rz = oz - c.z
        if (rx > 400) rx -= 800
        else if (rx < -400) rx += 800
        if (rz > 400) rz -= 800
        else if (rz < -400) rz += 800
        if (rx * rx + rz * rz > 2100) return // beyond 45 m
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
            if (c.ghost <= 0) consider(o.x, o.z, o.speed) // a 'ghost' ignores crossing traffic, never the queue ahead
            // follow along the path, not just straight ahead: this keeps cars apart in turns
            if (o.piece === c.piece && o.s > c.s) {
              const g = o.s - c.s - CAR_L
              if (g < gap) { gap = g; lv = o.speed }
            } else if (np !== undefined && o.piece === np) {
              const g = p.len - c.s + o.s - CAR_L
              if (g < gap) { gap = g; lv = o.speed }
            } else if (np2 !== undefined && o.piece === np2) {
              // short pieces (tight rings) can be shorter than a car: look two pieces ahead as well
              const g = p.len - c.s + PIECES[np!].len + o.s - CAR_L
              if (g < gap) { gap = g; lv = o.speed }
            }
          }
        }
      }
      if (c.ghost <= 0) consider(player.x, player.z, player.speed, true)
      c.cGap = gap
      c.cLv = lv
      c.cBP = c.behindPlayer
    }

    // 2. red / amber light at the end of this road
    let vcap = p.vmax
    const toEnd = p.len - c.s
    if (p.kind === 'edge') {
      if (p.toKind === 'signal') {
        const dist = toEnd - 3.9
        const col = signalColor(p.node, p.axis as 0 | 1, t, maneuver(c, p) === 'L' ? 'L' : 'T')
        if (dist > -0.5 && (col === 2 || (col === 1 && dist > (c.speed * c.speed) / 7 + 1))) {
          if (dist < gap) {
            gap = Math.max(dist, 0.05)
            lv = 0
          }
        }
      } else if (toEnd < 45) {
        // Approach a roundabout: slow down early, stop at the yield line if a car is coming round, then go when it is clear.
        vcap = Math.min(vcap, 3.5 + toEnd * 0.16)
        const line = toEnd - 2.6 // the yield line is a couple of metres before the ring
        if (rbSpecOfNode(p.node).signals) {
          // signalised roundabout: stop at the line before the crosswalk on red (and on amber if there is room to stop)
          const sl = toEnd - 18.5
          const col = signalColor(p.node, p.axis as 0 | 1, t, 'T')
          if (sl > -0.5 && (col === 2 || (col === 1 && sl > (c.speed * c.speed) / 7 + 1)) && sl < gap) {
            gap = Math.max(sl, 0.05)
            lv = 0
          }
        }
        const busy = ringBusy(p.node, p.arm, player)
        if (busy) {
          c.rbWait = 1
          if (line > -0.5 && line < gap) {
            gap = Math.max(line, 0.05)
            lv = 0
          }
        } else if (c.speed < 0.4 && c.rbWait > 0) {
          c.rbWait = 0 // the gap has come: pull away
        }
      }
    }

    // 3. turns: slow down, give way when turning left across oncoming traffic
    if (p.kind === 'edge' && p.toKind === 'signal') {
      const m = maneuver(c, p)
      if (m !== 'S' && toEnd < 32) vcap = Math.min(vcap, 8)
      if (toEnd < 28 && toEnd - 3.9 > -0.5 && exitBlocked(c, p)) {
        const dist = toEnd - 3.9
        if (dist < gap) {
          gap = Math.max(dist, 0.05)
          lv = 0
        }
      }
      if (m === 'L' && toEnd < 40) {
        const dist = toEnd - 3.9
        if (dist > -2 && c.waitL < 12 && leftConflict(c, p, t, player)) {
          if (dist < gap) {
            gap = Math.max(dist, 0.05)
            lv = 0
          }
          if (c.speed < 0.3) c.waitL += dt
        } else if (dist > -2 && c.speed < 0.3 && c.waitL >= 12) c.waitL += dt
      } else c.waitL = 0
    }

    // 4. indicators and lane changes
    c.cool -= dt
    if (p.kind === 'edge') {
      c.turnSig = p.toKind === 'signal' && toEnd < 45 ? (maneuver(c, p) === 'L' ? -1 : maneuver(c, p) === 'R' ? 1 : 0) : 0
      if (c.lcT >= 0) {
        c.lcT += dt
        if (c.lcT >= c.lcDur) {
          c.lcT = -1
          c.lcSig = 0
        }
      } else if (c.lcWant !== 0) {
        c.lcPrep -= dt
        if (c.lcPrep <= 0) {
          const dir = c.lcWant
          c.lcWant = 0
          if (toEnd > 45 && laneSafe(c, p, dir, player)) {
            startChange(c, p, dir)
            c.cool = p.toKind === 'signal' && c.plan !== 'S' ? 1 : 6 + Math.random() * 6
          } else {
            c.lcSig = 0
            c.cool = 1.5
          }
        }
      } else if (c.cool <= 0 && c.speed > 3 && c.s > 12 && toEnd > 34 && c.ghost <= 0 && p.sibs) decideLane(c, p, gap, lv, toEnd)
    } else if (p.kind === 'ring') {
      c.turnSig = p.ringType === 'between' && c.exitArm === p.arm ? 1 : 0
    } else if (p.entry) c.turnSig = 0
    c.sig = c.lcSig !== 0 ? c.lcSig : c.turnSig

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
      const np = PIECES[nxt]
      c.lane = np.lane
      c.lcT = -1
      c.lcSig = 0
      c.lcWant = 0
      if (np.kind === 'edge') {
        c.turnSig = 0
        c.v0 = laneV0(c, np.lane)
        c.cool = rand(0.3, 2)
        planEdge(c, np)
      }
    }
    place(c)
  }
}

