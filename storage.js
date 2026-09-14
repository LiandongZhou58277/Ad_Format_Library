'use strict';

/*
 * Storage adapter — dual mode, chosen automatically from env vars:
 *
 *   Data    : Upstash Redis (one JSON doc) in prod  ·  data/library.json on disk in dev
 *   Uploads : Vercel Blob in prod                   ·  uploads/ on disk in dev
 *
 * Prod is selected when the relevant env vars exist (set automatically when you
 * connect an Upstash Redis store / Blob store to the Vercel project). With no
 * env vars present everything falls back to the local filesystem, so
 * `node server.js` keeps working unchanged for development.
 *
 * Cloud client libraries are required lazily so local dev never needs them
 * installed, and so the function only pays the import cost when actually used.
 */

const fs = require('fs');
const path = require('path');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const USE_REDIS = !!(REDIS_URL && REDIS_TOKEN);
const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;

const DB_KEY = 'adlib:db';
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'library.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

/* ---------- data document ---------- */
let _redis = null;
function redis() {
  if (_redis) return _redis;
  const { Redis } = require('@upstash/redis');
  _redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
  return _redis;
}

async function loadDb() {
  if (USE_REDIS) {
    const data = await redis().get(DB_KEY); // @upstash/redis auto-parses JSON
    return data || null;
  }
  try {
    if (fs.existsSync(DB_FILE)) return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    console.error('Could not read data file:', e.message);
  }
  return null;
}

async function saveDb(db) {
  if (USE_REDIS) { await redis().set(DB_KEY, db); return; }
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

/* ---------- uploaded media ---------- */
// Accepts a multer memory-storage file: { buffer, originalname, mimetype }.
// Returns { url, filename } — `filename` is null in Blob mode (url is absolute).
async function saveUpload(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (USE_BLOB) {
    const { put } = require('@vercel/blob');
    const key = `uploads/${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
    const blob = await put(key, file.buffer, { access: 'public', contentType: file.mimetype });
    return { url: blob.url, filename: null };
  }
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const base = path.basename(file.originalname, ext).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40);
  const filename = `${Date.now()}-${Math.round(Math.random() * 1e6)}-${base}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), file.buffer);
  return { url: '/uploads/' + filename, filename };
}

async function deleteUpload(m) {
  if (!m) return;
  // Blob-stored media has an absolute https url and no local filename
  if (USE_BLOB && m.url && /^https?:\/\//.test(m.url)) {
    try { const { del } = require('@vercel/blob'); await del(m.url); } catch (e) { /* ignore */ }
    return;
  }
  if (m.filename) {
    try { await fs.promises.unlink(path.join(UPLOAD_DIR, m.filename)); } catch (e) { /* ignore */ }
  }
}

module.exports = { loadDb, saveDb, saveUpload, deleteUpload, USE_REDIS, USE_BLOB, UPLOAD_DIR };
