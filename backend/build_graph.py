import os
import json
import math
import osmnx as ox
import networkx as nx
from shapely.geometry import Point, LineString

# switch default place to Philadelphia
place = os.environ.get("OSM_PLACE", "Philadelphia, Pennsylvania, USA")
radius = int(os.environ.get("OSM_RADIUS", "1500"))  # meters to use if geocode returns a point

print(f"Downloading graph for: {place}")

G = None
try:
    G = ox.graph_from_place(place, network_type="walk", simplify=True)
except Exception as e:
    # handle case where geocoder returns a Point instead of a (Multi)Polygon
    print("graph_from_place failed, attempting fallback:", e)
    try:
        # first try geocode_to_gdf (may raise TypeError if result is point-like)
        gdf = ox.geocode_to_gdf(place)
        if gdf.empty:
            raise RuntimeError("geocode_to_gdf returned empty result")
        geom = gdf.geometry.iloc[0]
        gtype = geom.geom_type.lower()
        print("Geocoded geometry type:", gtype)
        if gtype in ("polygon", "multipolygon"):
            G = ox.graph_from_polygon(geom, network_type="walk", simplify=True)
        else:
            # if geocode_to_gdf returned a point-like geometry, fall back to ox.geocode()
            try:
                lat, lon = ox.geocode(place)
                print(f"Falling back to graph_from_point at ({lat:.6f},{lon:.6f}) with radius {radius}m")
                G = ox.graph_from_point((lat, lon), dist=radius, network_type="walk", simplify=True)
            except Exception as e_geo:
                raise RuntimeError(f"ox.geocode() fallback failed: {e_geo}") from e_geo
    except Exception as e2:
        # if geocode_to_gdf itself failed (TypeError from OSMnx), try ox.geocode() directly
        print("geocode_to_gdf failed or returned unexpected type:", e2)
        try:
            lat, lon = ox.geocode(place)
            print(f"Using ox.geocode() -> point at ({lat:.6f},{lon:.6f}), building graph with radius {radius}m")
            G = ox.graph_from_point((lat, lon), dist=radius, network_type="walk", simplify=True)
        except Exception as e3:
            print("Final geocode fallback failed:", e3)
            raise

if G is None:
    raise RuntimeError("Failed to build graph for place")

# helper: haversine in meters between lon/lat pairs
def haversine(lon1, lat1, lon2, lat2):
    R = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

def length_from_coords_coords_list(coords):
    total = 0.0
    for i in range(len(coords) - 1):
        lon1, lat1 = coords[i]
        lon2, lat2 = coords[i+1]
        total += haversine(lon1, lat1, lon2, lat2)
    return total

# 2) keep only edges with geometry; serialize minimal fields and compute length if missing
edges = []
for u, v, k, d in G.edges(keys=True, data=True):
    geom = d.get("geometry", None)
    if geom is None:  # make straight segment
        # osmnx removed utils_geo.line_geom_from_coords in newer versions
        # fall back to constructing a simple LineString between node coords
        geom = LineString([(G.nodes[u]["x"], G.nodes[u]["y"]), (G.nodes[v]["x"], G.nodes[v]["y"])])
    coords = list(geom.coords)
    # coords come in (x,y) = (lon, lat)
    coords_list = [[float(x), float(y)] for (x, y) in coords]
    length_val = d.get("length", None)
    if length_val is None:
        # compute length in meters from coords
        length_val = length_from_coords_coords_list(coords_list)
    edges.append({
        "id": f"{u}-{v}-{k}",
        "u": u, "v": v,
        "length": float(length_val),
        "coords": coords_list,
        # useful tags
        "highway": d.get("highway"), "surface": d.get("surface"),
        "footway": d.get("footway"), "covered": d.get("covered"),
        "tunnel": d.get("tunnel"), "arcade": d.get("arcade")
    })

# 3) nodes
nodes = {n: {"id": n, "x": float(d["x"]), "y": float(d["y"]) } for n, d in G.nodes(data=True)}

os.makedirs("data", exist_ok=True)
with open("data/graph.json", "w", encoding="utf-8") as f:
    json.dump({"nodes": nodes, "edges": edges}, f)
print("Wrote data/graph.json")