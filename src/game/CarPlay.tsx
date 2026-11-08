import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { sim } from './sim'
import { useGame } from './store'

const CW = 1024, CH = 480
const rr = (g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath()
}

/** the CarPlay-style home screen: status bar, app tiles and a speed tile on the left; the right side is left clear for the camera feed */
function drawUI(g: CanvasRenderingContext2D, units: 'kmh' | 'mph') {
  const bg = g.createLinearGradient(0, 0, CW, CH)
  bg.addColorStop(0, '#101826'); bg.addColorStop(1, '#05070c')
  g.fillStyle = bg
  g.fillRect(0, 0, CW, CH)
  // status bar
  const now = new Date()
  g.fillStyle = '#e8f0ff'; g.font = '600 34px system-ui, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'left'
  g.fillText(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, 28, 36)
  g.textAlign = 'right'; g.fillStyle = '#8fa6c8'; g.font = '500 26px system-ui, sans-serif'
  g.fillText('5G  ▮▮▮', CW - 24, 36)
  // app tiles (2 x 2)
  const apps: Array<[string, string, string]> = [['Maps', '#2f7bff', '➤'], ['Music', '#ff4d6a', '♪'], ['Phone', '#2fcf6a', '✆'], ['Camera', '#8c5cff', '◉']]
  apps.forEach(([name, col, glyph], i) => {
    const x = 28 + (i % 2) * 190, y = 84 + Math.floor(i / 2) * 170
    const gr = g.createLinearGradient(x, y, x, y + 120)
    gr.addColorStop(0, col); gr.addColorStop(1, '#0b1224')
    g.fillStyle = gr; rr(g, x, y, 160, 120, 26); g.fill()
    g.fillStyle = '#fff'; g.font = '700 58px system-ui, sans-serif'; g.textAlign = 'center'
    g.fillText(glyph, x + 80, y + 56)
    g.font = '500 22px system-ui, sans-serif'; g.fillStyle = '#c9d6ee'
    g.fillText(name, x + 80, y + 146)
  })
  // speed tile
  const kmh = sim.speed * (units === 'mph' ? 2.23694 : 3.6)
  g.fillStyle = 'rgba(255,255,255,.07)'; rr(g, 28, 410, 350, 56, 18); g.fill()
  g.fillStyle = '#fff'; g.font = '700 34px system-ui, sans-serif'; g.textAlign = 'left'
  g.fillText(String(Math.round(kmh)), 46, 439)
  g.fillStyle = '#8fa6c8'; g.font = '500 22px system-ui, sans-serif'
  g.fillText(units === 'mph' ? 'mph' : 'km/h', 120, 441)
  g.textAlign = 'right'; g.fillText('Right camera', 362, 441)
  // frame for the feed
  g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 3; rr(g, 420, 76, 580, 392, 22); g.stroke()
}

/** A floating infotainment display. The right half shows a live copy of the right door mirror (a "blind-spot camera") for now. */
export function CarPlay({ feed, pos, rot }: { feed: THREE.Mesh | null; pos: THREE.Vector3; rot: [number, number, number] }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = CW; c.height = CH
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    return { c, g: c.getContext('2d')!, t }
  }, [])
  const last = useRef(-9)
  useFrame(() => {
    const now = performance.now()
    if (now - last.current < 500) return
    last.current = now
    drawUI(tex.g, useGame.getState().units)
    tex.t.needsUpdate = true
  }, -1)
  useEffect(() => () => tex.t.dispose(), [tex])

  const W = 0.4, H = W * (CH / CW)
  return (
    <group position={pos} rotation={rot}>
      {/* bezel and glass */}
      <mesh position={[0, 0, -0.012]}>
        <boxGeometry args={[W + 0.025, H + 0.025, 0.02]} />
        <meshStandardMaterial color="#07090d" roughness={0.3} metalness={0.5} />
      </mesh>
      <mesh>
        <planeGeometry args={[W, H]} />
        <meshBasicMaterial map={tex.t} toneMapped={false} />
      </mesh>
      {feed && (
        <group position={[W * 0.19, -0.015, 0.002]} scale={0.74}>
          <primitive object={feed} />
        </group>
      )}
    </group>
  )
}
