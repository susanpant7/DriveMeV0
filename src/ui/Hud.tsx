import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { gasTapFn, setMotionLook, steerTap } from '../game/input'
import { MODES, type Mode } from '../game/nav'
import { TRAFFIC_CITY, TRAFFIC_RES, adjustMirror, goMenu, input, pauseGame, resumeGame, startGame, toggleSignal } from '../game/sim'
import type { RbDiag, RbPath } from '../game/store'
import { setMirrorLite, setGraphics, setViewOffset, setLookMode, setMode, setMotionSens, setSteerSens, setTraffic, setUnits, useGame } from '../game/store'
import { MapOverlay } from './MapOverlay'
import { EyeControl } from './TouchPad'
import { useViewport } from './useViewport'

const Key = ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>

const TRAFFIC_LABELS = ['Very light', 'Light', 'Normal', 'Busy', 'Very busy']

/** the ⓘ button beside a setting's name */
function InfoTip({ id, open, onToggle }: { id: string; open: boolean; onToggle: (v: string | null) => void }) {
  return <button type="button" className={`infotip${open ? ' on' : ''}`} aria-label={`About ${id}`} aria-expanded={open} onClick={() => onToggle(open ? null : id)}>i</button>
}
const SETTING_INFO: Record<string, string> = {"Speed units": "Shows speeds and limits in miles per hour or kilometres per hour. The rules are the same either way: the limits on the signs and on the centre screen change with this. (Keyboard: U)", "Phone motion": "On: move the phone to look around, like looking through a window: turn it left or right to turn your head, tilt it up for the rear-view mirror. The eye icon still works as well and adds to it. Press the car's centre screen to make wherever the phone points 'straight ahead' again. Turning well to one side counts as a blind-spot check.", "Phone motion sensitivity": "How far your view turns for a given movement of the phone. 1 needs a big movement, 5 only a small one. 3 is the standard. Only used when Phone motion is on.", "Steering sensitivity": "How quickly the steering wheel turns while you hold left or right. Lower is gentler and easier to keep straight; higher turns sharply for tight corners. The wheel returns to straight when you let go.", "Graphics": "How much drawing work each frame does. High: best look (sharpest picture and mirrors, all screen effects, see furthest). Medium: balanced (a little softer, lighter effects, the rear-view mirror refreshes every other frame). Low: smoothest (plain picture, mirrors refresh every other frame, shorter view). Roads, signs, signals, traffic and the rules are the same at every level. The game also lowers the sharpness by itself for a moment if the frame rate drops.", "Mirror detail": "Full: the mirrors show everything, as far back as you can see ahead, at full sharpness. Light: the mirrors only draw about 200 m behind you, skip small road-wear details and are slightly softer; cars, lane markings, signs and lights are still shown. Use Light if the game stutters: it is the setting that gives the most smoothness back.", "Traffic": "How many other cars there are. The same level means different amounts in different places, as in real life: quiet residential streets, busier city roads, and the most on the highway. On the Mixed course it changes as you drive from one district to another. (Keyboard: 1 to 5)"}

function Settings() {
  const [info, setInfo] = useState<string | null>(null)
  const traffic = useGame((s) => s.traffic)
  const units = useGame((s) => s.units)
  const steerSens = useGame((s) => s.steerSens)
  const lookMode = useGame((s) => s.lookMode)
  const motionSens = useGame((s) => s.motionSens)
  const graphics = useGame((s) => s.graphics)
  const mirrorLite = useGame((s) => s.mirrorLite)
  const { touch } = useViewport()
  return (
    <div className="settings">
      {info && (
        <div className="infobox" role="note">
          <div className="infobox-head"><b>{info}</b><button type="button" aria-label="Close" onClick={() => setInfo(null)}>×</button></div>
          <p>{SETTING_INFO[info]}</p>
        </div>
      )}
      <div className="setting">
        <div className="setting-head">
          <span className="setlabel">Speed units<InfoTip id="Speed units" open={info === 'Speed units'} onToggle={setInfo} /></span>
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
            <span className="setlabel">Phone motion<InfoTip id="Phone motion" open={info === 'Phone motion'} onToggle={setInfo} /></span>
            <span className="muted">{lookMode === 'motion' ? 'Move the phone to look (the eye icon works too)' : 'Off: look with the eye icon'}</span>
          </div>
          <div className="seg" role="group" aria-label="Phone motion">
            <button className={lookMode === 'eye' ? 'on' : ''} onClick={() => setLookMode('eye')}>Off</button>
            <button className={lookMode === 'motion' ? 'on' : ''} onClick={async () => { if (await setMotionLook(true)) setLookMode('motion') }}>On</button>
          </div>
        </div>
      )}
      {touch && (
        <div className="setting">
          <div className="setting-head">
            <span className="setlabel">Phone motion sensitivity<InfoTip id="Phone motion sensitivity" open={info === 'Phone motion sensitivity'} onToggle={setInfo} /></span>
            <span className="muted">{lookMode === 'motion' ? ['Very low', 'Low', 'Medium', 'High', 'Very high'][motionSens - 1] : 'Used with Phone motion'}</span>
          </div>
          <div className="seg" role="group" aria-label="Phone motion sensitivity">
            {([1, 2, 3, 4, 5] as const).map((n) => (
              <button key={n} className={motionSens === n ? 'on' : ''} onClick={() => setMotionSens(n)}>{n}</button>
            ))}
          </div>
        </div>
      )}
      <div className="setting">
        <div className="setting-head">
          <span className="setlabel">Steering sensitivity<InfoTip id="Steering sensitivity" open={info === 'Steering sensitivity'} onToggle={setInfo} /></span>
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
          <span className="setlabel">Graphics<InfoTip id="Graphics" open={info === 'Graphics'} onToggle={setInfo} /></span>
          <span className="muted">{graphics === 'high' ? 'Best look' : graphics === 'medium' ? 'Balanced' : 'Smoothest'}</span>
        </div>
        <div className="seg" role="group" aria-label="Graphics quality">
          {(['high', 'medium', 'low'] as const).map((g) => (
            <button key={g} className={graphics === g ? 'on' : ''} onClick={() => setGraphics(g)}>{g === 'high' ? 'High' : g === 'medium' ? 'Medium' : 'Low'}</button>
          ))}
        </div>
      </div>
      <div className="setting">
        <div className="setting-head">
          <span className="setlabel">Mirror detail<InfoTip id="Mirror detail" open={info === 'Mirror detail'} onToggle={setInfo} /></span>
          <span className="muted">{mirrorLite ? 'Light: smoother; about 200 m behind, no road wear' : 'Full: sharpest, shows everything'}</span>
        </div>
        <div className="seg" role="group" aria-label="Mirror detail">
          <button className={!mirrorLite ? 'on' : ''} onClick={() => setMirrorLite(false)}>Full</button>
          <button className={mirrorLite ? 'on' : ''} onClick={() => setMirrorLite(true)}>Light</button>
        </div>
      </div>
      <div className="setting">
        <div className="setting-head">
          <span className="setlabel">Traffic<InfoTip id="Traffic" open={info === 'Traffic'} onToggle={setInfo} /></span>
          <span className="muted" title="Cars around you at this level, by where you drive">{TRAFFIC_LABELS[traffic - 1]} · about {TRAFFIC_RES[traffic - 1]} cars in a residential area, {TRAFFIC_CITY[traffic - 1]} in the city, {[24, 46, 68, 90, 115][traffic - 1]} on the highway</span>
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
      <li><span><Key>↓</Key></span> Brake <em>like a real pedal: a tap slows you gently; the longer you hold it, the harder it brakes (firm after about a second, an emergency stop after about two)</em></li>
      <li><span><Key>←</Key><Key>→</Key></span> Steer <em>hold to keep turning the wheel; let go and it returns to straight. <Key>Space</Key> centres the view and eases the car into the middle of its lane; hold it and the car stays in the middle of its lane, even round bends and roundabouts</em></li>
      <li><span><Key>Q</Key><Key>E</Key></span> Left / right indicator <em>press the same one again to switch it off; it also switches itself off when you steer the other way (the right one when you steer left of straight, the left one when you steer right)</em></li>
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
          <EyeControl />
        </div>
        <div className="steerline">
          <div className="steerrow">
            <HoldButton label="Steer left" className="steer" onDown={() => { input.left = true; steerTap(-1) }} onUp={() => { input.left = false }}><Chev dir={-1} /></HoldButton>
            <HoldButton label="Steer right" className="steer" onDown={() => { input.right = true; steerTap(1) }} onUp={() => { input.right = false }}><Chev dir={1} /></HoldButton>
          </div>
          {/* the indicators, beside the steering: left above, right below */}
          <div className="sigcol">
            <HoldButton label="Left indicator" className={`sig${signal === -1 ? ' blink' : ''}`} active={signal === -1} onDown={() => toggleSignal(-1)} onUp={() => {}}><TurnArrow dir={-1} /></HoldButton>
            <HoldButton label="Right indicator" className={`sig${signal === 1 ? ' blink' : ''}`} active={signal === 1} onDown={() => toggleSignal(1)} onUp={() => {}}><TurnArrow dir={1} /></HoldButton>
          </div>
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

/** Mixed course: a short black card while the scene changes between the town and the highway */
function FadeCard() {
  const fade = useGame((s) => s.fade)
  if (!fade) return null
  return (
    <div key={fade.id} className="fadecard" aria-live="polite">
      <b>{fade.text}</b>
      <span>{fade.sub}</span>
    </div>
  )
}

/** Set your default view: drag anywhere (finger or mouse) to turn and tilt the resting view; it is saved for next time. */
function ViewAdjust() {
  const vo = useGame((s) => s.viewOffset)
  const last = useRef<{ x: number; y: number } | null>(null)
  const clampV = (v: { yaw: number; pitch: number }) => ({ yaw: Math.max(-0.5, Math.min(0.5, v.yaw)), pitch: Math.max(-0.35, Math.min(0.35, v.pitch)) })
  return (
    <>
      <div
        className="viewdrag"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); last.current = { x: e.clientX, y: e.clientY } }}
        onPointerMove={(e) => {
          if (!last.current) return
          const dx = e.clientX - last.current.x, dy = e.clientY - last.current.y
          last.current = { x: e.clientX, y: e.clientY }
          const cur = useGame.getState().viewOffset
          // drag the view like a picture: drag left to look further right, down to look up
          setViewOffset(clampV({ yaw: cur.yaw + dx * 0.0025, pitch: cur.pitch + dy * 0.0025 }), false)
        }}
        onPointerUp={() => { last.current = null; setViewOffset(useGame.getState().viewOffset) }}
        onPointerCancel={() => { last.current = null }}
      />
      <div className="adjbar high viewbar">
        <span>Drag anywhere to aim your normal view ahead.</span>
        <small className="muted">{Math.round((vo.yaw * 180) / Math.PI)}° · {Math.round((vo.pitch * 180) / Math.PI)}°</small>
        <button className="secondary" onClick={() => setViewOffset({ yaw: 0, pitch: 0 })}>Reset</button>
        <button className="primary" onClick={() => { setViewOffset(useGame.getState().viewOffset); useGame.setState({ viewAdjusting: false }) }}>Done</button>
      </div>
    </>
  )
}

function TouchHelp() {
  return (
    <ul className="controls">
      <li><span><b>Gas / Brake</b></span> Pedals at the bottom right. Hold gas to speed up, let go to slow down. The brake gets stronger the longer you hold it: tap for a gentle stop</li>
      <li><span><b>Steer</b></span> Bottom left: hold ◀ ▶ to keep turning the wheel; let go and it returns to straight. LANE (above Gas): tap to centre in your lane, hold to stay in it</li>
      <li><span><b>Eye</b></span> Above the steering: put a thumb on it and slide left or right to turn your head (all the way for the blind spot, up for the rear-view mirror). With Phone motion on in Settings you can also move the phone; press the centre screen to recentre</li>
      <li><span><b>⬅ ➡</b></span> Right of the steering: left indicator (top) and right indicator (bottom). Tap to switch on, tap again to switch off; it also goes off when you steer the other way</li>
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
  const open = diag.open ?? (['right', 'straight', 'left', 'back'] as const)
  const ORD = ['1st', '2nd', '3rd', '4th']
  const DIR = { right: 'right', straight: 'straight on', left: 'left', back: 'back the way you came' }
  const no = (t: RbPath['turn']) => Math.max(0, open.indexOf(t)) + 1
  const words = (t: RbPath['turn']) => `${ORD[no(t) - 1]} exit: ${DIR[t]}`
  const has = (t: RbPath['turn']) => open.includes(t)
  const lane = (p: RbPath) => (p.lane === 'either' ? 'either lane' : `${p.lane} lane`)
  return (
    <figure className="rbdiag">
      <svg viewBox="0 0 240 240" width="200" height="200" role="img" aria-label="Roundabout diagram">
        <rect x="102" y="150" width="36" height="90" fill="#59606b" />{has('straight') && <rect x="102" y="0" width="36" height="90" fill="#59606b" />}
        {has('left') && <rect x="0" y="102" width="90" height="36" fill="#59606b" />}{has('right') && <rect x="150" y="102" width="90" height="36" fill="#59606b" />}
        <circle cx="120" cy="120" r="82" fill="#59606b" /><circle cx="120" cy="120" r="61" fill="none" stroke="#fff" strokeWidth="1.5" strokeDasharray="6 6" />
        <circle cx="120" cy="120" r="44" fill="#3f7a4b" />
        {diag.took && <path d={path(diag.took)} fill="none" stroke="#ef4444" strokeWidth="5" strokeDasharray="9 6" strokeLinecap="round" />}
        <path d={path(diag.correct)} fill="none" stroke="#22c55e" strokeWidth="5" strokeLinecap="round" />
        {([['right', 226, 124], ['straight', 124, 14], ['left', 14, 124], ['back', 100, 232]] as const).filter(([t]) => has(t)).map(([t, x, y]) => <text key={t} x={x} y={y} fontSize="16" fontWeight="700" fill="#fff" textAnchor="middle">{no(t)}</text>)}
        <text x="120" y="126" fontSize="12" fill="#fff" textAnchor="middle">you enter ↑</text>
      </svg>
      <figcaption>
        <span className="ok">Correct: {words(diag.correct.turn)}, {lane(diag.correct)}</span>
        {diag.took && <span className="bad">You: {words(diag.took.turn)}, {lane(diag.took)}</span>}
      </figcaption>
    </figure>
  )
}

function PlayingHud() {
  const hud = useGame((s) => s.hud)
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
        <div className={`pts${hud.score < 0 ? ' neg' : ''}`} title="+2 for every rule followed, −2 for every mistake"><small>POINTS</small><b>{Math.round(hud.score)}</b></div>
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
  const finalScore = useGame((s) => s.hud.score)
  const report = useGame((s) => s.report)
  const reportPts = useGame((s) => s.reportPoints)
  const start = startGame
  const mode = useGame((s) => s.mode)
  const hud = useGame((s) => s.hud)
  const adjusting = useGame((s) => s.adjusting)
  const viewAdjusting = useGame((s) => s.viewAdjusting)
  const [adjSel, setAdjSel] = useState<'left' | 'center' | 'right' | null>(null)
  useEffect(() => { if (!adjusting) setAdjSel(null) }, [adjusting])
  const { touch, portrait } = useViewport()

  // phones and tablets play in landscape: pause and ask for a rotation
  useEffect(() => {
    if (touch && portrait && status === 'playing') pauseGame()
  }, [touch, portrait, status])

  return (
    <div className={`hud${touch ? ' touch' : ''}`}>
      <FadeCard />
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
              <div className="logo">Hello <span>Driving</span></div>
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

      {status === 'paused' && pauseReason === 'user' && viewAdjusting && <ViewAdjust />}

      {status === 'paused' && pauseReason === 'user' && !adjusting && !viewAdjusting && (
        <div className="overlay">
          <div className="panel">
            <h2>Paused</h2>
            <p className="sub">{modeTitle(mode)} · {hud.errors} {hud.errors === 1 ? 'mistake' : 'mistakes'} so far</p>
            <Settings />
            <div className="actions">
              <button className="primary" onClick={resumeGame}>Resume <Key>Esc</Key></button>
              <button className="secondary" onClick={start}>Restart <Key>R</Key></button>
              <button className="secondary" onClick={() => useGame.setState({ adjusting: true })}>Adjust mirrors</button>
              <button className="secondary" onClick={() => { adjustMirror(null); useGame.setState({ viewAdjusting: true }) }}>Set default view</button>
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
            <p className="finalpts">Points this drive: <b>{Math.round(finalScore)}</b> <span className="muted">(+{reportPts.gained} for rules followed, −{reportPts.lost} for mistakes)</span></p>
            <div className="report">
              <h3>Mistakes this drive</h3>
              {report.length === 0 ? <p className="muted">None: every rule was followed until the end.</p> : (
                <ul>
                  {report.map((r) => <li key={r.text}><span>{r.text}</span>{r.count > 1 && <b>×{r.count}</b>}</li>)}
                </ul>
              )}
            </div>
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
