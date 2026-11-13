import { useGame, type Graphics } from './store'

/**
 * What each graphics level does. Mirrors are the biggest cost (each one draws the whole scene again), then the full-screen effects,
 * then the resolution. Roads, signs, signals and traffic are the same at every level: only how they are drawn changes.
 */
export interface Quality {
  /** render resolution: the most device pixels per screen pixel */
  dpr: number
  /** full-screen effects: 'full' (ambient occlusion, grain, vignette, anti-aliasing), 'light' (colour grade and anti-aliasing), 'none' */
  fx: 'full' | 'light' | 'none'
  /** mirror pictures: size relative to the mirror on screen, largest size, and whether the side / rear mirrors refresh every other frame */
  mirrorScale: number
  mirrorMax: number
  sideAlt: boolean
  rearAlt: boolean
  /** how far you can see (m), and where the haze starts */
  far: number
  fogNear: number
}
export const QUALITY: Record<Graphics, Quality> = {
  high: { dpr: 1.5, fx: 'full', mirrorScale: 2, mirrorMax: 3000, sideAlt: false, rearAlt: false, far: 460, fogNear: 120 },
  medium: { dpr: 1.25, fx: 'light', mirrorScale: 1.5, mirrorMax: 2000, sideAlt: false, rearAlt: true, far: 400, fogNear: 110 },
  low: { dpr: 1, fx: 'none', mirrorScale: 1.15, mirrorMax: 1200, sideAlt: true, rearAlt: true, far: 320, fogNear: 90 },
}
/** the current level's settings (read every frame: changing the setting takes effect at once) */
export const quality = () => QUALITY[useGame.getState().graphics]
