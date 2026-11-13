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
  cruise: number // set speed in m/s, 0 = off
  /** lane assist: 0 off, 1 on (standing by), 2 steering */
  assist: 0 | 1 | 2
}

function arrow(g: CanvasRenderingContext2D, x: number, y: number, dir: -1 | 1, on: boolean, s: number) {
  g.fillStyle = on ? '#3dff7a' : '#2a4a36'
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

/** A modern all-digital instrument cluster: big speed readout inside a segmented arc, side gauges and gear. */
export function drawCluster(g: CanvasRenderingContext2D, w: number, h: number, d: ClusterData) {
  g.clearRect(0, 0, w, h)
  const mph = d.units === 'mph'
  const shown = d.speed * (mph ? 2.23694 : 3.6)
  const max = mph ? 120 : 200
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

  // deep glass background with a faint vignette
  const bg = g.createRadialGradient(w * 0.5, h * 0.5, h * 0.1, w * 0.5, h * 0.5, w * 0.6)
  bg.addColorStop(0, '#101a26')
  bg.addColorStop(1, '#05080d')
  g.fillStyle = bg
  g.fillRect(0, 0, w, h)

  g.textBaseline = 'middle'
  g.lineCap = 'butt'
  const cx = w * 0.5, cy = h * 0.54, R = h * 0.44

  // main speed arc
  const cool = (t: number) => (t < 0.55 ? `hsl(${190 - t * 40},95%,${58 + t * 10}%)` : t < 0.8 ? '#ffd24a' : '#ff5a4d')
  segArc(g, cx, cy, R, R * 0.12, 135, 270, Math.min(1, shown / max), 54, cool)
  // scale numbers just inside the arc
  g.fillStyle = 'rgba(200,220,245,0.55)'
  g.font = `500 ${R * 0.1}px ${FONT}`
  g.textAlign = 'center'
  const stepN = mph ? 20 : 40
  for (let v = 0; v <= max; v += stepN) {
    const a = deg(135 + (v / max) * 270)
    g.fillText(String(v), cx + Math.cos(a) * R * 0.76, cy + Math.sin(a) * R * 0.76)
  }

  // (no speed number here: your speed is shown large on the centre screen, beside the speed limit; the arc still shows it)
  void shown
  g.textAlign = 'center'
  if (d.cruise > 0) { g.fillStyle = '#34e08a'; g.font = `700 ${R * 0.18}px ${FONT}`; g.fillText('CRUISE', cx, cy + R * 0.1) }
  // lane assist: a glowing lane icon and its name (green while it steers, grey while it stands by)
  if (d.assist) {
    const on = d.assist === 2, col = on ? '#3dff9a' : 'rgba(190,205,225,0.75)'
    const iy = cy - R * 0.5, s = R * 0.22
    g.save()
    if (on) { g.shadowColor = col; g.shadowBlur = s * 0.9 }
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = s * 0.13; g.lineCap = 'round'
    for (const k of [-1, 1]) { g.beginPath(); g.moveTo(cx + k * s * 0.55, iy - s * 0.55); g.lineTo(cx + k * s * 0.95, iy + s * 0.55); g.stroke() } // the lane edges
    g.beginPath(); g.roundRect(cx - s * 0.24, iy - s * 0.12, s * 0.48, s * 0.6, s * 0.1); g.fill() // the car between them
    g.font = `800 ${R * 0.14}px ${FONT}`; g.fillText('LANE ASSIST', cx, iy + s * 1.2)
    g.restore()
  }

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

  // right: trip distance
  const rx = w * 0.85
  g.fillStyle = '#eaf3ff'
  g.textAlign = 'center'
  g.font = `600 ${R * 0.3}px ${FONT}`
  g.fillText(mph ? (d.trip / 1609.34).toFixed(1) : (d.trip / 1000).toFixed(1), rx, cy - R * 0.02)
  g.fillStyle = '#7fa6cf'
  g.font = `500 ${R * 0.11}px ${FONT}`
  g.fillText(mph ? 'TRIP MI' : 'TRIP KM', rx, cy + R * 0.27)

  // turn signals at the top corners of the speed arc
  arrow(g, cx - R * 1.02, cy - R * 0.1, -1, d.signal === -1 && d.blink, h * 0.085)
  arrow(g, cx + R * 1.02, cy - R * 0.1, 1, d.signal === 1 && d.blink, h * 0.085)
}
