module.exports = async (req, res) => {
  const urlParam = String((req.query.url || '')).trim()
  const regionParam = String((req.query.region || process.env.ALPR_REGION || 'br')).toLowerCase()
  if (!/^https?:\/\//i.test(urlParam)) {
    res.json({ error: 'invalid_url' })
    return
  }
  const regionBase = regionParam === 'br' ? 'eu' : (['us', 'eu'].includes(regionParam) ? regionParam : 'eu')
  const secret = process.env.OPENALPR_API_KEY || 'sk_DEMO'
  try {
    const imgResp = await fetch(urlParam, { headers: { 'User-Agent': 'BatyCarApp/1.0' } })
    if (!imgResp.ok) {
      const detail = await imgResp.text().catch(() => '')
      res.json({ error: 'status_' + imgResp.status, detail })
      return
    }
    const buf = Buffer.from(await imgResp.arrayBuffer())
    const apiUrl = `https://api.openalpr.com/v2/recognize_bytes?secret_key=${encodeURIComponent(secret)}&recognize_vehicle=0&country=${encodeURIComponent(regionBase)}&return_image=0&topn=10`
    const resp = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Accept': 'application/json', 'User-Agent': 'BatyCarApp/1.0' }, body: buf })
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
