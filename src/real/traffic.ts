import { wrapD } from '../game/map'
import { CAR_L, cars, type AiCar } from '../game/trafficAI'
import { edgeAt, type GEdge } from './graph'
import { axisOf, realSignal } from './signals'
import { WORLD } from './world'

const LANE_W = 3.4
const COLORS = ['#2e86de', '#f1c40f', '#ecf0f1', '#27ae60', '#8e44ad', '#e67e22', '#34495e', '#16a085', '#c0392b', '#95a5a6']
const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
const o = { x: 0, z: 0, dx: 0, dz: 0 }
const WIN_MAX = 320
const WIN_RECYCLE = 360

export interface Obs { x: number; z: number; h: number; speed: number }

let targetCars = 0
let frameNo = 0
const grid = new Map<string, number[]>()
const CELL = 40
const lockOwner = new Map<number, { car: number; t: number }>() // unsignalised junction boxes: one car at a time
const axisCache = new Map<number, 0 | 1>()
let weights: { edges: GEdge[]; cum: number[]; total: number } | null = null

const laneOffset = (e: GEdge, lane: number) => (e.oneWay ? (lane - (e.lanes - 1) / 2) * LANE_W : (lane + 0.5) * LANE_W)

function place(c: AiCar) {
  const e = WORLD.graph!.edges[c.piece]
  edgeAt(e, c.s, o)
  const off = laneOffset(e, c.lane)
  // lateral offset during a drift between lanes is not modelled here: cars keep their lane
  c.x = o.x - o.dz * off
  c.z = o.z + o.dx * off
  c.h = Math.atan2(-o.dx, -o.dz)
}

function edgeAxis(e: GEdge): 0 | 1 {
  let a = axisCache.get(e.id)
  if (a === undefined) {
    edgeAt(e, e.len - 0.5, o)
    a = axisOf(o.dx, o.dz)
    axisCache.set(e.id, a)
  }
  return a
}

/** Where does the next road go, relative to this one? -1 left, 0 straight, 1 right (and the turn angle). */
function turnOf(e: GEdge, n: GEdge): number {
  edgeAt(e, e.len - 0.5, o)
  const tx = o.dx, tz = o.dz
  edgeAt(n, Math.min(1.5, n.len), o)
  const cross = tx * o.dz - tz * o.dx
  const dot = tx * o.dx + tz * o.dz
  if (dot > 0.9) return 0
  return cross > 0 ? 1 : -1
}

function chooseNext(_c: AiCar, e: GEdge): GEdge | undefined {
  const g = WORLD.graph!
  const node = g.nodes.get(e.to)!
  const opts = node.out.map((id) => g.edges[id]).filter((n) => n.id !== e.reverse)
  if (!opts.length) return e.reverse >= 0 ? g.edges[e.reverse] : undefined // dead end: turn around
  if (e.roundabout) {
    const stay = opts.find((n) => n.roundabout)
    if (stay && Math.random() < 0.6) return stay
  }
  const w = opts.map((n) => (turnOf(e, n) === 0 ? 3 : 1) * (n.hw === 'service' ? 0.4 : 1) * (n.roundabout && !e.roundabout ? 1 : 1))
  let r = Math.random() * w.reduce((a, b) => a + b, 0)
  for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) return opts[i] }
  return opts[0]
}

function spawn(c: AiCar, player: Obs | null, minD: number) {
  const g = WORLD.graph!
  if (!weights) {
    const edges = g.edges.filter((e) => e.len > 25 && e.hw !== 'motorway')
    const cum: number[] = []
    let t = 0
    for (const e of edges) { t += e.len; cum.push(t) }
    weights = { edges, cum, total: t }
  }
  for (let tries = 0; tries < 80; tries++) {
    const r = Math.random() * weights.total
    let lo = 0, hi = weights.cum.length - 1
    while (lo < hi) { const m = (lo + hi) >> 1; if (weights.cum[m] < r) lo = m + 1; else hi = m }
    const e = weights.edges[lo]
    const s = rand(8, e.len - 10)
    const lane = Math.floor(Math.random() * e.lanes)
    c.piece = e.id; c.s = s; c.lane = lane
    place(c)
    if (player) {
      const dd = Math.hypot(wrapD(c.x - player.x), wrapD(c.z - player.z))
      if (dd < minD || dd > WIN_MAX) continue
    }
    let clash = false
    for (const o2 of cars) if (o2 !== c && o2.active && Math.hypot(o2.x - c.x, o2.z - c.z) < 8) { clash = true; break }
    if (clash) continue
    c.style = Math.random() < 0.8 ? 0 : 1
    c.pref = c.style === 0 ? rand(0.9, 1.0) : rand(1.0, 1.12) // fraction of the posted limit
    c.speed = Math.min(e.speed * 0.8, 12)
    c.color = pick(COLORS)
    const k = Math.random()
    c.kind = k < 0.6 ? 0 : k < 0.92 ? 1 : 2
    c.stuck = 0; c.ghost = 0; c.sig = 0; c.braking = false; c.cGap = 1e9; c.cLv = 0; c.cBP = false; c.waitL = 0
    c.np = undefined
    c.npPiece = -1
    return true
  }
  return false
}

export function initRealTraffic() {
  for (const c of cars) { c.active = false; c.piece = 0 }
  lockOwner.clear()
  axisCache.clear()
  weights = null
  targetCars = 0
}

export function setRealCount(n: number, player: Obs | null) {
  targetCars = n
  cars.forEach((c, i) => {
    if (i < n && !c.active) c.active = spawn(c, player, 55)
    else if (i >= n) c.active = false
  })
}

function idm(v: number, v0: number, gap: number, dv: number) {
  const a = 2.2, b = 3.2
  const free = 1 - Math.pow(v / Math.max(v0, 0.1), 4)
  let inter = 0
  if (gap < 1e8) {
    const sStar = 2.2 + Math.max(0, v * 1.3 + (v * dv) / (2 * Math.sqrt(a * b)))
    inter = (sStar / Math.max(gap, 0.1)) ** 2
  }
  return Math.max(-9, a * (free - inter))
}

export function stepRealTraffic(dt: number, t: number, player: Obs) {
  frameNo++
  const g = WORLD.graph!
  let budget = 6
  for (let i = 0; i < targetCars && budget > 0; i++) {
    if (!cars[i].active) { budget--; cars[i].active = spawn(cars[i], player, 150) }
  }
  grid.clear()
  cars.forEach((c, i) => {
    if (!c.active) return
    const k = Math.floor(c.x / CELL) + ',' + Math.floor(c.z / CELL)
    const l = grid.get(k)
    if (l) l.push(i)
    else grid.set(k, [i])
  })
  for (const [n, l] of lockOwner) if (t - l.t > 14 || !cars[l.car].active) lockOwner.delete(n)

  for (const c of cars) {
    if (!c.active) continue
    if (Math.hypot(c.x - player.x, c.z - player.z) > WIN_RECYCLE) {
      spawn(c, player, 190)
      if (Math.hypot(c.x - player.x, c.z - player.z) > WIN_RECYCLE) continue
    }
    let e = g.edges[c.piece]
    if (c.npPiece !== c.piece) {
      c.np = chooseNext(c, e)?.id
      c.npPiece = c.piece
    }
    const next = c.np !== undefined ? g.edges[c.np] : undefined
    const fx = -Math.sin(c.h), fz = -Math.cos(c.h)
    let gap = 1e9, lv = 0
    // leader: look 45 m ahead in a narrow cone (the player too). Refreshed every other frame per car.
    if (((frameNo + c.id) & 1) !== 0) { gap = c.cGap; lv = c.cLv; c.behindPlayer = c.cBP }
    else {
      c.behindPlayer = false
      const look = (ox: number, oz: number, speed: number, ohx: number, ohz: number, isPlayer: boolean) => {
        const rx = ox - c.x, rz = oz - c.z
        if (rx * rx + rz * rz > 2100) return
        const along = rx * fx + rz * fz
        if (along < 0.5 || along > 45) return
        if (ohx * fx + ohz * fz < (isPlayer ? 0 : 0.35)) return // only traffic going our way (crossing traffic is handled at junctions)
        const lat = Math.abs(rx * -fz + rz * fx)
        if (lat > (isPlayer ? 2.3 : 1.8) + along * 0.05) return
        const gp = along - CAR_L
        if (gp < gap) { gap = gp; lv = speed; c.behindPlayer = isPlayer }
      }
      const gx = Math.floor(c.x / CELL), gz = Math.floor(c.z / CELL)
      for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
        for (const oi of grid.get(gx + ix + ',' + (gz + iz)) ?? []) {
          const q = cars[oi]
          if (q === c) continue
          look(q.x, q.z, q.speed, -Math.sin(q.h), -Math.cos(q.h), false)
        }
      }
      look(player.x, player.z, player.speed, -Math.sin(player.h), -Math.cos(player.h), true)
      c.cGap = gap; c.cLv = lv; c.cBP = c.behindPlayer
    }

    const toEnd = e.len - c.s
    const node = g.nodes.get(e.to)!
    let v0 = e.speed * c.pref
    // turning: slow down for the corner
    let turn = 0
    if (next) {
      turn = turnOf(e, next)
      if (turn !== 0 && toEnd < 30) v0 = Math.min(v0, 5.5)
      if (e.roundabout) v0 = Math.min(v0, 8)
    }
    // signals: stop on red or amber (if there is room to stop), go on green
    if (node.signal) {
      const stop = toEnd - 11
      const col = realSignal(node.id, edgeAxis(e), t)
      // a car that can no longer stop comfortably is committed: it goes through rather than slamming its brakes on red
      const canStop = stop > (c.speed * c.speed) / 9 - 1
      if (stop > -1 && ((col === 2 && canStop) || (col === 1 && stop > (c.speed * c.speed) / 7 + 1)) && stop < gap) { gap = Math.max(stop, 0.05); lv = 0 }
    } else if (next && next.roundabout && !e.roundabout) {
      // entering a roundabout: give way to anyone already circulating towards this entry
      const stop = toEnd - 5
      let busy = false
      for (const oi of grid.get(Math.floor(node.x / CELL) + ',' + Math.floor(node.z / CELL)) ?? []) {
        const q = cars[oi]
        if (q === c) continue
        const qe = g.edges[q.piece]
        if (qe.roundabout && ((qe.to === node.id && qe.len - q.s < 30) || (qe.from === node.id && q.s < 8))) { busy = true; break }
      }
      if (busy && toEnd < 25 && stop > -1 && stop < gap) { gap = Math.max(stop, 0.05); lv = 0 }
      if (toEnd < 40) v0 = Math.min(v0, 6)
    } else if (node.out.length + node.inn.length >= 6 || (node.stop && !e.roundabout)) {
      // unsignalised junction: take turns, one car in the box at a time
      const stop = toEnd - 8
      const lock = lockOwner.get(node.id)
      const playerIn = Math.hypot(player.x - node.x, player.z - node.z) < 13 && player.speed > 0.5
      if (toEnd < 12 && toEnd > -1) {
        if (playerIn) { if (stop < gap) { gap = Math.max(stop, 0.05); lv = 0 } }
        else if (lock && lock.car !== c.id && cars[lock.car].active) { if (stop < gap) { gap = Math.max(stop, 0.05); lv = 0 } }
        else if (!lock && c.speed < 2.5) lockOwner.set(node.id, { car: c.id, t })
      }
      if (toEnd < 40) v0 = Math.min(v0, 6)
    }
    // turning left: give way to oncoming traffic (and the player) that is about to cross
    if (turn === -1 && next && toEnd < 26 && toEnd > -1) {
      let conflict = false
      for (const oi of grid.get(Math.floor(node.x / CELL) + ',' + Math.floor(node.z / CELL)) ?? []) {
        const q = cars[oi]
        if (q === c) continue
        const qe = g.edges[q.piece]
        if (qe.to !== node.id || qe.len - q.s > 38 || qe.id === e.id) continue
        if (fx * -Math.sin(q.h) + fz * -Math.cos(q.h) > -0.5) continue // not oncoming
        const qn = q.np !== undefined ? g.edges[q.np] : undefined
        if (qn && turnOf(qe, qn) === -1) continue // it is turning left too: the paths do not cross
        conflict = true
        break
      }
      if (!conflict) {
        const px = player.x - node.x, pz = player.z - node.z
        const pf = -Math.sin(player.h), pg = -Math.cos(player.h)
        if (Math.hypot(px, pz) < 45 && player.speed > 1 && px * pf + pz * pg < 0 && fx * pf + fz * pg < -0.5) conflict = true
      }
      c.waitL = conflict ? c.waitL : 0
      if (conflict && c.rbWait < 12) {
        const stop = toEnd - 6
        if (stop > -1 && stop < gap) { gap = Math.max(stop, 0.05); lv = 0 }
        if (c.speed < 0.3) c.rbWait += dt
      }
    } else c.rbWait = 0

    // keep the box clear: do not enter a signalised junction if the road beyond is jammed
    if (node.signal && next && toEnd < 20 && toEnd > 6) {
      for (const oi of grid.get(Math.floor((node.x) / CELL) + ',' + Math.floor(node.z / CELL)) ?? []) {
        const q = cars[oi]
        if (q !== c && q.piece === next.id && q.s < 14 && q.speed < 1.5) { const stop = toEnd - 8; if (stop < gap) { gap = Math.max(stop, 0.05); lv = 0 } break }
      }
    }
    // indicators
    c.sig = next && turn !== 0 && toEnd < 38 ? (turn as 1 | -1) : 0

    const acc = idm(c.speed, v0, gap, c.speed - lv)
    c.braking = acc < -1
    c.speed = Math.max(0, c.speed + acc * dt)
    c.s += c.speed * dt
    // stuck breaker
    if (c.speed < 0.2 && gap < 12 && !c.behindPlayer && !node.signal) c.stuck += dt
    else c.stuck = 0
    if (c.stuck > 18) { c.stuck = 0; if (lockOwner.get(node.id)?.car === c.id) lockOwner.delete(node.id) }
    if (c.speed < 0.2) c.waitL += dt
    else c.waitL = 0
    if (c.waitL > 50 && Math.hypot(c.x - player.x, c.z - player.z) > 130) { c.waitL = 0; spawn(c, player, 190); continue }

    // onto the next road
    let guard = 0
    while (c.s >= e.len && guard++ < 3) {
      const nx = c.np !== undefined ? g.edges[c.np] : chooseNext(c, e)
      if (!nx) { spawn(c, player, 190); break }
      c.s -= e.len
      if (lockOwner.get(node.id)?.car === c.id) lockOwner.delete(node.id)
      c.piece = nx.id
      c.lane = Math.min(c.lane, nx.lanes - 1)
      e = nx
      c.np = chooseNext(c, nx)?.id
      c.npPiece = c.piece
    }
    place(c)
  }
}

if (typeof window !== 'undefined') Object.assign(window, { __lock: lockOwner })
