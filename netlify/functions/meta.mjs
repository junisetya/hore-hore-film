// Netlify Function: detail film/series. Tersedia di /meta dan /.netlify/functions/meta
const CINEMETA = 'https://v3-cinemeta.strem.io';
const cache = new Map();

const splitList = (v) => (!v ? [] : Array.isArray(v) ? v.filter(Boolean) : String(v).split(/,\s*/).filter(Boolean));

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
  const id = q.get('id') || '';
  if (!/^[a-zA-Z0-9]+$/.test(id)) return json(400, { error: 'id tidak valid' });

  const url = `${CINEMETA}/meta/${type}/${id}.json`;
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 1000 * 60 * 60 * 12) return json(200, hit.data);

  try {
    const data = await fetchJSON(url);
    const m = data.meta;
    if (!m) return json(502, { error: 'meta kosong' });
    const idm = m.imdb_id || m.id;
    const meta = {
      id: idm,
      type: m.type || type,
      name: m.name || 'Tanpa Judul',
      year: m.year || m.releaseInfo || '',
      released: m.released || null,
      description: m.description || '',
      genres: splitList(m.genre || m.genres),
      country: splitList(m.country),
      cast: splitList(m.cast).slice(0, 14),
      director: splitList(m.director),
      writer: splitList(m.writer),
      runtime: typeof m.runtime === 'string' ? parseInt(m.runtime, 10) || null : m.runtime || null,
      rating: parseFloat(m.imdbRating) || null,
      awards: m.awards || '',
      status: m.status || '',
      poster: `https://images.metahub.space/poster/medium/${idm}/img`,
      background: `https://images.metahub.space/background/medium/${idm}/img`,
      logo: `https://images.metahub.space/logo/medium/${idm}/img`,
      trailer: (m.trailers && m.trailers[0] && m.trailers[0].source) || null,
      imdb: idm.startsWith('tt') ? `https://www.imdb.com/title/${idm}/` : null,
    };

    meta.episodes = (m.videos || [])
      .filter((v) => v.season > 0 && v.number > 0)
      .map((v) => ({
        id: v.id,
        season: v.season,
        episode: v.number,
        name: v.name || `Episode ${v.number}`,
        description: v.description || v.overview || '',
        released: v.released || v.firstAired || null,
        rating: parseFloat(v.rating) || null,
        thumbnail: v.thumbnail || null,
        runtime: v.runtime || null,
      }))
      .sort((a, b) => a.season - b.season || a.episode - b.episode);
    meta.seasons = [...new Set(meta.episodes.map((e) => e.season))];

    cache.set(url, { at: Date.now(), data: meta });
    return json(200, meta);
  } catch (err) {
    return json(502, { error: String((err && err.message) || err) });
  }
};

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300, s-maxage=3600' },
  });
}
