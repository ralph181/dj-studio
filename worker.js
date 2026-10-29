'use strict';
/* Analysis engine v2: BPM (with stability), Camelot key (with runner-up), energy, mixability,
   intro/outro levels, 8-band sound profile and waveform. Runs in a Web Worker on a mono 22.05 kHz slice. */
const SR = 22050;

function makeFFT(n) {
  const levels = Math.round(Math.log2(n));
  const cos = new Float32Array(n / 2), sin = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) { let r = 0, x = i; for (let b = 0; b < levels; b++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
  return function (re, im) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * cos[k] + im[l] * sin[k];
          const tim = -re[l] * sin[k] + im[l] * cos[k];
          re[l] = re[j] - tre; im[l] = im[j] - tim;
          re[j] += tre; im[j] += tim;
        }
      }
    }
  };
}
function hann(n) { const w = new Float32Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)); return w; }
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ---- onset strength envelope (spectral flux on log magnitudes, up to ~5 kHz) ---- */
function onsetEnvelope(y) {
  const N = 1024, hop = 256, K = 232;
  const n = Math.max(0, 1 + Math.floor((y.length - N) / hop));
  const fft = makeFFT(N), win = hann(N);
  const re = new Float32Array(N), im = new Float32Array(N);
  const prev = new Float32Array(K), env = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    const o = f * hop;
    for (let i = 0; i < N; i++) { re[i] = y[o + i] * win[i]; im[i] = 0; }
    fft(re, im);
    let flux = 0;
    for (let k = 1; k < K; k++) {
      const m = Math.log1p(Math.sqrt(re[k] * re[k] + im[k] * im[k]) * 20);
      const d = m - prev[k];
      if (d > 0) flux += d;
      prev[k] = m;
    }
    env[f] = flux;
  }
  return { env, fps: SR / hop };
}

/* ---- tempo: autocorrelation of the onset envelope with harmonic summation + log-tempo prior ---- */
function estimateTempo(env, fps) {
  const n = env.length;
  if (n < fps * 8) return { bpm: 0, confidence: 0, strength: 0 };
  const w = Math.round(fps), x = new Float32Array(n);
  let run = 0;
  for (let i = 0; i < n; i++) {
    run += env[i];
    if (i >= w) run -= env[i - w];
    const mean = run / Math.min(i + 1, w);
    x[i] = Math.max(0, env[i] - mean);
  }
  let mu = 0; for (let i = 0; i < n; i++) mu += x[i]; mu /= n;
  for (let i = 0; i < n; i++) x[i] -= mu;
  const maxLag = Math.ceil(fps * 60 / 70 * 4) + 3;
  const acf = new Float32Array(maxLag + 1);
  for (let l = 0; l <= maxLag; l++) {
    let s = 0; const m = n - l;
    for (let i = 0; i < m; i++) s += x[i] * x[i + l];
    acf[l] = s / m;
  }
  const a0 = acf[0] || 1e-9;
  const at = (lag) => { const i = Math.floor(lag), f = lag - i; return i + 1 > maxLag ? 0 : (acf[i] * (1 - f) + acf[i + 1] * f) / a0; };
  const weights = [1, 0.85, 0.6, 0.45];
  const scores = [], bpms = [];
  let sum = 0, best = -1, bi = 0;
  for (let bpm = 70; bpm <= 180.001; bpm += 0.1) {
    const lag = fps * 60 / bpm;
    let s = 0;
    for (let k = 1; k <= 4; k++) s += weights[k - 1] * at(lag * k);
    s *= Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120), 2));
    scores.push(s); bpms.push(bpm); sum += s;
    if (s > best) { best = s; bi = scores.length - 1; }
  }
  let bpm = bpms[bi];
  const nearest = Math.round(bpm);
  if (Math.abs(bpm - nearest) < 0.25) bpm = nearest;
  const meanScore = sum / scores.length;
  const confidence = clamp((best / (meanScore + 1e-9) - 1) / 4, 0, 1);
  const strength = clamp(at(fps * 60 / bpm) * 2, 0, 1);
  return { bpm: Math.round(bpm * 10) / 10, confidence, strength };
}

/* tempo estimated separately on both halves: if they agree the grid is steady, if not the number is unreliable */
function tempoWithStability(env, fps) {
  const whole = estimateTempo(env, fps);
  let stability = 0.7;
  if (env.length > fps * 90 && whole.bpm) {
    const h = env.length >> 1;
    const a = estimateTempo(env.subarray(0, h), fps).bpm, b = estimateTempo(env.subarray(h), fps).bpm;
    if (a && b) {
      const rel = Math.abs(a - b) / ((a + b) / 2);
      const agreesWithWhole = Math.abs(a - whole.bpm) / whole.bpm < 0.03 || Math.abs(b - whole.bpm) / whole.bpm < 0.03;
      stability = clamp(1 - rel * 12, 0, 1) * (agreesWithWhole ? 1 : 0.5);
    }
  }
  const confidence = clamp(0.35 + whole.confidence * 0.9, 0, 1) * (0.55 + 0.45 * stability);
  return { ...whole, stability, confidence: clamp(confidence, 0, 1) };
}

/* ---- key (Krumhansl-Schmuckler on peak-picked chroma) + 8-band sound profile ---- */
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const CAM_MAJ = ['8B', '3B', '10B', '5B', '12B', '7B', '2B', '9B', '4B', '11B', '6B', '1B'];
const CAM_MIN = ['5A', '12A', '7A', '2A', '9A', '4A', '11A', '6A', '1A', '8A', '3A', '10A'];
const BAND_EDGES = [0, 60, 150, 400, 1000, 2500, 5000, 10000, 11025];

function corr(a, b) {
  let ma = 0, mb = 0; for (let i = 0; i < 12; i++) { ma += a[i]; mb += b[i]; } ma /= 12; mb /= 12;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return num / (Math.sqrt(da * db) + 1e-12);
}

function estimateKey(y) {
  const N = 8192, hop = 4096;
  const n = Math.max(0, 1 + Math.floor((y.length - N) / hop));
  const empty = { camelot: '', name: '', alt: '', confidence: 0, centroid: 0, timbre: new Array(8).fill(0.125) };
  if (!n) return empty;
  const fft = makeFFT(N), win = hann(N);
  const re = new Float32Array(N), im = new Float32Array(N), mag = new Float32Array(N / 2);
  const binHz = SR / N, kLo = Math.ceil(130 / binHz), kHi = Math.floor(2200 / binHz);
  const chroma = new Float64Array(12), band = new Float64Array(8);
  const bandOf = new Uint8Array(N / 2); for (let k = 0; k < N / 2; k++) { const hz = k * binHz; let b = 7; for (let i = 0; i < 8; i++) if (hz < BAND_EDGES[i + 1]) { b = i; break; } bandOf[k] = b; }
  let centroidSum = 0, centroidCount = 0;
  for (let f = 0; f < n; f++) {
    const o = f * hop;
    for (let i = 0; i < N; i++) { re[i] = y[o + i] * win[i]; im[i] = 0; }
    fft(re, im);
    let num = 0, den = 0;
    for (let k = 1; k < N / 2; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]); mag[k] = m;
      band[bandOf[k]] += m * m;
      if (k < N / 4) { num += k * binHz * m; den += m; }
    }
    if (den > 1e-6) { centroidSum += num / den; centroidCount++; }
    for (let k = kLo; k <= kHi; k++) {
      if (mag[k] > mag[k - 1] && mag[k] >= mag[k + 1] && mag[k] > 0) {
        const a = mag[k - 1], b = mag[k], c = mag[k + 1];
        const d = (a - 2 * b + c);
        const off = d !== 0 ? 0.5 * (a - c) / d : 0;
        const midi = 12 * Math.log2(((k + off) * binHz) / 440) + 69;
        chroma[((Math.round(midi) % 12) + 12) % 12] += Math.sqrt(b);
      }
    }
  }
  const combined = chroma;
  const scores = [];
  for (let root = 0; root < 12; root++) {
    const maj = [], min = [];
    for (let i = 0; i < 12; i++) { maj.push(MAJOR[(i - root + 12) % 12]); min.push(MINOR[(i - root + 12) % 12]); }
    scores.push({ s: corr(combined, maj), root, minor: false });
    scores.push({ s: corr(combined, min), root, minor: true });
  }
  scores.sort((p, q) => q.s - p.s);
  const cam = (e) => (e.minor ? CAM_MIN[e.root] : CAM_MAJ[e.root]);
  const top = scores[0];
  // sound profile: share of energy per band, square-rooted so quiet highs still count
  let tot = 0; const tb = Array.from(band, (v) => Math.sqrt(v / n)); for (const v of tb) tot += v;
  const timbre = tb.map((v) => Math.round(v / (tot + 1e-12) * 1000) / 1000);
  return {
    camelot: cam(top), name: NAMES[top.root] + (top.minor ? ' minor' : ' major'), alt: cam(scores[1]),
    confidence: clamp((top.s - scores[1].s) * 6 + 0.35, 0, 1),
    centroid: centroidCount ? centroidSum / centroidCount : 0, timbre,
  };
}

/* ---- loudness, intro / outro from per-second RMS ---- */
function loudnessFromRms(rms) {
  const count = Math.max(1, rms.length);
  let sq = 0, m = 0;
  for (const v of rms) { sq += v * v; m += v; }
  m /= count;
  let sd = 0; for (const v of rms) sd += (v - m) * (v - m);
  const sorted = Array.from(rms).sort((x, y) => x - y);
  const ref = sorted[Math.floor(sorted.length * 0.75)] || 1e-6;
  let intro = 0; while (intro < count - 1 && rms[intro] < ref * 0.6) intro++;
  let outro = 0; while (outro < count - 1 && rms[count - 1 - outro] < ref * 0.6) outro++;
  const avg = (a, b) => { let s = 0, c = 0; for (let i = Math.max(0, a); i < Math.min(count, b); i++) { s += rms[i]; c++; } return c ? s / c : 0; };
  return {
    meanRms: Math.sqrt(sq / count), intro, outro, dynamic: Math.sqrt(sd / count) / (m + 1e-9),
    introLevel: clamp(avg(0, 24) / ref, 0, 1.5), outroLevel: clamp(avg(count - 24, count) / ref, 0, 1.5),
  };
}

function analyze(seg, rmsSec, wave) {
  const { env, fps } = onsetEnvelope(seg);
  const tempo = tempoWithStability(env, fps);
  const key = estimateKey(seg);
  const loud = loudnessFromRms(rmsSec);

  const rmsDb = 20 * Math.log10(loud.meanRms + 1e-9);
  const loudScore = clamp((rmsDb + 32) / 22, 0, 1);
  const bright = clamp((key.centroid - 500) / 2500, 0, 1);
  const bass = key.timbre[0] + key.timbre[1] + key.timbre[2];
  const bassScore = clamp(bass / 0.55, 0, 1);
  const energy = clamp(1 + 9 * (0.45 * loudScore + 0.20 * bright + 0.15 * bassScore + 0.20 * tempo.strength), 1, 10);

  const bpm = tempo.bpm;
  const tempoFit = bpm ? clamp(1 - Math.abs(bpm - 120) / 50, 0, 1) : 0;
  const dance = clamp(0.25 + 0.5 * tempo.strength + 0.25 * tempoFit, 0, 1);

  // mixability: how easy is this track to blend, and why
  const beat = clamp(0.5 * tempo.confidence + 0.5 * tempo.strength, 0, 1);
  const room = 0.3 + 0.7 * (0.5 * clamp(loud.intro / 24, 0, 1) + 0.5 * clamp(loud.outro / 24, 0, 1));
  const keyClear = key.confidence;
  const steady = 1 - clamp((loud.dynamic - 0.15) / 0.6, 0, 1);
  const zone = bpm ? 1 - clamp((Math.abs(bpm - 118) - 30) / 40, 0, 1) : 0;
  const mix = 100 * (0.36 * beat + 0.24 * room + 0.14 * keyClear + 0.14 * steady + 0.12 * zone);
  const r2 = (v) => Math.round(v * 100) / 100;

  return {
    aver: 2,
    bpm, bpmConfidence: r2(tempo.confidence), bpmStability: r2(tempo.stability),
    key: key.camelot, keyName: key.name, keyAlt: key.alt, keyConfidence: r2(key.confidence),
    energy: r2(energy), danceability: Math.round(dance * 1000) / 1000,
    mixability: Math.round(mix * 10) / 10,
    mixParts: { beat: r2(beat), room: r2(room), key: r2(keyClear), steady: r2(steady), zone: r2(zone) },
    loudness: Math.round(rmsDb * 10) / 10,
    intro: loud.intro, outro: loud.outro, introLevel: r2(loud.introLevel), outroLevel: r2(loud.outroLevel),
    timbre: key.timbre, bass: r2(bass), bright: r2(bright),
    wave,
  };
}

self.onmessage = (e) => {
  const { id, samples, rms, wave } = e.data;
  try { self.postMessage({ id, result: analyze(samples, rms, wave) }); }
  catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};
