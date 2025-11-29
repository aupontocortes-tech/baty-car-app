const express = require('express')
const cors = require('cors')
const multer = require('multer')
const fs = require('fs')
const path = require('path')
const { exec } = require('child_process')
const http = require('http')
const https = require('https')

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

const uploadsDir = path.join(__dirname, 'uploads')
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}
const recognizedDir = path.join(uploadsDir, 'recognized')
if (!fs.existsSync(recognizedDir)) {
  fs.mkdirSync(recognizedDir, { recursive: true })
}

const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, uploadsDir)
  },
  filename: function (_req, file, cb) {
    const ext = path.extname(file.originalname || '.jpg')
    cb(null, `${Date.now()}${ext}`)
  }
})
const upload = multer({ storage })

const OPENLPR_URL = (process.env.OPENLPR_URL || '').replace(/\/+$/,'')
const OPENLPR_DETECT_PATH = process.env.OPENLPR_DETECT_PATH || '/api/detect'
const FASTAPI_BASE = (process.env.FASTAPI_BASE || process.env.OPENALPR_FASTAPI || 'https://openalpr-fastapi-1.onrender.com').replace(/\/+$/,'')

const runAlpr = (filePath, region) => new Promise((resolve, reject) => {
  const bin = process.env.ALPR_BIN || 'alpr'
  const cmd = `${bin} --detect_region -n 3 -c ${region} -j "${filePath}"`
  exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
    if (error) {
      reject({ error: 'alpr_failed', detail: String(stderr || error.message) })
      return
    }
    let parsed
    try {
      parsed = JSON.parse(stdout)
    } catch (_e) {
      reject({ error: 'invalid_json', raw: stdout })
      return
    }
    resolve(parsed)
  })
})

async function runOpenLprBytes(buf) {
  if (!OPENLPR_URL) return null
  const url = OPENLPR_URL + OPENLPR_DETECT_PATH
  const b64 = buf.toString('base64')
  const j = await new Promise((resolve) => {
    try {
      const u = new URL(url)
      const isHttps = u.protocol === 'https:'
      const mod = isHttps ? https : http
      const payload = JSON.stringify({ image: b64 })
      const opts = {
        method: 'POST',
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + (u.search || ''),
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      }
      const req = mod.request(opts, (res) => {
        let data = ''
        res.on('data', (c) => { data += c })
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            resolve(null)
            return
          }
          try { resolve(JSON.parse(data)) } catch (_e) { resolve(null) }
        })
      })
      req.on('error', () => resolve(null))
      req.write(payload)
      req.end()
    } catch (_e) {
      resolve(null)
    }
  })
  if (!j) return null
  const first = Array.isArray(j.results) ? j.results[0] : null
  const plate = (j.plate || (first && first.plate) || '')
  const confidenceRaw = (j.confidence != null ? j.confidence : (first && first.confidence))
  const confidence = typeof confidenceRaw === 'number' ? confidenceRaw : (Number(confidenceRaw) || 0)
  if (plate) return { results: [{ plate, confidence }] }
  if (Array.isArray(j.results) && j.results.length) return { results: j.results }
  if (Array.isArray(j.plates) && j.plates.length) return { results: j.plates.map(p => ({ plate: p.plate, confidence: p.confidence })) }
  return null
}

app.post('/api/recognize', upload.single('frame'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'missing_file' })
    return
  }
  const filePath = req.file.path
  const regionParam = (req.query.region || process.env.ALPR_REGION || 'br').toString().toLowerCase()
  const regionBase = regionParam === 'br' ? 'eu' : (['us', 'eu'].includes(regionParam) ? regionParam : 'eu')
  const order = [regionBase, 'us']
  let parsed = null
  let usedRegion = regionBase
  let lastError = null
  try {
    const buf = await fs.promises.readFile(filePath)
    const ol = await runOpenLprBytes(buf)
    if (ol && Array.isArray(ol.results) && ol.results.length) {
      parsed = { results: ol.results }
    }
  } catch (_e) {}
  for (const r of order) {
    try {
      const out = await runAlpr(filePath, r)
      const resArr = Array.isArray(out.results) ? out.results : []
      parsed = out
      usedRegion = r
      if (resArr.length > 0 || parsed) break
    } catch (e) {
      lastError = e
    }
  }
  if (!parsed) {
    try {
      const buf = await fs.promises.readFile(filePath)
      const secret = process.env.OPENALPR_API_KEY || 'sk_DEMO'
      const regionTry = regionBase
      const urlV2 = `https://api.openalpr.com/v2/recognize_bytes?secret_key=${encodeURIComponent(secret)}&recognize_vehicle=0&country=${encodeURIComponent(regionTry)}&return_image=0&topn=10`
      const respV2 = await fetch(urlV2, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Accept': 'application/json', 'User-Agent': 'BatyCarApp/1.0' }, body: buf })
      let out
      if (!respV2.ok && (respV2.status === 401 || respV2.status === 403)) {
        const urlV3 = `https://api.openalpr.com/v3/recognize_bytes?secret=${encodeURIComponent(secret)}&recognize_vehicle=0&country=${encodeURIComponent(regionTry)}&return_image=0&topn=10`
        const respV3 = await fetch(urlV3, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Accept': 'application/json', 'User-Agent': 'BatyCarApp/1.0' }, body: buf })
        if (!respV3.ok) throw new Error(`status_${respV3.status}`)
        out = await respV3.json()
      } else if (!respV2.ok) {
        throw new Error(`status_${respV2.status}`)
      } else {
        out = await respV2.json()
      }
      parsed = out
      usedRegion = regionTry
    } catch (e) {
      res.status(500).json(lastError || { error: 'unknown', detail: String(e && e.message || e) })
      return
    }
  }
  const results = Array.isArray(parsed.results) ? parsed.results : []
  const plates = results.map(r => ({
    plate: r.plate,
    confidence: typeof r.confidence === 'number' ? r.confidence : Number(r.confidence) || 0,
    region: usedRegion,
    candidates: Array.isArray(r.candidates)
      ? r.candidates.map(c => ({
          plate: c.plate,
          confidence: typeof c.confidence === 'number' ? c.confidence : Number(c.confidence) || 0
        }))
      : []
  }))
  res.json({ plates, imageFile: null, meta: { processing_time_ms: parsed.processing_time_ms || null, regionTried: order } })
})

app.post('/api/recognize-bytes', async (req, res) => {
  try {
    const chunks = []
    await new Promise((resolve, reject) => {
      req.on('data', (c) => chunks.push(c))
      req.on('end', resolve)
      req.on('error', reject)
    })
    const buf = Buffer.concat(chunks)
    if (!buf || buf.length === 0) {
      res.status(400).json({ error: 'missing_bytes' })
      return
    }
    const ol = await runOpenLprBytes(buf)
    if (ol && Array.isArray(ol.results) && ol.results.length) {
      const results = ol.results
      const plates = results.map(r => ({
        plate: r.plate,
        confidence: typeof r.confidence === 'number' ? r.confidence : Number(r.confidence) || 0,
        region: (process.env.ALPR_REGION || 'br'),
        candidates: []
      }))
      res.json({ plates, meta: { engine: 'openlpr' } })
      return
    }
    const tmpName = `${Date.now()}_frombytes.jpg`
    const tmpPath = path.join(uploadsDir, tmpName)
    await fs.promises.writeFile(tmpPath, buf)
    const regionParam = (req.query.region || process.env.ALPR_REGION || 'br').toString().toLowerCase()
    const regionBase = regionParam === 'br' ? 'eu' : (['us', 'eu'].includes(regionParam) ? regionParam : 'eu')
    const order = [regionBase, 'us']
    let parsed = null
    let usedRegion = regionBase
    let lastError = null
    for (const r of order) {
      try {
        const out = await runAlpr(tmpPath, r)
        const resArr = Array.isArray(out.results) ? out.results : []
        parsed = out
        usedRegion = r
        if (resArr.length > 0) break
      } catch (e) {
        lastError = e
      }
    }
    if (!parsed) {
      try {
        const secret = process.env.OPENALPR_API_KEY || 'sk_DEMO'
        const regionTry = regionBase
        const urlV2 = `https://api.openalpr.com/v2/recognize_bytes?secret_key=${encodeURIComponent(secret)}&recognize_vehicle=0&country=${encodeURIComponent(regionTry)}&return_image=0&topn=10`
        const respV2 = await fetch(urlV2, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Accept': 'application/json', 'User-Agent': 'BatyCarApp/1.0' }, body: buf })
        let out
        if (!respV2.ok && (respV2.status === 401 || respV2.status === 403)) {
          const urlV3 = `https://api.openalpr.com/v3/recognize_bytes?secret=${encodeURIComponent(secret)}&recognize_vehicle=0&country=${encodeURIComponent(regionTry)}&return_image=0&topn=10`
          const respV3 = await fetch(urlV3, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Accept': 'application/json', 'User-Agent': 'BatyCarApp/1.0' }, body: buf })
          if (!respV3.ok) throw new Error(`status_${respV3.status}`)
          out = await respV3.json()
        } else if (!respV2.ok) {
          throw new Error(`status_${respV2.status}`)
        } else {
          out = await respV2.json()
        }
        parsed = out
        usedRegion = regionTry
      } catch (e) {
        res.status(500).json(lastError || { error: 'unknown', detail: String(e && e.message || e) })
        return
      }
    }
    const results = Array.isArray(parsed.results) ? parsed.results : []
    const plates = results.map(r => ({
      plate: r.plate,
      confidence: typeof r.confidence === 'number' ? r.confidence : Number(r.confidence) || 0,
      region: usedRegion,
      candidates: Array.isArray(r.candidates)
        ? r.candidates.map(c => ({ plate: c.plate, confidence: typeof c.confidence === 'number' ? c.confidence : Number(c.confidence) || 0 }))
        : []
    }))
    res.json({ plates, meta: { processing_time_ms: parsed.processing_time_ms || null, regionTried: order } })
  } catch (e) {
    res.status(500).json({ error: 'alpr_failed', detail: String(e && e.message || e) })
  }
})

app.post('/api/read-plate', async (req, res) => {
  try {
    let buf = null
    const ct = String(req.headers['content-type'] || '').toLowerCase()
    if (/application\/json/.test(ct)) {
      const raw = String((req.body && req.body.image) || '')
      const clean = raw.replace(/^data:[^;]+;base64,/, '')
      if (!clean || clean.length < 32) {
        res.status(400).json({ error: 'missing_image' })
        return
      }
      buf = Buffer.from(clean, 'base64')
    } else {
      const chunks = []
      await new Promise((resolve, reject) => {
        req.on('data', (c) => chunks.push(c))
        req.on('end', resolve)
        req.on('error', reject)
      })
      buf = Buffer.concat(chunks)
      if (!buf || buf.length === 0) {
        res.status(400).json({ error: 'missing_bytes' })
        return
      }
    }
    const ol = await runOpenLprBytes(buf)
    if (ol && Array.isArray(ol.results) && ol.results.length) {
      const results = ol.results
      const plates = results.map(r => ({
        plate: r.plate,
        confidence: typeof r.confidence === 'number' ? r.confidence : Number(r.confidence) || 0,
        region: (process.env.ALPR_REGION || 'br'),
        candidates: []
      }))
      res.json({ plates, meta: { engine: 'openlpr' } })
      return
    }
    const tmpName = `${Date.now()}_readplate.jpg`
    const tmpPath = path.join(uploadsDir, tmpName)
    await fs.promises.writeFile(tmpPath, buf)
    const regionParam = (req.query.region || process.env.ALPR_REGION || 'br').toString().toLowerCase()
    const regionBase = regionParam === 'br' ? 'eu' : (['us', 'eu'].includes(regionParam) ? regionParam : 'eu')
    const order = [regionBase, 'us']
    let parsed = null
    let usedRegion = regionBase
    let lastError = null
    for (const r of order) {
      try {
        const out = await runAlpr(tmpPath, r)
        const resArr = Array.isArray(out.results) ? out.results : []
        parsed = out
        usedRegion = r
        if (resArr.length > 0) break
      } catch (e) {
        lastError = e
      }
    }
    if (!parsed) {
      try {
        const secret = process.env.OPENALPR_API_KEY || 'sk_DEMO'
        const regionTry = regionBase
        const urlV2 = `https://api.openalpr.com/v2/recognize_bytes?secret_key=${encodeURIComponent(secret)}&recognize_vehicle=0&country=${encodeURIComponent(regionTry)}&return_image=0&topn=10`
        const respV2 = await fetch(urlV2, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Accept': 'application/json', 'User-Agent': 'BatyCarApp/1.0' }, body: buf })
        let out
        if (!respV2.ok && (respV2.status === 401 || respV2.status === 403)) {
          const urlV3 = `https://api.openalpr.com/v3/recognize_bytes?secret=${encodeURIComponent(secret)}&recognize_vehicle=0&country=${encodeURIComponent(regionTry)}&return_image=0&topn=10`
          const respV3 = await fetch(urlV3, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Accept': 'application/json', 'User-Agent': 'BatyCarApp/1.0' }, body: buf })
          if (!respV3.ok) throw new Error(`status_${respV3.status}`)
          out = await respV3.json()
        } else if (!respV2.ok) {
          throw new Error(`status_${respV2.status}`)
        } else {
          out = await respV2.json()
        }
        parsed = out
        usedRegion = regionTry
      } catch (e) {
        res.status(500).json(lastError || { error: 'unknown', detail: String(e && e.message || e) })
        return
      }
    }
    const results = Array.isArray(parsed.results) ? parsed.results : []
    const plates = results.map(r => ({
      plate: r.plate,
      confidence: typeof r.confidence === 'number' ? r.confidence : Number(r.confidence) || 0,
      region: usedRegion,
      candidates: Array.isArray(r.candidates)
        ? r.candidates.map(c => ({ plate: c.plate, confidence: typeof c.confidence === 'number' ? c.confidence : Number(c.confidence) || 0 }))
        : []
    }))
    res.json({ plates, meta: { processing_time_ms: parsed.processing_time_ms || null, regionTried: order } })
  } catch (e) {
    res.status(500).json({ error: 'alpr_failed', detail: String(e && e.message || e) })
  }
})

app.post('/read-plate', async (req, res) => {
  try {
    const base = FASTAPI_BASE
    if (!/^https?:\/\//i.test(base)) {
      res.status(500).json({ error: 'proxy_not_configured' })
      return
    }
    const ct = String(req.headers['content-type'] || '').toLowerCase()
    const region = (req.query.region || process.env.ALPR_REGION || 'br').toString().toLowerCase()
    const chunks = []
    await new Promise((resolve, reject) => {
      req.on('data', (c) => chunks.push(c))
      req.on('end', resolve)
      req.on('error', reject)
    })
    const buf = Buffer.concat(chunks)
    const urlStr = `${base}/read-plate?region=${encodeURIComponent(region)}`
    const u = new URL(urlStr)
    const isHttps = u.protocol === 'https:'
    const mod = isHttps ? https : http
    const opts = {
      method: 'POST',
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + (u.search || ''),
      headers: { 'Content-Type': ct || 'application/octet-stream', 'Content-Length': buf.length }
    }
    await new Promise((resolve) => {
      try {
        const req2 = mod.request(opts, (resp) => {
          let data = ''
          resp.on('data', (c) => { data += c })
          resp.on('end', () => {
            let j
            try { j = JSON.parse(data) } catch (_e) { j = null }
            if (resp.statusCode && resp.statusCode >= 400) {
              res.status(resp.statusCode).send(j || data)
              resolve()
              return
            }
            if (j && j.plate) {
              const conf = typeof j.confidence === 'number' ? j.confidence : (Number(j.confidence) || 0)
              const out = { results: [{ plate: j.plate, confidence: conf }], raw: j.raw }
              res.json(out)
              resolve()
              return
            }
            res.send(j || data)
            resolve()
          })
        })
        req2.on('error', (e) => { res.status(500).json({ error: 'proxy_failed', detail: String(e && e.message || e) }); resolve() })
        req2.write(buf)
        req2.end()
      } catch (e) {
        res.status(500).json({ error: 'proxy_failed', detail: String(e && e.message || e) })
        resolve()
      }
    })
  } catch (e) {
    res.status(500).json({ error: 'proxy_failed', detail: String(e && e.message || e) })
  }
})

app.get('/api/fastapi-health', async (_req, res) => {
  try {
    const base = FASTAPI_BASE
    if (!/^https?:\/\//i.test(base)) {
      res.status(500).json({ ok: false, error: 'proxy_not_configured' })
      return
    }
    const u = new URL(base + '/health')
    const isHttps = u.protocol === 'https:'
    const mod = isHttps ? https : http
    const opts = {
      method: 'GET',
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + (u.search || '')
    }
    const result = await new Promise((resolve) => {
      try {
        const req2 = mod.request(opts, (resp) => {
          let data = ''
          resp.on('data', (c) => { data += c })
          resp.on('end', () => {
            let j
            try { j = JSON.parse(data) } catch (_e) { j = null }
            resolve({ statusCode: resp.statusCode || 200, body: j || data })
          })
        })
        req2.on('error', () => resolve({ statusCode: 500, body: { ok: false, error: 'proxy_failed' } }))
        req2.end()
      } catch (_e) {
        resolve({ statusCode: 500, body: { ok: false, error: 'proxy_failed' } })
      }
    })
    if (result.statusCode >= 400) {
      res.status(result.statusCode).send(result.body)
      return
    }
    res.send(result.body)
  } catch (e) {
    res.status(500).json({ ok: false, error: 'proxy_failed', detail: String(e && e.message || e) })
  }
})

const downloadToFile = (fileUrl, destPath) => new Promise((resolve, reject) => {
  try {
    const mod = fileUrl.startsWith('https') ? https : http
    const req = mod.get(fileUrl, (resp) => {
      if (resp.statusCode && resp.statusCode >= 400) {
        reject(new Error(`status_${resp.statusCode}`))
        return
      }
      const ws = fs.createWriteStream(destPath)
      resp.pipe(ws)
      ws.on('finish', () => ws.close(() => resolve(destPath)))
      ws.on('error', (e) => reject(e))
    })
    req.on('error', (e) => reject(e))
  } catch (e) {
    reject(e)
  }
})

app.get('/api/recognize-url', async (req, res) => {
  const url = (req.query.url || '').toString()
  const regionParam = (req.query.region || process.env.ALPR_REGION || 'br').toString().toLowerCase()
  const regionBase = regionParam === 'br' ? 'eu' : (['us', 'eu'].includes(regionParam) ? regionParam : 'eu')
  if (!url || !/^https?:\/\//i.test(url)) {
    res.status(400).json({ error: 'invalid_url' })
    return
  }
  const tmpName = `${Date.now()}_remote.jpg`
  const tmpPath = path.join(uploadsDir, tmpName)
  try {
    await downloadToFile(url, tmpPath)
  } catch (e) {
    res.status(500).json({ error: 'download_failed', detail: String(e && e.message || e) })
    return
  }
  const order = [regionBase, 'us']
  let parsed = null
  let usedRegion = regionBase
  let lastError = null
  for (const r of order) {
    try {
      const out = await runAlpr(tmpPath, r)
      const resArr = Array.isArray(out.results) ? out.results : []
      parsed = out
      usedRegion = r
      if (resArr.length > 0) break
    } catch (e) {
      lastError = e
    }
  }
  if (!parsed) {
    res.status(500).json(lastError || { error: 'unknown' })
    return
  }
  const results = Array.isArray(parsed.results) ? parsed.results : []
  const plates = results.map(r => ({
    plate: r.plate,
    confidence: typeof r.confidence === 'number' ? r.confidence : Number(r.confidence) || 0,
    region: usedRegion,
    candidates: Array.isArray(r.candidates)
      ? r.candidates.map(c => ({
          plate: c.plate,
          confidence: typeof c.confidence === 'number' ? c.confidence : Number(c.confidence) || 0
        }))
      : []
  }))
  res.json({ plates, meta: { processing_time_ms: parsed.processing_time_ms || null, regionTried: order } })
})

const PORT = process.env.PORT || 5000
app.listen(PORT, () => {
  console.log(`server: http://localhost:${PORT}`)
})
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, regionDefault: (process.env.ALPR_REGION || 'br') })
})

const clientBuildDir = path.join(__dirname, '../client/build')
if (fs.existsSync(clientBuildDir)) {
  app.use(express.static(clientBuildDir))
  app.get('*', (req, res, next) => {
    if (req.path && req.path.startsWith('/api')) return next()
    res.sendFile(path.join(clientBuildDir, 'index.html'))
  })
}
