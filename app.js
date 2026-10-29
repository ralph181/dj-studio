'use strict';
(() => {
  /* ================================================================ helpers */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const fmtTime = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const fmtLong = (s) => { const m = Math.round((s || 0) / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
  const fmtBpm = (b) => (b ? b.toFixed(1).replace(/\.0$/, '') : '—');
  const signed = (v, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`;
  const emit = (n, d) => window.dispatchEvent(new CustomEvent('djs:' + n, { detail: d }));
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  };

  const ICONS = {
    upload: '<path d="M12 16V4m0 0L7 9m5-5 5 5M5 20h14"/>',
    play: '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" stroke="none"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>',
    list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
    wave: '<path d="M3 12h2M7 7v10M11 4v16M15 8v8M19 10v4M22 12h-.01"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    download: '<path d="M12 4v12m0 0 5-5m-5 5-5-5M5 20h14"/>',
    install: '<path d="M12 3v11m0 0 4-4m-4 4-4-4M5 17v3h14v-3"/>',
    sync: '<path d="M4 12a8 8 0 0 1 13.5-5.8L20 9M20 4v5h-5M20 12a8 8 0 0 1-13.5 5.8L4 15M4 20v-5h5"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    up: '<path d="M12 19V5m0 0-6 6m6-6 6 6"/>',
    down: '<path d="M12 5v14m0 0 6-6m-6 6-6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    file: '<path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7L20 8M20 3v5h-5"/>',
  };
  const icon = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;
  const paintIcons = (root = document) => $$('i[data-icon]', root).forEach((el) => { el.innerHTML = icon(el.dataset.icon); });

  let toastTimer;
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3800);
  }

  /* ================================================================ storage (IndexedDB) */
  const DB = {
    _db: null,
    open() {
      if (this._db) return Promise.resolve(this._db);
      return new Promise((res, rej) => {
        const r = indexedDB.open('dj-intelligence-studio', 2);
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', { keyPath: 'id', autoIncrement: true });
          if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists', { keyPath: 'id', autoIncrement: true });
        };
        r.onsuccess = () => { this._db = r.result; res(r.result); };
        r.onerror = () => rej(r.error);
      });
    },
    async tx(store, mode, fn) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const t = db.transaction(store, mode); const s = t.objectStore(store);
        const req = fn(s);
        t.oncomplete = () => res(req && req.result);
        t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
      });
    },
    all(s) { return this.tx(s, 'readonly', (o) => o.getAll()); },
    get(s, k) { return this.tx(s, 'readonly', (o) => o.get(k)); },
    put(s, v) { return this.tx(s, 'readwrite', (o) => o.put(v)); },
    del(s, k) { return this.tx(s, 'readwrite', (o) => o.delete(k)); },
    clear(s) { return this.tx(s, 'readwrite', (o) => o.clear()); },
  };
  const persistable = (t) => { const { pending, error, ...rest } = t; return rest; };
  const saveTrack = (t) => DB.put('tracks', persistable(t)).catch(() => {});
  const savePlaylist = (p) => DB.put('playlists', p).catch(() => {});

  /* ================================================================ state */
  const MODES = {
    warmup: { label: 'Warm-up', base: 4.5, delta: 0.4, curve: (p) => 3.5 + 2.5 * p, desc: 'Low to medium energy that rises gently. Keeps the floor open for what follows.' },
    build: { label: 'Build-up', base: 6.5, delta: 0.7, curve: (p) => 5 + 3 * p, desc: 'Steady climb in energy toward the peak.' },
    peak: { label: 'Peak-time', base: 8.5, delta: 0, curve: () => 8.5, desc: 'Holds high energy. Favors tight tempo and key matches.' },
    festival: { label: 'Festival', base: 9, delta: 0, curve: () => 9, desc: 'Maximum energy from start to finish.' },
    open: { label: 'Open format', base: null, delta: 0, curve: null, desc: 'No energy target. Picks the smoothest blend from each track to the next.' },
    chill: { label: 'After-hours', base: 3.5, delta: 0, curve: () => 3.5, desc: 'Low energy, relaxed tempos, long blends.' },
    closing: { label: 'Closing', base: 5, delta: -0.6, curve: (p) => 7 - 4 * p, desc: 'Starts strong and winds down to a calm last track.' },
  };
  const FILTERS = [
    ['all', 'All tracks', () => true],
    ['analyzed', 'Analyzed', (t) => t.analyzed],
    ['starred', 'Starred', (t) => t.star],
    ['high', 'High energy', (t) => t.analyzed && t.energy >= 7],
    ['pending', 'Not analyzed', (t) => !t.analyzed],
  ];

  const S = {
    tracks: [], byId: new Map(),
    selected: null, nextB: null,
    mode: store.get('djs-mode', 'open'),
    filter: 'all', keyFilter: '', query: '', matchOnly: false,
    sort: { by: store.get('djs-sort-by', 'added'), dir: store.get('djs-sort-dir', 'desc') },
    recs: [], match: new Map(),
    playlists: [], plId: null,
    playing: { a: false, b: false },
    queue: [], running: false, total: 0, done: 0, current: '',
    view: 'library',
  };
  if (!MODES[S.mode]) S.mode = 'open';


  /* ================================================================ genre model */
  const FAMILIES = [
    ['afrobeats', /afro ?beats?|afro ?swing|afro ?pop|naija|azonto|highlife|afro ?fusion|afro-?soul/],
    ['amapiano', /amapiano|gqom|kwaito|private school|south african/],
    ['afro house', /afro ?house|afro ?tech|tribal|afro ?deep|afro ?latin/],
    ['dancehall', /dancehall|reggae|ragga|soca|\bdub\b|ska/],
    ['latin', /reggaet|latin|salsa|bachata|cumbia|dembow|urbano|merengue|baile/],
    ['drum & bass', /drum ?(and|&|n|'n') ?bass|\bd ?& ?b\b|\bdnb\b|jungle|liquid/],
    ['bass', /dubstep|riddim|future bass|bass music|brostep|bass house|\bbass\b/],
    ['hip-hop', /hip.?hop|\brap\b|\btrap\b|drill|grime|boom bap/],
    ['r&b', /r ?& ?b|\brnb\b|soul|r and b|quiet storm/],
    ['techno', /techno|minimal|industrial|acid|hard ?style/],
    ['trance', /trance|psy/],
    ['house', /house|garage|2.?step|speed garage/],
    ['disco/funk', /disco|funk|boogie|nu.?disco/],
    ['pop', /\bpop\b|synth.?pop|k-?pop|j-?pop|\bdance\b|top 40/],
    ['rock', /rock|punk|metal|indie|alternative|grunge/],
    ['electronic', /electro|\bedm\b|electronic|synth|big room|breakbeat|breaks|\bidm\b/],
    ['ambient/chill', /ambient|chill|downtempo|lounge|lo-?fi|trip.?hop|new age/],
    ['jazz', /jazz|blues/],
    ['gospel', /gospel|worship|christian/],
    ['classical', /classical|orchestral|soundtrack|score/],
  ];
  const GREL = {};
  [['afrobeats', 'amapiano', 0.6], ['afrobeats', 'afro house', 0.6], ['amapiano', 'afro house', 0.65], ['afrobeats', 'dancehall', 0.55], ['afrobeats', 'r&b', 0.5], ['afrobeats', 'pop', 0.45],
    ['afrobeats', 'latin', 0.4], ['amapiano', 'house', 0.5], ['afro house', 'house', 0.65], ['house', 'techno', 0.5], ['house', 'disco/funk', 0.55], ['house', 'electronic', 0.55],
    ['house', 'pop', 0.4], ['techno', 'trance', 0.55], ['techno', 'electronic', 0.55], ['trance', 'electronic', 0.5], ['drum & bass', 'bass', 0.6], ['drum & bass', 'electronic', 0.45],
    ['bass', 'electronic', 0.5], ['hip-hop', 'r&b', 0.6], ['hip-hop', 'dancehall', 0.45], ['hip-hop', 'pop', 0.4], ['r&b', 'pop', 0.5], ['latin', 'dancehall', 0.55], ['latin', 'pop', 0.45],
    ['disco/funk', 'pop', 0.45], ['disco/funk', 'r&b', 0.45], ['ambient/chill', 'electronic', 0.4], ['ambient/chill', 'jazz', 0.4], ['jazz', 'r&b', 0.4], ['pop', 'electronic', 0.45], ['pop', 'rock', 0.35],
  ].forEach(([a, b, v]) => { GREL[a + '|' + b] = v; GREL[b + '|' + a] = v; });
  /* free text or tag list -> [{f: family, w: weight 0..1}] */
  function familiesOf(input) {
    const tags = Array.isArray(input) ? input : [{ name: String(input || ''), count: 1 }];
    const acc = new Map();
    for (const tg of tags) {
      const name = String(tg.name || tg).toLowerCase(); const w = Math.max(1, +tg.count || 1);
      for (const [f, re] of FAMILIES) if (re.test(name)) { acc.set(f, (acc.get(f) || 0) + w); break; }
    }
    const arr = [...acc].map(([f, w]) => ({ f, w })).sort((a, b) => b.w - a.w).slice(0, 3);
    const top = arr[0] ? arr[0].w : 1;
    return arr.map((x) => ({ f: x.f, w: Math.round(x.w / top * 100) / 100 }));
  }
  const famSim = (a, b) => (a === b ? 1 : (GREL[a + '|' + b] ?? 0.1));
  /* null when either track has no genre information */
  function genreSim(a, b) {
    const ga = a.genres, gb = b.genres;
    if (!ga || !ga.length || !gb || !gb.length) return null;
    let best = 0;
    for (const x of ga) for (const y of gb) best = Math.max(best, famSim(x.f, y.f) * (0.65 + 0.35 * Math.min(x.w, y.w)));
    return best;
  }
  const genreLabel = (t) => (t.genreText || (t.genres && t.genres[0] ? t.genres[0].f : '')) || '';
  function setGenres(t, fams, text, src) {
    t.genres = fams; t.genreText = text || (fams[0] ? fams[0].f : ''); t.genreSrc = src; saveTrack(t);
  }

  /* ================================================================ matchmaking engine */
  const camHue = (k) => (parseInt(k, 10) - 1) * 30;
  const kchipHTML = (k, cls = '') => k
    ? `<span class="kchip ${k.endsWith('A') ? 'kA' : ''} ${cls}" style="--h:${camHue(k)}">${esc(k)}</span>`
    : `<span class="kchip none ${cls}">—</span>`;

  /* Camelot relationships, including the "energy boost" (+2) and diagonal moves DJs actually use */
  function keyRel(a, b) {
    if (!a || !b) return { s: 0.5, rel: 'key unknown' };
    const na = parseInt(a, 10), nb = parseInt(b, 10), la = a.slice(-1), lb = b.slice(-1);
    const up = (nb - na + 12) % 12;
    if (la === lb) {
      if (up === 0) return { s: 1, rel: 'same key' };
      if (up === 1) return { s: 0.92, rel: `${a} → ${b} smooth lift` };
      if (up === 11) return { s: 0.92, rel: `${a} → ${b} smooth drop` };
      if (up === 2) return { s: 0.72, rel: `${a} → ${b} energy boost` };
      if (up === 10) return { s: 0.62, rel: `${a} → ${b} step down` };
      if (up === 7) return { s: 0.5, rel: `${a} → ${b} semitone lift` };
      const d = Math.min(up, 12 - up);
      return { s: Math.max(0.08, 0.38 - 0.06 * d), rel: `${a} → ${b} key clash` };
    }
    if (up === 0) return { s: 0.94, rel: `${a} → ${b} relative` };
    if (up === 1 || up === 11) return { s: 0.62, rel: `${a} → ${b} diagonal` };
    return { s: 0.15, rel: `${a} → ${b} key clash` };
  }
  function keyScore(a, b) {
    let r = keyRel(a.key, b.key);
    // when the key detector was unsure, also consider its runner-up
    const alts = [];
    if (a.keyAlt && (a.keyConfidence ?? 1) < 0.6) alts.push(keyRel(a.keyAlt, b.key));
    if (b.keyAlt && (b.keyConfidence ?? 1) < 0.6) alts.push(keyRel(a.key, b.keyAlt));
    for (const x of alts) if (x.s * 0.88 > r.s) r = { s: x.s * 0.88, rel: r.rel };
    const conf = Math.min(a.keyConfidence ?? 0.6, b.keyConfidence ?? 0.6);
    const f = clamp(0.4 + conf, 0.5, 1);
    return { s: r.s * f + 0.6 * (1 - f), raw: r.s, rel: r.rel };
  }
  function bpmScore(a, b, ca = 0.6, cb = 0.6) {
    if (!a || !b) return { s: 0.5, raw: 0.5, half: false };
    const pct = Math.abs(b - a) / a * 100;
    const ph = Math.min(Math.abs(b - 2 * a) / (2 * a), Math.abs(2 * b - a) / a) * 100;
    let s = 1 / (1 + Math.pow(pct / 5, 2)), half = false;
    const sh = 0.85 / (1 + Math.pow(ph / 5, 2));
    if (sh > s) { s = sh; half = true; }
    const f = clamp(0.5 + Math.min(ca, cb), 0.6, 1);
    return { s: s * f + 0.6 * (1 - f), raw: s, half };
  }
  function timbreSim(a, b) {
    if (!a || !b) return 0.6;
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
    return clamp((dot / (Math.sqrt(na * nb) + 1e-9) - 0.85) / 0.14, 0, 1);
  }
  /* target === undefined: use the mode's base energy; target === null: judge only the energy flow */
  function compat(a, b, modeKey, target) {
    const m = MODES[modeKey];
    const bp = bpmScore(a.bpm, b.bpm, a.bpmConfidence ?? 0.6, b.bpmConfidence ?? 0.6);
    const k = keyScore(a, b);
    const dE = b.energy - a.energy;
    const flow = 1 - Math.min(Math.abs(dE - m.delta) / 3.5, 1);
    const tgt = target === undefined ? m.base : target;
    const energy = tgt == null ? flow : 0.45 * flow + 0.55 * (1 - Math.min(Math.abs(b.energy - tgt) / 4, 1));
    const mixMin = Math.min(a.mixability, b.mixability) / 100;
    const tim = timbreSim(a.timbre, b.timbre);
    const room = (a.outro == null || b.intro == null) ? 0.5 : 0.5 * clamp(a.outro / 20, 0, 1) + 0.5 * clamp(b.intro / 12, 0, 1);
    let score = 100 * (0.28 * bp.s + 0.28 * k.s + 0.18 * energy + 0.08 * mixMin + 0.09 * tim + 0.09 * room);
    if (bp.raw < 0.3) score = Math.min(score, 58);
    if (k.raw < 0.3) score = Math.min(score, 64);
    const gs = genreSim(a, b);
    if (gs != null) { score += (gs - 0.5) * 12; if (gs <= 0.15) score = Math.min(score, 66); else if (gs < 0.45) score = Math.min(score, 78); score = clamp(score, 0, 100); }
    score = Math.round(score * 10) / 10;
    const dB = a.bpm && b.bpm ? b.bpm - a.bpm : 0;
    const why = `${signed(dB)} BPM${bp.half ? ' (half/double time)' : ''} · ${k.rel} · energy ${signed(dE)}${gs != null && gs < 0.45 ? ' · genre shift' : ''}`;
    return { score, why, rel: k.rel, dB, dE, half: bp.half, parts: { bpm: bp.s, key: k.s, energy, timbre: tim, room, genre: gs } };
  }
  /* Where to start the blend and how long it can run, from the outgoing track's outro */
  function mixTip(a, b) {
    if (!a || !b) return '';
    const bar = 240 / (a.bpm || 120), out = a.outro || 0;
    const bars = [32, 16, 8].find((n) => n * bar <= out + 2) || 8;
    const start = Math.max(0, (a.duration || 0) - Math.max(out, bars * bar));
    let tip = `Blend ${bars} bars from ${fmtTime(start)}`;
    if (a.bpm && b.bpm) { const p = (a.bpm / b.bpm - 1) * 100; const p2 = (a.bpm / (b.bpm * 2) - 1) * 100; const use = Math.abs(p2) < Math.abs(p) ? p2 : p; if (Math.abs(use) >= 0.3) tip += `, pitch next track ${signed(use)}%`; }
    return tip;
  }

  function refreshRecs() {
    S.match = new Map(); S.recs = [];
    const sel = S.selected;
    if (!sel || !sel.analyzed) return;
    const all = [];
    for (const t of S.tracks) if (t.analyzed && t.id !== sel.id) { const c = compat(sel, t, S.mode); S.match.set(t.id, c.score); all.push({ t, ...c }); }
    S.recs = all.sort((x, y) => y.score - x.score).slice(0, 12);
  }

  /* Beam search: keeps the 10 best partial playlists at every step, so each pick is judged by the whole chain, not just the next hop */
  function generatePlaylist(pool, n, modeKey, start, jitter) {
    const m = MODES[modeKey]; n = Math.min(n, pool.length);
    const target = (i) => (m.curve ? m.curve(n > 1 ? i / (n - 1) : 0) : null);
    const W = 10, K = 8, rnd = () => (jitter ? Math.random() * jitter : 0);
    let beams;
    if (start) beams = [{ path: [start], used: new Set([start.id]), total: 0 }];
    else {
      const t0 = target(0);
      const openers = [...pool].map((t) => ({ t, v: 0.6 * (t0 == null ? 0.5 : 1 - Math.min(Math.abs(t.energy - t0) / 4, 1)) + 0.4 * t.mixability / 100 + ((t.intro || 0) >= 8 ? 0.1 : 0) + rnd() / 40 })).sort((x, y) => y.v - x.v).slice(0, 6);
      beams = openers.map((o) => ({ path: [o.t], used: new Set([o.t.id]), total: 0 }));
    }
    for (let step = 1; step < n; step++) {
      const next = [], tg = target(step);
      for (const b of beams) {
        const prev = b.path[b.path.length - 1];
        const cands = pool.filter((t) => !b.used.has(t.id)).map((t) => ({ t, ...compat(prev, t, modeKey, tg) })).sort((x, y) => y.score - x.score).slice(0, K);
        for (const c of cands) {
          let pen = 0;
          const p2 = b.path[b.path.length - 2];
          if (p2 && c.t.key && c.t.key === prev.key && prev.key === p2.key) pen += 5;       // avoid camping in one key
          const drift = b.path[0].bpm && c.t.bpm ? Math.abs(c.t.bpm - b.path[0].bpm) / b.path[0].bpm * 100 : 0;
          if (drift > 12) pen += (drift - 12) * 0.6;                                       // keep tempo drift gradual
          next.push({ path: [...b.path, c.t], used: new Set([...b.used, c.t.id]), total: b.total + c.score - pen + rnd() });
        }
      }
      if (!next.length) break;
      next.sort((x, y) => y.total - x.total); beams = next.slice(0, W);
    }
    return beams[0].path;
  }

  /* ================================================================ decode + analysis (memory-safe) */
  const SR = 22050;
  const CHUNK_BYTES = 1.5 * 1048576;
  const MAX_FULL_DECODE_BYTES = 120 * 1048576;

  async function decodeMono(blob) {
    const ctx = new OfflineAudioContext(1, 1, SR);
    const ab = await ctx.decodeAudioData(await blob.arrayBuffer());
    const ch = ab.numberOfChannels, len = ab.length;
    const out = new Float32Array(len);
    for (let c = 0; c < ch; c++) { const d = ab.getChannelData(c); for (let i = 0; i < len; i++) out[i] += d[i] / ch; }
    return out;
  }
  function mediaDuration(blob) {
    return new Promise((res) => {
      const a = new Audio(); const url = URL.createObjectURL(blob); let done = false;
      const fin = (v) => { if (done) return; done = true; URL.revokeObjectURL(url); a.removeAttribute('src'); res(v); };
      a.preload = 'metadata'; a.onloadedmetadata = () => fin(isFinite(a.duration) && a.duration > 0 ? a.duration : 0);
      a.onerror = () => fin(0); setTimeout(() => fin(0), 6000); a.src = url;
    });
  }
  function wavLayout(head) {
    const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const tag = (o) => String.fromCharCode(head[o], head[o + 1], head[o + 2], head[o + 3]);
    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
    let o = 12, fmt = null;
    while (o + 8 <= head.length) {
      const id = tag(o), size = dv.getUint32(o + 4, true);
      if (id === 'fmt ') fmt = { bytes: head.slice(o + 8, o + 8 + size), rate: dv.getUint32(o + 12, true), align: dv.getUint16(o + 20, true) };
      if (id === 'data') return fmt && fmt.align ? { fmt, dataStart: o + 8, dataSize: size } : null;
      o += 8 + size + (size & 1);
    }
    return null;
  }
  function wavPiece(layout, pcm) {
    const f = layout.fmt.bytes, out = new DataView(new ArrayBuffer(28 + f.length + pcm.byteLength));
    const w = (o, t) => { for (let i = 0; i < t.length; i++) out.setUint8(o + i, t.charCodeAt(i)); };
    w(0, 'RIFF'); out.setUint32(4, 20 + f.length + pcm.byteLength, true); w(8, 'WAVEfmt '); out.setUint32(16, f.length, true);
    new Uint8Array(out.buffer).set(f, 20); w(20 + f.length, 'data'); out.setUint32(24 + f.length, pcm.byteLength, true);
    new Uint8Array(out.buffer).set(new Uint8Array(pcm), 28 + f.length);
    return new Blob([out]);
  }
  class Collector {
    constructor(duration) {
      this.total = Math.max(1, Math.round(duration * SR)); this.pos = 0;
      this.peaks = new Float32Array(1600);
      const secs = Math.ceil(duration) + 1; this.sq = new Float64Array(secs); this.n = new Float64Array(secs);
      this.segLen = Math.min(this.total, 180 * SR);
      this.segStart = duration > 210 ? Math.floor(Math.min(duration * 0.25, duration - 180) * SR) : 0;
      this.seg = new Float32Array(this.segLen);
    }
    add(m) {
      const { total, peaks, sq, n, segStart, segLen, seg } = this;
      for (let i = 0; i < m.length; i++) {
        const idx = this.pos + i, v = m[i], a = v < 0 ? -v : v;
        const bk = Math.min(1599, (idx / total * 1600) | 0); if (a > peaks[bk]) peaks[bk] = a;
        const sec = Math.min(sq.length - 1, (idx / SR) | 0); sq[sec] += v * v; n[sec]++;
        const si = idx - segStart; if (si >= 0 && si < segLen) seg[si] = v;
      }
      this.pos += m.length;
    }
    finish() {
      const wave = new Uint8Array(1600); let max = 1e-9;
      for (let i = 0; i < 1600; i++) { this.peaks[i] = Math.sqrt(this.peaks[i]); if (this.peaks[i] > max) max = this.peaks[i]; }
      for (let i = 0; i < 1600; i++) wave[i] = Math.round(255 * this.peaks[i] / max);
      const rms = []; for (let i = 0; i < this.sq.length; i++) if (this.n[i] > SR * 0.5) rms.push(Math.sqrt(this.sq[i] / this.n[i]));
      return { samples: this.seg, rms: Float32Array.from(rms.length ? rms : [0]), wave, duration: this.pos / SR };
    }
  }
  async function decodeForAnalysis(file) {
    const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
    const isMp3 = /\.mp3$/i.test(file.name) || file.type === 'audio/mpeg';
    const wav = /\.wav$/i.test(file.name) ? wavLayout(head) : null;
    if (wav && file.size > CHUNK_BYTES * 2) {
      const duration = wav.dataSize / (wav.fmt.rate * wav.fmt.align);
      const col = new Collector(duration), step = Math.floor(CHUNK_BYTES / wav.fmt.align) * wav.fmt.align;
      const end = Math.min(file.size, wav.dataStart + wav.dataSize);
      for (let o = wav.dataStart; o < end; o += step) {
        const pcm = await file.slice(o, Math.min(end, o + step)).arrayBuffer();
        col.add(await decodeMono(wavPiece(wav, pcm)));
      }
      return col.finish();
    }
    if (isMp3 && file.size > CHUNK_BYTES * 2) {
      const duration = await mediaDuration(file);
      if (duration > 0) {
        const col = new Collector(duration); let failed = 0, pieces = 0;
        for (let o = 0; o < file.size; o += CHUNK_BYTES) {
          pieces++;
          try { col.add(await decodeMono(file.slice(o, Math.min(file.size, o + CHUNK_BYTES)))); } catch { failed++; col.pos += Math.round(CHUNK_BYTES / file.size * col.total); }
        }
        if (failed > pieces * 0.3) throw new Error("Can't decode this file");
        return col.finish();
      }
    }
    if (file.size > MAX_FULL_DECODE_BYTES) throw new Error('File is too large to analyze on this device');
    const mono = await decodeMono(file);
    const col = new Collector(mono.length / SR); col.add(mono);
    return col.finish();
  }

  let worker, jobId = 0; const jobs = new Map();
  function getWorker() {
    if (worker) return worker;
    worker = new Worker('worker.js');
    worker.onmessage = (e) => {
      const j = jobs.get(e.data.id); if (!j) return; jobs.delete(e.data.id);
      e.data.error ? j.rej(new Error(e.data.error)) : j.res(e.data.result);
    };
    worker.onerror = (e) => { jobs.forEach((j) => j.rej(new Error(e.message || 'Analysis worker failed'))); jobs.clear(); worker = null; };
    return worker;
  }
  function runAnalysis(b) {
    return new Promise((res, rej) => {
      const id = ++jobId; jobs.set(id, { res, rej });
      getWorker().postMessage({ id, samples: b.samples, rms: b.rms, wave: b.wave }, [b.samples.buffer]);
    });
  }

  async function analyzeOne(id) {
    const t = S.byId.get(id); if (!t) return;
    S.current = t.title; t.pending = true; t.error = null; renderTable(); renderQueue();
    try {
      const rec = await DB.get('blobs', id);
      const bundle = await decodeForAnalysis(rec.blob);
      const res = await runAnalysis(bundle);
      const keep = {};
      if (t.fixedBpm) keep.bpm = t.bpm;
      if (t.fixedKey) { keep.key = t.key; keep.keyName = t.keyName; }
      Object.assign(t, res, { duration: bundle.duration, analyzed: true }, keep);
      if (!t.cues) t.cues = [null, null, null, null];
      await saveTrack(t);
    } catch (err) {
      const m = String((err && err.message) || err);
      t.error = /too large/i.test(m) ? 'Too large to analyze here' : /decode|EncodingError|unable|encoding/i.test(m) ? "Can't decode this file" : 'Analysis failed. Try a smaller file';
    }
    t.pending = false;
    if (S.selected === t && t.analyzed) select(t);
    else if (!S.selected && t.analyzed) select(t);
  }
  async function pump() {
    if (S.running) return; S.running = true;
    while (S.queue.length) {
      const id = S.queue.shift();
      await analyzeOne(id);
      S.done++; renderQueue(); renderAll(false);
    }
    S.running = false; S.total = 0; S.done = 0; renderQueue();
    if (S.selected && S.selected.analyzed) { refreshRecs(); if (!S.nextB && S.recs[0]) { S.nextB = S.recs[0].t; loadDeck('b', S.nextB); } }
    renderAll(true); renderRecs(); renderPlaylists();
  }
  function enqueue(ids) {
    for (const id of ids) if (!S.queue.includes(id)) { S.queue.push(id); S.total++; }
    renderQueue(); pump();
  }

  /* ================================================================ importing */
  const MEDIA_RE = /\.(mp3|wav|flac|m4a|aac|ogg|opus|aiff|aif|wma|mp4|mov|mkv|avi|webm|m4v)$/i;
  const VIDEO_RE = /\.(mp4|mov|mkv|avi|webm|m4v)$/i;

  async function readID3(file) {
    try {
      const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
      if (String.fromCharCode(head[0], head[1], head[2]) !== 'ID3') return {};
      const ver = head[3];
      const sync = (b, o) => ((b[o] & 127) << 21) | ((b[o + 1] & 127) << 14) | ((b[o + 2] & 127) << 7) | (b[o + 3] & 127);
      const size = sync(head, 6);
      const buf = new Uint8Array(await file.slice(10, 10 + Math.min(size, 1 << 20)).arrayBuffer());
      const dec = (b) => {
        const enc = b[0]; let d = b.subarray(1); let label = 'windows-1252';
        if (enc === 1) { if (d[0] === 0xff && d[1] === 0xfe) { label = 'utf-16le'; d = d.subarray(2); } else if (d[0] === 0xfe && d[1] === 0xff) { label = 'utf-16be'; d = d.subarray(2); } else label = 'utf-16le'; }
        else if (enc === 2) label = 'utf-16be'; else if (enc === 3) label = 'utf-8';
        return new TextDecoder(label).decode(d).replace(/\0+$/g, '').trim();
      };
      const out = {}; let p = 0;
      while (p + 10 <= buf.length) {
        const id = String.fromCharCode(buf[p], buf[p + 1], buf[p + 2], buf[p + 3]);
        if (!/^[A-Z0-9]{4}$/.test(id)) break;
        const fs = ver === 4 ? sync(buf, p + 4) : ((buf[p + 4] << 24) | (buf[p + 5] << 16) | (buf[p + 6] << 8) | buf[p + 7]) >>> 0;
        if (!fs || p + 10 + fs > buf.length) break;
        if (id === 'TIT2' || id === 'TPE1' || id === 'TCON') out[id] = dec(buf.subarray(p + 10, p + 10 + fs));
        p += 10 + fs;
      }
      return { title: out.TIT2, artist: out.TPE1, genre: (out.TCON || '').replace(/^\(\d+\)/, '').trim() };
    } catch { return {}; }
  }
  function namesFromFile(name) {
    const stem = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
    const m = stem.match(/^(.+?)\s+[-–]\s+(.+)$/);
    return m ? { artist: m[1].trim(), title: m[2].trim() } : { artist: '', title: stem };
  }
  async function importFiles(fileList) {
    const files = Array.from(fileList).filter((f) => MEDIA_RE.test(f.name) || /^(audio|video)\//.test(f.type));
    if (!files.length) { toast('No audio or video files found'); return []; }
    const ids = []; let failed = 0;
    for (const f of files) {
      if (S.tracks.some((t) => t.name === f.name && t.size === f.size)) continue;
      try {
        const tags = /\.mp3$/i.test(f.name) ? await readID3(f) : {};
        const fn = namesFromFile(f.name);
        const t = {
          name: f.name, size: f.size, video: VIDEO_RE.test(f.name), added: Date.now(), analyzed: false, star: false, cues: [null, null, null, null],
          title: tags.title || fn.title, artist: tags.artist || fn.artist,
          ...(tags.genre && familiesOf(tags.genre).length ? { genres: familiesOf(tags.genre), genreText: tags.genre, genreSrc: 'tags' } : {}),
          bpm: 0, key: '', energy: 0, danceability: 0, mixability: 0, duration: 0,
        };
        const id = await DB.put('tracks', t); t.id = id;
        await DB.put('tracks', t); await DB.put('blobs', { id, blob: f });
        S.tracks.push(t); S.byId.set(id, t); ids.push(id);
      } catch { failed++; }
    }
    if (failed) toast(`${failed} file${failed > 1 ? 's' : ''} could not be saved. Your device may be low on storage.`);
    renderAll(false);
    if (ids.length) { toast(`Imported ${ids.length} track${ids.length > 1 ? 's' : ''}`); enqueue(ids); emit('imported', ids); }
    else if (!failed) toast('Those tracks are already in your library');
    return ids;
  }

  /* ================================================================ playlists */
  const chainOf = (pl) => {
    const tracks = pl.trackIds.map((id) => S.byId.get(id)).filter(Boolean);
    return tracks.map((t, i) => {
      if (!i) return { t, score: null, why: '', tip: '' };
      const p = tracks[i - 1];
      if (!p.analyzed || !t.analyzed) return { t, score: null, why: 'Waiting for analysis', tip: '' };
      const c = compat(p, t, pl.mode, null);
      return { t, score: c.score, why: c.why, tip: mixTip(p, t), parts: c.parts, ai: pl.ai && pl.ai.notes ? pl.ai.notes[t.id] : '' };
    });
  };
  const statsOf = (items) => {
    const an = items.filter((i) => i.t.analyzed), sc = items.filter((i) => i.score != null);
    return {
      dur: items.reduce((a, i) => a + (i.t.duration || 0), 0),
      bpm: an.length ? an.reduce((a, i) => a + i.t.bpm, 0) / an.length : 0,
      score: sc.length ? sc.reduce((a, i) => a + i.score, 0) / sc.length : 0,
      min: sc.length ? Math.min(...sc.map((i) => i.score)) : 0,
    };
  };
  const currentPl = () => S.playlists.find((p) => p.id === S.plId) || null;

  async function createPlaylist(name, mode, trackIds) {
    const pl = { name, mode, created: Date.now(), trackIds };
    pl.id = await DB.put('playlists', pl);
    S.playlists.unshift(pl); S.plId = pl.id; return pl;
  }
  async function generate({ regen = false } = {}) {
    const scope = $('#genScope').value, n = +$('#genLen').value, startMode = $('#genStart').value;
    let pool = S.tracks.filter((t) => t.analyzed);
    if (scope === 'starred') pool = pool.filter((t) => t.star);
    if (scope === 'shown') { const ids = new Set(filteredTracks().map((t) => t.id)); pool = pool.filter((t) => ids.has(t.id)); }
    const note = $('#genNote');
    if (pool.length < 2) { note.textContent = scope === 'starred' ? 'Star at least two analyzed tracks first.' : 'Import and analyze at least two tracks first.'; return; }
    const start = startMode === 'deck' && S.selected && S.selected.analyzed && pool.includes(S.selected) ? S.selected : null;
    const path = generatePlaylist(pool, n, S.mode, start, regen ? 4 : 0);
    const ids = path.map((t) => t.id);
    if (regen && currentPl()) { const pl = currentPl(); pl.trackIds = ids; pl.mode = S.mode; await savePlaylist(pl); }
    else { const num = S.playlists.length + 1; await createPlaylist(`${MODES[S.mode].label} mix ${num}`, S.mode, ids); }
    const st = statsOf(chainOf(currentPl()));
    if (window.matchMedia('(max-width: 1180px)').matches) $('#genBox').open = false;
    note.textContent = `${path.length < n ? `Only ${path.length} tracks available. ` : ''}Built ${path.length} tracks in order of compatibility. Average transition score ${Math.round(st.score)}.`;
    renderPlaylists(); setView('playlists'); toast(path.length < n ? `Playlist built with ${path.length} tracks` : 'Playlist generated');
  }
  async function addToPlaylist(id) {
    let pl = currentPl();
    if (!pl) pl = await createPlaylist(`My playlist ${S.playlists.length + 1}`, S.mode, []);
    if (pl.trackIds.includes(id)) { toast('Already in this playlist'); return; }
    pl.trackIds.push(id); await savePlaylist(pl); renderPlaylists(); toast(`Added to “${pl.name}”`);
  }
  async function removeFromPlaylist(pl, i) {
    pl.trackIds.splice(i, 1); await savePlaylist(pl); renderPlaylists();
  }
  async function movePlaylistTrack(pl, i, d) {
    const j = i + d; if (j < 0 || j >= pl.trackIds.length) return;
    [pl.trackIds[i], pl.trackIds[j]] = [pl.trackIds[j], pl.trackIds[i]]; await savePlaylist(pl); renderPlaylists();
  }
  async function deletePlaylist(pl) {
    await DB.del('playlists', pl.id).catch(() => {});
    S.playlists = S.playlists.filter((p) => p.id !== pl.id);
    S.plId = S.playlists[0] ? S.playlists[0].id : null; renderPlaylists(); toast('Playlist deleted');
  }

  const slug = (s) => (String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'playlist');
  function download(name, mime, text) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function playlistText(pl) {
    const items = chainOf(pl), st = statsOf(items), L = [];
    const when = new Date(pl.created || Date.now());
    L.push('DJ INTELLIGENCE STUDIO - PLAYLIST', '='.repeat(44), `Name:     ${pl.name}`, `Mode:     ${MODES[pl.mode].label}`, `Created:  ${when.toLocaleString()}`,
      `Tracks:   ${items.length}   Total time: ${fmtLong(st.dur)}   Avg BPM: ${st.bpm ? st.bpm.toFixed(1) : '-'}   Avg transition score: ${Math.round(st.score)}`,
      'Tracks are in order of compatibility: each one is chosen to mix with the one before it.', '');
    if (pl.ai && pl.ai.story) L.push('Set story (AI): ' + pl.ai.story, '');
    items.forEach(({ t }, i) => {
      L.push(`${String(i + 1).padStart(2, '0')}. ${t.artist ? t.artist + ' - ' : ''}${t.title}`);
      L.push(`    ${genreLabel(t) ? genreLabel(t) + ' | ' : ''}${fmtBpm(t.bpm)} BPM | key ${t.key || '-'}${t.keyName ? ' (' + t.keyName + ')' : ''} | energy ${t.analyzed ? t.energy.toFixed(1) : '-'} | mixability ${t.analyzed ? Math.round(t.mixability) : '-'} | ${fmtTime(t.duration)}`);
      L.push(`    file: ${t.name}`);
      const nx = items[i + 1];
      if (nx) { L.push(`    next -> ${nx.score != null ? Math.round(nx.score) + '% match | ' + nx.why + ' | ' + nx.tip : 'not analyzed yet'}`); if (nx.ai) L.push(`    AI note: ${nx.ai}`); }
      L.push('');
    });
    L.push('Generated by DJ Intelligence Studio');
    return L.join('\n');
  }
  function exportPlaylist(pl, kind) {
    if (!pl || !pl.trackIds.length) { toast('This playlist is empty'); return; }
    const items = chainOf(pl), base = slug(pl.name);
    if (kind === 'txt') download(`${base}.txt`, 'text/plain', playlistText(pl));
    else if (kind === 'm3u') download(`${base}.m3u8`, 'audio/x-mpegurl', '#EXTM3U\n' + items.map(({ t }) => `#EXTINF:${Math.round(t.duration || 0)},${t.artist ? t.artist + ' - ' : ''}${t.title}\n${t.name}`).join('\n') + '\n');
    else {
      const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      download(`${base}.csv`, 'text/csv', ['position,title,artist,bpm,key,energy,mixability,transition_score,file'].concat(items.map(({ t, score }, i) => [i + 1, q(t.title), q(t.artist), t.bpm, t.key, t.energy, t.mixability, score == null ? '' : Math.round(score), q(t.name)].join(','))).join('\n'));
    }
  }
  function exportAllText() {
    if (!S.playlists.length) { toast('No playlists yet'); return; }
    download('dj-playlists.txt', 'text/plain', S.playlists.map(playlistText).join('\n\n' + '#'.repeat(44) + '\n\n'));
  }

  const baseName = (p) => { let s = String(p).trim(); try { s = decodeURIComponent(s); } catch { /* keep raw */ } return s.replace(/^file:\/\/(localhost)?\/?/i, '').split(/[\\/]/).pop().toLowerCase(); };
  async function importPlaylistFile(file) {
    const text = await file.text();
    const ext = (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    let entries = [];
    if (ext === '.xml') {
      const doc = new DOMParser().parseFromString(text, 'text/xml');
      const coll = new Map();
      $$('COLLECTION > TRACK', doc).forEach((el) => coll.set(el.getAttribute('TrackID'), el.getAttribute('Location')));
      const lists = $$('NODE[Type="1"]', doc).filter((n) => n.querySelector('TRACK'));
      if (lists.length && coll.size) entries = $$('TRACK', lists[0]).map((e) => coll.get(e.getAttribute('Key'))).filter(Boolean);
      else entries = $$('*', doc).map((e) => e.getAttribute('FilePath') || e.getAttribute('Location') || e.getAttribute('path')).filter(Boolean);
    } else entries = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const byName = new Map(S.tracks.map((t) => [t.name.toLowerCase(), t]));
    const ids = [], missing = [];
    for (const e of entries) { const t = byName.get(baseName(e)); t ? ids.push(t.id) : missing.push(baseName(e)); }
    if (!ids.length) { toast(`None of the ${entries.length} entries match files in your library`); return; }
    await createPlaylist(file.name.replace(/\.[^.]+$/, ''), S.mode, ids);
    renderPlaylists(); setView('playlists');
    toast(`Imported ${ids.length} of ${entries.length} entries${missing.length ? `. ${missing.length} not in your library` : ''}`);
  }

  /* ================================================================ decks */
  const Decks = {};
  let AC = null;
  function ensureAudioGraph(d) {
    try {
      if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
      if (AC.state === 'suspended') AC.resume();
      if (!d.an) {
        const src = AC.createMediaElementSource(d.audio), an = AC.createAnalyser(); an.fftSize = 512;
        src.connect(an); an.connect(AC.destination); d.an = an; d.buf = new Uint8Array(an.fftSize);
      }
    } catch { /* meters are optional */ }
  }
  function makeDeck(key) {
    const root = $(`#deck-${key}`), audio = new Audio(); audio.preload = 'metadata';
    const d = { key, root, audio, canvas: $('canvas', root), btn: $('.play', root), vu: $$('.vu i', root), track: null, url: null, raf: 0, an: null, buf: null };
    audio.addEventListener('timeupdate', () => updateTime(d));
    audio.addEventListener('loadedmetadata', () => updateTime(d));
    audio.addEventListener('play', () => { S.playing[key] = true; root.classList.add('playing'); setPlayIcon(d, true); loop(d); renderTableSoon(); });
    const stop = () => { S.playing[key] = false; root.classList.remove('playing'); setPlayIcon(d, false); draw(d); vuLevel(d, 0); renderTableSoon(); };
    audio.addEventListener('pause', stop); audio.addEventListener('ended', stop);
    d.btn.addEventListener('click', () => togglePlay(d));
    d.canvas.addEventListener('click', (e) => {
      if (!d.track || !audio.duration) return;
      const r = d.canvas.getBoundingClientRect(); audio.currentTime = clamp((e.clientX - r.left) / r.width, 0, 1) * audio.duration; draw(d);
    });
    new ResizeObserver(() => draw(d)).observe(d.canvas);

    // cue points: tap an empty cue to set it here, tap a set cue to jump, hold or right-click to clear
    $$('.cues button', root).forEach((b) => {
      let timer = null, held = false;
      const i = +b.dataset.cue;
      b.addEventListener('pointerdown', () => { held = false; timer = setTimeout(() => { held = true; clearCue(d, i); }, 650); });
      b.addEventListener('pointerup', () => clearTimeout(timer)); b.addEventListener('pointerleave', () => clearTimeout(timer));
      b.addEventListener('click', () => { if (!held) cueAction(d, i); });
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); clearCue(d, i); });
    });
    $('.d-star', root).addEventListener('click', () => { if (d.track) toggleStar(d.track); });
    $$('[data-fix]', root).forEach((b) => b.addEventListener('click', () => fixBpm(d, b.dataset.fix)));
    const ks = $('.keysel', root);
    ks.innerHTML = '<option value="">Key…</option>' + ['A', 'B'].map((L) => Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}${L}">${i + 1}${L}</option>`).join('')).join('');
    ks.addEventListener('change', () => { if (d.track && ks.value) fixKey(d.track, ks.value); });
    Decks[key] = d;
  }
  function togglePlay(d) {
    if (!d.track) return;
    if (d.audio.paused) { ensureAudioGraph(d); d.audio.play().catch(() => toast('Playback was blocked by the browser')); } else d.audio.pause();
  }
  function setPlayIcon(d, playing) { d.btn.innerHTML = icon(playing ? 'pause' : 'play'); d.btn.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'} deck ${d.key.toUpperCase()}`); }
  function updateTime(d) { $('.d-time', d.root).textContent = `${fmtTime(d.audio.currentTime)} / ${fmtTime(d.audio.duration || (d.track && d.track.duration) || 0)}`; }
  function vuLevel(d, level) { const on = Math.round(level * d.vu.length); d.vu.forEach((el, i) => el.classList.toggle('on', i < on)); }
  function loop(d) {
    cancelAnimationFrame(d.raf);
    const tick = () => {
      draw(d);
      if (d.an) { d.an.getByteTimeDomainData(d.buf); let s = 0; for (let i = 0; i < d.buf.length; i++) { const v = (d.buf[i] - 128) / 128; s += v * v; } vuLevel(d, clamp(Math.sqrt(s / d.buf.length) * 3.4, 0, 1)); }
      if (!d.audio.paused) d.raf = requestAnimationFrame(tick);
    };
    tick();
  }
  function draw(d) {
    const c = d.canvas, dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext('2d'); g.clearRect(0, 0, w, h);
    const cs = getComputedStyle(d.root);
    const live = cs.getPropertyValue('--c').trim() || '#ffb224', idle = cs.getPropertyValue('--wave-idle').trim() || '#555', fg = cs.getPropertyValue('--fg').trim() || '#fff';
    const t = d.track;
    if (!t || !t.wave) { g.fillStyle = idle; g.globalAlpha = .5; g.fillRect(0, h / 2 - dpr, w, 2 * dpr); g.globalAlpha = 1; return; }
    const dur = d.audio.duration || t.duration || 1;
    // intro and outro zones: where the track is quiet enough to blend
    g.fillStyle = live; g.globalAlpha = 0.13;
    if (t.intro > 2) g.fillRect(0, 0, Math.min(1, t.intro / dur) * w, h);
    if (t.outro > 2) { const x = (1 - Math.min(1, t.outro / dur)) * w; g.fillRect(x, 0, w - x, h); }
    g.globalAlpha = 1;
    const peaks = t.wave, barW = 2 * dpr, gap = dpr, n = Math.floor(w / (barW + gap));
    const prog = d.audio.duration ? d.audio.currentTime / d.audio.duration : 0;
    for (let i = 0; i < n; i++) {
      const s = Math.floor(i / n * peaks.length), e = Math.max(s + 1, Math.floor((i + 1) / n * peaks.length));
      let m = 0; for (let k = s; k < e; k++) if (peaks[k] > m) m = peaks[k];
      const bh = Math.max(2 * dpr, m / 255 * (h - 12 * dpr));
      g.fillStyle = i / n <= prog ? live : idle;
      g.fillRect(i * (barW + gap), (h - bh) / 2, barW, bh);
    }
    g.font = `${9 * dpr}px ui-monospace, monospace`; g.textBaseline = 'top';
    (t.cues || []).forEach((cu, i) => {
      if (cu == null) return; const x = Math.round(cu / dur * w);
      g.fillStyle = fg; g.fillRect(x, 0, dpr * 1.5, h); g.fillText(String(i + 1), x + 3 * dpr, 2 * dpr);
    });
    if (prog > 0) { g.fillStyle = fg; g.fillRect(Math.round(prog * w), 0, 2 * dpr, h); }
  }

  function cueAction(d, i) {
    const t = d.track; if (!t) return;
    t.cues = t.cues || [null, null, null, null];
    if (t.cues[i] == null) { t.cues[i] = Math.round(d.audio.currentTime * 10) / 10; saveTrack(t); paintCues(d); draw(d); toast(`Cue ${i + 1} set at ${fmtTime(t.cues[i])}`); }
    else { d.audio.currentTime = t.cues[i]; if (d.audio.paused) togglePlay(d); }
  }
  function clearCue(d, i) { const t = d.track; if (!t || !t.cues || t.cues[i] == null) return; t.cues[i] = null; saveTrack(t); paintCues(d); draw(d); toast(`Cue ${i + 1} cleared`); }
  function paintCues(d) {
    $$('.cues button', d.root).forEach((b, i) => {
      const v = d.track && d.track.cues ? d.track.cues[i] : null;
      b.disabled = !d.track; b.classList.toggle('set', v != null);
      b.textContent = v != null ? `${i + 1} · ${fmtTime(v)}` : `${i + 1} · set`;
      b.title = v != null ? 'Tap to jump. Hold or right-click to clear.' : 'Tap to set a cue at the playhead';
    });
  }

  const confClass = (c, hi, lo) => (c >= hi ? 'good' : c >= lo ? 'mid' : 'low');
  const mixWords = { beat: 'clear beat', room: 'room to blend', key: 'clear key', steady: 'steady dynamics', zone: 'DJ-friendly tempo' };
  const mixWeak = { beat: 'beat is hard to pin down', room: 'short intro or outro', key: 'key is uncertain', steady: 'big dynamic swings', zone: 'tempo outside the usual range' };
  function describeTrack(t) {
    if (!t || !t.analyzed) return 'Intro and outro estimates appear after analysis.';
    const bits = [`${t.keyName || t.key || ''}`.trim(), `intro ≈ ${t.intro}s`, `outro ≈ ${t.outro}s`, `${t.loudness} dB`].filter(Boolean);
    let why = '';
    if (t.mixParts) {
      const e = Object.entries(t.mixParts).sort((a, b) => b[1] - a[1]);
      why = ` Best: ${mixWords[e[0][0]]}. Watch: ${mixWeak[e[e.length - 1][0]]}.`;
    }
    return bits.join(' · ') + '.' + why;
  }
  function paintDeck(d) {
    const r = d.root, t = d.track, key = d.key;
    $('.d-title', r).textContent = t ? t.title : (key === 'a' ? 'Select a track' : 'Next track');
    $('.d-artist', r).textContent = t ? (t.artist || t.name) : (key === 'a' ? 'Pick any track in the library' : 'The best match for deck A loads here');
    $('.d-bpm', r).textContent = t && t.bpm ? fmtBpm(t.bpm) : '—';
    $('.d-key', r).outerHTML = kchipHTML(t && t.key, 'big d-key');
    $('.d-energy', r).textContent = t && t.analyzed ? t.energy.toFixed(1) : '—';
    $('.d-mix', r).textContent = t && t.analyzed ? Math.round(t.mixability) : '—';
    const bd = $('.d-bpmdot', r), kd = $('.d-keydot', r);
    bd.hidden = kd.hidden = !(t && t.analyzed);
    if (t && t.analyzed) {
      const bc = t.fixedBpm ? 1 : (t.bpmConfidence ?? 0.6), kc = t.fixedKey ? 1 : (t.keyConfidence ?? 0.6);
      bd.className = `dot d-bpmdot ${confClass(bc, 0.6, 0.4)}`; bd.title = t.fixedBpm ? 'BPM set by you' : `Tempo confidence ${Math.round(bc * 100)}%. ${bc < 0.4 ? 'Check this one by ear.' : ''}`;
      kd.className = `dot d-keydot ${confClass(kc, 0.55, 0.35)}`; kd.title = t.fixedKey ? 'Key set by you' : `Key confidence ${Math.round(kc * 100)}%. ${kc < 0.35 ? 'Check this one by ear.' : ''}`;
    }
    $$('[data-fix]', r).forEach((b) => { b.disabled = !(t && t.analyzed); });
    const ks = $('.keysel', r); ks.disabled = !(t && t.analyzed); ks.value = t && t.key ? t.key : '';
    const st = $('.d-star', r); st.disabled = !t; st.setAttribute('aria-pressed', String(!!(t && t.star))); st.classList.toggle('on', !!(t && t.star));
    d.btn.disabled = !t; setPlayIcon(d, false); paintCues(d);
    if (key === 'a') { $('.d-note', r).textContent = describeTrack(t); $('#rmTrack').disabled = !t; }
    updateTime(d); draw(d);
  }
  async function loadDeck(key, track) {
    const d = Decks[key]; if (!d) return;
    d.audio.pause(); d.track = track;
    d.audio.removeAttribute('src'); d.audio.load();
    if (d.url) { URL.revokeObjectURL(d.url); d.url = null; }
    d.audio.playbackRate = 1;
    paintDeck(d);
    if (key === 'b') { paintMatchNote(); updateSync(true); }
    if (track) {
      try { const rec = await DB.get('blobs', track.id); if (d.track !== track) return; d.url = URL.createObjectURL(rec.blob); d.audio.src = d.url; } catch { toast('Could not open this file for playback'); }
    }
    updateTime(d); draw(d);
  }
  function paintMatchNote() {
    const a = Decks.a.track, b = Decks.b.track, n = $('#matchNote');
    if (!a || !b || !a.analyzed || !b.analyzed) { n.textContent = b ? describeTrack(b) : 'The best match for deck A loads here.'; return; }
    const c = compat(a, b, S.mode);
    n.textContent = `${Math.round(c.score)}% match with A · ${c.why}. ${mixTip(a, b)}.`;
  }
  let synced = false;
  function updateSync(reset) {
    if (reset) synced = false;
    const a = Decks.a.track, b = Decks.b.track, btn = $('#syncBtn'), note = $('#syncNote');
    btn.disabled = !(a && b && a.bpm && b.bpm);
    let ratio = 1;
    if (synced && !btn.disabled) { ratio = a.bpm / b.bpm; if (ratio > 1.5) ratio /= 2; else if (ratio < 0.67) ratio *= 2; ratio = clamp(ratio, 0.84, 1.16); }
    Decks.b.audio.playbackRate = ratio;
    $('span', btn).textContent = synced ? 'Reset tempo' : 'Sync tempo to A';
    note.textContent = synced ? `Deck B plays at ${signed(ratio * 100 - 100)}% to lock to A.` : (a && b && a.bpm && b.bpm ? `${Math.abs(a.bpm - b.bpm).toFixed(1)} BPM apart.` : '');
  }

  /* ================================================================ track edits */
  function trackChanged(t) {
    saveTrack(t);
    [Decks.a, Decks.b].forEach((d) => { if (d.track === t) paintDeck(d); });
    refreshRecs(); renderRecs(); renderTable(); renderNav(); renderPlaylists(); paintMatchNote(); updateSync(false);
  }
  function toggleStar(t) { t.star = !t.star; trackChanged(t); toast(t.star ? 'Starred' : 'Unstarred'); }
  function fixBpm(d, how) {
    const t = d.track; if (!t || !t.bpm) return;
    t.bpm = Math.round((how === 'half' ? t.bpm / 2 : t.bpm * 2) * 10) / 10; t.fixedBpm = true; trackChanged(t); toast(`BPM set to ${fmtBpm(t.bpm)}`);
  }
  function fixKey(t, k) { t.key = k; t.keyName = ''; t.fixedKey = true; trackChanged(t); toast(`Key set to ${k}`); }

  async function removeTrack(id, quiet) {
    const t = S.byId.get(id); if (!t) return;
    try { await DB.del('tracks', id); await DB.del('blobs', id); } catch { toast('Could not remove that track'); return; }
    S.queue = S.queue.filter((q) => q !== id);
    S.tracks = S.tracks.filter((x) => x.id !== id); S.byId.delete(id);
    for (const pl of S.playlists) if (pl.trackIds.includes(id)) { pl.trackIds = pl.trackIds.filter((x) => x !== id); savePlaylist(pl); }
    const wasSel = S.selected && S.selected.id === id, wasB = S.nextB && S.nextB.id === id;
    if (wasSel) { S.selected = null; S.nextB = null; S.recs = []; S.match = new Map(); loadDeck('a', null); loadDeck('b', null); }
    else if (wasB) { refreshRecs(); S.nextB = S.recs[0] ? S.recs[0].t : null; loadDeck('b', S.nextB); }
    else refreshRecs();
    if (!quiet) { renderAll(true); renderRecs(); renderPlaylists(); toast(`Removed “${t.title}”`); }
  }

  /* ================================================================ rendering */
  function filteredTracks() {
    const f = FILTERS.find((x) => x[0] === S.filter)[2];
    const q = S.query.trim().toLowerCase();
    const rows = S.tracks.filter((t) => f(t) && (!S.keyFilter || t.key === S.keyFilter) && (!q || `${t.title} ${t.artist} ${t.name}`.toLowerCase().includes(q))
      && (!S.matchOnly || !S.selected || (t.id !== S.selected.id && (S.match.get(t.id) || 0) >= 65)));
    const { by, dir } = S.sort, m = dir === 'asc' ? 1 : -1;
    const val = (t) => {
      if (by === 'key') return t.key ? parseInt(t.key, 10) * 2 + (t.key.endsWith('B') ? 1 : 0) : 99;
      if (by === 'match') return S.match.get(t.id) ?? -1;
      return t[by];
    };
    rows.sort((a, b) => { const x = val(a), y = val(b); return typeof x === 'string' ? m * x.localeCompare(y) : m * ((x || 0) - (y || 0)); });
    return rows;
  }
  let tableTimer;
  function renderTableSoon() { clearTimeout(tableTimer); tableTimer = setTimeout(renderTable, 60); }
  const matchClass = (s) => (s >= 80 ? 'hi' : s >= 60 ? 'mid' : 'low');
  function renderTable() {
    const rows = filteredTracks();
    $('#count').textContent = `${rows.length} of ${S.tracks.length}`;
    $('#segLib').textContent = S.tracks.length;
    $$('.thead button').forEach((b) => { b.removeAttribute('aria-sort'); if (b.dataset.sort === S.sort.by) b.setAttribute('aria-sort', S.sort.dir === 'asc' ? 'ascending' : 'descending'); });
    $('#rmFailed').hidden = !S.tracks.some((t) => t.error);
    const host = $('#rows');
    if (!S.tracks.length) {
      host.innerHTML = `<div class="empty"><div class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><h3>Bring in your music</h3><p>Drop audio or video files here, or choose them from your device. Each track is analyzed for BPM, key, energy and mixability, then stays on this device.</p><label class="btn primary" for="fileIn"><i data-icon="upload"></i><span>Choose files</span></label><small>MP3, WAV, FLAC, M4A, AAC, OGG, MP4, MOV and more</small></div>`;
      paintIcons(host); return;
    }
    if (!rows.length) { host.innerHTML = '<div class="empty small"><p>No tracks match these filters.</p></div>'; return; }
    host.innerHTML = rows.map((t) => {
      const sel = S.selected && S.selected.id === t.id, isB = S.nextB && S.nextB.id === t.id;
      const live = (Decks.a.track === t && S.playing.a) || (Decks.b.track === t && S.playing.b);
      const cls = ['row', sel ? 'sel' : '', isB && !sel ? 'nextb' : '', live ? 'live' : ''].join(' ');
      const sub = [t.artist || t.name, genreLabel(t), t.duration ? fmtTime(t.duration) : ''].filter(Boolean).join(' · ');
      const m = S.match.get(t.id);
      const lowc = t.analyzed && !t.fixedBpm && (t.bpmConfidence ?? 1) < 0.4 ? '<i class="warn" title="Tempo is uncertain. Check by ear or use the ½ / 2× buttons.">?</i>' : '';
      const stat = t.analyzed
        ? `<span class="num">${fmtBpm(t.bpm)}${lowc}</span><span>${kchipHTML(t.key)}</span><span class="ebar hide-s"><i><b style="width:${t.energy * 10}%"></b></i><em>${t.energy.toFixed(1)}</em></span><span class="num mix hide-s">${Math.round(t.mixability)}</span><span class="num">${m != null && !sel ? `<b class="mchip ${matchClass(m)}">${Math.round(m)}</b>` : '<span class="dash">—</span>'}</span>`
        : `<span class="pending ${t.error ? 'err' : ''}">${esc(t.error || (t.pending ? 'Analyzing…' : 'Waiting to analyze'))}</span>`;
      return `<div class="${cls}" role="row" tabindex="0" data-id="${t.id}"><span class="t"><b>${live ? '<span class="eqi" aria-label="Playing"><i></i><i></i><i></i></span>' : ''}${esc(t.title)}</b><small>${esc(sub)}</small></span>${stat}<span class="acts"><button class="iconbtn ${t.star ? 'on' : ''}" data-act="star" aria-label="${t.star ? 'Unstar' : 'Star'} ${esc(t.title)}" title="Star"><i data-icon="star"></i></button><button class="iconbtn" data-act="add" aria-label="Add ${esc(t.title)} to playlist" title="Add to playlist"><i data-icon="plus"></i></button><button class="iconbtn rmx" data-act="rm" aria-label="Remove ${esc(t.title)}" title="Remove from library"><i data-icon="x"></i></button></span></div>`;
    }).join('');
    paintIcons(host);
  }

  /* Camelot wheel: current key outlined, compatible keys ringed, keys not in the library dimmed */
  function arc(r1, r2, a0, a1) {
    const p = (r, a) => [(r * Math.cos(a)).toFixed(2), (r * Math.sin(a)).toFixed(2)];
    const [x0, y0] = p(r2, a0), [x1, y1] = p(r2, a1), [x2, y2] = p(r1, a1), [x3, y3] = p(r1, a0);
    return `M${x0} ${y0}A${r2} ${r2} 0 0 1 ${x1} ${y1}L${x2} ${y2}A${r1} ${r1} 0 0 0 ${x3} ${y3}Z`;
  }
  function renderWheel() {
    const have = new Set(S.tracks.map((t) => t.key).filter(Boolean));
    const cur = S.selected && S.selected.key;
    const ok = new Set();
    if (cur) { const n = parseInt(cur, 10), L = cur.slice(-1), O = L === 'A' ? 'B' : 'A'; const w = (x) => ((x - 1 + 12) % 12) + 1; [`${n}${L}`, `${w(n + 1)}${L}`, `${w(n - 1)}${L}`, `${n}${O}`].forEach((k) => ok.add(k)); }
    let h = '';
    for (const [L, r1, r2] of [['B', 68, 102], ['A', 36, 66]]) {
      for (let n = 1; n <= 12; n++) {
        const k = `${n}${L}`, ang = ((n % 12) * 30 - 90) * Math.PI / 180, a0 = ang - 14.4 * Math.PI / 180, a1 = ang + 14.4 * Math.PI / 180;
        const mid = (r1 + r2) / 2, tx = (mid * Math.cos(ang)).toFixed(1), ty = (mid * Math.sin(ang)).toFixed(1);
        const cls = ['wk', have.has(k) ? 'has' : '', k === cur ? 'cur' : ok.has(k) ? 'ok' : '', S.keyFilter === k ? 'flt' : ''].join(' ');
        h += `<g class="${cls}" data-key="${k}" tabindex="0" role="button" aria-label="Key ${k}${have.has(k) ? '' : ', none in library'}"><path d="${arc(r1, r2, a0, a1)}" style="--h:${camHue(k)}"/><text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="central">${k}</text></g>`;
      }
    }
    h += `<text class="ctr" x="0" y="-6" text-anchor="middle">${cur || 'KEY'}</text><text class="ctr2" x="0" y="11" text-anchor="middle">${cur ? 'matches lit' : 'pick a track'}</text>`;
    $('#wheel').innerHTML = h;
  }
  function renderNav() {
    $('#filters').innerHTML = FILTERS.map(([k, label, fn]) => `<button data-filter="${k}" aria-pressed="${S.filter === k}"><span>${label}</span><b>${S.tracks.filter(fn).length}</b></button>`).join('');
    $('#filterSel').innerHTML = FILTERS.map(([k, label, fn]) => `<option value="${k}" ${S.filter === k ? 'selected' : ''}>${label} (${S.tracks.filter(fn).length})</option>`).join('');
    renderWheel();
  }

  const scoreClass = (s) => (s >= 80 ? '' : s >= 60 ? 'mid' : 'low');
  function renderRecs() {
    const host = $('#recs'); const none = (m) => `<li class="hint" style="display:block;cursor:default">${m}</li>`;
    if (!S.selected) host.innerHTML = none('Select a track to see the best transitions out of it.');
    else if (!S.selected.analyzed) host.innerHTML = none('This track is still being analyzed.');
    else if (!S.recs.length) host.innerHTML = none('Analyze more tracks to see recommendations.');
    else host.innerHTML = S.recs.map((r, i) => `<li data-id="${r.t.id}" class="${S.nextB && S.nextB.id === r.t.id ? 'on' : ''}" tabindex="0"><span class="pos">${i + 1}</span><span class="m"><b>${esc(r.t.title)}</b><small>${kchipHTML(r.t.key)} ${esc(r.why)}</small>${r.ai ? `<small class="ainote">AI: ${esc(r.ai)}</small>` : ''}</span><span class="score ${scoreClass(r.score)}">${Math.round(r.score)}</span><button class="iconbtn" data-add="${r.t.id}" aria-label="Add ${esc(r.t.title)} to playlist" title="Add to playlist"><i data-icon="plus"></i></button></li>`).join('');
    $('#seedName').textContent = S.selected ? `after ${S.selected.title}` : '';
    paintIcons(host); emit('recs');
  }
  function renderModes() {
    $$('[data-modes]').forEach((h) => { h.innerHTML = Object.entries(MODES).map(([k, m]) => `<button role="radio" aria-checked="${S.mode === k}" data-mode="${k}">${m.label}</button>`).join(''); });
    $$('[data-modedesc]').forEach((h) => { h.textContent = MODES[S.mode].desc; });
  }

  function curveSVG(items) {
    const W = 640, H = 130, px = 30, py = 20, n = items.length;
    const x = (i) => (n > 1 ? px + i * (W - 2 * px) / (n - 1) : W / 2), y = (e) => H - py - (e - 1) / 9 * (H - 2 * py);
    const pts = items.map((it, i) => [x(i), y(it.t.analyzed ? it.t.energy : 1)]);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');
    let g = '';
    [2, 5, 8].forEach((e) => { g += `<line x1="${px}" x2="${W - px}" y1="${y(e)}" y2="${y(e)}" class="gl"/><text x="${px - 8}" y="${y(e)}" text-anchor="end" dominant-baseline="central" class="gt">${e}</text>`; });
    const dots = items.map((it, i) => `<g><circle cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="4.5" class="dt"/><text x="${pts[i][0].toFixed(1)}" y="${H - 4}" text-anchor="middle" class="gt">${i + 1}</text><title>${esc(it.t.title)}: energy ${it.t.analyzed ? it.t.energy.toFixed(1) : '-'}</title></g>`).join('');
    const area = n > 1 ? `<path d="${line}L${pts[n - 1][0].toFixed(1)} ${H - py}L${pts[0][0].toFixed(1)} ${H - py}Z" class="ar"/>` : '';
    return `<svg class="curve" viewBox="0 0 ${W} ${H}" role="img" aria-label="Energy across the playlist, from track 1 to ${n}"><defs><linearGradient id="cg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--a)" stop-opacity=".35"/><stop offset="1" stop-color="var(--a)" stop-opacity="0"/></linearGradient></defs>${g}${area}<path d="${line}" class="ln"/>${dots}</svg>`;
  }

  function renderPlaylists() {
    $('#segPl').textContent = S.playlists.length;
    const list = $('#plList'), det = $('#plDetail');
    if (!S.playlists.length) {
      list.innerHTML = ''; list.hidden = true;
      det.innerHTML = '<div class="empty"><div class="eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><h3>No playlists yet</h3><p>Pick a mode, then press Generate. The app orders tracks so each one blends into the next, and you can download the result as a text file.</p></div>';
      return;
    }
    list.hidden = false;
    list.innerHTML = `<div class="plhead"><h2>Saved playlists</h2><button class="btn small" id="dlAll"><i data-icon="download"></i><span>All as .txt</span></button></div>` + S.playlists.map((p) => {
      const st = statsOf(chainOf(p));
      return `<button class="plcard ${p.id === S.plId ? 'on' : ''}" data-pl="${p.id}"><b>${esc(p.name)}</b><small>${p.trackIds.length} tracks · ${fmtLong(st.dur)} · ${MODES[p.mode].label}</small>${st.score ? `<span class="score ${scoreClass(st.score)}">${Math.round(st.score)}</span>` : ''}</button>`;
    }).join('');
    const pl = currentPl() || S.playlists[0]; S.plId = pl.id;
    const items = chainOf(pl), st = statsOf(items);
    let rows = '';
    items.forEach((it, i) => {
      const t = it.t;
      if (i) rows += `<div class="tr ${it.score == null ? '' : matchClass(it.score)}"><span class="mchip ${it.score == null ? '' : matchClass(it.score)}">${it.score == null ? '—' : Math.round(it.score)}</span><span class="why">${esc(it.why)}${it.tip ? `<em>${esc(it.tip)}</em>` : ''}${it.ai ? `<em class="ainote">AI: ${esc(it.ai)}</em>` : ''}</span></div>`;
      rows += `<div class="pt" data-i="${i}" data-id="${t.id}" tabindex="0"><span class="pos">${String(i + 1).padStart(2, '0')}</span><span class="m"><b>${esc(t.title)}</b><small>${esc([t.artist || t.name, genreLabel(t), fmtTime(t.duration)].filter(Boolean).join(' · '))}</small></span><span class="chips">${t.analyzed ? `<span class="num">${fmtBpm(t.bpm)}</span>${kchipHTML(t.key)}<span class="num en">E${t.energy.toFixed(1)}</span>` : '<span class="pending">analyzing…</span>'}</span><span class="acts"><button class="iconbtn" data-pa="load" aria-label="Load on decks" title="Load on the decks"><i data-icon="play"></i></button><button class="iconbtn" data-pa="up" aria-label="Move up" title="Move up" ${i === 0 ? 'disabled' : ''}><i data-icon="up"></i></button><button class="iconbtn" data-pa="down" aria-label="Move down" title="Move down" ${i === items.length - 1 ? 'disabled' : ''}><i data-icon="down"></i></button><button class="iconbtn rmx" data-pa="rm" aria-label="Remove from playlist" title="Remove from playlist"><i data-icon="x"></i></button></span></div>`;
    });
    det.innerHTML = `<div class="dethead"><input id="plName" class="plname" value="${esc(pl.name)}" aria-label="Playlist name" maxlength="60"><div class="detacts"><button class="btn primary small" data-pdl="txt"><i data-icon="download"></i><span>Download .txt</span></button><button class="btn small" data-pdl="m3u"><span>M3U8</span></button><button class="btn small" data-pdl="csv"><span>CSV</span></button><button class="btn small" id="plRegen" title="Build a different ordering with the same settings"><i data-icon="refresh"></i><span>Regenerate</span></button><button class="btn small danger" id="plDel"><i data-icon="trash"></i><span>Delete</span></button></div></div>
      <p class="meta">${items.length} tracks · ${fmtLong(st.dur)}${st.bpm ? ` · avg ${st.bpm.toFixed(1)} BPM` : ''} · ${MODES[pl.mode].label}${st.score ? ` · transitions avg <b>${Math.round(st.score)}</b>, weakest <b>${Math.round(st.min)}</b>` : ''}</p>
      <div id="aiPl"></div>
      ${items.length ? curveSVG(items) : ''}
      <div class="pt-list">${rows || '<p class="hint">This playlist is empty. Use the + button on any track to add it.</p>'}</div>`;
    paintIcons(list); paintIcons(det); emit('playlists', pl);
  }

  function renderQueue() {
    const q = $('#queue'); const active = S.total > 0;
    q.hidden = !active; $('#app').classList.toggle('busy', active);
    if (active) { $('#queueText').textContent = `Analyzing ${Math.min(S.done + 1, S.total)} of ${S.total} · ${S.current}`; $('#queueBar').style.width = `${(S.done / S.total) * 100}%`; }
  }
  function renderStorageNote() {
    if (!navigator.storage || !navigator.storage.estimate) return;
    navigator.storage.estimate().then((e) => { const mb = (e.usage || 0) / 1048576; $('#storageNote').textContent = `Stored on this device: ${mb < 1024 ? mb.toFixed(0) + ' MB' : (mb / 1024).toFixed(1) + ' GB'}. Nothing is uploaded.`; }).catch(() => {});
  }
  function renderAll(full) {
    renderNav(); renderTable(); renderModes();
    if (full) { if (S.selected) { refreshRecs(); renderRecs(); } renderStorageNote(); }
  }

  /* ================================================================ selection + views */
  function select(t) {
    S.selected = t; refreshRecs();
    loadDeck('a', t);
    if (t && S.recs[0]) { S.nextB = S.recs[0].t; loadDeck('b', S.nextB); } else { S.nextB = null; loadDeck('b', null); }
    renderTable(); renderRecs(); renderWheel();
  }
  function setView(v) {
    S.view = v; $('#app').dataset.view = v;
    $$('.tabs button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
    $$('#seg button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === (v === 'playlists' || v === 'discover' ? v : 'library'))));
    requestAnimationFrame(() => { draw(Decks.a); draw(Decks.b); }); emit('view', v);
  }
  function applyTheme(t) {
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    const dark = t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    $('#themeBtn').innerHTML = icon(dark ? 'sun' : 'moon');
    requestAnimationFrame(() => { draw(Decks.a); draw(Decks.b); });
  }

  /* ================================================================ events */
  function wire() {
    $('#fileIn').addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });
    $('#plIn').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importPlaylistFile(f).catch(() => toast('Could not read that playlist file')); });
    $('#search').addEventListener('input', (e) => { S.query = e.target.value; renderTable(); });
    $('#filterSel').addEventListener('change', (e) => { S.filter = e.target.value; renderNav(); renderTable(); });
    $('#matchOnly').addEventListener('click', (e) => { S.matchOnly = !S.matchOnly; e.currentTarget.setAttribute('aria-pressed', String(S.matchOnly)); if (S.matchOnly && !S.selected) toast('Select a track first'); renderTable(); });
    $('#themeBtn').addEventListener('click', () => {
      const cur = document.documentElement.dataset.theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const next = cur === 'dark' ? 'light' : 'dark'; store.set('djs-theme', next); applyTheme(next);
    });

    // library table: select, star, add to playlist, remove (two taps)
    let rmArm = { id: null, timer: null };
    $('#rows').addEventListener('click', (e) => {
      const row = e.target.closest('.row'); if (!row) return; const t = S.byId.get(+row.dataset.id); if (!t) return;
      const act = e.target.closest('[data-act]');
      if (!act) { select(t); return; }
      const a = act.dataset.act;
      if (a === 'star') toggleStar(t);
      else if (a === 'add') addToPlaylist(t.id);
      else if (a === 'rm') {
        if (rmArm.id === t.id) { clearTimeout(rmArm.timer); rmArm.id = null; removeTrack(t.id); }
        else { rmArm.id = t.id; act.classList.add('armed'); act.innerHTML = '<span>Remove?</span>'; clearTimeout(rmArm.timer); rmArm.timer = setTimeout(() => { rmArm.id = null; renderTable(); }, 3000); }
      }
    });
    $('#rows').addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('row')) { e.preventDefault(); select(S.byId.get(+e.target.dataset.id)); } });
    $('.thead').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return; const by = b.dataset.sort;
      S.sort = { by, dir: S.sort.by === by ? (S.sort.dir === 'asc' ? 'desc' : 'asc') : (by === 'title' ? 'asc' : 'desc') };
      store.set('djs-sort-by', S.sort.by); store.set('djs-sort-dir', S.sort.dir); renderTable();
    });
    $('#filters').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { S.filter = b.dataset.filter; renderNav(); renderTable(); } });
    const wheelPick = (g) => { if (!g) return; const k = g.dataset.key; S.keyFilter = S.keyFilter === k ? '' : k; renderWheel(); renderTable(); };
    $('#wheel').addEventListener('click', (e) => wheelPick(e.target.closest('g[data-key]')));
    $('#wheel').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); wheelPick(e.target.closest('g[data-key]')); } });

    document.addEventListener('click', (e) => {
      const m = e.target.closest('[data-mode]');
      if (m) { S.mode = m.dataset.mode; store.set('djs-mode', S.mode); renderModes(); refreshRecs(); renderRecs(); if (S.recs[0]) { S.nextB = S.recs[0].t; loadDeck('b', S.nextB); renderTable(); } }
    });
    $('#recs').addEventListener('click', (e) => {
      const add = e.target.closest('[data-add]'); if (add) { addToPlaylist(+add.dataset.add); return; }
      const li = e.target.closest('li[data-id]'); if (!li) return; const t = S.byId.get(+li.dataset.id);
      S.nextB = t; loadDeck('b', t); renderRecs(); renderTable(); toast(`Loaded “${t.title}” on deck B`);
    });

    // playlists
    $('#genBtn').addEventListener('click', () => generate());
    $('#plList').addEventListener('click', (e) => {
      if (e.target.closest('#dlAll')) { exportAllText(); return; }
      const c = e.target.closest('[data-pl]'); if (c) { S.plId = +c.dataset.pl; renderPlaylists(); }
    });
    let plDelArm;
    $('#plDetail').addEventListener('click', async (e) => {
      const pl = currentPl(); if (!pl) return;
      const dl = e.target.closest('[data-pdl]'); if (dl) { exportPlaylist(pl, dl.dataset.pdl); return; }
      if (e.target.closest('#plRegen')) { await generateLike(pl); return; }
      const del = e.target.closest('#plDel');
      if (del) {
        if (!plDelArm) { del.classList.add('armed'); $('span', del).textContent = 'Tap again to delete'; plDelArm = setTimeout(() => { plDelArm = null; renderPlaylists(); }, 3500); }
        else { clearTimeout(plDelArm); plDelArm = null; deletePlaylist(pl); }
        return;
      }
      const row = e.target.closest('.pt'); if (!row) return; const i = +row.dataset.i, act = e.target.closest('[data-pa]');
      if (act) {
        const a = act.dataset.pa;
        if (a === 'rm') removeFromPlaylist(pl, i); else if (a === 'up') movePlaylistTrack(pl, i, -1); else if (a === 'down') movePlaylistTrack(pl, i, 1);
        else if (a === 'load') loadPair(pl, i);
        return;
      }
      loadPair(pl, i);
    });
    $('#plDetail').addEventListener('change', (e) => {
      if (e.target.id === 'plName') { const pl = currentPl(); if (pl) { pl.name = e.target.value.trim() || pl.name; savePlaylist(pl); renderPlaylists(); } }
    });

    // deck footer, tools
    $('#syncBtn').addEventListener('click', () => { synced = !synced; updateSync(false); });
    let rmArmed;
    $('#rmTrack').addEventListener('click', async (e) => {
      const b = e.currentTarget, t = S.selected; if (!t) return;
      if (!rmArmed) { b.classList.add('armed'); $('span', b).textContent = 'Tap again to remove'; rmArmed = setTimeout(() => { rmArmed = null; b.classList.remove('armed'); $('span', b).textContent = 'Remove track'; }, 3500); return; }
      clearTimeout(rmArmed); rmArmed = null; b.classList.remove('armed'); $('span', b).textContent = 'Remove track';
      await removeTrack(t.id);
    });
    $('#rmFailed').addEventListener('click', async () => { const bad = S.tracks.filter((t) => t.error); for (const t of bad) await removeTrack(t.id, true); renderAll(true); renderRecs(); renderPlaylists(); toast(`Removed ${bad.length} failed track${bad.length === 1 ? '' : 's'}`); });
    let armed;
    $('#clearBtn').addEventListener('click', async (e) => {
      const b = e.currentTarget;
      if (!armed) { armed = setTimeout(() => { armed = null; b.classList.remove('armed'); $('span', b).textContent = 'Clear library'; }, 4000); b.classList.add('armed'); $('span', b).textContent = 'Tap again to delete all'; return; }
      clearTimeout(armed); armed = null; b.classList.remove('armed'); $('span', b).textContent = 'Clear library';
      await DB.clear('tracks'); await DB.clear('blobs'); await DB.clear('playlists');
      S.tracks = []; S.byId.clear(); S.selected = null; S.nextB = null; S.playlists = []; S.plId = null; S.recs = []; S.match = new Map(); S.queue = [];
      loadDeck('a', null); loadDeck('b', null); renderAll(true); renderRecs(); renderPlaylists(); toast('Library cleared');
    });
    $$('.tabs button, #seg button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

    // keyboard: space plays deck A (shift: B), 1-4 jump or set cues on A (shift: B), arrows move through the library
    document.addEventListener('keydown', (e) => {
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      const d = e.shiftKey ? Decks.b : Decks.a;
      if (e.code === 'Space' && !e.target.closest('button, [role="button"], .row, .pt')) { e.preventDefault(); togglePlay(d); }
      else if (/^Digit[1-4]$/.test(e.code)) { cueAction(d, +e.code.slice(5) - 1); }
      else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && S.view === 'library' && e.target.closest('.row')) {
        e.preventDefault(); const rows = filteredTracks(), i = rows.findIndex((t) => S.selected && t.id === S.selected.id), n = rows[clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, rows.length - 1)];
        if (n) { select(n); requestAnimationFrame(() => { const el = $(`.row[data-id="${n.id}"]`); if (el) el.focus(); }); }
      }
    });

    // drag and drop
    let depth = 0; const app = $('#app');
    window.addEventListener('dragenter', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { depth++; app.classList.add('dragging'); } });
    window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) app.classList.remove('dragging'); });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; app.classList.remove('dragging'); if (e.dataTransfer && e.dataTransfer.files.length) importFiles(e.dataTransfer.files); });

    // install prompt (Chrome / Edge on Windows and Android)
    let deferred;
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $('#installBtn').hidden = false; });
    $('#installBtn').addEventListener('click', async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; $('#installBtn').hidden = true; });
    window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; toast('Installed'); });
    if ('launchQueue' in window) window.launchQueue.setConsumer(async (p) => { if (!p.files || !p.files.length) return; const files = await Promise.all(p.files.map((h) => h.getFile())); importFiles(files); });

    window.addEventListener('unhandledrejection', (e) => { e.preventDefault(); toast('Something went wrong. Your library is safe.'); });
  }
  async function generateLike(pl) {
    // regenerate keeps the playlist's mode, length and opener preference
    const pool = S.tracks.filter((t) => t.analyzed);
    if (pool.length < 2) { toast('Analyze at least two tracks first'); return; }
    const prevMode = S.mode; S.mode = pl.mode;
    const n = Math.max(pl.trackIds.length, 2), first = S.byId.get(pl.trackIds[0]);
    const path = generatePlaylist(pool, n, pl.mode, null, 4);
    S.mode = prevMode; if (first && !path.length) return;
    pl.trackIds = path.map((t) => t.id); await savePlaylist(pl); renderPlaylists(); toast('Reordered with a fresh pass');
  }
  function loadPair(pl, i) {
    const t = S.byId.get(pl.trackIds[i]), nx = S.byId.get(pl.trackIds[i + 1]); if (!t) return;
    S.selected = t; refreshRecs(); loadDeck('a', t);
    S.nextB = nx || (S.recs[0] && S.recs[0].t) || null; loadDeck('b', S.nextB);
    renderTable(); renderRecs(); renderWheel();
    if (window.matchMedia('(max-width: 1180px)').matches) setView('decks');
    toast(nx ? `Loaded “${t.title}” on A and “${nx.title}” on B` : `Loaded “${t.title}” on deck A`);
  }

  /* ================================================================ boot */
  async function boot() {
    paintIcons(); makeDeck('a'); makeDeck('b'); wire(); renderModes();
    const saved = store.get('djs-theme', ''); applyTheme(saved === 'dark' || saved === 'light' ? saved : '');
    paintDeck(Decks.a); paintDeck(Decks.b);
    setView('library');
    try {
      const rows = await DB.all('tracks');
      // earlier versions shipped synthetic demo loops. They are removed for good.
      for (const t of rows.filter((x) => x.demo)) { await DB.del('tracks', t.id).catch(() => {}); await DB.del('blobs', t.id).catch(() => {}); }
      S.tracks = rows.filter((t) => !t.demo).map((t) => ({ ...t, pending: false, cues: t.cues || [null, null, null, null] }));
      S.byId = new Map(S.tracks.map((t) => [t.id, t]));
      const pls = await DB.all('playlists');
      S.playlists = pls.sort((a, b) => b.created - a.created).map((p) => ({ ...p, trackIds: p.trackIds.filter((id) => S.byId.has(id)) }));
      S.plId = S.playlists[0] ? S.playlists[0].id : null;
    } catch { toast('Storage is unavailable. Tracks will not be saved.'); }
    renderAll(true); renderRecs(); renderPlaylists();
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch { /* optional */ }
    // analyze anything new, plus tracks analyzed by the older, less detailed engine
    const todo = S.tracks.filter((t) => !t.analyzed || (t.aver || 1) < 2).map((t) => t.id);
    if (todo.length) enqueue(todo);
    const first = S.tracks.filter((t) => t.analyzed).sort((a, b) => b.added - a.added)[0];
    if (first) select(first);
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.__djs = S; // inspection aid for testing
  window.__djsAPI = { S, $, $$, esc, clamp, toast, icon, paintIcons, MODES, compat, chainOf, statsOf, currentPl, savePlaylist, saveTrack, fmtBpm, fmtTime, kchipHTML, mixTip, renderPlaylists, renderRecs, renderTable, refreshRecs, familiesOf, setGenres, genreLabel, genreSim, loadDeck, select, setView, store, emit };
  boot();
})();
