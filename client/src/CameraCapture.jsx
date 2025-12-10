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
  const [sendFullFrame, setSendFullFrame] = useState(true)
  const isAndroid = /Android/i.test(navigator.userAgent)
  const frameRef = useRef(null)
  // Add fast mode state and behavior
  const [fastMode, setFastMode] = useState(isAndroid)
  useEffect(() => { if (fastMode) setSendFullFrame(false) }, [fastMode])
  const start = async () => {
    try {
      setActive(true)
      setStatus('aguardando')
      const constraints = { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }
      let stream
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints)
      } catch (_e) {
        // fallback se dispositivo não suportar resolução ideal
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      }
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

  // Clique alterna leitura
  const stop = () => {
    try {
      setActive(false)
      setStatus('parado')
      const t = timerRef.current
      if (t) clearTimeout(t)
      setReady(false)
      const track = trackRef.current
      if (track && typeof track.stop === 'function') track.stop()
      const vid = videoRef.current
      if (vid) {
        try { vid.pause() } catch (_) {}
        try { vid.srcObject = null } catch (_) {}
      }
      // Garantir que a lanterna desligue ao parar
      try { if (track && track.applyConstraints) track.applyConstraints({ advanced: [{ torch: false }] }) } catch (_) {}
      setTorchOn(false)
    } catch (_) {}
  }

  const toggleActive = () => {
    if (active) stop()
    else start()
  }

  const toggleTorch = async () => {
    const t = trackRef.current
    try {
      const desired = !torchOn
      // 1) Tentar applyConstraints com/sem checagem de capabilities
      try {
        const caps = t && t.getCapabilities && t.getCapabilities()
        if (!caps || typeof caps.torch === 'undefined') {
          await t.applyConstraints({ advanced: [{ torch: desired }] })
        } else if (caps.torch) {
          await t.applyConstraints({ advanced: [{ torch: desired }] })
        }
      } catch (_) {}
      // 2) Verificar via getSettings
      try {
        const settings = t && t.getSettings && t.getSettings()
        if (settings && typeof settings.torch !== 'undefined') {
          setTorchOn(!!settings.torch)
          return
        }
      } catch (_) {}
      // 3) Fallback: tentar ImageCapture.setOptions
      try {
        // Alguns dispositivos expõem torch via ImageCapture
        if (window.ImageCapture && t) {
          const ic = new ImageCapture(t)
          try {
            const pc = ic.getPhotoCapabilities && await ic.getPhotoCapabilities()
            if (pc && pc.torch) {
              await (ic.setOptions ? ic.setOptions({ torch: desired }) : Promise.resolve())
            }
          } catch (_) {}
        }
      } catch (_) {}
      // 4) Último recurso: confiar no estado desejado
      setTorchOn(desired)
    } catch (_e) {}
  }

  const ensureTorchOn = async () => {
    const t = trackRef.current
    try {
      const desired = true
      try { await t.applyConstraints({ advanced: [{ torch: desired }] }) } catch (_) {}
      try {
        const settings = t && t.getSettings && t.getSettings()
        if (settings && typeof settings.torch !== 'undefined') {
          setTorchOn(!!settings.torch)
          return !!settings.torch
        }
      } catch (_) {}
      try {
        if (window.ImageCapture && t) {
          const ic = new ImageCapture(t)
          const pc = ic.getPhotoCapabilities && await ic.getPhotoCapabilities()
          if (pc && pc.torch) {
            await (ic.setOptions ? ic.setOptions({ torch: desired }) : Promise.resolve())
            setTorchOn(true)
            return true
          }
        }
      } catch (_) {}
      setTorchOn(true)
      return true
    } catch (_e) { return false }
  }

  const capture = async () => {
    if (!videoRef.current) return
    setBusy(true)
    try {
      const video = videoRef.current
      const w = video.videoWidth || 640
      const h = video.videoHeight || 480
      const targetW = Math.min(isAndroid ? (fastMode ? 864 : 1024) : (fastMode ? 960 : 1280), w)
      const targetH = Math.round(targetW * (h / w))
      const srcCanvas = document.createElement('canvas')
      srcCanvas.width = targetW
      srcCanvas.height = targetH
      const sctx = srcCanvas.getContext('2d')
      // Pré-processamento leve opcional para aumentar contraste/brilho
      if (procToggle) {
        try { sctx.filter = 'contrast(1.25) brightness(1.08) saturate(1.05)'; } catch (_) {}
      }
      sctx.drawImage(video, 0, 0, targetW, targetH)
      // Se escuro, tentar ligar o flash automaticamente (Android / suportado)
      try {
        const sampleW = Math.min(320, targetW)
        const sampleH = Math.min(240, targetH)
        const id = sctx.getImageData(0, 0, sampleW, sampleH)
        const d = id.data
        let sum = 0
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i+1], b = d[i+2]
          sum += 0.2126*r + 0.7152*g + 0.0722*b
        }
        const avgLum = sum / (sampleW*sampleH)
        if (avgLum < 55 && isAndroid) await ensureTorchOn()
      } catch (_) {}
      // crop guiado pelo frame visual, quando desativado envio de quadro inteiro
      let frameCanvas = srcCanvas
      if (!sendFullFrame) {
        const videoRect = video.getBoundingClientRect()
        const frameEl = frameRef.current
        const frameRect = frameEl ? frameEl.getBoundingClientRect() : null
        let cropX, cropY, cropW, cropH
        if (frameRect && videoRect && videoRect.width > 0 && videoRect.height > 0) {
          const relLeft = (frameRect.left - videoRect.left) / videoRect.width
          const relTop = (frameRect.top - videoRect.top) / videoRect.height
          const relW = frameRect.width / videoRect.width
          const relH = frameRect.height / videoRect.height
          cropW = Math.round(targetW * relW)
          cropH = Math.round(targetH * relH)
          cropX = Math.round(targetW * relLeft)
          cropY = Math.round(targetH * relTop)
          try {
            const qs = new URLSearchParams(window.location.search)
            if (qs.get('debug') === '1') {
              console.log('[overlay] videoRect', videoRect)
              console.log('[overlay] frameRect', frameRect)
              console.log('[overlay] rel', { relLeft, relTop, relW, relH })
              console.log('[overlay] crop', { cropX, cropY, cropW, cropH, targetW, targetH })
            }
          } catch (_) {}
        } else {
          // fallback: centro aproximado
          cropW = Math.round(targetW * 0.85)
          cropH = Math.round(targetH * 0.55)
          cropX = Math.round((targetW - cropW) / 2)
          cropY = Math.round((targetH - cropH) / 2)
        }
        const cropCanvas = document.createElement('canvas')
        cropCanvas.width = cropW
        cropCanvas.height = cropH
        const cctx = cropCanvas.getContext('2d')
        cctx.drawImage(srcCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH)
        frameCanvas = cropCanvas
      }
      const jpegQuality = fastMode ? (isAndroid ? 0.84 : 0.88) : (isAndroid ? 0.88 : 0.96)
      let blob = await new Promise(resolve => frameCanvas.toBlob(resolve, 'image/jpeg', jpegQuality))
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
      // Tratamento de dev: CRA pode rodar em 3000 ou 3001
      const isDevCRA = /localhost:(3000|3001)$/i.test(origin)
      const host = (() => { try { return new URL(origin).host } catch (_e) { return origin } })()
      const isVercel = /vercel\.app$/i.test(String(host))

      // Região: permitir override via query (?region=br|us|eu), padrão 'br'
      const regionParam = (() => { try { const qs = new URLSearchParams(window.location.search); const r = (qs.get('region') || 'br').toLowerCase(); return ['br','us','eu'].includes(r) ? r : 'br' } catch (_) { return 'br' } })()

      // Bases específicas: FastAPI fixo em produção Vercel e padrão remoto também no dev
      const envBaseRaw = ((process.env.REACT_APP_FASTAPI_BASE || process.env.REACT_APP_API_BASE) || '').trim()
      const defaultFastApi = 'https://openalpr-fastapi-1.onrender.com'
      const hasAbsoluteEnv = /^https?:\/\//i.test(envBaseRaw)
      let fastApiBase = (hasAbsoluteEnv ? envBaseRaw : defaultFastApi).replace(/\/+$/,'')
      // Permitir override via query string ?fastapi=https://... (útil para testes)
      try {
        const qs = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
        const qp = qs && qs.get('fastapi')
        if (qp && /^https?:\/\//i.test(qp)) fastApiBase = qp.replace(/\/+$/,'')
      } catch (_) {}
      // Ajuste: default do backend local é 5001 (não 5000)
      let apiOriginBase = (isDevCRA ? 'http://localhost:5001' : origin).replace(/\/+$/,'')
      // Override de API base via env (REACT_APP_API_BASE) e via query (?api=https://...)
      try {
        const envApiBaseRaw = (process.env.REACT_APP_API_BASE || '').trim()
        if (isDevCRA) {
          // No dev, permitir qualquer override absoluto
          if (/^https?:\/\//i.test(envApiBaseRaw)) apiOriginBase = envApiBaseRaw.replace(/\/+$/,'')
        } else {
          // Em produção, só aceitar override se for o MESMO host e HTTPS (evita mixed content)
          if (/^https?:\/\//i.test(envApiBaseRaw)) {
            try {
              const u = new URL(envApiBaseRaw)
              const sameHost = (u.host === host) && (u.protocol === 'https:')
              if (sameHost) apiOriginBase = u.origin
            } catch (_) {}
          }
        }
        const qs2 = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
        const qp2 = qs2 && qs2.get('api')
        // Em produção, restringir override via query a HTTPS para evitar bloqueio do navegador
        if (qp2 && (/^https:\/\//i.test(qp2) || isDevCRA)) apiOriginBase = qp2.replace(/\/+$/,'')
      } catch (_) {}
      // Flag para desativar fallback e forçar FastAPI explicitamente: ?fastapionly=1
      const fastApiOnly = (() => { try { const p = new URLSearchParams(window.location.search).get('fastapionly'); return p === '1' } catch (_) { return false } })()
      const preferFastApiOnly = !!fastApiOnly
      // Em produção, tentar FastAPI como fallback (primeiro); no dev, só se fastapionly=1
      const shouldTryFastApi = preferFastApiOnly || (!isDevCRA)

      const pickPlateFromData = (d) => {
        const first = Array.isArray(d?.plates) ? d.plates[0] : null
        const plate = (first && first.plate) ? first.plate : ''
        if (plate) {
          const conf = typeof (first && first.confidence) === 'number' ? first.confidence : Number(first && first.confidence) || 0
          return { plate, confidence: conf }
        }
        const resultsFirst = Array.isArray(d?.results) ? d.results[0] : null
        const plate2 = (resultsFirst && resultsFirst.plate) ? resultsFirst.plate : ''
        if (plate2) return { plate: plate2, confidence: Number(resultsFirst.confidence) || 0 }
        return null
      }

      const resolveFastApiEndpoint = () => {
        try {
          const u = new URL(fastApiBase)
          const hasPath = !!(u.pathname && u.pathname !== '/' )
          // Se o usuário forneceu um endpoint completo, usar como está.
          if (hasPath) return u.toString()
          // Caso contrário, usar /read-plate padrão.
          u.pathname = '/read-plate'
          u.search = `?region=${encodeURIComponent(regionParam)}`
          return u.toString()
        } catch (_e) {
          // Fallback básico
          return `${fastApiBase}/read-plate?region=${encodeURIComponent(regionParam)}`
        }
      }

      let best = null
      const attempts = []
      const timeoutMs = isAndroid ? 15000 : 12000
      // 1) FastAPI (suporta tanto endpoint completo quanto /read-plate) — desativado por padrão no local
      if (shouldTryFastApi) {
        const controller2 = new AbortController()
        const timeoutId2 = setTimeout(() => controller2.abort(), timeoutMs)
        const u2 = resolveFastApiEndpoint()
        try {
          console.log('[alpr] tentando FastAPI:', u2)
          const isBytes = /bytes|recognize-bytes|octet/i.test(u2)
          let resp2
          if (isBytes) {
            resp2 = await fetch(u2, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: blob, signal: controller2.signal, mode: 'cors', credentials: 'omit' })
          } else {
            const fd2 = new FormData()
            fd2.append('file', file)
            resp2 = await fetch(u2, { method: 'POST', body: fd2, signal: controller2.signal, mode: 'cors', credentials: 'omit' })
          }
          if (!resp2.ok) console.warn('[alpr] FastAPI falhou status', resp2.status)
          let j2 = null
          try { j2 = await resp2.json() } catch (_e) { j2 = null }
          attempts.push({ route: 'fastapi', ok: !!pickPlateFromData(j2), status: resp2.status, data: j2 })
          if (onRaw) onRaw({ step: 'fastapi', data: j2 })
          best = pickPlateFromData(j2)
          if (best) console.log('[alpr] sucesso via FastAPI', best)
        } catch (eFast) {
          const detail = String(eFast && eFast.message || eFast)
          attempts.push({ route: 'fastapi', ok: false, error: detail })
          console.warn('[alpr] erro FastAPI:', detail)
          if (onRaw) onRaw({ error: 'fastapi_failed', detail })
        }
        clearTimeout(timeoutId2)
      }

      // 2) multipart para /api/recognize (mesmo domínio ou override)
      if (!best && !preferFastApiOnly && fastMode) {
        const controllerBytesFast = new AbortController()
        const timeoutIdBytesFast = setTimeout(() => controllerBytesFast.abort(), timeoutMs)
        const uBytesFast = `${apiOriginBase}/api/recognize-bytes?region=${encodeURIComponent(regionParam)}`
        try {
          console.log('[alpr] fast-mode: Node /api/recognize-bytes primeiro:', uBytesFast)
          const respBF = await fetch(uBytesFast, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: blob, signal: controllerBytesFast.signal, mode: 'cors', credentials: 'omit' })
          if (!respBF.ok) console.warn('[alpr] fast-mode recognize-bytes falhou status', respBF.status)
          let jBF = null
          try { jBF = await respBF.json() } catch (_e) { jBF = null }
          attempts.push({ route: 'recognize-bytes-fast', ok: !!pickPlateFromData(jBF), status: respBF.status, data: jBF })
          if (onRaw) onRaw({ step: 'recognize-bytes-fast', data: jBF })
          best = pickPlateFromData(jBF)
          if (best) console.log('[alpr] sucesso via Node recognize-bytes (fast)', best)
        } catch (eBF) {
          const detail = String(eBF && eBF.message || eBF)
          attempts.push({ route: 'recognize-bytes-fast', ok: false, error: detail })
          console.warn('[alpr] erro recognize-bytes (fast):', detail)
          if (onRaw) onRaw({ error: 'recognize_bytes_fast_failed', detail })
        }
        clearTimeout(timeoutIdBytesFast)
      }

      // 2) multipart para /api/recognize (mesmo domínio ou override)
      if (!best && !preferFastApiOnly) {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
        const u1 = `${apiOriginBase}/api/recognize?region=${encodeURIComponent(regionParam)}`
        const fd = new FormData()
        fd.append('frame', file)
        try {
          console.log('[alpr] tentando Node /api/recognize:', u1)
          const resp = await fetch(u1, { method: 'POST', body: fd, signal: controller.signal, mode: 'cors', credentials: 'omit' })
          if (!resp.ok) console.warn('[alpr] recognize falhou status', resp.status)
          let j = null
          try { j = await resp.json() } catch (_e) { j = null }
          attempts.push({ route: 'recognize', ok: !!pickPlateFromData(j), status: resp.status, data: j })
          if (onRaw) onRaw({ step: 'recognize', data: j })
          best = pickPlateFromData(j)
          if (best) console.log('[alpr] sucesso via Node /api/recognize', best)
        } catch (e2) {
          const detail = String(e2 && e2.message || e2)
          attempts.push({ route: 'recognize', ok: false, error: detail })
          console.warn('[alpr] erro recognize:', detail)
          if (onRaw) onRaw({ error: 'recognize_failed', detail })
        }
        clearTimeout(timeoutId)
      }

      // 3) bytes para /api/recognize-bytes (mesmo domínio ou override)
      if (!best && !preferFastApiOnly && !fastMode) {
        const controller3 = new AbortController()
        const timeoutId3 = setTimeout(() => controller3.abort(), timeoutMs)
        const u3 = `${apiOriginBase}/api/recognize-bytes?region=${encodeURIComponent(regionParam)}`
        try {
          console.log('[alpr] tentando Node /api/recognize-bytes:', u3)
          const resp3 = await fetch(u3, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: blob, signal: controller3.signal, mode: 'cors', credentials: 'omit' })
          if (!resp3.ok) console.warn('[alpr] recognize-bytes falhou status', resp3.status)
          let j3 = null
          try { j3 = await resp3.json() } catch (_e) { j3 = null }
          attempts.push({ route: 'recognize-bytes', ok: !!pickPlateFromData(j3), status: resp3.status, data: j3 })
          if (onRaw) onRaw({ step: 'recognize-bytes', data: j3 })
          best = pickPlateFromData(j3)
          if (best) console.log('[alpr] sucesso via Node /api/recognize-bytes', best)
        } catch (e3) {
          const detail = String(e3 && e3.message || e3)
          attempts.push({ route: 'recognize-bytes', ok: false, error: detail })
          console.warn('[alpr] erro recognize-bytes:', detail)
          if (onRaw) onRaw({ error: 'recognize_bytes_failed', detail })
        }
        clearTimeout(timeoutId3)
      }

      const hadResponseNoPlate = attempts.some(a => (typeof a.status === 'number') && !pickPlateFromData(a.data))
      const allFailed = attempts.every(a => a && (a.error || (!a.ok && !a.status)))
      if (!best) {
        const info = allFailed ? { error: 'fetch_failed', detail: 'all_routes_failed', attempts } : { error: 'no_plate', detail: hadResponseNoPlate ? 'no_plate_from_provider' : 'no_attempt' }
        if (onError) onError(info)
      }
      if (best && onRecognize) {
        onRecognize([best])
      }
    } catch (e) {
      const msg = String((e && e.message) || e)
      if (onError) onError({ error: 'exception', detail: msg })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!active || busy || !ready) return
    const t = setTimeout(() => capture(), (fastMode ? 400 : 800))
    timerRef.current = t
    return () => clearTimeout(t)
  }, [active, busy, ready, procToggle, sendFullFrame, fastMode])

  useEffect(() => {
    return () => {
      try {
        const t = timerRef.current
        if (t) clearTimeout(t)
      } catch (_) {}
      try {
        const track = trackRef.current
        if (track && typeof track.stop === 'function') track.stop()
      } catch (_) {}
    }
  }, [])

  return (
    <div>
      <div className="actions-center" style={{ gap: 8, marginBottom: 8 }}>
        <button className="button" onClick={active ? stop : start}>{active ? 'Parar Leitura' : 'Ler Placas'}</button>
        <button className="button" onClick={toggleTorch} disabled={!ready}>Lanterna {torchOn ? 'On' : 'Off'}</button>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={fastMode} onChange={e => setFastMode(e.target.checked)} />
          Modo rápido
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={sendFullFrame} onChange={e => setSendFullFrame(e.target.checked)} />
          Enviar quadro inteiro
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={procToggle} onChange={e => setProcToggle(e.target.checked)} />
          Pré-processar
        </label>
        <span className="chip" style={{ background: '#eef' }}>Status: {status}</span>
      </div>
      <div className="video-wrap" style={{ display: 'flex', justifyContent: 'center', position: 'relative' }}>
        <video ref={videoRef} autoPlay muted playsInline className="video" style={{ maxWidth: '100%', borderRadius: 8, boxShadow: '0 2px 12px rgba(0,0,0,0.2)' }} />
        <div className="overlay">
          <div className="frame" ref={frameRef} onClick={toggleActive} style={{ cursor: 'pointer' }} />
        </div>
        <canvas ref={canvasRef} style={{ display: 'none' }} />
      </div>
    </div>
  )
}
