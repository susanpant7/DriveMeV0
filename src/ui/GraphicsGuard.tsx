import { Component, useEffect, useState, type ReactNode } from 'react'

const Screen = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="overlay" style={{ pointerEvents: 'auto', position: 'fixed', inset: 0, zIndex: 100 }}>
    <div className="panel">
      <h2>{title}</h2>
      <div style={{ textAlign: 'left', lineHeight: 1.55, fontSize: 14, color: '#c3d0e2' }}>{children}</div>
      <div className="actions">
        <button className="primary" onClick={() => location.reload()}>Reload</button>
        <button className="secondary" onClick={() => { location.search = '?lowfx' }}>Reload with lighter graphics</button>
      </div>
    </div>
  </div>
)

const Help = () => (
  <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
    <li>Close other tabs that use 3D or video, then reload.</li>
    <li>If the browser blocked the page, close this tab and open the address in a new one.</li>
    <li>Turn on graphics acceleration in the browser settings (Brave: Settings → System → “Use graphics acceleration when available”), then restart the browser.</li>
    <li>Try the lighter graphics button below.</li>
  </ul>
)

/** Catches a failed WebGL start-up (e.g. “Error creating WebGL context”) and shows what to do, instead of a black page. */
export class GraphicsBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) {
      return (
        <Screen title="The 3D view could not start">
          The browser refused to create a graphics (WebGL) context, which often happens after the page has been reloaded many times or when the GPU is busy.
          <Help />
        </Screen>
      )
    }
    return this.props.children
  }
}

/** Shows a message if the graphics context is lost while playing (GPU reset, tab sleep, memory pressure). */
export function ContextLostNotice() {
  const [lost, setLost] = useState(false)
  useEffect(() => {
    const onLost = (e: Event) => { e.preventDefault(); setLost(true) } // preventDefault lets the browser restore it
    const onBack = () => setLost(false)
    const attach = () => {
      const c = document.querySelector('canvas')
      if (!c) return false
      c.addEventListener('webglcontextlost', onLost)
      c.addEventListener('webglcontextrestored', onBack)
      return true
    }
    let t = 0
    if (!attach()) t = window.setInterval(() => { if (attach()) window.clearInterval(t) }, 500)
    return () => window.clearInterval(t)
  }, [])
  if (!lost) return null
  return (
    <Screen title="Graphics were interrupted">
      The browser paused the 3D view (the graphics card was reset or ran low on memory). It will try to recover by itself; if the screen stays black, reload.
      <Help />
    </Screen>
  )
}
