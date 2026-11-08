import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { input } from '../game/sim'

const MAX_YAW = 1.5 // rad: how far the head can turn (a bit more than 85 degrees, to see out of the side window)
const MAX_UP = 0.75
const REACH = 64 // px of thumb travel for the full turn

/**
 * An eye: put your thumb on it and slide it sideways to turn your head (left / right), up to look up at the rear-view mirror.
 * Let go and your head returns to the road.
 */
export function EyeControl() {
  const ref = useRef<HTMLDivElement>(null)
  const [d, setD] = useState({ x: 0, y: 0, on: false })
  const origin = useRef({ x: 0, y: 0 })

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const dx = Math.max(-REACH, Math.min(REACH, e.clientX - origin.current.x))
    const dy = Math.max(-REACH, Math.min(REACH * 0.4, e.clientY - origin.current.y))
    // sliding left turns the head left (the view swings to the left of the car)
    input.yaw = (-dx / REACH) * MAX_YAW
    input.pitch = dy < 0 ? (-dy / REACH) * MAX_UP : 0
    setD({ x: dx, y: dy, on: true })
  }
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const r = e.currentTarget.getBoundingClientRect()
    origin.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    input.free = true
    move(e)
  }
  const up = () => {
    input.free = false
    input.yaw = input.pitch = 0
    setD({ x: 0, y: 0, on: false })
  }
  useEffect(() => up, [])

  return (
    <div
      ref={ref}
      className={`eye${d.on ? ' on' : ''}`}
      role="slider"
      aria-label="Look around: slide left or right to turn your head"
      onPointerDown={down}
      onPointerMove={(e) => d.on && move(e)}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg viewBox="0 0 100 64" aria-hidden="true">
        <path d="M4 32 C20 8 80 8 96 32 C80 56 20 56 4 32 Z" fill="rgba(255,255,255,.1)" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
        <circle cx={50 + (d.x / REACH) * 20} cy={32 + (d.y / REACH) * 10} r="13" fill="currentColor" />
        <circle cx={50 + (d.x / REACH) * 20 + 4} cy={32 + (d.y / REACH) * 10 - 4} r="4" fill="#0e131c" />
      </svg>
      <small>{d.on ? (d.x < -12 ? 'Left' : d.x > 12 ? 'Right' : d.y < -14 ? 'Rear' : 'Look') : 'Look'}</small>
    </div>
  )
}

const MAX_WHEEL = 2.1 // rad (about 120 degrees) of wheel turn for full lock

/**
 * A steering wheel you turn with your thumb, like the real thing: put a thumb on the rim and rotate it around the hub.
 * It springs back to centre when you let go.
 */
export function SteerWheel() {
  const ref = useRef<HTMLDivElement>(null)
  const [ang, setAng] = useState(0)
  const st = useRef({ active: false, start: 0, base: 0, raf: 0, ang: 0 })

  const centre = () => {
    const r = ref.current!.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }
  const apply = (a: number) => {
    st.current.ang = a
    setAng(a)
    input.analog = Math.abs(a) < 0.02 ? 0 : a / MAX_WHEEL
  }
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    cancelAnimationFrame(st.current.raf)
    const c = centre()
    st.current.active = true
    st.current.start = Math.atan2(e.clientY - c.y, e.clientX - c.x)
    st.current.base = st.current.ang
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!st.current.active) return
    const c = centre()
    let d = Math.atan2(e.clientY - c.y, e.clientX - c.x) - st.current.start
    d = Math.atan2(Math.sin(d), Math.cos(d)) // shortest way round
    apply(Math.max(-MAX_WHEEL, Math.min(MAX_WHEEL, st.current.base + d)))
  }
  const up = () => {
    if (!st.current.active) return
    st.current.active = false
    // spring back to centre, quickly at first
    let last = performance.now()
    const back = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const a = st.current.ang * Math.exp(-9 * dt)
      if (Math.abs(a) < 0.015) { st.current.ang = 0; setAng(0); input.analog = null; return }
      apply(a)
      st.current.raf = requestAnimationFrame(back)
    }
    st.current.raf = requestAnimationFrame(back)
  }
  useEffect(() => () => { cancelAnimationFrame(st.current.raf); input.analog = null }, [])

  return (
    <div
      ref={ref}
      className="wheel"
      role="slider"
      aria-label="Steering wheel: turn it with your thumb"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg viewBox="0 0 120 120" style={{ transform: `rotate(${ang}rad)` }} aria-hidden="true">
        <circle cx="60" cy="60" r="52" fill="none" stroke="#e9edf3" strokeWidth="11" />
        <circle cx="60" cy="60" r="52" fill="none" stroke="#10151d" strokeWidth="6" />
        <path d="M60 60 L12 62 M60 60 L108 62 M60 60 L60 108" stroke="#cfd6e0" strokeWidth="9" strokeLinecap="round" />
        <circle cx="60" cy="60" r="15" fill="#1d2430" stroke="#cfd6e0" strokeWidth="4" />
        <rect x="55.5" y="3" width="9" height="15" rx="3" fill="#ff5a4d" />
      </svg>
    </div>
  )
}
