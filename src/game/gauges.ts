// Canvas drawing for the instrument cluster and the centre screen.
const deg = (d: number) => (d * Math.PI) / 180

export interface ClusterData {
  speed: number // m/s
  units: 'kmh' | 'mph'
  rpm: number
  gear: number
  signal: -1 | 0 | 1
  blink: boolean
  trip: number // metres
}

function arrow(g: CanvasRenderingContext2D, x: number, y: number, dir: -1 | 1, on: boolean, s: number) {
  g.fillStyle = on ? '#3dff7a' : '#14221a'
  if (on) {
    g.shadowColor = '#3dff7a'
    g.shadowBlur = s * 0.6
  }
  g.beginPath()
  g.moveTo(x + dir * s, y)
  g.lineTo(x - dir * s * 0.2, y - s * 0.8)
  g.lineTo(x - dir * s * 0.2, y - s * 0.3)
  g.lineTo(x - dir * s, y - s * 0.3)
  g.lineTo(x - dir * s, y + s * 0.3)
  g.lineTo(x - dir * s * 0.2, y + s * 0.3)
  g.lineTo(x - dir * s * 0.2, y + s * 0.8)
  g.closePath()
  g.fill()
  g.shadowBlur = 0
}

/** Segmented arc gauge: lit segments up to `frac`, in a colour ramp. */
function segArc(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, thick: number, a0: number, sweep: number, frac: number, n: number, lit: (t: number) => string, off = 'rgba(120,150,190,0.16)') {
  const step = sweep / n
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n
    const on = t <= frac
    g.strokeStyle = on ? lit(t) : off
    g.lineWidth = thick
    g.beginPath()
    g.arc(cx, cy, r, deg(a0 + i * step + step * 0.12), deg(a0 + (i + 1) * step - step * 0.12))
    g.stroke()
  }
}

/** A modern all-digital instrument cluster: big speed readout inside a segmented arc, side gauges, gear and limit. */
export function drawCluster(g: CanvasRenderingContext2D, w: number, h: number, d: ClusterData) {
  g.clearRect(0, 0, w, h)
  const mph = d.units === 'mph'
  const shown = d.speed * (mph ? 2.23694 : 3.6)
  const max = mph ? 120 : 200
  const limit = mph ? 30 : 50
  const over = shown > limit * 1.1
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

  // deep glass background with a faint vignette
  const bg = g.createRadialGradient(w * 0.5, h * 0.5, h * 0.1, w * 0.5, h * 0.5, w * 0.6)
  bg.addColorStop(0, '#0b121c')
  bg.addColorStop(1, '#020407')
  g.fillStyle = bg
  g.fillRect(0, 0, w, h)

  g.textBaseline = 'middle'
  g.lineCap = 'butt'
  const cx = w * 0.5, cy = h * 0.54, R = h * 0.44

  // main speed arc
  const cool = (t: number) => (t < 0.55 ? `hsl(${190 - t * 40},95%,${58 + t * 10}%)` : t < 0.8 ? '#ffd24a' : '#ff5a4d')
  segArc(g, cx, cy, R, R * 0.12, 135, 270, Math.min(1, shown / max), 54, cool)
  // speed-limit marker on the arc
  const la = deg(135 + (limit / max) * 270)
  g.strokeStyle = '#ff5a4d'
  g.lineWidth = 4
  g.beginPath(); g.moveTo(cx + Math.cos(la) * (R * 0.9), cy + Math.sin(la) * (R * 0.9)); g.lineTo(cx + Math.cos(la) * (R * 1.12), cy + Math.sin(la) * (R * 1.12)); g.stroke()
  // scale numbers just inside the arc
  g.fillStyle = 'rgba(200,220,245,0.55)'
  g.font = `500 ${R * 0.1}px ${FONT}`
  g.textAlign = 'center'
  const stepN = mph ? 20 : 40
  for (let v = 0; v <= max; v += stepN) {
    const a = deg(135 + (v / max) * 270)
    g.fillText(String(v), cx + Math.cos(a) * R * 0.76, cy + Math.sin(a) * R * 0.76)
  }

  // big speed number
  g.shadowColor = over ? 'rgba(255,90,77,0.7)' : 'rgba(110,200,255,0.55)'
  g.shadowBlur = R * 0.14
  g.fillStyle = over ? '#ff7468' : '#f4f9ff'
  g.font = `600 ${R * 0.78}px ${FONT}`
  g.textAlign = 'center'
  g.fillText(String(Math.round(shown)), cx, cy - R * 0.06)
  g.shadowBlur = 0
  g.fillStyle = '#7fa6cf'
  g.font = `500 ${R * 0.14}px ${FONT}`
  g.fillText(mph ? 'MPH' : 'KM/H', cx, cy + R * 0.42)

  // gear selector (P R N D) under the speed
  const gears = ['P', 'R', 'N', 'D']
  const cur = 3
  g.font = `600 ${R * 0.13}px ${FONT}`
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i === cur ? '#5cff8d' : 'rgba(150,175,205,0.4)'
    g.fillText(gears[i], cx + (i - 1.5) * R * 0.2, cy + R * 0.7)
  }

  // left: power / rev gauge as a vertical-feeling arc
  const lx = w * 0.15, ly = cy
  segArc(g, lx, ly, R * 0.62, R * 0.09, 150, 240, Math.min(1, d.rpm / 7000), 30, (t) => (t < 0.8 ? `hsl(${160 - t * 30},90%,58%)` : '#ff5a4d'))
  g.fillStyle = '#eaf3ff'
  g.textAlign = 'center'
  g.font = `600 ${R * 0.3}px ${FONT}`
  g.fillText((d.rpm / 1000).toFixed(1), lx, ly - R * 0.02)
  g.fillStyle = '#7fa6cf'
  g.font = `500 ${R * 0.11}px ${FONT}`
  g.fillText('x1000 RPM', lx, ly + R * 0.27)

  // right: speed-limit sign and trip
  const rx = w * 0.85
  g.fillStyle = '#fff'
  g.beginPath(); g.arc(rx, cy - R * 0.2, R * 0.34, 0, Math.PI * 2); g.fill()
  g.strokeStyle = '#d8281d'
  g.lineWidth = R * 0.07
  g.beginPath(); g.arc(rx, cy - R * 0.2, R * 0.3, 0, Math.PI * 2); g.stroke()
  g.fillStyle = '#111'
  g.font = `700 ${R * 0.32}px ${FONT}`
  g.fillText(String(limit), rx, cy - R * 0.18)
  g.fillStyle = '#9fc0e6'
  g.font = `500 ${R * 0.14}px ${FONT}`
  g.fillText(`TRIP ${mph ? (d.trip / 1609.34).toFixed(1) + ' mi' : (d.trip / 1000).toFixed(1) + ' km'}`, rx, cy + R * 0.38)

  // turn signals at the top corners of the speed arc
  arrow(g, cx - R * 1.15, h * 0.12, -1, d.signal === -1 && d.blink, h * 0.07)
  arrow(g, cx + R * 1.15, h * 0.12, 1, d.signal === 1 && d.blink, h * 0.07)
}

export interface ScreenData {
  score: number
  clean: number
  changes: number
  speed: number // m/s
  units: 'kmh' | 'mph'
}

export function drawScreen(g: CanvasRenderingContext2D, w: number, h: number, d: ScreenData) {
  const bg = g.createLinearGradient(0, 0, w, h)
  bg.addColorStop(0, '#0e1a2b')
  bg.addColorStop(1, '#07101c')
  g.fillStyle = bg
  g.fillRect(0, 0, w, h)

  const now = new Date()
  const hh = String(now.getHours()).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  g.textBaseline = 'top'
  g.textAlign = 'left'
  g.fillStyle = '#ffffff'
  g.font = '600 64px system-ui, sans-serif'
  g.fillText(`${hh}:${mm}`, 28, 24)
  g.fillStyle = '#6fa8ff'
  g.font = '28px system-ui, sans-serif'
  g.fillText('DriveMe', 30, 100)

  // speed-limit sign
  const sx = w - 110
  const sy = 100
  g.fillStyle = '#fff'
  g.beginPath()
  g.arc(sx, sy, 62, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = d.speed > 50 / 3.6 * 1.12 ? '#ff2d20' : '#d8281d'
  g.lineWidth = 12
  g.beginPath()
  g.arc(sx, sy, 56, 0, Math.PI * 2)
  g.stroke()
  g.fillStyle = '#111'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = '700 56px system-ui, sans-serif'
  g.fillText(d.units === 'mph' ? '30' : '50', sx, sy + 3)

  // lesson progress
  g.textAlign = 'left'
  g.fillStyle = '#9bb4d4'
  g.font = '26px system-ui, sans-serif'
  g.fillText('SCORE', 30, 190)
  g.fillStyle = '#fff'
  g.font = '700 54px system-ui, sans-serif'
  g.fillText(String(d.score), 30, 235)
  g.fillStyle = '#9bb4d4'
  g.font = '26px system-ui, sans-serif'
  g.fillText('CLEAN LANE CHANGES', 30, 285)
  g.fillStyle = '#5dff7a'
  g.font = '700 40px system-ui, sans-serif'
  g.fillText(`${d.clean} / ${d.changes}`, 30, 325)
}
