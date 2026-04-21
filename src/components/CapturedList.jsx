import './CapturedList.css'

// dataUrl → File nesnesine çevir
function dataUrlToFile(dataUrl, filename) {
  const arr = dataUrl.split(',')
  const mime = arr[0].match(/:(.*?);/)[1]
  const bstr = atob(arr[1])
  let n = bstr.length
  const u8arr = new Uint8Array(n)
  while (n--) u8arr[n] = bstr.charCodeAt(n)
  return new File([u8arr], filename, { type: mime })
}

// Telefona kaydet (indir)
function saveToDevice(dataUrl, index) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = `fis-${index + 1}-${Date.now()}.jpg`
  a.click()
}

// WhatsApp'a gönder
async function sendToWhatsApp(dataUrl, index) {
  const file = dataUrlToFile(dataUrl, `fis-${index + 1}.jpg`)

  // Web Share API — mobilde WhatsApp'a iletir
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: `Fiş ${index + 1}`,
      })
      return
    } catch (e) {
      if (e.name === 'AbortError') return // kullanıcı iptal etti
    }
  }

  // Masaüstü fallback: indir
  saveToDevice(dataUrl, index)
}

// Tümünü WhatsApp'a gönder
async function sendAllToWhatsApp(items) {
  const files = items.map((item, i) =>
    dataUrlToFile(item.dataUrl, `fis-${i + 1}.jpg`)
  )
  if (navigator.canShare && navigator.canShare({ files })) {
    try {
      await navigator.share({ files, title: `${items.length} Fiş` })
      return
    } catch (e) {
      if (e.name === 'AbortError') return
    }
  }
  // Fallback: teker teker indir
  items.forEach((item, i) => saveToDevice(item.dataUrl, i))
}

export default function CapturedList({ items, onDelete, onClear }) {
  if (items.length === 0) {
    return (
      <div className="captured-empty">
        <div className="empty-icon">📄</div>
        <p>Henüz fiş taranmadı</p>
        <small>Fişi kamera önüne getir, "Fişi Çek" butonuna bas</small>
      </div>
    )
  }

  return (
    <div className="captured-list">
      <div className="captured-header">
        <span>{items.length} Fiş</span>
        <div className="captured-actions">
          <button
            className="btn-icon btn-whatsapp"
            onClick={() => sendAllToWhatsApp(items)}
            title="Tümünü WhatsApp'a Gönder"
          >
            WhatsApp ({items.length})
          </button>
          <button className="btn-icon btn-clear" onClick={onClear}>
            Temizle
          </button>
        </div>
      </div>

      <div className="captured-items">
        {items.map((item, index) => (
          <div key={item.id} className="captured-item">
            <div className="item-thumb-wrap">
              <img src={item.dataUrl} alt={`Fiş ${index + 1}`} className="item-thumb" />
              <span className="item-num">{index + 1}</span>
            </div>
            <div className="item-info">
              <span className="item-time">{item.timestamp}</span>
            </div>
            <div className="item-btns">
              <button
                className="item-btn item-btn-whatsapp"
                onClick={() => sendToWhatsApp(item.dataUrl, index)}
                title="WhatsApp'a Gönder"
              >
                WA
              </button>
              <button
                className="item-btn item-btn-save"
                onClick={() => saveToDevice(item.dataUrl, index)}
                title="Telefona Kaydet"
              >
                ↓
              </button>
              <button
                className="item-btn item-btn-delete"
                onClick={() => onDelete(item.id)}
                title="Sil"
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
