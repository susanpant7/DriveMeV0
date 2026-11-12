import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CARPLAY } from './cabinConfig'
import { drawIcon, drawNavMap } from './navMap'
import { fmtDist, nav } from './nav'
import { sim } from './sim'
import { useGame } from './store'
import { drawHighwayMap } from '../highway/hwMap'

const CW = 928, CH = 600 // the screen's own shape (about 1.55 : 1)
const DOCK = 92

type G = CanvasRenderingContext2D
const rr = (g: G, x: number, y: number, w: number, h: number, r: number) => { g.beginPath(); g.roundRect(x, y, w, h, r) }
/** app icons: a gradient tile with a simple white glyph */
const APPS: Array<{ c0: string; c1: string; glyph: (g: G) => void }> = [
  { c0: '#5fe08a', c1: '#17b34c', glyph: (g) => { // maps: a navigation arrow
    g.beginPath(); g.moveTo(0, -17); g.lineTo(14, 15); g.lineTo(0, 7); g.lineTo(-14, 15); g.closePath(); g.fill() } },
  { c0: '#6ee37e', c1: '#22b53c', glyph: (g) => { // phone: a handset
    g.lineWidth = 9; g.lineCap = 'round'; g.beginPath(); g.arc(4, 4, 17, Math.PI * 0.62, Math.PI * 1.38); g.stroke()
    g.lineWidth = 12; g.beginPath(); g.arc(4, 4, 17, Math.PI * 0.6, Math.PI * 0.72); g.stroke(); g.beginPath(); g.arc(4, 4, 17, Math.PI * 1.28, Math.PI * 1.4); g.stroke() } },
  { c0: '#ff6b81', c1: '#f0283f', glyph: (g) => { // music: a note
    g.beginPath(); g.ellipse(-8, 12, 7.5, 5.5, -0.3, 0, 7); g.fill(); g.beginPath(); g.ellipse(11, 8, 7.5, 5.5, -0.3, 0, 7); g.fill()
    g.fillRect(-3.5, -14, 4, 26); g.fillRect(15.5, -18, 4, 26); g.beginPath(); g.moveTo(-3.5, -14); g.lineTo(19.5, -18); g.lineTo(19.5, -10); g.lineTo(-3.5, -6); g.closePath(); g.fill() } },
  { c0: '#69e36f', c1: '#27c23a', glyph: (g) => { // messages: a speech bubble
    g.beginPath(); g.ellipse(0, -2, 18, 14, 0, 0, 7); g.fill(); g.beginPath(); g.moveTo(-12, 6); g.lineTo(-17, 17); g.lineTo(-3, 10); g.closePath(); g.fill() } },
  { c0: '#b58cff', c1: '#7a45f0', glyph: (g) => { // podcasts: rings around a dot
    g.lineWidth = 3.5; for (const r of [9, 16]) { g.beginPath(); g.arc(0, -3, r, Math.PI * 0.8, Math.PI * 2.2); g.stroke() }
    g.beginPath(); g.arc(0, -3, 4, 0, 7); g.fill(); rr(g, -3, 3, 6, 14, 3); g.fill() } },
]

function drawDock(g: G) {
  g.fillStyle = '#06080c'; g.fillRect(0, 0, DOCK, CH)
  // clock and signal
  const d = new Date()
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '600 22px system-ui, sans-serif'
  g.fillText(`${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`, DOCK / 2, 26)
  for (let k = 0; k < 4; k++) { g.fillStyle = k < 3 ? '#fff' : 'rgba(255,255,255,.35)'; g.fillRect(DOCK / 2 - 17 + k * 9, 52 - k * 3, 6, 6 + k * 3) }
  APPS.forEach((a, i) => {
    const x = 17, y = 76 + i * 84, sz = 58
    const gr = g.createLinearGradient(0, y, 0, y + sz); gr.addColorStop(0, a.c0); gr.addColorStop(1, a.c1)
    g.fillStyle = gr; rr(g, x, y, sz, sz, 15); g.fill()
    if (i === 0) { g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2.5; rr(g, x - 4, y - 4, sz + 8, sz + 8, 18); g.stroke() } // the app in use
    g.save(); g.translate(x + sz / 2, y + sz / 2); g.fillStyle = '#fff'; g.strokeStyle = '#fff'; a.glyph(g); g.restore()
  })
  // home: a grid of dots
  for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) { g.fillStyle = 'rgba(255,255,255,.8)'; rr(g, DOCK / 2 - 19 + a * 14, CH - 62 + b * 14, 10, 10, 3); g.fill() }
}

/** frosted card */
const card = (g: G, x: number, y: number, w: number, h: number, r = 20) => { g.fillStyle = 'rgba(20,24,32,.9)'; rr(g, x, y, w, h, r); g.fill(); g.strokeStyle = 'rgba(255,255,255,.1)'; g.lineWidth = 1.5; rr(g, x, y, w, h, r); g.stroke() }

/** The car's centre screen: a CarPlay-style dashboard with a close-up, heading-up map, the next turn, your speed and what is playing. */
export function CarPlay() {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = CW; c.height = CH
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 8
    return { c, g: c.getContext('2d')!, t }
  }, [])
  const mapMesh = useRef<THREE.Mesh>(null!)
  const last = useRef(0)
  useFrame(() => {
    const now = performance.now()
    const dt = (now - last.current) / 1000
    if (dt < 1 / 12) return
    last.current = now
    const g = tex.g
    const units = useGame.getState().units
    const MW = CW - DOCK
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.fillStyle = '#0b1018'
    g.fillRect(0, 0, CW, CH)
    g.save(); g.translate(DOCK, 0); g.beginPath(); g.rect(0, 0, MW, CH); g.clip()
    if (useGame.getState().mode === 'highway') drawHighwayMap(g, MW, CH)
    else drawNavMap(g, MW, CH, Math.min(dt, 0.1), units, false, false, 4) // zoomed in: the next junction fills the screen
    // next turn
    if (nav.text) {
      card(g, 16, 16, 380, 104)
      g.fillStyle = '#1f6fe0'; rr(g, 28, 28, 80, 80, 16); g.fill()
      drawIcon(g, nav.icon, 68, 68, 56)
      g.textAlign = 'left'; g.textBaseline = 'alphabetic'
      g.fillStyle = '#fff'; g.font = '700 34px system-ui, sans-serif'; g.fillText(fmtDist(nav.dist, units), 124, 62)
      g.fillStyle = '#c9d6e8'; g.font = '500 20px system-ui, sans-serif'; g.fillText(nav.sub || nav.text, 124, 94, 258)
    }
    // speed and limit
    card(g, 16, CH - 106, 190, 90)
    const mph = units === 'mph'
    g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.font = '700 46px system-ui, sans-serif'
    g.fillText(String(Math.round(sim.speed * (mph ? 2.237 : 3.6))), 32, CH - 44)
    g.fillStyle = '#9fb0c6'; g.font = '600 15px system-ui, sans-serif'; g.fillText(mph ? 'MPH' : 'KM/H', 34, CH - 26)
    const lim = useGame.getState().hud.limit
    g.fillStyle = '#fff'; rr(g, 128, CH - 96, 64, 70, 9); g.fill(); g.strokeStyle = '#111'; g.lineWidth = 2.5; rr(g, 132, CH - 92, 56, 62, 6); g.stroke()
    g.fillStyle = '#111'; g.textAlign = 'center'; g.font = '700 10px system-ui, sans-serif'; g.fillText('LIMIT', 160, CH - 76)
    g.font = '700 30px system-ui, sans-serif'; g.fillText(String(mph ? Math.round((lim * 2.237) / 5) * 5 : Math.round((lim * 3.6) / 10) * 10), 160, CH - 44)
    // now playing
    card(g, MW - 316, CH - 106, 300, 90)
    const ag = g.createLinearGradient(0, CH - 94, 0, CH - 28); ag.addColorStop(0, '#ff7a59'); ag.addColorStop(1, '#c2185b')
    g.fillStyle = ag; rr(g, MW - 304, CH - 94, 66, 66, 12); g.fill()
    g.fillStyle = '#fff'; g.textAlign = 'left'; g.font = '600 19px system-ui, sans-serif'; g.fillText('Open Road', MW - 226, CH - 66, 130)
    g.fillStyle = '#9fb0c6'; g.font = '500 15px system-ui, sans-serif'; g.fillText('Drive FM', MW - 226, CH - 44, 130)
    g.fillStyle = '#fff'; g.fillRect(MW - 62, CH - 76, 7, 26); g.fillRect(MW - 48, CH - 76, 7, 26) // pause
    const prog = (now / 1000 % 200) / 200
    g.fillStyle = 'rgba(255,255,255,.2)'; rr(g, MW - 226, CH - 32, 196, 4, 2); g.fill(); g.fillStyle = '#fff'; rr(g, MW - 226, CH - 32, 196 * prog, 4, 2); g.fill()
    g.restore()
    drawDock(g)
    tex.t.needsUpdate = true
  }, -1)
  useEffect(() => () => tex.t.dispose(), [tex])

  const W = CARPLAY.W, H = CARPLAY.H
  // the map is drawn on the car's own centre screen (the model has the bezel and stand)
  return (
    <group position={CARPLAY.pos} rotation={CARPLAY.rot}>
      <mesh ref={mapMesh} position={[0, 0, 0.002]}>
        <planeGeometry args={[W, H]} />
        <meshBasicMaterial map={tex.t} toneMapped={false} />
      </mesh>
    </group>
  )
}
