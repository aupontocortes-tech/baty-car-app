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
  const [sendFullFrame, setSendFullFrame] = useState(false)
  const isIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent)

  const start = async () => {
    try {
      setActive(true)
      setStatus('aguardando')
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      videoRef.current.srcObject = stream
      trackRef.current = stream.getVideoTracks && stream.getVideoTracks()[0]
      await videoRef.current.play()
      setReady(true)
      setStatus('lendo')
    } catch (e) {
      const msg = String((e && e.name) || '')
      if (msg === 'NotAllowedError') setStatus('permissao_negada')
      else if (msg === 'NotFoundError') setStatus('camera_nao_encontrada')
      else setStatus('erro_camera')
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
      // crop central region unless sending full frame
      let frameCanvas = srcCanvas
      if (!sendFullFrame) {
        const cropW = Math.round(targetW * 0.8)
        const cropH = Math.round(targetH * 0.35)
        const cropX = Math.round((targetW - cropW) / 2)
        const cropY = Math.round((targetH - cropH) / 2)
        const cropCanvas = document.createElement('canvas')
        cropCanvas.width = cropW
        cropCanvas.height = cropH
        const cctx = cropCanvas.getContext('2d')
        cctx.drawImage(srcCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH)
        frameCanvas = cropCanvas
      }
      let blob = await new Promise(resolve => frameCanvas.toBlob(resolve, 'image/jpeg', 0.96))
      if (!blob) {
        const dataUrl = frameCanvas.toDataURL('image/jpeg', 0.9)
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
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      const isDevCRA = /localhost:3000$/i.test(origin)
      const base = (((process.env.REACT_APP_API_BASE && process.env.REACT_APP_API_BASE.trim())) || (isDevCRA ? 'http://localhost:5000' : origin)).replace(/\/+$/,'')
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 8000)
      const u1 = `${base}/api/recognize?region=br`
      const fd = new FormData()
      fd.append('frame', file)
      try {
        const resp = await fetch(u1, { method: 'POST', body: fd, signal: controller.signal })
        let j = null
        try { j = await resp.json() } catch (_e) { j = null }
        if (!resp.ok) {
          if (j && (j.error || j.plates || j.results)) {
            data = j
          } else {
            throw new Error(`status_${resp.status}`)
          }
        } else {
          data = j || {}
        }
      } catch (e2) {
        const info = { error: 'fetch_failed', detail: String(e2 && e2.message || e2) }
        if (onRaw) onRaw(info)
        if (onError) onError(info)
        clearTimeout(timeoutId)
        return
      }
      clearTimeout(timeoutId)
      if (onRaw) onRaw(data)
      if (data && data.error) {
        if (onError) onError({ error: data.error, detail: data.detail || data.raw || '' })
      }
      const first = Array.isArray(data?.plates) ? data.plates[0] : null
      const plate = (first && first.plate) ? first.plate : ''
      if (plate) {
        const conf = typeof (first && first.confidence) === 'number' ? first.confidence : Number(first && first.confidence) || 0
        if (onRecognize) onRecognize([{ plate, confidence: conf }])
      } else {
        const resultsFirst = Array.isArray(data?.results) ? data.results[0] : null
        const plate2 = (resultsFirst && resultsFirst.plate) ? resultsFirst.plate : ''
        if (plate2 && onRecognize) onRecognize([{ plate: plate2, confidence: Number(resultsFirst.confidence) || 0 }])
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
      }, 350)
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [active, ready, busy, sendFullFrame])

  useEffect(() => {
    return () => {
      const s = videoRef.current && videoRef.current.srcObject
      if (s && s.getTracks) s.getTracks().forEach(t => t.stop())
    }
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
      <div className="actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="button" onClick={active ? stop : start} disabled={!active && busy}>
          {active ? 'Parar Leitura' : 'Ler Placas'}
        </button>
        <button className="button" onClick={toggleTorch} title={torchOn ? 'Desligar flash' : 'Ligar flash'} style={{ width: 44 }}>
          ⚡
        </button>
        <label style={{ fontSize: 12, color: '#5b6b84' }}>
          <input type="checkbox" checked={sendFullFrame} onChange={e => setSendFullFrame(e.target.checked)} /> Enviar quadro inteiro
        </label>
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
