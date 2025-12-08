require('dotenv').config()
const express = require('express')
const cors = require('cors')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const fetch = require('node-fetch')
const FormData = require('form-data')

const app = express()
const allowedOrigins = ['https://baty-car-app.vercel.app','http://localhost:3000']
const corsOptions = { origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)), methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','Authorization','Accept','X-Requested-With'], credentials: false, optionsSuccessStatus: 204 }
app.use(cors(corsOptions))
app.options('*', cors(corsOptions))
app.use((req,res,next)=>{ const o=req.headers.origin; if(o&&allowedOrigins.includes(o)) res.header('Access-Control-Allow-Origin',o); res.header('Access-Control-Allow-Methods','GET,POST,OPTIONS'); res.header('Access-Control-Allow-Headers','Content-Type, Authorization, Accept, X-Requested-With'); if(req.method==='OPTIONS') return res.sendStatus(204); next() })

const rawBytes = express.raw({ type: 'application/octet-stream', limit: '10mb' })
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10*1024*1024 } })

const KEY = (process.env.PLATERECOGNIZER_API_KEY || process.env.PLATEREGONIZE_API_KEY || '').trim()
const BASE = (process.env.PLATERECOGNIZER_BASE_URL || process.env.PLATEREGONIZE_BASE_URL || 'https://api.platerecognizer.com').replace(/\/+$/,'')
const UA = 'BatyCarApp/1.0'

function normalize(out){ const results = Array.isArray(out?.results) ? out.results : []; return results.map(r=>{ const plate = String(r.plate||'').toUpperCase().replace(/[^A-Z0-9]/g,''); const s = typeof r.score==='number'?r.score:(r.confidence!=null?Number(r.confidence):0); const confidence = s>1?s:Math.round((s||0)*100); return { plate, confidence } }) }

app.get('/api/health', (req,res)=>{ res.json({ ok:true, ts:Date.now(), uptime:process.uptime() }) })

app.post('/api/recognize-bytes', rawBytes, async (req,res)=>{
  try {
    if(!KEY){ res.status(500).json({ error:'missing_api_key' }); return }
    const buf = req.body
    if(!buf || !Buffer.isBuffer(buf) || buf.length<16){ res.status(400).json({ error:'missing_bytes' }); return }
    const region = String((req.query.region || process.env.ALPR_REGION || 'br')).toLowerCase()
    const urlBytes = `${BASE}/v1/recognize-bytes?regions=${encodeURIComponent(region)}&topn=20`
    let out=null, tried=['platerecognizer:recognize-bytes']
    try{
      const r = await fetch(urlBytes,{ method:'POST', headers:{ 'Content-Type':'application/octet-stream','Accept':'application/json','Authorization':`Token ${KEY}`,'User-Agent':UA }, body:buf })
      if(r.ok) out = await r.json()
    }catch(_){ }
    if(!out || !Array.isArray(out.results) || out.results.length===0){
      tried.push('platerecognizer:plate-reader')
      const form = new FormData(); form.append('upload', buf, { filename:'frame.jpg', contentType:'application/octet-stream' })
      const headers = { ...form.getHeaders(), 'Accept':'application/json','Authorization':`Token ${KEY}`,'User-Agent':UA }
      const urlReader = `${BASE}/v1/plate-reader/?regions=${encodeURIComponent(region)}&topn=20`
      try{ const r2 = await fetch(urlReader,{ method:'POST', headers, body:form }); if(r2.ok) out = await r2.json() }catch(_){ }
    }
    if(!out || !Array.isArray(out.results) || out.results.length===0){ res.json({ error:'no_plate', detail:'Nenhuma placa encontrada', tried }); return }
    res.json({ plates: normalize(out), meta:{ provider:'platerecognizer', tried } })
  }catch(e){ res.status(500).json({ error:'platerecognizer_failed', detail:String(e&&e.message||e) }) }
})

app.post('/api/recognize', upload.any(), async (req,res)=>{
  try{
    if(!KEY){ res.status(500).json({ error:'missing_api_key' }); return }
    const file = (req.files||[]).find(f=>f.fieldname==='upload' || f.fieldname==='frame')
    if(!file || !file.buffer){ res.status(400).json({ error:'missing_file' }); return }
    const buf = file.buffer
    const region = String((req.query.region || process.env.ALPR_REGION || 'br')).toLowerCase()
    const form = new FormData(); form.append('upload', buf, { filename:file.originalname||'frame.jpg', contentType:file.mimetype||'application/octet-stream' })
    const headers = { ...form.getHeaders(), 'Accept':'application/json','Authorization':`Token ${KEY}`,'User-Agent':UA }
    const urlReader = `${BASE}/v1/plate-reader/?regions=${encodeURIComponent(region)}&topn=20`
    let out=null; try{ const r = await fetch(urlReader,{ method:'POST', headers, body:form }); if(r.ok) out = await r.json() }catch(_){ }
    if(!out || !Array.isArray(out.results) || out.results.length===0){
      const urlBytes = `${BASE}/v1/recognize-bytes?regions=${encodeURIComponent(region)}&topn=20`
      try{ const r2 = await fetch(urlBytes,{ method:'POST', headers:{ 'Content-Type':'application/octet-stream','Accept':'application/json','Authorization':`Token ${KEY}`,'User-Agent':UA }, body:buf }); if(r2.ok) out = await r2.json() }catch(_){ }
    }
    if(!out || !Array.isArray(out.results) || out.results.length===0){ res.json({ error:'no_plate', detail:'Nenhuma placa encontrada' }); return }
    res.json({ plates: normalize(out), meta:{ provider:'platerecognizer' } })
  }catch(e){ res.status(500).json({ error:'platerecognizer_failed', detail:String(e&&e.message||e) }) }
})

// Static client (prod build)
const clientBuildDir = path.join(__dirname,'../client/build')
if(fs.existsSync(clientBuildDir)){
  app.use(express.static(clientBuildDir))
  app.get('*',(req,res,next)=>{ if(req.path && req.path.startsWith('/api')) return next(); res.sendFile(path.join(clientBuildDir,'index.html')) })
}

const PORT = process.env.PORT || 5000
app.listen(PORT, ()=>{ console.log(`server: http://localhost:${PORT}`) })
