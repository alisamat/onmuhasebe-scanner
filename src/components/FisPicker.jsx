import { useState, useRef } from 'react'
import './FisPicker.css'

async function sendToWhatsApp(files) {
  if (navigator.canShare && navigator.canShare({ files })) {
    await navigator.share({ files, title: `${files.length} Fiş` })
    return true
  }
  return false
}

export default function FisPicker() {
  const [items, setItems] = useState([])
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)
  const inputRef = useRef(null)

  const handleFiles = (e) => {
    const files = Array.from(e.target.files)
    if (!files.length) return

    const newItems = files.map(file => ({
      id: Date.now() + Math.random(),
      file,
      url: URL.createObjectURL(file),
      name: file.name,
    }))

    setItems(prev => [...prev, ...newItems])
    setResult(null)
    e.target.value = ''
  }

  const removeItem = (id) => {
    setItems(prev => {
      const item = prev.find(i => i.id === id)
      if (item) URL.revokeObjectURL(item.url)
      return prev.filter(i => i.id !== id)
    })
  }

  const clearAll = () => {
    items.forEach(i => URL.revokeObjectURL(i.url))
    setItems([])
    setResult(null)
  }

  const handleSendWhatsApp = async () => {
    if (!items.length) return
    setSending(true)
    setResult(null)
    try {
      const files = items.map(i => i.file)
      const ok = await sendToWhatsApp(files)
      if (!ok) {
        setResult({ type: 'warn', msg: 'Bu cihaz doğrudan WhatsApp paylaşımını desteklemiyor. Fotoğrafları galeriden manuel gönderin.' })
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        setResult({ type: 'error', msg: 'Gönderim başarısız.' })
      }
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="picker">

      {/* Seç butonu */}
      <div className="picker-select-area" onClick={() => inputRef.current.click()}>
        <div className="select-icon">📂</div>
        <div className="select-text">
          <strong>Fotoğraf Seç</strong>
          <span>Galeriden birden fazla fiş seçebilirsin</span>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFiles}
          style={{ display: 'none' }}
        />
      </div>

      {/* Fotoğraf listesi */}
      {items.length > 0 && (
        <>
          <div className="picker-toolbar">
            <span className="picker-count">{items.length} fotoğraf seçildi</span>
            <button className="btn-text" onClick={clearAll}>Tümünü Temizle</button>
          </div>

          <div className="picker-grid">
            {items.map((item, idx) => (
              <div key={item.id} className="picker-thumb">
                <img src={item.url} alt={`Fiş ${idx + 1}`} />
                <span className="thumb-num">{idx + 1}</span>
                <button className="thumb-remove" onClick={() => removeItem(item.id)}>✕</button>
              </div>
            ))}

            {/* Daha fazla ekle */}
            <div className="picker-thumb picker-add" onClick={() => inputRef.current.click()}>
              <span>+ Ekle</span>
            </div>
          </div>

          {result && (
            <div className={`picker-result picker-result-${result.type}`}>
              {result.msg}
            </div>
          )}

          <div className="picker-actions">
            <button
              className="btn-whatsapp-main"
              onClick={handleSendWhatsApp}
              disabled={sending}
            >
              {sending ? 'Gönderiliyor...' : `WhatsApp'a Gönder (${items.length})`}
            </button>
          </div>
        </>
      )}

      {items.length === 0 && (
        <div className="picker-empty">
          <p>Önce native kameranla fişleri çek, sonra buradan seçip toplu gönder.</p>
        </div>
      )}
    </div>
  )
}
