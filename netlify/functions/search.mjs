// Netlify Function: pencarian. Tersedia di /search dan /.netlify/functions/search
const CINEMETA = 'https://v3-cinemeta.strem.io';
const cache = new Map();

const splitList = (v) => (!v ? [] : Array.isArray(v) ? v.filter(Boolean) : String(v).split(/,\s*/).filter(Boolean));

function preview(m) {
  const id = m.imdb_id || m.id;
  return {
    id,
    type: m.type || 'movie',
    name: m.name || 'Tanpa Judul',
    year: m.year || m.releaseInfo || '',
    rating: parseFloat(m.imdbRating) || null,
    poster: `https://images.metahub.space/poster/medium/${id}/img`,
    background: `https://images.metahub.space/background/medium/${id}/img`,
    genres: splitList(m.genre || m.genres),
    description: m.description || '',
    runtime: typeof m.runtime === 'string' ? parseInt(m.runtime, 10) || null : m.runtime || null,
    country: splitList(m.country),
  };
}

async function fetchJSON(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'HoreHoreFilm/1.0' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error('upstream ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

export default async (req) => {
  const q = new URL(req.url).searchParams;
  const term = (q.get('q') || '').trim().slice(0, 80);
  const type = q.get('type') === 'movie' ? 'movie' : q.get('type') === 'series' ? 'series' : 'all';
  if (!term) return json(200, { metas: [] });

  const key = type + ':' + term.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 1000 * 60 * 30) return json(200, hit.data);

  try {
    const types = type === 'all' ? ['movie', 'series'] : [type];
    const results = await Promise.all(
      types.map((t) =>
        fetchJSON(`${CINEMETA}/catalog/${t}/top/search=${encodeURIComponent(term)}&skip=0.json`).catch(() => ({ metas: [] }))
      )
    );
    const seen = new Set();
    const metas = [];
    for (const r of results) {
      for (const raw of r.metas || []) {
        const m = preview(raw);
        if (!m || !m.id || seen.has(m.id)) continue;
        seen.add(m.id);
        metas.push(m);
      }
    }
    const result = { metas, query: term };
    cache.set(key, { at: Date.now(), data: result });
    return json(200, result);
  } catch (err) {
    return json(502, { error: String((err && err.message) || err) });
  }
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=120, s-maxage=600' },
  });
}
