const { IncomingForm } = require('formidable')

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' })
    return
  }
  const form = new IncomingForm({ multiples: false, keepExtensions: false })
  form.parse(req, async (err, fields, files) => {
    if (err) {
      res.status(500).json({ error: 'parse_failed' })
      return
    }
    const f = files && (files.frame || files.file)
    if (!f) {
      res.status(400).json({ error: 'missing_file' })
      return
    }
    let buf
    try {
      const p = Array.isArray(f) ? f[0] : f
      const fs = require('fs')
      buf = fs.readFileSync(p.filepath || p.path)
    } catch (_e) {
      res.status(500).json({ error: 'read_failed' })
      return
    }
    const regionParam = String((req.query.region || process.env.ALPR_REGION || 'br')).toLowerCase()
    const regionBase = regionParam === 'br' ? 'eu' : (['us', 'eu'].includes(regionParam) ? regionParam : 'eu')
    const secret = process.env.OPENALPR_API_KEY || 'sk_DEMO'
    try {
      const url = `https://api.openalpr.com/v3/recognize_bytes?secret=${encodeURIComponent(secret)}&recognize_vehicle=0&country=${encodeURIComponent(regionBase)}&return_image=0&topn=10`
      const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buf })
      if (!resp.ok) {
        res.status(resp.status).json({ error: 'status_' + resp.status })
        return
      }
      const out = await resp.json()
      const results = Array.isArray(out.results) ? out.results : []
      const plates = results.map(r => ({
        plate: r.plate,
        confidence: typeof r.confidence === 'number' ? r.confidence : Number(r.confidence) || 0,
        region: regionBase,
        candidates: Array.isArray(r.candidates) ? r.candidates.map(c => ({ plate: c.plate, confidence: typeof c.confidence === 'number' ? c.confidence : Number(c.confidence) || 0 })) : []
      }))
      res.json({ plates, meta: { processing_time_ms: out.processing_time_ms || null, regionTried: [regionBase] } })
    } catch (e) {
      res.status(500).json({ error: 'alpr_failed', detail: String(e && e.message || e) })
    }
  })
}

