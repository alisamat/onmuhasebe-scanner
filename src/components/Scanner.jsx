import { useRef, useEffect, useState, useCallback } from 'react'
import './Scanner.css'

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
      const g  = d[idx]*0.299 + d[idx+1]*0.587 + d[idx+2]*0.114
      const t  = d[((y-step)*width+x)*4]*0.299 + d[((y-step)*width+x)*4+1]*0.587 + d[((y-step)*width+x)*4+2]*0.114
      const b  = d[((y+step)*width+x)*4]*0.299 + d[((y+step)*width+x)*4+1]*0.587 + d[((y+step)*width+x)*4+2]*0.114
      const l  = d[(y*width+(x-step))*4]*0.299 + d[(y*width+(x-step))*4+1]*0.587 + d[(y*width+(x-step))*4+2]*0.114
      const r  = d[(y*width+(x+step))*4]*0.299 + d[(y*width+(x+step))*4+1]*0.587 + d[(y*width+(x+step))*4+2]*0.114
      const lap = g*4 - t - b - l - r
      sum += lap; sumSq += lap*lap; count++
    }
  }
  const mean = sum / count
  return (sumSq / count) - mean * mean
}

const CAPTURE_FRAMES = 20  // Çekme süresince bu kadar kare toplayıp en netini seç

export default function Scanner({ onCapture }) {
  const videoRef     = useRef(null)
  const canvasRef    = useRef(null)
  const offscreenRef = useRef(null)
  const rafRef       = useRef(null)
  const collectingRef  = useRef(false)
  const collectedRef   = useRef([])  // { imageData, score }
  const captureCountdownRef = useRef(0)

  const [isRunning, setIsRunning]   = useState(false)
  const [cameraError, setCameraError] = useState(null)
  const [capturing, setCapturing]   = useState(false)
  const [countdown, setCountdown]   = useState(0)
  const [captureCount, setCaptureCount] = useState(0)
  const [lastScore, setLastScore]   = useState(0)

  const doCapture = useCallback(() => {
    const offscreen = offscreenRef.current
    const video = videoRef.current
    if (!offscreen || !video || video.readyState < 2) return

    const w = offscreen.width
    const h = offscreen.height
    const ctx = offscreen.getContext('2d')

    collectingRef.current = true
    collectedRef.current = []
    captureCountdownRef.current = CAPTURE_FRAMES
    setCapturing(true)
    setCountdown(CAPTURE_FRAMES)
  }, [])

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

    // Çekim modu
    if (collectingRef.current) {
      const imageData = offCtx.getImageData(0, 0, w, h)
      const score = blurScore(imageData, w, h)
      collectedRef.current.push({ imageData, score })
      captureCountdownRef.current--
      setCountdown(captureCountdownRef.current)

      if (captureCountdownRef.current <= 0) {
        collectingRef.current = false
        setCapturing(false)

        // En net kareyi seç
        const best = collectedRef.current.reduce((a, b) => b.score > a.score ? b : a)
        setLastScore(Math.round(best.score))

        const cap = document.createElement('canvas')
        cap.width = w; cap.height = h
        cap.getContext('2d').putImageData(best.imageData, 0, 0)
        onCapture(cap.toDataURL('image/jpeg', 0.92))
        setCaptureCount(c => c + 1)
      }
    }
  }, [onCapture])

  const loop = useCallback(() => {
    drawFrame()
    rafRef.current = requestAnimationFrame(loop)
  }, [drawFrame])

  const startCamera = useCallback(async () => {
    try {
      setCameraError(null)
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
  }, [])

  useEffect(() => {
    offscreenRef.current = document.createElement('canvas')
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [])

  const progress = Math.round(((CAPTURE_FRAMES - countdown) / CAPTURE_FRAMES) * 100)

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
                <p>Fişi kameraya gösterin, "Fişi Çek" butonuna basın</p>
                <button className="btn btn-primary btn-lg" onClick={startCamera}>
                  Kamerayı Başlat
                </button>
              </div>
            )}
          </div>
        )}

        {/* Dikey guide kutusu */}
        {isRunning && (
          <div className={`scanner-guide-box ${capturing ? 'capturing' : ''}`}>
            {capturing && (
              <div className="capture-progress-bar" style={{ width: `${progress}%` }} />
            )}
          </div>
        )}

        {/* Durum çubuğu */}
        {isRunning && (
          <div className={`scanner-status-bar ${capturing ? 'status-capturing' : 'status-idle'}`}>
            <span className="status-dot" />
            {capturing
              ? `Çekiliyor... En net kare seçiliyor`
              : 'Fişi Kutuya Getirin → "Fişi Çek" Basın'}
            {lastScore > 0 && !capturing && (
              <span className="score-badge">Son netlik: {lastScore}</span>
            )}
          </div>
        )}
      </div>

      {isRunning && (
        <div className="scanner-controls">
          <button
            className={`btn btn-capture ${capturing ? 'btn-capture-active' : ''}`}
            onClick={doCapture}
            disabled={capturing}
          >
            {capturing ? `Çekiliyor...` : '📸 Fişi Çek'}
          </button>
          <span className="stats">{captureCount} fiş tarandı</span>
          <button className="btn btn-danger" onClick={stopCamera}>Durdur</button>
        </div>
      )}

      <video ref={videoRef} className="scanner-video-hidden" muted playsInline />
    </div>
  )
}
