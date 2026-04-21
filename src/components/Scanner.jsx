import { useRef, useEffect, useState, useCallback } from 'react'
import './Scanner.css'

const STATE = {
  IDLE: 'IDLE',
  CALIBRATING: 'CALIBRATING', // Kamera açıldı, arka plan öğreniliyor
  DETECTING: 'DETECTING',
  CAPTURED: 'CAPTURED',
}

const STATE_LABELS = {
  IDLE: 'Fiş Bekleniyor — Fişi Kutuya Getirin',
  CALIBRATING: 'Hazırlanıyor... Kameradan Uzak Durun',
  DETECTING: 'Fiş Algılandı — Sabit Tutun',
  CAPTURED: 'Yakalandı! Fişi Kaldırın',
}

const STATE_COLORS = {
  IDLE: '#6c757d',
  CALIBRATING: '#3b82f6',
  DETECTING: '#f59e0b',
  CAPTURED: '#10b981',
}

// Sadece merkez bölgeyi analiz et (CSS guide box ile aynı: %10 üst/alt, %8 sol/sağ)
const ROI = { top: 0.10, bottom: 0.90, left: 0.08, right: 0.92 }

// Merkez bölgedeki piksel farkı
function zoneDiff(a, b, w, h) {
  const d1 = a.data, d2 = b.data
  const x0 = Math.floor(w * ROI.left)
  const x1 = Math.floor(w * ROI.right)
  const y0 = Math.floor(h * ROI.top)
  const y1 = Math.floor(h * ROI.bottom)
  const step = 6
  let total = 0, count = 0

  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * w + x) * 4
      total += Math.abs(d1[i] - d2[i]) + Math.abs(d1[i+1] - d2[i+1]) + Math.abs(d1[i+2] - d2[i+2])
      count += 3
    }
  }
  return total / count
}

// Merkez bölgenin ortalama parlaklığı (fişler beyaz → yüksek, yüz → düşük)
function zoneBrightness(frame, w, h) {
  const d = frame.data
  const x0 = Math.floor(w * ROI.left)
  const x1 = Math.floor(w * ROI.right)
  const y0 = Math.floor(h * ROI.top)
  const y1 = Math.floor(h * ROI.bottom)
  const step = 8
  let sum = 0, count = 0

  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * w + x) * 4
      sum += d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114
      count++
    }
  }
  return sum / count
}

// Laplacian variance — merkez bölgede blur skoru
function blurScore(frame, w, h) {
  const d = frame.data
  const x0 = Math.floor(w * ROI.left) + 2
  const x1 = Math.floor(w * ROI.right) - 2
  const y0 = Math.floor(h * ROI.top) + 2
  const y1 = Math.floor(h * ROI.bottom) - 2
  const step = 3
  let sum = 0, sumSq = 0, count = 0

  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const idx = (y * w + x) * 4
      const gray  = d[idx]*0.299 + d[idx+1]*0.587 + d[idx+2]*0.114
      const top   = d[((y-1)*w+x)*4]*0.299 + d[((y-1)*w+x)*4+1]*0.587 + d[((y-1)*w+x)*4+2]*0.114
      const bot   = d[((y+1)*w+x)*4]*0.299 + d[((y+1)*w+x)*4+1]*0.587 + d[((y+1)*w+x)*4+2]*0.114
      const left  = d[(y*w+(x-1))*4]*0.299 + d[(y*w+(x-1))*4+1]*0.587 + d[(y*w+(x-1))*4+2]*0.114
      const right = d[(y*w+(x+1))*4]*0.299 + d[(y*w+(x+1))*4+1]*0.587 + d[(y*w+(x+1))*4+2]*0.114
      const lap = gray*4 - top - bot - left - right
      sum += lap; sumSq += lap*lap; count++
    }
  }
  const mean = sum / count
  return (sumSq / count) - mean * mean
}

// Eşikler
const PRESENCE_THRESHOLD = 22   // piksel farkı eşiği
const MIN_BRIGHTNESS     = 140  // en az bu kadar parlak olmalı (fiş=beyaz, yüz=ten)
const STABLE_FRAMES      = 18   // ~0.6 sn stabil kalmalı
const GONE_FRAMES        = 10   // bu kadar kare yok olursa "fiş gitti"
const PROCESS_EVERY      = 2
const CALIBRATION_MS     = 2500 // kamera açıldıktan sonra bu ms sonra arka planı yakala

export default function Scanner({ onCapture }) {
  const videoRef    = useRef(null)
  const canvasRef   = useRef(null)
  const offscreenRef = useRef(null)
  const rafRef      = useRef(null)
  const stateRef    = useRef(STATE.CALIBRATING)
  const bgFrameRef  = useRef(null)
  const stableCountRef = useRef(0)
  const goneCountRef   = useRef(0)
  const bestFrameRef   = useRef(null)
  const bestScoreRef   = useRef(0)
  const frameCountRef  = useRef(0)

  const [uiState, setUiState]       = useState(STATE.CALIBRATING)
  const [score, setScore]           = useState(0)
  const [brightness, setBrightness] = useState(0)
  const [captureCount, setCaptureCount] = useState(0)
  const [cameraError, setCameraError]   = useState(null)
  const [isRunning, setIsRunning]       = useState(false)

  const setState = useCallback((s) => {
    stateRef.current = s
    setUiState(s)
  }, [])

  const captureBackground = useCallback(() => {
    const offscreen = offscreenRef.current
    if (!offscreen) return
    bgFrameRef.current = offscreen.getContext('2d').getImageData(0, 0, offscreen.width, offscreen.height)
    setState(STATE.IDLE)
  }, [setState])

  const processFrame = useCallback(() => {
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

    frameCountRef.current++
    if (frameCountRef.current % PROCESS_EVERY !== 0) return
    if (!bgFrameRef.current) return
    if (stateRef.current === STATE.CALIBRATING) return

    const currentFrame = offCtx.getImageData(0, 0, w, h)
    const diff  = zoneDiff(bgFrameRef.current, currentFrame, w, h)
    const brt   = zoneBrightness(currentFrame, w, h)
    const score = blurScore(currentFrame, w, h)

    setScore(Math.round(score))
    setBrightness(Math.round(brt))

    // Fiş olabilmesi için hem yeterli fark hem yeterli parlaklık gerekli
    const isReceipt = diff > PRESENCE_THRESHOLD && brt > MIN_BRIGHTNESS

    if (stateRef.current === STATE.IDLE) {
      if (isReceipt) {
        setState(STATE.DETECTING)
        stableCountRef.current = 0
        bestScoreRef.current = 0
        bestFrameRef.current = null
      } else if (frameCountRef.current % 30 === 0) {
        bgFrameRef.current = currentFrame // arka planı hafifçe güncelle
      }
    } else if (stateRef.current === STATE.DETECTING) {
      if (!isReceipt) {
        setState(STATE.IDLE)
        stableCountRef.current = 0
        return
      }
      if (score > bestScoreRef.current) {
        bestScoreRef.current = score
        bestFrameRef.current = currentFrame
      }
      stableCountRef.current++

      if (stableCountRef.current >= STABLE_FRAMES) {
        setState(STATE.CAPTURED)
        goneCountRef.current = 0

        if (bestFrameRef.current) {
          const cap = document.createElement('canvas')
          cap.width = w; cap.height = h
          cap.getContext('2d').putImageData(bestFrameRef.current, 0, 0)
          onCapture(cap.toDataURL('image/jpeg', 0.92))
          setCaptureCount(c => c + 1)
        }
      }
    } else if (stateRef.current === STATE.CAPTURED) {
      if (diff < PRESENCE_THRESHOLD * 0.5) {
        goneCountRef.current++
        if (goneCountRef.current >= GONE_FRAMES) {
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
      setState(STATE.CALIBRATING)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } }
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

      bgFrameRef.current = null
      frameCountRef.current = 0
      stableCountRef.current = 0
      setIsRunning(true)
      rafRef.current = requestAnimationFrame(loop)

      // 2.5 saniye sonra arka planı yakala — kullanıcı uzaklaşsın
      setTimeout(captureBackground, CALIBRATION_MS)
    } catch (err) {
      setCameraError('Kamera erişim izni reddedildi veya kamera bulunamadı.')
      console.error(err)
    }
  }, [loop, captureBackground, setState])

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    const video = videoRef.current
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop())
      video.srcObject = null
    }
    setIsRunning(false)
    setState(STATE.CALIBRATING)
  }, [setState])

  useEffect(() => {
    offscreenRef.current = document.createElement('canvas')
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
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
              <div className="start-prompt">
                <p>Kamerayı başlat, sonra fişleri kutunun içine getirin</p>
                <button className="btn btn-primary btn-lg" onClick={startCamera}>
                  Kamerayı Başlat
                </button>
              </div>
            )}
          </div>
        )}

        {isRunning && (
          <div className="scanner-status-bar" style={{ background: STATE_COLORS[uiState] }}>
            <span className="status-dot" />
            <span>{STATE_LABELS[uiState]}</span>
            {uiState === STATE.DETECTING && (
              <span className="score-badge">Parlaklık: {brightness} | Netlik: {score}</span>
            )}
          </div>
        )}

        {isRunning && uiState === STATE.IDLE && <div className="scanner-guide-box" />}
        {isRunning && uiState === STATE.DETECTING && <div className="scanner-guide-box detecting" />}
        {isRunning && uiState === STATE.CAPTURED && <div className="scanner-guide-box captured" />}
      </div>

      {isRunning && (
        <div className="scanner-controls">
          <button className="btn btn-secondary" onClick={captureBackground} title="Arka planı yeniden öğret">
            Yeniden Kalibre Et
          </button>
          <span className="stats">{captureCount} fiş tarandı</span>
          <button className="btn btn-danger" onClick={stopCamera}>Durdur</button>
        </div>
      )}

      <video ref={videoRef} className="scanner-video-hidden" muted playsInline />
    </div>
  )
}
