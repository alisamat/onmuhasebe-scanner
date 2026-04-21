import { useRef, useEffect, useState, useCallback } from 'react'
import './Scanner.css'

const CAPTURE_FRAMES = 10  // 20'den 10'a — daha hızlı

// ── Görüntü işleme ──────────────────────────────────────────────

function toGrayscale(data, size) {
  const gray = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    gray[i] = data[i*4]*0.299 + data[i*4+1]*0.587 + data[i*4+2]*0.114
  }
  return gray
}

// Otsu eşiği — en iyi siyah/beyaz ayrım noktasını otomatik bulur
function otsuThreshold(gray) {
  const hist = new Array(256).fill(0)
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++
  const total = gray.length
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0, wB = 0, maxVar = 0, threshold = 128
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (!wB) continue
    const wF = total - wB
    if (!wF) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const v = wB * wF * (mB - mF) ** 2
    if (v > maxVar) { maxVar = v; threshold = t }
  }
  return threshold
}

// Binarizasyon: gri tonlamadan saf siyah-beyaz
function binarize(imageData, width, height) {
  const gray = toGrayscale(imageData.data, width * height)
  const t = otsuThreshold(gray)
  const out = new ImageData(width, height)
  for (let i = 0; i < width * height; i++) {
    const v = gray[i] > t ? 255 : 0
    out.data[i*4] = out.data[i*4+1] = out.data[i*4+2] = v
    out.data[i*4+3] = 255
  }
  return out
}

// Laplacian variance — blur skoru
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
      const t2 = d[((y-step)*width+x)*4]*0.299 + d[((y-step)*width+x)*4+1]*0.587 + d[((y-step)*width+x)*4+2]*0.114
      const b2 = d[((y+step)*width+x)*4]*0.299 + d[((y+step)*width+x)*4+1]*0.587 + d[((y+step)*width+x)*4+2]*0.114
      const l  = d[(y*width+(x-step))*4]*0.299 + d[(y*width+(x-step))*4+1]*0.587 + d[(y*width+(x-step))*4+2]*0.114
      const r  = d[(y*width+(x+step))*4]*0.299 + d[(y*width+(x+step))*4+1]*0.587 + d[(y*width+(x+step))*4+2]*0.114
      const lap = g*4 - t2 - b2 - l - r
      sum += lap; sumSq += lap*lap; count++
    }
  }
  const mean = sum / count
  return (sumSq / count) - mean * mean
}

// Fişin sınır kutusunu bul
function findReceiptBounds(imageData, width, height) {
  const d = imageData.data
  const step = 3
  let minX = width, maxX = 0, minY = height, maxY = 0, found = false
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4
      const brt = d[i]*0.299 + d[i+1]*0.587 + d[i+2]*0.114
      if (brt > 120) {
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
        found = true
      }
    }
  }
  if (!found) return null
  const cw = maxX - minX, ch = maxY - minY
  const ratio = (cw * ch) / (width * height)
  if (ratio < 0.05 || ratio > 0.92) return null
  const pad = 12
  return {
    x: Math.max(0, minX - pad), y: Math.max(0, minY - pad),
    w: Math.min(width, maxX + pad) - Math.max(0, minX - pad),
    h: Math.min(height, maxY + pad) - Math.max(0, minY - pad),
  }
}

// Son görüntü üretimi: kırp + opsiyonel binarizasyon
function buildOutputCanvas(imageData, width, height, autoCrop, binary) {
  let processedData = imageData

  if (binary) {
    processedData = binarize(imageData, width, height)
  }

  const temp = document.createElement('canvas')
  temp.width = width; temp.height = height
  temp.getContext('2d').putImageData(processedData, 0, 0)

  if (!autoCrop) return temp

  const bounds = findReceiptBounds(imageData, width, height)  // orijinal üzerinden sınır bul
  if (!bounds) return temp

  const cap = document.createElement('canvas')
  cap.width = bounds.w; cap.height = bounds.h
  cap.getContext('2d').drawImage(temp, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h)
  return cap
}

// Deklanşör sesi (Web Audio API)
function playShutterSound() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.frequency.setValueAtTime(900, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.08)
    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08)
    osc.start(); osc.stop(ctx.currentTime + 0.08)
  } catch {}
}

// ── Bileşen ─────────────────────────────────────────────────────

export default function Scanner({ onCapture }) {
  const videoRef     = useRef(null)
  const canvasRef    = useRef(null)
  const offscreenRef = useRef(null)
  const rafRef       = useRef(null)
  const streamRef    = useRef(null)
  const collectingRef      = useRef(false)
  const collectedRef       = useRef([])
  const captureCountdownRef = useRef(0)
  const capturingStateRef  = useRef(false)

  const [isRunning, setIsRunning]       = useState(false)
  const [cameraError, setCameraError]   = useState(null)
  const [capturing, setCapturing]       = useState(false)
  const [countdown, setCountdown]       = useState(0)
  const [captureCount, setCaptureCount] = useState(0)
  const [autoCrop, setAutoCrop]         = useState(true)
  const [binary, setBinary]             = useState(true)   // varsayılan: siyah-beyaz
  const [torchOn, setTorchOn]           = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)

  const doCapture = useCallback(() => {
    if (capturingStateRef.current) return
    const video = videoRef.current
    if (!video || video.readyState < 2) return
    if (navigator.vibrate) navigator.vibrate(60)
    playShutterSound()
    collectingRef.current = true
    collectedRef.current = []
    captureCountdownRef.current = CAPTURE_FRAMES
    capturingStateRef.current = true
    setCapturing(true)
    setCountdown(CAPTURE_FRAMES)
  }, [])

  // Space tuşu
  useEffect(() => {
    const handle = (e) => {
      if (e.code === 'Space' && isRunning) { e.preventDefault(); doCapture() }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [isRunning, doCapture])

  const drawFrame = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    const offscreen = offscreenRef.current
    if (!video || !canvas || !offscreen || video.readyState < 2) return

    const w = offscreen.width, h = offscreen.height
    const offCtx = offscreen.getContext('2d')
    offCtx.drawImage(video, 0, 0, w, h)
    canvas.getContext('2d').drawImage(offscreen, 0, 0, canvas.width, canvas.height)

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
        const result = buildOutputCanvas(best.imageData, w, h, autoCrop, binary)
        onCapture(result.toDataURL('image/jpeg', 0.95))
        setCaptureCount(c => c + 1)
        if (navigator.vibrate) navigator.vibrate([40, 30, 40])
      }
    }
  }, [onCapture, autoCrop, binary])

  const loop = useCallback(() => {
    drawFrame()
    rafRef.current = requestAnimationFrame(loop)
  }, [drawFrame])

  const startCamera = useCallback(async () => {
    try {
      setCameraError(null)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 3840 },   // 4K önce, düşerse 1080p/720p'ye iner
          height: { ideal: 2160 },
          facingMode: { ideal: 'environment' }
        }
      })
      streamRef.current = stream
      const video = videoRef.current
      video.srcObject = stream
      await video.play()

      // Flaş desteği kontrol et
      const track = stream.getVideoTracks()[0]
      const caps = track.getCapabilities?.()
      if (caps?.torch) setTorchSupported(true)

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

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] })
      setTorchOn(t => !t)
    } catch {}
  }, [torchOn])

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const video = videoRef.current
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop())
      video.srcObject = null
    }
    streamRef.current = null
    setIsRunning(false)
    setCapturing(false)
    setTorchOn(false)
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
                <p>Fişi kameraya göster → Ekrana dokun veya Space</p>
                <button className="btn btn-primary btn-lg" onClick={e => { e.stopPropagation(); startCamera() }}>
                  Kamerayı Başlat
                </button>
              </div>
            )}
          </div>
        )}

        {isRunning && (
          <div className={`scanner-guide-box ${capturing ? 'capturing' : ''}`}>
            {capturing && <div className="capture-progress-bar" style={{ width: `${progress}%` }} />}
            {!capturing && <div className="guide-hint">Dokun veya Space</div>}
          </div>
        )}

        {isRunning && (
          <div className={`scanner-status-bar ${capturing ? 'status-capturing' : 'status-idle'}`}>
            <span className="status-dot" />
            {capturing ? 'Çekiliyor...' : 'Fişi kutuya getir → Ekrana dokun'}
            {torchSupported && (
              <button
                className={`torch-btn ${torchOn ? 'torch-on' : ''}`}
                onClick={e => { e.stopPropagation(); toggleTorch() }}
                title="Flaş"
              >
                {torchOn ? '🔦' : '💡'}
              </button>
            )}
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

          <div className="toggles">
            <label className="toggle-label">
              <input type="checkbox" checked={binary} onChange={e => setBinary(e.target.checked)} />
              Siyah-Beyaz
            </label>
            <label className="toggle-label">
              <input type="checkbox" checked={autoCrop} onChange={e => setAutoCrop(e.target.checked)} />
              Otomatik kırp
            </label>
          </div>

          <span className="stats">{captureCount} fiş</span>
          <button className="btn btn-danger" onClick={stopCamera}>Durdur</button>
        </div>
      )}

      <video ref={videoRef} className="scanner-video-hidden" muted playsInline />
    </div>
  )
}
