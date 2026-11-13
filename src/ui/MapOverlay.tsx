import { useEffect, useRef, useState } from 'react'
import { drawIcon } from '../game/navMap'
import { fmtDist, nav } from '../game/nav'
import { useGame } from '../game/store'

/**
 * The instruction banner at the top of the screen (the next turn, lane or exit). The words are real text, not drawn on a canvas, so
 * they stay sharp on any screen and are never squeezed to fit: a long line wraps onto a second one instead. Only the arrow is drawn.
 */
export function MapOverlay() {
  const units = useGame((g) => g.units)
  const [b, setB] = useState({ text: '', sub: '', icon: 'S', dist: '' })
  const icon = useRef<HTMLCanvasElement>(null)

  // the instruction changes a few times a second at most: read it 8 times a second
  useEffect(() => {
    const id = window.setInterval(() => {
      const next = { text: nav.text, sub: nav.sub, icon: nav.icon, dist: nav.text && nav.dist > 1 ? fmtDist(nav.dist, units) : '' } // (no distance when there is nothing ahead to count down to)
      setB((cur) => (cur.text === next.text && cur.sub === next.sub && cur.icon === next.icon && cur.dist === next.dist ? cur : next))
    }, 125)
    return () => window.clearInterval(id)
  }, [units])

  // the arrow
  useEffect(() => {
    const cv = icon.current
    const g = cv?.getContext('2d')
    if (!cv || !g) return
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    const S = 34
    cv.width = cv.height = Math.round(S * dpr)
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, S, S)
    drawIcon(g, b.icon, S / 2, S / 2, S - 8)
  }, [b.icon, b.text])

  if (!b.text) return null
  return (
    <div className="navbanner" role="status" aria-live="polite">
      <div className="nb-icon"><canvas ref={icon} style={{ width: 34, height: 34 }} aria-hidden="true" /></div>
      <div className="nb-words">
        <b>{b.text}</b>
        {b.sub && <span>{b.sub}</span>}
      </div>
      {b.dist && <div className="nb-dist">{b.dist}</div>}
    </div>
  )
}
