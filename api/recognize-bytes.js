module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.json({ error: 'method_not_allowed' })
    return
  }
  try {
    const chunks = []
    await new Promise((resolve, reject) => {
      req.on('data', (c) => chunks.push(c))
      req.on('end', resolve)
      req.on('error', reject)
    })
    const buf = Buffer.concat(chunks)
    if (!buf || buf.length === 0) {
      res.json({ error: 'missing_bytes' })
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

    // 1) Tentar recognize-bytes
    const urlBytes = `${base}/v1/recognize-bytes?regions=${encodeURIComponent(regions)}&topn=20`
    let out = null
    let tried = []
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
      if (resp.ok) {
        out = await resp.json()
      }
    } catch (_) {}

    // 2) Fallback opcional: plate-reader (multipart)
    if (!out || !Array.isArray(out.results) || out.results.length === 0) {
      tried.push('platerecognizer:plate-reader')
      const FormData = require('form-data')
      const form = new FormData()
      form.append('upload', buf, { filename: 'frame.jpg', contentType: 'application/octet-stream' })
      const headers = Object.assign({}, form.getHeaders(), {
        'Accept': 'application/json',
        'Authorization': `Token ${key}`,
        'User-Agent': 'BatyCarApp/1.0'
      })
      const urlReader = `${base}/v1/plate-reader/?regions=${encodeURIComponent(regions)}&topn=20`
      try {
        const resp2 = await fetch(urlReader, { method: 'POST', headers, body: form })
        if (resp2.ok) {
          out = await resp2.json()
        }
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
  } catch (e) {
    const msg = String((e && e.message) || e)
    res.status(500).json({ error: 'platerecognizer_failed', detail: msg })
  }
}
