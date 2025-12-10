import React, { useEffect, useMemo, useState } from 'react'
import CameraCapture from './CameraCapture'
import ResultsTable from './ResultsTable'
 
export default function App() {
  const [records, setRecords] = useState([])
  const minConfidence = 20
  const minConfidenceRelaxed = 15
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
  // Estado para entradas salvas conforme schema solicitado
  const [savedEntries, setSavedEntries] = useState([])
  const [flowActive, setFlowActive] = useState(false)
  const [flowStep, setFlowStep] = useState('choose-order') // 'choose-order' | 'fill-loja' | 'fill-lava' | 'confirm'
  const [flowOrder, setFlowOrder] = useState(null) // 'loja-first' | 'lava-first'
  const [draftEntry, setDraftEntry] = useState({ placa: '', data: '', loja: '', lava_jato: '' })

  useEffect(() => {
    try {
      const raw = localStorage.getItem('SAVED_ENTRIES')
      if (raw) setSavedEntries(JSON.parse(raw))
    } catch (_) {}
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('SAVED_ENTRIES', JSON.stringify(savedEntries))
    } catch (_) {}
  }, [savedEntries])

  const startFlowForPlate = (plate, tsStr) => {
    setDraftEntry({ placa: plate, data: tsStr, loja: '', lava_jato: '' })
    setFlowActive(true)
    setFlowStep('choose-order')
    setFlowOrder(null)
  }

  const chooseOrder = (first) => {
    const order = first === 'loja' ? 'loja-first' : 'lava-first'
    setFlowOrder(order)
    setFlowStep(order === 'loja-first' ? 'fill-loja' : 'fill-lava')
  }

  const proceedAfterLoja = () => setFlowStep('fill-lava')
  const proceedAfterLava = () => setFlowStep(flowOrder === 'lava-first' ? 'fill-loja' : 'confirm')

  const saveCurrentEntry = () => {
    setSavedEntries(prev => [{ ...draftEntry }, ...prev])
    setFlowActive(false)
    setFlowStep('choose-order')
    setFlowOrder(null)
    setDraftEntry({ placa: '', data: '', loja: '', lava_jato: '' })
  }

  const beep = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.setValueAtTime(880, ctx.currentTime)
      g.gain.setValueAtTime(0.001, ctx.currentTime)
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01)
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2)
      o.connect(g)
      g.connect(ctx.destination)
      o.start()
      setTimeout(() => o.stop(), 220)
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
    // Heurística: corrigir confusões comuns para encaixar no padrão Mercosul
    const fixMercosul = (raw) => {
      let s = normalize(raw)
      if (!s) return null
      s = s.slice(0, 7)
      if (mercosul.test(s)) return s
      const a = s.split('')
      const mapDigit = (ch) => ({ 'O':'0','Q':'0','D':'0','I':'1','L':'1','Z':'2','S':'5','B':'8','G':'6','T':'7' }[ch] || ch)
      const mapLetter = (ch) => ({ '0':'O','1':'I','2':'Z','5':'S','8':'B','6':'G','7':'T' }[ch] || ch)
      // Enforce letras nas posições 0..2
      for (let i = 0; i < 3; i++) a[i] = mapLetter(a[i])
      // Dígito na posição 3
      a[3] = mapDigit(a[3])
      // Letra na posição 4
      a[4] = mapLetter(a[4])
      // Dígitos nas posições 5 e 6
      a[5] = mapDigit(a[5])
      a[6] = mapDigit(a[6])
      const s2 = a.join('')
      return mercosul.test(s2) ? s2 : null
    }

    const candidates = []
    items.forEach(p => {
      candidates.push({ plate: p.plate, confidence: p.confidence })
    })

    const rejections = []
    const valid = []
    let best = null
    candidates.forEach(c => {
      const raw7 = normalize(c.plate).slice(0, 7)
      const fixed = toMercosul(c.plate) || fixMercosul(c.plate)
      if (!fixed) { rejections.push({ plate: raw7, reason: 'formato inválido' }); return }
      if (seen.has(fixed)) { rejections.push({ plate: fixed, reason: 'duplicada' }); return }
      valid.push({ plate: fixed, confidence: c.confidence })
      if (typeof c.confidence === 'number' && c.confidence >= minConfidence) {
        if (!best || c.confidence > best.confidence) best = { plate: fixed, confidence: c.confidence }
      } else {
        rejections.push({ plate: fixed, reason: 'confiança baixa' })
      }
    })

    let acceptedMode = 'normal'
    if (!best && valid.length > 0) {
      const weak = valid
        .filter(v => (typeof v.confidence === 'number' && v.confidence >= minConfidenceRelaxed))
        .sort((a, b) => b.confidence - a.confidence)[0]
      if (weak) {
        best = { plate: weak.plate, confidence: weak.confidence }
        acceptedMode = 'relaxed'
      }
    }

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
      // limpar qualquer erro anterior após sucesso
      setErrorMsg('')
      // iniciar fluxo de cadastro conforme solicitação
      startFlowForPlate(best.plate, tsStr)
    }
    if (debug) setDebugInfo({ items, rejections, acceptedMode })
  }

  const promptInstall = () => {
    try {
      if (!installEvt) return
      installEvt.prompt()
    } catch (_e) {}
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
    const tsStr = new Date().toISOString()
    const normalize = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    const plate = normalize(manualPlate).slice(0, 7)
    if (!plate) return
    startFlowForPlate(plate, tsStr)
    setManualPlate('')
  }
  
  // Excluir entrada salva ao clicar na linha
  const handleDeleteEntry = (idx) => {
    try {
      const entry = savedEntries[idx]
      const ok = window.confirm(`Excluir cadastro da placa ${entry?.placa || ''}?`)
      if (!ok) return
    } catch (_e) {}
    setSavedEntries(prev => prev.filter((_, i) => i !== idx))
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
                const allFailed = info && info.detail === 'all_routes_failed'
                const isFetchFail = info && info.error === 'fetch_failed'
                const hasMissingKey = Array.isArray(info?.attempts) && info.attempts.some(a => String(a?.data?.error) === 'missing_api_key')
                const hasProviderFail = Array.isArray(info?.attempts) && info.attempts.some(a => String(a?.data?.error) === 'platerecognizer_failed')
                const isNoPlate = info && info.error === 'no_plate'
                // Não exibir erro visual quando apenas não foi detectada placa nesta tentativa
                if (isNoPlate) { setErrorMsg(''); return }
                const msg = hasMissingKey
                  ? 'Chave da API ausente. Defina PLATERECOGNIZER_API_KEY no .env (local) ou na Vercel.'
                  : (hasProviderFail
                    ? 'Falha na integração com Plate Recognizer. Verifique a chave e conexão.'
                    : (allFailed
                      ? 'API não acessível. Publique front e backend no mesmo domínio HTTPS.'
                      : (isFetchFail
                        ? 'Falha de rede ou CORS na rota atual; tentando fallback.'
                        : String(info && info.error || 'desconhecido'))))
                setErrorMsg(msg)
                if (debug && info && Array.isArray(info.attempts)) {
                  try { console.warn('attempts:', info.attempts) } catch (_e) {}
                  setDebugInfo({ attempts: info.attempts })
                }
              }}
            />
          </div>
          {/* Fluxo de cadastro flexível */}
          {flowActive && (
            <div className="card" style={{ marginTop: 12 }}>
              <div className="badge">Cadastro</div>
              {flowStep === 'choose-order' && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ marginBottom: 8, fontWeight: 600 }}>Deseja preencher primeiro Loja ou Lava Jato?</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="button" onClick={() => chooseOrder('loja')}>Loja primeiro</button>
                    <button className="button" onClick={() => chooseOrder('lava')}>Lava Jato primeiro</button>
                  </div>
                  <div style={{ marginTop: 12, fontSize: 12, color: '#5b6b84' }}>
                    Placa: {draftEntry.placa} • Data: {draftEntry.data}
                  </div>
                </div>
              )}
              {flowStep === 'fill-loja' && (
                <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                  <input type="text" placeholder="Loja" value={draftEntry.loja} onChange={e => setDraftEntry(prev => ({ ...prev, loja: e.target.value }))} style={{ flex: 1, minWidth: 220 }} />
                  <button className="button" onClick={proceedAfterLoja} disabled={!draftEntry.loja}>Continuar</button>
                </div>
              )}
              {flowStep === 'fill-lava' && (
                <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                  <input type="text" placeholder="Lava Jato" value={draftEntry.lava_jato} onChange={e => setDraftEntry(prev => ({ ...prev, lava_jato: e.target.value }))} style={{ flex: 1, minWidth: 220 }} />
                  <button className="button" onClick={proceedAfterLava} disabled={!draftEntry.lava_jato}>Continuar</button>
                </div>
              )}
              {flowStep === 'confirm' && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>Confirmar cadastro</div>
                  <div style={{ fontSize: 12, color: '#5b6b84', marginBottom: 8 }}>
                    Placa: {draftEntry.placa} • Data: {draftEntry.data} • Loja: {draftEntry.loja} • Lava Jato: {draftEntry.lava_jato}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="button" onClick={saveCurrentEntry}>Salvar</button>
                    <button className="button" onClick={() => setFlowActive(false)}>Cancelar</button>
                  </div>
                </div>
              )}
            </div>
          )}
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
                {debugInfo.acceptedMode && (
                  <div style={{ marginTop: 8 }}>
                    <div>Modo de aceitação: {debugInfo.acceptedMode}</div>
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
            <ResultsTable rows={savedEntries} onDelete={handleDeleteEntry} />
          </div>
        </div>
      </div>
    </div>
  )
}
