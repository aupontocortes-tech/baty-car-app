module.exports = async (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    if (req.method === 'OPTIONS') {
      res.status(204).end()
      return
    }
  } catch (_) {}
  res.json({ ok: true, regionDefault: (process.env.ALPR_REGION || 'br') })
}

