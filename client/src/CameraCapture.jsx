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

  // Ajuste: manter quadro inteiro por padrão também na Vercel (pode melhorar leitura)
  useEffect(() => {
    try {
      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      const host = (() => { try { return new URL(origin).host } catch (_e) { return origin } })()
      const isVercel = /vercel\.app$/i.test(String(host))
      if (isVercel) setSendFullFrame(true)
    } catch (_) {}
  }, [])

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
        const cropW = Math.round(targetW * 0.9)
        const cropH = Math.round(targetH * 0.65)
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
      const host = (() => { try { return new URL(origin).host } catch (_e) { return origin } })()
      const isVercel = /vercel\.app$/i.test(String(host))

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
      const apiOriginBase = (isDevCRA ? 'http://localhost:5000' : origin).replace(/\/+$/,'')
      // Flag para desativar fallback e forçar FastAPI explicitamente: ?fastapionly=1
      const fastApiOnly = (() => { try { const p = new URLSearchParams(window.location.search).get('fastapionly'); return p === '1' } catch (_) { return false } })()
      const preferFastApiOnly = !!fastApiOnly
      // Produção usa exclusivamente /api/* no mesmo domínio; FastAPI só se solicitado via fastapionly
      const shouldTryFastApi = preferFastApiOnly

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
          u.search = '?region=br'
          return u.toString()
        } catch (_e) {
          // Fallback básico
          return `${fastApiBase}/read-plate?region=br`
        }
      }

      let best = null
      const attempts = []
      // 1) FastAPI (suporta tanto endpoint completo quanto /read-plate) — desativado por padrão no local
      if (shouldTryFastApi) {
        const controller2 = new AbortController()
        const timeoutId2 = setTimeout(() => controller2.abort(), 12000)
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

      // 2) multipart para /api/recognize (mesmo domínio)
      if (!best && !preferFastApiOnly) {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 12000)
        const u1 = `${apiOriginBase}/api/recognize?region=br`
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

      // 3) bytes para /api/recognize-bytes (mesmo domínio)
      if (!best && !preferFastApiOnly) {
        const controller3 = new AbortController()
        const timeoutId3 = setTimeout(() => controller3.abort(), 12000)
        const u3 = `${apiOriginBase}/api/recognize-bytes?region=br`
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

      if (best && onRecognize) {
        onRecognize([best])
      } else if (!best && onError) {
        console.warn('[alpr] todas as rotas falharam', attempts)
        onError({ error: 'fetch_failed', detail: 'all_routes_failed', attempts })
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
      }, 250)
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
