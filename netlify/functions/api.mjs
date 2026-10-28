// Netlify Function: proxy katalog (menggantikan server.js saat deploy di Netlify)
// Endpoint: /api/catalog, /api/meta, /api/search, /api/health

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

const CINEMETA = 'https://v3-cinemeta.strem.io';

const cache = new Map(); // key -> { at, ttl, data }
const CACHE_MAX = 200;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > hit.ttl) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function cacheSet(key, data, ttl) {
  if (cache.size > CACHE_MAX) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  cache.set(key, { at: Date.now(), ttl, data });
}

async function fetchJSON(url, depth = 0) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'HoreHoreFilm/1.0' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error('upstream ' + res.status);
    return await res.json();
  } catch (err) {
    if (depth < 2) return fetchJSON(url, depth + 1);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function splitList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  return String(v).split(/,\s*/).filter(Boolean);
}

function normalizeMeta(m) {
  if (!m) return null;
  const id = m.imdb_id || m.id;
  const genre = splitList(m.genre || m.genres);
  let runtime = null;
  if (typeof m.runtime === 'string') {
    const num = parseInt(m.runtime, 10);
    if (!Number.isNaN(num)) runtime = num;
  } else if (typeof m.runtime === 'number') {
    runtime = m.runtime;
  }
  return {
    id,
    type: m.type || 'movie',
    name: m.name || 'Tanpa Judul',
    year: m.year || m.releaseInfo || '',
    released: m.released || null,
    description: m.description || '',
    genres: genre,
    genre,
    country: splitList(m.country),
    cast: splitList(m.cast).slice(0, 14),
    director: splitList(m.director),
    writer: splitList(m.writer),
    runtime,
    rating: parseFloat(m.imdbRating) || null,
    awards: m.awards || '',
    status: m.status || '',
    poster: `https://images.metahub.space/poster/medium/${id}/img`,
    background: `https://images.metahub.space/background/medium/${id}/img`,
    logo: `https://images.metahub.space/logo/medium/${id}/img`,
    trailer: (m.trailers && m.trailers[0] && m.trailers[0].source) || null,
    imdb: id && id.startsWith('tt') ? `https://www.imdb.com/title/${id}/` : null,
  };
}

function metaPreview(m) {
  const base = normalizeMeta(m);
  if (!base) return null;
  return {
    id: base.id,
    type: base.type,
    name: base.name,
    year: base.year,
    rating: base.rating,
    poster: base.poster,
    background: base.background,
    genres: base.genres,
    description: base.description,
    runtime: base.runtime,
    country: base.country,
  };
}

async function handleCatalog(q) {
  const type = q.get('type') === 'series' ? 'series' : 'movie';
  const catalog = (q.get('catalog') || 'top').replace(/[^a-zA-Z]/g, '');
  const genre = q.get('genre') || '';
  const year = q.get('year') || '';
  const skip = Math.max(0, parseInt(q.get('skip') || '0', 10) || 0);

  // Filter berdasarkan tahun rilis (lihat keterangan lengkap di server.js).
  if (/^\d{4}$/.test(year)) {
    const key = 'cat:year:' + type + ':' + year + ':' + skip;
    const cached = cacheGet(key);
    if (cached) return cached;

    const matched = [];
    let cursor = skip;
    let pageFull = false;
    for (let i = 0; i < 10 && matched.length < 20; i++) {
      const data = await fetchJSON(`${CINEMETA}/catalog/${type}/year/skip=${cursor}.json`);
      const page = (data.metas || []).map(metaPreview).filter(Boolean);
      pageFull = page.length >= 20;
      for (const m of page) {
        if (String(m.year) === year && !matched.some((x) => x.id === m.id)) matched.push(m);
      }
      cursor += page.length;
      if (!pageFull) break;
    }

    const result = { metas: matched, hasMore: pageFull, nextSkip: cursor, year, type };
    cacheSet(key, result, 1000 * 60 * 60 * 3);
    return result;
  }

  const parts = [];
  if (genre) parts.push('genre=' + encodeURIComponent(genre));
  parts.push('skip=' + skip);
  const url = `${CINEMETA}/catalog/${type}/${catalog}/${parts.join('&')}.json`;
  const key = 'cat:' + url;
  const cached = cacheGet(key);
  if (cached) return cached;

  const data = await fetchJSON(url);
  const metas = (data.metas || []).map(metaPreview).filter(Boolean);
  const result = { metas, hasMore: metas.length >= 20, nextSkip: skip + metas.length, genre: genre || null, type };
  cacheSet(key, result, 1000 * 60 * 60 * 3);
  return result;
}

async function handleMeta(q) {
  const type = q.get('type') === 'series' ? 'series' : 'movie';
  const id = q.get('id') || '';
  if (!/^[a-zA-Z0-9]+$/.test(id)) throw new Error('id tidak valid');

  const url = `${CINEMETA}/meta/${type}/${id}.json`;
  const key = 'meta:' + url;
  const cached = cacheGet(key);
  if (cached) return cached;

  const data = await fetchJSON(url);
  const meta = normalizeMeta(data.meta);
  if (!meta) throw new Error('meta kosong');

  const episodes = (data.meta.videos || [])
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

  meta.episodes = episodes;
  meta.seasons = [...new Set(episodes.map((e) => e.season))];
  cacheSet(key, meta, 1000 * 60 * 60 * 12);
  return meta;
}

async function handleSearch(q) {
  const term = (q.get('q') || '').trim().slice(0, 80);
  const type = q.get('type') === 'movie' ? 'movie' : q.get('type') === 'series' ? 'series' : 'all';
  if (!term) return { metas: [] };
  const key = 'search:' + type + ':' + term.toLowerCase();
  const cached = cacheGet(key);
  if (cached) return cached;

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
      const m = metaPreview(raw);
      if (!m || seen.has(m.id)) continue;
      seen.add(m.id);
      metas.push(m);
    }
  }
  const result = { metas, query: term };
  cacheSet(key, result, 1000 * 60 * 30);
  return result;
}

async function handleIndonesia() {
  const key = 'indonesia:v1';
  const cached = cacheGet(key);
  if (cached) return cached;

  const file = join(HERE, '..', '..', 'src', 'data', 'indonesia.json');
  try {
    const raw = await readFile(file, 'utf8');
    const data = JSON.parse(raw);
    const items = Array.isArray(data.items) ? data.items : [];
    const result = { total: items.length, items };
    cacheSet(key, result, 1000 * 60 * 60 * 24);
    return result;
  } catch {
    return { total: 0, items: [] };
  }
}

const json = (status, obj) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=600',
    },
  });

export default async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\//, '').replace(/\/$/, '');
  const q = url.searchParams;
  try {
    if (path === 'catalog') return json(200, await handleCatalog(q));
    if (path === 'meta') return json(200, await handleMeta(q));
    if (path === 'search') return json(200, await handleSearch(q));
    if (path === 'indonesia') return json(200, await handleIndonesia());
    if (path === 'health') return json(200, { ok: true, time: Date.now() });
    return json(404, { error: 'Endpoint tidak ditemukan' });
  } catch (err) {
    return json(502, { error: String((err && err.message) || err) });
  }
};

export const config = { path: '/api/*' };
