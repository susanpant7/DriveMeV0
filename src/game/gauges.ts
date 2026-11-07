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

interface DialOpts {
  max: number
  major: number
  minor: number
  value: number
  label: string
  redFrom: number
  fmt: (v: number) => string
}

function dial(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, o: DialOpts) {
  // face
  const face = g.createRadialGradient(cx, cy, r * 0.1, cx, cy, r)
  face.addColorStop(0, '#11171f')
  face.addColorStop(1, '#06090d')
  g.fillStyle = face
  g.beginPath()
  g.arc(cx, cy, r, 0, Math.PI * 2)
  g.fill()
  g.strokeStyle = '#2b3542'
  g.lineWidth = r * 0.04
  g.stroke()

  const a0 = 135
  const sweep = 270
  const ang = (v: number) => deg(a0 + (v / o.max) * sweep)

  // red zone arc
  if (o.redFrom < o.max) {
    g.strokeStyle = 'rgba(255,60,50,0.9)'
    g.lineWidth = r * 0.05
    g.beginPath()
    g.arc(cx, cy, r * 0.86, ang(o.redFrom), ang(o.max))
    g.stroke()
  }

  // ticks + numbers
  for (let v = 0; v <= o.max + 1e-6; v += o.minor) {
    const isMajor = Math.abs(v / o.major - Math.round(v / o.major)) < 1e-6
    const a = ang(v)
    const r1 = r * 0.93
    const r2 = r1 - r * (isMajor ? 0.12 : 0.06)
    g.strokeStyle = v >= o.redFrom ? '#ff5a4d' : '#dfe8f2'
    g.lineWidth = isMajor ? r * 0.025 : r * 0.012
    g.beginPath()
    g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
    g.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2)
    g.stroke()
    if (isMajor) {
      g.fillStyle = v >= o.redFrom ? '#ff5a4d' : '#eef4fb'
      g.font = `600 ${r * 0.13}px system-ui, sans-serif`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(o.fmt(v), cx + Math.cos(a) * r * 0.66, cy + Math.sin(a) * r * 0.66)
    }
  }

  g.fillStyle = '#8fa3b8'
  g.font = `${r * 0.11}px system-ui, sans-serif`
  g.textAlign = 'center'
  g.fillText(o.label, cx, cy + r * 0.42)

  // needle
  const a = ang(Math.min(o.max, Math.max(0, o.value)))
  g.save()
  g.shadowColor = 'rgba(255,60,40,0.8)'
  g.shadowBlur = r * 0.08
  g.strokeStyle = '#ff3b30'
  g.lineWidth = r * 0.035
  g.lineCap = 'round'
  g.beginPath()
  g.moveTo(cx - Math.cos(a) * r * 0.12, cy - Math.sin(a) * r * 0.12)
  g.lineTo(cx + Math.cos(a) * r * 0.86, cy + Math.sin(a) * r * 0.86)
  g.stroke()
  g.restore()
  g.fillStyle = '#c9d2dc'
  g.beginPath()
  g.arc(cx, cy, r * 0.07, 0, Math.PI * 2)
  g.fill()
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

export function drawCluster(g: CanvasRenderingContext2D, w: number, h: number, d: ClusterData) {
  // transparent background: only the round dials and a small centre plate are drawn
  g.clearRect(0, 0, w, h)
  g.fillStyle = 'rgba(4,7,11,0.92)'
  g.beginPath()
  const px = w * 0.385, py = h * 0.03, pw = w * 0.23, ph = h * 0.95, pr = 22
  g.moveTo(px + pr, py); g.arcTo(px + pw, py, px + pw, py + ph, pr); g.arcTo(px + pw, py + ph, px, py + ph, pr)
  g.arcTo(px, py + ph, px, py, pr); g.arcTo(px, py, px + pw, py, pr); g.closePath(); g.fill()

  const r = h * 0.46
  const cy = h * 0.53
  const mph = d.units === 'mph'
  const shown = d.speed * (mph ? 2.23694 : 3.6)
  dial(g, w * 0.76, cy, r, mph
    ? { max: 150, major: 10, minor: 5, value: shown, label: 'mph', redFrom: 1e9, fmt: (v) => String(v) }
    : { max: 240, major: 20, minor: 10, value: shown, label: 'km/h', redFrom: 1e9, fmt: (v) => String(v) })
  dial(g, w * 0.24, cy, r, { max: 8, major: 1, minor: 0.5, value: d.rpm / 1000, label: 'x1000 rpm', redFrom: 6.5, fmt: (v) => String(v) })

  // centre: digital speed, gear, indicators, trip
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = '#ffffff'
  g.font = `700 ${h * 0.3}px system-ui, sans-serif`
  g.fillText(String(Math.round(shown)), w * 0.5, h * 0.46)
  g.fillStyle = '#8fa3b8'
  g.font = `${h * 0.075}px system-ui, sans-serif`
  g.fillText(mph ? 'mph' : 'km/h', w * 0.5, h * 0.66)
  g.fillStyle = '#ffb84d'
  g.font = `600 ${h * 0.1}px system-ui, sans-serif`
  g.fillText(`D${d.gear}`, w * 0.5, h * 0.8)
  g.fillStyle = '#8fa3b8'
  g.font = `${h * 0.06}px system-ui, sans-serif`
  g.fillText(`TRIP ${mph ? (d.trip / 1609.34).toFixed(1) + ' mi' : (d.trip / 1000).toFixed(1) + ' km'}`, w * 0.5, h * 0.92)

  arrow(g, w * 0.43, h * 0.14, -1, d.signal === -1 && d.blink, h * 0.07)
  arrow(g, w * 0.57, h * 0.14, 1, d.signal === 1 && d.blink, h * 0.07)
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
