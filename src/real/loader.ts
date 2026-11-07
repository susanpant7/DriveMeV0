import { useGame } from '../game/store'
import type { CityData } from './graph'
import { downloadCity, loadSaved, saveCity, type DownloadState, type Place } from './osm'
import { enterRealCity, leaveRealCity } from './world'

export const PRESETS: Place[] = [
  { id: 'palo-alto', name: 'Palo Alto, California', lat: 37.4464, lon: -122.159, country: 'us' },
  { id: 'austin-downtown', name: 'Downtown Austin, Texas', lat: 30.2689, lon: -97.7431, country: 'us' },
  { id: 'boston-back-bay', name: 'Back Bay, Boston', lat: 42.3503, lon: -71.081, country: 'us' },
  { id: 'seattle-capitol-hill', name: 'Capitol Hill, Seattle', lat: 47.6235, lon: -122.3205, country: 'us' },
  { id: 'chicago-loop', name: 'The Loop, Chicago', lat: 41.8819, lon: -87.6278, country: 'us' },
  { id: 'san-diego-downtown', name: 'Downtown San Diego', lat: 32.7157, lon: -117.1611, country: 'us' },
  { id: 'paris-marais', name: 'Le Marais, Paris', lat: 48.8575, lon: 2.3622, country: 'fr' },
  { id: 'berlin-mitte', name: 'Mitte, Berlin', lat: 52.5208, lon: 13.4094, country: 'de' },
]

let controller: AbortController | null = null
const setDl = (s: Partial<ReturnType<typeof useGame.getState>['dl']>) => useGame.setState((g) => ({ dl: { ...g.dl, ...s } }))

/** Is a map file shipped with the game for this id? (works offline) */
async function bundled(id: string): Promise<CityData | null> {
  try {
    const res = await fetch(`/cities/${id}.json`)
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null
    return (await res.json()) as CityData
  } catch { return null }
}

/** Gets the map (saved copy, bundled copy, or a fresh download) and makes it the world to drive in. */
export async function chooseCity(place: Place) {
  controller?.abort()
  controller = new AbortController()
  const { signal } = controller
  setDl({ phase: 'connecting', message: 'Looking for a saved copy…', place: place.name })
  try {
    let city = (await loadSaved(place.id)) ?? (await bundled(place.id))
    if (!city) {
      city = await downloadCity(place, (s: DownloadState) => setDl({ phase: s.phase, message: s.message }), signal)
      await saveCity(city)
    }
    setDl({ phase: 'processing', message: 'Building the city…' })
    await new Promise((r) => setTimeout(r, 30))
    enterRealCity(city)
    useGame.setState({ world: 'real', realName: city.name })
    setDl({ phase: 'done', message: `${city.roads.length} roads · ${city.buildings.length} buildings · ${city.signals.length} traffic lights` })
  } catch (err) {
    if ((err as Error).name === 'AbortError') { setDl({ phase: 'idle', message: '' }); return }
    setDl({ phase: 'error', message: (err as Error).message || 'Something went wrong' })
  }
}

export function cancelDownload() {
  controller?.abort()
  controller = null
  setDl({ phase: 'idle', message: '' })
}

export function chooseGrid() {
  controller?.abort()
  leaveRealCity()
  useGame.setState({ world: 'grid', realName: '' })
  setDl({ phase: 'idle', message: '' })
}
