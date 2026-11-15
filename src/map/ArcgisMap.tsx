/// <reference types="@arcgis/map-components/types/react" />
// The real map, drawn with the ArcGIS Maps SDK for JavaScript.
// Loaded lazily by MapPanel so the SDK stays out of the first page load,
// and so the dashboard still works if the map cannot load.
//
// It draws only what it is given: facilities, segments and routes from the
// app's data. It makes no claim that a route is open, safe or truck-legal.
//
// For one route at a time it also draws the corridor analysis (G3): the 150 m
// band along the drawn line, and the REAL schools and disadvantaged tracts
// counted inside it. Those are proximity to an illustrative line, not exposure.

import '@arcgis/map-components/components/arcgis-map'
import '@arcgis/map-components/components/arcgis-zoom'
import '@arcgis/core/assets/esri/themes/light/main.css'
import esriConfig from '@arcgis/core/config.js'
import Extent from '@arcgis/core/geometry/Extent.js'
import * as geodesicBufferOperator from '@arcgis/core/geometry/operators/geodesicBufferOperator.js'
import Polyline from '@arcgis/core/geometry/Polyline.js'
import Graphic from '@arcgis/core/Graphic.js'
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer.js'
import { useEffect, useRef, useState } from 'react'
import { corridorSchools, corridorTracts } from '../data/corridorLayers.ts'
import { corridor } from '../data/index.ts'
import type { TruckState } from '../sim/trucks.ts'
import type { Facility, RoadSegment, Route } from '../types.ts'

export interface ArcgisMapProps {
  facilities: Facility[]
  segments: RoadSegment[]
  routes: Route[]
  highlightedRouteIds: { original?: string; alternative?: string; chosen?: string }
  incidentSegmentId: string | null
  candidateSegmentId: string | null
  /** The route whose 150 m corridor, schools and tracts are drawn; null for none. */
  corridorRouteId?: string | null
  /** Truck positions to draw, on their own layer. */
  trucks?: TruckState[]
  /** The selected shipment's truck is drawn larger. */
  selectedShipmentId?: string | null
  onSegmentClick?: (segmentId: string) => void
  /** Called if the view cannot start, so the panel can fall back. */
  onError?: () => void
}

// With an API key the map uses Esri's light gray basemap style; without one
// it uses the keyless light gray basemap.
const API_KEY = import.meta.env.VITE_ARCGIS_API_KEY as string | undefined
if (API_KEY) esriConfig.apiKey = API_KEY
const BASEMAP = API_KEY ? 'arcgis/light-gray' : 'gray-vector'

// Colours mirror the design tokens in src/index.css. Every state also has a
// line style or a label, so nothing relies on colour alone.
const COLOR = {
  network: [153, 162, 173],
  original: [22, 25, 29],
  alternative: [29, 79, 145],
  closed: [163, 36, 28],
  candidate: [122, 77, 0],
  casing: [255, 255, 255],
  // Community layers: tracts are hatched and schools are diamonds, so each is
  // told apart by pattern or shape as well as by colour.
  tract: [110, 68, 150],
  school: [0, 105, 92],
  corridor: [22, 25, 29],
} as const

type MapElement = HTMLArcgisMapElement

function line(coordinates: number[][]) {
  return { type: 'polyline' as const, paths: [coordinates], spatialReference: { wkid: 4326 } }
}

function stroke(color: readonly number[], width: number, style: 'solid' | 'short-dash' = 'solid') {
  return { type: 'simple-line' as const, color: [...color], width, style, cap: 'round' as const }
}

function label(text: string, color: readonly number[], yoffset = 10) {
  return {
    type: 'text' as const,
    text,
    color: [...color],
    haloColor: [255, 255, 255],
    haloSize: 2,
    yoffset,
    font: { size: 9, weight: 'bold' as const, family: 'sans-serif' },
  }
}

/**
 * GeoJSON rings as ArcGIS rings. ArcGIS reads a clockwise ring as an outline
 * and a counter-clockwise ring as a hole; GeoJSON is the other way round.
 */
function esriRings(multiPolygon: number[][][][]): number[][][] {
  const clockwise = (ring: number[][]) =>
    ring.reduce((sum, [x, y], i) => {
      const [nx, ny] = ring[(i + 1) % ring.length]
      return sum + (nx - x) * (ny + y)
    }, 0) > 0
  return multiPolygon.flatMap((polygon) =>
    polygon.map((ring, i) => (clockwise(ring) === (i === 0) ? ring : [...ring].reverse())),
  )
}

function midpoint(coordinates: number[][]) {
  const [lon, lat] = coordinates[Math.floor(coordinates.length / 2)]
  return { type: 'point' as const, longitude: lon, latitude: lat }
}

export default function ArcgisMap({
  facilities,
  segments,
  routes,
  highlightedRouteIds,
  incidentSegmentId,
  candidateSegmentId,
  corridorRouteId = null,
  trucks,
  selectedShipmentId = null,
  onSegmentClick,
  onError,
}: ArcgisMapProps) {
  const mapRef = useRef<MapElement | null>(null)
  const layerRef = useRef<GraphicsLayer | null>(null)
  const truckLayerRef = useRef<GraphicsLayer | null>(null)
  const clickRef = useRef(onSegmentClick)
  const errorRef = useRef(onError)
  const [ready, setReady] = useState(false)
  const [bufferReady, setBufferReady] = useState(geodesicBufferOperator.isLoaded())

  useEffect(() => {
    clickRef.current = onSegmentClick
    errorRef.current = onError
  })

  // Start the view once, add the drawing layer and wire clicks.
  useEffect(() => {
    const element = mapRef.current
    if (!element) return
    let cancelled = false
    const layer = new GraphicsLayer({ title: 'RouteRipple routes' })
    layerRef.current = layer
    // Trucks sit on their own layer so the clock can move them without redrawing the routes.
    const truckLayer = new GraphicsLayer({ title: 'RouteRipple trucks' })
    truckLayerRef.current = truckLayer

    const onClick = async (event: Event) => {
      if (!clickRef.current) return
      const hit = await element.hitTest((event as CustomEvent).detail, { include: layer })
      for (const result of hit.results) {
        const segmentId = result.type === 'graphic' ? result.graphic.attributes?.segmentId : undefined
        if (typeof segmentId === 'string') {
          clickRef.current(segmentId)
          return
        }
      }
    }

    // The corridor band needs the buffer operator; the rest of the map does not wait for it.
    geodesicBufferOperator
      .load()
      .then(() => {
        if (!cancelled) setBufferReady(true)
      })
      .catch(() => console.warn('RouteRipple map: the 150 m corridor cannot be drawn'))

    element
      .viewOnReady()
      .then(() => {
        if (cancelled) return
        // Fit routes exactly instead of snapping to the nearest zoom level,
        // which can crop the ends of a route.
        element.constraints.snapToZoom = false
        element.map?.add(layer)
        element.map?.add(truckLayer)
        element.addEventListener('arcgisViewClick', onClick)
        setReady(true)
      })
      .catch(() => {
        if (!cancelled) errorRef.current?.()
      })

    return () => {
      cancelled = true
      element.removeEventListener('arcgisViewClick', onClick)
      element.map?.remove(layer)
      element.map?.remove(truckLayer)
      layer.destroy()
      truckLayer.destroy()
      layerRef.current = null
      truckLayerRef.current = null
    }
  }, [])

  // Redraw whenever the data or the selection changes.
  useEffect(() => {
    const element = mapRef.current
    const layer = layerRef.current
    if (!ready || !element || !layer) return

    const byId = new Map(segments.map((s) => [s.id, s]))
    const drawn = segments.filter((s) => s.geometry !== null)
    const graphics: Graphic[] = []
    const add = (geometry: object, symbol: object, attributes: object = {}) =>
      graphics.push(new Graphic({ geometry, symbol, attributes } as never))

    // 0. Community layers for one route, underneath everything else.
    const corridorRoute = routes.find((r) => r.id === corridorRouteId)
    const counted = corridorRoute ? corridor.routes[corridorRoute.id] : undefined
    if (corridorRoute && counted) {
      const tractIds = new Set(counted.dac_tracts)
      for (const tract of corridorTracts) {
        if (!tractIds.has(tract.id)) continue
        add(
          { type: 'polygon', rings: esriRings(tract.geometry.coordinates), spatialReference: { wkid: 4326 } },
          {
            type: 'simple-fill',
            style: 'backward-diagonal',
            color: [...COLOR.tract, 0.55],
            outline: { color: [...COLOR.tract, 0.7], width: 0.75 },
          },
          { tractId: tract.id },
        )
      }
      const paths = corridorRoute.segment_ids.flatMap((id) => {
        const coordinates = byId.get(id)?.geometry?.coordinates
        return coordinates ? [coordinates] : []
      })
      if (bufferReady && paths.length > 0) {
        const band = geodesicBufferOperator.execute(
          new Polyline({ paths, spatialReference: { wkid: 4326 } }),
          corridor.buffer_m,
        )
        if (band) {
          add(band, {
            type: 'simple-fill',
            color: [...COLOR.corridor, 0.12],
            outline: { color: [...COLOR.corridor, 0.8], width: 1, style: 'dot' },
          })
        }
      }
    }

    // 1. The whole network, quietly, for context.
    for (const s of drawn) {
      add(line(s.geometry!.coordinates), stroke(COLOR.network, 1.5), { segmentId: s.id })
    }

    // 2. Highlighted routes: alternative dashed, original solid, chosen heavier.
    const highlighted = new Set<string>()
    const drawRoute = (
      routeId: string | undefined,
      color: readonly number[],
      width: number,
      style: 'solid' | 'short-dash',
    ) => {
      const route = routes.find((r) => r.id === routeId)
      if (!route) return
      for (const segmentId of route.segment_ids) {
        const coordinates = byId.get(segmentId)?.geometry?.coordinates
        if (!coordinates) continue
        highlighted.add(segmentId)
        add(line(coordinates), stroke(COLOR.casing, width + 3), { segmentId })
        add(line(coordinates), stroke(color, width, style), { segmentId })
      }
    }
    drawRoute(highlightedRouteIds.alternative, COLOR.alternative, 3, 'short-dash')
    drawRoute(highlightedRouteIds.original, COLOR.original, 3, 'solid')
    drawRoute(highlightedRouteIds.chosen, COLOR.alternative, 4.5, 'solid')

    // 3. Incident state on top, always with a text label.
    const mark = (segmentId: string | null, color: readonly number[], text: string, dashed: boolean) => {
      const coordinates = segmentId ? byId.get(segmentId)?.geometry?.coordinates : undefined
      if (!segmentId || !coordinates) return
      add(line(coordinates), stroke(COLOR.casing, 8), { segmentId })
      add(line(coordinates), stroke(color, 4.5, dashed ? 'short-dash' : 'solid'), { segmentId })
      add(midpoint(coordinates), label(text, color, 8), { segmentId })
    }
    mark(incidentSegmentId, COLOR.closed, 'Closed', false)
    if (candidateSegmentId !== incidentSegmentId) {
      mark(candidateSegmentId, COLOR.candidate, 'Awaiting confirmation', true)
    }

    // 4. Schools counted for the corridor route: diamonds, above the lines.
    if (counted) {
      const schoolIds = new Set(counted.schools)
      for (const school of corridorSchools) {
        if (!schoolIds.has(school.id)) continue
        add(
          { type: 'point', longitude: school.lon, latitude: school.lat },
          {
            type: 'simple-marker',
            style: 'diamond',
            size: 10,
            color: [255, 255, 255],
            outline: { color: [...COLOR.school], width: 2 },
          },
          { schoolId: school.id, schoolName: school.name },
        )
      }
    }

    // 5. Facilities: the port is a square, warehouses are circles.
    for (const f of facilities) {
      const point = { type: 'point' as const, longitude: f.lon, latitude: f.lat }
      add(point, {
        type: 'simple-marker',
        style: f.type === 'port' ? 'square' : 'circle',
        size: f.type === 'port' ? 11 : 9,
        color: f.type === 'port' ? [...COLOR.original] : [255, 255, 255],
        outline: { color: [...COLOR.original], width: 2 },
      })
      add(point, label(f.type === 'port' ? 'Port' : f.id, COLOR.original, 9))
    }

    layer.removeAll()
    layer.addMany(graphics)

    // Frame the selected routes, or the whole network when nothing is selected.
    const framed = highlighted.size > 0 ? drawn.filter((s) => highlighted.has(s.id)) : drawn
    const points = framed.flatMap((s) => s.geometry!.coordinates)
    if (points.length > 0) {
      const lons = points.map((p) => p[0])
      const lats = points.map((p) => p[1])
      // Leave a margin so end markers and their labels are not cut off.
      const frame = new Extent({
        xmin: Math.min(...lons),
        ymin: Math.min(...lats),
        xmax: Math.max(...lons),
        ymax: Math.max(...lats),
        spatialReference: { wkid: 4326 },
      }).expand(1.4)
      element.goTo(frame, { duration: 300 }).catch((error: { name?: string }) => {
        // A newer navigation interrupting this one is expected; anything else is worth seeing.
        if (error?.name !== 'AbortError') console.warn('RouteRipple map: could not frame the routes', error)
      })
    }
  }, [
    ready,
    bufferReady,
    facilities,
    segments,
    routes,
    highlightedRouteIds,
    incidentSegmentId,
    candidateSegmentId,
    corridorRouteId,
  ])


  // Trucks: redrawn on every clock tick, without touching the routes or the view.
  useEffect(() => {
    const layer = truckLayerRef.current
    if (!ready || !layer) return
    // Trucks at the same spot (a queue at the closure) share one marker and label.
    const groups = new Map<string, TruckState[]>()
    for (const truck of trucks ?? []) {
      if (!truck.position || (truck.status !== 'moving' && truck.status !== 'waiting')) continue
      const key = `${truck.status}:${truck.position[0].toFixed(4)},${truck.position[1].toFixed(4)}`
      groups.set(key, [...(groups.get(key) ?? []), truck])
    }
    const graphics: Graphic[] = []
    for (const group of groups.values()) {
      const [lon, lat] = group[0].position!
      const waiting = group[0].status === 'waiting'
      const selected = group.some((truck) => truck.shipment_id === selectedShipmentId)
      const color = waiting ? COLOR.closed : group.some((t) => t.rerouted) ? COLOR.alternative : COLOR.original
      const point = { type: 'point' as const, longitude: lon, latitude: lat }
      const ids = group.map((truck) => truck.shipment_id).join(', ')
      // A long queue gets a count; the list under the map names every truck.
      const who = group.length > 2 ? `${group.length} trucks` : ids
      graphics.push(
        new Graphic({
          geometry: point,
          symbol: {
            type: 'simple-marker',
            // Shape as well as colour: a square is held at a closure, a triangle is moving.
            style: waiting ? 'square' : 'triangle',
            size: selected ? 16 : 12,
            color: [...color],
            outline: { color: [255, 255, 255], width: selected ? 2.5 : 1.5 },
          },
          attributes: { truckIds: ids },
        } as never),
        new Graphic({
          geometry: point,
          symbol: label(waiting ? `${who} held` : who, color, waiting ? -18 : 11),
          attributes: { truckIds: ids },
        } as never),
      )
    }
    layer.removeAll()
    layer.addMany(graphics)
  }, [ready, trucks, selectedShipmentId])

  return (
    <arcgis-map
      ref={mapRef}
      basemap={BASEMAP}
      center="-118.08,33.92"
      zoom={9}
      aria-label="Map of the port, warehouses and routes"
    >
      <arcgis-zoom slot="top-left" />
    </arcgis-map>
  )
}
