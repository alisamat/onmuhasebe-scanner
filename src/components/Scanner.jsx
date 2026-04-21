import { useRef, useEffect, useState, useCallback } from 'react'
import './Scanner.css'

const CAPTURE_FRAMES = 20

// En net kareyi seçmek için Laplacian variance
function blurScore(imageData, width, height) {
  const d = imageData.data
  const x0 = Math.floor(width * 0.1), x1 = Math.floor(width * 0.9)
  const y0 = Math.floor(height * 0.05), y1 = Math.floor(height * 0.95)
  const step = 4
  let sum = 0, sumSq = 0, count = 0

  for (let y = y0 + step; y < y1 - step; y += step) {
    for (let x = x0 + step; x < x1 - step; x += step) {
      const idx = (y * width + x) * 4
      const g = d[idx]*0.299 + d[idx+1]*0.587 + d[idx+2]*0.114
      const t = d[((y-step)*width+x)*4]*0.299 + d[((y-step)*width+x)*4+1]*0.587 + d[((y-step)*width+x)*4+2]*0.114
      const b = d[((y+step)*width+x)*4]*0.299 + d[((y+step)*width+x)*4+1]*0.587 + d[((y+step)*width+x)*4+2]*0.114
      const l = d[(y*width+(x-step))*4]*0.299 + d[(y*width+(x-step))*4+1]*0.587 + d[(y*width+(x-step))*4+2]*0.114
      const r = d[(y*width+(x+step))*4]*0.299 + d[(y*width+(x+step))*4+1]*0.587 + d[(y*width+(x+step))*4+2]*0.114
      const lap = g*4 - t - b - l - r
      sum += lap; sumSq += lap*lap; count++
    }
  }
  const mean = sum / count
  return (sumSq / count) - mean * mean
}

// Fişin sınırlarını parlak piksel bounding box ile bul
// En iyi koyu arka plan üzerinde çalışır
function findReceiptBounds(imageData, width, height) {
  const d = imageData.data
  const BRIGHT = 120  // bu değerin üstündeki pikseller "fiş" sayılır
  const step = 3

  let minX = width, maxX = 0, minY = height, maxY = 0
  let found = false

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4
      const brightness = d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114
      if (brightness > BRIGHT) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
        found = true
      }
    }
  }

  if (!found) return null

  // Küçük alan veya neredeyse tüm ekran → kırpma işe yaramaz
  const cropW = maxX - minX
  const cropH = maxY - minY
  const areaRatio = (cropW * cropH) / (width * height)
  if (areaRatio < 0.05 || areaRatio > 0.92) return null

  const pad = 12
  return {
    x: Math.max(0, minX - pad),
    y: Math.max(0, minY - pad),
    w: Math.min(width, maxX + pad) - Math.max(0, minX - pad),
    h: Math.min(height, maxY + pad) - Math.max(0, minY - pad),
  }
}

// imageData'dan kırpılmış canvas üret
function cropToReceipt(imageData, width, height, autoCrop) {
  const temp = document.createElement('canvas')
  temp.width = width; temp.height = height
  temp.getContext('2d').putImageData(imageData, 0, 0)

  if (!autoCrop) return temp

  const bounds = findReceiptBounds(imageData, width, height)
  if (!bounds) return temp  // sınır bulunamadıysa orijinali döndür

  const cap = document.createElement('canvas')
  cap.width = bounds.w; cap.height = bounds.h
  cap.getContext('2d').drawImage(temp, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h)
  return cap
}

export default function Scanner({ onCapture }) {
  const videoRef    = useRef(null)
  const canvasRef   = useRef(null)
  const offscreenRef = useRef(null)
  const rafRef      = useRef(null)
  const collectingRef = useRef(false)
  const collectedRef  = useRef([])
  const captureCountdownRef = useRef(0)
  const capturingStateRef = useRef(false)  // doCapture için sync ref

  const [isRunning, setIsRunning]       = useState(false)
  const [cameraError, setCameraError]   = useState(null)
  const [capturing, setCapturing]       = useState(false)
  const [countdown, setCountdown]       = useState(0)
  const [captureCount, setCaptureCount] = useState(0)
  const [autoCrop, setAutoCrop]         = useState(true)

  const doCapture = useCallback(() => {
    if (capturingStateRef.current) return
    const video = videoRef.current
    if (!video || video.readyState < 2) return

    // Titreşim geri bildirimi (mobil)
    if (navigator.vibrate) navigator.vibrate(60)

    collectingRef.current = true
    collectedRef.current = []
    captureCountdownRef.current = CAPTURE_FRAMES
    capturingStateRef.current = true
    setCapturing(true)
    setCountdown(CAPTURE_FRAMES)
  }, [])

  // Space tuşu ile çek
  useEffect(() => {
    const handleKey = (e) => {
      if (e.code === 'Space' && isRunning) {
        e.preventDefault()
        doCapture()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isRunning, doCapture])

  const drawFrame = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    const offscreen = offscreenRef.current
    if (!video || !canvas || !offscreen || video.readyState < 2) return

    const w = offscreen.width
    const h = offscreen.height
    const offCtx = offscreen.getContext('2d')
    const dispCtx = canvas.getContext('2d')

    offCtx.drawImage(video, 0, 0, w, h)
    dispCtx.drawImage(offscreen, 0, 0, canvas.width, canvas.height)

    if (collectingRef.current) {
      const imageData = offCtx.getImageData(0, 0, w, h)
      const score = blurScore(imageData, w, h)
      collectedRef.current.push({ imageData, score })
      captureCountdownRef.current--
      setCountdown(captureCountdownRef.current)

      if (captureCountdownRef.current <= 0) {
        collectingRef.current = false
        capturingStateRef.current = false
        setCapturing(false)

        const best = collectedRef.current.reduce((a, b) => b.score > a.score ? b : a)
        const resultCanvas = cropToReceipt(best.imageData, w, h, autoCrop)
        onCapture(resultCanvas.toDataURL('image/jpeg', 0.93))
        setCaptureCount(c => c + 1)

        // Başarı titreşimi
        if (navigator.vibrate) navigator.vibrate([40, 30, 40])
      }
    }
  }, [onCapture, autoCrop])

  const loop = useCallback(() => {
    drawFrame()
    rafRef.current = requestAnimationFrame(loop)
  }, [drawFrame])

  const startCamera = useCallback(async () => {
    try {
      setCameraError(null)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: { ideal: 'environment' }
        }
      })
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      await video.play()

      const vw = video.videoWidth || 1280
      const vh = video.videoHeight || 720
      offscreenRef.current.width = vw
      offscreenRef.current.height = vh
      const canvas = canvasRef.current
      canvas.width = vw; canvas.height = vh

      setIsRunning(true)
      rafRef.current = requestAnimationFrame(loop)
    } catch (err) {
      setCameraError('Kamera erişim izni reddedildi veya kamera bulunamadı.')
    }
  }, [loop])

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const video = videoRef.current
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop())
      video.srcObject = null
    }
    setIsRunning(false)
    setCapturing(false)
    collectingRef.current = false
    capturingStateRef.current = false
  }, [])

  useEffect(() => {
    offscreenRef.current = document.createElement('canvas')
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [])

  const progress = Math.round(((CAPTURE_FRAMES - countdown) / CAPTURE_FRAMES) * 100)

  return (
    <div className="scanner">
      <div
        className={`scanner-canvas-wrap ${isRunning && !capturing ? 'clickable' : ''}`}
        onClick={() => isRunning && !capturing && doCapture()}
      >
        <canvas ref={canvasRef} className="scanner-canvas" />

        {!isRunning && (
          <div className="scanner-overlay-center">
            {cameraError ? (
              <div className="camera-error">
                <p>{cameraError}</p>
                <button className="btn btn-primary" onClick={startCamera}>Tekrar Dene</button>
              </div>
            ) : (
              <div className="start-prompt">
                <p>Fişi kameraya gösterin, ekrana dokunun veya "Fişi Çek" basın</p>
                <button className="btn btn-primary btn-lg" onClick={e => { e.stopPropagation(); startCamera() }}>
                  Kamerayı Başlat
                </button>
              </div>
            )}
          </div>
        )}

        {isRunning && (
          <div className={`scanner-guide-box ${capturing ? 'capturing' : ''}`}>
            {capturing && (
              <div className="capture-progress-bar" style={{ width: `${progress}%` }} />
            )}
            {!capturing && (
              <div className="guide-hint">Dokun veya Space</div>
            )}
          </div>
        )}

        {isRunning && (
          <div className={`scanner-status-bar ${capturing ? 'status-capturing' : 'status-idle'}`}>
            <span className="status-dot" />
            {capturing ? 'Çekiliyor... En net kare seçiliyor' : 'Fişi kutuya getir → Ekrana dokun'}
          </div>
        )}
      </div>

      {isRunning && (
        <div className="scanner-controls">
          <button
            className={`btn btn-capture ${capturing ? 'btn-capture-active' : ''}`}
            onClick={e => { e.stopPropagation(); doCapture() }}
            disabled={capturing}
          >
            {capturing ? 'Çekiliyor...' : '📸 Fişi Çek'}
          </button>

          <label className="toggle-label">
            <input
              type="checkbox"
              checked={autoCrop}
              onChange={e => setAutoCrop(e.target.checked)}
            />
            Otomatik kırp
          </label>

          <span className="stats">{captureCount} fiş</span>
          <button className="btn btn-danger" onClick={stopCamera}>Durdur</button>
        </div>
      )}

      <video ref={videoRef} className="scanner-video-hidden" muted playsInline />
    </div>
  )
}
