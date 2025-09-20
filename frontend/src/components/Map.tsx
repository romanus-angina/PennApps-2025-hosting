import { useEffect, useRef, useState, useCallback } from "react";
import * as L from "leaflet";
// ShadeMap should be available as L.shadeMap() after import
import "leaflet-shadow-simulator";
// @ts-ignore – shim in src/types
import osmtogeojson from "osmtogeojson";

// Fix default icon path issues in Vite
const iconRetinaUrl = new URL('leaflet/dist/images/marker-icon-2x.png', import.meta.url).href;
const iconUrl = new URL('leaflet/dist/images/marker-icon.png', import.meta.url).href;
const shadowUrl = new URL('leaflet/dist/images/marker-shadow.png', import.meta.url).href;

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl,
  iconUrl,
  shadowUrl
});

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
});

const endIcon = new L.Icon({
  iconUrl: iconUrl,
  iconRetinaUrl: iconRetinaUrl,
  shadowUrl: shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
  className: 'end-marker'
});

type Pt = { lat: number; lng: number };
export type Edge = { id: string; a: Pt; b: Pt };
export type EdgeResult = { id: string; shadePct: number; shaded: boolean; nSamples: number };

interface PathState {
  startPoint: [number, number] | null;
  endPoint: [number, number] | null;
  path: [number, number][];
  loading: boolean;
  error: string | null;
}

function metersToLatDeg(m: number) { return m / 110540; }
function metersToLngDeg(m: number, lat: number) { return m / (111320 * Math.cos(lat * Math.PI / 180)); }
function isShadowRGBA(arr: Uint8ClampedArray, alphaThreshold = 16) { return arr[3] >= alphaThreshold; }
function lerp(a: Pt, b: Pt, t: number): Pt { return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }; }
function jitterMeters(p: Pt, r: number): Pt {
  if (!r) return p;
  const ang = Math.random() * 2 * Math.PI;
  const rad = Math.random() * r;
  const dx = rad * Math.cos(ang), dy = rad * Math.sin(ang);
  return { lat: p.lat + metersToLatDeg(dy), lng: p.lng + metersToLngDeg(dx, p.lat) };
}
function colorForPct(p: number) { return p >= 0.5 ? "#1a7f37" : "#c62828"; }

export default function ShadeClassifier({
  edges,
  date,
  onResults,
}: {
  edges: Edge[];
  date: Date;
  onResults?: (r: EdgeResult[]) => void;
}) {
  const mapRef = useRef<L.Map | null>(null);
  const shadeRef = useRef<any>(null);
  const edgeLayerRef = useRef<L.LayerGroup | null>(null);
  const pathLayerRef = useRef<L.LayerGroup | null>(null);
  const [ready, setReady] = useState(false);
  const lastDateRef = useRef<Date>(date);
  const fetchTokenRef = useRef(0);

  // Use refs instead of state to avoid re-renders
  const pathStateRef = useRef<PathState>({
    startPoint: null,
    endPoint: null,
    path: [],
    loading: false,
    error: null
  });

  // State only for UI updates
  const [pathUIState, setPathUIState] = useState<PathState>({
    startPoint: null,
    endPoint: null,
    path: [],
    loading: false,
    error: null
  });

  // Build ShadeMap options using correct API
  const buildShadeOptions = (when: Date) => {
    return {
      date: when,
      color: "#01112f",
      opacity: 0.7,
      apiKey: (import.meta as any).env.VITE_SHADEMAP_KEY,
      terrainSource: {
        tileSize: 256,
        maxZoom: 15,
        getSourceUrl: ({ x, y, z }: any) =>
          `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
        getElevation: ({ r, g, b, a }: any) => (r * 256 + g + b / 256) - 32768,
        _overzoom: 19,
      },
      getFeatures: async () => {
        if (!mapRef.current || mapRef.current.getZoom() < 15) return [];
        const my = ++fetchTokenRef.current;
        await new Promise((r) => setTimeout(r, 200)); // debounce small pans
        if (my !== fetchTokenRef.current) return [];

        const b = mapRef.current.getBounds();
        const north = b.getNorth(), south = b.getSouth(), east = b.getEast(), west = b.getWest();

        const query = `
          [out:json][timeout:25];
          (
            way["building"](${south},${west},${north},${east});
            relation["building"](${south},${west},${north},${east});
          );
          (._;>;);
          out body;
        `;
        const overpass = "https://overpass-api.de/api/interpreter";
        const url = `${overpass}?data=${encodeURIComponent(query)}`;

        try {
          const resp = await fetch(url);
          if (!resp.ok) return [];
          const data = await resp.json();
          const gj = osmtogeojson(data);

          for (const f of gj.features) {
            const props = (f.properties ||= {});
            let h: number | undefined;
            if (props.height) {
              const m = String(props.height).match(/[\d.]+/);
              if (m) h = parseFloat(m[0]);
            }
            if (!h && props["building:levels"]) {
              const lv = parseFloat(String(props["building:levels"]));
              if (!Number.isNaN(lv)) h = lv * 3;
            }
            if (!h || !Number.isFinite(h)) h = 10;
            props.height = h;
            props.render_height = h;
          }
          return gj.features;
        } catch {
          return [];
        }
      },
    };
  };

  // Helper to create the ShadeMap layer
  const createShadeLayer = (map: L.Map, when: Date) => {
    const layer = (L as any).shadeMap(buildShadeOptions(when));

    layer.once("idle", () => {
      setReady(true);
    });

    layer.addTo(map);
    shadeRef.current = layer;

    // Prevent the shade layer from responding to map events
    if (layer._container || layer.getContainer?.()) {
      const container = layer._container || layer.getContainer();
      if (container) {
        container.style.pointerEvents = 'none';
      }
    }
  };

  // Handle map clicks for pathfinding
  const handleMapClick = useCallback(async (e: L.LeafletMouseEvent) => {
    if (pathStateRef.current.loading) return;

    const { lat, lng } = e.latlng;

    if (!pathStateRef.current.startPoint) {
      // Set start point
      pathStateRef.current = {
        ...pathStateRef.current,
        startPoint: [lat, lng],
        error: null
      };

      // Update UI state
      setPathUIState({ ...pathStateRef.current });

      // Add start marker
      const pathLayer = pathLayerRef.current!;
      L.marker([lat, lng], { icon: startIcon }).addTo(pathLayer);
    } else if (!pathStateRef.current.endPoint) {
      // Set end point and compute path
      pathStateRef.current = {
        ...pathStateRef.current,
        endPoint: [lat, lng],
        loading: true,
        error: null
      };

      // Update UI state
      setPathUIState({ ...pathStateRef.current });

      // Add end marker
      const pathLayer = pathLayerRef.current!;
      L.marker([lat, lng], { icon: endIcon }).addTo(pathLayer);

      try {
        const response = await fetch('http://localhost:8000/shortest_path', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            start_lat: pathStateRef.current.startPoint![0],
            start_lng: pathStateRef.current.startPoint![1],
            end_lat: lat,
            end_lng: lng
          })
        });

        const data = await response.json();

        if (data.error) {
          pathStateRef.current = {
            ...pathStateRef.current,
            loading: false,
            error: data.error
          };
        } else {
          const pathCoords: [number, number][] = data.path || [];
          pathStateRef.current = {
            ...pathStateRef.current,
            path: pathCoords,
            loading: false,
            error: null
          };

          // Add path polyline
          if (pathCoords.length > 0) {
            L.polyline(pathCoords, {
              color: "blue",
              weight: 4,
              opacity: 0.7
            }).addTo(pathLayer);
          }
        }
      } catch (err) {
        pathStateRef.current = {
          ...pathStateRef.current,
          loading: false,
          error: 'Failed to compute path'
        };
      }

      // Update UI state after API call
      setPathUIState({ ...pathStateRef.current });
    } else {
      // Reset and start over
      const pathLayer = pathLayerRef.current!;
      pathLayer.clearLayers();

      pathStateRef.current = {
        startPoint: [lat, lng],
        endPoint: null,
        path: [],
        loading: false,
        error: null
      };

      // Update UI state
      setPathUIState({ ...pathStateRef.current });

      // Add new start marker
      L.marker([lat, lng], { icon: startIcon }).addTo(pathLayer);
    }
  }, []);

  useEffect(() => {
    // Map setup
    const mapContainer = document.getElementById("map");
    if (!mapContainer) return;

    const map = L.map(mapContainer, {
      zoomControl: true,
    }).setView([39.9526, -75.1652], 16);

    mapRef.current = map;
    lastDateRef.current = date;

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OSM",
      maxZoom: 19,
    }).addTo(map);

    // Create edge layer for shadow classification
    edgeLayerRef.current = L.layerGroup().addTo(map);

    // Create path layer for pathfinding
    pathLayerRef.current = L.layerGroup().addTo(map);

    // Add click handler for pathfinding
    map.on('click', handleMapClick);

    // Legend
    const legend: any = (L as any).control({ position: "bottomleft" });
    legend.onAdd = () => {
      const div = L.DomUtil.create("div", "legend");
      div.innerHTML = `
        <div style="padding:8px;background:#0008;color:#fff;border-radius:8px;font:14px system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
          <div><span style="color:#1a7f37">■■</span> mostly shaded</div>
          <div><span style="color:#c62828">■■</span> mostly sunny</div>
        </div>`;
      return div;
    };
    legend.addTo(map);

    // Create shade layer
    map.whenReady(() => {
      setTimeout(() => {
        createShadeLayer(map, lastDateRef.current);
      }, 100);
    });

    return () => {
      map.off('click', handleMapClick);
      if (edgeLayerRef.current) {
        try {
          map.removeLayer(edgeLayerRef.current);
        } catch (e) {
          console.warn('Error removing edge layer:', e);
        }
      }
      if (pathLayerRef.current) {
        try {
          map.removeLayer(pathLayerRef.current);
        } catch (e) {
          console.warn('Error removing path layer:', e);
        }
      }
      if (shadeRef.current) {
        try {
          map.removeLayer(shadeRef.current);
        } catch (e) {
          console.warn('Error removing shade layer:', e);
        }
      }
      map.remove();
    };
  }, [handleMapClick]);

  // Update date
  useEffect(() => {
    lastDateRef.current = date;
    if (shadeRef.current?.setDate) {
      setReady(false);
      shadeRef.current.setDate(date);
      shadeRef.current.once("idle", () => setReady(true));
    }
  }, [date]);

  // Classify edges by sampling the ShadeMap canvas
  async function classify({
    stepMeters = 15,
    samplesPerPoint = 3,
    jitterRadius = 1.5,
    alphaThreshold = 16,
    maxSteps = 20,
    earlyExit = true,
  } = {}): Promise<EdgeResult[]> {
    const map = mapRef.current;
    const shade = shadeRef.current;

    if (!map || !shade || !ready) {
      console.warn('Map or shade layer not ready for classification');
      return [];
    }

    const rect = map.getContainer().getBoundingClientRect();
    const out: EdgeResult[] = [];

    const BATCH = 300;
    for (let i = 0; i < edges.length; i += BATCH) {
      const chunk = edges.slice(i, i + BATCH);
      const part = await Promise.all(
        chunk.map(async (e) => {
          const lenM = L.latLng(e.a).distanceTo(L.latLng(e.b));
          const steps = Math.min(Math.max(1, Math.ceil(lenM / stepMeters)), maxSteps);
          let hits = 0, total = 0;

          for (let j = 0; j <= steps; j++) {
            const t = steps === 0 ? 0.5 : j / steps;
            const base = lerp(e.a, e.b, t);

            for (let s = 0; s < samplesPerPoint; s++) {
              const p = jitterMeters(base, jitterRadius);
              const cp = map.latLngToContainerPoint([p.lat, p.lng]);

              if (cp.x < 0 || cp.y < 0 || cp.x >= rect.width || cp.y >= rect.height) {
                continue;
              }

              const xWin = rect.left + cp.x;
              const yWin = window.innerHeight - (rect.top + cp.y);

              try {
                const rgba: Uint8ClampedArray = shade.readPixel(xWin, yWin);
                if (rgba && isShadowRGBA(rgba, alphaThreshold)) hits++;
                total++;
              } catch (e) {
                console.warn('Error reading pixel:', e);
              }
            }

            if (earlyExit && total >= 6) {
              const remaining = (steps - j) * samplesPerPoint;
              if (hits === total && remaining < total / 2) break;
              if (hits === 0 && remaining < total / 2) break;
            }
          }

          const shadePct = total ? hits / total : 0;
          return { id: e.id, shadePct, shaded: shadePct >= 0.5, nSamples: total };
        })
      );
      out.push(...part);
      await new Promise((r) => requestAnimationFrame(r));
    }

    onResults?.(out);
    return out;
  }

  // Expose for console testing
  useEffect(() => {
    // @ts-ignore
    window.__classifyEdges = classify;
  }, []);

  async function classifyAndDraw() {
    if (!ready) {
      console.warn('Shade layer not ready yet');
      return;
    }

    const results = await classify();
    const layer = edgeLayerRef.current!;
    layer.clearLayers();

    for (const e of edges) {
      const r = results.find((x) => x.id === e.id);
      const pct = r?.shadePct ?? 0;
      L.polyline(
        [[e.a.lat, e.a.lng], [e.b.lat, e.b.lng]],
        { color: colorForPct(pct), weight: 6, opacity: 0.9 }
      )
        .bindTooltip(`shade: ${(pct * 100).toFixed(0)}% (${r?.nSamples || 0} samples)`)
        .addTo(layer);
    }
  }

  // Convert path to edges for shadow analysis
  const pathToEdges = useCallback((): Edge[] => {
    if (pathStateRef.current.path.length < 2) return [];

    return pathStateRef.current.path.slice(0, -1).map((point, i) => ({
      id: `path-${i}`,
      a: { lat: point[0], lng: point[1] },
      b: { lat: pathStateRef.current.path[i + 1][0], lng: pathStateRef.current.path[i + 1][1] }
    }));
  }, []);

  const analyzePathShade = useCallback(async () => {
    const pathEdges = pathToEdges();
    if (pathEdges.length === 0 || !ready || !shadeRef.current) return;

    // Analyze each path segment individually using the same logic as classify()
    const map = mapRef.current!;
    const shade = shadeRef.current!;
    const rect = map.getContainer().getBoundingClientRect();
    const pathResults: EdgeResult[] = [];

    for (const edge of pathEdges) {
      const lenM = L.latLng(edge.a).distanceTo(L.latLng(edge.b));
      const steps = Math.min(Math.max(1, Math.ceil(lenM / 10)), 20); // 10m steps for path
      let hits = 0, total = 0;

      for (let j = 0; j <= steps; j++) {
        const t = steps === 0 ? 0.5 : j / steps;
        const base = lerp(edge.a, edge.b, t);

        for (let s = 0; s < 3; s++) {
          const p = jitterMeters(base, 1.5);
          const cp = map.latLngToContainerPoint([p.lat, p.lng]);

          if (cp.x < 0 || cp.y < 0 || cp.x >= rect.width || cp.y >= rect.height) {
            continue;
          }

          const xWin = rect.left + cp.x;
          const yWin = window.innerHeight - (rect.top + cp.y);

          try {
            const rgba: Uint8ClampedArray = shade.readPixel(xWin, yWin);
            if (rgba && isShadowRGBA(rgba, 16)) hits++;
            total++;
          } catch (e) {
            console.warn('Error reading pixel for path analysis:', e);
          }
        }
      }

      const shadePct = total ? hits / total : 0;
      pathResults.push({
        id: edge.id,
        shadePct,
        shaded: shadePct >= 0.5,
        nSamples: total
      });
    }

    // Clear and redraw path with shade colors
    const pathLayer = pathLayerRef.current!;
    // Keep markers but remove old path
    const markers: L.Marker[] = [];
    pathLayer.eachLayer((layer) => {
      if (layer instanceof L.Marker) {
        markers.push(layer);
      }
    });
    pathLayer.clearLayers();
    markers.forEach(marker => pathLayer.addLayer(marker));

    // Draw path segments with shade colors
    for (let i = 0; i < pathEdges.length; i++) {
      const edge = pathEdges[i];
      const result = pathResults.find(r => r.id === edge.id);
      const pct = result?.shadePct ?? 0;

      L.polyline(
        [[edge.a.lat, edge.a.lng], [edge.b.lat, edge.b.lng]],
        { color: colorForPct(pct), weight: 6, opacity: 0.8 }
      )
        .bindTooltip(`Path segment ${i + 1}: ${(pct * 100).toFixed(0)}% shaded (${result?.nSamples || 0} samples)`)
        .addTo(pathLayer);
    }
  }, [pathToEdges, ready]);

  return (
    <div style={{ height: "100%", position: "relative" }}>
      <div id="map" style={{ height: "100%" }} />

      {/* Shadow controls */}
      <div style={{
        position: "absolute", left: 12, top: 12, zIndex: 1000,
        background: "rgba(0,0,0,0.6)", color: "#fff", padding: 8, borderRadius: 8,
        font: "14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
      }}>
        {ready ? "Shadows ready" : "Rendering shadows…"}
        <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="range" min={0} max={1440} step={5} defaultValue={540}
            onChange={async (e) => {
              const mins = parseInt((e.target as HTMLInputElement).value, 10);
              const d = new Date();
              d.setHours(0, 0, 0, 0);
              d.setMinutes(mins);

              lastDateRef.current = d;
              if (shadeRef.current?.setDate) {
                setReady(false);
                shadeRef.current.setDate(d);
                await new Promise<void>((res) => shadeRef.current.once("idle", () => {
                  setReady(true);
                  res();
                }));
                await classifyAndDraw();
              }
            }}
          />
          <button onClick={classifyAndDraw} disabled={!ready}>
            {ready ? "Classify edges" : "Wait..."}
          </button>
        </div>
      </div>

      {/* Pathfinding status overlay */}
      <div style={{
        position: 'absolute',
        top: 10,
        right: 10,
        background: 'rgba(255,255,255,0.9)',
        padding: '10px',
        borderRadius: '5px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        zIndex: 1000,
        maxWidth: '300px',
        font: "14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
      }}>
        {!pathUIState.startPoint && (
          <div>Click on map to set start point</div>
        )}
        {pathUIState.startPoint && !pathUIState.endPoint && (
          <div>Click on map to set end point</div>
        )}
        {pathUIState.loading && (
          <div>Computing path...</div>
        )}
        {pathUIState.error && (
          <div style={{ color: 'red' }}>Error: {pathUIState.error}</div>
        )}
        {pathUIState.path.length > 0 && (
          <div>
            Path found! Click anywhere to start over.
            <br />
            Segments: {pathUIState.path.length - 1}
            <br />
            <button
              onClick={analyzePathShade}
              disabled={!ready}
              style={{
                marginTop: 5,
                padding: '4px 8px',
                fontSize: '12px',
                backgroundColor: ready ? '#007cba' : '#ccc',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: ready ? 'pointer' : 'not-allowed'
              }}
            >
              Analyze Path Shade
            </button>
          </div>
        )}
      </div>
    </div>
  );
}