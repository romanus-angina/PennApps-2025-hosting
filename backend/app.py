from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Dict, Any, List, Tuple, Optional
import networkx as nx
import os
from pyproj import Geod
import pickle
from contextlib import asynccontextmanager
from tree_shadows import precompute_tree_shadows, get_tree_shadow_generator

# Global graph variable
G: Optional[nx.Graph] = None
geod = Geod(ellps="WGS84")

# Global tree shadows variable
tree_shadows_geojson: Optional[Dict[str, Any]] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load the segmented graph and precompute tree shadows on startup."""
    global G, tree_shadows_geojson
    
    # Load graph data
    enhanced_graph_path = os.path.join(os.path.dirname(__file__), "data", "graph_segments_with_shade.gpickle")
    original_graph_path = os.path.join(os.path.dirname(__file__), "data", "graph_segments.gpickle")
    
    try:
        if os.path.exists(enhanced_graph_path):
            with open(enhanced_graph_path, "rb") as f:
                G = pickle.load(f)
            print(f"Loaded enhanced graph with {G.number_of_nodes()} nodes and {G.number_of_edges()} edges")
            # Check if shade data is available
            sample_edge = next(iter(G.edges(data=True)), None)
            if sample_edge and 'shade_fraction_9' in sample_edge[2]:
                print("✅ Shade data available for enhanced pathfinding")
            else:
                print("⚠️ No shade data found in enhanced graph")
        else:
            with open(original_graph_path, "rb") as f:
                G = pickle.load(f)
            print(f"Loaded original graph with {G.number_of_nodes()} nodes and {G.number_of_edges()} edges")
            print("⚠️ Enhanced graph not found - shade-aware pathfinding not available")
    except Exception as e:
        print(f"Failed to load graph: {e}")
        G = None
    
    # Precompute tree shadows
    tree_data_path = os.path.join(os.path.dirname(__file__), "tree_positions.json")
    try:
        print("🌳 Precomputing tree shadows...")
        tree_shadows_geojson = precompute_tree_shadows(tree_data_path)
        feature_count = len(tree_shadows_geojson.get('features', []))
        print(f"✅ Tree shadows precomputed: {feature_count} shadow polygons generated")
    except Exception as e:
        print(f"❌ Failed to precompute tree shadows: {e}")
        tree_shadows_geojson = None
    
    yield


app = FastAPI(title="PennApps Demo Backend", lifespan=lifespan)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your frontend domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def find_nearest_node(lat: float, lon: float) -> Optional[Tuple[float, float]]:
    """Find the nearest graph node to the given lat,lon using geodesic distance."""
    if G is None:
        return None
    
    min_dist = float('inf')
    nearest_node = None
    
    for node in G.nodes():
        # Node format is (lon, lat)
        node_lon, node_lat = node
        dist = geod.inv(lon, lat, node_lon, node_lat)[2]  # geodesic distance in meters
        if dist < min_dist:
            min_dist = dist
            nearest_node = node
    
    return nearest_node


def lonlat_to_latlng(coords: List[Tuple[float, float]]) -> List[List[float]]:
    """Convert list of (lon, lat) tuples to [[lat, lng]] format for frontend."""
    return [[lat, lon] for lon, lat in coords]


class WeightsRequest(BaseModel):
    prompt: str


class NearestNodeRequest(BaseModel):
    lat: float
    lng: float


class ShortestPathRequest(BaseModel):
    start_lat: float
    start_lng: float
    end_lat: float
    end_lng: float


class ShadeAwarePathRequest(BaseModel):
    start_lat: float
    start_lng: float
    end_lat: float
    end_lng: float
    time: Optional[int] = 9  # Hour 0-23, default 9am
    shade_penalty: Optional[float] = 1.0  # Penalty factor for shaded areas


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


@app.post("/nearest_node")
async def nearest_node(req: NearestNodeRequest) -> Dict[str, Any]:
    """Find the nearest graph node to the given lat,lng coordinates."""
    if G is None:
        return {"error": "Graph not loaded"}
    
    nearest = find_nearest_node(req.lat, req.lng)
    if nearest is None:
        return {"error": "No nearest node found"}
    
    # Return in frontend format [lat, lng]
    lon, lat = nearest
    return {
        "nearest_node": [lat, lon],
        "node_id": nearest,
        "input": [req.lat, req.lng]
    }


@app.post("/shortest_path")
async def shortest_path(req: ShortestPathRequest) -> Dict[str, Any]:
    """Compute shortest path between start and end coordinates."""
    if G is None:
        return {"error": "Graph not loaded"}
    
    # Find nearest nodes for start and end points
    start_node = find_nearest_node(req.start_lat, req.start_lng)
    end_node = find_nearest_node(req.end_lat, req.end_lng)
    
    if start_node is None or end_node is None:
        return {"error": "Could not find nearest nodes"}
    
    try:
        # Compute shortest path using NetworkX
        path_nodes = nx.shortest_path(G, start_node, end_node, weight='weight')
        
        # Convert path to coordinate list for frontend
        path_coords = lonlat_to_latlng(path_nodes)
        
        # Calculate total distance
        total_distance = nx.shortest_path_length(G, start_node, end_node, weight='weight')
        
        # Calculate shade statistics for the path (using 9am data as default)
        total_shade_length = 0
        total_path_length = 0
        shaded_segments = 0
        
        # Check if shade data is available
        sample_edge = next(iter(G.edges(data=True)), None)
        has_shade_data = sample_edge and 'shade_fraction_9' in sample_edge[2]
        
        if has_shade_data:
            for i in range(len(path_nodes) - 1):
                node1, node2 = path_nodes[i], path_nodes[i + 1]
                if G.has_edge(node1, node2):
                    edge_data = G[node1][node2]
                    total_path_length += edge_data.get('weight', 0)
                    
                    # Use 9am shade data as default
                    shade_length = edge_data.get('shade_length_9', 0)
                    total_shade_length += shade_length
                    
                    # Check if segment is shaded
                    is_shaded = edge_data.get('is_shaded_9', False)
                    if is_shaded:
                        shaded_segments += 1
        
        result = {
            "path": path_coords,
            "start_node": [start_node[1], start_node[0]],  # [lat, lng]
            "end_node": [end_node[1], end_node[0]],        # [lat, lng]
            "total_distance_m": total_distance,
            "num_segments": len(path_nodes) - 1,
            "shade_mode": "standard",
            "analysis_time": "9:00"  # Default time for standard routing
        }
        
        # Add shade statistics if available
        if has_shade_data:
            shade_percentage = (total_shade_length / total_path_length * 100) if total_path_length > 0 else 0
            result.update({
                "shaded_segments": shaded_segments,
                "shade_percentage": round(shade_percentage, 1),
                "total_shade_length_m": round(total_shade_length, 1),
                "original_distance_m": total_distance,  # Same as total_distance for standard routing
                "shade_aware_distance_m": total_distance,  # Same as total_distance for standard routing
                "shade_penalty_applied": 1.0,  # No penalty applied
                "shade_penalty_added_m": 0.0   # No penalty added
            })
        
        return result
        
    except nx.NetworkXNoPath:
        return {"error": "No path found between the points"}
    except Exception as e:
        return {"error": f"Path computation failed: {str(e)}"}


def calculate_shade_aware_weight(edge_attrs: Dict[str, Any], shade_penalty: float, is_daylight: bool, hour: int = 9) -> float:
    """Calculate edge weight with shade penalty applied for the specified hour."""
    base_weight = edge_attrs.get('weight', 0)
    
    if not is_daylight:
        # Night time - no shade penalty
        return base_weight
    
    # Get shade length for the specified hour (fallback to 9 if hour not available)
    shade_length_key = f'shade_length_{hour}'
    shade_length = edge_attrs.get(shade_length_key, edge_attrs.get('shade_length_9', 0))
    
    # Apply penalty: base_weight + (shade_length × penalty_factor)
    return base_weight + ((base_weight - shade_length) * shade_penalty)


@app.post("/shortest_path_shade")
async def shortest_path_shade_aware(req: ShadeAwarePathRequest) -> Dict[str, Any]:
    """Compute shortest path with shade awareness for daylight hours."""
    if G is None:
        return {"error": "Graph not loaded"}
    
    # Check if it's night time (≤6am or ≥19pm)
    is_night = req.time <= 6 or req.time >= 19
    
    if is_night:
        # Use standard shortest path for night time
        standard_req = ShortestPathRequest(
            start_lat=req.start_lat,
            start_lng=req.start_lng,
            end_lat=req.end_lat,
            end_lng=req.end_lng
        )
        result = await shortest_path(standard_req)
        if isinstance(result, dict) and 'path' in result:
            result['shade_mode'] = 'night'
            result['shade_penalty_applied'] = False
        return result
    
    # Check if shade data is available for the requested hour
    sample_edge = next(iter(G.edges(data=True)), None)
    if not sample_edge:
        return {"error": "No edges available in graph"}
    
    # Check for hour-specific shade data, fallback to 9
    shade_fraction_key = f'shade_fraction_{req.time}'
    has_hour_data = shade_fraction_key in sample_edge[2]
    fallback_hour_data = 'shade_fraction_9' in sample_edge[2]
    
    if not has_hour_data and not fallback_hour_data:
        return {"error": f"Shade data not available for {req.time}:00 or fallback 9:00 - use /shortest_path instead"}
    
    if not has_hour_data:
        print(f"Warning: No shade data for {req.time}:00, using 9:00 data as fallback")
    
    # Find nearest nodes for start and end points
    start_node = find_nearest_node(req.start_lat, req.start_lng)
    end_node = find_nearest_node(req.end_lat, req.end_lng)
    
    if start_node is None or end_node is None:
        return {"error": "Could not find nearest nodes"}
    
    try:
        # Create a temporary graph with shade-aware weights
        temp_graph = G.copy()
        is_daylight = True  # We already checked for night time above
        
        # Update edge weights with shade penalty for the specified hour
        for node1, node2, edge_attrs in temp_graph.edges(data=True):
            new_weight = calculate_shade_aware_weight(edge_attrs, req.shade_penalty, is_daylight, req.time)
            edge_attrs['shade_aware_weight'] = new_weight
        
        # Compute shortest path using shade-aware weights
        path_nodes = nx.shortest_path(temp_graph, start_node, end_node, weight='shade_aware_weight')
        
        # Convert path to coordinate list for frontend
        path_coords = lonlat_to_latlng(path_nodes)
        
        # Calculate distances using both original and shade-aware weights
        original_distance = nx.shortest_path_length(G, start_node, end_node, weight='weight')
        shade_aware_distance = nx.shortest_path_length(temp_graph, start_node, end_node, weight='shade_aware_weight')
        
        # Calculate shade statistics for the path using hour-specific data
        total_shade_length = 0
        total_path_length = 0
        shaded_segments = 0
        
        # Define hour-specific keys
        shade_length_key = f'shade_length_{req.time}'
        is_shaded_key = f'is_shaded_{req.time}'
        
        for i in range(len(path_nodes) - 1):
            node1, node2 = path_nodes[i], path_nodes[i + 1]
            if temp_graph.has_edge(node1, node2):
                edge_data = temp_graph[node1][node2]
                total_path_length += edge_data.get('weight', 0)
                
                # Try hour-specific data, fallback to 9
                shade_length = edge_data.get(shade_length_key, edge_data.get('shade_length_9', 0))
                total_shade_length += shade_length
                
                # Check if segment is shaded at this hour
                is_shaded = edge_data.get(is_shaded_key, edge_data.get('is_shaded_9', False))
                if is_shaded:
                    shaded_segments += 1
        
        shade_percentage = (total_shade_length / total_path_length * 100) if total_path_length > 0 else 0
        
        return {
            "path": path_coords,
            "start_node": [start_node[1], start_node[0]],  # [lat, lng]
            "end_node": [end_node[1], end_node[0]],        # [lat, lng]
            "original_distance_m": original_distance,
            "shade_aware_distance_m": shade_aware_distance,
            "shade_penalty_applied": req.shade_penalty,
            "analysis_time": f"{req.time}:00",
            "shade_mode": "daylight",
            "num_segments": len(path_nodes) - 1,
            "shaded_segments": shaded_segments,
            "shade_percentage": round(shade_percentage, 1),
            "total_shade_length_m": round(total_shade_length, 1),
            "shade_penalty_added_m": round(shade_aware_distance - original_distance, 1)
        }
        
    except nx.NetworkXNoPath:
        return {"error": "No path found between the points"}
    except Exception as e:
        return {"error": f"Shade-aware path computation failed: {str(e)}"}


@app.get("/graph/edges")
async def get_graph_edges(limit: Optional[int] = None) -> Dict[str, Any]:
    """Export all graph edges with start/end coordinates for frontend analysis.
    
    Args:
        limit: Optional limit on number of edges to return (useful for testing)
    """
    if G is None:
        return {"error": "Graph not loaded"}
    
    edges = []
    
    try:
        # Iterate through all edges in the graph
        edge_iter = G.edges(data=True)
        
        # Apply limit if specified
        if limit is not None and limit > 0:
            edge_iter = list(edge_iter)[:limit]
        
        for i, (node1, node2, edge_data) in enumerate(edge_iter):
            # node1 and node2 are tuples of (lon, lat)
            lon1, lat1 = node1
            lon2, lat2 = node2
            
            # Create edge object with frontend-compatible format
            edge = {
                "id": f"edge_{i}",
                "a": {"lat": lat1, "lng": lon1},
                "b": {"lat": lat2, "lng": lon2}
            }
            
            # Optionally include edge weight/distance if available
            if 'weight' in edge_data:
                edge["weight"] = edge_data['weight']
            
            edges.append(edge)
        
        total_edges = G.number_of_edges()
        
        return {
            "type": "graph_edges",
            "count": len(edges),
            "total_available": total_edges,
            "limited": limit is not None and limit < total_edges,
            "edges": edges
        }
        
    except Exception as e:
        return {"error": f"Failed to export edges: {str(e)}"}


@app.get("/graph/edges/download")
async def download_graph_edges(limit: Optional[int] = None):
    """Download graph edges as a JSON file.
    
    Args:
        limit: Optional limit on number of edges to download (useful for testing)
    """
    if G is None:
        return JSONResponse(
            content={"error": "Graph not loaded"}, 
            status_code=500
        )
    
    edges = []
    
    try:
        # Iterate through all edges in the graph
        edge_iter = G.edges(data=True)
        
        # Apply limit if specified
        if limit is not None and limit > 0:
            edge_iter = list(edge_iter)[:limit]
        
        for i, (node1, node2, edge_data) in enumerate(edge_iter):
            # node1 and node2 are tuples of (lon, lat)
            lon1, lat1 = node1
            lon2, lat2 = node2
            
            # Create edge object with frontend-compatible format
            edge = {
                "id": f"edge_{i}",
                "a": {"lat": lat1, "lng": lon1},
                "b": {"lat": lat2, "lng": lon2}
            }
            
            # Include edge weight/distance if available
            if 'weight' in edge_data:
                edge["weight"] = edge_data['weight']
            
            edges.append(edge)
        
        total_edges = G.number_of_edges()
        filename = f"graph_edges{'_limited' if limit is not None and limit < total_edges else ''}.json"
        
        response_data = {
            "type": "graph_edges",
            "count": len(edges),
            "total_available": total_edges,
            "limited": limit is not None and limit < total_edges,
            "limit_applied": limit,
            "generated_at": G.graph.get('created_at', 'unknown') if hasattr(G, 'graph') else 'unknown',
            "edges": edges
        }
        
        # Return as downloadable JSON file
        return JSONResponse(
            content=response_data,
            headers={
                "Content-Disposition": f"attachment; filename={filename}",
                "Content-Type": "application/json"
            }
        )
        
    except Exception as e:
        return JSONResponse(
            content={"error": f"Failed to export edges: {str(e)}"}, 
            status_code=500
        )


@app.get("/tree_shadows")
async def get_tree_shadows() -> Dict[str, Any]:
    """
    Get precomputed tree shadow polygons as GeoJSON FeatureCollection.
    
    Returns:
        GeoJSON FeatureCollection with circular shadow polygons for trees with density >= 0.2
        Shadow radius is mapped linearly from density [0.2, 1.0] to radius [1m, 5m]
    """
    global tree_shadows_geojson
    
    if tree_shadows_geojson is None:
        return {"error": "Tree shadows not available - failed to precompute on startup"}
    
    try:
        # Add runtime metadata
        response = tree_shadows_geojson.copy()
        response["properties"]["served_at"] = "runtime"
        
        # Log request for debugging
        feature_count = len(response.get('features', []))
        print(f"🌳 Serving {feature_count} tree shadow polygons")
        
        return response
        
    except Exception as e:
        print(f"❌ Error serving tree shadows: {e}")
        return {"error": f"Failed to serve tree shadows: {str(e)}"}


@app.get("/tree_shadows/stats")
async def get_tree_shadow_stats() -> Dict[str, Any]:
    """
    Get statistics about the tree shadow generation process.
    
    Returns:
        Statistics about tree filtering, density mapping, and polygon generation
    """
    try:
        tree_data_path = os.path.join(os.path.dirname(__file__), "tree_positions.json")
        generator = get_tree_shadow_generator(tree_data_path)
        stats = generator.get_statistics()
        
        print("📊 Tree shadow statistics requested")
        return stats
        
    except Exception as e:
        print(f"❌ Error getting tree shadow stats: {e}")
        return {"error": f"Failed to get tree shadow statistics: {str(e)}"}

