import React, { useEffect, useRef, useState } from 'react'

export default function CameraCapture({ onRecognize, onRaw, onError, previewProcessed }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const trackRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const timerRef = useRef(null)
  const [active, setActive] = useState(false)
  const [status, setStatus] = useState('aguardando')
  const [procToggle, setProcToggle] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const isIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent)

  const start = async () => {
    if (ready) {
      setActive(true)
      setStatus('lendo')
      return
    }
    try {
      const constraints = { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } } }
      let stream
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints)
      } catch (_err) {
        stream = await navigator.mediaDevices.getUserMedia({ video: true })
      }
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        try {
          const t = stream.getVideoTracks && stream.getVideoTracks()[0]
          trackRef.current = t || null
          // não ligar o flash automaticamente; só por clique
        } catch (_e) {}
        setReady(true)
        setActive(true)
        setStatus('lendo')
      }
    } catch (e) {
      setReady(false)
      setStatus(e && e.name === 'NotAllowedError' ? 'permissao_negada' : (e && e.name === 'NotFoundError' ? 'camera_nao_encontrada' : 'erro_camera'))
    }
  }

  

  const capture = async () => {
    if (!videoRef.current) return
    setBusy(true)
    try {
      const video = videoRef.current
      const w = video.videoWidth || 640
      const h = video.videoHeight || 480
      const targetW = Math.min(720, w)
      const targetH = Math.round(targetW * (h / w))
      const srcCanvas = document.createElement('canvas')
      srcCanvas.width = targetW
      srcCanvas.height = targetH
      const sctx = srcCanvas.getContext('2d')
      sctx.drawImage(video, 0, 0, targetW, targetH)
      const cropW = Math.round(targetW * 0.9)
      const cropH = Math.round(targetH * 0.55)
      const cropX = Math.round((targetW - cropW) / 2)
      const cropY = Math.round((targetH - cropH) / 2)
      const frameCanvas = document.createElement('canvas')
      frameCanvas.width = cropW
      frameCanvas.height = cropH
      const fctx = frameCanvas.getContext('2d')
      fctx.drawImage(srcCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH)
      const applyProc = true
      if (applyProc) {
        try {
          const img = fctx.getImageData(0, 0, cropW, cropH)
          const data = img.data
          const contrast = 60
          const brightness = 12
          const factor = (259 * (contrast + 255)) / (255 * (259 - contrast))
          for (let i = 0; i < data.length; i += 4) {
            let r = data[i]
            let g = data[i + 1]
            let b = data[i + 2]
            const gray = (0.2126 * r + 0.7152 * g + 0.0722 * b)
            let v = gray
            v = factor * (v - 128) + 128 + brightness
            v = v < 0 ? 0 : (v > 255 ? 255 : v)
            data[i] = data[i + 1] = data[i + 2] = v
          }
          fctx.putImageData(img, 0, 0)
        } catch (_e) {}
      }
      const blob = await new Promise(resolve => frameCanvas.toBlob(resolve, 'image/jpeg', 0.8))
      const file = new File([blob], 'frame.jpg', { type: 'image/jpeg' })
      const fd = new FormData()
      fd.append('frame', file)
      let data
      try {
        const runtimeBase = process.env.REACT_APP_API_BASE || ''
        const base = runtimeBase.replace(/\/+$/,'')
        const url = `${base}/api/recognize?region=br`
        const resp = await fetch(url, {
          method: 'POST',
          body: fd
        })
        data = await resp.json()
      } catch (e) {
        const info = { error: 'fetch_failed', detail: String(e && e.message || e) }
        if (onRaw) onRaw(info)
        if (onError) onError(info)
        return
      }
      if (onRaw) onRaw(data)
      if (data && data.error) {
        if (onError) onError({ error: data.error, detail: data.detail || data.raw || '' })
      }
      const plates = Array.isArray(data.plates) ? data.plates : []
      if (plates.length && onRecognize) onRecognize(plates)
      if (!plates.length) {
        // no result this cycle
      }
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!active || !ready) {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      return
    }
    if (!timerRef.current) {
      timerRef.current = setInterval(() => {
        if (!busy) capture()
      }, 200)
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [active, ready, busy])

  useEffect(() => {
    return () => {
      const s = videoRef.current && videoRef.current.srcObject
      if (s && s.getTracks) s.getTracks().forEach(t => t.stop())
    }
  }, [])

  useEffect(() => {
    if (!isIOS) start()
  }, [])


  const toggleTorch = async () => {
    const t = trackRef.current
    try {
      const caps = t && t.getCapabilities && t.getCapabilities()
      if (!caps || !caps.torch) return
      const next = !torchOn
      setTorchOn(next)
      await t.applyConstraints({ advanced: [{ torch: next }] }).catch(() => {})
    } catch (_e) {}
  }

  const stop = () => {
    setActive(false)
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    const s = videoRef.current && videoRef.current.srcObject
    if (s && s.getTracks) s.getTracks().forEach(t => t.stop())
    if (videoRef.current) videoRef.current.srcObject = null
    setReady(false)
    setStatus('aguardando')
  }

  return (
    <div>
      <div className="video-wrap">
        <video className="video" ref={videoRef} playsInline muted style={{ display: active && !previewProcessed ? 'block' : 'none' }} />
        <div className="overlay">
          <div className="frame" />
        </div>
      </div>
      <div className="actions">
        <button className="button" onClick={active ? stop : start} disabled={!active && busy}>
          {active ? 'Parar Leitura' : 'Ler Placas'}
        </button>
        <button className="button" onClick={toggleTorch} title={torchOn ? 'Desligar flash' : 'Ligar flash'} style={{ width: 44 }}>
          ⚡
        </button>
      </div>
      {!active && (
        <div style={{ marginTop: 10, textAlign: 'center', color: '#5b6b84', fontSize: 14 }}>
          {status === 'aguardando' && 'Clique em Ler Placas e permita o uso da câmera.'}
          {status === 'permissao_negada' && 'Permissão negada. Habilite a câmera no navegador.'}
          {status === 'camera_nao_encontrada' && 'Nenhuma câmera encontrada.'}
          {status === 'erro_camera' && 'Erro ao acessar a câmera.'}
        </div>
      )}
      <canvas ref={canvasRef} style={{ display: active && previewProcessed ? 'block' : 'none', width: '100%' }} />
    </div>
  )
}