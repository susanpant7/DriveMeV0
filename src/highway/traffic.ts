import { cars, type AiCar } from '../game/trafficAI'
import { NB_X as NBX, SB_X, Z_FINISH, Z_GORE, Z_END, forkHeading, forkShift, scen } from './layout'

/** [length, width] of each vehicle kind drawn by Traffic.tsx (collision boxes for trucks). */
const DIMS: Record<number, [number, number]> = {
  0: [4.6, 1.9], 1: [5.3, 2.1], 2: [5.2, 2.0], 3: [5.0, 2.0], 4: [5.4, 2.1], 5: [4.7, 1.85],
  6: [8.6, 2.5], 7: [21, 2.6], 8: [20, 2.6],
}
const COLORS = ['#2e86de', '#f1c40f', '#ecf0f1', '#27ae60', '#8e44ad', '#e67e22', '#34495e', '#16a085', '#c0392b', '#95a5a6']
const CAR_KINDS = [0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 3, 4, 5]
const TRUCK_KINDS = [6, 6, 7, 7, 8]

interface Hw {
  dir: 1 | -1 // +1 northbound (towards -z), -1 southbound
  lane: number // 0..2
  v0: number
  lat: number // current x
  target: number // lane being changed to (-1: none)
  vlo: number // the slowest this driver cruises (never below the limit)
  vhi: number // and the fastest
  vgoal: number // the speed they are drifting towards now
  vt: number // seconds until they pick a new one
  cool: number // seconds before this driver will consider another lane change
}
const hw: Hw[] = []
let ncars = 0
let level = 1
const DENSITY = [1.0, 1.9, 2.6, 3.3, 4.0] // level 2 is as busy as the old maximum
const MARGIN = [28, 28, 24, 21, 18] // minimum bumper gap when placing traffic: busier levels pack the lanes tighter
const WINDOW = 650 // cars live this far ahead of / behind the player

const NB_N = NBX.length
const laneX = (dir: 1 | -1, lane: number) => (dir === 1 ? NBX[lane] : SB_X[lane])
/** where a vehicle in lane `lane` really is at z (the right two lanes swing away in a fork) */
const realX = (dir: 1 | -1, lane: number, base: number, z: number) => (dir === 1 && lane >= 3 ? base + forkShift(z) : base)
const rnd = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]

/** per-lane share of the cars on the road (lane 0 is the fast one) and the chance a vehicle in it is a truck */
const TRUCK_P = [0, 0.03, 0.08, 0.18, 0.4]
// the limit is 70 mph (31.3 m/s): nobody drives below it, the fast lanes go further over
// Lane by lane, from the right-most (slow) lane to the left: the limit is 70 mph, the right lane runs 70-75, the next 75-80, then 80-85 ...
const MPH = 0.44704
/** the speed band (m/s) of a lane; `fromRight` = 0 for the right-most lane of its carriageway */
const bandOf = (fromRight: number): [number, number] => [(70 + 5 * fromRight) * MPH, (75 + 5 * fromRight) * MPH]
const LANE_COUNT = [9, 10, 11, 12, 22] // vehicles per lane within the window at normal density

function describe(c: AiCar, i: number) {
  const h = hw[i]
  const truck = Math.random() < (h.dir === 1 ? TRUCK_P[h.lane] : TRUCK_P[h.lane + 2])
  c.kind = truck ? pick(TRUCK_KINDS) : pick(CAR_KINDS)
  const [l, w] = DIMS[c.kind] ?? DIMS[0]
  c.len = l
  c.wid = w
  c.color = pick(COLORS)
  const [a, b] = bandOf(h.dir === 1 ? NBX.length - 1 - h.lane : SB_X.length - 1 - h.lane)
  h.v0 = truck ? rnd(a, a + 0.5 * (b - a)) : rnd(a, b) // trucks hold the slower half of their lane's band
  h.vlo = Math.max(70 * MPH, a) // nobody drifts below the 70 mph limit
  h.vhi = truck ? a + 0.5 * (b - a) : b
  h.vgoal = h.v0
}

function spacingOk(dir: 1 | -1, lane: number, z: number, len: number, skip = -1) {
  for (let i = 0; i < ncars; i++) {
    if (i === skip || !cars[i].active || hw[i].dir !== dir || hw[i].lane !== lane) continue
    if (Math.abs(cars[i].z - z) < (cars[i].len ?? 4.6) / 2 + len / 2 + MARGIN[level - 1]) return false
  }
  return true
}

function place(i: number, dir: 1 | -1, lane: number, z: number, speed: number) {
  const c = cars[i]
  const h = hw[i]
  h.dir = dir
  h.lane = lane
  h.target = -1
  h.lat = laneX(dir, lane)
  describe(c, i)
  c.active = true
  c.x = realX(dir, lane, h.lat, z)
  c.z = z
  c.h = dir === 1 ? (lane >= 3 ? forkHeading(z) : 0) : Math.PI
  c.speed = speed
  c.sig = 0
  c.braking = false
}

export function initHighwayTraffic(playerZ: number) {
  for (const c of cars) c.active = false
  while (hw.length < cars.length) hw.push({ dir: 1, lane: 0, v0: 25, lat: 0, target: -1, vlo: 31.4, vhi: 33, vgoal: 32, vt: 0, cool: 0 })
  ncars = 0
  const dens = DENSITY[level - 1]
  const lanes: Array<[1 | -1, number]> = NBX.map((_, k) => [1, k] as [1 | -1, number]) // one direction only: no oncoming traffic
  for (const [dir, lane] of lanes) {
    if (scen.type === 'lanedrop' && dir === 1 && lane === 4) continue
    const n = Math.min(28, Math.round(LANE_COUNT[lane] * dens)) // 28 is about as many as fit in a lane's window
    for (let k = 0; k < n; k++) {
      const i = ncars
      if (i >= 420) break
      for (let tries = 0; tries < 60; tries++) {
        const z = playerZ + rnd(-WINDOW, WINDOW * 0.55)
        // nothing near the start of the ramp or the player's own space
        if (dir === 1 && Math.abs(z - playerZ) < 70) continue
        hw[i] = { dir, lane, v0: 25, lat: 0, target: -1, vlo: 31.4, vhi: 33, vgoal: 32, vt: rnd(0, 8), cool: rnd(0, 6) }
        const len = 6
        if (!spacingOk(dir, lane, z, len)) continue
        ncars++
        place(i, dir, lane, z, 25)
        cars[i].speed = hw[i].v0
        break
      }
    }
  }
}

/** remove every vehicle in a lane (used when that lane is about to end) */
export function clearLane(lane: number) {
  for (let i = 0; i < ncars; i++) if (cars[i].active && hw[i].dir === 1 && (hw[i].lane === lane || hw[i].target === lane)) cars[i].active = false
}

export function setHighwayCount(l: number) {
  level = l
}

export function stepHighwayTraffic(dt: number, _t: number, player: { x: number; z: number; speed: number }) {
  const mergeInPlay = scen.type === 'merge' && player.x > 17 && player.z < Z_GORE + 40 && player.z > Z_END - 40
  const sig = (i: number) => (cars[i].sig = hw[i].target >= 0 ? -1 : 0)
  for (let i = 0; i < ncars; i++) {
    const c = cars[i]
    if (!c.active) continue
    const h = hw[i]
    const fwd = h.dir === 1 ? -1 : 1 // sign of z velocity
    const myHalf = (c.len ?? 4.6) / 2
    // --- the vehicle ahead in this lane (and the player, if they are in it) ---
    let gap = 1e9, lv = h.v0, gapCar = 1e9
    for (let j = 0; j < ncars; j++) {
      if (j === i || !cars[j].active || hw[j].dir !== h.dir) continue
      if (Math.abs(hw[j].lat - h.lat) > 2.4) continue
      const d = (cars[j].z - c.z) * fwd - myHalf - (cars[j].len ?? 4.6) / 2
      if (d > -1 && d < gap) { gap = d; lv = cars[j].speed }
      if (d > -1 && d < gapCar) gapCar = d
    }
    if (h.dir === 1 && Math.abs(player.x - c.x) < 2.5) {
      const d = (player.z - c.z) * fwd - myHalf - 2.4
      if (d > -1 && d < gap) { gap = d; lv = player.speed }
    }
    // --- courtesy: a right-lane car moves left for a car merging from the ramp, if the next lane is clear ---
    if (h.dir === 1 && h.lane === NB_N - 1 && h.target < 0 && mergeInPlay && c.z - player.z > -70 && c.z - player.z < 90 && c.speed > 12) {
      const clear = laneClear(NB_N - 2, c.z, myHalf)
      if (clear) h.target = NB_N - 2
    }
    // a slower player ahead in my lane: pull out to the left if there is room, otherwise carry on (and hit them)
    if (h.dir === 1 && h.target < 0 && h.lane > 0 && Math.abs(player.x - c.x) < 2.5 && (player.z - c.z) * fwd > 0 && (player.z - c.z) * fwd < 55 && player.speed < c.speed - 2 && laneClear(h.lane - 1, c.z, myHalf)) h.target = h.lane - 1
    // catching up with a slower vehicle (or you) in my lane: pull out to pass if there is room, left first, otherwise the right
    h.cool -= dt
    if (h.dir === 1 && h.target < 0 && h.cool <= 0 && gap < 70 && c.speed > lv + 1.2 && c.speed > 28) {
      if (h.lane > 0 && laneClear(h.lane - 1, c.z, myHalf)) h.target = h.lane - 1
      else if (h.lane + 1 < NB_N - 1 && laneClear(h.lane + 1, c.z, myHalf) && !(scen.type === 'merge' && h.lane + 1 >= NB_N - 1)) h.target = h.lane + 1
      h.cool = h.target >= 0 ? rnd(6, 12) : 1.5
    }
    if (h.target >= 0) {
      const tx = laneX(h.dir, h.target)
      const step = Math.sign(tx - h.lat) * Math.min(Math.abs(tx - h.lat), 1.6 * dt)
      h.lat += step
      if (Math.abs(tx - h.lat) < 0.02) { h.lat = tx; h.lane = h.target; h.target = -1 }
      // do not drive into somebody while changing lane: slow down if the target lane is taken
    }
    sig(i)
    // nobody holds one speed: each driver drifts about within their own range (70 mph and up), picking a new target every few seconds
    h.vt -= dt
    if (h.vt <= 0) { h.vt = rnd(4, 11); h.vgoal = rnd(h.vlo, Math.max(h.vlo + 0.5, h.vhi)) }
    h.v0 += (h.vgoal - h.v0) * (1 - Math.exp(-dt / 2.5))
    // --- intelligent driver model ---
    const v = c.speed
    const free = 1 - Math.pow(v / h.v0, 4)
    let inter = 0
    if (gap < 1e8) {
      const sStar = 4 + Math.max(0, v * 1.4 + (v * (v - lv)) / (2 * Math.sqrt(1.6 * 2.4)))
      inter = (sStar / Math.max(gap, 0.5)) ** 2
    }
    const a = Math.max(-8, 1.6 * (free - inter))
    c.braking = a < -1.2
    c.speed = Math.max(0, v + a * dt)
    // nobody on the highway crawls: below the limit only when really close behind something (e.g. the player)
    // (only another vehicle in the way slows them; you in front of them never does)
    // behind a slower vehicle (or you) a driver eases off to keep their distance but never below the limit (70 mph); they pull out to pass instead
    if (gap > 3) c.speed = Math.max(c.speed, 70 * MPH)
    c.z += fwd * c.speed * dt
    c.x = realX(h.dir, h.lane, h.lat, c.z)
    c.h = h.dir === 1 ? (h.lane >= 3 ? forkHeading(c.z) : 0) : Math.PI
    // --- recycle: far behind or far ahead of the player, reappear on the other side ---
    const rel = c.z - player.z
    if (rel > WINDOW || rel < -WINDOW * 1.15 || c.z < Z_FINISH + 30) respawn(i, player)
  }
}

function laneClear(lane: number, z: number, half: number) {
  for (let j = 0; j < ncars; j++) {
    if (!cars[j].active || hw[j].dir !== 1) continue
    if (hw[j].lane !== lane && hw[j].target !== lane) continue
    const d = cars[j].z - z // + = behind us (higher z)
    if (d < 38 && d > -(30 + half)) return false
    if (d >= 38 && d < 60 && cars[j].speed > 31) return false
  }
  return true
}

function respawn(i: number, player: { z: number; speed: number }) {
  const h = hw[i]
  const c = cars[i]
  c.active = false
  if (scen.type === 'lanedrop' && h.dir === 1 && h.lane === 4) return
  // northbound traffic that has dropped far behind comes round to the front again (and vice versa)
  const rel = c.z - player.z
  for (let tries = 0; tries < 6; tries++) {
    const ahead = rel > 0 // it was behind (greater z) -> reappear ahead of the player; it was ahead -> reappear behind
    const z = ahead ? player.z - rnd(WINDOW * 0.55, WINDOW) : player.z + rnd(WINDOW * 0.4, WINDOW * 0.9)
    if (z < Z_FINISH + 40) continue
    if (!spacingOk(h.dir, h.lane, z, 6, i)) continue
    place(i, h.dir, h.lane, z, 32)
    c.speed = h.v0
    return
  }
}
