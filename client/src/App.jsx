import React, { useEffect, useMemo, useState } from 'react'
import CameraCapture from './CameraCapture'
import ResultsTable from './ResultsTable'
import * as XLSX from 'xlsx'

export default function App() {
  const [records, setRecords] = useState([])
  const minConfidence = 0
  const seen = useMemo(() => new Set(records.map(r => r.plate)), [records])
  const lastPlates = useMemo(() => records.slice(0, 5).map(r => r.plate), [records])
  const API_BASE = (process && process.env && process.env.REACT_APP_API_BASE) ? String(process.env.REACT_APP_API_BASE).replace(/\/+$/,'') : ''
  const [debugInfo, setDebugInfo] = useState(null)
  const debug = /[?&]debug=1/.test(window.location.search) || (typeof localStorage !== 'undefined' && localStorage.getItem('DEBUG') === '1')
  const [excelHandle, setExcelHandle] = useState(null)
  const [excelFileName, setExcelFileName] = useState('')
  const [testUrl, setTestUrl] = useState('')
  const [successPlate, setSuccessPlate] = useState('')
  const [highContrast, setHighContrast] = useState(false)
  const [stats, setStats] = useState({ total: 0, byPlate: {} })
  const [errorMsg, setErrorMsg] = useState('')
  const [manualPlate, setManualPlate] = useState('')

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
    const digitsToLetters = { '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '8': 'B', '6': 'G', '7': 'T', '4': 'A' }
    const lettersToDigits = { O: '0', I: '1', Z: '2', S: '5', B: '8', G: '6', T: '7', A: '4' }
    const toMercosul = (raw) => {
      let s = normalize(raw)
      if (!s) return null
      s = s.slice(0, 7)
      const arr = s.split('')
      const fixLetter = (ch) => (digitsToLetters[ch] || ch).replace(/[^A-Z]/g, '')
      const fixDigit = (ch) => (lettersToDigits[ch] || ch).replace(/[^0-9]/g, '')
      if (arr[0]) arr[0] = fixLetter(arr[0])
      if (arr[1]) arr[1] = fixLetter(arr[1])
      if (arr[2]) arr[2] = fixLetter(arr[2])
      if (arr[3]) arr[3] = fixDigit(arr[3])
      if (arr[4]) arr[4] = fixLetter(arr[4])
      if (arr[5]) arr[5] = fixDigit(arr[5])
      if (arr[6]) arr[6] = fixDigit(arr[6])
      const out = arr.join('')
      return mercosul.test(out) ? out : null
    }
    const candidates = []
    items.forEach(p => {
      candidates.push({ plate: p.plate, confidence: p.confidence })
      if (Array.isArray(p.candidates)) {
        p.candidates.forEach(c => candidates.push({ plate: c.plate, confidence: c.confidence }))
      }
    })
    const byPlate = new Map()
    const rejections = []
    candidates.forEach(c => {
      const fixed = toMercosul(c.plate)
      if (!fixed) {
        rejections.push({ plate: c.plate, reason: 'nao_mercosul' })
        return
      }
      setStats(prev => {
        const bp = { ...prev.byPlate }
        bp[fixed] = (bp[fixed] || 0) + 1
        return { total: prev.total + 1, byPlate: bp }
      })
      if (seen.has(fixed)) {
        rejections.push({ plate: fixed, reason: 'duplicata' })
        return
      }
      const prev = byPlate.get(fixed)
      if (!prev || c.confidence > prev.confidence) byPlate.set(fixed, { plate: fixed, confidence: c.confidence })
    })
    const mapped = Array.from(byPlate.values()).map(p => ({
      plate: p.plate,
      confidence: p.confidence,
      region: 'br',
      timestamp: tsStr
    }))
    if (mapped.length) {
      setRecords(prev => [...mapped, ...prev])
      beep()
      setSuccessPlate(mapped[0].plate)
      setTimeout(() => setSuccessPlate(''), 900)
    }
    if (debug) setDebugInfo({ items, mapped, rejections })
  }

  const handleClear = () => setRecords([])

  const [uploadFile, setUploadFile] = useState(null)

  const downloadExcel = () => {
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
    if (excelHandle) {
      const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
      excelHandle.createWritable().then(w => w.write(data).then(() => w.close())).catch(() => {
        XLSX.writeFile(wb, 'leituras-placas.xlsx')
      })
    } else {
      XLSX.writeFile(wb, 'leituras-placas.xlsx')
    }
  }

  const handlePrint = () => {
    window.print()
  }

  useEffect(() => {
    if (!records.length) return
    const t = setTimeout(() => {
      downloadExcel()
    }, 1500)
    return () => clearTimeout(t)
  }, [records])

  const handleUpload = async () => {
    if (!uploadFile) return
    const fd = new FormData()
    fd.append('frame', uploadFile)
    const resp = await fetch(`${API_BASE}/api/recognize?region=br`, { method: 'POST', body: fd })
    const data = await resp.json()
    if (data && data.error) setErrorMsg(`Erro no reconhecimento: ${String(data.error)} ${String(data.detail || '')}`)
    const plates = Array.isArray(data.plates) ? data.plates : []
    if (plates.length) handleRecognize(plates)
    if (debug) setDebugInfo(data)
    setUploadFile(null)
  }

  const chooseExcelFile = async () => {
    try {
      const opts = {
        suggestedName: 'leituras-placas.xlsx',
        types: [{ description: 'Excel', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }]
      }
      const handle = await (window.showSaveFilePicker ? window.showSaveFilePicker(opts) : window.showOpenFilePicker(opts).then(x => x[0]))
      setExcelHandle(handle)
      setExcelFileName(handle && handle.name ? handle.name : 'leituras-placas.xlsx')
    } catch (_e) {}
  }

  const handleRecognizeUrl = async () => {
    const u = String(testUrl || '').trim()
    if (!u) return
    try {
      const resp = await fetch(`${API_BASE}/api/recognize-url?region=br&url=${encodeURIComponent(u)}`)
      const data = await resp.json()
      if (data && data.error) setErrorMsg(`Erro no reconhecimento: ${String(data.error)} ${String(data.detail || '')}`)
      const plates = Array.isArray(data.plates) ? data.plates : []
      if (plates.length) handleRecognize(plates)
      if (debug) setDebugInfo(data)
    } catch (e) {
      if (debug) setDebugInfo({ error: 'fetch_failed', detail: String(e && e.message || e) })
      setErrorMsg(`Falha de rede: ${String(e && e.message || e)}`)
    }
  }

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
            <CameraCapture onRecognize={handleRecognize} onRaw={debug ? setDebugInfo : undefined} onError={info => setErrorMsg(`Erro no reconhecimento: ${String(info.error)} ${String(info.detail || '')}`)} previewProcessed={highContrast} />
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <div className="actions-center">
              <button className="button" onClick={downloadExcel}>Baixar Excel (.xlsx)</button>
              <button className="button secondary" onClick={handlePrint}>Imprimir</button>
              <button className="button" onClick={chooseExcelFile}>Escolher arquivo Excel</button>
              {excelFileName && <div className="badge">Salvando em: {excelFileName}</div>}
              <input id="upload-file" className="file-input" type="file" accept="image/*" onChange={e => setUploadFile(e.target.files?.[0] || null)} />
              <label htmlFor="upload-file" className="button">Selecionar foto</label>
              <button className="button" onClick={handleUpload} disabled={!uploadFile}>Enviar foto</button>
              <label className="button secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <input type="checkbox" checked={highContrast} onChange={e => setHighContrast(e.target.checked)} /> Alto contraste
              </label>
            </div>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <div className="actions-center">
              <input type="text" placeholder="URL da imagem da placa" value={testUrl} onChange={e => setTestUrl(e.target.value)} style={{ flex: 1, minWidth: 280 }} />
              <button className="button" onClick={handleRecognizeUrl} disabled={!testUrl}>Reconhecer URL</button>
            </div>
          </div>
          <div className="card" style={{ marginTop: 12 }}>
            <div className="actions-center">
              <input type="text" placeholder="Digitar placa (AAA1A23)" value={manualPlate} onChange={e => setManualPlate(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
              <button className="button" onClick={handleManualRegister} disabled={!manualPlate}>Registrar manual</button>
            </div>
          </div>
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