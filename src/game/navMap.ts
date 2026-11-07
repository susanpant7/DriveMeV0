import { B, HALF_MID, ISLAND_R, RING_OUT, mod } from './map'
import { fmtDist, nav } from './nav'

const ROUTE = '#3b9dff'

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath()
}

/** Instruction glyph, drawn with paths so it does not depend on fonts. */
function drawIcon(g: CanvasRenderingContext2D, icon: string, cx: number, cy: number, s: number) {
  g.save()
  g.translate(cx, cy)
  g.strokeStyle = '#fff'
  g.fillStyle = '#fff'
  g.lineWidth = s * 0.17
  g.lineCap = 'round'
  g.lineJoin = 'round'
  const head = (x: number, y: number, ang: number) => {
    g.save(); g.translate(x, y); g.rotate(ang)
    g.beginPath(); g.moveTo(s * 0.34, 0); g.lineTo(-s * 0.12, -s * 0.3); g.lineTo(-s * 0.12, s * 0.3); g.closePath(); g.fill()
    g.restore()
  }
  if (icon === 'S') { g.beginPath(); g.moveTo(0, s * 0.45); g.lineTo(0, -s * 0.18); g.stroke(); head(0, -s * 0.22, -Math.PI / 2) }
  else if (icon === 'L' || icon === 'R') {
    const d = icon === 'L' ? -1 : 1
    g.beginPath(); g.moveTo(0, s * 0.45); g.lineTo(0, -s * 0.02); g.quadraticCurveTo(0, -s * 0.2, d * s * 0.18, -s * 0.2); g.lineTo(d * s * 0.2, -s * 0.2); g.stroke()
    head(d * s * 0.26, -s * 0.2, d < 0 ? Math.PI : 0)
  } else if (icon === 'U') { g.beginPath(); g.moveTo(s * 0.2, s * 0.45); g.lineTo(s * 0.2, -s * 0.05); g.arc(0, -s * 0.05, s * 0.2, 0, Math.PI, true); g.lineTo(-s * 0.2, s * 0.15); g.stroke(); head(-s * 0.2, s * 0.2, Math.PI / 2) }
  else if (icon === 'F') {
    g.beginPath(); g.moveTo(-s * 0.2, s * 0.45); g.lineTo(-s * 0.2, -s * 0.4); g.stroke()
    g.fillStyle = '#ff4b4b'; g.beginPath(); g.moveTo(-s * 0.2, -s * 0.4); g.lineTo(s * 0.35, -s * 0.22); g.lineTo(-s * 0.2, -s * 0.04); g.closePath(); g.fill()
  } else if (icon[0] === 'O') {
    g.lineWidth = s * 0.12
    g.beginPath(); g.arc(0, s * 0.02, s * 0.28, 0, Math.PI * 2); g.stroke()
    // the chosen exit
    const exit = Number(icon[1])
    const ang = [Math.PI / 2 * 0, -Math.PI / 2, Math.PI, Math.PI / 2][exit === 1 ? 0 : exit === 2 ? 1 : exit === 3 ? 2 : 3]
    g.fillStyle = ROUTE
    g.beginPath(); g.moveTo(0, s * 0.02); g.lineTo(Math.cos(ang) * s * 0.5, s * 0.02 + Math.sin(ang) * s * 0.5); g.strokeStyle = ROUTE; g.lineWidth = s * 0.16; g.stroke()
    g.fillStyle = '#fff'; g.font = `700 ${s * 0.3}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText(String(exit), 0, s * 0.04)
    // entry stub from the bottom
    g.strokeStyle = '#fff'; g.lineWidth = s * 0.1; g.beginPath(); g.moveTo(0, s * 0.52); g.lineTo(0, s * 0.3); g.stroke()
  }
  g.restore()
}

/** Heading-up navigation map with the route, the next instruction and the distance to it. */
export function drawNavMap(g: CanvasRenderingContext2D, w: number, h: number, px: number, pz: number, heading: number, units: 'kmh' | 'mph') {
  g.fillStyle = '#0d141d'
  g.fillRect(0, 0, w, h)

  const S = 0.82 // pixels per metre
  const R = 560
  const cx = w / 2
  const cy = h * 0.72
  g.save()
  g.translate(cx, cy)
  g.rotate(heading)
  g.scale(S, S)
  g.translate(-px, -pz)

  const i0 = Math.ceil((px - R) / B), i1 = Math.floor((px + R) / B)
  const j0 = Math.ceil((pz - R) / B), j1 = Math.floor((pz + R) / B)
  // blocks
  g.fillStyle = '#131d2a'
  for (let i = i0 - 1; i <= i1; i++) for (let j = j0 - 1; j <= j1; j++) g.fillRect(i * B + HALF_MID, j * B + HALF_MID, B - 2 * HALF_MID, B - 2 * HALF_MID)
  // roads
  g.fillStyle = '#34445a'
  for (let i = i0; i <= i1; i++) g.fillRect(i * B - HALF_MID, pz - R, 2 * HALF_MID, 2 * R)
  for (let j = j0; j <= j1; j++) g.fillRect(px - R, j * B - HALF_MID, 2 * R, 2 * HALF_MID)
  // roundabouts and signalled junctions
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    if (mod(i, 2) === 0 && mod(j, 2) === 0) {
      g.fillStyle = '#34445a'; g.beginPath(); g.arc(i * B, j * B, RING_OUT, 0, Math.PI * 2); g.fill()
      g.fillStyle = '#1c3d2b'; g.beginPath(); g.arc(i * B, j * B, ISLAND_R, 0, Math.PI * 2); g.fill()
    } else {
      g.fillStyle = '#f5c518'; g.fillRect(i * B - 4, j * B - 4, 8, 8) // traffic lights
    }
  }

  // route
  const steps = nav.steps.slice(nav.k)
  if (steps.length) {
    g.lineJoin = 'round'
    g.lineCap = 'round'
    g.beginPath()
    g.moveTo(px, pz)
    for (const s of steps) g.lineTo(s.i * B, s.j * B)
    g.strokeStyle = 'rgba(59,157,255,.28)'; g.lineWidth = 20 / S; g.stroke()
    g.strokeStyle = ROUTE; g.lineWidth = 9 / S; g.stroke()
    // destination flag
    const last = steps[steps.length - 1]
    g.fillStyle = '#ff4b4b'; g.beginPath(); g.arc(last.i * B, last.j * B, 15 / S, 0, Math.PI * 2); g.fill()
    g.fillStyle = '#fff'; g.beginPath(); g.arc(last.i * B, last.j * B, 6 / S, 0, Math.PI * 2); g.fill()
  }
  g.restore()

  // you
  g.save()
  g.translate(cx, cy)
  g.fillStyle = '#ffffff'; g.strokeStyle = '#0d141d'; g.lineWidth = 3
  g.beginPath(); g.moveTo(0, -17); g.lineTo(12, 13); g.lineTo(0, 7); g.lineTo(-12, 13); g.closePath(); g.fill(); g.stroke()
  g.restore()

  // compass
  const ca = { x: w - 30, y: h - 30 }
  g.fillStyle = 'rgba(8,12,18,.8)'; g.beginPath(); g.arc(ca.x, ca.y, 18, 0, Math.PI * 2); g.fill()
  g.fillStyle = '#ff6b6b'; g.font = '700 14px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'
  g.fillText('N', ca.x + Math.sin(heading) * 9, ca.y - Math.cos(heading) * 9)

  // instruction panel
  if (nav.text) {
    g.fillStyle = 'rgba(10,15,23,.93)'
    roundRect(g, 10, 10, w - 20, 82, 14); g.fill()
    g.fillStyle = '#1f6fe0'
    roundRect(g, 16, 16, 70, 70, 12); g.fill()
    drawIcon(g, nav.icon, 51, 52, 56)
    g.textAlign = 'left'; g.textBaseline = 'alphabetic'
    g.fillStyle = '#ffffff'; g.font = '700 27px system-ui, sans-serif'
    g.fillText(nav.text, 98, 48, w - 98 - 120)
    g.fillStyle = '#9fb4cf'; g.font = '500 19px system-ui, sans-serif'
    g.fillText(nav.sub, 98, 76, w - 98 - 120)
    g.textAlign = 'right'; g.fillStyle = '#ffffff'; g.font = '700 29px system-ui, sans-serif'
    g.fillText(fmtDist(nav.dist, units), w - 22, 60)
  }
}
