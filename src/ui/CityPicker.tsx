import { useEffect, useState } from 'react'
import { useGame } from '../game/store'
import { cancelDownload, chooseCity, chooseGrid, PRESETS } from '../real/loader'
import { deleteSaved, geocode, isLeftHand, savedList, type Place } from '../real/osm'

const Spinner = () => <span className="spinner" aria-hidden="true" />

/** Choose where to drive: the practice city, or a real place that is downloaded from OpenStreetMap and saved on this device. */
export function CityPicker() {
  const world = useGame((s) => s.world)
  const realName = useGame((s) => s.realName)
  const dl = useGame((s) => s.dl)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Place[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState<Array<{ id: string; name: string }>>([])
  const [tab, setTab] = useState<'grid' | 'real'>(world)
  const working = dl.phase === 'connecting' || dl.phase === 'downloading' || dl.phase === 'processing'

  useEffect(() => { void savedList().then(setSaved) }, [dl.phase])

  const search = async () => {
    if (q.trim().length < 2) return
    setBusy(true)
    setErr('')
    try {
      const r = await geocode(q.trim())
      setResults(r)
      if (!r.length) setErr('No place found. Try a city or a neighbourhood name.')
    } catch (e) {
      setErr((e as Error).message || 'Search failed')
    } finally { setBusy(false) }
  }

  return (
    <div className="citypicker">
      <div className="seg" role="tablist" aria-label="World">
        <button role="tab" aria-selected={tab === 'grid'} className={tab === 'grid' ? 'on' : ''} onClick={() => { setTab('grid'); chooseGrid() }}>Practice city</button>
        <button role="tab" aria-selected={tab === 'real'} className={tab === 'real' ? 'on' : ''} onClick={() => setTab('real')}>Real city</button>
      </div>

      {tab === 'grid' && <p className="muted small">A built-in city made for practice: lanes, signals, junctions and roundabouts.</p>}

      {tab === 'real' && (
        <div className="real">
          <form className="search" onSubmit={(e) => { e.preventDefault(); void search() }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a city or neighbourhood…" aria-label="Search a place" />
            <button type="submit" className="secondary" disabled={busy || working}>{busy ? <Spinner /> : 'Search'}</button>
          </form>
          {err && <div className="note warn">{err}</div>}

          {results.length > 0 && (
            <ul className="places">
              {results.map((p) => {
                const left = isLeftHand(p.country)
                return (
                  <li key={p.id}>
                    <span>{p.name}</span>
                    {left ? <em>Left-hand traffic isn’t supported yet</em> : <button className="mini" disabled={working} onClick={() => void chooseCity(p)}>Download &amp; drive</button>}
                  </li>
                )
              })}
            </ul>
          )}

          <div className="chips2">
            {PRESETS.map((p) => (
              <button key={p.id} className="chip2" disabled={working} onClick={() => void chooseCity(p)}>{p.name}</button>
            ))}
          </div>

          {saved.length > 0 && (
            <div className="saved">
              <h4>Saved on this device</h4>
              <ul className="places">
                {saved.map((c) => (
                  <li key={c.id}>
                    <span>{c.name}</span>
                    <span>
                      <button className="mini" disabled={working} onClick={() => void chooseCity({ id: c.id, name: c.name, lat: 0, lon: 0, country: 'us' })}>Use</button>
                      <button className="mini ghost" disabled={working} onClick={() => { void deleteSaved(c.id).then(() => savedList().then(setSaved)) }}>Remove</button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {dl.phase !== 'idle' && (
            <div className={`status ${dl.phase}`}>
              {working && <Spinner />}
              <div>
                <b>{dl.phase === 'done' ? `Ready: ${realName}` : dl.phase === 'error' ? 'Could not load the map' : `Getting ${dl.place}`}</b>
                <span>{dl.message}</span>
              </div>
              {working && <button className="mini ghost" onClick={cancelDownload}>Cancel</button>}
            </div>
          )}
          <p className="muted small">Maps come from OpenStreetMap, downloaded once and kept on this device. Cities that drive on the left aren’t supported yet.</p>
        </div>
      )}
    </div>
  )
}
