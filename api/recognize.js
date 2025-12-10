const { IncomingForm } = require('formidable')

module.exports = async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    if (req.method === 'OPTIONS') {
      res.status(204).end()
      return
    }
  } catch (_) {}
  if (req.method !== 'POST') {
    res.json({ error: 'method_not_allowed' })
    return
  }
  const form = new IncomingForm({ multiples: false, keepExtensions: false })
  form.parse(req, async (err, fields, files) => {
    if (err) {
      res.json({ error: 'parse_failed' })
      return
    }
    const f = files && (files.frame || files.file)
    if (!f) {
      res.json({ error: 'missing_file' })
      return
    }
    let buf
    try {
      const p = Array.isArray(f) ? f[0] : f
      const fs = require('fs')
      buf = fs.readFileSync(p.filepath || p.path)
    } catch (_e) {
      res.json({ error: 'read_failed' })
      return
    }

    const key = (process.env.PLATERECOGNIZER_API_KEY || process.env.PLATEREGONIZE_API_KEY || '').trim()
    const base = (process.env.PLATERECOGNIZER_BASE_URL || process.env.PLATEREGONIZE_BASE_URL || 'https://api.platerecognizer.com').replace(/\/+$/,'')
    const regionParam = String((req.query.region || process.env.ALPR_REGION || 'br')).toLowerCase()
    const regions = regionParam === 'br' ? 'br' : (['us','eu'].includes(regionParam) ? regionParam : 'eu')

    let out = null
    let tried = []

    // 1) Usar recognize-bytes com o buffer lido (se houver chave)
    if (key) {
      const urlBytes = `${base}/v1/recognize-bytes?regions=${encodeURIComponent(regions)}&topn=20`
      tried.push('platerecognizer:recognize-bytes')
      try {
        const resp = await fetch(urlBytes, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'Accept': 'application/json',
            'Authorization': `Token ${key}`,
            'User-Agent': 'BatyCarApp/1.0'
          },
          body: buf
        })
        if (resp.ok) out = await resp.json()
      } catch (_) {}
    }

    // 2) Fallback: plate-reader multipart (se houver chave)
    if ((!out || !Array.isArray(out.results) || out.results.length === 0) && key) {
      tried.push('platerecognizer:plate-reader')
      const FormData = require('form-data')
      const formUp = new FormData()
      formUp.append('upload', buf, { filename: 'frame.jpg', contentType: 'application/octet-stream' })
      const headers = Object.assign({}, formUp.getHeaders(), {
        'Accept': 'application/json',
        'Authorization': `Token ${key}`,
        'User-Agent': 'BatyCarApp/1.0'
      })
      const urlReader = `${base}/v1/plate-reader/?regions=${encodeURIComponent(regions)}&topn=20`
      try {
        const resp2 = await fetch(urlReader, { method: 'POST', headers, body: formUp })
        if (resp2.ok) out = await resp2.json()
      } catch (_) {}
    }

    // 3) Fallback extra: OpenALPR FastAPI
    if (!out || !Array.isArray(out.results) || out.results.length === 0) {
      tried.push('openalpr-fastapi:read-plate')
      const FormData = require('form-data')
      const fd3 = new FormData()
      fd3.append('file', buf, { filename: 'frame.jpg', contentType: 'application/octet-stream' })
      const fastBase = (process.env.OPENALPR_FASTAPI_BASE || 'https://openalpr-fastapi-1.onrender.com').replace(/\/+$/,'')
      const fastUrl = `${fastBase}/read-plate?region=${encodeURIComponent(regions)}`
      try {
        const resp3 = await fetch(fastUrl, { method: 'POST', body: fd3, headers: fd3.getHeaders() })
        if (resp3.ok) {
          const j3 = await resp3.json()
          if (j3 && !j3.results && Array.isArray(j3.plates)) {
            j3.results = j3.plates.map(p => ({ plate: p.plate, confidence: p.confidence }))
          }
          out = j3
        }
      } catch (_) {}
    }

    if (!out || !Array.isArray(out.results) || out.results.length === 0) {
      res.json({ error: 'no_plate', detail: 'Nenhuma placa encontrada', tried })
      return
    }

    const results = Array.isArray(out.results) ? out.results : []
    const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g,'')
    const mercosul = /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/
    const fixMercosul = (raw) => {
      let s = norm(raw)
      if (!s) return null
      s = s.slice(0, 7)
      if (mercosul.test(s)) return s
      const a = s.split('')
      const mapDigit = (ch) => ({ 'O':'0','Q':'0','D':'0','I':'1','L':'1','Z':'2','S':'5','B':'8','G':'6','T':'7' }[ch] || ch)
      const mapLetter = (ch) => ({ '0':'O','1':'I','2':'Z','5':'S','8':'B','6':'G','7':'T' }[ch] || ch)
      for (let i = 0; i < 3; i++) a[i] = mapLetter(a[i])
      a[3] = mapDigit(a[3])
      a[4] = mapLetter(a[4])
      a[5] = mapDigit(a[5])
      a[6] = mapDigit(a[6])
      const s2 = a.join('')
      return mercosul.test(s2) ? s2 : null
    }
    const plates = results.map(r => {
      const plateFixed = fixMercosul(r.plate)
      const plate = plateFixed || norm(r.plate)
      const score = (typeof r.score === 'number') ? r.score : (r.confidence != null ? Number(r.confidence) : 0)
      const confidence = score > 1 ? score : Math.round((score || 0) * 100)
      return { plate, confidence }
    })

    res.json({ plates, meta: { provider: 'platerecognizer', tried } })
  })
}
