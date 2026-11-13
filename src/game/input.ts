import { toggleMute } from './audio'
import { adjust, mirrorAdj, saveMirrors } from './cabinConfig'
import { input, pauseGame, resumeGame, startGame, toggleSignal } from './sim'
import { setTraffic, setUnits, useGame } from './store'

// A / D turn the head left / right, W / S tilt it up / down; it moves gradually while the key is held and stays where you leave it
const LOOK_KEYS: Record<string, 'kA' | 'kW' | 'kD' | 'kS'> = { KeyA: 'kA', KeyW: 'kW', KeyD: 'kD', KeyS: 'kS' }

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
  const lastTap = [0, 0, 0, 0, 0, 0]
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

    // adjusting a mirror (the game is paused): the arrow keys tilt the selected mirror; holding a key keeps it moving
    if (adjust.sel && useGame.getState().adjusting) {
      const a = mirrorAdj[adjust.sel]
      const step = e.shiftKey ? 0.004 : 0.012 // hold Shift for fine steps
      let nudged = true
      if (e.code === 'ArrowLeft') a.yaw -= step
      else if (e.code === 'ArrowRight') a.yaw += step
      else if (e.code === 'ArrowUp') a.pitch += step
      else if (e.code === 'ArrowDown') a.pitch -= step
      else nudged = false
      if (nudged) {
      a.yaw = Math.max(-0.6, Math.min(0.6, a.yaw)); a.pitch = Math.max(-0.6, Math.min(0.6, a.pitch))
      saveMirrors()
      return
      }
    }
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
    // a quick double press of A / D swings the head round to check the left / right blind spot (about 120 degrees)
    if ((e.code === 'KeyA' || e.code === 'KeyD') && !e.repeat) {
      const now = performance.now()
      const slot = e.code === 'KeyA' ? 4 : 5
      if (now - lastTap[slot] < 320) { input.blind = e.code === 'KeyA' ? 1 : -1; lastTap[slot] = 0 } else lastTap[slot] = now
    }
    if (LOOK_KEYS[e.code]) input[LOOK_KEYS[e.code]] = true
    if (e.code === 'ArrowUp') { input.up = true; if (!e.repeat) gasTapCheck() }
    if (e.code === 'ArrowDown') {
      input.down = true
      // a quick double press of the down arrow puts the wheel back to straight
      if (!e.repeat) { const now = performance.now(); if (now - lastTap[3] < 320) { input.recentre = true; lastTap[3] = 0 } else lastTap[3] = now }
    }
    if (e.code === 'Space') { input.space = true; if (!e.repeat) input.recentre = true }
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
    if (LOOK_KEYS[e.code]) input[LOOK_KEYS[e.code]] = false
    if (e.code === 'ArrowUp') input.up = false
    if (e.code === 'ArrowDown') input.down = false
    if (e.code === 'ArrowLeft') input.left = false
    if (e.code === 'ArrowRight') input.right = false
    if (e.code === 'Space') input.space = false
  }
  const release = () => {
    stopLook()
    input.look = 'front'
    input.kA = input.kW = input.kD = input.kS = false
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

/* ---------- looking around on a phone: the eye icon and (if switched on) moving the phone, both at once ---------- */
/** the two sources of free look on a touch screen; the head turns by their sum */
const lookParts = { eye: { on: false, yaw: 0, pitch: 0 }, motion: { on: false, yaw: 0, pitch: 0 } }
function applyLook() {
  const e = lookParts.eye, m = lookParts.motion
  input.free = e.on || m.on
  input.yaw = (e.on ? e.yaw : 0) + (m.on ? m.yaw : 0)
  input.pitch = (e.on ? e.pitch : 0) + (m.on ? m.pitch : 0)
  if (!input.free) input.look = 'front'
}
/** the eye icon: held (on) with a head turn, or let go */
export function setEyeLook(on: boolean, yaw = 0, pitch = 0) { lookParts.eye = { on, yaw, pitch }; applyLook() }
/* ---------- phone motion: look around by moving the phone ---------- */
let motionHandler: ((e: DeviceOrientationEvent) => void) | null = null
const motion = { on: false, base: null as null | { yaw: number; pitch: number } }
export const motionActive = () => motion.on
/** forget where the phone was pointing: the direction it points now is "straight ahead" */
export function recentreMotion() { motion.base = null }
/** recentre the view: phone motion's "straight ahead" is where the phone points now, and the head turns back to the road */
export function recentreView() { motion.base = null; input.look = 'front'; input.recentreHead = true }
/**
 * Like a window onto the car: point the phone left / right / up and the view follows. It uses the direction of the back camera, so it works
 * in either landscape direction. Returns false if the device has no motion sensor or permission was denied.
 */
export async function setMotionLook(on: boolean): Promise<boolean> {
  if (motionHandler) { window.removeEventListener('deviceorientation', motionHandler); motionHandler = null }
  if (motion.on) { motion.on = false; lookParts.motion = { on: false, yaw: 0, pitch: 0 }; applyLook() }
  if (!on) return true
  const DO = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> }
  try {
    if (typeof DO.requestPermission === 'function' && (await DO.requestPermission()) !== 'granted') return false
  } catch { return false }
  motion.base = null
  motion.on = true
  let sy = 0, sp = 0
  motionHandler = (e) => {
    if (e.alpha == null || e.beta == null || e.gamma == null) return
    const r = Math.PI / 180
    const al = e.alpha * r, be = e.beta * r, ga = e.gamma * r
    // direction the back camera points, in world coordinates (x east, y north, z up)
    const vx = Math.sin(ga) * Math.cos(al) + Math.cos(ga) * Math.sin(be) * Math.sin(al)
    const vy = Math.sin(ga) * Math.sin(al) - Math.cos(ga) * Math.sin(be) * Math.cos(al)
    const vz = Math.cos(ga) * Math.cos(be)
    const heading = Math.atan2(-vx, -vy)
    const pitch = Math.asin(Math.max(-1, Math.min(1, -vz)))
    if (!motion.base) motion.base = { yaw: heading, pitch }
    let dy = heading - motion.base.yaw
    dy = Math.atan2(Math.sin(dy), Math.cos(dy))
    // the chosen sensitivity scales how far your head turns for a given turn of the phone (3 = the default)
    const gain = [0.55, 0.8, 1, 1.3, 1.7][useGame.getState().motionSens - 1] ?? 1
    const tY = clamp(-dy * 1.6 * gain, -2.0, 2.0) // turning the phone right turns your head right (game yaw + = left); a little amplified
    const tP = clamp((pitch - motion.base.pitch) * 1.4 * gain, -0.3, 0.95)
    sy += (tY - sy) * 0.4
    sp += (tP - sp) * 0.4
    lookParts.motion = { on: true, yaw: sy, pitch: sp }
    applyLook()
  }
  window.addEventListener('deviceorientation', motionHandler)
  return true
}
