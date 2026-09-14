'use strict';

/* ============ tiny helpers ============ */
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) n.setAttribute(k, v);
  }
  kids.flat().forEach((c) => c != null && n.append(c.nodeType ? c : document.createTextNode(c)));
  return n;
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = (s) => { if (!s) return ''; const d = new Date(s.replace(' ', 'T') + 'Z'); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };

async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    // session missing/expired → back to the login page
    if (res.status === 401 && location.pathname !== '/login.html') { location.href = '/login.html'; throw new Error('Login required'); }
    let msg = 'Request failed';
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isError ? ' error' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 2600);
}

const PLATFORMS = ['iOS', 'Android', 'Web'];
const ICONS = {
  image: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
  back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>',
  chevron: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>',
  search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M20.5 20.5l-4.6-4.6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M5 12h14"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>',
  enter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>',
  caret: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  grip: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
};

let SECTIONS = ['NewsBreak', 'Inspirations', 'Tools']; // narrowed to ['Inspirations'] in standalone mode (see init)
// inspFilters: one selected value per dimension; 'All' = no constraint
const state = { meta: { products: [], categories: [], statuses: [] }, formats: [], inspirations: [], inspFilters: { app: 'All', position: 'All', type: 'All', media: 'All' }, tagVocab: [], section: 'NewsBreak', query: '' };

/* ============ data ============ */
async function loadMeta() { state.meta = await api('/api/meta'); }
async function loadFormats() { state.formats = await api('/api/formats'); }
async function loadTags() { state.tagVocab = await api('/api/tags'); }

/* ============ gallery ============ */
function cardHead(f) {
  const menu = el('div', { class: 'fcard-menu hidden' },
    el('button', { class: 'fd-menu-item', onclick: (e) => { e.stopPropagation(); closeMenu(); openFormatModal(f); } }, 'Edit'),
    el('button', { class: 'fd-menu-item', onclick: async (e) => {
      e.stopPropagation(); closeMenu();
      if (!confirm(`Delete "${f.name}" and all its variants? This cannot be undone.`)) return;
      try { await api('/api/formats/' + f.id, { method: 'DELETE' }); toast('Format deleted'); await loadFormats(); renderGallery(); }
      catch (err) { toast(err.message, true); }
    } }, 'Delete'),
  );
  const dots = el('button', { class: 'fcard-dots', 'aria-label': 'More', html: ICONS.dots });
  let open = false;
  const onDoc = (e) => { if (!menu.contains(e.target) && !dots.contains(e.target)) closeMenu(); };
  function closeMenu() { menu.classList.add('hidden'); open = false; document.removeEventListener('click', onDoc); }
  function openMenu() { menu.classList.remove('hidden'); open = true; setTimeout(() => document.addEventListener('click', onDoc), 0); }
  dots.addEventListener('click', (e) => { e.stopPropagation(); open ? closeMenu() : openMenu(); });

  return el('div', { class: 'fcard-head' },
    el('div', { class: 'fcard-meta' },
      el('div', { class: 'fcard-name' }, f.name),
      el('div', { class: 'fcard-prod' }, f.product || 'NewsBreak'),
    ),
    el('div', { class: 'fcard-dots-wrap', onclick: (e) => e.stopPropagation() }, dots, menu),
  );
}

function cardBody(f) {
  const body = el('div', { class: 'fcard-body' });
  if (f.cover && f.cover_kind === 'image') {
    body.append(el('img', { class: 'fcard-shot', src: '/uploads/' + f.cover, alt: f.name, loading: 'lazy' }));
  } else if (f.cover && f.cover_kind === 'video') {
    const v = el('video', { class: 'fcard-shot', src: '/uploads/' + f.cover, muted: 'muted', playsinline: 'true', loop: 'loop', autoplay: 'autoplay' });
    v.muted = true;
    body.append(v);
  } else {
    body.append(el('span', { class: 'fcard-noprev' }, 'No Variants for Preview Yet'));
  }
  return body;
}

/* shared top nav: section tabs + Upload button (search removed for now). */
function buildTopNav(activeSection) {
  const tabs = el('div', { class: 'tab-group' });
  SECTIONS.forEach((s) => tabs.append(el('button', {
    class: 'tab' + (activeSection === s ? ' active' : ''),
    onclick: () => { state.section = s; if (location.hash) navTo(null); else renderGallery(); },
  }, s)));
  // standalone mode: the other sections show as disabled "Coming Soon" tabs (per Figma)
  (state.comingSoon || []).forEach((name) => tabs.append(el('div', { class: 'tab tab-soon' }, name, el('span', { class: 'soon-badge' }, 'Coming Soon'))));

  const onInsp = activeSection === 'Inspirations';
  const standalone = state.meta.mode === 'inspirations';
  const actions = el('div', { class: 'tab-group' },
    el('button', { class: 'btn-upload', onclick: () => onInsp ? openInspirationModal(() => renderGallery()) : openFormatModal() },
      onInsp ? (standalone ? 'Upload Format' : 'Upload') : 'Add Format'),
  );

  return el('div', { class: 'tabbar' }, tabs, actions);
}

function renderGallery() {
  const view = $('#view');
  view.innerHTML = '';
  if (!SECTIONS.includes(state.section)) state.section = SECTIONS[0];

  const listHost = el('div');
  view.append(buildTopNav(state.section));
  view.append(listHost);

  function renderBody() {
    listHost.innerHTML = '';

    if (state.section === 'Inspirations') { renderInspirations(listHost); return; }
    if (state.section === 'Tools') { listHost.append(el('div', { class: 'empty', html: '<h3>Tools</h3><p>Coming soon.</p>' })); return; }

    const list = state.formats;
    if (!list.length) {
      listHost.append(el('div', { class: 'empty', html: '<h3>No formats yet</h3><p>Upload a format to start the library.</p>' }));
      return;
    }

    const grid = el('div', { class: 'fgrid' });
    list.forEach((f) => {
      grid.append(el('div', { class: 'fcard', onclick: () => navTo(f.id) }, cardHead(f), cardBody(f)));
    });
    listHost.append(grid);
    sizeCardRadii();
  }
  renderBody();
}

/* ============ inspirations ============ */
const inspTags = (i) => (i.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
// servable src for a media/inspiration record (Blob url in prod, /uploads path locally)
const mediaSrc = (m) => m.url || ('/uploads/' + m.filename);
// the four filter dimensions; App/Position/Type vocab comes from /api/meta, Media derives from file kind
const INSP_DIMS = [
  { key: 'app',      label: 'App',      opts: () => (state.meta.inspirations || {}).apps || [] },
  { key: 'position', label: 'Position', opts: () => (state.meta.inspirations || {}).positions || [] },
  { key: 'type',     label: 'Type',     opts: () => (state.meta.inspirations || {}).types || [] },
  { key: 'media',    label: 'Media',    opts: () => ['Image', 'Video'] },
];
const inspDimValue = (i, key) => (key === 'media' ? (i.kind === 'video' ? 'Video' : 'Image') : (i[key] || ''));

function renderInspirations(host) {
  host.innerHTML = '<div class="loading">Loading…</div>';
  api('/api/inspirations')
    .then((list) => { state.inspirations = list; drawInspirations(host); })
    .catch((e) => { host.innerHTML = ''; host.append(el('div', { class: 'empty', html: `<h3>Couldn't load inspirations</h3><p>${esc(e.message)}</p>` })); });
}

function drawInspirations(host) {
  host.innerHTML = '';
  const all = state.inspirations;
  const f = state.inspFilters;

  // filter row: four dropdown pills (App / Position / Type / Media), one open at a time
  const row = el('div', { class: 'insp-filters' });
  let openKey = null;
  const onDoc = (e) => { if (!row.contains(e.target)) closeAll(); };
  function closeAll() {
    openKey = null;
    row.querySelectorAll('.insp-filter').forEach((p) => p.classList.remove('open'));
    row.querySelectorAll('.insp-dd').forEach((d) => d.classList.add('hidden'));
    document.removeEventListener('click', onDoc);
  }
  INSP_DIMS.forEach((dim) => {
    const cur = f[dim.key] || 'All';
    const dd = el('div', { class: 'insp-dd hidden' });
    ['All', ...dim.opts()].forEach((o) => dd.append(el('button', {
      class: 'insp-dd-item' + (o === cur ? ' selected' : ''),
      onclick: (e) => { e.stopPropagation(); f[dim.key] = o; closeAll(); drawInspirations(host); },
    }, el('span', {}, o), o === cur ? el('span', { class: 'insp-dd-check', html: ICONS.check }) : null)));
    const pill = el('button', { class: 'insp-filter' + (cur !== 'All' ? ' set' : ''), onclick: (e) => {
      e.stopPropagation();
      const wasOpen = openKey === dim.key;
      closeAll();
      if (!wasOpen) { openKey = dim.key; pill.classList.add('open'); dd.classList.remove('hidden'); setTimeout(() => document.addEventListener('click', onDoc), 0); }
    } },
      el('span', { class: 'insp-filter-label' }, dim.label + ':'),
      el('span', { class: 'insp-filter-val' }, cur),
      el('span', { class: 'insp-filter-caret', html: ICONS.caret }),
    );
    row.append(el('div', { class: 'insp-filter-wrap' }, pill, dd));
  });
  host.append(row);

  // AND across dimensions; 'All' imposes no constraint
  const list = all.filter((i) => INSP_DIMS.every((dim) => { const v = f[dim.key] || 'All'; return v === 'All' || inspDimValue(i, dim.key) === v; }));
  const active = INSP_DIMS.filter((d) => (f[d.key] || 'All') !== 'All');
  if (!list.length) {
    host.append(el('div', { class: 'empty', html: active.length
      ? `<h3>No inspirations match ${active.map((d) => `${d.label}: ${esc(f[d.key])}`).join(' · ')}</h3>`
      : `<h3>No inspirations yet</h3><p>Upload screenshots of great ad examples to build your moodboard.</p>` }));
    return;
  }

  const grid = el('div', { class: 'insp-grid' });
  list.forEach((i) => {
    const shot = i.kind === 'video'
      ? el('video', { class: 'insp-shot', src: mediaSrc(i), muted: 'muted', playsinline: 'true', loop: 'loop', autoplay: 'autoplay' })
      : el('img', { class: 'insp-shot', src: mediaSrc(i), alt: '', loading: 'lazy' });
    if (i.kind === 'video') shot.muted = true;

    // hover dots → dropdown (Edit / Delete)
    const menu = el('div', { class: 'insp-menu hidden' },
      el('button', { class: 'fd-menu-item', onclick: (e) => { e.stopPropagation(); closeMenu(); openInspirationEditModal(i, () => renderGallery()); } }, 'Edit'),
      el('button', { class: 'fd-menu-item', onclick: async (e) => {
        e.stopPropagation(); closeMenu();
        if (!confirm('Delete this inspiration?')) return;
        try { await api('/api/inspirations/' + i.id, { method: 'DELETE' }); state.inspirations = state.inspirations.filter((x) => x.id !== i.id); toast('Deleted'); drawInspirations(host); }
        catch (err) { toast(err.message, true); }
      } }, 'Delete'),
    );
    const dots = el('button', { class: 'insp-dots', 'aria-label': 'More', html: ICONS.dots });
    let open = false;
    const onDoc = (e) => { if (!menu.contains(e.target) && !dots.contains(e.target)) closeMenu(); };
    function closeMenu() { menu.classList.add('hidden'); open = false; document.removeEventListener('click', onDoc); }
    function openMenu() { menu.classList.remove('hidden'); open = true; setTimeout(() => document.addEventListener('click', onDoc), 0); }
    dots.addEventListener('click', (e) => { e.stopPropagation(); open ? closeMenu() : openMenu(); });

    grid.append(el('div', { class: 'insp-cell', onclick: () => openInspirationDisplay(list, list.indexOf(i)) }, shot,
      el('div', { class: 'insp-dots-wrap', onclick: (e) => e.stopPropagation() }, dots, menu)));
  });
  host.append(grid);
}

// Fullscreen "Display" modal — large media + timeline (video) + tags, with prev/next nav.
// MM:SS:CS clock (with centiseconds), used for video timestamps
const fmtClock = (s) => {
  s = Math.max(0, s || 0);
  const p = (n) => String(n).padStart(2, '0');
  return p(Math.floor(s / 60)) + ':' + p(Math.floor(s) % 60) + ':' + p(Math.floor((s * 100) % 100));
};

// Fullscreen "Display" modal — large media + chips, prev/next nav. Videos also get a speed control,
// timestamp markers on the scrubber, and a side panel to add / jump to / delete timestamps.
function openInspirationDisplay(list, startIdx) {
  if (!list.length) return;
  let idx = Math.max(0, Math.min(startIdx, list.length - 1));
  let rate = 1;                       // playback speed, kept while stepping prev/next
  const SPEEDS = [0.25, 0.5, 1, 2];

  const stage = el('div', { class: 'idisp-body' });
  const side = el('div', { class: 'idisp-side' });
  const cols = el('div', { class: 'idisp-cols' }, stage, side);
  const escBtn = el('button', { class: 'modal-close', onclick: () => close() }, 'Esc');
  const prev = el('button', { class: 'idisp-nav', 'aria-label': 'Previous', html: ICONS.back });
  const next = el('button', { class: 'idisp-nav', 'aria-label': 'Next', html: ICONS.chevron });
  const modal = el('div', { class: 'idisp' },
    el('div', { class: 'modal-head' }, el('h3', {}, 'Display'), escBtn),
    cols,
    el('div', { class: 'idisp-foot' }, prev, next),
  );
  const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) close(); } }, modal);

  function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
  function go(d) { const n = idx + d; if (n >= 0 && n < list.length) { idx = n; renderStage(); } }
  const onKey = (e) => {
    if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return; // don't hijack typing in the timestamp form
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
  };

  // persist timestamps for the current item; keep list + state in sync so prev/next shows fresh data
  const ts = () => list[idx].timestamps || [];
  async function saveTimestamps(timestamps) {
    const updated = await api('/api/inspirations/' + list[idx].id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timestamps }) });
    list[idx] = updated;
    state.inspirations = state.inspirations.map((x) => (x.id === updated.id ? updated : x));
  }

  function renderStage() {
    stage.innerHTML = '';
    side.innerHTML = '';
    const i = list[idx];
    const isVideo = i.kind === 'video';
    modal.classList.toggle('idisp--video', isVideo);

    let video = null;
    if (isVideo) {
      // speed control: X0.25 / X0.5 / X1 / X2
      const speed = el('div', { class: 'idisp-speed' }, el('span', { class: 'idisp-speed-label' }, 'Speed'));
      const speedBtns = SPEEDS.map((r) => el('button', { class: 'idisp-speed-opt' + (r === rate ? ' active' : ''), onclick: () => {
        rate = r; if (video) video.playbackRate = r;
        speedBtns.forEach((b, k) => b.classList.toggle('active', SPEEDS[k] === r));
      } }, 'X' + r));
      speed.append(...speedBtns);
      stage.append(speed);
    }

    const mediaWrap = el('div', { class: 'idisp-media' });
    if (isVideo) {
      video = el('video', { class: 'idisp-shot', src: mediaSrc(i), muted: 'muted', playsinline: 'true', loop: 'loop', autoplay: 'autoplay' });
      video.muted = true;
      video.playbackRate = rate;
      // same play/pause overlay as the format detail preview (round button, hover-revealed)
      const frame = el('div', { class: 'fd-prev-frame' });
      const mask = el('div', { class: 'fd-prev-mask' });
      const playBtn = el('button', { class: 'fd-prev-playbtn', 'aria-label': 'Play/Pause', html: ICONS.pause });
      const toggle = () => { if (video.paused) video.play(); else video.pause(); };
      frame.addEventListener('click', toggle);
      playBtn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
      video.addEventListener('play', () => { playBtn.innerHTML = ICONS.pause; });
      video.addEventListener('pause', () => { playBtn.innerHTML = ICONS.play; });
      frame.append(video, mask, playBtn);
      mediaWrap.append(frame);
    } else {
      mediaWrap.append(el('img', { class: 'idisp-shot', src: mediaSrc(i), alt: '' }));
    }
    stage.append(mediaWrap);

    if (video) {
      const tl = buildTimeline(video, { alwaysCs: true });
      const track = tl.querySelector('.fd-tl-track');
      stage.append(el('div', { class: 'idisp-tl' }, tl));

      // timestamp markers on the scrubber (positions need the duration, so redraw on loadedmetadata)
      const drawMarkers = () => {
        track.querySelectorAll('.fd-tl-marker').forEach((m) => m.remove());
        const d = video.duration;
        if (!d) return;
        ts().forEach((m) => track.append(el('div', { class: 'fd-tl-marker', style: `left:${((m.t / d) * 100).toFixed(3)}%` })));
      };
      video.addEventListener('loadedmetadata', drawMarkers);
      drawMarkers();

      // side panel: "+ Add timestamps" + a card per timestamp. Cards open a ⋯ menu (Edit / Delete);
      // create and edit share one inline form card styled like the timestamp cards (per Figma).
      const tsForm = (t, initial, onSave, onCancel) => {
        const title = el('input', { class: 'idisp-ts-in-title', type: 'text', placeholder: 'Title', autocomplete: 'off', value: initial.title || '' });
        const notes = el('textarea', { class: 'idisp-ts-in-notes', placeholder: 'Write your notes here', rows: '2' }, initial.notes || '');
        const grow = () => { notes.style.height = 'auto'; notes.style.height = notes.scrollHeight + 'px'; };
        notes.addEventListener('input', grow);
        const cancelBtn = el('button', { class: 'idisp-ts-btn', onclick: onCancel }, 'Cancel');
        const saveBtn = el('button', { class: 'idisp-ts-btn primary' }, 'Save');
        saveBtn.addEventListener('click', async () => {
          if (!title.value.trim()) return toast('Title is required', true);
          saveBtn.disabled = true;
          try { await onSave({ t, title: title.value, notes: notes.value }); }
          catch (err) { toast(err.message, true); saveBtn.disabled = false; }
        });
        const form = el('div', { class: 'idisp-ts idisp-ts-form' },
          el('div', { class: 'idisp-ts-fields' }, el('div', { class: 'idisp-ts-time' }, fmtClock(t)), title, notes),
          el('div', { class: 'idisp-ts-form-row' }, cancelBtn, saveBtn),
        );
        setTimeout(() => { title.focus(); grow(); }, 0);
        return form;
      };

      const drawSide = () => {
        side.innerHTML = '';
        let creating = null;
        const addBtn = el('button', { class: 'idisp-addts' }, '+ Add timestamps');
        side.append(addBtn);
        addBtn.addEventListener('click', () => {
          if (creating) return; // one create form at a time
          video.pause();
          const t = video.currentTime || 0;
          creating = tsForm(t, {}, async (m) => {
            await saveTimestamps([...ts(), m]);
            toast('Timestamp added'); drawSide(); drawMarkers();
          }, () => { creating.remove(); creating = null; });
          addBtn.after(creating);
        });

        ts().forEach((m, k) => {
          // clicking a card jumps the video to that moment
          const card = el('div', { class: 'idisp-ts', onclick: () => { video.currentTime = m.t; video.pause(); } },
            el('div', { class: 'idisp-ts-time' }, fmtClock(m.t)),
            el('div', { class: 'idisp-ts-title' }, m.title),
            m.notes ? el('div', { class: 'idisp-ts-notes' }, m.notes) : null,
          );
          // ⋯ menu: Edit (inline form in place of the card) / Delete
          const menu = el('div', { class: 'idisp-ts-menu hidden' },
            el('button', { class: 'fd-menu-item', onclick: (e) => {
              e.stopPropagation(); closeMenu();
              video.pause();
              const form = tsForm(m.t, m, async (upd) => {
                await saveTimestamps(ts().map((x, j) => (j === k ? upd : x)));
                toast('Timestamp updated'); drawSide(); drawMarkers();
              }, () => form.replaceWith(card));
              card.replaceWith(form);
            } }, 'Edit'),
            el('button', { class: 'fd-menu-item', onclick: async (e) => {
              e.stopPropagation(); closeMenu();
              if (!confirm('Delete this timestamp?')) return;
              try { await saveTimestamps(ts().filter((_, j) => j !== k)); toast('Deleted'); drawSide(); drawMarkers(); }
              catch (err) { toast(err.message, true); }
            } }, 'Delete'),
          );
          const dots = el('button', { class: 'idisp-ts-dots', 'aria-label': 'More', html: ICONS.dots });
          let open = false;
          const onDoc = (e) => { if (!menu.contains(e.target) && !dots.contains(e.target)) closeMenu(); };
          function closeMenu() { menu.classList.add('hidden'); open = false; document.removeEventListener('click', onDoc); }
          function openMenu() { menu.classList.remove('hidden'); open = true; setTimeout(() => document.addEventListener('click', onDoc), 0); }
          dots.addEventListener('click', (e) => { e.stopPropagation(); open ? closeMenu() : openMenu(); });
          card.append(el('div', { class: 'idisp-ts-dots-wrap', onclick: (e) => e.stopPropagation() }, dots, menu));
          side.append(card);
        });
      };
      drawSide();
    }

    // chips: App / Position / Type values; legacy inspirations fall back to their free-form tags
    const fields = ['app', 'position', 'type'].map((k) => i[k]).filter(Boolean);
    const labels = fields.length ? fields : inspTags(i);
    if (labels.length) {
      const trow = el('div', { class: 'idisp-tags' });
      labels.forEach((t) => trow.append(el('div', { class: 'idisp-tag' }, t)));
      stage.append(trow);
    }
    prev.disabled = idx <= 0;
    next.disabled = idx >= list.length - 1;
  }

  prev.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  document.addEventListener('keydown', onKey);
  $('#modalRoot').append(overlay);
  renderStage();
}

// Reusable tag picker (chips + Edit/Cancel vocabulary management + inline Add Tag).
// Returns { node, getSelected }. `initial` pre-selects matching tags.
function tagPickerSection(initial) {
  const avail = state.tagVocab.slice();   // managed tag vocabulary
  let selected = (initial || []).filter((t) => avail.includes(t));
  let tagEdit = false, tagAdding = false;

  const tagHead = el('div', { class: 'um-taghead' });
  const tagRow = el('div', { class: 'um-tags' });
  const drawHead = () => {
    tagHead.innerHTML = '';
    tagHead.append(el('div', { class: 'um-label' }, 'Tag'));
    tagHead.append(el('button', { class: 'um-tagedit', onclick: () => { tagEdit = !tagEdit; tagAdding = false; drawHead(); drawTags(); } }, tagEdit ? 'Cancel' : 'Edit'));
  };
  const drawTags = () => {
    tagRow.innerHTML = '';
    avail.forEach((t) => {
      if (tagEdit) {
        tagRow.append(el('div', { class: 'insp-tag um-tag-edit' },
          el('span', {}, t),
          el('button', { class: 'um-tag-x', title: 'Delete tag', onclick: async () => {
            try { await api('/api/tags/' + encodeURIComponent(t), { method: 'DELETE' }); }
            catch (err) { return toast(err.message, true); }
            const i = avail.indexOf(t); if (i >= 0) avail.splice(i, 1);
            selected = selected.filter((x) => x !== t);
            state.tagVocab = avail.slice();
            drawTags();
          } }, '✕'),
        ));
      } else {
        tagRow.append(el('button', { class: 'insp-tag' + (selected.includes(t) ? ' active' : ''),
          onclick: () => { selected = selected.includes(t) ? selected.filter((x) => x !== t) : [...selected, t]; drawTags(); } }, t));
      }
    });
    if (tagEdit) return;
    if (tagAdding) {
      const input = el('input', { class: 'um-tag-input-field', type: 'text', placeholder: 'Tag Name', autocomplete: 'off' });
      const commit = async () => {
        const name = input.value.trim();
        if (!name) return; // empty not allowed
        if (!avail.includes(name)) {
          try { await api('/api/tags', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); }
          catch (err) { return toast(err.message, true); }
          avail.push(name); state.tagVocab = avail.slice();
        }
        if (!selected.includes(name)) selected.push(name);
        drawTags();
        setTimeout(() => tagRow.querySelector('.um-tag-input-field')?.focus(), 0);
      };
      const enterBtn = el('button', { class: 'um-tag-input-enter', title: 'Add tag (Enter)', html: ICONS.enter, onclick: commit });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { tagAdding = false; drawTags(); }
      });
      input.addEventListener('blur', () => { if (!input.value.trim()) { tagAdding = false; drawTags(); } });
      tagRow.append(el('div', { class: 'um-tag-input' }, input, enterBtn));
      setTimeout(() => input.focus(), 0);
    } else {
      tagRow.append(el('button', { class: 'um-addtag', onclick: () => { tagAdding = true; drawTags(); } }, el('span', { class: 'um-addtag-plus', html: ICONS.plus }), 'Add Tag'));
    }
  };
  drawHead();
  drawTags();

  return {
    node: el('div', { class: 'um-section' }, tagHead, tagRow),
    getSelected: () => selected.slice(),
  };
}

// Single-select chip picker for one dimension (App / Position / Type) with an inline "+ Add Tag"
// (Enter or the ↵ button commits; Escape / blank blur cancels; empty names are rejected).
// Edit mode (header Edit ⇄ Cancel): chips get a ⋮⋮ grip to drag-reorder and a ✕ to remove; Add Tag
// is hidden. Every change is persisted to the vocab and immediately visible in the filter row.
function dimPicker(label, dim, initial) {
  const vocab = () => (state.meta.inspirations || {})[dim] || [];
  let selected = vocab().includes(initial) ? initial : '';
  let adding = false, editing = false, dragFrom = -1;
  const head = el('div', { class: 'um-taghead' });
  const row = el('div', { class: 'um-tags' });
  const putOptions = async (options) => {
    state.meta.inspirations = await api('/api/inspirations/vocab/' + dim, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ options }) });
  };
  const drawHead = () => {
    head.innerHTML = '';
    head.append(el('div', { class: 'um-label' }, label));
    head.append(el('button', { class: 'um-tagedit', onclick: () => { editing = !editing; adding = false; drawHead(); draw(); } }, editing ? 'Cancel' : 'Edit'));
  };
  const draw = () => {
    row.innerHTML = '';
    const opts = vocab();
    if (editing) {
      opts.forEach((o, idx) => {
        const chip = el('div', { class: 'um-tag-edit', draggable: 'true' },
          el('span', { class: 'um-tag-grip', html: ICONS.grip }),
          el('span', {}, o),
          el('button', { class: 'um-tag-x', title: 'Remove', html: ICONS.x, onclick: async () => {
            try { await putOptions(opts.filter((x) => x !== o)); } catch (err) { return toast(err.message, true); }
            if (selected === o) selected = '';
            draw();
          } }),
        );
        chip.addEventListener('dragstart', (e) => { dragFrom = idx; chip.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
        chip.addEventListener('dragend', () => { chip.classList.remove('dragging'); row.querySelectorAll('.drag-over').forEach((c) => c.classList.remove('drag-over')); });
        chip.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; chip.classList.add('drag-over'); });
        chip.addEventListener('dragleave', () => chip.classList.remove('drag-over'));
        chip.addEventListener('drop', async (e) => {
          e.preventDefault();
          const from = dragFrom; dragFrom = -1;
          if (from < 0 || from === idx) return;
          const next = opts.slice(); const [moved] = next.splice(from, 1); next.splice(idx, 0, moved);
          try { await putOptions(next); } catch (err) { return toast(err.message, true); }
          draw();
        });
        row.append(chip);
      });
      return;
    }
    opts.forEach((o) => row.append(el('button', {
      class: 'um-chip' + (o === selected ? ' active' : ''),
      onclick: () => { selected = selected === o ? '' : o; draw(); },
    }, o)));
    if (adding) {
      const input = el('input', { class: 'um-tag-input-field', type: 'text', placeholder: 'Tag Name', autocomplete: 'off' });
      const commit = async () => {
        const name = input.value.trim();
        if (!name) return; // empty not allowed
        try {
          state.meta.inspirations = await api('/api/inspirations/vocab/' + dim, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
        } catch (err) { return toast(err.message, true); }
        selected = name; adding = false; draw();
      };
      const enterBtn = el('button', { class: 'um-tag-input-enter', title: 'Add tag (Enter)', html: ICONS.enter, onclick: commit });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { adding = false; draw(); }
      });
      input.addEventListener('blur', () => { if (!input.value.trim()) { adding = false; draw(); } });
      row.append(el('div', { class: 'um-tag-input' }, input, enterBtn));
      setTimeout(() => input.focus(), 0);
    } else {
      row.append(el('button', { class: 'um-addtag', onclick: () => { adding = true; draw(); } }, el('span', { class: 'um-addtag-plus', html: ICONS.plus }), 'Add Tag'));
    }
  };
  drawHead();
  draw();
  return { node: el('div', { class: 'um-section' }, head, row), get: () => selected };
}
// App / Position / Type pickers stacked as modal sections
function inspFieldSet(vals = {}) {
  const app = dimPicker('App', 'apps', vals.app || '');
  const position = dimPicker('Position', 'positions', vals.position || '');
  const type = dimPicker('Type', 'types', vals.type || '');
  return {
    node: el('div', {}, app.node, position.node, type.node),
    get: () => ({ app: app.get(), position: position.get(), type: type.get() }),
  };
}

function openInspirationModal(onDone) {
  let file = null;
  const fields = inspFieldSet();

  const fileInput = el('input', { type: 'file', accept: 'image/*,video/*', style: 'display:none' });
  const dropTitle = el('div', { class: 'um-drop-title' }, 'Select a Video/Image');
  const dropSub = el('div', { class: 'um-drop-sub' }, 'MP4, JPG, PNG Recommended');
  const dropzone = el('div', { class: 'um-dropzone' }, el('div', { class: 'um-drop-text' }, dropTitle, dropSub));
  const save = el('button', { class: 'btn-submit' }, 'Submit');

  const setFile = (f) => {
    file = f || null;
    if (file) { dropTitle.textContent = (/^video/.test(file.type) ? '🎬 ' : '🖼️ ') + file.name; dropSub.textContent = 'Click or paste ⌘V to replace'; }
    else { dropTitle.textContent = 'Select a Video/Image'; dropSub.textContent = 'MP4, JPG, PNG Recommended'; }
    save.disabled = !file;
  };
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { setFile(fileInput.files[0]); fileInput.value = ''; });
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
  dropzone.addEventListener('drop', (e) => { e.preventDefault(); dropzone.classList.remove('drag'); setFile(e.dataTransfer.files[0]); });

  // paste a single image straight from the clipboard (⌘V) while the modal is open
  const onPaste = (e) => {
    if (!dropzone.isConnected) { document.removeEventListener('paste', onPaste); return; }
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.kind === 'file' && /^image\//.test(it.type)) {
        const f = it.getAsFile();
        if (!f) continue;
        const ext = (it.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
        e.preventDefault();
        setFile(f.name && /\.\w+$/.test(f.name) ? f : new File([f], `pasted-${Date.now()}.${ext}`, { type: it.type }));
        toast('Pasted image');
        return;
      }
    }
  };
  document.addEventListener('paste', onPaste);

  // per Figma: dropzone first, then App / Position / Type, then Submit
  const body = el('div', { class: 'um' },
    el('div', { class: 'um-drop' }, fileInput, dropzone),
    fields.node,
    el('div', { class: 'um-foot' }, save),
  );
  save.disabled = true;

  save.addEventListener('click', async () => {
    if (!file) return toast('Select a file', true);
    save.disabled = true;
    try {
      const v = fields.get();
      if (state.meta.blob) {
        // prod: browser → Blob directly (bypasses the 4.5MB function body limit), then record the url.
        // The client SDK is loaded from a CDN as an ES module since this app has no bundler.
        const { upload } = await import('https://esm.sh/@vercel/blob@2.8.0/client');
        const blob = await upload(file.name, file, { access: 'public', handleUploadUrl: '/api/blob/upload' });
        await api('/api/inspirations', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: blob.url, mimetype: file.type, original_name: file.name, app: v.app, position: v.position, type: v.type }) });
      } else {
        // dev: multipart to the server, which writes to uploads/
        const fd = new FormData();
        fd.append('files', file);
        fd.append('app', v.app); fd.append('position', v.position); fd.append('type', v.type);
        await api('/api/inspirations', { method: 'POST', body: fd });
      }
      document.removeEventListener('paste', onPaste);
      toast('Inspiration added'); closeModal(); onDone && onDone();
    } catch (e) { toast(e.message, true); save.disabled = false; }
  });

  modalShell('Upload', body, null, { flush: true, narrow: true });
}

// Edit an existing inspiration's App / Position / Type (media stays unchanged).
function openInspirationEditModal(insp, onDone) {
  const fields = inspFieldSet(insp);
  const save = el('button', { class: 'btn-submit' }, 'Save');
  const body = el('div', { class: 'um' },
    fields.node,
    el('div', { class: 'um-foot' }, save),
  );
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      await api('/api/inspirations/' + insp.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields.get()) });
      toast('Inspiration updated'); closeModal(); onDone && onDone();
    } catch (e) { toast(e.message, true); save.disabled = false; }
  });
  modalShell('Edit Inspiration', body, null, { flush: true, narrow: true });
}

/* ============ detail ============ */
function previewMedia(node, m) {
  node.innerHTML = '';
  if (!m) {
    node.append(el('div', { class: 'fd-prev-empty' },
      el('div', { class: 'placeholder', html: ICONS.image + '<span>No preview yet</span>' }),
    ));
    return null;
  }
  const frame = el('div', { class: 'fd-prev-frame' });
  if (m.kind === 'video') {
    const video = el('video', { class: 'fd-prev-shot', src: '/uploads/' + m.filename, muted: 'muted', playsinline: 'true', loop: 'loop', autoplay: 'autoplay' });
    video.muted = true;
    const mask = el('div', { class: 'fd-prev-mask' });
    const btn = el('button', { class: 'fd-prev-playbtn', 'aria-label': 'Play/Pause', html: ICONS.pause });
    const toggle = () => { if (video.paused) video.play(); else video.pause(); };
    frame.addEventListener('click', toggle);
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    video.addEventListener('play', () => { btn.innerHTML = ICONS.pause; });
    video.addEventListener('pause', () => { btn.innerHTML = ICONS.play; });
    frame.append(video, mask, btn);
    node.append(frame);
    return video;
  }
  frame.addEventListener('click', () => openLightbox(m));
  frame.append(el('img', { class: 'fd-prev-shot', src: '/uploads/' + m.filename, alt: m.caption || '' }));
  node.append(frame);
  return null;
}

function buildTimeline(video, opts = {}) {
  const track = el('div', { class: 'fd-tl-track' });
  const handle = el('div', { class: 'fd-tl-handle' });
  const bar = el('div', { class: 'fd-tl-bar' }, track, handle);
  // current time is an input: click to type a time (MM:SS:CS), Enter / blur seeks there
  const cur = el('input', { class: 'fd-tl-cur', type: 'text', size: '8', autocomplete: 'off', spellcheck: 'false', title: 'Click to type a time (MM:SS:CS)', value: '00:00' });
  const dur = el('span', { class: 'fd-tl-dur' }, ' / 00:00');
  const wrap = el('div', { class: 'fd-timeline' }, bar, el('div', { class: 'fd-tl-time' }, cur, dur));

  // MM:SS while playing; MM:SS:CS (with centiseconds) when paused
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (s, withCs) => {
    s = Math.max(0, s || 0);
    const base = pad(Math.floor(s / 60)) + ':' + pad(Math.floor(s) % 60);
    return withCs ? base + ':' + pad(Math.floor((s * 100) % 100)) : base;
  };
  const update = () => {
    const d = video.duration || 0, t = video.currentTime || 0;
    const withCs = opts.alwaysCs || video.paused;
    handle.style.left = `calc(${(d ? (t / d) * 100 : 0).toFixed(3)}% - 4px)`;
    if (document.activeElement !== cur) cur.value = fmt(t, withCs); // don't clobber a time the user is typing
    dur.textContent = ' / ' + fmt(d, withCs);
  };

  // drive updates per animation frame so the handle + centiseconds move smoothly
  let raf = null;
  const tick = () => {
    if (!video.isConnected) { raf = null; return; } // self-stop when re-rendered out of the DOM
    update();
    raf = requestAnimationFrame(tick);
  };
  const start = () => { if (raf == null) raf = requestAnimationFrame(tick); };
  const stop = () => { if (raf != null) { cancelAnimationFrame(raf); raf = null; } };

  video.addEventListener('loadedmetadata', update);
  video.addEventListener('play', () => { start(); update(); });
  video.addEventListener('pause', () => { stop(); update(); });
  video.addEventListener('ended', () => { stop(); update(); });

  const seek = (x) => {
    const r = track.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (x - r.left) / r.width));
    if (video.duration) { video.currentTime = pct * video.duration; update(); }
  };
  bar.addEventListener('mousedown', (e) => {
    e.preventDefault(); seek(e.clientX);
    const move = (ev) => seek(ev.clientX);
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  });

  // manual time entry. Accepts MM:SS:CS, MM:SS, or SS (a "." also works as the CS separator).
  const parseClock = (s) => {
    const parts = String(s).trim().replace(/\./g, ':').split(':').map((p) => p.trim());
    if (!parts.length || parts.some((p) => !/^\d+$/.test(p))) return NaN;
    const n = parts.map(Number);
    if (n.length === 1) return n[0];
    if (n.length === 2) return n[0] * 60 + n[1];
    return n[0] * 60 + n[1] + n[2] / 100;
  };
  let wasPlaying = false, cancelled = false;
  cur.addEventListener('focus', () => { wasPlaying = !video.paused; cancelled = false; video.pause(); cur.select(); });
  cur.addEventListener('keydown', (e) => {
    e.stopPropagation(); // keep ←/→/Esc from driving the Display modal while typing
    if (e.key === 'Enter') { e.preventDefault(); cur.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelled = true; cur.blur(); }
  });
  cur.addEventListener('blur', () => {
    if (!cancelled) {
      const secs = parseClock(cur.value);
      if (Number.isFinite(secs)) { const d = video.duration || 0; video.currentTime = d ? Math.min(d, Math.max(0, secs)) : Math.max(0, secs); }
      else toast('Invalid time — use MM:SS:CS', true);
    }
    update();
    if (wasPlaying) video.play();
  });

  if (!video.paused) start();
  update();
  return wrap;
}

async function renderDetail(id) {
  const view = $('#view');
  view.innerHTML = '<div class="loading">Loading…</div>';
  let f;
  try { f = await api('/api/formats/' + id); }
  catch (e) {
    view.innerHTML = '';
    view.append(buildTopNav(state.section));
    view.append(el('div', { class: 'empty', html: '<h3>Format not found</h3>' }));
    return;
  }

  const reload = () => renderDetail(id);
  view.innerHTML = '';
  view.append(buildTopNav(state.section));

  const variants = f.variants || [];
  let selectedId = state._selVariant;
  if (!variants.some((v) => v.id === selectedId)) selectedId = variants[0] ? variants[0].id : null;
  state._selVariant = selectedId;

  /* ----- left column: format header + variant list ----- */
  const head = el('div', { class: 'fd-head' },
    el('div', { class: 'fd-head-info' },
      el('div', { class: 'fd-title' }, f.name),
      el('div', { class: 'fd-sub' }, `${variants.length} Variant${variants.length === 1 ? '' : 's'}`),
    ),
    el('div', { class: 'fd-head-actions' },
      el('button', { class: 'fd-addbtn', onclick: () => openVariantModal(f.id, null, reload) }, 'Add Variant'),
    ),
  );

  const vlist = el('div', { class: 'fd-vlist' });
  const right = el('div', { class: 'fd-right' });
  const meta = el('div', { class: 'fd-meta' });

  // Render the right preview for the currently-selected variant, in place.
  // Switching variants only rebuilds this panel (not the whole page → no flash),
  // and skips the rebuild entirely when the resolved media hasn't changed.
  let curMediaFile;
  function renderRight() {
    const selected = variants.find((v) => v.id === state._selVariant) || null;
    const media = (selected && selected.media && selected.media[0]) || (f.media && f.media[0]) || null;
    const file = media ? media.filename : null;
    if (right.firstChild && file === curMediaFile) return; // same media → keep the running player
    curMediaFile = file;
    right.innerHTML = '';
    const prevHost = el('div', { class: 'fd-prev-host' });
    const videoEl = previewMedia(prevHost, media);
    right.append(prevHost);
    if (videoEl) right.append(buildTimeline(videoEl));
    sizePreview();
  }

  // Right metadata panel for the selected variant (per Figma 225:1453).
  function renderMeta() {
    meta.innerHTML = '';
    const selected = variants.find((v) => v.id === state._selVariant) || null;
    if (!selected) return;
    const row = (label, valueNode) => el('div', { class: 'fd-meta-row' }, el('div', { class: 'fd-meta-label' }, label), valueNode);
    meta.append(row('Status', el('div', { class: 'fd-meta-val' + (selected.status ? '' : ' muted') }, selected.status || '-')));
    const fig = selected.figma_link;
    meta.append(row('Design File', fig
      ? el('a', { class: 'fd-meta-link', href: /^https?:\/\//i.test(fig) ? fig : 'https://' + fig, target: '_blank', rel: 'noopener noreferrer' }, 'Figma Link')
      : el('div', { class: 'fd-meta-val muted' }, '-')));
    const cHead = el('div', { class: 'fd-meta-chead' },
      el('div', { class: 'fd-meta-label' }, 'Comments'),
      el('button', { class: 'fd-meta-addcomment', onclick: (e) => { e.stopPropagation(); openCommentModal(selected, renderMeta); } },
        el('span', { class: 'fd-meta-plus', html: ICONS.plus }), 'Add Comment'),
    );
    meta.append(el('div', { class: 'fd-meta-row' }, cHead,
      el('div', { class: 'fd-meta-val fd-meta-comment' + (selected.notes ? '' : ' muted') }, selected.notes || '-')));

    // "..." menu → Edit / Delete the selected variant (per Figma 230:1749)
    const menu = el('div', { class: 'fd-menu hidden' },
      el('button', { class: 'fd-menu-item', onclick: () => { closeMenu(); openVariantModal(f.id, selected, reload); } }, 'Edit Variants'),
      el('button', { class: 'fd-menu-item', onclick: async () => {
        closeMenu();
        const m = selected.media && selected.media[0];
        if (!m) return toast('This variant has no media to use as cover', true);
        try { await api(`/api/media/${m.id}/cover`, { method: 'PUT' }); toast('Set as home cover'); await loadFormats(); }
        catch (e) { toast(e.message, true); }
      } }, 'Set as Cover'),
      el('button', { class: 'fd-menu-item', onclick: async () => {
        closeMenu();
        if (!confirm(`Delete variant "${selected.name}"?`)) return;
        try { await api('/api/variants/' + selected.id, { method: 'DELETE' }); toast('Variant deleted'); reload(); }
        catch (e) { toast(e.message, true); }
      } }, 'Delete Variants'),
    );
    const dotsBtn = el('button', { class: 'fd-meta-dots', 'aria-label': 'More', html: ICONS.dots });
    let menuOpen = false;
    const onDocClick = (e) => { if (!menu.contains(e.target) && !dotsBtn.contains(e.target)) closeMenu(); };
    function closeMenu() { menu.classList.add('hidden'); menuOpen = false; document.removeEventListener('click', onDocClick); }
    function openMenu() { menu.classList.remove('hidden'); menuOpen = true; setTimeout(() => document.addEventListener('click', onDocClick), 0); }
    dotsBtn.addEventListener('click', (e) => { e.stopPropagation(); menuOpen ? closeMenu() : openMenu(); });
    meta.append(dotsBtn, menu);
  }

  if (!variants.length) {
    vlist.append(el('div', { class: 'fd-vempty' }, 'No variants yet. Add one to start this folder.'));
  } else {
    const rows = [];
    const makeRow = (v) => {
      const dot = el('span', { class: 'fd-vdot' });
      const row = el('div', { class: 'fd-vrow' + (v.id === selectedId ? ' active' : '') },
        el('span', { class: 'fd-vname' }, v.name),
        v.id === selectedId ? dot : null,
      );
      row._vid = v.id; row._dot = dot;
      row.addEventListener('click', () => {
        if (state._selVariant === v.id) return;
        state._selVariant = v.id;
        rows.forEach((r) => {
          const isActive = r._vid === v.id;
          r.classList.toggle('active', isActive);
          r._dot.remove();
          if (isActive) r.append(r._dot);
        });
        renderRight();
        renderMeta();
      });
      rows.push(row);
      return row;
    };

    // group variants by status (per Figma): Shipped / In Design / Rejected / Testing
    const statuses = state.meta.statuses && state.meta.statuses.length ? state.meta.statuses : ['Shipped', 'In Design', 'Rejected', 'Testing'];
    statuses.forEach((status) => {
      const group = el('div', { class: 'fd-vgroup' }, el('div', { class: 'fd-vgroup-label' }, status));
      const inGroup = variants.filter((v) => (v.status || statuses[0]) === status);
      if (!inGroup.length) group.append(el('div', { class: 'fd-vgroup-empty' }, '-'));
      else inGroup.forEach((v) => group.append(makeRow(v)));
      vlist.append(group);
    });
  }

  const left = el('div', { class: 'fd-left' }, head, vlist);
  view.append(el('div', { class: 'fd-wrap' }, el('div', { class: 'fd' }, left, right, meta)));
  renderRight();
  renderMeta();
}

// Phone screen is 32px radius at a native 402×874 screen; the preview is rendered
// at whatever height the webview allows, so scale radius / timeline width to the rendered height.
const PREVIEW_NATIVE_H = 874;
const PREVIEW_NATIVE_RADIUS = 32;
function sizePreview() {
  const shot = document.querySelector('.fd-prev-shot');
  if (!shot) return;
  const h = shot.clientHeight;
  if (!h) return;
  const r = (h * PREVIEW_NATIVE_RADIUS / PREVIEW_NATIVE_H).toFixed(2) + 'px';
  shot.style.borderRadius = r;
  const mask = document.querySelector('.fd-prev-mask');
  if (mask) mask.style.borderRadius = r;
  // design: 360px-wide timeline at a 600px-tall media → scale with rendered height
  const tl = document.querySelector('.fd-timeline');
  if (tl) tl.style.width = (h * 360 / 600).toFixed(1) + 'px';
}

// home-page card previews: same proportional radius, applied to each card's media
function sizeCardRadii() {
  document.querySelectorAll('.fcard-shot').forEach((shot) => {
    const h = shot.clientHeight;
    if (h) shot.style.borderRadius = (h * PREVIEW_NATIVE_RADIUS / PREVIEW_NATIVE_H).toFixed(2) + 'px';
  });
}

/* ============ modals ============ */
function closeModal() { $('#modalRoot').innerHTML = ''; }
function modalShell(title, bodyNode, footNode, opts = {}) {
  const overlay = el('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) closeModal(); } },
    el('div', { class: 'modal' + (opts.narrow ? ' narrow' : '') },
      el('div', { class: 'modal-head' }, el('h3', {}, title), el('button', { class: 'modal-close', onclick: closeModal }, 'Esc')),
      el('div', { class: 'modal-body' + (opts.flush ? ' flush' : '') }, bodyNode),
      footNode,
    ),
  );
  $('#modalRoot').innerHTML = '';
  $('#modalRoot').append(overlay);
  const first = overlay.querySelector('input, textarea, select');
  if (first) setTimeout(() => first.focus(), 40);
}

function fieldText(label, name, value = '', hint = '', placeholder = '') {
  return el('div', { class: 'field' },
    el('label', {}, label, hint ? el('span', { class: 'hint' }, '  ' + hint) : null),
    el('input', { type: 'text', name, value: value || '', placeholder }),
  );
}
function fieldArea(label, name, value = '', placeholder = '') {
  return el('div', { class: 'field' },
    el('label', {}, label),
    el('textarea', { name, placeholder }, value || ''),
  );
}
function fieldSelect(label, name, options, value) {
  const sel = el('select', { name });
  options.forEach((o) => sel.append(el('option', { value: o, ...(o === value ? { selected: 'selected' } : {}) }, o)));
  return el('div', { class: 'field' }, el('label', {}, label), sel);
}
function fieldPlatforms(selected = '') {
  const set = new Set(selected.split(',').map((s) => s.trim()).filter(Boolean));
  const wrap = el('div', { class: 'checks' });
  PLATFORMS.forEach((p) => {
    const cb = el('input', { type: 'checkbox', value: p, ...(set.has(p) ? { checked: 'checked' } : {}) });
    const label = el('label', { class: 'check' + (set.has(p) ? ' checked' : '') }, cb, p);
    cb.addEventListener('change', () => label.classList.toggle('checked', cb.checked));
    wrap.append(label);
  });
  return el('div', { class: 'field' }, el('label', {}, 'Platforms'), wrap);
}
function readPlatforms(root) {
  return [...root.querySelectorAll('.checks input:checked')].map((c) => c.value).join(', ');
}

// Shared "Select a Video/Image" dropzone for the format / variant modals.
function makeDropzone() {
  let file = null;
  const fileInput = el('input', { type: 'file', accept: 'image/*,video/*', style: 'display:none' });
  const dropTitle = el('div', { class: 'um-drop-title' }, 'Select a Video/Image');
  const dropSub = el('div', { class: 'um-drop-sub' }, 'MP4, JPG, PNG Recommended');
  const dropzone = el('div', { class: 'um-dropzone' }, el('div', { class: 'um-drop-text' }, dropTitle, dropSub));
  const setFile = (fl) => {
    file = fl && fl[0] ? fl[0] : null;
    if (file) { dropTitle.textContent = (/^video/.test(file.type) ? '🎬 ' : '🖼️ ') + file.name; dropSub.textContent = 'Click to replace'; }
    else { dropTitle.textContent = 'Select a Video/Image'; dropSub.textContent = 'MP4, JPG, PNG Recommended'; }
  };
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => setFile(fileInput.files));
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
  dropzone.addEventListener('drop', (e) => { e.preventDefault(); dropzone.classList.remove('drag'); setFile(e.dataTransfer.files); });
  return { section: el('div', { class: 'um-drop' }, fileInput, dropzone), getFile: () => file };
}

function openFormatModal(format = null) {
  const editing = !!format;
  const products = state.meta.products && state.meta.products.length ? state.meta.products : ['NewsBreak', 'Ad Network'];
  let product = editing ? format.product : products[0];

  // Name section
  const nameInput = el('input', { class: 'um-input', type: 'text', value: editing ? format.name : '', placeholder: 'Name the Format', autocomplete: 'off' });
  const body = el('div', { class: 'um' },
    el('div', { class: 'um-section' }, el('div', { class: 'um-label' }, 'Name'), nameInput),
  );

  // Product section (create & edit)
  const prodGroup = el('div', { class: 'tab-group' });
  products.forEach((p) => prodGroup.append(el('button', {
    class: 'tab' + (p === product ? ' active' : ''),
    onclick: () => { product = p; [...prodGroup.children].forEach((c) => c.classList.toggle('active', c.textContent === p)); },
  }, p)));
  body.append(el('div', { class: 'um-section' }, el('div', { class: 'um-label' }, 'Product'), prodGroup));

  // create-only: first variant (name + status + figma link + media)
  let variantInput = null, dz = null, variantStatus = null, figmaInput = null;
  if (!editing) {
    variantInput = el('input', { class: 'um-input', type: 'text', placeholder: 'Name the Variant', autocomplete: 'off' });
    body.append(el('div', { class: 'um-section' },
      el('div', { class: 'um-label' }, 'Variant Name'),
      variantInput,
      el('div', { class: 'um-help' }, 'You must have at least one Variant to create a format'),
    ));

    const statuses = ['In Design', 'Testing', 'Rejected', 'Shipped'].filter((s) => !state.meta.statuses || state.meta.statuses.includes(s));
    variantStatus = statuses[0];
    const statusGroup = el('div', { class: 'tab-group' });
    statuses.forEach((s) => statusGroup.append(el('button', {
      class: 'tab' + (s === variantStatus ? ' active' : ''),
      onclick: () => { variantStatus = s; [...statusGroup.children].forEach((c) => c.classList.toggle('active', c.textContent === s)); },
    }, s)));
    body.append(el('div', { class: 'um-section' }, el('div', { class: 'um-label' }, 'Variant Status'), statusGroup));

    figmaInput = el('input', { class: 'um-input', type: 'text', placeholder: 'Design File Link', autocomplete: 'off' });
    body.append(el('div', { class: 'um-section' }, el('div', { class: 'um-label' }, 'Figma Link'), figmaInput));

    dz = makeDropzone();
    body.append(dz.section);
  }

  // submit row
  const save = el('button', { class: 'btn-submit' }, 'Submit');
  body.append(el('div', { class: 'um-foot' }, save));

  const syncSave = () => { save.disabled = !nameInput.value.trim() || (!editing && !variantInput.value.trim()); };
  nameInput.addEventListener('input', syncSave);
  if (variantInput) variantInput.addEventListener('input', syncSave);
  syncSave();

  save.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) return toast('Name is required', true);
    if (!editing && !variantInput.value.trim()) return toast('Variant name is required', true);
    save.disabled = true;
    try {
      if (editing) {
        await api('/api/formats/' + format.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, product }) });
        toast('Saved'); closeModal(); await loadFormats();
        if (location.hash) renderDetail(format.id); else renderGallery();
        return;
      }
      const created = await api('/api/formats', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, product }) });
      const variant = await api(`/api/formats/${created.id}/variants`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: variantInput.value.trim(), status: variantStatus, figma_link: figmaInput.value.trim() }) });
      const file = dz && dz.getFile();
      if (file && variant) {
        const fd = new FormData(); fd.append('files', file); fd.append('variant_id', variant.id);
        await api(`/api/formats/${created.id}/media`, { method: 'POST', body: fd });
      }
      toast('Format created'); closeModal(); await loadFormats(); navTo(created.id);
    } catch (e) { toast(e.message, true); save.disabled = false; }
  });

  modalShell(editing ? 'Edit Format' : 'Add Format', body, null, { flush: true, narrow: true });
  setTimeout(() => nameInput.focus(), 40);
}

function openVariantModal(formatId, variant, onDone) {
  const editing = !!variant;
  // status options in the design's order (In Design / Testing / Rejected / Shipped)
  const statuses = ['In Design', 'Testing', 'Rejected', 'Shipped'].filter((s) => !state.meta.statuses || state.meta.statuses.includes(s));
  let status = editing && statuses.includes(variant.status) ? variant.status : statuses[0];

  const nameInput = el('input', { class: 'um-input', type: 'text', value: editing ? variant.name : '', placeholder: 'Name the Variant', autocomplete: 'off' });

  const statusGroup = el('div', { class: 'tab-group' });
  statuses.forEach((s) => statusGroup.append(el('button', {
    class: 'tab' + (s === status ? ' active' : ''),
    onclick: () => { status = s; [...statusGroup.children].forEach((c) => c.classList.toggle('active', c.textContent === s)); },
  }, s)));

  const figmaInput = el('input', { class: 'um-input', type: 'text', value: editing ? (variant.figma_link || '') : '', placeholder: 'Design File Link', autocomplete: 'off' });

  const dz = makeDropzone();
  const body = el('div', { class: 'um' },
    el('div', { class: 'um-section' }, el('div', { class: 'um-label' }, 'Variant Name'), nameInput),
    el('div', { class: 'um-section' }, el('div', { class: 'um-label' }, 'Variant Status'), statusGroup),
    el('div', { class: 'um-section' }, el('div', { class: 'um-label' }, 'Figma Link'), figmaInput),
    dz.section,
  );

  const save = el('button', { class: 'btn-submit' }, 'Submit');
  body.append(el('div', { class: 'um-foot' }, save));

  const syncSave = () => { save.disabled = !nameInput.value.trim(); };
  nameInput.addEventListener('input', syncSave);
  syncSave();

  save.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) return toast('Variant name is required', true);
    save.disabled = true;
    const payload = { name, status, figma_link: figmaInput.value.trim() };
    try {
      let variantId;
      if (editing) {
        await api('/api/variants/' + variant.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        variantId = variant.id;
      } else {
        const created = await api(`/api/formats/${formatId}/variants`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        variantId = created.id;
        state._selVariant = created.id;
      }
      const file = dz.getFile();
      if (file && variantId) {
        // a new file replaces the variant's existing media (rather than piling up)
        if (editing && variant.media) {
          for (const m of variant.media) await api('/api/media/' + m.id, { method: 'DELETE' });
        }
        const fd = new FormData(); fd.append('files', file); fd.append('variant_id', variantId);
        await api(`/api/formats/${formatId}/media`, { method: 'POST', body: fd });
      }
      toast(editing ? 'Variant saved' : 'Variant added'); closeModal(); onDone && onDone();
    } catch (e) { toast(e.message, true); save.disabled = false; }
  });

  modalShell(editing ? 'Edit Variant' : 'Add Variant', body, null, { flush: true, narrow: true });
  setTimeout(() => nameInput.focus(), 40);
}

function openCommentModal(variant, onDone) {
  const ta = el('textarea', { class: 'um-textarea', placeholder: 'Commenting...' }, variant.notes || '');
  const body = el('div', { class: 'um' }, el('div', { class: 'um-section' }, ta));

  const save = el('button', { class: 'btn-submit' }, 'Submit');
  body.append(el('div', { class: 'um-foot' }, save));

  save.addEventListener('click', async () => {
    const notes = ta.value.trim();
    save.disabled = true;
    try {
      await api('/api/variants/' + variant.id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes }) });
      variant.notes = notes; // keep local copy in sync so the panel re-renders correctly
      toast('Comment saved'); closeModal(); onDone && onDone();
    } catch (e) { toast(e.message, true); save.disabled = false; }
  });

  modalShell('Add Comment', body, null, { flush: true, narrow: true });
  setTimeout(() => ta.focus(), 40);
}

function openUploadModal(formatId, variantId, onDone) {
  const files = [];
  const listNode = el('div', { class: 'upload-list' });
  const input = el('input', { type: 'file', accept: 'image/*,video/*', multiple: 'multiple', style: 'display:none' });
  const dz = el('div', { class: 'dropzone', html: '<strong>Click to choose</strong> or drag screenshots / videos here<br><span style="font-size:12px">PNG, JPG, GIF, MP4 · up to 200MB each</span>' });

  function refresh() {
    listNode.innerHTML = '';
    files.forEach((file, i) => {
      listNode.append(el('div', { class: 'upload-item' },
        el('span', {}, (/^video/.test(file.type) ? '🎬 ' : '🖼️ ') + file.name),
        el('span', { style: 'color:var(--text-3);font-size:12px' }, (file.size / 1024 / 1024).toFixed(1) + ' MB'),
        el('button', { class: 'x', onclick: () => { files.splice(i, 1); refresh(); } }, '×'),
      ));
    });
  }
  const addFiles = (fl) => { [...fl].forEach((f) => files.push(f)); refresh(); };
  dz.addEventListener('click', () => input.click());
  input.addEventListener('change', () => addFiles(input.files));
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('drag'); addFiles(e.dataTransfer.files); });

  const body = el('div', {}, dz, input, listNode);
  const save = el('button', { class: 'btn btn-primary' }, 'Upload');
  save.addEventListener('click', async () => {
    if (!files.length) return toast('Choose at least one file', true);
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    if (variantId) fd.append('variant_id', variantId);
    save.disabled = true; save.textContent = 'Uploading…';
    try { await api(`/api/formats/${formatId}/media`, { method: 'POST', body: fd }); toast('Uploaded'); closeModal(); onDone && onDone(); }
    catch (e) { toast(e.message, true); save.disabled = false; save.textContent = 'Upload'; }
  });
  modalShell(variantId ? 'Add variant media' : 'Add previews', body,
    el('div', { class: 'modal-foot' }, el('button', { class: 'btn', onclick: closeModal }, 'Cancel'), save));
}

/* ============ lightbox ============ */
function openLightbox(m) {
  const c = $('#lightboxContent');
  c.innerHTML = '';
  if (m.kind === 'video') { const v = el('video', { src: '/uploads/' + m.filename, controls: 'controls', autoplay: 'autoplay', muted: 'muted' }); v.muted = true; c.append(v); }
  else c.append(el('img', { src: '/uploads/' + m.filename, alt: m.caption || '' }));
  $('#lightbox').classList.remove('hidden');
}
function closeLightbox() { $('#lightbox').classList.add('hidden'); $('#lightboxContent').innerHTML = ''; }

/* ============ routing ============ */
function navTo(id) { location.hash = id ? '/format/' + id : ''; }
function route() {
  const m = location.hash.match(/format\/(\d+)/);
  if (m) renderDetail(Number(m[1]));
  else renderGallery();
}

/* ============ init ============ */
async function init() {
  $('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') closeLightbox(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeLightbox(); closeModal(); } });
  window.addEventListener('hashchange', route);
  window.addEventListener('resize', () => { sizePreview(); sizeCardRadii(); });

  try {
    await Promise.all([loadMeta(), loadFormats(), loadTags()]);
    // standalone Inspirations tool (APP_MODE=inspirations): only that section exists
    if (state.meta.mode === 'inspirations') { SECTIONS = ['Inspirations']; state.section = 'Inspirations'; state.comingSoon = ['Formats', 'Tools']; document.title = 'Inspirations'; }
    route();
  } catch (e) {
    $('#view').innerHTML = `<div class="empty"><h3>Couldn't reach the server</h3><p>${esc(e.message)}</p></div>`;
  }
}
init();
