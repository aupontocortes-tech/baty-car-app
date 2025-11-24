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
    const regionParam = String((req.query.region || process.env.ALPR_REGION || 'br')).toLowerCase()
    const regionBase = regionParam === 'br' ? 'eu' : (['us', 'eu'].includes(regionParam) ? regionParam : 'eu')
    const secret = process.env.OPENALPR_API_KEY || 'sk_DEMO'
    const apiUrl = `https://api.openalpr.com/v2/recognize_bytes?secret=${encodeURIComponent(secret)}&recognize_vehicle=0&country=${encodeURIComponent(regionBase)}&return_image=0&topn=10`
    const resp = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'User-Agent': 'BatyCarApp/1.0' }, body: buf })
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      res.json({ error: 'status_' + resp.status, detail })
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
    res.json({ error: 'alpr_failed', detail: String(e && e.message || e) })
  }
}
