import { useState } from 'react'
import Scanner from './components/Scanner'
import CapturedList from './components/CapturedList'
import FisPicker from './components/FisPicker'
import './App.css'

export default function App() {
  const [tab, setTab] = useState('camera') // 'camera' | 'gallery'
  const [captured, setCaptured] = useState([])

  const handleCapture = (dataUrl) => {
    setCaptured(prev => [...prev, {
      id: Date.now(),
      dataUrl,
      timestamp: new Date().toLocaleTimeString('tr-TR'),
    }])
  }

  const handleDelete = (id) => setCaptured(prev => prev.filter(item => item.id !== id))
  const handleClear = () => setCaptured([])

  return (
    <div className="app">
      <header className="app-header">
        <h1>OnMuhasebe Fiş Gönderici</h1>
      </header>

      <div className="app-tabs">
        <button
          className={`app-tab ${tab === 'camera' ? 'app-tab-active' : ''}`}
          onClick={() => setTab('camera')}
        >
          📷 Kamera
        </button>
        <button
          className={`app-tab ${tab === 'gallery' ? 'app-tab-active' : ''}`}
          onClick={() => setTab('gallery')}
        >
          📂 Galeri
        </button>
      </div>

      <div className="app-body">
        {tab === 'camera' ? (
          <>
            <div className="scanner-pane">
              <Scanner onCapture={handleCapture} />
            </div>
            <div className="list-pane">
              <CapturedList items={captured} onDelete={handleDelete} onClear={handleClear} />
            </div>
          </>
        ) : (
          <FisPicker />
        )}
      </div>
    </div>
  )
}
