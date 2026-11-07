import type { CityData } from './graph'
import { parseOverpass } from './parse'

/** Countries that drive on the left: not supported yet (the game drives on the right). */
const LEFT_HAND = new Set(['gb', 'ie', 'au', 'nz', 'jp', 'in', 'za', 'th', 'id', 'my', 'sg', 'hk', 'pk', 'bd', 'lk', 'ke', 'tz', 'mt', 'cy'])

export interface Place { id: string; name: string; lat: number; lon: number; country: string }
export interface DownloadState { phase: 'idle' | 'connecting' | 'downloading' | 'processing' | 'done' | 'error'; message: string; attempt: number }

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)

export async function geocode(query: string): Promise<Place[]> {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(query)}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Search failed (${res.status})`)
  const list = (await res.json()) as Array<{ display_name: string; lat: string; lon: string; address?: { country_code?: string } }>
  return list.map((r) => ({
    id: slug(r.display_name.split(',').slice(0, 3).join(' ')) + '-' + Math.round(Number(r.lat) * 100),
    name: r.display_name.split(',').slice(0, 3).join(',').trim(),
    lat: Number(r.lat),
    lon: Number(r.lon),
    country: (r.address?.country_code ?? '').toLowerCase(),
  }))
}

export const isLeftHand = (country: string) => LEFT_HAND.has(country)

export function bboxAround(lat: number, lon: number, halfMetres = 550) {
  const dLat = halfMetres / 111320
  const dLon = halfMetres / (111320 * Math.cos((lat * Math.PI) / 180))
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon]
}

const HIGHWAYS = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link'
const MIRRORS = ['https://lz4.overpass-api.de/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']

/** Downloads a map patch (several servers, several tries) and returns it parsed. */
export async function downloadCity(place: Place, onState: (s: DownloadState) => void, signal?: AbortSignal): Promise<CityData> {
  const bbox = bboxAround(place.lat, place.lon)
  const box = bbox.map((v) => v.toFixed(5)).join(',')
  const query = `[out:json][timeout:90];(way["highway"~"^(${HIGHWAYS})$"](${box});node["highway"="traffic_signals"](${box});node["highway"="stop"](${box});node["highway"="crossing"](${box});way["building"](${box}););out body geom;`
  let last = ''
  for (let attempt = 1; attempt <= 6; attempt++) {
    for (const url of MIRRORS) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
      onState({ phase: 'connecting', message: `Asking the map server${attempt > 1 ? ` (try ${attempt})` : ''}…`, attempt })
      try {
        const ctl = new AbortController()
        const timer = setTimeout(() => ctl.abort(), 150000)
        signal?.addEventListener('abort', () => ctl.abort(), { once: true })
        const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: ctl.signal })
        if (!res.ok) { clearTimeout(timer); last = `Server busy (${res.status})`; continue }
        onState({ phase: 'downloading', message: 'Downloading roads and buildings…', attempt })
        const raw = await res.json()
        clearTimeout(timer)
        onState({ phase: 'processing', message: 'Building the city…', attempt })
        await new Promise((r) => setTimeout(r, 30)) // let the UI paint
        const hand = isLeftHand(place.country) ? 'left' : 'right'
        const city = parseOverpass(raw, place.id, place.name, bbox, hand)
        if (city.roads.length < 5) throw new Error('No drivable roads found here. Try a nearby town or city centre.')
        return city
      } catch (err) {
        if ((err as Error).name === 'AbortError' && signal?.aborted) throw err
        last = (err as Error).message || 'Network error'
        if (/No drivable/.test(last)) throw err
      }
    }
    onState({ phase: 'connecting', message: `${last}. Retrying…`, attempt })
    await new Promise((r) => setTimeout(r, 4000))
  }
  throw new Error(`Could not download the map (${last}). Try again in a minute.`)
}

/* ---------------- cache (IndexedDB), so a city is only downloaded once ---------------- */
const DB = 'driveme-cities'
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore('cities')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
export async function saveCity(city: CityData) {
  try {
    const d = await db()
    await new Promise<void>((res, rej) => { const tx = d.transaction('cities', 'readwrite'); tx.objectStore('cities').put(city, city.id); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error) })
  } catch { /* private mode: just don't cache */ }
}
export async function loadSaved(id: string): Promise<CityData | null> {
  try {
    const d = await db()
    return await new Promise((res) => { const r = d.transaction('cities').objectStore('cities').get(id); r.onsuccess = () => res((r.result as CityData) ?? null); r.onerror = () => res(null) })
  } catch { return null }
}
export async function savedList(): Promise<Array<{ id: string; name: string }>> {
  try {
    const d = await db()
    return await new Promise((res) => { const r = d.transaction('cities').objectStore('cities').getAll(); r.onsuccess = () => res((r.result as CityData[]).map((c) => ({ id: c.id, name: c.name }))); r.onerror = () => res([]) })
  } catch { return [] }
}
export async function deleteSaved(id: string) {
  try {
    const d = await db()
    await new Promise<void>((res) => { const tx = d.transaction('cities', 'readwrite'); tx.objectStore('cities').delete(id); tx.oncomplete = () => res() })
  } catch { /* ignore */ }
}
