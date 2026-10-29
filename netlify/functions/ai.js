// Built-in AI proxy. Keeps the Gemini API key on the server so it never reaches the browser.
// Set GEMINI_API_KEY in Netlify: Site configuration > Environment variables.
const HITS = new Map(); // best-effort per-IP limiter (resets when the function instance restarts)
const LIMIT = +process.env.AI_LIMIT_PER_10_MIN || 20;
// Google retires models often, so ask Google which fast models this key can use right now.
let MODEL_CACHE = { at: 0, list: [] };
async function pickModels() {
  if (Date.now() - MODEL_CACHE.at < 3600000 && MODEL_CACHE.list.length) return MODEL_CACHE.list;
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY } });
    if (!r.ok) return MODEL_CACHE.list;
    const j = await r.json();
    const ver = (n) => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]);
    const list = (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /^models\/gemini-[\d.]+-flash(-lite)?$/.test(m.name))
      .map((m) => m.name.replace('models/', ''))
      .sort((a, b) => ver(b) - ver(a) || (/lite/.test(a) ? 1 : 0) - (/lite/.test(b) ? 1 : 0));
    MODEL_CACHE = { at: Date.now(), list };
    return list;
  } catch { return MODEL_CACHE.list; }
}
const json = (status, body) => ({ statusCode: status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod === 'GET') return json(200, { ok: !!process.env.GEMINI_API_KEY });
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!process.env.GEMINI_API_KEY) return json(503, { error: 'Built-in AI is not configured' });
  // same-origin only
  const origin = event.headers.origin || '', host = event.headers.host || '';
  if (origin && !origin.endsWith('//' + host)) return json(403, { error: 'Forbidden' });
  const ip = (event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
  const now = Date.now(), arr = (HITS.get(ip) || []).filter((t) => now - t < 600000);
  if (arr.length >= LIMIT) return json(429, { error: 'Too many requests. Try again in a few minutes.' });
  arr.push(now); HITS.set(ip, arr);
  if (HITS.size > 5000) HITS.clear();
  let p; try { p = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Bad request' }); }
  const system = String(p.system || ''), user = String(p.user || '');
  if (!user || system.length + user.length > 60000) return json(400, { error: 'Request too large' });
  const maxTokens = Math.min(Math.max(+p.maxTokens || 1500, 100), 4000);
  const body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { maxOutputTokens: maxTokens + 1500, responseMimeType: 'application/json', temperature: 0.7 } };
  const models = [...new Set([process.env.GEMINI_MODEL, ...(await pickModels()), 'gemini-flash-latest'].filter(Boolean))].slice(0, 5);
  let last = null;
  try {
    for (const m of models) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY }, body: JSON.stringify(body) });
      if (r.ok) {
        const j = await r.json();
        const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
        const text = parts.filter((x) => x.text && !x.thought).map((x) => x.text).join('\n');
        return text ? json(200, { text }) : json(502, { error: 'The AI returned nothing. Try again.' });
      }
      let msg = ''; try { msg = (await r.json()).error.message; } catch { /* no body */ }
      last = { status: r.status, msg: String(msg).slice(0, 200) };
      if (r.status === 429) return json(429, { error: 'The free AI quota is used up for now. Try again later.' });
      if (r.status === 401 || r.status === 403 || (r.status === 400 && /api key/i.test(msg))) break; // a different model will not help
    }
    return json(502, { error: `The AI service returned an error (${last ? last.status + ': ' + last.msg : 'unknown'}).` });
  } catch { return json(502, { error: 'Could not reach the AI service.' }); }
};
