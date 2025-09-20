import React, {useState} from 'react'
import Map from './components/Map'

export default function App() {
  const [weights, setWeights] = useState<any | null>(null)

  async function fetchWeights() {
    const res = await fetch('/api/llm/weights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'I want a scenic, flat route and avoid highways' })
    })
    const data = await res.json()
    setWeights(data.weights)
  }

  return (
    <div style={{height: '100vh'}}>
      <div style={{position: 'absolute', zIndex: 1000, left: 10, top: 10, background: 'white', padding: 8}}>
        <button onClick={fetchWeights}>Generate Weights</button>
        {weights && (
          <pre style={{maxWidth: 300, whiteSpace: 'pre-wrap'}}>{JSON.stringify(weights, null, 2)}</pre>
        )}
      </div>
      <Map />
    </div>
  )
}
