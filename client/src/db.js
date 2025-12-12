// Simple IndexedDB wrapper for storing plates locally
// Database: plates_db, store: plates (key: plate)

const DB_NAME = 'plates_db'
const STORE_NAME = 'plates'
const DB_VERSION = 1

function openDB() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = (e) => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'plate' })
          store.createIndex('by_plate', 'plate', { unique: true })
          store.createIndex('by_lastSeen', 'lastSeen', { unique: false })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error || new Error('indexeddb_open_failed'))
    } catch (err) {
      reject(err)
    }
  })
}

export async function initDB() {
  const db = await openDB()
  return db
}

export async function upsertPlate(db, plate, source = 'unknown') {
  if (!db || !plate) return false
  const now = new Date().toISOString()
  const tx = db.transaction(STORE_NAME, 'readwrite')
  const store = tx.objectStore(STORE_NAME)
  const existing = await new Promise((resolve) => {
    const r = store.get(plate)
    r.onsuccess = () => resolve(r.result || null)
    r.onerror = () => resolve(null)
  })
  const data = existing
    ? { ...existing, count: (existing.count || 0) + 1, lastSeen: now, source }
    : { plate, count: 1, lastSeen: now, source }
  await new Promise((resolve, reject) => {
    const r = store.put(data)
    r.onsuccess = () => resolve(true)
    r.onerror = () => reject(r.error)
  })
  await new Promise((resolve) => { tx.oncomplete = resolve })
  return true
}

export async function getAllPlates(db) {
  if (!db) return []
  const tx = db.transaction(STORE_NAME, 'readonly')
  const store = tx.objectStore(STORE_NAME)
  const res = await new Promise((resolve, reject) => {
    const out = []
    const cursorReq = store.openCursor()
    cursorReq.onsuccess = (e) => {
      const cursor = e.target.result
      if (cursor) { out.push(cursor.value); cursor.continue() } else { resolve(out) }
    }
    cursorReq.onerror = () => reject(cursorReq.error)
  })
  await new Promise((resolve) => { tx.oncomplete = resolve })
  return res
}

export async function searchPlatesByPrefix(db, prefix, limit = 10) {
  if (!db) return []
  const pfx = String(prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (!pfx) return []
  const all = await getAllPlates(db)
  const filtered = all
    .filter(x => String(x.plate || '').startsWith(pfx))
    .sort((a, b) => {
      // Recent first, then higher count
      const ta = Date.parse(a.lastSeen || 0) || 0
      const tb = Date.parse(b.lastSeen || 0) || 0
      if (tb !== ta) return tb - ta
      return (b.count || 0) - (a.count || 0)
    })
    .slice(0, limit)
  return filtered.map(x => x.plate)
}

export async function hasPlate(db, plate) {
  if (!db || !plate) return false
  const tx = db.transaction(STORE_NAME, 'readonly')
  const store = tx.objectStore(STORE_NAME)
  const ok = await new Promise((resolve) => {
    const r = store.get(plate)
    r.onsuccess = () => resolve(!!r.result)
    r.onerror = () => resolve(false)
  })
  await new Promise((resolve) => { tx.oncomplete = resolve })
  return ok
}