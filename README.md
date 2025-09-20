# PennApps-2025: 

A comprehensive route-planning system for downtown Philadelphia that optimizes paths based on shade coverage and essential services. This system uses advanced satellite imagery analysis and OpenStreetMap data to provide intelligent routing recommendations.

## Project Structure

- `frontend/`: Vite + React + TypeScript with Leaflet map component for interactive visualization
- `backend/`: Advanced tree detection and waypoint pathfinding system with satellite data analysis

## Features

### Advanced Tree Detection
- **Satellite Analysis**: Real-time vegetation detection using Google Earth Engine
  - **NDVI**: Normalized Difference Vegetation Index (vegetation health)
  - **NDWI**: Normalized Difference Water Index (water content)  
  - **GNDVI**: Green Normalized Difference Vegetation Index (green vegetation)
- **Multi-strategy Combination**: Weighted combination of satellite and OpenStreetMap data
- **Density Scoring**: Trees scored based on vegetation density and confidence
- **Ultra-fine Grid**: 5m resolution analysis for precise tree detection

### Waypoint Pathfinding
- **Water Fountains**: `amenity=drinking_water` locations
- **Stores**: `shop=convenience|supermarket|grocery|beverages` locations
- **Essential Services**: Optimized routing for hydration and supplies

### Interactive Visualizations
- **Tree Maps**: Interactive HTML maps with density-based color coding
- **Waypoint Maps**: Visual representation of essential services
- **Real-time Analysis**: Live satellite data processing
- **Real-time Shade Maps**: Visualizes shade depending on angle of the sun at a given time of day

## Quickstart

### Backend Setup

1. **Navigate to backend directory:**
   ```bash
   cd backend
   ```

2. **Install dependencies:**
   ```bash
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1  # Windows
   # or
   source .venv/bin/activate      # macOS/Linux
   pip install -r requirements.txt
   ```

3. **Set up Google Earth Engine (for satellite data):**
   ```bash
   # Install Earth Engine API
   pip install earthengine-api
   
   # Authenticate (this will open a browser window)
   python -c "import ee; ee.Authenticate()"
   
   # Test authentication
   python -c "import ee; ee.Initialize(); print('Earth Engine working!')"
   ```

4. **Optional: Configure project settings:**
   ```bash
   # Copy the example environment file
   cp .example.env .env
   
   # Edit .env and add your Google Cloud Project ID (optional)
   # This is only needed if you want to use a specific project
   ```

5. **Run tree detection:**
   ```bash
   python tree_detection.py
   ```

6. **Run waypoint pathfinding:**
   ```bash
   python waypoint_pathfinding.py
   ```

7. **Start the API server:**
   ```bash
   uvicorn app:app --reload --port 8000
   ```

### Frontend Setup

1. **Navigate to frontend directory:**
   ```bash
   cd frontend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start development server:**
   ```bash
   npm run dev
   ```

## Pre-generated Data

The backend includes pre-generated JSON files from running the detection systems:

- `tree_positions.json`: 703 detected trees with satellite analysis data
- `waypoints_data.json`: Essential services waypoint data

These files can be used immediately without running the detection algorithms.

## API Integration

The generated JSON files can be easily integrated with frontend applications:

```python
import json

# Load tree data
with open('tree_positions.json', 'r') as f:
    tree_data = json.load(f)

# Access trees
trees = tree_data['trees']
for tree in trees:
    lat, lon = tree['latitude'], tree['longitude']
    density = tree['density']
    source = tree['source']
```

## Notes & Next Steps

- The frontend includes a placeholder for `leaflet-shadow-simulator` usage; import and initialize it in `src/components/Map.tsx` when ready.
- The backend's LLM endpoint is a simple rule-based stub in `backend/llm_stub.py` used by `/llm/weights`.
- The system includes comprehensive fallback mechanisms for when satellite data is unavailable.
- All detection algorithms include detailed logging and error handling.

## Dependencies

### Core Dependencies
- `osmnx`: OpenStreetMap data processing
- `geopandas`: Geospatial data manipulation
- `pandas`: Data analysis
- `folium`: Interactive mapping
- `numpy`: Numerical computing

### Optional Dependencies
- `earthengine-api`: Google Earth Engine integration for satellite data
- `python-dotenv`: Environment variable management
- `scipy`: Advanced interpolation for satellite data processing