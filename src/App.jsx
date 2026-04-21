import { useState } from 'react'
import Scanner from './components/Scanner'
import CapturedList from './components/CapturedList'
import './App.css'

function App() {
  const [captured, setCaptured] = useState([])

  const handleCapture = (imageData) => {
    setCaptured(prev => [...prev, {
      id: Date.now(),
      dataUrl: imageData,
      timestamp: new Date().toLocaleTimeString('tr-TR'),
      status: 'bekliyor'
    }])
  }

  const handleDelete = (id) => {
    setCaptured(prev => prev.filter(item => item.id !== id))
  }

  const handleClear = () => {
    setCaptured([])
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>OnMuhasebe Fiş Tarayıcı</h1>
        {captured.length > 0 && (
          <span className="badge">{captured.length} fiş yakalandı</span>
        )}
      </header>
      <div className="app-body">
        <div className="scanner-pane">
          <Scanner onCapture={handleCapture} />
        </div>
        <div className="list-pane">
          <CapturedList
            items={captured}
            onDelete={handleDelete}
            onClear={handleClear}
          />
        </div>
      </div>
    </div>
  )
}

export default App
