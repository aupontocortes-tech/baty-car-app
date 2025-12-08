const { IncomingForm } = require('formidable')

module.exports = async (req, res) => {
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

    if (!key) {
      res.status(500).json({ error: 'missing_api_key', detail: 'Defina PLATERECOGNIZER_API_KEY nas variáveis do projeto Vercel.' })
      return
    }

    let out = null
    let tried = []

    // 1) Usar recognize-bytes com o buffer lido
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

    // 2) Fallback: plate-reader multipart
    if (!out || !Array.isArray(out.results) || out.results.length === 0) {
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

    if (!out || !Array.isArray(out.results) || out.results.length === 0) {
      res.json({ error: 'no_plate', detail: 'Nenhuma placa encontrada', tried })
      return
    }

    const results = Array.isArray(out.results) ? out.results : []
    const plates = results.map(r => {
      const plate = String(r.plate || '').toUpperCase().replace(/[^A-Z0-9]/g,'')
      const score = (typeof r.score === 'number') ? r.score : (r.confidence != null ? Number(r.confidence) : 0)
      const confidence = score > 1 ? score : Math.round((score || 0) * 100)
      return { plate, confidence }
    })

    res.json({ plates, meta: { provider: 'platerecognizer', tried } })
  })
}
