import './CapturedList.css'

export default function CapturedList({ items, onDelete, onClear }) {
  if (items.length === 0) {
    return (
      <div className="captured-empty">
        <div className="empty-icon">📄</div>
        <p>Henüz fiş taranmadı</p>
        <small>Fişi kamera önünden geçirin, otomatik yakalanacak</small>
      </div>
    )
  }

  return (
    <div className="captured-list">
      <div className="captured-header">
        <span>{items.length} Fiş</span>
        <div className="captured-actions">
          <button className="btn-icon btn-send-all" title="Tümünü OCR'a Gönder">
            OCR Gönder ({items.length})
          </button>
          <button className="btn-icon btn-clear" onClick={onClear} title="Tümünü Temizle">
            Temizle
          </button>
        </div>
      </div>

      <div className="captured-items">
        {items.map((item, index) => (
          <div key={item.id} className="captured-item">
            <div className="item-thumb-wrap">
              <img
                src={item.dataUrl}
                alt={`Fiş ${index + 1}`}
                className="item-thumb"
              />
              <span className="item-num">{index + 1}</span>
            </div>
            <div className="item-info">
              <span className="item-time">{item.timestamp}</span>
              <span className={`item-status status-${item.status}`}>
                {item.status === 'bekliyor' ? 'Bekliyor' : item.status}
              </span>
            </div>
            <div className="item-btns">
              <button
                className="item-btn item-btn-ocr"
                title="OCR'a Gönder"
              >
                OCR
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
