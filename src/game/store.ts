import { create } from 'zustand'
import type { Mode } from './nav'

export type Status = 'menu' | 'playing' | 'paused' | 'crashed'
export type Look = 'front' | 'left' | 'center' | 'right' | 'blindL' | 'blindR'
export type Signal = -1 | 0 | 1
export type Units = 'kmh' | 'mph'

export interface Msg {
  id: number
  text: string
  kind: 'good' | 'warn' | 'info'
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

export interface DlState { phase: 'idle' | 'connecting' | 'downloading' | 'processing' | 'done' | 'error'; message: string; place: string }

interface GameState {
  status: Status
  hud: Hud
  messages: Msg[]
  crashReason: string
  crashTips: string[]
  units: Units
  traffic: 1 | 2 | 3 | 4 | 5
  pauseReason: 'user' | 'offroad'
  mode: Mode
  nav: NavHud
  world: 'grid' | 'real'
  realName: string
  dl: DlState
  /** the highway course: which scenario is being driven, and a counter that changes whenever a new one is built */
  hwType: string
  hwVersion: number
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
  pauseReason: 'user',
  mode: load<Mode>('driveme.mode', 'city', (v) => v === 'city' || v === 'roundabout' || v === 'junction' || v === 'lanes' || v === 'highway'),
  nav: { text: '', sub: '', icon: 'S', dist: 0, arrived: 0 },
  world: 'grid',
  realName: '',
  dl: { phase: 'idle', message: '', place: '' },
  hwType: 'merge',
  hwVersion: 0,
  units: load<Units>('driveme.units', 'mph', (v) => v === 'kmh' || v === 'mph'),
  traffic: load<1 | 2 | 3 | 4 | 5>('driveme.traffic', 3, (v) => [1, 2, 3, 4, 5].includes(v as number)),
}))

export const setUnits = (u: Units) => {
  save('driveme.units', u)
  useGame.setState({ units: u })
}
export const setTraffic = (n: 1 | 2 | 3 | 4 | 5) => {
  save('driveme.traffic', n)
  useGame.setState({ traffic: n })
}
export const setMode = (m: Mode) => {
  save('driveme.mode', m)
  useGame.setState({ mode: m })
}
