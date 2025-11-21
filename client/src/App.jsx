import React, { useEffect, useMemo, useState } from 'react'
import CameraCapture from './CameraCapture'
import ResultsTable from './ResultsTable'
 

export default function App() {
  const [records, setRecords] = useState([])
  const minConfidence = 60
  const seen = useMemo(() => new Set(records.map(r => r.plate)), [records])
  const lastPlates = useMemo(() => records.slice(0, 5).map(r => r.plate), [records])
  const API_BASE = (process.env.REACT_APP_API_BASE || '').replace(/\/+$/,'')
  const [debugInfo, setDebugInfo] = useState(null)
  const debug = /[?&]debug=1/.test(window.location.search) || (typeof localStorage !== 'undefined' && localStorage.getItem('DEBUG') === '1')
  const [successPlate, setSuccessPlate] = useState('')
  const [stats, setStats] = useState({ total: 0, byPlate: {} })
  const [errorMsg, setErrorMsg] = useState('')
  const [manualPlate, setManualPlate] = useState('')
  const [installEvt, setInstallEvt] = useState(null)


  const beep = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext
      const ctx = new Ctx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.15, ctx.currentTime)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.12)
    } catch (_e) {}
  }

  const handleRecognize = (items) => {
    const ts = new Date()
    const tsStr = ts.toISOString()
    const normalize = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    const mercosul = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/
    const toMercosul = (raw) => {
      let s = normalize(raw)
      if (!s) return null
      s = s.slice(0, 7)
      return mercosul.test(s) ? s : null
    }
    const candidates = []
    items.forEach(p => {
      candidates.push({ plate: p.plate, confidence: p.confidence })
    })
    let best = null
    candidates.forEach(c => {
      const fixed = toMercosul(c.plate)
      if (!fixed) return
      if (typeof c.confidence !== 'number' || c.confidence < minConfidence) return
      if (seen.has(fixed)) return
      if (!best || c.confidence > best.confidence) best = { plate: fixed, confidence: c.confidence }
    })
    if (best) {
      const row = { plate: best.plate, confidence: best.confidence, region: 'br', timestamp: tsStr }
      setRecords(prev => [row, ...prev])
      setStats(prev => {
        const bp = { ...prev.byPlate }
        bp[best.plate] = (bp[best.plate] || 0) + 1
        return { total: prev.total + 1, byPlate: bp }
      })
      beep()
      setSuccessPlate(best.plate)
      setTimeout(() => setSuccessPlate(''), 900)
    }
    if (debug) setDebugInfo({ items })
  }

  const handleClear = () => setRecords([])

  

  const downloadExcel = async () => {
    try {
      const XLSX = await import('xlsx')
      const header = ["Placa", "DataHora"]
      const rows = records.map(r => [r.plate, r.timestamp])
      const ws = XLSX.utils.aoa_to_sheet([header, ...rows, [], ["Total lidas", records.length]])
      ws['!cols'] = [
        { wch: 16 },
        { wch: 24 }
      ]
      ws['!autofilter'] = { ref: 'A1:B1' }
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Leituras')
      XLSX.writeFile(wb, 'leituras-placas.xlsx')
    } catch (_e) {}
  }

  useEffect(() => {
    try { console.log('app-mounted') } catch (_e) {}
  }, [])
  useEffect(() => {
    const handler = (e) => {
      e.preventDefault()
      setInstallEvt(e)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])
  

  const handleManualRegister = () => {
    const normalize = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    const mercosul = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/
    const p = normalize(manualPlate)
    if (!mercosul.test(p)) {
      setErrorMsg('Placa inválida. Formato Mercosul: AAA1A23')
      return
    }
    if ([...seen].includes(p)) {
      setErrorMsg('Placa já registrada na lista')
      return
    }
    const tsStr = new Date().toISOString()
    setRecords(prev => [{ plate: p, confidence: 99, region: 'br', timestamp: tsStr }, ...prev])
    setManualPlate('')
    beep()
    setSuccessPlate(p)
    setTimeout(() => setSuccessPlate(''), 900)
    setErrorMsg('')
  }

  return (
    <div className="container">
      <button className="icon-button" onClick={promptInstall} title="Instalar aplicativo">⤓</button>
      <div className="title" style={{ textAlign: 'center' }}>BATY CAR APP</div>
      <div className="card" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="badge">Placas lidas: {records.length}</div>
          <div className="chips">
            {lastPlates.map(p => (
              <span key={p} className="chip">{p}</span>
            ))}
          </div>
          <button className="button muted" onClick={handleClear}>Limpar lista</button>
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'center' }}>
        <div className="col" style={{ maxWidth: 800 }}>
          <div className="card">
            <CameraCapture
              onRecognize={handleRecognize}
              onRaw={debug ? setDebugInfo : undefined}
              onError={info => {
                const err = String(info && info.error || '')
                const det = String(info && (info.detail || info.raw || ''))
                if (err === 'fetch_failed') {
                  const isLocalhost = typeof window !== 'undefined' && /localhost|127\.0\.0\.1/i.test(window.location.host)
                  const msg = isLocalhost
                    ? `Falha de conexão com API local`
                    : `API não acessível. Publique front e backend no mesmo domínio HTTPS.`
                  setErrorMsg(msg)
                  return
                }
                setErrorMsg(`Erro no reconhecimento: ${err} ${det}`)
              }}
            />
          </div>
          {/* removed API Base UI */}
          <div className="card" style={{ marginTop: 12 }}>
            <div className="actions-center">
              <button className="button" onClick={downloadExcel}>Baixar Excel (.xlsx)</button>
            </div>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <div className="actions-center">
              <input type="text" placeholder="Digitar placa (AAA1A23)" value={manualPlate} onChange={e => setManualPlate(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
              <button className="button" onClick={handleManualRegister} disabled={!manualPlate}>Registrar manual</button>
            </div>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <div className="badge">Estatísticas</div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
              <div className="chip">Tentativas: {stats.total}</div>
              <div className="chip">Únicas: {records.length}</div>
            </div>
          </div>
          {successPlate && (
            <div className="card" style={{ marginTop: 12, background: '#16a34a', color: 'white', textAlign: 'center' }}>
              <div style={{ fontSize: 28, fontWeight: 700, padding: 16 }}>LIDA: {successPlate}</div>
            </div>
          )}
          {debug && debugInfo && (
            <div className="card" style={{ marginTop: 12 }}>
              <div className="badge">Debug</div>
              <div style={{ fontSize: 12, color: '#5b6b84', marginTop: 8 }}>
                {debugInfo.error && (
                  <div>
                    <div>Erro backend: {String(debugInfo.error)}</div>
                    <div>{String(debugInfo.detail || debugInfo.raw || '')}</div>
                  </div>
                )}
                {Array.isArray(debugInfo.plates) && (
                  <div>
                    <div>Último retorno do backend:</div>
                    <ul>
                      {debugInfo.plates.slice(0, 5).map((p, i) => (
                        <li key={i}>{p.plate} ({Math.round(p.confidence)}%)</li>
                      ))}
                    </ul>
                  </div>
                )}
                {Array.isArray(debugInfo.items) && (
                  <div>
                    <div>Candidatos avaliados:</div>
                    <ul>
                      {debugInfo.items.slice(0, 5).map((p, i) => (
                        <li key={i}>{p.plate} ({Math.round(p.confidence)}%)</li>
                      ))}
                    </ul>
                  </div>
                )}
                {Array.isArray(debugInfo.rejections) && (
                  <div>
                    <div>Rejeições:</div>
                    <ul>
                      {debugInfo.rejections.slice(0, 5).map((r, i) => (
                        <li key={i}>{r.plate} - {r.reason}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
          {errorMsg && (
            <div className="card" style={{ marginTop: 12, background: '#ef4444', color: 'white' }}>
              <div style={{ padding: 12, fontWeight: 600 }}>Erro: {errorMsg}</div>
            </div>
          )}
          <div className="card" style={{ marginTop: 12 }}>
            <ResultsTable rows={records} />
          </div>
        </div>
      </div>
    </div>
  )
}

  const promptInstall = async () => {
    try {
      const isIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent)
      if (isIOS) {
        alert('No iPhone/iPad: Compartilhar ▶ Adicionar à Tela de Início')
        return
      }
      if (installEvt) {
        await installEvt.prompt()
        await installEvt.userChoice
        setInstallEvt(null)
      } else {
        alert('No Android: menu do navegador ▶ Instalar aplicativo')
      }
    } catch (_e) {}
  }