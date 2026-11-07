import type { CityData, RawBuilding, RawRoad } from './graph'

/** Overpass element as returned with `out body geom`. */
interface OEl {
  type: 'node' | 'way'
  id: number
  lat?: number
  lon?: number
  nodes?: number[]
  geometry?: Array<{ lat: number; lon: number }>
  tags?: Record<string, string>
}

const MAX_BUILDINGS = 3500

/** Turns raw Overpass JSON into the compact city format (local metres: x east, z south, origin at the centre of the box). */
export function parseOverpass(raw: { elements: OEl[] }, id: string, name: string, bbox: number[], hand: 'right' | 'left'): CityData {
  const lat0 = (bbox[0] + bbox[2]) / 2
  const lon0 = (bbox[1] + bbox[3]) / 2
  const R = 6378137
  const kx = (Math.PI / 180) * R * Math.cos((lat0 * Math.PI) / 180)
  const kz = (Math.PI / 180) * R
  const proj = (lat: number, lon: number): [number, number] => [Math.round((lon - lon0) * kx * 10) / 10, Math.round(-(lat - lat0) * kz * 10) / 10]

  const nodes: Record<string, [number, number]> = {}
  const roads: RawRoad[] = []
  let buildings: RawBuilding[] = []
  const signals = new Set<number>()
  const stops = new Set<number>()
  const crossings = new Set<number>()
  const speed = (v: string) => (/mph/.test(v) ? parseFloat(v) * 1.609 : parseFloat(v))

  for (const el of raw.elements) {
    const t = el.tags ?? {}
    if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) {
      const hw = t.highway
      if (hw === 'traffic_signals') signals.add(el.id)
      else if (hw === 'stop') stops.add(el.id)
      else if (hw === 'crossing') crossings.add(el.id)
      else continue
      nodes[el.id] = proj(el.lat, el.lon)
    } else if (el.type === 'way' && t.highway && el.geometry && el.nodes) {
      el.nodes.forEach((nid, i) => { nodes[nid] = proj(el.geometry![i].lat, el.geometry![i].lon) })
      const oneway = t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout' ? 1 : t.oneway === '-1' ? -1 : undefined
      const ms = t.maxspeed ? speed(t.maxspeed) : undefined
      roads.push({
        h: t.highway,
        n: t.name || undefined,
        l: t.lanes ? Number(t.lanes) || undefined : undefined,
        o: oneway,
        v: ms && !Number.isNaN(ms) ? Math.round(ms) : undefined,
        r: t.junction === 'roundabout' ? 1 : undefined,
        k: el.nodes,
      })
    } else if (el.type === 'way' && t.building && el.geometry) {
      const levels = Number(t['building:levels']) || undefined
      const height = Number(String(t.height ?? '').replace(/[^0-9.]/g, '')) || undefined
      const pts = el.geometry.slice(0, -1).flatMap((g) => proj(g.lat, g.lon))
      if (pts.length >= 6) buildings.push({ h: Math.round((height ?? (levels ? levels * 3.2 : 7 + (el.id % 5))) * 10) / 10, p: pts })
    }
  }
  // keep the buildings nearest the centre if the area is very dense
  if (buildings.length > MAX_BUILDINGS) {
    const c = (b: RawBuilding) => Math.hypot(b.p[0], b.p[1])
    buildings = buildings.sort((a, b) => c(a) - c(b)).slice(0, MAX_BUILDINGS)
  }
  const [xm, zm] = proj(bbox[2], bbox[3])
  return {
    id, name, hand, bbox, origin: [lat0, lon0], size: [Math.round(Math.abs(xm) * 2), Math.round(Math.abs(zm) * 2)],
    nodes, roads, signals: [...signals], stops: [...stops], crossings: [...crossings], buildings,
    attribution: 'Map data (c) OpenStreetMap contributors, ODbL',
  }
}
