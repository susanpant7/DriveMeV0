import { useEffect, useState, type ReactNode } from 'react'
import { LIMIT, pauseGame, resumeGame, startGame } from '../game/sim'
import { setTraffic, setUnits, useGame } from '../game/store'

const Key = ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>

const TRAFFIC_LABELS = ['Very light', 'Light', 'Normal', 'Busy', 'Very busy']

function Settings() {
  const units = useGame((s) => s.units)
  const traffic = useGame((s) => s.traffic)
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
          <span>Traffic</span>
          <span className="muted">{TRAFFIC_LABELS[traffic - 1]}</span>
          <Key>1</Key>–<Key>5</Key>
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
      <li><span><Key>A</Key><Key>W</Key><Key>D</Key></span> Look: left mirror / rear-view / right mirror <em>(hold)</em></li>
      <li><span><Key>Esc</Key></span> Pause <span className="gap" /><Key>M</Key> mute</li>
    </ul>
  )
}

const MirrorIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path d="M5 7c0-1.7 1.3-3 3-3h8c1.7 0 3 1.3 3 3v6c0 1.7-1.3 3-3 3H8c-1.7 0-3-1.3-3-3z" fill="none" stroke="currentColor" strokeWidth="2" />
    <path d="M10 16v4M14 16v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
)

function PlayingHud() {
  const hud = useGame((s) => s.hud)
  const messages = useGame((s) => s.messages)
  const units = useGame((s) => s.units)
  const [help, setHelp] = useState(true)
  useEffect(() => {
    const t = setTimeout(() => setHelp(false), 15000)
    return () => clearTimeout(t)
  }, [])
  const speeding = hud.speed > LIMIT * 1.12
  const chip = (label: string, on: boolean, active: boolean) => (
    <span className={`chip${on ? ' on' : ''}${active ? ' active' : ''}`}><MirrorIcon />{label}</span>
  )
  return (
    <>
      <div className="tl">
        <div className="chips" title="Lights up when you have glanced at that mirror recently">
          {chip('Left', hud.checks.left, hud.look === 'left')}
          {chip('Rear', hud.checks.center, hud.look === 'center')}
          {chip('Right', hud.checks.right, hud.look === 'right')}
        </div>
        <div className="toasts">
          {messages.map((m) => (
            <div key={m.id} className={`toast ${m.kind}`}>{m.text}</div>
          ))}
        </div>
      </div>

      <div className="tr">
        <button className="icon-btn" onClick={pauseGame} aria-label="Pause (Esc)" title="Pause (Esc)">
          <svg viewBox="0 0 24 24" width="18" height="18"><rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" /></svg>
        </button>
      </div>

      <div className={`limit${speeding ? ' over' : ''}`} title="Speed limit">
        <small>SPEED<br />LIMIT</small>
        <b>{units === 'kmh' ? 50 : 30}</b>
      </div>

      <div className={`helpbar${help ? ' show' : ''}`}>
        <span><Key>↑</Key> go</span>
        <span><Key>↓</Key> brake</span>
        <span><Key>←</Key><Key>→</Key> steer</span>
        <span><Key>Q</Key><Key>E</Key> indicators</span>
        <span><Key>A</Key><Key>W</Key><Key>D</Key> mirrors</span>
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

  return (
    <div className="hud">
      {status === 'playing' && <PlayingHud />}

      {status === 'menu' && (
        <div className="overlay">
          <div className="panel wide">
            <header>
              <div className="logo">Drive<span>Me</span></div>
              <p>Learn to drive in a real city: lanes, traffic lights, junctions and roundabouts. Check your mirrors, signal, then move. A crash ends the run. Mistakes are flagged as you make them.</p>
            </header>
            <div className="cols">
              <section>
                <h3>Controls</h3>
                <ControlsList />
              </section>
              <section>
                <h3>Settings</h3>
                <Settings />
              </section>
            </div>
            <button className="primary" onClick={start}>Start driving <Key>Enter</Key></button>
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

      {status === 'paused' && pauseReason === 'user' && (
        <div className="overlay">
          <div className="panel">
            <h2>Paused</h2>
            <Settings />
            <div className="actions">
              <button className="primary" onClick={resumeGame}>Resume <Key>Esc</Key></button>
              <button className="secondary" onClick={start}>Restart <Key>R</Key></button>
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
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
