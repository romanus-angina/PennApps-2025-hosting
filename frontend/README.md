Frontend quickstart

1. cd frontend
2. npm install
3. npm run dev

The frontend is a Vite + React TypeScript app and includes `src/components/Map.tsx` which uses react-leaflet. The app currently points to OpenStreetMap tiles and renders a demo marker in Philadelphia.

To proxy API requests to the backend, use `/api/*` and Vite will proxy to http://localhost:8000 (see `vite.config.ts`).
