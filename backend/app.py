import json, math, heapq
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from fastapi import FastAPI
from pydantic import BaseModel

DATA_PATH = Path(__file__).resolve().parent / "data" / "graph.json"
if not DATA_PATH.exists():
    raise RuntimeError("data/graph.json not found — run build_graph.py first")
with DATA_PATH.open() as f:
    DATA = json.load(f)

# nodes arrive as strings; cast keys to int for convenience
NODES: Dict[int, dict] = {int(k): v for k, v in DATA["nodes"].items()}
EDGES: List[dict] = DATA["edges"]

# build adjacency with edge indices for quick lookups
ADJ: Dict[int, List[Tuple[int, int]]] = {nid: [] for nid in NODES}
for i, e in enumerate(EDGES):
    u, v = e["u"], e["v"]
    ADJ[u].append((v, i))
    ADJ[v].append((u, i))  # treat walking as undirected

# precompute straight-line heuristic scaling (deg->m rough, fine for city scale)
DEG_TO_M = 111_000.0

def heuristic(nid: int, goal: int) -> float:
    dx = (NODES[nid]["x"] - NODES[goal]["x"]) * DEG_TO_M
    dy = (NODES[nid]["y"] - NODES[goal]["y"]) * DEG_TO_M
    return math.hypot(dx, dy)

def nearest_node(lon: float, lat: float) -> int:
    # simple linear scan; plenty fast for hackathon sizes
    best = None
    best_d2 = 1e100
    for i, n in NODES.items():
        dx = n["x"] - lon
        dy = n["y"] - lat
        d2 = dx*dx + dy*dy
        if d2 < best_d2:
            best, best_d2 = i, d2
    return best

class RouteReq(BaseModel):
    origin: Tuple[float, float]   # [lon, lat]
    dest: Tuple[float, float]
    # optional: edge-id -> multiplier (e.g., 0.6 for shaded segments)
    multipliers: Optional[Dict[str, float]] = None

app = FastAPI()

@app.get("/graph")
def get_graph():
    return {"nodes": NODES, "edges": EDGES}

@app.post("/route")
def route(req: RouteReq):
    start = nearest_node(*req.origin)
    goal  = nearest_node(*req.dest)

    # base edge costs = lengths (meters)
    edge_cost: List[float] = []
    for e in EDGES:
        c = float(e["length"])
        if req.multipliers:
            m = req.multipliers.get(e["id"])
            if m is not None:
                c *= float(m)
        edge_cost.append(c)

    # A* search
    openq = [(heuristic(start, goal), 0.0, start)]
    came: Dict[int, int] = {}
    g: Dict[int, float] = {start: 0.0}

    while openq:
        f, gcur, u = heapq.heappop(openq)
        if u == goal:
            break
        for v, ei in ADJ[u]:
            ng = gcur + edge_cost[ei]
            if ng < g.get(v, 1e100):
                g[v] = ng
                came[v] = u
                heapq.heappush(openq, (ng + heuristic(v, goal), ng, v))

    if goal not in came and goal != start:
        return {"error": "no path found"}

    # reconstruct node path
    path_nodes = [goal]
    while path_nodes[-1] != start:
        if path_nodes[-1] not in came:
            break
        path_nodes.append(came[path_nodes[-1]])
    path_nodes.reverse()

    # stitch geometry
    coords: List[Tuple[float, float]] = []
    total = 0.0
    for i in range(len(path_nodes)-1):
        u, v = path_nodes[i], path_nodes[i+1]
        # find an edge u-v (we stored both directions, pick the first)
        ei = next(ei for vv, ei in ADJ[u] if vv == v)
        coords += EDGES[ei]["coords"]
        total += EDGES[ei]["length"]

    return {"distance_m": total, "path": coords}
from fastapi import FastAPI
from pydantic import BaseModel
from typing import Dict, Any

app = FastAPI(title="PennApps Demo Backend")


class WeightsRequest(BaseModel):
    prompt: str


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/llm/weights")
async def llm_weights(req: WeightsRequest) -> Dict[str, Any]:
    """
    Convert plain English into a simple weights JSON.
    This is a placeholder — replace with a real LLM call or rule-based parser.
    """
    prompt = req.prompt.lower()
    weights = {
        "avoid_highways": False,
        "prefer_scenic": False,
        "max_elevation_gain": None,
    }

    if "no highway" in prompt or "avoid highway" in prompt:
        weights["avoid_highways"] = True
    if "scenic" in prompt or "scenery" in prompt:
        weights["prefer_scenic"] = True
    if "flat" in prompt:
        weights["max_elevation_gain"] = 50

    return {"prompt": req.prompt, "weights": weights}


@app.get("/route/fetch")
async def fetch_route_example() -> Dict[str, Any]:
    """Placeholder endpoint that would fetch OSM data using OSMnx and compute a route.
    For the demo we return a tiny fake GeoJSON-like object.
    """
    return {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": {"name": "demo"}, "geometry": {"type": "LineString", "coordinates": [[-75.1652,39.9526], [-75.16,39.955]]}}
        ]
    }
