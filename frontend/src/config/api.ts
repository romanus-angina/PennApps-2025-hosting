const API_BASE_URL = 'https://pennapps-2025-hosting-production.up.railway.app';

export const apiConfig = {
  baseURL: API_BASE_URL,
  endpoints: {
    health: `${API_BASE_URL}/health`,
    graphEdges: `${API_BASE_URL}/graph/edges`,
    nearestNode: `${API_BASE_URL}/nearest_node`,
    shortestPath: `${API_BASE_URL}/shortest_path`,
    shortestPathShade: `${API_BASE_URL}/shortest_path_shade`,
    treeShadows: `${API_BASE_URL}/tree_shadows`,
    llmWeights: `${API_BASE_URL}/llm/weights`,
    info: `${API_BASE_URL}/info`,
    metrics: `${API_BASE_URL}/metrics`
  }
};

// Helper function for API calls
export const apiCall = async (endpoint: string, options: RequestInit = {}) => {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE_URL}${endpoint}`;
  
  console.log('API Call:', url);
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('API Error:', response.status, errorText);
    throw new Error(`API call failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
};

console.log('API Base URL:', API_BASE_URL);