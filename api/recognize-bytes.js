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
    const preferred = regionParam === 'br' ? 'eu' : (['us', 'eu'].includes(regionParam) ? regionParam : 'eu')
    const regionBase = preferred
    const regionsV2 = [preferred, preferred === 'eu' ? 'us' : 'eu']
    const regionsV3 = ['br', preferred, preferred === 'eu' ? 'us' : 'eu']
    const secret = process.env.OPENALPR_API_KEY || 'sk_DEMO'
    let out = null
    let tried = []
    for (const r of regionsV2) {
      tried.push(r + ':v2')
      const apiUrlV2 = `https://api.openalpr.com/v2/recognize_bytes?secret_key=${encodeURIComponent(secret)}&recognize_vehicle=0&country=${encodeURIComponent(r)}&return_image=0&topn=20`
      const respV2 = await fetch(apiUrlV2, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Accept': 'application/json', 'User-Agent': 'BatyCarApp/1.0' }, body: buf })
      if (respV2.ok) {
        const maybe = await respV2.json()
        const arr = Array.isArray(maybe.results) ? maybe.results : []
        if (arr.length > 0) { out = maybe; break }
      } else if (respV2.status === 401 || respV2.status === 403) {
        tried.push(r + ':v3')
        const apiUrlV3 = `https://api.openalpr.com/v3/recognize_bytes?secret=${encodeURIComponent(secret)}&recognize_vehicle=0&country=${encodeURIComponent(r)}&return_image=0&topn=20`
        const respV3 = await fetch(apiUrlV3, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Accept': 'application/json', 'User-Agent': 'BatyCarApp/1.0' }, body: buf })
        if (respV3.ok) {
          const maybe3 = await respV3.json()
          const arr3 = Array.isArray(maybe3.results) ? maybe3.results : []
          if (arr3.length > 0) { out = maybe3; break }
        }
      }
    }
    if (!out) {
      for (const r of regionsV3) {
        tried.push(r + ':v3')
        const apiUrlV3 = `https://api.openalpr.com/v3/recognize_bytes?secret=${encodeURIComponent(secret)}&recognize_vehicle=0&country=${encodeURIComponent(r)}&return_image=0&topn=20`
        const respV3 = await fetch(apiUrlV3, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Accept': 'application/json', 'User-Agent': 'BatyCarApp/1.0' }, body: buf })
        if (respV3.ok) {
          const maybe3 = await respV3.json()
          const arr3 = Array.isArray(maybe3.results) ? maybe3.results : []
          if (arr3.length > 0) { out = maybe3; break }
        }
      }
    }
    if (!out) {
      res.json({ error: 'no_plate', detail: 'Nenhuma placa encontrada', tried })
      return
    }
    const regions = Array.isArray(out?.regions) ? out.regions : []
    const alprFailed = !!(out && out.alpr_failed)
    const results = Array.isArray(out?.results) ? out.results : []
    const plates = results.map(r => ({
      plate: r.plate,
      confidence: typeof r.confidence === 'number' ? r.confidence : Number(r.confidence) || 0,
      region: regionBase,
      candidates: Array.isArray(r.candidates) ? r.candidates.map(c => ({ plate: c.plate, confidence: typeof c.confidence === 'number' ? c.confidence : Number(c.confidence) || 0 })) : []
    }))
    res.json({ plates, meta: { processing_time_ms: out?.processing_time_ms || null, regionTried: tried, regions, alprFailed } })
  } catch (e) {
    const msg = String((e && e.message) || e)
    if (/is not defined/i.test(msg)) {
      res.json({ error: 'no_plate', detail: 'Nenhuma placa encontrada' })
    } else {
      res.json({ error: 'alpr_failed', detail: msg })
    }
  }
}
