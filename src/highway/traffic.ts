import { cars, type AiCar } from '../game/trafficAI'
import { NB_X as NBX, SB_X, Z_FINISH, Z_GORE, Z_END } from './layout'

/** [length, width] of each vehicle kind drawn by Traffic.tsx (collision boxes for trucks). */
const DIMS: Record<number, [number, number]> = {
  0: [4.6, 1.9], 1: [5.3, 2.1], 2: [5.2, 2.0], 3: [5.0, 2.0], 4: [5.4, 2.1], 5: [4.7, 1.85], 6: [5.9, 2.2], 7: [5.4, 2.1],
  8: [8.6, 2.5], 9: [21, 2.6], 10: [20, 2.6],
}
const COLORS = ['#2e86de', '#f1c40f', '#ecf0f1', '#27ae60', '#8e44ad', '#e67e22', '#34495e', '#16a085', '#c0392b', '#95a5a6']
const CAR_KINDS = [0, 0, 0, 0, 1, 1, 1, 2, 3, 4, 5, 6, 7, 7]
const TRUCK_KINDS = [8, 8, 9, 9, 10]

interface Hw {
  dir: 1 | -1 // +1 northbound (towards -z), -1 southbound
  lane: number // 0..2
  v0: number
  lat: number // current x
  target: number // lane being changed to (-1: none)
}
const hw: Hw[] = []
let ncars = 0
let level = 1
const DENSITY = [0.5, 0.8, 1, 1.4, 1.9]
const WINDOW = 650 // cars live this far ahead of / behind the player

const NB_N = NBX.length
const laneX = (dir: 1 | -1, lane: number) => (dir === 1 ? NBX[lane] : SB_X[lane])
const rnd = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]

/** per-lane share of the cars on the road (lane 0 is the fast one) and the chance a vehicle in it is a truck */
const TRUCK_P = [0, 0.03, 0.08, 0.18, 0.4]
// the limit is 70 mph (31.3 m/s): nobody drives below it, the fast lanes go further over
const LANE_SPEED: Array<[number, number]> = [[34.5, 38], [33.5, 36.5], [33, 35.5], [32.5, 35], [32, 34.5]]
const LANE_COUNT = [6, 7, 8, 9, 10] // vehicles per lane within the window at normal density

function describe(c: AiCar, i: number) {
  const h = hw[i]
  const truck = Math.random() < (h.dir === 1 ? TRUCK_P[h.lane] : TRUCK_P[h.lane + 2])
  c.kind = truck ? pick(TRUCK_KINDS) : pick(CAR_KINDS)
  const [l, w] = DIMS[c.kind] ?? DIMS[0]
  c.len = l
  c.wid = w
  c.color = pick(COLORS)
  const [a, b] = LANE_SPEED[h.dir === 1 ? h.lane : h.lane + 2]
  h.v0 = truck ? rnd(31.8, 33.5) : rnd(a, b)
}

function spacingOk(dir: 1 | -1, lane: number, z: number, len: number, skip = -1) {
  for (let i = 0; i < ncars; i++) {
    if (i === skip || !cars[i].active || hw[i].dir !== dir || hw[i].lane !== lane) continue
    if (Math.abs(cars[i].z - z) < (cars[i].len ?? 4.6) / 2 + len / 2 + 28) return false
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
  c.x = h.lat
  c.z = z
  c.h = dir === 1 ? 0 : Math.PI
  c.speed = speed
  c.sig = 0
  c.braking = false
}

export function initHighwayTraffic(playerZ: number) {
  for (const c of cars) c.active = false
  while (hw.length < cars.length) hw.push({ dir: 1, lane: 0, v0: 25, lat: 0, target: -1 })
  ncars = 0
  const dens = DENSITY[level - 1]
  const lanes: Array<[1 | -1, number]> = [...NBX.map((_, k) => [1, k] as [1 | -1, number]), [-1, 0], [-1, 1], [-1, 2]]
  for (const [dir, lane] of lanes) {
    const n = Math.round((dir === 1 ? LANE_COUNT[lane] : LANE_COUNT[lane + 2] * 0.7) * dens)
    for (let k = 0; k < n; k++) {
      const i = ncars
      if (i >= 140) break
      for (let tries = 0; tries < 12; tries++) {
        const z = playerZ + rnd(-WINDOW, WINDOW * 0.55)
        // nothing near the start of the ramp or the player's own space
        if (dir === 1 && Math.abs(z - playerZ) < 70) continue
        hw[i] = { dir, lane, v0: 25, lat: 0, target: -1 }
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

export function setHighwayCount(l: number) {
  level = l
}

export function stepHighwayTraffic(dt: number, _t: number, player: { x: number; z: number; speed: number }) {
  const mergeInPlay = player.x > 17 && player.z < Z_GORE + 40 && player.z > Z_END - 40
  const sig = (i: number) => (cars[i].sig = hw[i].target >= 0 ? -1 : 0)
  for (let i = 0; i < ncars; i++) {
    const c = cars[i]
    if (!c.active) continue
    const h = hw[i]
    const fwd = h.dir === 1 ? -1 : 1 // sign of z velocity
    const myHalf = (c.len ?? 4.6) / 2
    // --- the vehicle ahead in this lane (and the player, if they are in it) ---
    let gap = 1e9, lv = h.v0
    for (let j = 0; j < ncars; j++) {
      if (j === i || !cars[j].active || hw[j].dir !== h.dir) continue
      if (Math.abs(cars[j].x - h.lat) > 2.4) continue
      const d = (cars[j].z - c.z) * fwd - myHalf - (cars[j].len ?? 4.6) / 2
      if (d > -1 && d < gap) { gap = d; lv = cars[j].speed }
    }
    if (h.dir === 1 && Math.abs(player.x - h.lat) < 2.5) {
      const d = (player.z - c.z) * fwd - myHalf - 2.4
      if (d > -1 && d < gap) { gap = d; lv = player.speed }
    }
    // --- courtesy: a right-lane car moves left for a car merging from the ramp, if the next lane is clear ---
    if (h.dir === 1 && h.lane === NB_N - 1 && h.target < 0 && mergeInPlay && c.z - player.z > -70 && c.z - player.z < 90 && c.speed > 12) {
      const clear = laneClear(NB_N - 2, c.z, myHalf)
      if (clear) h.target = NB_N - 2
    }
    if (h.target >= 0) {
      const tx = laneX(h.dir, h.target)
      const step = Math.sign(tx - h.lat) * Math.min(Math.abs(tx - h.lat), 1.6 * dt)
      h.lat += step
      if (Math.abs(tx - h.lat) < 0.02) { h.lat = tx; h.lane = h.target; h.target = -1 }
      // do not drive into somebody while changing lane: slow down if the target lane is taken
    }
    sig(i)
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
    if (gap > 14 && h.dir === 1) c.speed = Math.max(c.speed, 31.5)
    else if (gap > 14) c.speed = Math.max(c.speed, 31.5)
    c.z += fwd * c.speed * dt
    c.x = h.lat
    c.h = h.dir === 1 ? 0 : Math.PI
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
