'use strict';

/*
 * One-off migration: push the LOCAL inspirations (data/library.json + uploads/) to production
 * (Vercel Blob for the files, Upstash Redis for the document).
 *
 *   node migrate.js --dry-run   # show exactly what would happen, touch nothing
 *   node migrate.js             # do it
 *
 * Credentials come from ./.env (gitignored — never commit it):
 *   BLOB_READ_WRITE_TOKEN, KV_REST_API_URL, KV_REST_API_TOKEN   (UPSTASH_REDIS_REST_URL/TOKEN also work)
 *
 * Safe by design:
 *   - MERGES into whatever is already in prod; never overwrites existing items
 *   - idempotent: an item already migrated (tracked via `migrated_from`) is skipped on re-runs
 *   - migrates inspirations + their App/Position/Type vocab only — the NewsBreak formats are
 *     not part of the standalone tool and are left alone
 *   - reuses the app's own storage adapter, so files go through exactly the code path prod uses
 */

const fs = require('fs');
const path = require('path');

// ---- load ./.env without a dependency ----
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] == null) process.env[m[1]] = v;
  }
}

const DRY = process.argv.includes('--dry-run');
const storage = require('./storage'); // selects Blob + Redis from the env loaded above

if (!storage.USE_BLOB || !storage.USE_REDIS) {
  console.error('Missing credentials in .env  →  blob: %s   redis: %s',
    storage.USE_BLOB ? 'ok' : 'MISSING (BLOB_READ_WRITE_TOKEN)',
    storage.USE_REDIS ? 'ok' : 'MISSING (KV_REST_API_URL + KV_REST_API_TOKEN)');
  process.exit(1);
}

const LOCAL_DB = path.join(__dirname, 'data', 'library.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const INSP_DIMS = ['apps', 'positions', 'types'];
const MIME = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
};
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

(async () => {
  const local = JSON.parse(fs.readFileSync(LOCAL_DB, 'utf8'));
  const items = local.inspirations || [];
  console.log(`${DRY ? '[DRY RUN] ' : ''}local inspirations: ${items.length}`);

  // merge target = the current prod document
  const db = (await storage.loadDb()) || { seq: 0, formats: [], variants: [], media: [], inspirations: [], tags: [] };
  db.seq = db.seq || 0;
  db.inspirations = db.inspirations || [];
  db.inspVocab = db.inspVocab || {};
  INSP_DIMS.forEach((d) => { db.inspVocab[d] = db.inspVocab[d] || []; });
  console.log(`prod inspirations before: ${db.inspirations.length}`);

  const already = new Set(db.inspirations.map((i) => i.migrated_from).filter(Boolean));
  let done = 0, skipped = 0, missing = 0, bytes = 0;

  for (const i of items) {
    const key = i.filename || i.url;
    if (!key) { skipped++; continue; }
    if (already.has(key)) { console.log(`  skip (already in prod): ${key}`); skipped++; continue; }
    const file = i.filename ? path.join(UPLOAD_DIR, i.filename) : null;
    if (!file || !fs.existsSync(file)) { console.log(`  MISSING local file, skipped: ${key}`); missing++; continue; }

    const size = fs.statSync(file).size;
    const ext = path.extname(file).slice(1).toLowerCase();
    const mimetype = MIME[ext] || (i.kind === 'video' ? 'video/mp4' : 'image/png');
    console.log(`  ${DRY ? 'would upload' : 'uploading'}: ${i.filename}  (${(size / 1048576).toFixed(1)} MB, ${i.kind})`);
    bytes += size;
    if (DRY) { done++; continue; }

    const up = await storage.saveUpload({ buffer: fs.readFileSync(file), originalname: i.original_name || i.filename, mimetype });
    db.inspirations.push({
      id: ++db.seq,
      kind: i.kind, url: up.url, filename: null,
      original_name: i.original_name || '',
      app: i.app || '', position: i.position || '', type: i.type || '',
      tags: i.tags || '',
      timestamps: Array.isArray(i.timestamps) ? i.timestamps : [],
      created_at: i.created_at || now(),
      migrated_from: key,
    });
    done++;
  }

  // union the vocab so every option used locally exists in prod too
  if (local.inspVocab) INSP_DIMS.forEach((d) => {
    (local.inspVocab[d] || []).forEach((o) => { if (!db.inspVocab[d].includes(o)) db.inspVocab[d].push(o); });
  });

  if (!DRY) await storage.saveDb(db);

  console.log(`\n${DRY ? 'would migrate' : 'migrated'}: ${done}   skipped: ${skipped}   missing: ${missing}   total: ${(bytes / 1048576).toFixed(1)} MB`);
  console.log(`prod inspirations after: ${DRY ? db.inspirations.length + done : db.inspirations.length}`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
