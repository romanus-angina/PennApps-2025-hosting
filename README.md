# PennApps-2025
This repo contains a small demo scaffold for a route-planning demo built during PennApps.

Structure

- `frontend/`: Vite + React + TypeScript starter with Leaflet map component.
- `backend/`: FastAPI app with a simple LLM-to-weights endpoint and placeholder routing endpoint.

Quickstart

Backend
1. cd backend
2. python -m venv .venv; .\.venv\Scripts\Activate.ps1; pip install -r requirements.txt
3. uvicorn app:app --reload --port 8000

Frontend
1. cd frontend
2. npm install
3. npm run dev

Notes & next steps
- The frontend includes a placeholder for `leaflet-shadow-simulator` usage; import and initialize it in `src/components/Map.tsx` when ready.
- The backend's LLM endpoint is a simple rule-based stub in `backend/llm_stub.py` used by `/llm/weights`.
- For a real demo, add OSMnx calls (note: OSMnx may require additional system packages). For quick demos, use the in-memory placeholder or a small SQLite/GeoParquet store.

If you'd like, I can also:
- Add `vite` and TypeScript configs for the frontend (I added a minimal one here).
- Wire the frontend to call the backend LLM endpoint and show returned weights in the UI.