'use strict';

const path = require('path');
const express = require('express');
const multer = require('multer');
const store = require('./store');
const storage = require('./storage');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_MODE = process.env.APP_MODE || 'full';        // 'inspirations' = standalone moodboard tool
const APP_PASSWORD = process.env.APP_PASSWORD || '';    // when set, the whole app sits behind a shared password

/* ---------- shared-password gate ---------- */
// Stateless: the session cookie holds an HMAC derived from the password, so no server-side session
// store is needed (serverless-safe). Changing the password invalidates every session.
// The password itself is never in source — set APP_PASSWORD in the environment.
const crypto = require('crypto');
const SESSION_COOKIE = 'adlib_session';
const safeEq = (a, b) => { const A = Buffer.from(String(a)), B = Buffer.from(String(b)); return A.length === B.length && crypto.timingSafeEqual(A, B); };
const sessionToken = () => crypto.createHmac('sha256', 'adlib-session:' + APP_PASSWORD).update(APP_PASSWORD).digest('hex');
const readCookie = (req, name) => {
  const c = (req.headers.cookie || '').split(';').map((s) => s.trim()).find((s) => s.startsWith(name + '='));
  return c ? decodeURIComponent(c.slice(name.length + 1)) : '';
};
const isAuthed = (req) => !APP_PASSWORD || safeEq(readCookie(req, SESSION_COOKIE), sessionToken());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// login endpoint stays open; everything else (pages, assets, API, uploads) is gated when a password is set
app.post('/api/login', (req, res) => {
  const pw = String((req.body && req.body.password) || '');
  if (!APP_PASSWORD || !safeEq(pw, APP_PASSWORD)) return res.status(401).json({ error: 'Wrong password' });
  const secure = process.env.VERCEL ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(sessionToken())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${secure}`);
  res.json({ ok: true });
});
app.use((req, res, next) => {
  if (isAuthed(req) || req.path === '/login.html') return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Login required' });
  res.redirect('/login.html');
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(storage.UPLOAD_DIR));

/* ---------- file uploads ---------- */
// Files are held in memory, then written by the storage adapter (Blob in prod,
// uploads/ on disk in dev).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\//.test(file.mimetype) || /^video\//.test(file.mimetype);
    cb(ok ? null : new Error('Only image and video files are allowed'), ok);
  },
});

async function storeFiles(files, extra = {}) {
  return Promise.all((files || []).map(async (file) => {
    const up = await storage.saveUpload(file);
    return {
      kind: /^video\//.test(file.mimetype) ? 'video' : 'image',
      url: up.url,
      filename: up.filename,
      original_name: file.originalname,
      ...extra,
    };
  }));
}

function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Server error' }); }
  };
}

/* ---------- meta ---------- */
app.get('/api/meta', wrap(async (req, res) => res.json({
  products: store.PRODUCTS, categories: store.CATEGORIES, statuses: store.STATUSES, blob: storage.USE_BLOB, mode: APP_MODE,
  inspirations: await store.getInspVocab(),
})));

/* ---------- formats ---------- */
app.get('/api/formats', wrap(async (req, res) => res.json(await store.listFormats())));

app.get('/api/formats/:id', wrap(async (req, res) => {
  const f = await store.getFormat(Number(req.params.id));
  if (!f) return res.status(404).json({ error: 'Format not found' });
  res.json(f);
}));

app.post('/api/formats', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.name.trim()) return res.status(400).json({ error: 'Name is required' });
  res.status(201).json(await store.createFormat(b));
}));

app.put('/api/formats/:id', wrap(async (req, res) => {
  const f = await store.updateFormat(Number(req.params.id), req.body || {});
  if (!f) return res.status(404).json({ error: 'Format not found' });
  res.json(f);
}));

app.delete('/api/formats/:id', wrap(async (req, res) => {
  const removed = await store.deleteFormat(Number(req.params.id));
  if (removed == null) return res.status(404).json({ error: 'Format not found' });
  await Promise.all(removed.map((m) => storage.deleteUpload(m)));
  res.json({ ok: true });
}));

/* ---------- variants ---------- */
app.post('/api/formats/:id/variants', wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.name.trim()) return res.status(400).json({ error: 'Variant name is required' });
  const v = await store.addVariant(Number(req.params.id), b);
  if (!v) return res.status(404).json({ error: 'Format not found' });
  res.status(201).json(v);
}));

app.put('/api/variants/:id', wrap(async (req, res) => {
  const v = await store.updateVariant(Number(req.params.id), req.body || {});
  if (!v) return res.status(404).json({ error: 'Variant not found' });
  res.json(v);
}));

app.delete('/api/variants/:id', wrap(async (req, res) => {
  const removed = await store.deleteVariant(Number(req.params.id));
  if (removed == null) return res.status(404).json({ error: 'Variant not found' });
  await Promise.all(removed.map((m) => storage.deleteUpload(m)));
  res.json({ ok: true });
}));

/* ---------- media ---------- */
app.post('/api/formats/:id/media', upload.array('files', 20), wrap(async (req, res) => {
  const variantId = req.body.variant_id ? Number(req.body.variant_id) : null;
  const caption = req.body.caption || '';
  const items = await storeFiles(req.files, { caption });
  const created = await store.addMedia(Number(req.params.id), variantId, items);
  if (created == null) { await Promise.all(items.map((it) => storage.deleteUpload(it))); return res.status(404).json({ error: 'Format not found' }); }
  res.status(201).json(created);
}));

app.put('/api/media/:id/cover', wrap(async (req, res) => {
  const m = await store.setCover(Number(req.params.id));
  if (!m) return res.status(404).json({ error: 'Media not found' });
  res.json({ ok: true });
}));

app.delete('/api/media/:id', wrap(async (req, res) => {
  const m = await store.deleteMedia(Number(req.params.id));
  if (!m) return res.status(404).json({ error: 'Media not found' });
  await storage.deleteUpload(m);
  res.json({ ok: true });
}));

/* ---------- inspirations ---------- */
app.get('/api/inspirations', wrap(async (req, res) => res.json(await store.listInspirations())));

// Client-upload token exchange: the browser uploads straight to Blob (bypassing the 4.5MB function
// body limit for videos), then records the resulting url via POST /api/inspirations { url }.
// Reachable only when authenticated (gate above) and when Blob is configured.
app.post('/api/blob/upload', wrap(async (req, res) => {
  if (!storage.USE_BLOB) return res.status(400).json({ error: 'Blob storage is not configured' });
  const { handleUpload } = require('@vercel/blob/client');
  try {
    const json = await handleUpload({
      body: req.body,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'],
        addRandomSuffix: true,
        maximumSizeInBytes: 500 * 1024 * 1024,
        tokenPayload: '',
      }),
      onUploadCompleted: async () => {}, // the client creates the record itself (this callback can't reach localhost)
    });
    res.json(json);
  } catch (err) { res.status(400).json({ error: err.message }); }
}));

const BLOB_URL_RE = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i;

app.post('/api/inspirations', upload.array('files', 20), wrap(async (req, res) => {
  let items;
  if (req.body && req.body.url) {
    // JSON body: file already sits in Blob (client upload) — only accept our own Blob host
    if (!BLOB_URL_RE.test(String(req.body.url))) return res.status(400).json({ error: 'Invalid media url' });
    items = [{ kind: /^video\//.test(String(req.body.mimetype || '')) ? 'video' : 'image', url: String(req.body.url), filename: null, original_name: String(req.body.original_name || '') }];
  } else {
    items = await storeFiles(req.files); // multipart: written by the storage adapter (disk in dev)
  }
  if (!items.length) return res.status(400).json({ error: 'No files uploaded' });
  const { app: appName, position, type, tags } = req.body;
  res.status(201).json(await store.addInspirations(items, { app: appName, position, type, tags: (tags || '').trim() }));
}));

// add an option to an inspiration vocabulary dimension ("+ Add Tag"); returns the full updated vocab
app.post('/api/inspirations/vocab/:dim', wrap(async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Tag name is required' });
  const vocab = await store.addInspOption(req.params.dim, name);
  if (!vocab) return res.status(400).json({ error: 'Unknown dimension' });
  res.status(201).json(vocab);
}));

// replace a dimension's option list — reorder (drag) or remove (✕) from the Upload modal's Edit mode
app.put('/api/inspirations/vocab/:dim', wrap(async (req, res) => {
  const vocab = await store.setInspOptions(req.params.dim, req.body && req.body.options);
  if (!vocab) return res.status(400).json({ error: 'Unknown dimension or bad options' });
  res.json(vocab);
}));

app.put('/api/inspirations/:id', wrap(async (req, res) => {
  const ins = await store.updateInspiration(Number(req.params.id), req.body || {});
  if (!ins) return res.status(404).json({ error: 'Inspiration not found' });
  res.json(ins);
}));

app.delete('/api/inspirations/:id', wrap(async (req, res) => {
  const removed = await store.deleteInspiration(Number(req.params.id));
  if (!removed) return res.status(404).json({ error: 'Inspiration not found' });
  await storage.deleteUpload(removed);
  res.json({ ok: true });
}));

/* ---------- tag vocabulary ---------- */
app.get('/api/tags', wrap(async (req, res) => res.json(await store.listTags())));

app.post('/api/tags', wrap(async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Tag name is required' });
  await store.addTag(name);
  res.status(201).json(await store.listTags());
}));

app.delete('/api/tags/:name', wrap(async (req, res) => {
  await store.deleteTag(decodeURIComponent(req.params.name));
  res.json(await store.listTags());
}));

/* ---------- error handler ---------- */
app.use((err, req, res, next) => {
  if (err) return res.status(400).json({ error: err.message || 'Upload error' });
  next();
});

if (require.main === module) {
  app.listen(PORT, () => console.log(`Ad Format Library running at http://localhost:${PORT}`));
}

module.exports = app;
