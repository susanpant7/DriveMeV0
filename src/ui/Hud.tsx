import { useEffect, useState, type PointerEvent, type ReactNode } from 'react'
import { gasTapFn, motionActive, recentreMotion, setMotionLook, steerTap } from '../game/input'
import { MODES, type Mode } from '../game/nav'
import { adjustMirror, goMenu, input, pauseGame, resumeGame, startGame, toggleSignal } from '../game/sim'
import type { RbDiag, RbPath } from '../game/store'
import { setLookMode, setMode, setSteerSens, setTraffic, setUnits, useGame } from '../game/store'
import { MapOverlay } from './MapOverlay'
import { EyeControl } from './TouchPad'
import { useViewport } from './useViewport'

const Key = ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>

const TRAFFIC_LABELS = ['Very light', 'Light', 'Normal', 'Busy', 'Very busy']

function Settings() {
  const traffic = useGame((s) => s.traffic)
  const units = useGame((s) => s.units)
  const steerSens = useGame((s) => s.steerSens)
  const lookMode = useGame((s) => s.lookMode)
  const { touch } = useViewport()
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
      {touch && (
        <div className="setting">
          <div className="setting-head">
            <span>Look around</span>
            <span className="muted">{lookMode === 'eye' ? 'Eye icon' : 'Move the phone'}</span>
          </div>
          <div className="seg" role="group" aria-label="Look around">
            <button className={lookMode === 'eye' ? 'on' : ''} onClick={() => setLookMode('eye')}>Eye icon</button>
            <button className={lookMode === 'motion' ? 'on' : ''} onClick={async () => { if (await setMotionLook(true)) setLookMode('motion') }}>Phone motion</button>
          </div>
        </div>
      )}
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
      <li><span><Key>←</Key><Key>→</Key></span> Steer <em>hold to keep turning the wheel; let go and it returns to straight. <Key>Space</Key> centres the view, cancels the indicator and eases the car into the middle of its lane; hold it and the car stays in the middle of its lane, even round bends and roundabouts</em></li>
      <li><span><Key>Q</Key><Key>E</Key></span> Left / right indicator</li>
      <li><span>Drag</span> Look around <em>press and drag with the mouse, or swipe with two fingers on a trackpad (the view holds, tap to look ahead again); aim at a mirror to check it</em></li>
      <li><span><Key>A</Key><Key>D</Key><Key>W</Key><Key>S</Key></span> Turn your head <em>like the wheel: each press turns it a little and it stays (A left, D right, W up, S down; combine them, e.g. A + W). Double-press A or D to look over that shoulder into the blind spot (about 120°). <Key>Space</Key> centres the view and the wheel and gently steers the car into the middle of its lane (auto mode: steering by hand cancels it)</em></li>
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
const Chev = ({ dir }: { dir: -1 | 1 }) => (
  <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" style={{ transform: dir === 1 ? 'scaleX(-1)' : undefined }}>
    <path d="M15 4 7 12l8 8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const TurnArrow = ({ dir }: { dir: -1 | 1 }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style={{ transform: dir === 1 ? 'scaleX(-1)' : undefined }}>
    <path d="M10 5 3 12l7 7V15h11V9H10z" fill="currentColor" />
  </svg>
)
function TouchControls() {
  const signal = useGame((s) => s.hud.signal)
  const lookMode = useGame((s) => s.lookMode)
  useEffect(() => {
    if (lookMode === 'motion') void setMotionLook(true)
    return () => { void setMotionLook(false) }
  }, [lookMode])
  const hold = (key: 'up' | 'down') => ({ onDown: () => { input[key] = true }, onUp: () => { input[key] = false } })
  return (
    <div className="touch-controls" onContextMenu={(e) => e.preventDefault()}>
      <div className="tleft">
        <div className="eyerow">
          <HoldButton label="Left indicator" className={`sig${signal === -1 ? ' blink' : ''}`} active={signal === -1} onDown={() => toggleSignal(-1)} onUp={() => {}}><TurnArrow dir={-1} /></HoldButton>
          {lookMode === 'eye' ? <EyeControl /> : (
            <button className="tbtn tilt" aria-label="Recentre the view" onClick={async () => { if (motionActive()) recentreMotion(); else await setMotionLook(true) }}>⌖ View</button>
          )}
          <HoldButton label="Right indicator" className={`sig${signal === 1 ? ' blink' : ''}`} active={signal === 1} onDown={() => toggleSignal(1)} onUp={() => {}}><TurnArrow dir={1} /></HoldButton>
        </div>
        <div className="steerrow">
          <HoldButton label="Steer left" className="steer" onDown={() => { input.left = true; steerTap(-1) }} onUp={() => { input.left = false }}><Chev dir={-1} /></HoldButton>
          <HoldButton label="Steer right" className="steer" onDown={() => { input.right = true; steerTap(1) }} onUp={() => { input.right = false }}><Chev dir={1} /></HoldButton>
        </div>
      </div>

      <div className="tgroup center" />

      <div className="tgroup">
        <HoldButton label="Brake" className="pedal brake" {...hold('down')}>Brake</HoldButton>
        <div className="gascol">
          <button className="tbtn lanekeep" aria-label="Keep in lane (tap to centre in the lane, hold to stay in it)" onPointerDown={() => { input.recentre = true; input.space = true }} onPointerUp={() => { input.space = false }} onPointerLeave={() => { input.space = false }} onPointerCancel={() => { input.space = false }}><span className="ring" /><small>LANE</small></button>
          <HoldButton label="Accelerator" className="pedal gas" onDown={() => { input.up = true; gasTapFn() }} onUp={() => { input.up = false }}>Gas</HoldButton>
        </div>
      </div>
    </div>
  )
}

function TouchHelp() {
  return (
    <ul className="controls">
      <li><span><b>Gas / Brake</b></span> Pedals at the bottom right. Hold gas to speed up, let go to slow down</li>
      <li><span><b>Steer</b></span> Bottom left: hold ◀ ▶ to keep turning the wheel; let go and it returns to straight. LANE (above Gas): tap to centre in your lane, hold to stay in it</li>
      <li><span><b>Eye</b></span> Above the wheel: put a thumb on it and slide left or right to turn your head (up for the rear-view mirror). Or choose "Phone motion" in Settings and just move the phone to look around</li>
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

/** A small picture of a two-lane roundabout: the correct route (green) and the route you took (red, dashed). You enter from the bottom. */
function RbDiagram({ diag }: { diag: RbDiag }) {
  const path = (p: RbPath) => {
    const inner = p.lane === 'inner'
    const x = inner ? 111 : 129
    const R = inner ? 52 : 70
    const dy = Math.sqrt(R * R - 81)
    const a = `A${R},${R} 0 0 0`
    const start = `M${x},240 L${x},${120 + dy}`
    if (p.turn === 'right') return `${start} ${a} ${120 + dy},129 L240,129`
    if (p.turn === 'straight') return `${start} ${a} ${120 + R},120 ${a} 129,${120 - dy} L129,0`
    if (p.turn === 'left') return `${start} ${a} ${120 + R},120 ${a} 120,${120 - R} ${a} ${120 - dy},111 L0,111`
    return `${start} ${a} ${120 + R},120 ${a} 120,${120 - R} ${a} ${120 - R},120 ${a} 111,${120 + dy} L111,240`
  }
  const words = { right: '1st exit: right', straight: '2nd exit: straight on', left: '3rd exit: left', back: '4th exit: back' }
  const lane = (p: RbPath) => (p.lane === 'either' ? 'either lane' : `${p.lane} lane`)
  return (
    <figure className="rbdiag">
      <svg viewBox="0 0 240 240" width="200" height="200" role="img" aria-label="Roundabout diagram">
        <rect x="102" y="150" width="36" height="90" fill="#59606b" /><rect x="102" y="0" width="36" height="90" fill="#59606b" />
        <rect x="0" y="102" width="90" height="36" fill="#59606b" /><rect x="150" y="102" width="90" height="36" fill="#59606b" />
        <circle cx="120" cy="120" r="82" fill="#59606b" /><circle cx="120" cy="120" r="61" fill="none" stroke="#fff" strokeWidth="1.5" strokeDasharray="6 6" />
        <circle cx="120" cy="120" r="44" fill="#3f7a4b" />
        {diag.took && <path d={path(diag.took)} fill="none" stroke="#ef4444" strokeWidth="5" strokeDasharray="9 6" strokeLinecap="round" />}
        <path d={path(diag.correct)} fill="none" stroke="#22c55e" strokeWidth="5" strokeLinecap="round" />
        {[['1', 226, 124], ['2', 124, 14], ['3', 14, 124], ['4', 100, 232]].map(([t, x, y]) => <text key={t} x={x as number} y={y as number} fontSize="16" fontWeight="700" fill="#fff" textAnchor="middle">{t}</text>)}
        <text x="120" y="126" fontSize="12" fill="#fff" textAnchor="middle">you enter ↑</text>
      </svg>
      <figcaption>
        <span className="ok">Correct: {words[diag.correct.turn]}, {lane(diag.correct)}</span>
        {diag.took && <span className="bad">You: {words[diag.took.turn]}, {lane(diag.took)}</span>}
      </figcaption>
    </figure>
  )
}

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
        {(mode === 'highway' || mode === 'roundabout') && <div className="pts"><small>POINTS</small><b>{Math.floor(hud.score)}</b></div>}
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
  const diag = useGame((s) => s.crashDiag)
  const start = startGame
  const mode = useGame((s) => s.mode)
  const hud = useGame((s) => s.hud)
  const adjusting = useGame((s) => s.adjusting)
  const [adjSel, setAdjSel] = useState<'left' | 'center' | 'right' | null>(null)
  useEffect(() => { if (!adjusting) setAdjSel(null) }, [adjusting])
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
        <div className={'adjbar ' + (adjSel === 'center' ? 'low' : 'high')}>
          <span>{adjSel ? 'Arrow keys (or drag on the mirror) move its view. Shift = fine steps.' : 'Pick a mirror, then use the arrow keys or drag on it.'}</span>
          {(['left', 'center', 'right'] as const).map((k) => (
            <button key={k} className={'secondary' + (adjSel === k ? ' sel' : '')} onClick={() => { adjustMirror(k); setAdjSel(k) }}>
              {k === 'left' ? 'Left' : k === 'center' ? 'Rear-view' : 'Right'}
            </button>
          ))}
          <button className="primary" onClick={() => { adjustMirror(null); setAdjSel(null); useGame.setState({ adjusting: false }) }}>Done</button>
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
            {diag && <RbDiagram diag={diag} />}
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
