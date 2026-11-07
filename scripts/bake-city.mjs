#!/usr/bin/env node
/**
 * Downloads a patch of OpenStreetMap and bakes it into a compact JSON file the game loads (public/cities/<id>.json).
 *   node scripts/bake-city.mjs <id> "<Display name>" <south> <west> <north> <east> [--hand=right|left] [--input=raw.json]
 * Run once per city; the game never talks to OpenStreetMap while you play. Data (c) OpenStreetMap contributors (ODbL).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const [id, name, s, w, n, e, ...flags] = process.argv.slice(2)
if (!id || !e) {
  console.error('usage: node scripts/bake-city.mjs <id> "<name>" <south> <west> <north> <east> [--hand=right|left] [--input=raw.json]')
  process.exit(1)
}
const opt = Object.fromEntries(flags.map((f) => f.replace(/^--/, '').split('=')))
const bbox = [s, w, n, e].map(Number)
const hand = opt.hand === 'left' ? 'left' : 'right'
const box = bbox.join(',')
const HIGHWAYS = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link'
const query = `[out:json][timeout:90];(way["highway"~"^(${HIGHWAYS})$"](${box});node["highway"="traffic_signals"](${box});node["highway"="stop"](${box});node["highway"="crossing"](${box});way["building"](${box}););out body geom;`
const MIRRORS = ['https://lz4.overpass-api.de/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']

async function download() {
  for (let attempt = 0; attempt < 6; attempt++) {
    for (const url of MIRRORS) {
      try {
        console.log(`fetching ${url} (attempt ${attempt + 1})`)
        const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(query), headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'driveme-baker/0.1 (driving practice game)' }, signal: AbortSignal.timeout(240000) })
        if (res.ok) return await res.json()
        console.log('  ->', res.status)
      } catch (err) {
        console.log('  ->', String(err.message ?? err).slice(0, 80))
      }
    }
    await new Promise((r) => setTimeout(r, 8000))
  }
  throw new Error('no Overpass server answered')
}

const raw = opt.input && existsSync(opt.input) ? JSON.parse(readFileSync(opt.input, 'utf8')) : await download()

// equirectangular projection around the centre of the box: x = east, z = south, metres
const lat0 = (bbox[0] + bbox[2]) / 2
const lon0 = (bbox[1] + bbox[3]) / 2
const R = 6378137
const kx = (Math.PI / 180) * R * Math.cos((lat0 * Math.PI) / 180)
const kz = (Math.PI / 180) * R
const proj = (lat, lon) => [Math.round((lon - lon0) * kx * 10) / 10, Math.round(-(lat - lat0) * kz * 10) / 10]

const nodes = {}
const roads = []
const buildings = []
const signals = new Set()
const stops = new Set()
const crossings = new Set()
const mph = (v) => (/mph/.test(v) ? parseFloat(v) * 1.609 : parseFloat(v))

for (const el of raw.elements) {
  const t = el.tags ?? {}
  if (el.type === 'node') {
    const [x, z] = proj(el.lat, el.lon)
    if (t.highway === 'traffic_signals') { signals.add(el.id); nodes[el.id] = [x, z] }
    else if (t.highway === 'stop') { stops.add(el.id); nodes[el.id] = [x, z] }
    else if (t.highway === 'crossing') { crossings.add(el.id); nodes[el.id] = [x, z] }
  } else if (el.type === 'way' && t.highway && el.geometry && el.nodes) {
    el.nodes.forEach((nid, i) => { nodes[nid] = proj(el.geometry[i].lat, el.geometry[i].lon) })
    const oneway = t.oneway === 'yes' || t.oneway === '1' || t.junction === 'roundabout' ? 1 : t.oneway === '-1' ? -1 : 0
    const ms = t.maxspeed ? mph(t.maxspeed) : undefined
    roads.push({
      h: t.highway,
      n: t.name || undefined,
      l: t.lanes ? Number(t.lanes) || undefined : undefined,
      o: oneway || undefined,
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

const { south, west } = { south: bbox[0], west: bbox[1] }
const [xMax, zMax] = proj(bbox[2], bbox[3])
const out = {
  id, name, hand, bbox, origin: [lat0, lon0],
  size: [Math.round(Math.abs(xMax) * 2), Math.round(Math.abs(zMax) * 2)],
  nodes, roads, signals: [...signals], stops: [...stops], crossings: [...crossings], buildings,
  attribution: 'Map data (c) OpenStreetMap contributors, ODbL',
}
void south; void west
const file = `public/cities/${id}.json`
writeFileSync(file, JSON.stringify(out))
console.log(`${file}: ${roads.length} roads, ${buildings.length} buildings, ${signals.size} signals, ${(JSON.stringify(out).length / 1024).toFixed(0)} KB`)
