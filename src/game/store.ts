import { IS_COARSE } from './device'
export type Graphics = 'high' | 'medium' | 'low'
import { create } from 'zustand'
import type { Mode } from './nav'

export type Status = 'menu' | 'playing' | 'paused' | 'crashed'
export type Look = 'front' | 'left' | 'center' | 'right' | 'blindL' | 'blindR'
export type Signal = -1 | 0 | 1
export type Units = 'kmh' | 'mph'

export interface RbPath { turn: 'right' | 'straight' | 'left' | 'back'; lane: 'inner' | 'outer' | 'either' }
export interface RbDiag { correct: RbPath; took?: RbPath }
export interface Msg {
  id: number
  text: string
  kind: 'good' | 'warn' | 'info' | 'alert'
  until: number
}

export interface Hud {
  speed: number // m/s
  signal: Signal
  checks: { left: boolean; center: boolean; right: boolean }
  look: Look
  score: number
  distance: number // m
  changes: number
  clean: number
  errors: number
  limit: number // posted speed limit here, m/s
}

export interface NavHud {
  text: string
  sub: string
  icon: string
  dist: number
  arrived: number
}


interface GameState {
  status: Status
  hud: Hud
  messages: Msg[]
  crashReason: string
  crashTips: string[]
  /** a diagram for the game-over screen: the correct way through a roundabout, and what the player did */
  crashDiag: RbDiag | null
  units: Units
  traffic: 1 | 2 | 3 | 4 | 5
  /** how you look around on a phone: the eye icon, or by moving the phone */
  lookMode: 'eye' | 'motion'
  /** steering sensitivity 1 (gentle) .. 5 (quick) */
  steerSens: 1 | 2 | 3 | 4 | 5
  /** how far the view turns for a given movement of the phone (phone-motion look): 1 (least) .. 5 (most) */
  motionSens: 1 | 2 | 3 | 4 | 5
  /** graphics quality: how much drawing work each frame does (see game/quality.ts) */
  graphics: Graphics
  /** your own resting view: how far it is turned (yaw, + = left) and tilted (pitch, + = up) from the standard one (radians) */
  viewOffset: { yaw: number; pitch: number }
  /** paused and setting the default view by dragging */
  viewAdjusting: boolean
  pauseReason: 'user' | 'offroad'
  mode: Mode
  nav: NavHud
  /** the highway course: which scenario is being driven, and a counter that changes whenever a new one is built */
  hwType: string
  hwVersion: number
  /** Mixed course: driving the town, or out on the highway */
  leg: 'town' | 'highway'
  /** a short black-screen card shown while the scene changes (town <-> highway) */
  fade: { id: number; text: string; sub: string } | null
  /** paused and adjusting the mirrors (only possible while the game is paused) */
  adjusting: boolean
}

export const initialHud: Hud = {
  speed: 0,
  signal: 0,
  checks: { left: false, center: false, right: false },
  look: 'front',
  score: 0,
  distance: 0,
  changes: 0,
  clean: 0,
  errors: 0,
  limit: 13.4,
}

const load = <T,>(key: string, fallback: T, ok: (v: unknown) => boolean): T => {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const v = JSON.parse(raw)
    return ok(v) ? (v as T) : fallback
  } catch {
    return fallback
  }
}
const save = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* ignore */
  }
}

// React-facing state only. The per-frame simulation lives in sim.ts and is
// synced into this store ~10x per second so the HUD doesn't re-render at 60fps.
export const useGame = create<GameState>(() => ({
  status: 'menu',
  hud: initialHud,
  messages: [],
  crashReason: '',
  crashTips: [],
  crashDiag: null,
  pauseReason: 'user',
  mode: load<Mode>('driveme.mode', 'mixed', (v) => v === 'residential' || v === 'city' || v === 'roundabout' || v === 'mixed' || v === 'highway'),
  nav: { text: '', sub: '', icon: 'S', dist: 0, arrived: 0 },
  hwType: 'merge',
  hwVersion: 0,
  leg: 'town',
  fade: null,
  adjusting: false,
  units: load<Units>('driveme.units', 'mph', (v) => v === 'kmh' || v === 'mph'),
  lookMode: load<'eye' | 'motion'>('driveme.look', 'eye', (v) => v === 'eye' || v === 'motion'),
  steerSens: load<1 | 2 | 3 | 4 | 5>('driveme.steer', 2, (v) => [1, 2, 3, 4, 5].includes(v as number)),
  motionSens: load<1 | 2 | 3 | 4 | 5>('driveme.motion', 3, (v) => [1, 2, 3, 4, 5].includes(v as number)),
  graphics: load<Graphics>('driveme.gfx', IS_COARSE ? 'medium' : 'high', (v) => v === 'high' || v === 'medium' || v === 'low'),
  viewOffset: load<{ yaw: number; pitch: number }>('driveme.view', { yaw: 0, pitch: 0 }, (v) => !!v && typeof (v as { yaw: unknown }).yaw === 'number' && typeof (v as { pitch: unknown }).pitch === 'number'),
  viewAdjusting: false,
  traffic: load<1 | 2 | 3 | 4 | 5>('driveme.traffic', 3, (v) => [1, 2, 3, 4, 5].includes(v as number)),
}))

export const setUnits = (u: Units) => {
  save('driveme.units', u)
  useGame.setState({ units: u })
}
export const setLookMode = (m: 'eye' | 'motion') => {
  save('driveme.look', m)
  useGame.setState({ lookMode: m })
}
export const setViewOffset = (v: { yaw: number; pitch: number }, persist = true) => {
  if (persist) save('driveme.view', v)
  useGame.setState({ viewOffset: v })
}
export const setGraphics = (g: Graphics) => {
  save('driveme.gfx', g)
  useGame.setState({ graphics: g })
}
export const setMotionSens = (n: 1 | 2 | 3 | 4 | 5) => {
  save('driveme.motion', n)
  useGame.setState({ motionSens: n })
}
export const setSteerSens = (n: 1 | 2 | 3 | 4 | 5) => {
  save('driveme.steer', n)
  useGame.setState({ steerSens: n })
}
export const setTraffic = (n: 1 | 2 | 3 | 4 | 5) => {
  save('driveme.traffic', n)
  useGame.setState({ traffic: n })
}
export const setMode = (m: Mode) => {
  save('driveme.mode', m)
  useGame.setState({ mode: m })
}
