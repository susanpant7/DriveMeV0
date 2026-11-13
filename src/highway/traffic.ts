import { cars, type AiCar } from '../game/trafficAI'
import { HW, NB_X as NBX, NL, Z_FINISH, Z_TOP, ACC_LEN, TAPER, dropLane, dropT, forkHeading, laneAt, laneShift, rampHeading, rampU, rampX, rampZ0, rampZ1, type Ramp } from './layout'

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
const MARGIN = [28, 26, 20, 13, 3]
/** vehicles in the window around you (about 1 km of highway): level 5 is bumper to bumper */
export const HW_TOTAL = [24, 45, 70, 120, 360]
/** how often a vehicle joins at each entrance (seconds) */
const JOIN_EVERY = [28, 16, 9, 5, 3]
const WINDOW = 650 // vehicles live this far ahead of / behind the player
const EXTRA = 16 // spare vehicles for the entrances

const MPH = 0.44704
/**
 * The speed band of a lane, counted from the right (the limit is 70 mph): the right lane 65-72, the next 70-80, then 75-85, 80-90, 85-95.
 * Trucks keep to the lower part of their band.
 */
export const bandOf = (fromRight: number): [number, number] => (fromRight === 0 ? [65 * MPH, 72 * MPH] : [(65 + 5 * fromRight) * MPH, (75 + 5 * fromRight) * MPH])
/** how the vehicles are shared between the lanes, and the chance a vehicle in each lane is a truck */
const LANE_COUNT = [10, 11, 12, 13, 15]
const TRUCK_P = [0, 0.03, 0.07, 0.12, 0.2]

const rnd = (a: number, b: number) => a + Math.random() * (b - a)
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
function setBand(h: Hw, truck: boolean) {
  const [a, b] = bandOf(NL - 1 - h.lane)
  const mid = a + h.pace * (b - a)
  h.vlo = Math.max(a, mid - 2 * MPH)
  h.vhi = truck ? Math.min(mid + 1.5 * MPH, a + 0.5 * (b - a)) : Math.min(b, mid + 2 * MPH)
  h.vgoal = mid
}
const isTruck = (c: AiCar) => (c.len ?? 4.6) > 8

function pickLane(z: number) {
  const sum = LANE_COUNT.reduce((a, b) => a + b, 0)
  for (let t = 0; t < 8; t++) {
    let r = Math.random() * sum, k = 0
    for (; k < NL - 1; k++) { r -= LANE_COUNT[k]; if (r < 0) break }
    if (k === dropLane() && z < (HW.s.drop?.z0 ?? 0) + 150) continue // not in a lane that is about to end
    return k
  }
  return 2
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
  return { mode: M.Lane, lane: 2, lat: NBX[2], target: -1, ramp: -1, blend: 0, merging: false, vlo: 30, vhi: 33, v0: 31, vgoal: 31, vt: rnd(0, 8), cool: rnd(0, 6), pace: 0.5, exitP: 1, stage: HW.s.id }
}

function placeLane(i: number, lane: number, z: number, kind: number) {
  const c = cars[i]
  const h = (hw[i] = freshHw())
  describe(c, h, lane, kind)
  h.lane = lane
  h.lat = NBX[lane]
  setBand(h, isTruck(c))
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

export function initHighwayTraffic(playerZ: number, playerX = NBX[2]) {
  for (const c of cars) c.active = false
  hw.length = 0
  while (hw.length < cars.length) hw.push(freshHw())
  player = { x: playerX, z: playerZ, speed: 0 }
  const total = Math.min(cars.length - EXTRA, HW_TOTAL[level - 1])
  ncars = Math.min(cars.length, total + EXTRA)
  let placed = 0
  for (let n = 0; n < total * 8 && placed < total; n++) {
    const z = playerZ + rnd(-WINDOW, WINDOW * 0.55)
    if (z > Z_TOP - 30 || z < Z_FINISH + 40) continue
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
}

export function setHighwayCount(l: number) {
  level = l
}

/** Move every vehicle along by dz (the course has started over at the next stage), dropping those that do not fit the new stage. */
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
/** a lane change is allowed: the lane exists here, and after a split the branches do not mix */
function laneOk(from: number, to: number, z: number) {
  if (to < 0 || to >= NL) return false
  if (to === dropLane() && dropT(z) < 1) return false
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
  setBand(h, isTruck(c))
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

export function stepHighwayTraffic(dt: number, _t: number, p: { x: number; z: number; speed: number }) {
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
      if (h.lane === dropLane() && h.target < 0 && s.drop && c.z < s.drop.z0 + 350) {
        const to = s.drop.side === 1 ? NL - 2 : 1
        if (laneClear(to, c.z, hf, c.speed)) h.target = to
        else if (c.z < s.drop.z1 + 60) c.speed = Math.max(0, c.speed - 4 * dt) // wait for a gap
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
        const tx = NBX[h.target]
        h.lat += Math.sign(tx - h.lat) * Math.min(Math.abs(tx - h.lat), 1.5 * dt)
        if (Math.abs(tx - h.lat) < 0.02) { h.lat = tx; h.lane = h.target; h.target = -1; setBand(h, isTruck(c)) }
      }
      c.sig = h.target >= 0 ? (NBX[h.target] < h.lat ? -1 : 1) : 0
    } else if (h.mode === M.Exit && r) {
      h.blend = Math.min(1, h.blend + dt * 0.35)
      c.sig = h.blend < 1 ? r.side : 0
      h.vgoal = h.v0 = Math.max(18, h.v0 - dt * 1.2) // easing off for the ramp
    } else if (h.mode === M.Enter && r) {
      const u = rampU(r, c.z)
      if (!h.merging && u < -30 && laneClear(h.lane, c.z, hf, c.speed)) h.merging = true
      if (h.merging) h.blend = Math.min(1, h.blend + dt * 0.4)
      c.sig = u < 0 && h.blend < 1 ? (r.side === 1 ? -1 : 1) : 0
      if (h.blend >= 1) { h.mode = M.Lane; h.ramp = -1; h.merging = false; c.sig = 0; setBand(h, isTruck(c)) }
    }

    // --- speed: each driver drifts about inside their band, and keeps their distance (intelligent driver model) ---
    h.vt -= dt
    if (h.mode === M.Lane && h.vt <= 0) { h.vt = rnd(4, 11); h.vgoal = rnd(h.vlo, Math.max(h.vlo + 0.3, h.vhi)) }
    // (entering: up to speed along the ramp; no gap by the end of the lane: wait there for one, as a driver must)
    if (h.mode === M.Enter) h.vgoal = !h.merging && rampU(r!, c.z) < -ACC_LEN + TAPER + 15 ? 0 : h.blend > 0 || rampU(r!, c.z) < 0 ? h.vlo : 27
    h.v0 += (h.vgoal - h.v0) * (1 - Math.exp(-dt / 2.5))
    const v = c.speed
    // (the wish is set a touch above the cruising speed: keeping a distance to the traffic ahead always holds a driver back a little)
    const free = 1 - Math.pow(v / Math.max(1, h.v0 * 1.05), 4)
    let inter = 0
    if (gap < 1e8) {
      const sStar = 2.5 + Math.max(0, v * 1.05 + (v * (v - lv)) / (2 * Math.sqrt(1.5 * 2.6)))
      inter = (sStar / Math.max(gap, 0.4)) ** 2
    }
    const a = Math.max(-8, 1.5 * (free - inter))
    c.braking = a < -1.2
    c.speed = Math.max(0, v + a * dt)
    if (gap < 1.2) c.speed = Math.min(c.speed, lv * 0.9) // never into the back of the one ahead

    // --- move ---
    const x0 = c.x, z0 = c.z
    c.z -= c.speed * dt
    if (h.mode === M.Lane) c.x = laneXz(h.lane, h.lat, c.z)
    else if (h.mode === M.Exit && r) c.x = laneXz(h.lane, h.lat, c.z) * (1 - h.blend) + rampX(r, c.z) * h.blend
    else if (r) c.x = rampX(r, c.z) * (1 - h.blend) + NBX[h.lane] * h.blend
    const dx = c.x - x0, dz = c.z - z0
    if (dx * dx + dz * dz > 1e-6) c.h = Math.atan2(-dx, -dz)

    // --- leave: off the end of an exit ramp, or far from you (come round again as a fresh vehicle) ---
    const rel = c.z - p.z
    if (h.mode === M.Exit && r && c.z < rampZ1(r) + 30) { respawn(i); continue }
    if (h.mode === M.Enter && r && (c.z > rampZ0(r) + 20)) { c.active = false; continue }
    if (h.lane === dropLane() && h.mode === M.Lane && h.target < 0 && s.drop && c.z < s.drop.z1 + 5) { respawn(i); continue }
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
    if (z < Z_FINISH + 40 || z > Z_TOP - 30) continue
    const lane = pickLane(z)
    const kind = newKind(lane)
    if (!spacingOk(lane, z, lenOf(kind), i)) continue
    placeLane(i, lane, z, kind)
    return
  }
}
