import { toggleMute } from './audio'
import { adjust, mirrorAdj, saveMirrors } from './cabinConfig'
import { input, pauseGame, resumeGame, startGame, toggleSignal } from './sim'
import { setTraffic, setUnits, useGame, type Look } from './store'

const LOOK_KEYS: Record<string, Look> = { KeyA: 'blindL', KeyW: 'center', KeyD: 'blindR' }

const SENS = 0.0028 // rad of head turn per pixel of mouse movement
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/** Wires keyboard and mouse controls. Returns a cleanup function. */
export let gasTapFn: () => void = () => {}
/** a tap of a steer button (phones): a quick second tap on the same side asks for a lane change */
const steerTaps = [0, 0]
export function steerTap(dir: -1 | 1) {
  const d = dir < 0 ? 0 : 1, now = performance.now()
  if (now - steerTaps[d] < 380) { input.laneShift = dir; steerTaps[d] = 0 } else steerTaps[d] = now
}
export function installInput() {
  // ---- free look: press and drag the mouse, or swipe with two fingers on a trackpad, to turn your head ----
  // (holding C or the right mouse button also works). Let go and your head returns to the road.
  let lookHeld = false
  const lastTap = [0, 0, 0]
  const gasTapCheck = () => { const now = performance.now(); if (now - lastTap[2] < 320) { input.gasTap = true; lastTap[2] = 0 } else lastTap[2] = now }
  gasTapFn = gasTapCheck
  let drag: { x: number; y: number } | null = null // a left-button press that has not moved far enough to count as a drag yet
  let wheelTimer = 0
  const startLook = (lock: boolean) => {
    if (lookHeld || useGame.getState().status !== 'playing') return
    lookHeld = true
    input.free = true
    input.yaw = 0
    input.pitch = 0
    // capture the mouse so you can keep turning without reaching the edge of the window (not essential: ignore refusals)
    if (lock) try { void (document.body.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {}) } catch { /* ignore */ }
  }
  const stopLook = () => {
    window.clearTimeout(wheelTimer)
    drag = null
    if (!lookHeld) return
    lookHeld = false
    input.free = false
    input.yaw = input.pitch = 0
    try { if (document.pointerLockElement) document.exitPointerLock() } catch { /* ignore */ }
  }
  const turn = (dx: number, dy: number) => {
    input.yaw = clamp(input.yaw - dx * SENS, -2.0, 2.0) // right = look right
    input.pitch = clamp(input.pitch - dy * SENS, -0.3, 0.95) // up = look up
  }
  const last = { x: 0, y: 0 }
  const onCanvas = (e: Event) => (e.target as HTMLElement | null)?.tagName === 'CANVAS'
  const mouseMove = (e: MouseEvent) => {
    if (drag && !lookHeld && (e.buttons & 1) && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4) {
      startLook(true)
      turn(e.clientX - drag.x, e.clientY - drag.y) // catch up with the movement so far
      drag = null
      return
    }
    if (lookHeld) {
      // while the pointer is captured only movementX is meaningful; otherwise fall back to the cursor position
      const locked = !!document.pointerLockElement
      turn(locked ? e.movementX : e.movementX || e.clientX - last.x, locked ? e.movementY : e.movementY || e.clientY - last.y)
    }
    last.x = e.clientX
    last.y = e.clientY
  }
  const mouseDown = (e: MouseEvent) => {
    if (!onCanvas(e) || adjust.dragging) return // a press on a mirror adjusts it instead of turning the head
    last.x = e.clientX
    last.y = e.clientY
    if (e.button === 0) drag = { x: e.clientX, y: e.clientY }
    else if (e.button === 2) { e.preventDefault(); startLook(true) }
  }
  const mouseUp = (e: MouseEvent) => {
    if (e.button === 0 || e.button === 2) stopLook()
  }
  // two-finger swipe on a trackpad arrives as small wheel events; a mouse wheel's big steps are ignored
  const wheel = (e: WheelEvent) => {
    if (!onCanvas(e) || e.ctrlKey || useGame.getState().status !== 'playing') return
    if (Math.abs(e.deltaY) >= 100 && e.deltaX === 0) return
    e.preventDefault()
    const natural = (e as WheelEvent & { webkitDirectionInvertedFromDevice?: boolean }).webkitDirectionInvertedFromDevice ?? /Mac/i.test(navigator.platform)
    const fx = natural ? -e.deltaX : e.deltaX // how far the fingers moved
    const fy = natural ? -e.deltaY : e.deltaY
    if (!lookHeld) startLook(false)
    turn(fx * 1.0, fy * 1.0)
    window.clearTimeout(wheelTimer)
    // A web page cannot tell whether fingers are still resting on the trackpad, only that they stopped moving.
    // So the view stays where you put it for a good while (and as long as you keep swiping); tap, or click, to return at once.
    wheelTimer = window.setTimeout(stopLook, 3500)
  }
  const noMenu = (e: Event) => { if (onCanvas(e)) e.preventDefault() }

  const typing = (e: KeyboardEvent) => ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement | null)?.tagName ?? '')
  const down = (e: KeyboardEvent) => {
    if (typing(e)) return // typing in a text box must not drive the game
    const status = useGame.getState().status
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault()
    if (e.code === 'KeyM' && !e.repeat) toggleMute()

    if (status !== 'playing') {
      if (e.repeat) return
      // settings work in the menu / pause screens
      if (e.code === 'KeyU') setUnits(useGame.getState().units === 'kmh' ? 'mph' : 'kmh')
      if (/^Digit[1-5]$/.test(e.code)) setTraffic(Number(e.code.slice(5)) as 1 | 2 | 3 | 4 | 5)
      if (status === 'paused') {
        if (e.code === 'KeyR') startGame()
        else if (e.code === 'Escape' || e.code === 'KeyP' || e.code === 'Enter' || e.code === 'Space') resumeGame()
      } else if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyR') startGame()
      return
    }
    if (!e.repeat && (e.code === 'Escape' || e.code === 'KeyP')) {
      pauseGame()
      return
    }
    if (e.code === 'KeyR' && !e.repeat && useGame.getState().status === 'playing') { startGame(); return }
    if (e.code === 'KeyC' && !e.repeat) startLook(true)
    if (LOOK_KEYS[e.code] && !input.free) input.look = LOOK_KEYS[e.code]
    if (adjust.sel && useGame.getState().adjusting) {
      const a = mirrorAdj[adjust.sel]
      const step = 0.012
      if (e.code === 'ArrowLeft') a.yaw -= step
      else if (e.code === 'ArrowRight') a.yaw += step
      else if (e.code === 'ArrowUp') a.pitch += step
      else if (e.code === 'ArrowDown') a.pitch -= step
      else if (e.code === 'Enter' || e.code === 'Escape') { adjust.sel = null; saveMirrors() }
      else return
      a.yaw = Math.max(-0.6, Math.min(0.6, a.yaw)); a.pitch = Math.max(-0.6, Math.min(0.6, a.pitch))
      saveMirrors()
      return
    }
    if (e.code === 'ArrowUp') { input.up = true; if (!e.repeat) gasTapCheck() }
    if (e.code === 'ArrowDown') input.down = true
    if (e.code === 'Space' && !e.repeat) input.recentre = true
    if (e.code === 'ArrowLeft') input.left = true
    if (e.code === 'ArrowRight') input.right = true
    if (!e.repeat && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      // a quick second tap asks for a lane change; holding the key steers as before
      const now = performance.now()
      const d = e.code === 'ArrowLeft' ? 0 : 1
      if (now - lastTap[d] < 320) { input.laneShift = d === 0 ? -1 : 1; lastTap[d] = 0 } else lastTap[d] = now
    }
    if (e.repeat) return
    switch (e.code) {
      case 'KeyQ': toggleSignal(-1); break
      case 'KeyE': toggleSignal(1); break
    }
  }
  const up = (e: KeyboardEvent) => {
    if (e.code === 'KeyC') stopLook()
    if (typing(e)) return
    if (LOOK_KEYS[e.code] && input.look === LOOK_KEYS[e.code]) input.look = 'front'
    if (e.code === 'ArrowUp') input.up = false
    if (e.code === 'ArrowDown') input.down = false
    if (e.code === 'ArrowLeft') input.left = false
    if (e.code === 'ArrowRight') input.right = false
  }
  const release = () => {
    stopLook()
    input.look = 'front'
    input.up = input.down = input.left = input.right = false
    input.free = false
    input.yaw = input.pitch = 0
  }
  const blur = () => { release(); pauseGame() }
  const hidden = () => { if (document.hidden) pauseGame() }

  window.addEventListener('mousemove', mouseMove)
  window.addEventListener('mousedown', mouseDown)
  window.addEventListener('mouseup', mouseUp)
  window.addEventListener('contextmenu', noMenu)
  window.addEventListener('wheel', wheel, { passive: false })
  window.addEventListener('keydown', down)
  window.addEventListener('keyup', up)
  window.addEventListener('blur', blur)
  document.addEventListener('visibilitychange', hidden)
  return () => {
    window.removeEventListener('mousemove', mouseMove)
    window.removeEventListener('mousedown', mouseDown)
    window.removeEventListener('mouseup', mouseUp)
    window.removeEventListener('contextmenu', noMenu)
    window.removeEventListener('wheel', wheel)
    window.removeEventListener('keydown', down)
    window.removeEventListener('keyup', up)
    window.removeEventListener('blur', blur)
    document.removeEventListener('visibilitychange', hidden)
  }
}

/* ---------- phone tilt steering (gyroscope / accelerometer) ---------- */
let gyroHandler: ((e: DeviceMotionEvent) => void) | null = null
/** Turn the phone like a steering wheel. The angle of gravity in the screen plane gives the wheel angle, so it works in either landscape
 *  direction. The position when you switch it on is "straight ahead". Returns false if the device has no motion sensor / permission denied. */
export async function setGyro(on: boolean): Promise<boolean> {
  if (gyroHandler) { window.removeEventListener('devicemotion', gyroHandler); gyroHandler = null }
  input.gyro = null
  if (!on) return true
  const DM = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> }
  try {
    if (typeof DM.requestPermission === 'function' && (await DM.requestPermission()) !== 'granted') return false
  } catch { return false }
  let phi0: number | null = null
  let smooth = 0
  gyroHandler = (e) => {
    const a = e.accelerationIncludingGravity
    if (!a || a.x == null || a.y == null) return
    const phi = Math.atan2(a.x, a.y)
    if (phi0 === null) phi0 = phi
    let d = phi - phi0
    d = Math.atan2(Math.sin(d), Math.cos(d))
    // clockwise turn of the phone = steer right; about 40 degrees is full lock; small dead zone
    let v = Math.max(-1, Math.min(1, -d / 0.7))
    if (Math.abs(v) < 0.05) v = 0
    smooth += (v - smooth) * 0.35
    input.gyro = smooth
  }
  window.addEventListener('devicemotion', gyroHandler)
  return true
}
