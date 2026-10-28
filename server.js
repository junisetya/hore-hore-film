/**
 * Hore-Hore Film — static server + proxy katalog.
 * Data katalog diambil dari Cinemeta (open addon), diproksikan lewat server ini
 * supaya tidak terkena CORS/rate-limit di browser dan hasilnya bisa di-cache.
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 4173);
const ROOT = path.join(__dirname, 'public');
const CINEMETA = 'https://v3-cinemeta.strem.io';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
};

/* ---------------------------- cache ------------------------------------ */
const cache = new Map(); // key -> { at, ttl, data }
const CACHE_MAX = 400;

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
    // buang entri paling tua
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  cache.set(key, { at: Date.now(), ttl, data });
}

function fetchJSON(url, depth = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': 'HoreHoreFilm/1.0 (+local)',
          Accept: 'application/json',
        },
        timeout: 12000,
      },
      (res) => {
        const { statusCode, headers } = res;
        if (statusCode >= 300 && statusCode < 400 && headers.location && depth < 3) {
          res.resume();
          const next = new URL(headers.location, url).toString();
          resolve(fetchJSON(next, depth + 1));
          return;
        }
        if (statusCode !== 200) {
          res.resume();
          reject(new Error('upstream ' + statusCode));
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(new Error('invalid json'));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/* ------------------------- normalisasi data ---------------------------- */
function splitList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean);
  return String(v)
    .split(/,\s*/)
    .filter(Boolean);
}

function normalizeMeta(m) {
  if (!m) return null;
  const id = m.imdb_id || m.id;
  const genre = splitList(m.genre || m.genres);
  const country = splitList(m.country);
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
    genre: genre,
    country,
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

function normalizeMetaPreview(m) {
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

/* ---------------------------- API routes ------------------------------- */
const CATALOG_TTL = 1000 * 60 * 60 * 3; // 3 jam
const META_TTL = 1000 * 60 * 60 * 12; // 12 jam

async function handleCatalog(q) {
  const type = q.get('type') === 'series' ? 'series' : 'movie';
  const catalog = (q.get('catalog') || 'top').replace(/[^a-zA-Z]/g, '');
  const genre = q.get('genre') || '';
  const year = q.get('year') || '';
  const skip = Math.max(0, parseInt(q.get('skip') || '0', 10) || 0);

  // Filter berdasarkan tahun rilis. Cinemeta tidak punya facet tahun pada katalog
  // "year" (itu hanya urutan rilis terbaru), jadi kita ambil beberapa halaman dan
  // saring di sisi server sesuai nilai `year`. Batasi 10 halaman (~200 judul)
  // per permintaan agar tetap responsif.
  if (/^\d{4}$/.test(year)) {
    const key = 'cat:year:' + type + ':' + year + ':' + skip;
    const cached = cacheGet(key);
    if (cached) return cached;

    const matched = [];
    let cursor = skip;
    let pageFull = false;
    for (let i = 0; i < 10 && matched.length < 20; i++) {
      const data = await fetchJSON(
        `${CINEMETA}/catalog/${type}/year/skip=${cursor}.json`
      );
      const page = (data.metas || []).map(normalizeMetaPreview).filter(Boolean);
      pageFull = page.length >= 20;
      for (const m of page) {
        if (String(m.year) === year && !matched.some((x) => x.id === m.id)) {
          matched.push(m);
        }
      }
      cursor += page.length;
      if (!pageFull) break;
    }

    const result = {
      metas: matched,
      hasMore: pageFull,
      nextSkip: cursor,
      year,
      type,
    };
    cacheSet(key, result, CATALOG_TTL);
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
  const metas = (data.metas || []).map(normalizeMetaPreview).filter(Boolean);
  const result = {
    metas,
    hasMore: metas.length >= 20,
    nextSkip: skip + metas.length,
    genre: genre || null,
    type,
  };
  cacheSet(key, result, CATALOG_TTL);
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

  // episode untuk series
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
  const result = meta;
  cacheSet(key, result, META_TTL);
  return result;
}

async function handleSearch(q) {
  const term = (q.get('q') || '').trim().slice(0, 80);
  const type = q.get('type') === 'series' ? 'series' : q.get('type') === 'all' ? 'all' : 'movie';
  if (!term) return { metas: [] };
  const key = 'search:' + type + ':' + term.toLowerCase();
  const cached = cacheGet(key);
  if (cached) return cached;

  const types = type === 'all' ? ['movie', 'series'] : [type];
  const results = await Promise.all(
    types.map((t) =>
      fetchJSON(
        `${CINEMETA}/catalog/${t}/top/search=${encodeURIComponent(term)}&skip=0.json`
      ).catch(() => ({ metas: [] }))
    )
  );
  const seen = new Set();
  const metas = [];
  for (const r of results) {
    for (const raw of r.metas || []) {
      const m = normalizeMetaPreview(raw);
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

  const file = path.join(__dirname, 'src', 'data', 'indonesia.json');
  try {
    const raw = await fs.promises.readFile(file, 'utf8');
    const data = JSON.parse(raw);
    const items = Array.isArray(data.items) ? data.items : [];
    const result = { total: items.length, items };
    cacheSet(key, result, 1000 * 60 * 60 * 24);
    return result;
  } catch (e) {
    return { total: 0, items: [] };
  }
}

/* ------------------------------ server -------------------------------- */
function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(ROOT, rel);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // SPA fallback
      const fallback = path.join(ROOT, 'index.html');
      fs.readFile(fallback, (e2, buf) => {
        if (e2) return res.writeHead(404).end('Not found');
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(buf);
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const isAsset = /\/(assets)\//.test(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': isAsset ? 'public, max-age=86400' : 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const { pathname, searchParams } = url;

  if (pathname.startsWith('/api/')) {
    try {
      if (pathname === '/api/catalog') return sendJSON(res, 200, await handleCatalog(searchParams));
      if (pathname === '/api/meta') return sendJSON(res, 200, await handleMeta(searchParams));
      if (pathname === '/api/search') return sendJSON(res, 200, await handleSearch(searchParams));
      if (pathname === '/api/indonesia') return sendJSON(res, 200, await handleIndonesia());
      if (pathname === '/api/health') return sendJSON(res, 200, { ok: true, time: Date.now() });
      return sendJSON(res, 404, { error: 'Endpoint tidak ditemukan' });
    } catch (err) {
      return sendJSON(res, 502, { error: String(err.message || err) });
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end('Method not allowed');
    return;
  }
  serveStatic(req, res, pathname);
});

/* Kalau port dipakai, coba port berikutnya (4174, 4175, ...) alih-alih crash. */
function listen(port, attemptsLeft = 12) {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`Port ${port} sedang dipakai, mencoba ${port + 1}…`);
      setTimeout(() => listen(port + 1, attemptsLeft - 1), 60);
      return;
    }
    console.error('Gagal menjalankan server:', err.message);
    process.exit(1);
  });
  server.listen(port, () => {
    console.log(`Hore-Hore Film siap di http://localhost:${port}`);
    if (port !== PORT) console.log(`(port ${PORT} sedang dipakai proses lain)`);
  });
}

listen(PORT);
