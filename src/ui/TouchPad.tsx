import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { input } from '../game/sim'

const MAX_YAW = 1.5 // rad: how far the head can turn (a bit more than 85 degrees, to see out of the side window)
const MAX_UP = 0.9
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
    input.look = 'front' // eyes straight back on the road
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
