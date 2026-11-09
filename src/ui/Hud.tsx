import { useEffect, useState, type PointerEvent, type ReactNode } from 'react'
import { gasTapFn } from '../game/input'
import { MODES, type Mode } from '../game/nav'
import { goMenu, input, pauseGame, resumeGame, startGame, toggleSignal } from '../game/sim'
import { setMode, setSteerSens, setTraffic, setUnits, useGame } from '../game/store'
import { MapOverlay } from './MapOverlay'
import { EyeControl } from './TouchPad'
import { useViewport } from './useViewport'

const Key = ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>

const TRAFFIC_LABELS = ['Very light', 'Light', 'Normal', 'Busy', 'Very busy']

function Settings() {
  const traffic = useGame((s) => s.traffic)
  const units = useGame((s) => s.units)
  const steerSens = useGame((s) => s.steerSens)
  return (
    <div className="settings">
      <div className="setting">
        <div className="setting-head">
          <span>Speed units</span>
          <Key>U</Key>
        </div>
        <div className="seg" role="group" aria-label="Speed units">
          <button className={units === 'kmh' ? 'on' : ''} onClick={() => setUnits('kmh')}>km/h</button>
          <button className={units === 'mph' ? 'on' : ''} onClick={() => setUnits('mph')}>mph</button>
        </div>
      </div>
      <div className="setting">
        <div className="setting-head">
          <span>Steering sensitivity</span>
          <span className="muted">{['Very gentle', 'Gentle', 'Medium', 'Quick', 'Very quick'][steerSens - 1]}</span>
        </div>
        <div className="seg" role="group" aria-label="Steering sensitivity">
          {([1, 2, 3, 4, 5] as const).map((n) => (
            <button key={n} className={steerSens === n ? 'on' : ''} onClick={() => setSteerSens(n)}>{n}</button>
          ))}
        </div>
      </div>
      <div className="setting">
        <div className="setting-head">
          <span>Traffic</span>
          <span className="muted">{TRAFFIC_LABELS[traffic - 1]}</span>
          <Key>1</Key><span className="kb-only">–</span><Key>5</Key>
        </div>
        <div className="seg" role="group" aria-label="Traffic level">
          {([1, 2, 3, 4, 5] as const).map((n) => (
            <button key={n} className={traffic === n ? 'on' : ''} onClick={() => setTraffic(n)}>{n}</button>
          ))}
        </div>
      </div>
    </div>
  )
}

function ControlsList() {
  return (
    <ul className="controls">
      <li><span><Key>↑</Key></span> Accelerator <em>hold to speed up, release to slow down</em></li>
      <li><span><Key>↓</Key></span> Brake</li>
      <li><span><Key>←</Key><Key>→</Key></span> Steer</li>
      <li><span><Key>Q</Key><Key>E</Key></span> Left / right indicator</li>
      <li><span>Drag</span> Look around <em>press and drag with the mouse, or swipe with two fingers on a trackpad (the view holds, tap to look ahead again); aim at a mirror to check it</em></li>
      <li><span><Key>A</Key><Key>W</Key><Key>D</Key></span> Quick glance at a mirror <em>(optional shortcut)</em></li>
      <li><span><Key>Esc</Key></span> Pause <span className="gap" /><Key>M</Key> mute</li>
    </ul>
  )
}

/** A button that stays "pressed" while a finger is on it (works with several fingers at once). */
function HoldButton({ label, onDown, onUp, className = '', active = false, children }: { label: string; onDown: () => void; onUp: () => void; className?: string; active?: boolean; children: ReactNode }) {
  const down = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    onDown()
  }
  const up = () => onUp()
  return (
    <button
      className={`tbtn ${className}${active ? ' on' : ''}`}
      aria-label={label}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </button>
  )
}

/**
 * On-screen controls for phones and tablets. Bottom left: an eye (slide to turn your head) with the indicators on either side and a steering wheel under it
 * (turn it with your thumb). Bottom right: brake and gas.
 */
function TouchControls() {
  const signal = useGame((s) => s.hud.signal)
  const hold = (key: 'up' | 'down') => ({ onDown: () => { input[key] = true }, onUp: () => { input[key] = false } })
  return (
    <div className="touch-controls" onContextMenu={(e) => e.preventDefault()}>
      <div className="tleft">
        <div className="eyerow">
          <HoldButton label="Left indicator" className={`sig${signal === -1 ? ' blink' : ''}`} active={signal === -1} onDown={() => toggleSignal(-1)} onUp={() => {}}>◀</HoldButton>
          <EyeControl />
          <HoldButton label="Right indicator" className={`sig${signal === 1 ? ' blink' : ''}`} active={signal === 1} onDown={() => toggleSignal(1)} onUp={() => {}}>▶</HoldButton>
        </div>
        <div className="steerrow">
          <HoldButton label="Steer left" className="steer" onDown={() => { input.left = true }} onUp={() => { input.left = false }}>◀</HoldButton>
          <HoldButton label="Steer right" className="steer" onDown={() => { input.right = true }} onUp={() => { input.right = false }}>▶</HoldButton>
        </div>
      </div>

      <div className="tgroup center" />

      <div className="tgroup">
        <HoldButton label="Brake" className="pedal brake" {...hold('down')}>Brake</HoldButton>
        <HoldButton label="Accelerator" className="pedal gas" onDown={() => { input.up = true; gasTapFn() }} onUp={() => { input.up = false }}>Gas</HoldButton>
      </div>
    </div>
  )
}

function TouchHelp() {
  return (
    <ul className="controls">
      <li><span><b>Gas / Brake</b></span> Pedals at the bottom right. Hold gas to speed up, let go to slow down</li>
      <li><span><b>Steer</b></span> Bottom left: hold the left or right arrow to steer</li>
      <li><span><b>Eye</b></span> Above the wheel: put a thumb on it and slide left or right to turn your head (up for the rear-view mirror)</li>
      <li><span><b>◀ ▶</b></span> Either side of the eye: left and right indicators (tap to switch on or off)</li>
    </ul>
  )
}

function ModePicker() {
  const mode = useGame((s) => s.mode)
  return (
    <div className="modes" role="radiogroup" aria-label="Practice">
      {MODES.map((m) => (
        <button key={m.id} role="radio" aria-checked={mode === m.id} className={`mode${mode === m.id ? ' on' : ''}`} onClick={() => setMode(m.id as Mode)}>
          <b>{m.title}</b>
          <span>{m.blurb}</span>
        </button>
      ))}
    </div>
  )
}

const modeTitle = (m: Mode) => MODES.find((x) => x.id === m)?.title ?? ''

function PlayingHud() {
  const hud = useGame((s) => s.hud)
  const mode = useGame((s) => s.mode)
  const messages = useGame((s) => s.messages)
  const { touch } = useViewport()
  const [help, setHelp] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setHelp(false), 15000)
    return () => clearTimeout(t)
  }, [])
  return (
    <>
      <div className="tl">
        {mode === 'highway' && <div className="pts"><small>POINTS</small><b>{Math.floor(hud.score)}</b></div>}
        <div className="toasts">
          {messages.map((m) => (
            <div key={m.id} className={`toast ${m.kind}`}>{m.text}</div>
          ))}
        </div>
      </div>

      <div className="tr">
        <button className="icon-btn" onClick={() => startGame()} aria-label="Restart (R)" title="Restart (R)">
          <svg viewBox="0 0 24 24" width="18" height="18"><path d="M5 12a7 7 0 1 0 2.2-5.1" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /><path d="M4 4v5h5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button className="icon-btn" onClick={pauseGame} aria-label="Pause (Esc)" title="Pause (Esc)">
          <svg viewBox="0 0 24 24" width="18" height="18"><rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" /></svg>
        </button>
      </div>

      <MapOverlay />

      {touch && <TouchControls />}

      <div className={`helpbar${help && !touch ? ' show' : ''}`}>
        <span><Key>↑</Key> go</span>
        <span><Key>↓</Key> brake</span>
        <span><Key>←</Key><Key>→</Key> steer</span>
        <span><Key>Q</Key><Key>E</Key> indicators</span>
        <span>Drag / 2-finger swipe: look around · tap to look ahead</span>
        <span><Key>Esc</Key> pause</span>
      </div>
    </>
  )
}

export function Hud() {
  const status = useGame((s) => s.status)
  const reason = useGame((s) => s.crashReason)
  const pauseReason = useGame((s) => s.pauseReason)
  const tips = useGame((s) => s.crashTips)
  const start = startGame
  const mode = useGame((s) => s.mode)
  const hud = useGame((s) => s.hud)
  const adjusting = useGame((s) => s.adjusting)
  const { touch, portrait } = useViewport()

  // phones and tablets play in landscape: pause and ask for a rotation
  useEffect(() => {
    if (touch && portrait && status === 'playing') pauseGame()
  }, [touch, portrait, status])

  return (
    <div className={`hud${touch ? ' touch' : ''}`}>
      {status === 'playing' && <PlayingHud />}
      {touch && portrait && (
        <div className="overlay rotate">
          <div className="panel">
            <svg viewBox="0 0 64 64" width="72" height="72" aria-hidden="true"><rect x="22" y="8" width="20" height="36" rx="4" fill="none" stroke="currentColor" strokeWidth="3" /><path d="M14 48c6 8 22 10 36 0m0 0l-8-1m8 1l1-8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <h2>Rotate your device</h2>
            <p>DriveMe is played in landscape. Turn your phone or tablet sideways to continue.</p>
          </div>
        </div>
      )}

      {status === 'menu' && (
        <div className="overlay">
          <div className="panel wide">
            <header>
              <div className="logo">Drive<span>Me</span></div>
              <p>Learn to drive: lanes, traffic lights, junctions and roundabouts. Check your mirrors, signal, then move. A crash ends the run. Mistakes are flagged as you make them.</p>
            </header>
            <section className="practice">
              <h3>What do you want to practise?</h3>
              <ModePicker />
            </section>
            <div className="cols">
              <section>
                <h3>Controls</h3>
                {touch ? <TouchHelp /> : <ControlsList />}
              </section>
              <section>
                <h3>Settings</h3>
                <Settings />
              </section>
            </div>
            <button className="primary" onClick={start}>Start: {modeTitle(mode)} <Key>Enter</Key></button>
          </div>
        </div>
      )}

      {status === 'paused' && pauseReason === 'offroad' && (
        <div className="overlay warn">
          <div className="panel">
            <div className="badge warn">Stopped</div>
            <h2>You left the road</h2>
            <p>Stay on the pavement. Resume puts you back in your lane, stopped, facing the way you were going.</p>
            <div className="actions">
              <button className="primary" onClick={resumeGame}>Resume on the road <Key>Enter</Key></button>
              <button className="secondary" onClick={start}>Restart <Key>R</Key></button>
            </div>
          </div>
        </div>
      )}

      {status === 'paused' && pauseReason === 'user' && adjusting && (
        <div className="adjbar">
          <span>Drag a mirror to move its view. For the right mirror, drag on the dash screen.</span>
          <button className="primary" onClick={() => useGame.setState({ adjusting: false })}>Done</button>
        </div>
      )}

      {status === 'paused' && pauseReason === 'user' && !adjusting && (
        <div className="overlay">
          <div className="panel">
            <h2>Paused</h2>
            <p className="sub">{modeTitle(mode)} · {hud.errors} {hud.errors === 1 ? 'mistake' : 'mistakes'} so far</p>
            <Settings />
            <div className="actions">
              <button className="primary" onClick={resumeGame}>Resume <Key>Esc</Key></button>
              <button className="secondary" onClick={start}>Restart <Key>R</Key></button>
              <button className="secondary" onClick={() => useGame.setState({ adjusting: true })}>Adjust mirrors</button>
              <button className="secondary" onClick={goMenu}>Change practice</button>
            </div>
          </div>
        </div>
      )}

      {status === 'crashed' && (
        <div className="overlay danger">
          <div className="panel">
            <div className="badge">Game over</div>
            <h2>You crashed</h2>
            <p className="reason">{reason}</p>
            {tips.length > 0 && (
              <ul className="tips">
                {tips.map((t) => <li key={t}>{t}</li>)}
              </ul>
            )}
            <div className="actions">
              <button className="primary" onClick={start}>Try again <Key>Enter</Key></button>
              <button className="secondary" onClick={goMenu}>Change practice</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
