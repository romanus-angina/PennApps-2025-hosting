# Lightweight LLM-like rule parser for demo purposes
from typing import Dict, Any

KEYWORDS = {
    "avoid_highway": ["no highway", "avoid highway", "no highways"],
    "scenic": ["scenic", "scenery", "prefer scenic"],
    "flat": ["flat", "no hills", "flat route"]
}


def parse_prompt_to_weights(prompt: str) -> Dict[str, Any]:
    p = prompt.lower()
    weights = {"avoid_highways": False, "prefer_scenic": False, "max_elevation_gain": None}
    if any(k in p for k in KEYWORDS["avoid_highway"]):
        weights["avoid_highways"] = True
    if any(k in p for k in KEYWORDS["scenic"]):
        weights["prefer_scenic"] = True
    if any(k in p for k in KEYWORDS["flat"]):
        weights["max_elevation_gain"] = 50
    return weights
