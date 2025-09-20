import React, { useEffect, useRef, useState } from 'react'
import L, { LatLngExpression } from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix default icon path issues in Vite by using import.meta.url
const iconRetinaUrl = new URL('leaflet/dist/images/marker-icon-2x.png', import.meta.url).href
const iconUrl = new URL('leaflet/dist/images/marker-icon.png', import.meta.url).href
const shadowUrl = new URL('leaflet/dist/images/marker-shadow.png', import.meta.url).href

delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({ iconRetinaUrl, iconUrl, shadowUrl })

type Graph = {
  nodes: Record<string | number, { id: number; x: number; y: number }>
  edges: { id: string; u: number; v: number; length: number; coords: [number, number][] }[]
}

export default function Map(): JSX.Element {
  const mapRef = useRef<L.Map | null>(null)
  const routeRef = useRef<L.Polyline | null>(null)
  const markerLayerRef = useRef<L.LayerGroup | null>(null)

  const [graph, setGraph] = useState<Graph | null>(null)
  const [start, setStart] = useState<LatLngExpression | null>(null)
  const [end, setEnd] = useState<LatLngExpression | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const map = L.map('map', { zoomControl: true }).setView([39.9526, -75.1652], 14)
    mapRef.current = map

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 20,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map)

    const markerLayer = L.layerGroup().addTo(map)
    markerLayerRef.current = markerLayer

    map.on('click', (e: L.LeafletMouseEvent) => {
      const latlng = e.latlng
      if (!start) {
        setStart(latlng)
        markerLayer.clearLayers()
        L.marker(latlng, { title: 'Start' }).addTo(markerLayer)
      } else if (!end) {
        setEnd(latlng)
        L.marker(latlng, { title: 'End' }).addTo(markerLayer)
      } else {
        // start a new selection
        setStart(latlng)
        setEnd(null)
        markerLayer.clearLayers()
        L.marker(latlng, { title: 'Start' }).addTo(markerLayer)
        if (routeRef.current) {
          routeRef.current.remove()
          routeRef.current = null
        }
      }
    })

    return () => { map.remove(); }
  }, [])

  useEffect(() => {
    let mounted = true
    fetch('/api/graph')
      .then(r => r.json())
      .then((g: Graph) => { if (mounted) setGraph(g) })
      .catch(err => console.error('Failed to load graph', err))
    return () => { mounted = false }
  }, [])

  async function computeRoute() {
    if (!start || !end) return
    setLoading(true)
    setError(null)
    try {
      const body = {
        origin: [ (start as any).lng, (start as any).lat ],
        dest: [ (end as any).lng, (end as any).lat ]
      }
      const res = await fetch('/api/route', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      })
      if (!res.ok) throw new Error(`status ${res.status}`)
      const data = await res.json()
      if (!data.path) throw new Error('no path in response')

      const latlngs = data.path.map((c: [number, number]) => [c[1], c[0]]) as LatLngExpression[]
      const map = mapRef.current!
      if (routeRef.current) routeRef.current.remove()
      routeRef.current = L.polyline(latlngs, { weight: 5, color: '#1978c8' }).addTo(map)
      map.fitBounds(routeRef.current.getBounds(), { padding: [40, 40] })
    } catch (err: any) {
      console.error('route failed', err)
      setError(err?.message ?? String(err))
    } finally {
      setLoading(false)
    }
  }

  function clearSelection() {
    setStart(null)
    setEnd(null)
    setError(null)
    const map = mapRef.current
    if (!map) return
    // remove non-tile layers (markers/route)
    map.eachLayer(l => {
      if ((l as any)._url) return
      try { map.removeLayer(l) } catch {}
    })
    if (routeRef.current) {
      routeRef.current.remove()
      routeRef.current = null
    }
  }

  return (
    <div style={{ height: '100%' }}>
      <div style={{ position: 'absolute', zIndex: 1000, left: 10, top: 60, background: 'white', padding: 8 }}>
        <div>Click map to set Start, then End.</div>
        <button onClick={computeRoute} disabled={!start || !end || loading}>{loading ? 'Routing…' : 'Route'}</button>
        <button onClick={clearSelection} style={{ marginLeft: 8 }}>Clear</button>
        {error && <div style={{ color: 'crimson', marginTop: 6 }}>Error: {error}</div>}
      </div>
      <div id="map" style={{ height: '100%', width: '100%' }} />
    </div>
  )
}
