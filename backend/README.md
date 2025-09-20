Backend quickstart

1. Create a virtualenv and install requirements

python -m venv .venv; .\.venv\Scripts\Activate.ps1; pip install -r requirements.txt

2. Run the server

uvicorn app:app --reload --port 8000

Endpoints:
- GET /health
- POST /llm/weights {"prompt": "..."}
- GET /route/fetch

Graph builder

1. With the virtualenv active (see above) run:

	# optional: set place via env (PowerShell example)
	$env:OSM_PLACE = "Downtown Austin, Texas, USA"

	python build_graph.py

2. The script writes `backend/data/graph.json` containing minimal `nodes` and `edges` (each edge has `length` and `coords`).

Notes
- OSMnx uses Overpass API; large places may take time or hit rate limits. For quick tests pick a small area or use `ox.graph_from_point` with a radius.
- OSMnx and some geo packages may require system dependencies (gdal/libgeos). If installation fails, see OSMnx docs for platform-specific setup.
