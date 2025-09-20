import React, { useState, useCallback } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, useMapEvents } from 'react-leaflet'
import L, { LatLngTuple } from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix default icon path issues in Vite by using import.meta.url
const iconRetinaUrl = new URL('leaflet/dist/images/marker-icon-2x.png', import.meta.url).href
const iconUrl = new URL('leaflet/dist/images/marker-icon.png', import.meta.url).href
const shadowUrl = new URL('leaflet/dist/images/marker-shadow.png', import.meta.url).href

delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl,
  iconUrl,
  shadowUrl
})

// Create custom icons for start and end points
const startIcon = new L.Icon({
  iconUrl: iconUrl,
  iconRetinaUrl: iconRetinaUrl,
  shadowUrl: shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
  className: 'start-marker'
})

const endIcon = new L.Icon({
  iconUrl: iconUrl,
  iconRetinaUrl: iconRetinaUrl,
  shadowUrl: shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
  className: 'end-marker'
})

interface PathState {
  startPoint: LatLngTuple | null
  endPoint: LatLngTuple | null
  path: LatLngTuple[]
  loading: boolean
  error: string | null
}

// Component to handle map clicks
function MapClickHandler({ onMapClick }: { onMapClick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: (e) => {
      onMapClick(e.latlng.lat, e.latlng.lng)
    }
  })
  return null
}

export default function Map() {
  const [pathState, setPathState] = useState<PathState>({
    startPoint: null,
    endPoint: null,
    path: [],
    loading: false,
    error: null
  })

  const handleMapClick = useCallback(async (lat: number, lng: number) => {
    if (pathState.loading) return

    if (!pathState.startPoint) {
      // Set start point
      setPathState(prev => ({ 
        ...prev, 
        startPoint: [lat, lng],
        error: null 
      }))
    } else if (!pathState.endPoint) {
      // Set end point and compute path
      setPathState(prev => ({ 
        ...prev, 
        endPoint: [lat, lng],
        loading: true,
        error: null 
      }))

      try {
        const response = await fetch('http://localhost:8000/shortest_path', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            start_lat: pathState.startPoint[0],
            start_lng: pathState.startPoint[1],
            end_lat: lat,
            end_lng: lng
          })
        })

        const data = await response.json()
        
        if (data.error) {
          setPathState(prev => ({ 
            ...prev, 
            loading: false,
            error: data.error 
          }))
        } else {
          setPathState(prev => ({ 
            ...prev, 
            path: data.path || [],
            loading: false,
            error: null 
          }))
        }
      } catch (err) {
        setPathState(prev => ({ 
          ...prev, 
          loading: false,
          error: 'Failed to compute path' 
        }))
      }
    } else {
      // Reset and start over
      setPathState({
        startPoint: [lat, lng],
        endPoint: null,
        path: [],
        loading: false,
        error: null
      })
    }
  }, [pathState.startPoint, pathState.endPoint, pathState.loading])

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <MapContainer center={[39.9526, -75.1652]} zoom={13} style={{height: '100%', width: '100%'}}>
        <TileLayer
          attribution='&copy; OpenStreetMap contributors'
          url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
        />
        <MapClickHandler onMapClick={handleMapClick} />
        
        {/* Start point marker */}
        {pathState.startPoint && (
          <Marker position={pathState.startPoint} icon={startIcon} />
        )}
        
        {/* End point marker */}
        {pathState.endPoint && (
          <Marker position={pathState.endPoint} icon={endIcon} />
        )}
        
        {/* Path polyline */}
        {pathState.path.length > 0 && (
          <Polyline 
            positions={pathState.path} 
            color="blue" 
            weight={4} 
            opacity={0.7}
          />
        )}
      </MapContainer>
      
      {/* Status overlay */}
      <div style={{
        position: 'absolute',
        top: 10,
        left: 10,
        background: 'white',
        padding: '10px',
        borderRadius: '5px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        zIndex: 1000,
        maxWidth: '300px'
      }}>
        {!pathState.startPoint && (
          <div>Click on the map to set start point</div>
        )}
        {pathState.startPoint && !pathState.endPoint && (
          <div>Click on the map to set end point</div>
        )}
        {pathState.loading && (
          <div>Computing path...</div>
        )}
        {pathState.error && (
          <div style={{ color: 'red' }}>Error: {pathState.error}</div>
        )}
        {pathState.path.length > 0 && (
          <div>
            Path found! Click anywhere to start over.
            <br />
            Segments: {pathState.path.length - 1}
          </div>
        )}
      </div>
    </div>
  )
}
