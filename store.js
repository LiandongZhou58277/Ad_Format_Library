'use strict';

/*
 * Data store. The whole dataset is a single JSON document, persisted via the
 * storage adapter (Upstash Redis in prod, data/library.json on disk in dev).
 *
 * Serverless-safe: there is NO long-lived in-memory `db`. Every operation loads
 * the current document, applies its change, and (for writes) saves it back, so
 * concurrent function instances never diverge. Read-modify-write means truly
 * simultaneous writes are last-write-wins — acceptable for a low-traffic
 * internal tool; move to relational rows if that ever becomes a problem.
 */

const storage = require('./storage');

const PRODUCTS = ['NewsBreak', 'Ad Network'];
const CATEGORIES = ['Feed', 'Article', 'Full screen', 'Video / Rewards', 'Other'];
const STATUSES = ['Shipped', 'In Design', 'Rejected', 'Testing'];
// inspiration vocabularies (App / Position / Type). Stored in the document as db.inspVocab so users
// can add options ("+ Add Tag"); these are just the seed values for a fresh/legacy document.
const INSP_DIMS = ['apps', 'positions', 'types'];
const INSP_VOCAB_DEFAULTS = {
  apps: ['TikTok', 'Instagram', 'Facebook', 'Thread', 'Reddit', 'X (Twitter)', 'Linkedin'],
  positions: ['In-feed', 'Immersive Video', 'In-article', 'Reactions', 'Comments', 'Related', 'Other'],
  types: ['Default', 'App-install', 'Game (Playable)', 'E-commerce'],
};
const pickIn = (v, list) => (Array.isArray(list) && list.includes(v) ? v : '');
const VARIANT_FIELDS = ['name', 'dimensions', 'aspect_ratio', 'file_types', 'max_file_size', 'duration', 'behavior', 'placement', 'platforms', 'status', 'figma_link', 'notes'];

const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

function normalize(db) {
  db = db || {};
  db.seq = db.seq || 0;
  db.formats = db.formats || [];
  db.variants = db.variants || [];
  db.media = db.media || [];
  db.inspirations = db.inspirations || [];
  // backfill product / status on records created before the current taxonomy
  db.formats.forEach((f) => { if (!PRODUCTS.includes(f.product)) f.product = PRODUCTS[0]; });
  db.variants.forEach((v) => { if (!STATUSES.includes(v.status)) v.status = STATUSES[0]; });
  // tag vocabulary for inspirations — seed once from format names + tags already used
  if (!Array.isArray(db.tags)) {
    db.tags = [...new Set([
      ...db.formats.map((f) => f.name),
      ...db.inspirations.flatMap((i) => (i.tags || '').split(',').map((t) => t.trim()).filter(Boolean)),
    ])];
  }
  // per-dimension inspiration vocabularies — seed any missing dimension from the defaults
  if (!db.inspVocab || typeof db.inspVocab !== 'object') db.inspVocab = {};
  INSP_DIMS.forEach((d) => { if (!Array.isArray(db.inspVocab[d])) db.inspVocab[d] = INSP_VOCAB_DEFAULTS[d].slice(); });
  return db;
}

// load → operate (read-only)
async function read(fn) {
  return fn(normalize(await storage.loadDb()));
}
// load → mutate → persist
async function write(fn) {
  const db = normalize(await storage.loadDb());
  const result = fn(db);
  await storage.saveDb(db);
  return result;
}

function touchFormat(db, id) {
  const f = db.formats.find((x) => x.id === id);
  if (f) f.updated_at = now();
}

/* ---------- formats ---------- */
function listFormats() {
  return read((db) => db.formats
    .map((f) => {
      const cover = db.media
        .filter((m) => m.format_id === f.id)
        .sort((a, b) => (b.is_cover - a.is_cover) || (a.id - b.id))[0];
      const variants = db.variants.filter((v) => v.format_id === f.id);
      return {
        ...f,
        variant_count: variants.length,
        variant_names: variants.map((v) => v.name).join(' '),
        cover: cover ? cover.filename : null,
        cover_url: cover ? mediaUrl(cover) : null,
        cover_kind: cover ? cover.kind : null,
      };
    })
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)));
}

function getFormat(id) {
  return read((db) => {
    const f = db.formats.find((x) => x.id === id);
    if (!f) return null;
    const media = db.media
      .filter((m) => m.format_id === id)
      .sort((a, b) => (b.is_cover - a.is_cover) || (a.id - b.id))
      .map(withUrl);
    const variants = db.variants
      .filter((v) => v.format_id === id)
      .sort((a, b) => a.id - b.id)
      .map((v) => ({ ...v, media: media.filter((m) => m.variant_id === v.id) }));
    return { ...f, variants, media: media.filter((m) => m.variant_id == null) };
  });
}

function createFormat(b) {
  return write((db) => {
    const f = {
      id: ++db.seq,
      name: b.name.trim(),
      product: PRODUCTS.includes(b.product) ? b.product : PRODUCTS[0],
      category: CATEGORIES.includes(b.category) ? b.category : 'Other',
      description: b.description || '',
      platforms: b.platforms || '',
      status: STATUSES.includes(b.status) ? b.status : STATUSES[0],
      owner_team: b.owner_team || '',
      created_by: b.created_by || '',
      created_at: now(),
      updated_at: now(),
    };
    db.formats.push(f);
    return f;
  });
}

function updateFormat(id, b) {
  return write((db) => {
    const f = db.formats.find((x) => x.id === id);
    if (!f) return null;
    if (b.name != null && b.name.trim()) f.name = b.name.trim();
    if (PRODUCTS.includes(b.product)) f.product = b.product;
    if (CATEGORIES.includes(b.category)) f.category = b.category;
    if (b.description != null) f.description = b.description;
    if (b.platforms != null) f.platforms = b.platforms;
    if (STATUSES.includes(b.status)) f.status = b.status;
    if (b.owner_team != null) f.owner_team = b.owner_team;
    f.updated_at = now();
    return f;
  });
}

function deleteFormat(id) {
  return write((db) => {
    const idx = db.formats.findIndex((x) => x.id === id);
    if (idx === -1) return null;
    const removedMedia = db.media.filter((m) => m.format_id === id).map(withUrl);
    db.formats.splice(idx, 1);
    db.variants = db.variants.filter((v) => v.format_id !== id);
    db.media = db.media.filter((m) => m.format_id !== id);
    return removedMedia;
  });
}

/* ---------- variants ---------- */
function addVariant(formatId, b) {
  return write((db) => {
    const f = db.formats.find((x) => x.id === formatId);
    if (!f) return null;
    const v = { id: ++db.seq, format_id: formatId };
    VARIANT_FIELDS.forEach((k) => (v[k] = b[k] || ''));
    if (!STATUSES.includes(v.status)) v.status = STATUSES[0];
    v.created_at = now();
    v.updated_at = now();
    db.variants.push(v);
    touchFormat(db, formatId);
    return v;
  });
}

function updateVariant(id, b) {
  return write((db) => {
    const v = db.variants.find((x) => x.id === id);
    if (!v) return null;
    VARIANT_FIELDS.forEach((k) => { if (b[k] != null) v[k] = b[k]; });
    if (!STATUSES.includes(v.status)) v.status = STATUSES[0];
    v.updated_at = now();
    touchFormat(db, v.format_id);
    return v;
  });
}

function deleteVariant(id) {
  return write((db) => {
    const v = db.variants.find((x) => x.id === id);
    if (!v) return null;
    const removedMedia = db.media.filter((m) => m.variant_id === id).map(withUrl);
    db.variants = db.variants.filter((x) => x.id !== id);
    db.media = db.media.filter((m) => m.variant_id !== id);
    touchFormat(db, v.format_id);
    return removedMedia;
  });
}

/* ---------- media ---------- */
function addMedia(formatId, variantId, items) {
  return write((db) => {
    const f = db.formats.find((x) => x.id === formatId);
    if (!f) return null;
    const hasCover = db.media.some((m) => m.format_id === formatId && m.is_cover);
    const created = [];
    items.forEach((it, i) => {
      const isCover = !hasCover && i === 0 && it.kind === 'image' && variantId == null ? 1 : 0;
      const m = {
        id: ++db.seq,
        format_id: formatId,
        variant_id: variantId || null,
        kind: it.kind,
        url: it.url || null,
        filename: it.filename || null,
        original_name: it.original_name || '',
        caption: it.caption || '',
        is_cover: isCover,
        created_at: now(),
      };
      db.media.push(m);
      created.push(withUrl(m));
    });
    touchFormat(db, formatId);
    return created;
  });
}

function setCover(mediaId) {
  return write((db) => {
    const m = db.media.find((x) => x.id === mediaId);
    if (!m) return null;
    db.media.forEach((x) => { if (x.format_id === m.format_id) x.is_cover = 0; });
    m.is_cover = 1;
    touchFormat(db, m.format_id);
    return m;
  });
}

function deleteMedia(mediaId) {
  return write((db) => {
    const m = db.media.find((x) => x.id === mediaId);
    if (!m) return null;
    db.media = db.media.filter((x) => x.id !== mediaId);
    touchFormat(db, m.format_id);
    return withUrl(m);
  });
}

/* ---------- inspirations ---------- */
function listInspirations() {
  return read((db) => db.inspirations.slice().sort((a, b) => b.id - a.id).map(withUrl));
}
// meta: { app, position, type, tags } — app/position/type are validated against db.inspVocab
function addInspirations(items, meta = {}) {
  return write((db) => {
    const V = db.inspVocab;
    const created = [];
    items.forEach((it) => {
      const ins = {
        id: ++db.seq, kind: it.kind, url: it.url || null, filename: it.filename || null, original_name: it.original_name || '',
        app: pickIn(meta.app, V.apps), position: pickIn(meta.position, V.positions), type: pickIn(meta.type, V.types),
        tags: meta.tags || '', created_at: now(),
      };
      db.inspirations.push(ins);
      created.push(withUrl(ins));
    });
    return created;
  });
}
function updateInspiration(id, b) {
  return write((db) => {
    const ins = db.inspirations.find((x) => x.id === id);
    if (!ins) return null;
    const V = db.inspVocab;
    if (b.app != null) ins.app = pickIn(b.app, V.apps);
    if (b.position != null) ins.position = pickIn(b.position, V.positions);
    if (b.type != null) ins.type = pickIn(b.type, V.types);
    if (b.tags != null) ins.tags = String(b.tags).trim();
    // video timestamp markers: [{ t (seconds), title, notes }], kept sorted by time
    if (Array.isArray(b.timestamps)) {
      ins.timestamps = b.timestamps
        .map((m) => ({ t: Number(m.t), title: String(m.title || '').trim(), notes: String(m.notes || '').trim() }))
        .filter((m) => Number.isFinite(m.t) && m.t >= 0)
        .sort((a, c) => a.t - c.t);
    }
    return withUrl(ins);
  });
}

/* ---------- inspiration vocabularies ---------- */
function getInspVocab() {
  return read((db) => Object.fromEntries(INSP_DIMS.map((d) => [d, db.inspVocab[d].slice()])));
}
// add an option to one dimension ('apps' | 'positions' | 'types'); returns the full updated vocab
function addInspOption(dim, name) {
  if (!INSP_DIMS.includes(dim)) return null;
  name = (name || '').trim();
  if (!name) return null;
  return write((db) => {
    if (!db.inspVocab[dim].includes(name)) db.inspVocab[dim].push(name);
    return Object.fromEntries(INSP_DIMS.map((d) => [d, db.inspVocab[d].slice()]));
  });
}
function deleteInspiration(id) {
  return write((db) => {
    const ins = db.inspirations.find((x) => x.id === id);
    if (!ins) return null;
    db.inspirations = db.inspirations.filter((x) => x.id !== id);
    return withUrl(ins);
  });
}

/* ---------- tag vocabulary ---------- */
function listTags() { return read((db) => db.tags.slice()); }
function addTag(name) {
  return write((db) => {
    name = (name || '').trim();
    if (!name) return null;
    if (!db.tags.includes(name)) db.tags.push(name);
    return name;
  });
}
function deleteTag(name) {
  return write((db) => {
    const i = db.tags.indexOf(name);
    if (i === -1) return null;
    db.tags.splice(i, 1);
    return name;
  });
}

/* ---------- helpers ---------- */
// resolve a servable url for a media/inspiration record (Blob url, or local /uploads path)
function mediaUrl(m) { return m.url || (m.filename ? '/uploads/' + m.filename : null); }
function withUrl(m) { return { ...m, url: mediaUrl(m) }; }

/* ---------- seeding / migration helpers ---------- */
async function isEmpty() { return read((db) => db.formats.length === 0 && db.inspirations.length === 0); }
// Replace the entire document (used by migrate.js to push local data to the cloud).
async function replaceAll(db) { await storage.saveDb(normalize(db)); }

module.exports = {
  PRODUCTS, CATEGORIES, STATUSES, INSP_DIMS,
  listFormats, getFormat, createFormat, updateFormat, deleteFormat,
  addVariant, updateVariant, deleteVariant,
  addMedia, setCover, deleteMedia,
  listInspirations, addInspirations, updateInspiration, deleteInspiration, getInspVocab, addInspOption,
  listTags, addTag, deleteTag,
  isEmpty, replaceAll,
};
