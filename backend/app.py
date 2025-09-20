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
