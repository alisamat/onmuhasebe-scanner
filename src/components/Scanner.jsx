import { useRef, useEffect, useState, useCallback } from 'react'
import './Scanner.css'

// Durum makinesi
const STATE = {
  IDLE: 'IDLE',           // Kamera hazır, fiş bekleniyor
  DETECTING: 'DETECTING', // Fiş algılandı, stabilite kontrol ediliyor
  CAPTURED: 'CAPTURED',   // Fiş yakalandı, kaldırılması bekleniyor
}

const STATE_LABELS = {
  IDLE: 'Fiş Bekleniyor',
  DETECTING: 'Fiş Algılandı...',
  CAPTURED: 'Yakalandı! Fişi Kaldırın',
}

const STATE_COLORS = {
  IDLE: '#6c757d',
  DETECTING: '#f59e0b',
  CAPTURED: '#10b981',
}

// Laplacian variance ile bulanıklık skoru (yüksek = net)
function blurScore(imageData, width, height, step = 2) {
  const d = imageData.data
  let sum = 0, sumSq = 0, count = 0

  for (let y = step; y < height - step; y += step) {
    for (let x = step; x < width - step; x += step) {
      const idx = (y * width + x) * 4
      const gray = (d[idx] * 0.299 + d[idx + 1] * 0.587 + d[idx + 2] * 0.114)

      const top  = d[((y - step) * width + x) * 4] * 0.299 + d[((y - step) * width + x) * 4 + 1] * 0.587 + d[((y - step) * width + x) * 4 + 2] * 0.114
      const bot  = d[((y + step) * width + x) * 4] * 0.299 + d[((y + step) * width + x) * 4 + 1] * 0.587 + d[((y + step) * width + x) * 4 + 2] * 0.114
      const left = d[(y * width + (x - step)) * 4] * 0.299 + d[(y * width + (x - step)) * 4 + 1] * 0.587 + d[(y * width + (x - step)) * 4 + 2] * 0.114
      const right= d[(y * width + (x + step)) * 4] * 0.299 + d[(y * width + (x + step)) * 4 + 1] * 0.587 + d[(y * width + (x + step)) * 4 + 2] * 0.114

      const lap = gray * 4 - top - bot - left - right
      sum += lap
      sumSq += lap * lap
      count++
    }
  }

  const mean = sum / count
  return (sumSq / count) - mean * mean
}

// İki frame arasındaki piksel farkı (0-255 arası ortalama)
function frameDiff(a, b, sampleStep = 8) {
  const d1 = a.data, d2 = b.data
  let total = 0, count = 0
  for (let i = 0; i < d1.length; i += 4 * sampleStep) {
    total += Math.abs(d1[i] - d2[i]) + Math.abs(d1[i + 1] - d2[i + 1]) + Math.abs(d1[i + 2] - d2[i + 2])
    count += 3
  }
  return total / count
}

// Config sabitleri
const PRESENCE_THRESHOLD = 18    // Bu değerin üstünde piksel farkı = fiş var
const STABLE_FRAMES = 12          // Kaç kare stabil kalmalı (yaklaşık 0.4 sn @ 30fps)
const GONE_FRAMES = 8             // Kaç kare yok olmalı = fiş gitti
const PROCESS_EVERY = 2           // Her N kareyi işle (performans)

export default function Scanner({ onCapture }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)        // Görünen canvas (display)
  const offscreenRef = useRef(null)     // İşlem için offscreen canvas
  const rafRef = useRef(null)
  const stateRef = useRef(STATE.IDLE)
  const bgFrameRef = useRef(null)       // Arka plan referans karesi
  const stableCountRef = useRef(0)
  const goneCountRef = useRef(0)
  const bestFrameRef = useRef(null)
  const bestScoreRef = useRef(0)
  const frameCountRef = useRef(0)

  const [uiState, setUiState] = useState(STATE.IDLE)
  const [score, setScore] = useState(0)
  const [captureCount, setCaptureCount] = useState(0)
  const [cameraError, setCameraError] = useState(null)
  const [isRunning, setIsRunning] = useState(false)

  const setState = useCallback((s) => {
    stateRef.current = s
    setUiState(s)
  }, [])

  // Arka planı kaydet (fiş yokken çağrılır)
  const captureBackground = useCallback(() => {
    const offscreen = offscreenRef.current
    if (!offscreen) return
    const ctx = offscreen.getContext('2d')
    bgFrameRef.current = ctx.getImageData(0, 0, offscreen.width, offscreen.height)
  }, [])

  const processFrame = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    const offscreen = offscreenRef.current
    if (!video || !canvas || !offscreen || video.readyState < 2) return

    const w = offscreen.width
    const h = offscreen.height
    const offCtx = offscreen.getContext('2d')
    const dispCtx = canvas.getContext('2d')

    // Offscreen'e kareyi çiz
    offCtx.drawImage(video, 0, 0, w, h)

    // Display canvas'a göster
    dispCtx.drawImage(offscreen, 0, 0, canvas.width, canvas.height)

    frameCountRef.current++
    if (frameCountRef.current % PROCESS_EVERY !== 0) return

    const currentFrame = offCtx.getImageData(0, 0, w, h)

    // Arka plan yoksa kaydet
    if (!bgFrameRef.current) {
      bgFrameRef.current = currentFrame
      return
    }

    const diff = frameDiff(bgFrameRef.current, currentFrame)
    const currentScore = blurScore(currentFrame, w, h)
    setScore(Math.round(currentScore))

    if (stateRef.current === STATE.IDLE) {
      if (diff > PRESENCE_THRESHOLD) {
        // Fiş algılandı
        setState(STATE.DETECTING)
        stableCountRef.current = 0
        bestScoreRef.current = 0
        bestFrameRef.current = null
      } else {
        // Arka planı güncelle (hafif drift'i önlemek için)
        if (frameCountRef.current % 30 === 0) {
          bgFrameRef.current = currentFrame
        }
      }
    } else if (stateRef.current === STATE.DETECTING) {
      if (diff < PRESENCE_THRESHOLD * 0.6) {
        // Fiş gitti, IDLE'a dön
        setState(STATE.IDLE)
        stableCountRef.current = 0
        return
      }
      // En net kareyi takip et
      if (currentScore > bestScoreRef.current) {
        bestScoreRef.current = currentScore
        bestFrameRef.current = currentFrame
      }
      stableCountRef.current++

      if (stableCountRef.current >= STABLE_FRAMES) {
        // Yakalandı!
        setState(STATE.CAPTURED)
        goneCountRef.current = 0

        // Offscreen canvas'a en iyi kareyi çiz ve PNG olarak dışa aktar
        if (bestFrameRef.current) {
          const captureCanvas = document.createElement('canvas')
          captureCanvas.width = w
          captureCanvas.height = h
          const captureCtx = captureCanvas.getContext('2d')
          captureCtx.putImageData(bestFrameRef.current, 0, 0)
          const dataUrl = captureCanvas.toDataURL('image/jpeg', 0.92)
          onCapture(dataUrl)
          setCaptureCount(c => c + 1)
        }
      }
    } else if (stateRef.current === STATE.CAPTURED) {
      if (diff < PRESENCE_THRESHOLD * 0.5) {
        goneCountRef.current++
        if (goneCountRef.current >= GONE_FRAMES) {
          // Fiş kaldırıldı, arka planı güncelle ve IDLE'a dön
          bgFrameRef.current = currentFrame
          setState(STATE.IDLE)
          stableCountRef.current = 0
        }
      } else {
        goneCountRef.current = 0
      }
    }
  }, [onCapture, setState])

  const loop = useCallback(() => {
    processFrame()
    rafRef.current = requestAnimationFrame(loop)
  }, [processFrame])

  const startCamera = useCallback(async () => {
    try {
      setCameraError(null)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'environment'
        }
      })
      const video = videoRef.current
      if (!video) return
      video.srcObject = stream
      await video.play()

      const vw = video.videoWidth || 1280
      const vh = video.videoHeight || 720

      // Offscreen canvas boyutunu ayarla
      offscreenRef.current.width = vw
      offscreenRef.current.height = vh

      // Display canvas'ı video oranında tut
      const canvas = canvasRef.current
      canvas.width = vw
      canvas.height = vh

      bgFrameRef.current = null
      frameCountRef.current = 0
      stableCountRef.current = 0
      stateRef.current = STATE.IDLE
      setUiState(STATE.IDLE)
      setIsRunning(true)
      rafRef.current = requestAnimationFrame(loop)
    } catch (err) {
      setCameraError('Kamera erişim izni reddedildi veya kamera bulunamadı.')
      console.error(err)
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
    setState(STATE.IDLE)
  }, [setState])

  const handleCalibrate = useCallback(() => {
    captureBackground()
  }, [captureBackground])

  useEffect(() => {
    offscreenRef.current = document.createElement('canvas')
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return (
    <div className="scanner">
      <div className="scanner-canvas-wrap">
        <canvas ref={canvasRef} className="scanner-canvas" />

        {!isRunning && (
          <div className="scanner-overlay-center">
            {cameraError ? (
              <div className="camera-error">
                <p>{cameraError}</p>
                <button className="btn btn-primary" onClick={startCamera}>Tekrar Dene</button>
              </div>
            ) : (
              <button className="btn btn-primary btn-lg" onClick={startCamera}>
                Kamerayı Başlat
              </button>
            )}
          </div>
        )}

        {isRunning && (
          <div
            className="scanner-status-bar"
            style={{ background: STATE_COLORS[uiState] }}
          >
            <span className="status-dot" />
            <span>{STATE_LABELS[uiState]}</span>
            {uiState === STATE.DETECTING && (
              <span className="score-badge">Netlik: {score}</span>
            )}
          </div>
        )}

        {isRunning && uiState === STATE.IDLE && (
          <div className="scanner-guide-box" />
        )}
      </div>

      {isRunning && (
        <div className="scanner-controls">
          <button className="btn btn-secondary" onClick={handleCalibrate} title="Arka planı yeniden öğret">
            Kalibre Et
          </button>
          <span className="stats">
            {captureCount} fiş tarandı
          </span>
          <button className="btn btn-danger" onClick={stopCamera}>
            Durdur
          </button>
        </div>
      )}

      <video ref={videoRef} className="scanner-video-hidden" muted playsInline />
    </div>
  )
}
