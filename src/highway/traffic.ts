import { cars, type AiCar } from '../game/trafficAI'
import { HW, NB_X as NBX, NL, Z_FINISH, Z_TOP, ACC_LEN, TAPER, C, hC, lanesAt, laneOpen, laneW, forkHeading, laneAt, laneShift, rampHeading, rampU, rampX, rampZ0, rampZ1, type Ramp } from './layout'

/**
 * Highway traffic. Every vehicle drives in one of the five lanes at its own pace inside that lane's speed band (the further left the lane,
 * the faster). Vehicles join from the entrances along the way and some leave by the exits; at a split they follow their branch; where a
 * lane ends they move over. Vehicles that fall far behind or get far ahead of you come round to the other side as fresh vehicles. On
 * the busiest setting the lanes are packed so tightly that the traffic slows to a crawl: a jam.
 */

/** [length, width] of each vehicle kind drawn by Traffic.tsx (collision boxes for trucks). */
const DIMS: Record<number, [number, number]> = {
  0: [4.6, 1.9], 1: [5.3, 2.1], 2: [5.2, 2.0], 3: [5.0, 2.0], 4: [5.4, 2.1], 5: [4.7, 1.85],
  6: [8.6, 2.5], 7: [21, 2.6], 8: [20, 2.6],
}
const COLORS = ['#2e86de', '#f1c40f', '#ecf0f1', '#27ae60', '#8e44ad', '#e67e22', '#34495e', '#16a085', '#c0392b', '#95a5a6', '#1b1b1b', '#bdc3c7']
const CAR_KINDS = [0, 0, 0, 1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5] // a good mix: sedans, SUVs, vans and the classics
const TRUCK_KINDS = [6, 6, 7, 7, 8]

const enum M { Lane, Exit, Enter }
interface Hw {
  mode: M
  lane: number // 0..4
  lat: number // lane-centre x, before any split shift
  target: number // lane being changed to (-1: none)
  ramp: number // the ramp being used (exiting or entering), index in the stage's ramps
  blend: number // 0 .. 1: how far across between the lane and the ramp
  merging: boolean // entering: moving across into the highway now
  lcFrom: number // a lane change: where it started (x), and how far through it is (0 .. 1; -1 = not changing lanes)
  lcT: number
  acc: number // the acceleration being used now (eased)
  vlo: number
  vhi: number
  v0: number
  vgoal: number
  vt: number
  cool: number
  pace: number // 0 (easy-going) .. 1 (in a hurry): where in each lane's speed band they drive
  exitP: number // how likely this driver is to be leaving at the next exit
  stage: number
}
const hw: Hw[] = []
let ncars = 0
let level = 1
/** the smallest bumper-to-bumper gap when placing vehicles: the busiest levels pack the lanes tightly (level 5 is a jam) */
const MARGIN = [40, 40, 38, 30, 3] // (a driver's own following distance at 70-90 mph: new vehicles never start bunched up)
/** vehicles in the window around you (about 1 km of highway): level 5 is bumper to bumper */
export const HW_TOTAL = [24, 45, 70, 120, 360]
/** how often a vehicle joins at each entrance (seconds) */
const JOIN_EVERY = [28, 16, 9, 5, 3]
const WINDOW = 650 // vehicles live this far ahead of / behind the player
const EXTRA = 16 // spare vehicles for the entrances

const MPH = 0.44704
/**
 * The speed band of a lane, counted from the right (the limit is 70 mph and nobody cruises below it): the right lane 70-75, the next
 * 75-80, then 80-85, 85-90 and 90-95. Trucks keep to the lower part of their band.
 */
export const bandOf = (fromRight: number): [number, number] => [(70 + 5 * fromRight) * MPH, (75 + 5 * fromRight) * MPH]
/** how the vehicles are shared between the lanes, and the chance a vehicle in each lane is a truck */
const LANE_COUNT = [11, 12, 12, 12, 12] // (an even share: a crowded right lane would crawl along below the limit)
const TRUCK_P = [0, 0.03, 0.07, 0.12, 0.2]

const rnd = (a: number, b: number) => a + Math.random() * (b - a)
/** smooth start and finish (for sideways moves) */
const ease = (t: number) => t * t * (3 - 2 * t)
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
const half = (c: AiCar) => (c.len ?? 4.6) / 2
const R = (h: Hw): Ramp | undefined => HW.s.ramps[h.ramp]

/** what kind of vehicle a new one in this lane is (trucks keep right) */
const newKind = (lane: number) => (Math.random() < TRUCK_P[Math.max(0, Math.min(4, lane))] ? pick(TRUCK_KINDS) : pick(CAR_KINDS))
const lenOf = (kind: number) => (DIMS[kind] ?? DIMS[0])[0]
function describe(c: AiCar, h: Hw, lane: number, kind = newKind(lane)) {
  const truck = kind >= 6
  c.kind = kind
  const [l, w] = DIMS[c.kind] ?? DIMS[0]
  c.len = l
  c.wid = w
  c.color = pick(COLORS)
  h.pace = truck ? Math.random() * 0.35 : Math.random()
  h.exitP = Math.random()
}
/** a driver's speed range for the lane they are in now (their pace sets where in the lane's band they cruise) */
function setBand(h: Hw, truck: boolean, z: number) {
  const [a, b] = bandOf(Math.max(0, Math.round(lanesAt(z)) - 1 - h.lane)) // (counted from the right-most lane there is here)
  const mid = a + h.pace * (b - a)
  h.vlo = Math.max(a, mid - 2 * MPH)
  h.vhi = truck ? Math.min(mid + 1.5 * MPH, a + 0.5 * (b - a)) : Math.min(b, mid + 2 * MPH)
  h.vgoal = mid
}
const isTruck = (c: AiCar) => (c.len ?? 4.6) > 8

/** a place for a new vehicle: busy in proportion to the number of lanes there (a narrow stretch is not more crowded per lane) */
const placeOk = (z: number) => Math.random() < lanesAt(z) / NL
function pickLane(z: number) {
  const sum = LANE_COUNT.reduce((a, b) => a + b, 0)
  for (let t = 0; t < 8; t++) {
    let r = Math.random() * sum, k = 0
    for (; k < NL - 1; k++) { r -= LANE_COUNT[k]; if (r < 0) break }
    if (!laneOpen(k, z, 400)) continue // only a lane that is there, and stays there for a while
    return k
  }
  return 0
}
/** x of a vehicle on the highway, with the split's shift */
const laneXz = (lane: number, lat: number, z: number) => lat + laneShift(lane, z)

function spacingOk(lane: number, z: number, len: number, skip = -1) {
  for (let i = 0; i < ncars; i++) {
    if (i === skip || !cars[i].active || hw[i].mode !== M.Lane) continue
    if (hw[i].lane !== lane && hw[i].target !== lane) continue
    if (Math.abs(cars[i].z - z) < half(cars[i]) + len / 2 + MARGIN[level - 1]) return false
  }
  return true
}
/** the speed of the vehicle just ahead in a lane (a new vehicle starts at the speed of the traffic it joins: no running into a queue) */
function speedNear(lane: number, z: number, fallback: number) {
  let best = 1e9, v = fallback
  for (let i = 0; i < ncars; i++) {
    if (!cars[i].active || hw[i].mode !== M.Lane || hw[i].lane !== lane) continue
    const d = z - cars[i].z // + = ahead of the new vehicle
    if (d > 0 && d < best) { best = d; v = cars[i].speed }
  }
  return best < 150 ? Math.min(fallback, v + best / 12) : fallback
}

function freshHw(): Hw {
  return { mode: M.Lane, lane: 2, lat: NBX[2], target: -1, ramp: -1, blend: 0, merging: false, lcFrom: 0, lcT: -1, acc: 0, vlo: 30, vhi: 33, v0: 31, vgoal: 31, vt: rnd(0, 8), cool: rnd(0, 6), pace: 0.5, exitP: 1, stage: HW.s.id }
}

function placeLane(i: number, lane: number, z: number, kind: number) {
  const c = cars[i]
  const h = (hw[i] = freshHw())
  describe(c, h, lane, kind)
  h.lane = lane
  h.lat = NBX[lane]
  setBand(h, isTruck(c), z)
  h.v0 = h.vgoal
  c.active = true
  c.z = z
  c.x = laneXz(lane, h.lat, z)
  c.h = lane >= (HW.s.fork?.split ?? 99) ? forkHeading(z) : 0
  c.speed = speedNear(lane, z, h.v0)
  c.sig = 0
  c.braking = false
}

let joinT: number[] = []
let player = { x: 0, z: 0, speed: 0 }

export function initHighwayTraffic(playerZ: number, playerXWorld = NBX[2]) {
  for (const c of cars) c.active = false
  hw.length = 0
  while (hw.length < cars.length) hw.push(freshHw())
  const playerX = playerXWorld - C(playerZ)
  player = { x: playerX, z: playerZ, speed: 0 }
  const total = Math.min(cars.length - EXTRA, HW_TOTAL[level - 1])
  ncars = Math.min(cars.length, total + EXTRA)
  let placed = 0
  for (let n = 0; n < total * 8 && placed < total; n++) {
    const z = playerZ + rnd(-WINDOW, WINDOW * 0.55)
    if (z > Z_TOP - 30 || z < Z_FINISH + 40 || !placeOk(z)) continue
    const lane = pickLane(z)
    if (Math.abs(z - playerZ) < 45 && Math.abs(NBX[lane] - playerX) < 5) continue // not on top of you
    const kind = newKind(lane)
    if (!spacingOk(lane, z, lenOf(kind))) continue
    placeLane(placed, lane, z, kind)
    placed++
  }
  // start everyone at the speed the traffic would settle to (a jam starts as a jam, not with everyone braking hard at once)
  sortTraffic()
  for (let i = 0; i < placed; i++) {
    const g = gapAhead(i).gap
    if (g < 1e8) cars[i].speed = Math.min(cars[i].speed, Math.max(0, (g - 4) / 1.4))
  }
  joinT = HW.s.ramps.map(() => rnd(0, JOIN_EVERY[level - 1]))
  warpAll()
}

export function setHighwayCount(l: number) {
  level = l
}

/** Move every vehicle along by dz (the course has started over at the next stage), dropping those that do not fit the new stage.
 *  (Road coordinates: call unwarpAll first, and warpAll once the new stage is in place.) */
export function shiftHighwayTraffic(dz: number, keep: (x: number, z: number) => boolean) {
  for (let i = 0; i < ncars; i++) {
    const c = cars[i]
    if (!c.active) continue
    const h = hw[i]
    if (h.mode !== M.Lane || h.target >= 0 || !keep(c.x, c.z)) { c.active = false; continue }
    c.z += dz
    h.stage = HW.s.id
    c.x = laneXz(h.lane, h.lat, c.z)
  }
}
/** a new stage has begun: its entrances start sending traffic */
export function resetJoins() {
  joinT = HW.s.ramps.map(() => rnd(0, JOIN_EVERY[level - 1]))
}

/** the active vehicles sorted by z (front first), rebuilt each step: each vehicle then only looks at its neighbours */
let order: number[] = []
const posOf = new Int32Array(1024)
function sortTraffic() {
  order = []
  for (let i = 0; i < ncars; i++) if (cars[i].active) order.push(i)
  order.sort((a, b) => cars[a].z - cars[b].z)
  order.forEach((i, k) => { posOf[i] = k })
}
/** the vehicle (or you) ahead of vehicle i, close enough sideways to matter */
function gapAhead(i: number) {
  const c = cars[i]
  let gap = 1e9, lv = 0
  const hx = c.x, hc = half(c)
  const p0 = posOf[i]
  // the ones a little behind (overlapping) and then everything ahead, nearest first, up to 250 m
  for (let k = p0 + 1; k < order.length && cars[order[k]].z < c.z + 12; k++) {
    const o = cars[order[k]]
    if (!o.active || Math.abs(o.x - hx) > 2.3) continue
    const d = c.z - o.z - hc - half(o)
    if (d > -1 && d < gap) { gap = d; lv = o.speed }
  }
  for (let k = p0 - 1; k >= 0; k--) {
    const o = cars[order[k]]
    if (c.z - o.z > 250) break
    if (!o.active || Math.abs(o.x - hx) > 2.3) continue
    const d = c.z - o.z - hc - half(o)
    if (d > -1 && d < gap) { gap = d; lv = o.speed }
    if (d > gap) break
  }
  if (Math.abs(player.x - hx) < 2.4) {
    const d = c.z - player.z - half(c) - 2.4
    if (d > -1 && d < gap) { gap = d; lv = player.speed }
  }
  return { gap, lv }
}

/** is there room to move into a lane at z? (traffic behind coming up fast needs more room; you count as traffic) */
function laneClear(lane: number, z: number, hf: number, speed: number) {
  for (let j = 0; j < ncars; j++) {
    if (!cars[j].active) continue
    const h = hw[j]
    if (h.mode === M.Lane ? h.lane !== lane && h.target !== lane : laneAt(cars[j].x, cars[j].z) !== lane) continue
    const d = cars[j].z - z // + = behind us
    if (d < 25 + Math.max(0, cars[j].speed - speed) * 3 && d > -(18 + hf)) return false
  }
  if (laneAt(player.x, player.z) === lane) {
    const d = player.z - z
    if (d < 25 + Math.max(0, player.speed - speed) * 3 && d > -(18 + hf)) return false
  }
  return true
}
/** a tight but safe gap (a zip merge where a lane ends): nobody right alongside, nothing just ahead */
function zipClear(lane: number, z: number, hf: number) {
  for (let j = 0; j < ncars; j++) {
    if (!cars[j].active || hw[j].mode !== M.Lane || (hw[j].lane !== lane && hw[j].target !== lane)) continue
    const d = cars[j].z - z
    if (d < 9 + hf && d > -(9 + hf)) return false
  }
  return !(laneAt(player.x, player.z) === lane && Math.abs(player.z - z) < 12)
}
/** a lane change is allowed: the lane exists here, and after a split the branches do not mix */
function laneOk(from: number, to: number, z: number) {
  if (to < 0 || to >= NL) return false
  if (!laneOpen(to, z, 250)) return false // (not into a lane that is ending, or not open yet)
  const f = HW.s.fork
  if (f && z < f.z + 40 && (from < f.split) !== (to < f.split)) return false
  return true
}

/** the entrance a new vehicle can join from: on-ramps in the window, not too close to you */
function spawnOnRamp(k: number) {
  const r = HW.s.ramps[k]
  if (r.kind !== 'on' || r.player) return
  const z = rampZ0(r) - 10
  if (Math.abs(z - player.z) > WINDOW * 0.9 || Math.abs(z - player.z) < 60) return
  let i = -1
  for (let j = 0; j < ncars; j++) if (!cars[j].active) { i = j; break }
  if (i < 0) return
  for (let j = 0; j < ncars; j++) if (cars[j].active && hw[j].mode === M.Enter && hw[j].ramp === k && Math.abs(cars[j].z - z) < 40) return
  const c = cars[i]
  const h = (hw[i] = freshHw())
  const lane = r.side === 1 ? NL - 1 : 0
  describe(c, h, lane)
  h.lane = lane
  h.lat = NBX[lane]
  setBand(h, isTruck(c), z)
  h.v0 = h.vgoal
  h.mode = M.Enter
  h.ramp = k
  h.blend = 0
  c.active = true
  c.z = z
  c.x = rampX(r, z)
  c.h = rampHeading(r, z)
  c.speed = 20
  c.sig = 0
  c.braking = false
}

/** the traffic works in road coordinates (as if the highway were straight); in between steps the vehicles are in the world */
export function unwarpAll() {
  for (let i = 0; i < ncars; i++) { const c = cars[i]; if (c.active) { c.x -= C(c.z); c.h -= hC(c.z) } }
}
export function warpAll() {
  for (let i = 0; i < ncars; i++) { const c = cars[i]; if (c.active) { c.x += C(c.z); c.h += hC(c.z) } }
}

export function stepHighwayTraffic(dt: number, t: number, p: { x: number; z: number; speed: number }) {
  unwarpAll()
  stepRoad(dt, t, { x: p.x - C(p.z), z: p.z, speed: p.speed })
  warpAll()
}
function stepRoad(dt: number, _t: number, p: { x: number; z: number; speed: number }) {
  player = p
  const s = HW.s
  // vehicles join at the entrances
  for (let k = 0; k < s.ramps.length; k++) {
    if ((joinT[k] -= dt) <= 0) { joinT[k] = JOIN_EVERY[level - 1] * rnd(0.6, 1.4); spawnOnRamp(k) }
  }
  const pLane = laneAt(p.x, p.z)
  const pAux = pLane === NL || pLane === -1 // you are on a ramp or in an extra lane
  sortTraffic()
  for (let i = 0; i < ncars; i++) {
    const c = cars[i]
    if (!c.active) continue
    const h = hw[i]
    const hf = half(c)
    const { gap, lv } = gapAhead(i)
    const r = R(h)

    if (h.mode === M.Lane) {
      // --- courtesy: a car in the lane beside an entrance moves over for you while you merge, if it can ---
      const edge = pLane === NL ? NL - 1 : 0
      if (pAux && h.lane === edge && h.target < 0 && c.z - p.z > -60 && c.z - p.z < 90 && c.speed > 10) {
        const to = edge === 0 ? 1 : NL - 2
        if (laneOk(h.lane, to, c.z) && laneClear(to, c.z, hf, c.speed)) h.target = to
      }
      // --- a lane that ends: move out of it in good time ---
      if (h.target < 0 && h.lane > 0 && !laneOpen(h.lane, c.z, 900)) {
        // its lane ends ahead: move over in good time. Running out of room: out of your sight the driver takes another way (leaves the
        // highway); near you they take a tighter gap (a zip merge). Nobody stops.
        const to = h.lane - 1
        const late = !laneOpen(h.lane, c.z, 150)
        if (laneClear(to, c.z, hf, c.speed)) h.target = to
        else if (late && Math.abs(c.z - p.z) > 160) { respawn(i); continue }
        else if (late && zipClear(to, c.z, hf)) h.target = to
      }
      // --- catching up with something slower: pass on the left if there is room, otherwise on the right ---
      h.cool -= dt
      if (h.target < 0 && h.cool <= 0 && gap < 60 && c.speed > lv + 1.5 && c.speed > 12) {
        if (laneOk(h.lane, h.lane - 1, c.z) && laneClear(h.lane - 1, c.z, hf, c.speed)) h.target = h.lane - 1
        else if (laneOk(h.lane, h.lane + 1, c.z) && laneClear(h.lane + 1, c.z, hf, c.speed)) h.target = h.lane + 1
        h.cool = h.target >= 0 ? rnd(6, 12) : 1.5
      }
      // --- now and then a driver drifts back to the right when that lane is free (keep right except to pass) ---
      if (h.target < 0 && h.cool <= 0 && h.lane < NL - 1 && Math.random() < dt / 25 && laneOk(h.lane, h.lane + 1, c.z) && laneClear(h.lane + 1, c.z, hf, c.speed + 3)) { h.target = h.lane + 1; h.cool = rnd(8, 15) }
      // --- the exits: some drivers in the lane next to one leave by it ---
      for (let k = 0; k < s.ramps.length && h.target < 0; k++) {
        const e = s.ramps[k]
        if (e.kind !== 'off') continue
        const u = rampU(e, c.z)
        if (u < -ACC_LEN + 20 || u > -ACC_LEN + 160) continue
        if (h.lane !== (e.side === 1 ? NL - 1 : 0) || h.exitP > (e.take ? 0.35 : 0.25)) continue
        h.mode = M.Exit; h.ramp = k; h.blend = 0
      }
      if (h.target >= 0) {
        // a lane change eases out of the lane and into the next one (about 3 s, longer for a truck), never a sudden sideways step
        const tx = NBX[h.target]
        if (h.lcT < 0) { h.lcT = 0; h.lcFrom = h.lat }
        h.lcT = Math.min(1, h.lcT + dt / (isTruck(c) ? 4.5 : 3.2))
        h.lat = h.lcFrom + (tx - h.lcFrom) * ease(h.lcT)
        if (h.lcT >= 1) { h.lat = tx; h.lane = h.target; h.target = -1; h.lcT = -1; setBand(h, isTruck(c), c.z) }
      }
      c.sig = h.target >= 0 ? (NBX[h.target] < h.lat ? -1 : 1) : 0
    } else if (h.mode === M.Exit && r) {
      h.blend = Math.min(1, h.blend + dt * 0.3)
      c.sig = h.blend < 1 ? r.side : 0
      if (h.blend > 0.6) h.vgoal = h.v0 = Math.max(20, h.v0 - dt * 1.5) // easing off for the ramp, once out of the lane (not holding up the traffic behind)
    } else if (h.mode === M.Enter && r) {
      const u = rampU(r, c.z)
      if (!h.merging && u < -30 && laneClear(h.lane, c.z, hf, c.speed)) h.merging = true
      if (h.merging) h.blend = Math.min(1, h.blend + dt * 0.3)
      c.sig = u < 0 && h.blend < 1 ? (r.side === 1 ? -1 : 1) : 0
      if (h.blend >= 1) { h.mode = M.Lane; h.ramp = -1; h.merging = false; c.sig = 0; setBand(h, isTruck(c), c.z) }
    }

    // --- speed: each driver drifts about inside their band, and keeps their distance (intelligent driver model) ---
    h.vt -= dt
    if (h.mode === M.Lane && h.vt <= 0) { h.vt = rnd(4, 11); h.vgoal = rnd(h.vlo, Math.max(h.vlo + 0.3, h.vhi)) }
    // (entering: up to speed along the ramp; no gap by the end of the lane: wait there for one, as a driver must)
    if (h.mode === M.Enter) h.vgoal = h.v0 = !h.merging && rampU(r!, c.z) < -ACC_LEN + TAPER + 15 ? 0 : h.vlo + 1 // (up to the traffic's speed all along the ramp, before joining it)
    h.v0 += (h.vgoal - h.v0) * (1 - Math.exp(-dt / 2.5))
    const v = c.speed
    // (the "improved" driver model: a driver with a comfortable gap ahead holds their own speed; only a gap shorter than they want
    // slows them, so traffic flows at its lanes' speeds instead of everyone easing off whenever anything is ahead)
    const A = h.mode === M.Enter ? 2.6 : 1.5 // (joining from a ramp: a firm run up to speed)
    const aFree = A * (1 - Math.pow(v / Math.max(1, h.v0), 4))
    let a = aFree
    if (gap < 1e8) {
      const sStar = 2.5 + Math.max(0, v * 1.05 + (v * (v - lv)) / (2 * Math.sqrt(A * 2.6)))
      const zz = sStar / Math.max(gap, 0.4)
      a = zz >= 1 ? A * (1 - zz * zz) + Math.min(0, aFree) : aFree > 0 ? aFree * (1 - Math.pow(zz, (2 * A) / aFree)) : aFree
    }
    a = Math.max(-7, a)
    if (gap < 2 && v > lv) a = Math.min(a, -Math.min(9, ((v - lv) * (v - lv)) / (2 * Math.max(0.3, gap)) + 1)) // close behind: brake firmly (but smoothly) to its speed
    // (and the change in braking is eased over a moment: drivers press the pedal, they do not stamp on it)
    h.acc += (a - h.acc) * Math.min(1, dt * 6)
    c.braking = h.acc < -1.2
    c.speed = Math.max(0, v + h.acc * dt)
    if (gap < 0.3) c.speed = Math.min(c.speed, lv) // (touching: never through it)

    // --- move ---
    const x0 = c.x, z0 = c.z
    c.z -= c.speed * dt
    if (h.mode === M.Lane) c.x = laneXz(h.lane, h.lat, c.z)
    else if (h.mode === M.Exit && r) { const e = ease(h.blend); c.x = laneXz(h.lane, h.lat, c.z) * (1 - e) + rampX(r, c.z) * e }
    else if (r) { const e = ease(h.blend); c.x = rampX(r, c.z) * (1 - e) + NBX[h.lane] * e }
    const dx = c.x - x0, dz = c.z - z0
    if (dx * dx + dz * dz > 1e-6) c.h = Math.atan2(-dx, -dz)

    // --- leave: off the end of an exit ramp, or far from you (come round again as a fresh vehicle) ---
    const rel = c.z - p.z
    if (h.mode === M.Exit && r && c.z < rampZ1(r) + 30) { respawn(i); continue }
    if (h.mode === M.Enter && r && (c.z > rampZ0(r) + 20)) { c.active = false; continue }
    if (h.mode === M.Lane && h.target < 0 && laneW(h.lane, c.z) < 0.55) { respawn(i); continue } // (its lane has ended and it found no gap: it leaves the highway)
    if (rel > WINDOW || rel < -WINDOW * 1.15 || c.z < Z_FINISH + 30) respawn(i)
  }
}

function respawn(i: number) {
  const c = cars[i]
  c.active = false
  if (i >= ncars - EXTRA && hw[i].mode !== M.Lane) return // (a vehicle that came from an entrance: its slot is kept for the next one)
  const rel = c.z - player.z
  for (let tries = 0; tries < 8; tries++) {
    const ahead = rel > 0 || hw[i].mode === M.Exit // it was behind -> reappear ahead of you; it was ahead -> reappear behind
    const z = ahead ? player.z - rnd(WINDOW * 0.55, WINDOW) : player.z + rnd(WINDOW * 0.4, WINDOW * 0.9)
    if (z < Z_FINISH + 40 || z > Z_TOP - 30 || !placeOk(z)) continue
    const lane = pickLane(z)
    const kind = newKind(lane)
    if (!spacingOk(lane, z, lenOf(kind), i)) continue
    placeLane(i, lane, z, kind)
    return
  }
}
