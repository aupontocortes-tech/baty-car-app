module.exports = async (req, res) => {
  const urlParam = String((req.query.url || '')).trim()
  const regionParam = String((req.query.region || process.env.ALPR_REGION || 'br')).toLowerCase()
  if (!/^https?:\/\//i.test(urlParam)) {
    res.status(400).json({ error: 'invalid_url' })
    return
  }
  const regionBase = regionParam === 'br' ? 'eu' : (['us', 'eu'].includes(regionParam) ? regionParam : 'eu')
  const secret = process.env.OPENALPR_API_KEY || 'sk_DEMO'
  try {
    const imgResp = await fetch(urlParam)
    if (!imgResp.ok) {
      res.status(imgResp.status).json({ error: 'status_' + imgResp.status })
      return
    }
    const buf = Buffer.from(await imgResp.arrayBuffer())
    const apiUrl = `https://api.openalpr.com/v3/recognize_bytes?secret=${encodeURIComponent(secret)}&recognize_vehicle=0&country=${encodeURIComponent(regionBase)}&return_image=0&topn=10`
    const resp = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buf })
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
}

