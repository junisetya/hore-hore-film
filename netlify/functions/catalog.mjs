// Netlify Function: katalog film/series. Tersedia di /catalog dan /.netlify/functions/catalog
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
  const type = q.get('type') === 'series' ? 'series' : 'movie';
  const catalog = (q.get('catalog') || 'top').replace(/[^a-zA-Z]/g, '');
  const genre = q.get('genre') || '';
  const skip = Math.max(0, parseInt(q.get('skip') || '0', 10) || 0);

  const parts = [];
  if (genre) parts.push('genre=' + encodeURIComponent(genre));
  parts.push('skip=' + skip);
  const url = `${CINEMETA}/catalog/${type}/${catalog}/${parts.join('&')}.json`;
  const key = url;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 1000 * 60 * 60 * 3) return json(200, hit.data);

  try {
    const data = await fetchJSON(url);
    const metas = (data.metas || []).map(preview).filter((m) => m && m.id);
    const result = { metas, hasMore: metas.length >= 20, nextSkip: skip + metas.length, genre: genre || null, type };
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
