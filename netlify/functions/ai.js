// Built-in AI proxy. Keeps the Gemini API key on the server so it never reaches the browser.
const HITS = new Map();
const LIMIT = +process.env.AI_LIMIT_PER_10_MIN || 20;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const json = (status, body) => ({ statusCode: status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod === 'GET') return json(200, { ok: !!process.env.GEMINI_API_KEY });
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!process.env.GEMINI_API_KEY) return json(503, { error: 'Built-in AI is not configured' });
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
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY }, body: JSON.stringify(body) });
    if (!r.ok) return json(r.status === 429 ? 429 : 502, { error: r.status === 429 ? 'The free AI quota is used up for now. Try again later.' : 'The AI service returned an error.' });
    const j = await r.json();
    const parts = (j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || [];
    const text = parts.filter((x) => x.text && !x.thought).map((x) => x.text).join('\n');
    return text ? json(200, { text }) : json(502, { error: 'The AI returned nothing.' });
  } catch { return json(502, { error: 'Could not reach the AI service.' }); }
};
