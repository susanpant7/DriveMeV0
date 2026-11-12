import { LAYOUT, WEDGE_LEN, clearance, nodeX, nodeZ, BOX, EDGE_IDS, LANES, L_LEFT, L_LEFT2, L_RIGHT, LANE_W, LINKS, P, PIECES, speedLimit, armCtrl, arrowPhase, noTurnOnRed, mod, nodeIJ, rbSpecOfNode, pieceAt, signalColor, wrapD, type Piece } from './map'

export const MAX_CARS = 900
export const CAR_L = 4.4
export const CAR_W = 1.82
const COLORS = ['#2e86de', '#f1c40f', '#ecf0f1', '#27ae60', '#8e44ad', '#e67e22', '#34495e', '#16a085', '#c0392b', '#95a5a6']

export interface AiCar {
  len?: number // body length / width in metres when it is not an ordinary car (trucks on the highway)
  wid?: number
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
  /** stop / yield junctions: the approach piece this car has made its stop on, the one it has been released from, and when it stopped */
  stopPiece: number
  goPiece: number
  stopAt: number
  jWait: number // seconds spent waiting for a gap at a STOP / YIELD sign
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
  // the body yaw follows the path heading through a short low-pass (like a real car's steering response), so tight corners and the
  // joins between road pieces never show as sudden steps in heading
  const target = Math.atan2(-tmp.dx, -tmp.dz) + yaw
  let dh = target - c.h
  dh = Math.atan2(Math.sin(dh), Math.cos(dh))
  if (Math.abs(dh) > 1.0 || !(placeDt > 0)) c.h = target
  else c.h += dh * Math.min(1, placeDt / 0.22)
}
let placeDt = 0

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
/** Where a lane sits across the road, left to right. Approaching a signalised junction the NEW left-turn lane (index 2) is the left-most
 *  one, then lane 0 (straight on) and lane 1 (straight on or right). Elsewhere the order is simply 0, 1, 2. */
const physIdx = (p: Piece, k: number) => (p.toKind !== 'signal' ? k : k === L_LEFT2 ? -2 : k === L_LEFT ? -1 : k === L_RIGHT ? 2 : k)
/** the lane next to `p.lane` on its right (dir +1) or left (dir -1), or -1 */
const nbr = (p: Piece, dir: -1 | 1): number => {
  const want = physIdx(p, p.lane) + dir
  for (let k = 0; k < LANES; k++) if (physIdx(p, k) === want) return k
  return -1
}
/** may a car in lane k of this approach turn left / go straight on / turn right at the junction ahead? */
const does = (p: Piece, k: number, m: 'L' | 'S' | 'R') => (m === 'L' ? LINKS.connL : m === 'R' ? LINKS.connR : LINKS.connS).has(`${p.node}:${p.arm}:${k}`)
/** the lanes of this approach (usable by traffic) from which manoeuvre m can be made */
const lanesFor = (p: Piece, m: 'L' | 'S' | 'R') => { const out: number[] = []; for (let k = 0; k < LANES; k++) if (laneOk(p, k) && does(p, k, m)) out.push(k); return out }
const hasLeft = (p: Piece) => {
  if (p.hl === undefined) p.hl = p.toKind === 'signal' && lanesFor(p, 'L').length > 0 && leftExitOk(p)
  return p.hl
}

/** What the car will actually do at the end of this road: what it plans, if its lane allows that; otherwise what the lane allows. */
function maneuver(c: AiCar, p: Piece): 'L' | 'S' | 'R' {
  if (p.toKind !== 'signal') return 'S'
  if (c.plan !== 'S' && does(p, p.lane, c.plan)) return c.plan
  if (does(p, p.lane, 'S')) return 'S'
  return does(p, p.lane, 'L') ? 'L' : does(p, p.lane, 'R') ? 'R' : 'S'
}

/** can a car at this junction go straight on / turn right at all? (not at a T-junction whose road does not continue / turn) */
const canStraight = (p: Piece) => lanesFor(p, 'S').length > 0
const canRight = (p: Piece) => lanesFor(p, 'R').length > 0

function planEdge(c: AiCar, p: Piece) {
  c.plan = 'S'
  if (p.kind === 'edge' && p.toKind === 'round' && p.lane === 0 && !p.one && rbSpecOfNode(p.node).laneR.length === 1) c.cool = 0 // start merging out of the closing lane at once
  if (p.kind !== 'edge' || p.toKind !== 'signal') return
  const r = Math.random()
  if (r < 0.18 && hasLeft(p)) c.plan = 'L'
  else if (r < 0.4 && canRight(p)) c.plan = 'R'
  // the stem of a T-junction has no straight on: it has to turn
  if (c.plan === 'S' && !canStraight(p)) c.plan = hasLeft(p) && (!canRight(p) || Math.random() < 0.5) ? 'L' : canRight(p) ? 'R' : 'S'
}

function reqLane(c: AiCar, p: Piece) {
  const m = c.plan === 'L' && hasLeft(p) ? 'L' : c.plan === 'R' && canRight(p) ? 'R' : 'S'
  if (does(p, p.lane, m) && laneOk(p, p.lane)) return p.lane // already in a lane that does it
  const ok = lanesFor(p, m)
  if (!ok.length) return p.lane
  // the nearest suitable lane (with two left-turn lanes, cars spread over both)
  if (m === 'L' && ok.length > 1) return ok[c.id % ok.length]
  return ok.reduce((best, k) => (Math.abs(physIdx(p, k) - physIdx(p, p.lane)) < Math.abs(physIdx(p, best) - physIdx(p, p.lane)) ? k : best), ok[0])
}

/** Right lane: at (or just under) the speed limit. Left lanes may go faster. */
function laneV0(c: AiCar, lane: number, one = false, lim?: number) {
  if (one) return Math.min(c.pref, (lim ?? speedLimit(true)) * 1.02) // a residential street: about its limit (10 to 25 mph)
  // a town road (40 to 50 mph): each driver's own pace, scaled to the road's limit (c.pref is set for a 30 mph road)
  const L = lim ?? speedLimit(false), v = c.pref * (L / (30 * 0.44704))
  if (lane >= 1) return Math.min(v, L * 0.99) // right / outer lane: at (or just under) the limit
  return Math.min(v, L * 1.08) // inner lane: may go a little faster
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
    if (p.toKind === 'signal' && (p.lane === L_LEFT || p.lane === L_LEFT2) && !hasLeft(p)) continue // a left-turn lane needs a left turn to exist
    if (p.laneFrom !== undefined && s < p.laneFrom + 4) continue // the added right-turn lane only exists near the junction
    if (p.one && LAYOUT.kind === 'mixed' && Math.random() > 0.35) continue // quiet residential streets: most traffic is on the main roads
    if (player) {
      const dd = Math.hypot(wrapD(x - player.x), wrapD(z - player.z))
      if (dd < minD || dd > WIN_MAX) continue
    }
    let near = 1e9
    for (const o of cars) if (o !== c && o.active) near = Math.min(near, Math.hypot(wrapD(x - o.x), wrapD(z - o.z)))
    if (near < 14) continue
    c.piece = pid
    c.stopPiece = c.goPiece = -1
    c.s = s
    c.lane = p.lane
    c.style = Math.random() < 0.7 ? 0 : 1
    c.pref = c.style === 0 ? rand(12.4, 13.3) : rand(15, 19)
    c.v0 = laneV0(c, p.lane, p.one, p.lim)
    // never appear moving faster than the car could stop from before the nearest car (it may be the tail of a queue)
    c.speed = Math.min(c.v0 * 0.85, Math.sqrt(2 * 3 * Math.max(0, near - 10)))
    c.lcT = -1
    c.lcSig = 0
    c.lcWant = 0
    c.sig = 0
    c.turnSig = 0
    c.cool = rand(0.5, 5)
    c.waitL = 0
    c.rbWait = 0
    planEdge(c, p)
    if (p.toKind === 'signal') c.plan = !does(p, p.lane, 'S') ? (does(p, p.lane, 'L') ? 'L' : 'R') : does(p, p.lane, 'R') && Math.random() < 0.4 ? 'R' : does(p, p.lane, 'L') && hasLeft(p) && Math.random() < 0.25 ? 'L' : 'S'
    c.color = pick(COLORS)
    const r = Math.random()
    const homeStreet = LAYOUT.kind === 'res' || !!p.one // residential streets: small cars and SUVs only
    // body type: sedans most common, then pickups and vans; a few classics and sports cars for variety
    c.kind = r < 0.5 ? 0 : r < 0.72 ? 1 : r < 0.82 ? 2 : r < 0.88 ? 3 : r < 0.93 ? 4 : 5
    if (homeStreet && c.kind === 2) c.kind = 0 // no vans on residential streets
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
    cars.push({ id: i, active: false, piece: 0, s: 0, speed: 0, v0: 12, lane: 0, exitArm: 0, x: 0, z: 0, h: 0, color: COLORS[0], stuck: 0, ghost: 0, braking: false, behindPlayer: false, stopPiece: -1, goPiece: -1, stopAt: 0, jWait: 0, kind: 0, style: 0, pref: 12, plan: 'S', turnSig: 0, lcSig: 0, sig: 0, lcWant: 0, lcPrep: 0, lcT: -1, lcDur: 2.8, lat0: 0, cool: 0, waitL: 0, rbWait: 0, cGap: 1e9, cLv: 0, cBP: false, np: undefined, np2: undefined, npPiece: -1 })
  }
}
initTraffic()

let targetCars = 0
let zoneTarget = -1
/**
 * Change how many cars there are without anyone popping in or out of view: new ones appear out of sight (in the spawn window),
 * and surplus ones are taken away when they are recycled (far behind you).
 */
export function setTrafficTarget(n: number) { targetCars = Math.min(n, cars.length); zoneTarget = n }
export function setActiveCount(n: number, player: Obstacle | null) {
  targetCars = n
  zoneTarget = -1
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
      let r: number | undefined
      if (m === 'L') r = L.connL.get(key)
      else if (m === 'R') r = L.connR.get(key) ?? L.connS.get(key)
      else r = L.connS.get(key)
      if (r !== undefined) return r
      // that move does not exist here (T-junction): take whichever turn the road has
      for (const alt of [L.connL, L.connR, L.connS]) {
        const q = alt.get(key) ?? alt.get(`${p.node}:${p.arm}:${p.lane === 1 ? 0 : p.lane}`)
        if (q !== undefined) return q
      }
      return undefined
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
    // pick an exit among the roads this roundabout really has: with one circulating lane any exit; with two, the right lane
    // takes the first exit or straight on and the left lane straight on or the third exit. A one-exit roundabout turns you round.
    const open = (arm: number) => LINKS.exitC.has(`${p.node}:${arm}:0`)
    const prefs = rbSpecOfNode(p.node).laneR.length === 1 ? [1, 2, 3, 0] : p.lane === 1 ? [1, 2] : [2, 3, 0] // 4th exit = back the way it came (from the left lane)
    let cand = prefs.map((o) => (p.arm + o) % 4).filter(open)
    if (!cand.length) cand = [1, 2, 3, 0].map((o) => (p.arm + o) % 4).filter(open)
    c.exitArm = cand.length ? cand[Math.floor(Math.random() * cand.length)] : p.arm
  }
  return nextPiece(c, p)
}

/** Is any vehicle circulating just upstream of this roundabout entry? */
export function ringBusy(node: number, arm: number, player: Obstacle | null, ownSpeed = 0, careful = false): boolean {
  const [i, j] = nodeIJ(node)
  const cx = nodeX(i)
  const cz = nodeZ(j)
  const spec = rbSpecOfNode(node)
  const rMid = spec.laneR.reduce((a, b) => a + b, 0) / spec.laneR.length
  const entryAng = (arm * Math.PI) / 2
  // Judge each circulating vehicle by how long it takes to reach this entry: a driver who is already rolling needs a smaller gap
  // than one who is stopped, and anything that has just passed the entry (or is leaving first) is no obstacle.
  // Other cars are careful: they give way to anything circulating that will reach the entry soon, however slowly it is moving, and never
  // pull out in front of a vehicle that is close upstream (the player's own yield check keeps the lighter margins).
  const tGap = careful ? 3.6 : ownSpeed > 2 ? 2.0 : 2.8
  const minDist = careful ? 16 : 8
  const conflict = (x: number, z: number, speed: number, exitArm: number, isPlayer: boolean) => {
    const dx = wrapD(x - cx)
    const dz = wrapD(z - cz)
    const r = Math.hypot(dx, dz)
    if (r > spec.outer + 3 || r < spec.apron - 3) return false
    const ang = Math.atan2(-dz, dx)
    const toEntry = mod(entryAng - ang, Math.PI * 2) // how far round it still has to go to reach this entry
    if (toEntry > Math.PI * 2 - (careful ? 0.22 : 0.12)) return false // just passed the entry: we can slot in behind it
    const dist = toEntry * rMid
    if (dist > 60) return false
    if (!isPlayer && exitArm !== arm) {
      const toExit = mod((exitArm * Math.PI) / 2 - ang, Math.PI * 2)
      if (toExit < toEntry - (careful ? 0.3 : 0.1)) return false // it clearly leaves the roundabout before it gets here
    }
    return dist < minDist || dist / Math.max(speed, careful ? 3 : 1.5) < tGap
  }
  for (const ci of ringCars.get(node) ?? []) {
    const c = cars[ci]
    if (conflict(c.x, c.z, c.speed, c.exitArm, false)) return true
  }
  return !!player && conflict(player.x, player.z, player.speed, -1, true)
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
/** cells per side: the world's period changes with the course (the residential town is smaller), so it is kept up to date */
let CN = Math.round(P / CELL)
const grid: number[][] = Array.from({ length: 40 * 40 }, () => [])
const cellOf = (x: number, z: number) => (Math.floor(x / CELL) % CN) * CN + (Math.floor(z / CELL) % CN)


/** Is the target lane free of other cars (and the player) alongside, ahead and behind? */
function laneSafe(c: AiCar, p: Piece, dir: -1 | 1, player: Obstacle): boolean {
  const target = nbr(p, dir)
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
  const target = nbr(p, dir)
  c.lat0 = -dir * LANE_W // the new lane's centre is dir*LANE_W to the right of where the car is
  c.lcT = 0
  c.lcDur = 2.8
  const was = c.piece
  c.piece = p.sibs![target]
  if (c.stopPiece === was) c.stopPiece = c.piece
  if (c.goPiece === was) c.goPiece = c.piece
  c.lane = target
  c.v0 = laneV0(c, target)
}

function decideLane(c: AiCar, p: Piece, gap: number, lv: number, toEnd: number) {
  let want: -1 | 0 | 1 = 0
  let urgent = false
  if (p.toKind === 'round' && p.lane === 0 && !p.one && rbSpecOfNode(p.node).laneR.length === 1) {
    want = 1 // the left lane is closed ahead (one-lane roundabout): merge right in good time
    urgent = true
  } else if (p.toKind === 'signal') {
    const req = reqLane(c, p)
    if (p.lane !== req) {
      want = physIdx(p, req) > physIdx(p, p.lane) ? 1 : -1
      urgent = true
    } else if (p.lane === 1 && toEnd > 140 && gap < 32 && lv < c.pref * 0.88 && laneOk(p, 0, c.s)) {
      want = -1 // overtake a slower car on the left, well before the junction
    }
  }
  if (want && laneOk(p, nbr(p, want), c.s)) {
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
  const gx = Math.floor(nodeX(ji) / CELL)
  const gz = Math.floor(nodeZ(jj) / CELL)
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
function leftConflict(c: AiCar, p: Piece, t: number, player: Obstacle, toEnd: number): boolean {
  const [ji, jj] = nodeIJ(p.node)
  const cx = nodeX(ji)
  const cz = nodeZ(jj)
  const gx = Math.floor(cx / CELL)
  const gz = Math.floor(cz / CELL)
  const JB = clearance(ji, jj, p.axis ?? 0) // how far the junction reaches along this road (the stop line is just beyond it)
  const fx = -Math.sin(c.h)
  const fz = -Math.cos(c.h)
  const opp = (p.arm + 2) % 4
  // How long will this car need to get across the oncoming lanes? It has toEnd to the junction edge, then about half the junction before it
  // has crossed. A moving driver needs less time than one waiting at the line. The oncoming vehicle is a conflict only if it would
  // reach the crossing point before we are clear (plus a safety margin): so a driver can go if the oncoming car is far enough away.
  const dCross = Math.max(toEnd - 3.9, 0) + JB * 0.9
  const tClear = (-c.speed + Math.sqrt(c.speed * c.speed + 2 * 2 * dCross)) / 2 + 1.2 // accelerating at about 2 m/s2
  const lights = armCtrl(p.node, p.axis ?? 0) === 'light'
  // a green ARROW is a protected turn: oncoming traffic has a red light
  if (lights && arrowPhase(p.node, p.axis ?? 0, t) === 0) return false
  const oppCtl = armCtrl(p.node, p.axis ?? 0) // the oncoming approach is on the same road, so it faces the same control
  // the light has gone amber while this driver waits to turn: oncoming traffic is stopping, so the turn is completed now (only a car
  // that is too close to stop still counts). This is how a permissive left turn clears at the end of the green.
  const ownCol = lights ? signalColor(p.node, p.axis as 0 | 1, t, 'T') : 0
  const clearing = lights && c.waitL > 1.5 && (ownCol === 1 || (ownCol === 2 && (signalColor(p.node, p.axis as 0 | 1, t - 3, 'T') === 1 || signalColor(p.node, p.axis as 0 | 1, t - 5, 'T') === 1)))
  for (let ix = -1; ix <= 1; ix++) {
    for (let iz = -1; iz <= 1; iz++) {
      for (const oi of grid[mod(gx + ix, CN) * CN + mod(gz + iz, CN)]) {
        const o = cars[oi]
        if (o === c) continue
        const op = PIECES[o.piece]
        if (op.kind === 'edge' && op.node === p.node && op.arm === opp) {
          // oncoming and about to enter, with a light that isn't red, and not turning left itself
          const left = op.len - o.s
          if (o.speed < 0.5 && o.cGap < 10 && left > 4) continue // stuck in a queue behind another car: it is not coming
          if (o.speed < 0.5 && c.waitL > 6) continue // it has been standing there (jammed beyond the junction) while we wait: go
          const eta = (left + JB * 0.4) / Math.max(o.speed, 3.5) // when it reaches the crossing point
          if (clearing && (left > (o.speed * o.speed) / 7 + 3 || o.speed < 2)) continue // it will stop for the amber / red
          if (!lights && oppCtl !== 'free' && o.goPiece !== o.piece) continue // it has a STOP / YIELD sign of its own and has not set off yet
          if (left < 140 && eta < tClear + (c.waitL > 30 ? -0.3 : c.waitL > 15 ? 0.3 : 1.0) && (!lights || signalColor(p.node, op.axis as 0 | 1, t, 'T') !== 2) && maneuver(o, op) !== 'L') return true
        } else if (op.kind === 'conn' && op.node === p.node && o.speed > 0.8) {
          const ofx = -Math.sin(o.h)
          const ofz = -Math.cos(o.h)
          if (ofx * fx + ofz * fz < -0.5 && Math.hypot(wrapD(o.x - cx), wrapD(o.z - cz)) < JB + 4) return true
        }
      }
    }
  }
  const pdx = wrapD(player.x - cx)
  const pdz = wrapD(player.z - cz)
  const pfx = -Math.sin(player.h)
  const pfz = -Math.cos(player.h)
  // The player coming the other way (still short of the junction centre) has right of way: wait for them, whether they are rolling or waiting at the line
  if (pfx * fx + pfz * fz < -0.5) {
    const d = Math.hypot(pdx, pdz)
    const approaching = -(pdx * pfx + pdz * pfz) > -6 // the player is still before, or just at, the centre of the junction
    if (approaching && d < 140 && (d + JB * 0.4) / Math.max(player.speed, 3.5) < tClear + 1.0) return true
  }
  return false
}

let frameNo = 0
let leftConns: Set<number> | null = null
let leftConnsN = -1
function isLeftConn(id: number) {
  if (!leftConns || leftConnsN !== LAYOUT.version) { leftConns = new Set(LINKS.connL.values()); leftConnsN = LAYOUT.version }
  return leftConns.has(id)
}
/** when the player last came to rest (for "who stopped first" at an all-way stop) */
const playerStop = { since: -1 }
/**
 * Stop / yield junctions: may a driver waiting on approach `arm` of `node` go? Not while
 *  - somebody is crossing the junction (from another approach),
 *  - traffic on the priority road is close (two-way stop, yield), or
 *  - at an all-way stop, a driver on another approach stopped first.
 * `self` is the AI car asking (null: the player; then `stoppedAt` is when the player stopped).
 */
export function junctionBusy(node: number, arm: number, self: AiCar | null, stoppedAt: number, player: Obstacle | null, tGap = 4.5): boolean {
  const [ji, jj] = nodeIJ(node)
  const cx = nodeX(ji), cz = nodeZ(jj)
  const myAxis = arm % 2 === 0 ? 0 : 1
  const allway = armCtrl(node, 1 - myAxis) === 'stop' && armCtrl(node, myAxis) === 'stop'
  for (const o of cars) {
    if (!o.active || o === self) continue
    const op = PIECES[o.piece]
    if (op.node !== node) continue
    if (op.kind === 'conn') {
      // already crossing: wait unless it came from my own approach (it is simply ahead of me) or is all but out
      if (o.s < op.len - 5 && (op.entry === undefined) && o.goPiece >= 0 && PIECES[o.goPiece]?.arm !== arm) return true
      continue
    }
    if (op.kind !== 'edge' || op.arm === arm) continue
    const toEnd = op.len - o.s
    const ctl = armCtrl(node, op.axis ?? 0)
    if (ctl === 'free') { if (o.speed > 1 && toEnd < 60 && toEnd / Math.max(o.speed, 4) < tGap) return true } // the priority road (a car standing in a queue there is not coming)
    else if (allway && o.stopPiece === o.piece && o.goPiece !== o.piece && o.stopAt < stoppedAt) return true // they stopped first
  }
  if (self && player) {
    const dx = wrapD(player.x - cx), dz = wrapD(player.z - cz)
    if (Math.abs(dx) < BOX && Math.abs(dz) < BOX) return true // you are crossing
    const fx = -Math.sin(player.h), fz = -Math.cos(player.h)
    const toward = -(dx * fx + dz * fz) // metres you still have to the middle of the junction
    const off = Math.abs(dx * -fz + dz * fx)
    const pAxis = Math.abs(fx) > Math.abs(fz) ? 0 : 1
    if (toward > 0 && off < 14 && pAxis !== myAxis) {
      const pc = armCtrl(node, pAxis)
      if (pc === 'free' && toward < 90 && (toward - BOX) / Math.max(player.speed, 4) < tGap) return true
      // all-way stop: you stopped at your line before this driver did, so it is your turn (they will not wait for ever)
      if (allway && toward < BOX + 12 && player.speed < 1.5 && playerStop.since >= 0 && playerStop.since < stoppedAt && stoppedAt > 0 && sinceNow - stoppedAt < 7) return true
    }
  }
  return false
}
let sinceNow = 0

/** Turning right on red: is anything coming that we would pull out in front of (traffic from the left on the road we turn onto, or
 *  anyone already crossing the junction)? */
function rightOnRedBusy(c: AiCar, p: Piece, player: Obstacle): boolean {
  const crossArm = (p.arm + 3) % 4 // the approach on our left
  for (const o of cars) {
    if (!o.active || o === c) continue
    const op = PIECES[o.piece]
    if (op.node !== p.node) continue
    if (op.kind === 'conn' && o.speed > 1) return true
    if (op.kind === 'edge' && op.arm === crossArm) { const te = op.len - o.s; if (te < 70 && o.speed > 2 && te / o.speed < 5.5) return true }
  }
  const [ji, jj] = nodeIJ(p.node)
  const dx = wrapD(player.x - nodeX(ji)), dz = wrapD(player.z - nodeZ(jj))
  const [ox, oz] = [[1, 0], [0, -1], [-1, 0], [0, 1]][crossArm]
  const u = dx * ox + dz * oz, side = Math.abs(-dx * oz + dz * ox)
  const toward = -(-Math.sin(player.h) * ox + -Math.cos(player.h) * oz) // > 0: heading into the junction along that arm
  if (Math.abs(dx) < 25 && Math.abs(dz) < 25 && player.speed > 1) return true // you are in the junction
  if (u > 0 && u < 80 && side < 14 && toward > 0.7 && player.speed > 2 && u / player.speed < 6) return true
  return false
}

export function stepTraffic(dt: number, t: number, player: Obstacle) {
  sinceNow = t
  if (player.speed < 0.4) { if (playerStop.since < 0) playerStop.since = t } else if (player.speed > 1.5) playerStop.since = -1

  placeDt = dt
  frameNo++
  // top the population up to the chosen level (a spawn attempt can fail when roads are crowded)
  let budget = 6
  for (let i = 0; i < targetCars && budget > 0; i++) {
    if (!cars[i].active) {
      budget--
      cars[i].active = spawn(cars[i], player, 150)
    }
  }
  CN = Math.round(P / CELL)
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
      if (zoneTarget >= 0 && c.id >= zoneTarget) { c.active = false; continue } // fewer cars wanted here now: this one leaves, out of sight
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
        if (rx > P / 2) rx -= P
        else if (rx < -P / 2) rx += P
        if (rz > P / 2) rz -= P
        else if (rz < -P / 2) rz += P
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
            // two drivers turning left from opposite directions pass in front of each other: they are not in each other's way
            const bothLeft = p.kind === 'conn' && isLeftConn(c.piece) && isLeftConn(o.piece) && PIECES[o.piece].node === p.node && (PIECES[o.piece].arm + 2) % 4 === p.arm
            if (c.ghost <= 0 && !bothLeft) consider(o.x, o.z, o.speed) // a 'ghost' ignores crossing traffic, never the queue ahead
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
      const ctl = p.toKind === 'signal' ? armCtrl(p.node, p.axis ?? 0) : 'light'
      if (p.toKind === 'signal' && ctl !== 'light') {
        // STOP / YIELD sign: come to a full stop at the line (stop), then go only when the junction is clear and it is this driver's turn
        const dist = toEnd - 3.9
        if (ctl !== 'free' && c.goPiece !== c.piece && dist > -1.5 && toEnd < 60) {
          vcap = Math.min(vcap, 4.5 + Math.max(0, dist) * 0.3)
          if (ctl === 'stop' && c.stopPiece !== c.piece) {
            if (c.speed < 0.25 && dist < 3) { c.stopPiece = c.piece; c.stopAt = t }
            if (dist < gap) { gap = Math.max(dist, 0.05); lv = 0 }
          } else if (dist < 14 && (t - c.stopAt < 0.9 && ctl === 'stop' || junctionBusy(p.node, p.arm, c, ctl === 'stop' ? c.stopAt : t, player, c.jWait > 25 ? 1.8 : c.jWait > 10 ? 2.6 : 3.6))) {
            if (dist < gap) { gap = Math.max(dist, 0.05); lv = 0 }
            if (c.speed < 0.3) c.jWait += dt
          } else if (dist < 14) { c.goPiece = c.piece; c.jWait = 0 }
        } else if (ctl === 'free') c.goPiece = c.piece
      } else if (p.toKind === 'signal') {
        const dist = toEnd - 3.9
        const col = signalColor(p.node, p.axis as 0 | 1, t, maneuver(c, p) === 'L' ? 'L' : 'T')
        // a driver who has been waiting at the line to turn left on a plain green completes the turn as the light changes
        const finishLeft = col === 2 && c.waitL > 1.5 && dist < 3 && (signalColor(p.node, p.axis as 0 | 1, t - 3, 'T') === 1 || signalColor(p.node, p.axis as 0 | 1, t - 5, 'T') === 1)
        // right on red (unless a "NO TURN ON RED" sign says otherwise): a full stop at the line, then go when the road is clear from the left
        const rightOnRed = col === 2 && maneuver(c, p) === 'R' && !noTurnOnRed(p.node, p.axis ?? 0) && dist > -0.5
        if (rightOnRed && c.goPiece !== c.piece) {
          let hold = true
          if (c.stopPiece !== c.piece) { if (c.speed < 0.25 && dist < 3) { c.stopPiece = c.piece; c.stopAt = t } }
          else if (t - c.stopAt > 1.2 && !rightOnRedBusy(c, p, player)) { c.goPiece = c.piece; hold = false }
          if (hold && dist < gap) { gap = Math.max(dist, 0.05); lv = 0 }
        } else if (!rightOnRed && !finishLeft && dist > -0.5 && (col === 2 || (col === 1 && dist > (c.speed * c.speed) / 7 + 1))) {
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
        const busy = ringBusy(p.node, p.arm, player, c.speed, true)
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

    // a car still in the closing lane of a one-lane roundabout stops at the nose of the island until it can merge right
    const wedgeWait = p.kind === 'edge' && p.toKind === 'round' && p.lane === 0 && !p.one && rbSpecOfNode(p.node).laneR.length === 1 && c.ghost <= 0
    if (wedgeWait) {
      const dist = toEnd - WEDGE_LEN - 3
      if (dist > -1 && dist < gap) { gap = Math.max(dist, 0.05); lv = 0 }
    }
    // 3. turns: slow down, give way when turning left across oncoming traffic
    if (p.kind === 'edge' && p.toKind === 'signal') {
      const m = maneuver(c, p)
      if (m !== 'S' && toEnd < 90) vcap = Math.min(vcap, 8 + Math.max(0, toEnd - 25) * 0.3) // ease down in good time before turning (roads are 40-50 mph)
      if (toEnd < 28 && toEnd - 3.9 > -0.5 && exitBlocked(c, p)) {
        const dist = toEnd - 3.9
        if (dist < gap) {
          gap = Math.max(dist, 0.05)
          lv = 0
        }
      }
      if (m === 'L' && toEnd < 40) {
        const dist = toEnd - 3.9
        // yield for as long as oncoming traffic (or the player) is coming: a green ball is not a green arrow
        if (dist > -2 && leftConflict(c, p, t, player, toEnd)) {
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
      } else if (c.cool <= 0 && (c.speed > 3 || wedgeWait) && c.s > 12 && toEnd > 34 && c.ghost <= 0 && p.sibs) decideLane(c, p, gap, lv, toEnd)
    } else if (p.kind === 'ring') {
      c.turnSig = p.ringType === 'between' && c.exitArm === p.arm ? 1 : 0
    } else if (p.entry) c.turnSig = 0
    c.sig = c.lcSig !== 0 ? c.lcSig : c.turnSig

    const v0 = Math.min(c.v0, vcap)
    let acc = idm(c.speed, v0, gap, c.speed - lv)
    // you pulled into this driver's lane at about the speed of the traffic: they ease off to open the gap again, they do not stamp on the brake
    if (c.behindPlayer && gap > 2.5 && player.speed > c.speed - 3 && player.speed > 2) acc = Math.max(acc, -1.4)
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
        c.v0 = laneV0(c, np.lane, np.one, np.lim)
        c.cool = rand(0.3, 2)
        planEdge(c, np)
      }
    }
    place(c)
  }
}


/** dev: why is this car standing still? */
export function whyStuck(c: AiCar, t: number, player: Obstacle) {
  const p = PIECES[c.piece]
  const toEnd = p.len - c.s
  const m = p.kind === 'edge' ? maneuver(c, p) : '-'
  const ctl = p.kind === 'edge' && p.toKind === 'signal' ? armCtrl(p.node, p.axis ?? 0) : '-'
  return {
    m, ctl, toEnd: +toEnd.toFixed(1), gap: +c.cGap.toFixed(1), lv: +c.cLv.toFixed(1), ghost: c.ghost, waitL: +c.waitL.toFixed(0), bp: c.behindPlayer,
    col: p.kind === 'edge' && p.toKind === 'signal' ? signalColor(p.node, p.axis as 0 | 1, t, m === 'L' ? 'L' : 'T') : -1,
    exitBlocked: p.kind === 'edge' && p.toKind === 'signal' ? exitBlocked(c, p) : false,
    leftConflict: p.kind === 'edge' && p.toKind === 'signal' && m === 'L' ? leftConflict(c, p, t, player, toEnd) : false,
    busy: ctl === 'stop' || ctl === 'yield' ? junctionBusy(p.node, p.arm, c, c.stopAt, player) : false, stop: c.stopPiece === c.piece, go: c.goPiece === c.piece,
  }
}
