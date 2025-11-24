/**
 * Servidor Node.js + Express para ALPR (leitura de placas) usando engine open-source local.
 * Integra com "open-lpr" (https://github.com/faisalthaheem/open-lpr) via HTTP, sem chaves de API.
 *
 * Endpoints:
 *   POST /scan
 *     Body JSON: { "image": "base64string" }
 *     Retorno: { "plate": "AAA1A23", "confidence": 88 }
 *
 * Como funciona:
 * - Converte base64 para arquivo temporário
 * - Encaminha para o serviço open-lpr (container ou serviço Python) via HTTP
 * - Faz parsing seguro e retorna placa + confiança
 *
 * Deploy:
 * - Railway/Render: suba o serviço open-lpr (CPU compose) e este servidor Node.
 * - Replit: execute o open-lpr em um serviço separado acessível via HTTP.
 *
 * Variáveis de ambiente:
 * - PORT: porta HTTP (padrão 3000)
 * - OPENLPR_URL: URL base do serviço open-lpr (padrão http://localhost:8000)
 * - OPENLPR_DETECT_PATH: caminho do endpoint de detecção (padrão /api/detect)
 */

const express = require('express')
const fs = require('fs')
const path = require('path')
const os = require('os')
const fetch = require('node-fetch')

// Configurações
const PORT = Number(process.env.PORT || 3000)
const OPENLPR_URL = String(process.env.OPENLPR_URL || 'http://localhost:8000').replace(/\/$/, '')
const OPENLPR_DETECT_PATH = String(process.env.OPENLPR_DETECT_PATH || '/api/detect')

const app = express()
app.use(express.json({ limit: '10mb' }))

/**
 * Testa conectividade com open-lpr ao iniciar o servidor.
 * Não é obrigatório para funcionar, apenas auxilia com logs.
 */
async function probeOpenLpr() {
  try {
    const url = OPENLPR_URL + '/'
    const resp = await fetch(url, { method: 'GET' })
    if (resp.ok) {
      console.log(`[init] open-lpr acessível em ${OPENLPR_URL}`)
    } else {
      console.log(`[init] open-lpr respondeu status ${resp.status} em ${OPENLPR_URL}`)
    }
  } catch (_e) {
    console.log('[init] open-lpr não acessível. Defina OPENLPR_URL apontando para o serviço em execução.')
  }
}

/**
 * Converte base64 (dataURL ou puro) para arquivo temporário .jpg
 */
function base64ToTempFile(b64) {
  const tmpDir = os.tmpdir()
  const fname = `scan_${Date.now()}.jpg`
  const fpath = path.join(tmpDir, fname)
  const clean = String(b64 || '').replace(/^data:[^;]+;base64,/, '')
  const buf = Buffer.from(clean, 'base64')
  fs.writeFileSync(fpath, buf)
  return fpath
}

/**
 * Encaminha a imagem para o serviço open-lpr e extrai placa/confiança.
 * Aceita tanto resposta direta { plate, confidence } quanto { results: [{ plate, confidence }]}.
 */
async function runOpenLpr(filePath) {
  const url = OPENLPR_URL + OPENLPR_DETECT_PATH
  // Lê arquivo e envia como base64 num JSON (convenção simples)
  const buf = fs.readFileSync(filePath)
  const b64 = buf.toString('base64')
  const body = { image: b64 }
  const headers = { 'Content-Type': 'application/json' }
  const resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`openlpr_status_${resp.status} ${text}`)
  }
  const data = await resp.json()
  const first = Array.isArray(data?.results) ? data.results[0] : null
  const plate = (data?.plate || (first && first.plate) || '').toString()
  const confidenceRaw = (data?.confidence != null ? data.confidence : (first && first.confidence))
  const confidence = typeof confidenceRaw === 'number' ? confidenceRaw : (Number(confidenceRaw) || 0)
  return { plate, confidence }
}

/**
 * POST /scan
 * Recebe { image: base64 } e retorna { plate, confidence }
 */
app.post('/scan', async (req, res) => {
  try {
    const image = req?.body?.image
    if (!image || typeof image !== 'string' || image.length < 32) {
      res.status(400).json({ error: 'invalid_image', detail: 'Envie JSON { image: base64 }' })
      return
    }
    const tmp = base64ToTempFile(image)
    try {
      const out = await runOpenLpr(tmp)
      const plateNorm = String(out.plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
      res.json({ plate: plateNorm, confidence: out.confidence })
    } finally {
      try { fs.unlinkSync(tmp) } catch (_e) {}
    }
  } catch (e) {
    const msg = String((e && e.message) || e)
    res.status(500).json({ error: 'scan_failed', detail: msg })
  }
})

app.get('/', (_req, res) => {
  res.json({ ok: true, engine: 'open-lpr', openlpr_url: OPENLPR_URL })
})

app.listen(PORT, () => {
  console.log(`server: http://localhost:${PORT}`)
  probeOpenLpr()
})

