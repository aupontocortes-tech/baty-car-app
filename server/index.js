require('dotenv').config()
const express = require('express')
const cors = require('cors')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const fetch = require('node-fetch')
const FormData = require('form-data')

const app = express()
const allowedOrigins = ['https://baty-car-app.vercel.app','http://localhost:3000','http://localhost:3001']
const corsOptions = { origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)), methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','Authorization','Accept','X-Requested-With'], credentials: false, optionsSuccessStatus: 204 }
app.use(cors(corsOptions))
app.options('*', cors(corsOptions))
app.use((req,res,next)=>{ const o=req.headers.origin; if(o&&allowedOrigins.includes(o)) res.header('Access-Control-Allow-Origin',o); res.header('Access-Control-Allow-Methods','GET,POST,OPTIONS'); res.header('Access-Control-Allow-Headers','Content-Type, Authorization, Accept, X-Requested-With'); if(req.method==='OPTIONS') return res.sendStatus(204); next() })

const rawBytes = express.raw({ type: 'application/octet-stream', limit: '10mb' })
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10*1024*1024 } })

const KEY = (process.env.PLATERECOGNIZER_API_KEY || process.env.PLATEREGONIZE_API_KEY || '').trim()
const BASE = (process.env.PLATERECOGNIZER_BASE_URL || process.env.PLATEREGONIZE_BASE_URL || 'https://api.platerecognizer.com').replace(/\/+$/,'')
const UA = 'BatyCarApp/1.0'

// Rush local (PlateRecognizer local SDK) — opcional
const RUSH_BASE = (process.env.RUSH_BASE_URL || process.env.OPENALPR_RUSH_BASE_URL || '').replace(/\/+$/,'')
const RUSH_TOKEN = (process.env.RUSH_API_KEY || process.env.RUSH_TOKEN || '').trim()

function normalize(out){
  const results = Array.isArray(out?.results) ? out.results : []
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
  return results.map(r => {
    const plateFixed = fixMercosul(r.plate)
    const plate = plateFixed || norm(r.plate)
    const s = typeof r.score === 'number' ? r.score : (r.confidence != null ? Number(r.confidence) : 0)
    const confidence = s > 1 ? s : Math.round((s || 0) * 100)
    return { plate, confidence }
  })
}

app.get('/api/health', (req,res)=>{ res.json({ ok:true, ts:Date.now(), uptime:process.uptime() }) })

app.post('/api/recognize-bytes', rawBytes, async (req,res)=>{
  try {
    const buf = req.body
    if(!buf || !Buffer.isBuffer(buf) || buf.length<16){ res.status(400).json({ error:'missing_bytes' }); return }
    const region = String((req.query.region || process.env.ALPR_REGION || 'br')).toLowerCase()
    let out=null, tried=[]

    // Rush local: recognize-bytes (se configurado)
    if(RUSH_BASE){
      const rushBytes = `${RUSH_BASE}/v1/recognize-bytes?regions=${encodeURIComponent(region)}&topn=20`
      tried.push('rush:recognize-bytes')
      try{
        const headersRush = { 'Content-Type':'application/octet-stream','Accept':'application/json','User-Agent':UA }
        if(RUSH_TOKEN) headersRush['Authorization'] = `Token ${RUSH_TOKEN}`
        const rRush = await fetch(rushBytes,{ method:'POST', headers: headersRush, body: buf })
        if(rRush.ok) out = await rRush.json()
      }catch(_){ }
    }

    // Rush local: plate-reader (fallback) — multipart
    if((!out || !Array.isArray(out.results) || out.results.length===0) && RUSH_BASE){
      tried.push('rush:plate-reader')
      const formRush = new FormData(); formRush.append('upload', buf, { filename:'frame.jpg', contentType:'application/octet-stream' })
      const headersRushForm = { ...formRush.getHeaders(), 'Accept':'application/json','User-Agent':UA }
      if(RUSH_TOKEN) headersRushForm['Authorization'] = `Token ${RUSH_TOKEN}`
      const rushReader = `${RUSH_BASE}/v1/plate-reader/?regions=${encodeURIComponent(region)}&topn=20`
      try{ const rRush2 = await fetch(rushReader,{ method:'POST', headers: headersRushForm, body: formRush }); if(rRush2.ok) out = await rRush2.json() }catch(_){ }
    }

    // PlateRecognizer: recognize-bytes (se houver chave)
    if((!out || !Array.isArray(out.results) || out.results.length===0) && KEY){
      const urlBytes = `${BASE}/v1/recognize-bytes?regions=${encodeURIComponent(region)}&topn=20`
      tried.push('platerecognizer:recognize-bytes')
      try{
        const r = await fetch(urlBytes,{ method:'POST', headers:{ 'Content-Type':'application/octet-stream','Accept':'application/json','Authorization':`Token ${KEY}`,'User-Agent':UA }, body:buf })
        if(r.ok) out = await r.json()
      }catch(_){ }
    }

    // PlateRecognizer: plate-reader (se houver chave)
    if((!out || !Array.isArray(out.results) || out.results.length===0) && KEY){
      tried.push('platerecognizer:plate-reader')
      const form = new FormData(); form.append('upload', buf, { filename:'frame.jpg', contentType:'application/octet-stream' })
      const headers = { ...form.getHeaders(), 'Accept':'application/json','Authorization':`Token ${KEY}`,'User-Agent':UA }
      const urlReader = `${BASE}/v1/plate-reader/?regions=${encodeURIComponent(region)}&topn=20`
      try{ const r2 = await fetch(urlReader,{ method:'POST', headers, body:form }); if(r2.ok) out = await r2.json() }catch(_){ }
    }

    // Fallback extra: OpenALPR FastAPI
    if(!out || !Array.isArray(out.results) || out.results.length===0){
      tried.push('openalpr-fastapi:read-plate')
      const fd3 = new FormData(); fd3.append('file', buf, { filename:'frame.jpg', contentType:'application/octet-stream' })
      const FAST_BASE = (process.env.OPENALPR_FASTAPI_BASE || 'https://openalpr-fastapi-1.onrender.com').replace(/\/+$/,'')
      const FAST_URL = `${FAST_BASE}/read-plate?region=${encodeURIComponent(region)}`
      try{ const r3 = await fetch(FAST_URL,{ method:'POST', body: fd3, headers: fd3.getHeaders() }); if(r3.ok){ const j3 = await r3.json(); if(j3 && !j3.results && Array.isArray(j3.plates)){ j3.results = j3.plates.map(p=>({ plate:p.plate, confidence:p.confidence })) } out = j3 } }catch(_){ }
    }
    if(!out || !Array.isArray(out.results) || out.results.length===0){ res.json({ error:'no_plate', detail:'Nenhuma placa encontrada', tried }); return }
    res.json({ plates: normalize(out), meta:{ provider: (RUSH_BASE ? 'rush' : 'platerecognizer'), tried } })
  }catch(e){ res.status(500).json({ error:'platerecognizer_failed', detail:String(e&&e.message||e) }) }
})

app.post('/api/recognize', upload.any(), async (req,res)=>{
  try{
    const file = (req.files||[]).find(f=>f.fieldname==='upload' || f.fieldname==='frame')
    if(!file || !file.buffer){ res.status(400).json({ error:'missing_file' }); return }
    const buf = file.buffer
    const region = String((req.query.region || process.env.ALPR_REGION || 'br')).toLowerCase()

    let out=null, tried=[]

    // Rush local: plate-reader (se configurado)
    if(RUSH_BASE){
      const formRush = new FormData(); formRush.append('upload', buf, { filename:file.originalname||'frame.jpg', contentType:file.mimetype||'application/octet-stream' })
      const headersRush = { ...formRush.getHeaders(), 'Accept':'application/json','User-Agent':UA }
      if(RUSH_TOKEN) headersRush['Authorization'] = `Token ${RUSH_TOKEN}`
      const rushReader = `${RUSH_BASE}/v1/plate-reader/?regions=${encodeURIComponent(region)}&topn=20`
      tried.push('rush:plate-reader')
      try{ const rRush = await fetch(rushReader,{ method:'POST', headers: headersRush, body: formRush }); if(rRush.ok) out = await rRush.json() }catch(_){ }
    }

    // Rush local: recognize-bytes (fallback)
    if((!out || !Array.isArray(out.results) || out.results.length===0) && RUSH_BASE){
      const rushBytes = `${RUSH_BASE}/v1/recognize-bytes?regions=${encodeURIComponent(region)}&topn=20`
      tried.push('rush:recognize-bytes')
      try{ const rRush2 = await fetch(rushBytes,{ method:'POST', headers:{ 'Content-Type':'application/octet-stream','Accept':'application/json','User-Agent':UA, ...(RUSH_TOKEN?{ 'Authorization':`Token ${RUSH_TOKEN}` }: {}) }, body:buf }); if(rRush2.ok) out = await rRush2.json() }catch(_){ }
    }

    // PlateRecognizer: plate-reader (se houver chave)
    if((!out || !Array.isArray(out.results) || out.results.length===0) && KEY){
      const form = new FormData(); form.append('upload', buf, { filename:file.originalname||'frame.jpg', contentType:file.mimetype||'application/octet-stream' })
      const headers = { ...form.getHeaders(), 'Accept':'application/json','Authorization':`Token ${KEY}`,'User-Agent':UA }
      const urlReader = `${BASE}/v1/plate-reader/?regions=${encodeURIComponent(region)}&topn=20`
      tried.push('platerecognizer:plate-reader')
      try{ const r = await fetch(urlReader,{ method:'POST', headers, body:form }); if(r.ok) out = await r.json() }catch(_){ }
    }

    // PlateRecognizer: recognize-bytes (se houver chave)
    if((!out || !Array.isArray(out.results) || out.results.length===0) && KEY){
      const urlBytes = `${BASE}/v1/recognize-bytes?regions=${encodeURIComponent(region)}&topn=20`
      tried.push('platerecognizer:recognize-bytes')
      try{ const r2 = await fetch(urlBytes,{ method:'POST', headers:{ 'Content-Type':'application/octet-stream','Accept':'application/json','Authorization':`Token ${KEY}`,'User-Agent':UA }, body:buf }); if(r2.ok) out = await r2.json() }catch(_){ }
    }

    // Fallback extra: OpenALPR FastAPI
    if(!out || !Array.isArray(out.results) || out.results.length===0){
      tried.push('openalpr-fastapi:read-plate')
      const fd3 = new FormData(); fd3.append('file', buf, { filename:file.originalname||'frame.jpg', contentType:file.mimetype||'application/octet-stream' })
      const FAST_BASE = (process.env.OPENALPR_FASTAPI_BASE || 'https://openalpr-fastapi-1.onrender.com').replace(/\/+$/,'')
      const FAST_URL = `${FAST_BASE}/read-plate?region=${encodeURIComponent(region)}`
      try{ const r3 = await fetch(FAST_URL,{ method:'POST', body: fd3, headers: fd3.getHeaders() }); if(r3.ok){ const j3 = await r3.json(); if(j3 && !j3.results && Array.isArray(j3.plates)){ j3.results = j3.plates.map(p=>({ plate:p.plate, confidence:p.confidence })) } out = j3 } }catch(_){ }
    }
    if(!out || !Array.isArray(out.results) || out.results.length===0){ res.json({ error:'no_plate', detail:'Nenhuma placa encontrada', tried }); return }
    res.json({ plates: normalize(out), meta:{ provider: (RUSH_BASE ? 'rush' : 'platerecognizer'), tried } })
  }catch(e){ res.status(500).json({ error:'platerecognizer_failed', detail:String(e&&e.message||e) }) }
})

// Static client (prod build)
const clientBuildDir = path.join(__dirname,'../client/build')
if(fs.existsSync(clientBuildDir)){
  app.use(express.static(clientBuildDir))
  app.get('*',(req,res,next)=>{ if(req.path && req.path.startsWith('/api')) return next(); res.sendFile(path.join(clientBuildDir,'index.html')) })
}

const PORT = process.env.PORT || 5001
app.listen(PORT, ()=>{ console.log(`server: http://localhost:${PORT}`) })
