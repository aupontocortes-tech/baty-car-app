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
      const targetW = Math.min(960, w)
      const targetH = Math.round(targetW * (h / w))
      const srcCanvas = document.createElement('canvas')
      srcCanvas.width = targetW
      srcCanvas.height = targetH
      const sctx = srcCanvas.getContext('2d')
      sctx.drawImage(video, 0, 0, targetW, targetH)
      const frameCanvas = srcCanvas
        let blob = await new Promise(resolve => frameCanvas.toBlob(resolve, 'image/jpeg', 0.92))
      if (!blob) {
        const dataUrl = frameCanvas.toDataURL('image/jpeg', 0.7)
        const comma = dataUrl.indexOf(',')
        const b64 = dataUrl.slice(comma + 1)
        const bin = atob(b64)
        const len = bin.length
        const arr = new Uint8Array(len)
        for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i)
        blob = new Blob([arr], { type: 'image/jpeg' })
      }
      const file = new File([blob], 'frame.jpg', { type: 'image/jpeg' })
      let data
      try {
        const runtimeBase = process.env.REACT_APP_API_BASE || ''
        const base = runtimeBase.replace(/\/+$/,'')
        const url = `${base}/api/recognize-bytes?region=br`
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: blob
        })
        if (!resp.ok) throw new Error(`status_${resp.status}`)
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
      const regions = Array.isArray(data?.regions) ? data.regions : []
      const alprFailed = !!(data && data.alpr_failed)
      const first = Array.isArray(data?.results) ? data.results[0] : null
      const plate = (first && first.plate) ? first.plate : ''
      if (plate) {
        const conf = typeof (first && first.confidence) === 'number' ? first.confidence : Number(first && first.confidence) || 0
        if (onRecognize) onRecognize([{ plate, confidence: conf }])
      } else {
        const plates = Array.isArray(data.plates) ? data.plates : []
        if (plates.length && onRecognize) {
          onRecognize(plates)
        } else {
          if (onError) onError({ error: 'no_plate', detail: 'Nenhuma placa encontrada' })
        }
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

  // iniciar somente ao clicar em "Ler Placas"


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
