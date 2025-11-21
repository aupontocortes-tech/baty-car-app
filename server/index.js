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

const runAlpr = (filePath, region) => new Promise((resolve, reject) => {
  const bin = process.env.ALPR_BIN || 'alpr'
  const cmd = `${bin} --detect_region -n 5 -c ${region} -j "${filePath}"`
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
  for (const r of order) {
    try {
      const out = await runAlpr(filePath, r)
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
  res.json({ plates, imageFile: null, meta: { processing_time_ms: parsed.processing_time_ms || null, regionTried: order } })
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