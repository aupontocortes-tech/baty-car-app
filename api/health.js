module.exports = async (_req, res) => {
  res.json({ ok: true, regionDefault: (process.env.ALPR_REGION || 'br') })
}

