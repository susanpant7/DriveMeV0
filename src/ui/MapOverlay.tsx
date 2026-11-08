import { useEffect, useRef } from 'react'
import { drawBanner, drawNavMap } from '../game/navMap'
import { useGame } from '../game/store'
import { useViewport } from './useViewport'

/**
 * The navigation screen, at the bottom right next to the steering wheel. It is a real 2D canvas on top of the game
 * (not a texture in the 3D scene), drawn at its own steady rate with a smoothed camera, so it never flickers or shimmers.
 */
export function MapOverlay() {
  const ref = useRef<HTMLCanvasElement>(null)
  const { touch } = useViewport()
  const look = useGame((g) => g.hud.look) // the map fades while you glance at a mirror, so it never covers one
  const W = touch ? 250 : 360
  const H = touch ? 54 : 236 // phones: just the turn instruction, no map

  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const g = cv.getContext('2d')
    if (!g) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = Math.round(W * dpr)
    cv.height = Math.round(H * dpr)
    let raf = 0
    let last = performance.now()
    let acc = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      acc += dt
      if (acc < (touch ? 1 / 8 : 1 / 30)) return // a map needs 30 fps, the instruction banner far less
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (touch) {
        g.clearRect(0, 0, W, H)
        drawBanner(g, W, useGame.getState().units, true)
      } else drawNavMap(g, W, H, acc, useGame.getState().units, false)
      acc = 0
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [W, H, touch])

  return <canvas ref={ref} className={`mapscreen${touch ? ' small' : ''}${!touch && look !== 'front' ? ' dim' : ''}`} style={{ width: W, height: H }} aria-label="Navigation map" />
}
