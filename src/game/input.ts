import { toggleMute } from './audio'
import { input, pauseGame, resumeGame, startGame, toggleSignal } from './sim'
import { setTraffic, setUnits, useGame, type Look } from './store'

const LOOK_KEYS: Record<string, Look> = { KeyA: 'left', KeyW: 'center', KeyD: 'right' }

/** Wires keyboard controls. Returns a cleanup function. */
export function installInput() {
  const down = (e: KeyboardEvent) => {
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
    if (LOOK_KEYS[e.code]) input.look = LOOK_KEYS[e.code]
    if (e.code === 'ArrowUp') input.up = true
    if (e.code === 'ArrowDown') input.down = true
    if (e.code === 'ArrowLeft') input.left = true
    if (e.code === 'ArrowRight') input.right = true
    if (e.repeat) return
    switch (e.code) {
      case 'KeyQ': toggleSignal(-1); break
      case 'KeyE': toggleSignal(1); break
    }
  }
  const up = (e: KeyboardEvent) => {
    if (LOOK_KEYS[e.code] && input.look === LOOK_KEYS[e.code]) input.look = 'front'
    if (e.code === 'ArrowUp') input.up = false
    if (e.code === 'ArrowDown') input.down = false
    if (e.code === 'ArrowLeft') input.left = false
    if (e.code === 'ArrowRight') input.right = false
  }
  const release = () => {
    input.look = 'front'
    input.up = input.down = input.left = input.right = false
  }
  const blur = () => { release(); pauseGame() }
  const hidden = () => { if (document.hidden) pauseGame() }

  window.addEventListener('keydown', down)
  window.addEventListener('keyup', up)
  window.addEventListener('blur', blur)
  document.addEventListener('visibilitychange', hidden)
  return () => {
    window.removeEventListener('keydown', down)
    window.removeEventListener('keyup', up)
    window.removeEventListener('blur', blur)
    document.removeEventListener('visibilitychange', hidden)
  }
}
