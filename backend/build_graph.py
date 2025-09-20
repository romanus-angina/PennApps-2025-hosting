import os
import json
import osmnx as ox
import networkx as nx

place = os.environ.get("OSM_PLACE", "Downtown Austin, Texas, USA")

# 1) get walkable network with geometries
print(f"Downloading graph for: {place}")
G = ox.graph_from_place(place, network_type="walk", simplify=True)
# ensure length attribute exists
G = ox.add_edge_lengths(G)

# 2) keep only edges with geometry; serialize minimal fields
edges = []
for u, v, k, d in G.edges(keys=True, data=True):
    geom = d.get("geometry", None)
    if geom is None:  # make straight segment
        geom = ox.utils_geo.line_geom_from_coords((G.nodes[u]["x"], G.nodes[u]["y"]),
                                                  (G.nodes[v]["x"], G.nodes[v]["y"]))
    coords = list(geom.coords)
    edges.append({
        "id": f"{u}-{v}-{k}",
        "u": u, "v": v,
        "length": float(d.get("length", geom.length)),
        "coords": [[float(x), float(y)] for (x, y) in coords],
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
