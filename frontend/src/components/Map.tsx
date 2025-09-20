// src/components/Map.tsx
import { useEffect, useRef, useState, useCallback } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";

// ShadeMap → adds L.shadeMap(...)
import "leaflet-shadow-simulator";
// @ts-ignore – local shim in src/types
import osmtogeojson from "osmtogeojson";

import AddressSearch from "./AddressSearch";

// ---------- Icons fix for Vite ----------
const iconRetinaUrl = new URL("leaflet/dist/images/marker-icon-2x.png", import.meta.url).href;
const iconUrl = new URL("leaflet/dist/images/marker-icon.png", import.meta.url).href;
const shadowUrl = new URL("leaflet/dist/images/marker-shadow.png", import.meta.url).href;
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({ iconRetinaUrl, iconUrl, shadowUrl });

const startIcon = new L.Icon({
  iconUrl, iconRetinaUrl, shadowUrl,
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
  className: "start-marker",
});
const endIcon = new L.Icon({
  iconUrl, iconRetinaUrl, shadowUrl,
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41],
  className: "end-marker",
});

// ---------- Types ----------
type Pt = { lat: number; lng: number };
export type Edge = { id: string; a: Pt; b: Pt };
export type EdgeResult = { id: string; shadePct: number; shaded: boolean; nSamples: number };

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

// ---------- Component ----------
export default function Map({
  edges = [],
  date: initialDate,
  onResults,
}: {
  edges?: Edge[];
  date?: Date;
  onResults?: (r: EdgeResult[]) => void;
}) {
  const mapRef = useRef<L.Map | null>(null);
  const shadeRef = useRef<any>(null);
  const edgeLayerRef = useRef<L.LayerGroup | null>(null); // for optional external edges classification
  const pathLayerRef = useRef<L.LayerGroup | null>(null); // for route + markers
  const [ready, setReady] = useState(false);
  const lastDateRef = useRef<Date>(initialDate || new Date());
  const fetchTokenRef = useRef(0);
  const [currentTime, setCurrentTime] = useState(() => {
    const d = initialDate ? new Date(initialDate) : new Date();
    return d.getHours() * 60 + d.getMinutes();
  });

  // Path state (kept in refs to avoid unnecessary re-renders)
  interface PathState {
    startPoint: [number, number] | null;
    endPoint: [number, number] | null;
    path: [number, number][];
    loading: boolean;
    error: string | null;
  }
  const pathStateRef = useRef<PathState>({
    startPoint: null, endPoint: null, path: [], loading: false, error: null,
  });
  const [pathUIState, setPathUIState] = useState<PathState>({
    startPoint: null, endPoint: null, path: [], loading: false, error: null,
  });

  // ---------- Shade layer ----------
  const buildShadeOptions = (when: Date) => ({
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
      const n = b.getNorth(), s = b.getSouth(), e = b.getEast(), w = b.getWest();
      const query = `
        [out:json][timeout:25];
        (
          way["building"](${s},${w},${n},${e});
          relation["building"](${s},${w},${n},${e});
        );
        (._;>;);
        out body;`;
      const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

      try {
        const resp = await fetch(url);
        if (!resp.ok) return [];
        const gj = osmtogeojson(await resp.json());
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
  });

  const createShadeLayer = (map: L.Map, when: Date) => {
    // @ts-ignore
    const layer = (L as any).shadeMap(buildShadeOptions(when));
    layer.once("idle", () => setReady(true));
    layer.addTo(map);
    shadeRef.current = layer;

    // shade canvas should not capture mouse events
    const container = (layer as any)._container || layer.getContainer?.();
    if (container) container.style.pointerEvents = "none";
  };

  // ---------- Map setup ----------
  useEffect(() => {
    const el = document.getElementById("map");
    if (!el) return;

    const map = L.map(el, { zoomControl: true }).setView([39.9526, -75.1652], 16);
    mapRef.current = map;
    lastDateRef.current = initialDate || new Date();

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OSM",
      maxZoom: 19,
    }).addTo(map);

    edgeLayerRef.current = L.layerGroup().addTo(map);
    pathLayerRef.current = L.layerGroup().addTo(map);

    // Disable animations to avoid the “boxed shadows” issue
    map.options.zoomAnimation = false;
    map.options.fadeAnimation = false;
    map.options.markerZoomAnimation = false;
    map.invalidateSize();

    map.whenReady(() => {
      setTimeout(() => createShadeLayer(map, lastDateRef.current), 100);
    });

    // Recreate shade layer on zoomend/resize to keep canvas in sync
    const onResize = () => {
      map.invalidateSize();
      if (shadeRef.current) {
        try { map.removeLayer(shadeRef.current); } catch { }
        createShadeLayer(map, lastDateRef.current);
      }
    };
    const onZoomEnd = onResize;
    window.addEventListener("resize", onResize);
    map.on("zoomend", onZoomEnd);

    return () => {
      window.removeEventListener("resize", onResize);
      map.off("zoomend", onZoomEnd);
      if (edgeLayerRef.current) { try { map.removeLayer(edgeLayerRef.current); } catch { } }
      if (pathLayerRef.current) { try { map.removeLayer(pathLayerRef.current); } catch { } }
      if (shadeRef.current) { try { map.removeLayer(shadeRef.current); } catch { } }
      map.remove();
    };
  }, [initialDate]);

  // ---------- Map click routing ----------
  const handleMapClick = useCallback(async (e: L.LeafletMouseEvent) => {
    if (pathStateRef.current.loading) return;
    const { lat, lng } = e.latlng;

    if (!pathStateRef.current.startPoint) {
      pathStateRef.current = { ...pathStateRef.current, startPoint: [lat, lng], error: null };
      setPathUIState({ ...pathStateRef.current });
      L.marker([lat, lng], { icon: startIcon }).addTo(pathLayerRef.current!);
    } else if (!pathStateRef.current.endPoint) {
      pathStateRef.current = { ...pathStateRef.current, endPoint: [lat, lng], loading: true, error: null };
      setPathUIState({ ...pathStateRef.current });
      L.marker([lat, lng], { icon: endIcon }).addTo(pathLayerRef.current!);

      try {
        const res = await fetch("http://localhost:8000/shortest_path", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            start_lat: pathStateRef.current.startPoint![0],
            start_lng: pathStateRef.current.startPoint![1],
            end_lat: lat,
            end_lng: lng,
          }),
        });
        const data = await res.json();
        if (data.error) {
          pathStateRef.current = { ...pathStateRef.current, loading: false, error: data.error };
        } else {
          const pathCoords: [number, number][] = data.path || [];
          pathStateRef.current = { ...pathStateRef.current, path: pathCoords, loading: false, error: null };
          if (pathCoords.length > 0) {
            L.polyline(pathCoords, { color: "blue", weight: 4, opacity: 0.7 }).addTo(pathLayerRef.current!);
          }
        }
      } catch {
        pathStateRef.current = { ...pathStateRef.current, loading: false, error: "Failed to compute path" };
      }
      setPathUIState({ ...pathStateRef.current });
    } else {
      // reset to new start
      pathLayerRef.current!.clearLayers();
      pathStateRef.current = { startPoint: [lat, lng], endPoint: null, path: [], loading: false, error: null };
      setPathUIState({ ...pathStateRef.current });
      L.marker([lat, lng], { icon: startIcon }).addTo(pathLayerRef.current!);
    }
  }, []);

  // attach click handler after map created
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.on("click", handleMapClick);
    return () => { map.off("click", handleMapClick); };
  }, [handleMapClick]);

  // ---------- External date changes ----------
  useEffect(() => {
    if (!initialDate) return;
    lastDateRef.current = initialDate;
    if (shadeRef.current?.setDate) {
      setReady(false);
      shadeRef.current.setDate(initialDate);
      shadeRef.current.once("idle", () => setReady(true));
    }
  }, [initialDate]);

  // ---------- Edge classification (optional `edges` prop) ----------
  async function classify({
    stepMeters = 15,
    samplesPerPoint = 3,
    jitterRadius = 1.5,
    alphaThreshold = 16,
    maxSteps = 20,
    earlyExit = true,
  } = {}): Promise<EdgeResult[]> {
    const map = mapRef.current, shade = shadeRef.current;
    if (!map || !shade || !ready) return [];

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
              if (cp.x < 0 || cp.y < 0 || cp.x >= rect.width || cp.y >= rect.height) continue;
              const xWin = rect.left + cp.x;
              const yWin = window.innerHeight - (rect.top + cp.y);
              try {
                const rgba: Uint8ClampedArray = shade.readPixel(xWin, yWin);
                if (rgba && isShadowRGBA(rgba, alphaThreshold)) hits++;
                total++;
              } catch { /* ignore */ }
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

  async function classifyAndDraw() {
    if (!ready || edges.length === 0) return;
    const results = await classify();
    const layer = edgeLayerRef.current!;
    layer.clearLayers();
    for (const e of edges) {
      const r = results.find((x) => x.id === e.id);
      const pct = r?.shadePct ?? 0;
      L.polyline([[e.a.lat, e.a.lng], [e.b.lat, e.b.lng]], {
        color: colorForPct(pct), weight: 6, opacity: 0.9,
      })
        .bindTooltip(`shade: ${(pct * 100).toFixed(0)}% (${r?.nSamples || 0} samples)`)
        .addTo(layer);
    }
  }

  // ---------- Shade analysis for current path ----------
  const pathToEdges = useCallback((): Edge[] => {
    if (pathStateRef.current.path.length < 2) return [];
    return pathStateRef.current.path.slice(0, -1).map((p, i) => ({
      id: `path-${i}`,
      a: { lat: p[0], lng: p[1] },
      b: { lat: pathStateRef.current.path[i + 1][0], lng: pathStateRef.current.path[i + 1][1] },
    }));
  }, []);

  const analyzePathShade = useCallback(async () => {
    if (!ready || !shadeRef.current) return;
    const map = mapRef.current!, shade = shadeRef.current!;
    const rect = map.getContainer().getBoundingClientRect();
    const pathEdges = pathToEdges();
    if (pathEdges.length === 0) return;

    const results: EdgeResult[] = [];
    for (const edge of pathEdges) {
      const lenM = L.latLng(edge.a).distanceTo(L.latLng(edge.b));
      const steps = Math.min(Math.max(1, Math.ceil(lenM / 10)), 20);
      let hits = 0, total = 0;
      for (let j = 0; j <= steps; j++) {
        const t = steps === 0 ? 0.5 : j / steps;
        const base = lerp(edge.a, edge.b, t);
        for (let s = 0; s < 3; s++) {
          const p = jitterMeters(base, 1.5);
          const cp = map.latLngToContainerPoint([p.lat, p.lng]);
          if (cp.x < 0 || cp.y < 0 || cp.x >= rect.width || cp.y >= rect.height) continue;
          const xWin = rect.left + cp.x;
          const yWin = window.innerHeight - (rect.top + cp.y);
          try {
            const rgba: Uint8ClampedArray = shade.readPixel(xWin, yWin);
            if (rgba && isShadowRGBA(rgba, 16)) hits++;
            total++;
          } catch { /* ignore */ }
        }
      }
      const shadePct = total ? hits / total : 0;
      results.push({ id: edge.id, shadePct, shaded: shadePct >= 0.5, nSamples: total });
    }

    // redraw the path with colored segments
    const layer = pathLayerRef.current!;
    const markers: L.Marker[] = [];
    layer.eachLayer((lyr) => { if (lyr instanceof L.Marker) markers.push(lyr); });
    layer.clearLayers();
    markers.forEach((m) => layer.addLayer(m));
    for (let i = 0; i < pathEdges.length; i++) {
      const edge = pathEdges[i];
      const pct = results.find(r => r.id === edge.id)?.shadePct ?? 0;
      L.polyline([[edge.a.lat, edge.a.lng], [edge.b.lat, edge.b.lng]], {
        color: colorForPct(pct), weight: 6, opacity: 0.8,
      })
        .bindTooltip(`Segment ${i + 1}: ${(pct * 100).toFixed(0)}% shaded`)
        .addTo(layer);
    }
  }, [pathToEdges, ready]);

  // ---------- AddressSearch glue ----------
  const handleRouteSearchFromAddresses = useCallback(
    async (coord1: { lat: number; lng: number }, coord2: { lat: number; lng: number }) => {
      const layer = pathLayerRef.current!;
      layer.clearLayers();

      pathStateRef.current = {
        startPoint: [coord1.lat, coord1.lng],
        endPoint: [coord2.lat, coord2.lng],
        path: [],
        loading: true,
        error: null,
      };
      setPathUIState({ ...pathStateRef.current });

      L.marker([coord1.lat, coord1.lng], { icon: startIcon }).addTo(layer);
      L.marker([coord2.lat, coord2.lng], { icon: endIcon }).addTo(layer);

      const bounds = L.latLngBounds([coord1.lat, coord1.lng], [coord2.lat, coord2.lng]);
      mapRef.current?.fitBounds(bounds, { padding: [50, 50] });

      try {
        const res = await fetch("http://localhost:8000/shortest_path", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            start_lat: coord1.lat,
            start_lng: coord1.lng,
            end_lat: coord2.lat,
            end_lng: coord2.lng,
          }),
        });
        const data = await res.json();
        if (data.error) {
          pathStateRef.current = { ...pathStateRef.current, loading: false, error: data.error };
        } else {
          const pathCoords: [number, number][] = data.path || [];
          pathStateRef.current = { ...pathStateRef.current, path: pathCoords, loading: false, error: null };
          if (pathCoords.length > 0) {
            L.polyline(pathCoords, { color: "blue", weight: 4, opacity: 0.7 }).addTo(layer);
          }
        }
      } catch {
        pathStateRef.current = { ...pathStateRef.current, loading: false, error: "Failed to compute path" };
      }

      setPathUIState({ ...pathStateRef.current });
    },
    []
  );

  // ---------- UI ----------
  return (
    <div style={{ height: "100%", position: "relative" }}>
      <div id="map" style={{ height: "100%" }} />

      {/* Shadow controls (left) */}
      <div
        style={{
          position: "absolute", left: 12, top: 12, zIndex: 1000,
          background: "rgba(0,0,0,0.6)", color: "#fff", padding: 8, borderRadius: 8,
          font: "14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif", width: 420,
        }}
      >
        {ready ? "Shadows ready" : "Rendering shadows…"}
        <div style={{ marginTop: 8 }}>
          <div style={{ position: "relative", height: 40 }}>
            {/* hour ticks */}
            <div
              style={{
                display: "flex", justifyContent: "space-between", position: "absolute",
                width: "100%", top: 20, fontSize: 10, color: "#ccc",
              }}
            >
              {Array.from({ length: 13 }, (_, i) => {
                const h = i * 2;
                return <div key={h} style={{ width: 20, textAlign: "center" }}>{String(h).padStart(2, "0")}</div>;
              })}
            </div>
            <input
              type="range"
              min={0}
              max={1440}
              step={5}
              value={currentTime}
              style={{
                width: "100%", position: "absolute", top: 0,
                WebkitAppearance: "none", height: 4,
                background: "linear-gradient(to right,#1a1a1a 0%,#1a1a1a 25%,#ffd700 50%,#ff6b35 75%,#1a1a1a 100%)",
                borderRadius: 2, outline: "none",
              } as React.CSSProperties}
              onChange={async (e) => {
                const mins = parseInt((e.target as HTMLInputElement).value, 10);
                setCurrentTime(mins);
                const d = new Date(); d.setHours(0, 0, 0, 0); d.setMinutes(mins);
                lastDateRef.current = d;
                if (shadeRef.current?.setDate) {
                  setReady(false);
                  shadeRef.current.setDate(d);
                  await new Promise<void>((res) => shadeRef.current.once("idle", () => { setReady(true); res(); }));
                  if (edges.length) await classifyAndDraw();
                }
              }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, justifyContent: "space-between" }}>
            <div style={{ background: "rgba(255,255,255,0.1)", padding: "4px 8px", borderRadius: 4, fontSize: 12 }}>
              {String(Math.floor(currentTime / 60)).padStart(2, "0")}:
              {String(currentTime % 60).padStart(2, "0")}
            </div>
            <button
              onClick={classifyAndDraw}
              disabled={!ready || edges.length === 0}
              style={{
                padding: "4px 12px", fontSize: 12,
                backgroundColor: ready && edges.length ? "#007cba" : "#666",
                color: "#fff", border: "none", borderRadius: 4,
                cursor: ready && edges.length ? "pointer" : "not-allowed",
              }}
            >
              Classify edges
            </button>
          </div>
        </div>
      </div>

      {/* Pathfinding (right) */}
      <div
        style={{
          position: "absolute", top: 10, right: 10, zIndex: 1000,
          background: "rgba(255,255,255,0.95)", padding: 10, borderRadius: 6,
          boxShadow: "0 2px 4px rgba(0,0,0,0.2)", maxWidth: 340,
          font: "14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        {/* Address search component */}
        <AddressSearch
          onRouteSearch={handleRouteSearchFromAddresses}
          disabled={!ready || pathUIState.loading}
        />

        <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>Or click on map:</div>

        {!pathUIState.startPoint && <div>Click on map to set start point</div>}
        {pathUIState.startPoint && !pathUIState.endPoint && <div>Click on map to set end point</div>}
        {pathUIState.loading && <div>Computing path…</div>}
        {pathUIState.error && <div style={{ color: "red" }}>Error: {pathUIState.error}</div>}
        {pathUIState.path.length > 0 && (
          <div>
            Path found! Click anywhere to start over.<br />
            Segments: {pathUIState.path.length - 1}
            <br />
            <button
              onClick={analyzePathShade}
              disabled={!ready}
              style={{
                marginTop: 6, padding: "4px 8px", fontSize: 12,
                backgroundColor: ready ? "#007cba" : "#ccc",
                color: "#fff", border: "none", borderRadius: 3,
                cursor: ready ? "pointer" : "not-allowed",
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
