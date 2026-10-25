/* ===========================================================
   Hore-Hore Film — bootstrap API
   Dimuat SEBELUM app.js. Menguji endpoint mana yang benar-benar
   menjawab JSON (redirect /api/* di Netlify belum tentu aktif),
   lalu menambal window.fetch agar semua permintaan /api/<x>
   otomatis diarahkan ke basis yang terbukti bekerja:
     - /api/<x>                     (server lokal / redirect Netlify)
     - /.netlify/functions/<x>      (function berbasis file)
     - /<x>                         (function di root)
   Hasilnya disimpan di sessionStorage agar tidak diuji ulang.
   =========================================================== */
(() => {
  'use strict';

  const KEY = 'hhf:apiBase';
  const BASES = {
    api: (p, qs) => `/api/${p}${qs}`,
    fn: (p, qs) => `/.netlify/functions/${p}${qs}`,
    root: (p, qs) => `/${p}${qs}`,
  };
  const ORDER = ['api', 'fn', 'root'];

  const originalFetch = window.fetch.bind(window);
  let resolved = null; // 'api' | 'fn' | 'root' | null
  let ready = null;

  try {
    const saved = sessionStorage.getItem(KEY);
    if (saved && BASES[saved]) resolved = saved;
  } catch (e) {}

  async function probe(base, timeout = 7000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await originalFetch(BASES[base]('health', ''), {
        headers: { Accept: 'application/json' },
        signal: ctrl.signal,
        cache: 'no-store',
      });
      const ctype = res.headers.get('content-type') || '';
      if (!res.ok || !ctype.includes('json')) return false;
      const body = await res.json();
      return !!(body && body.ok);
    } catch (e) {
      return false;
    } finally {
      clearTimeout(t);
    }
  }

  async function resolveBase() {
    if (resolved) return resolved;
    for (const base of ORDER) {
      // eslint-disable-next-line no-await-in-loop
      if (await probe(base)) {
        resolved = base;
        try {
          sessionStorage.setItem(KEY, base);
        } catch (e) {}
        return resolved;
      }
    }
    resolved = 'api'; // fallback terakhir: biar error aslinya tetap terlihat
    return resolved;
  }

  // Mulai deteksi secepat mungkin, jangan blokir halaman.
  ready = resolveBase();

  const isApi = (url) => /^\/api\//.test(url);
  const toPath = (url) => url.replace(/^\/api\//, '');

  window.fetch = async function patchedFetch(input, init) {
    const url = typeof input === 'string' ? input : input && input.url;
    if (!url || !isApi(url)) return originalFetch(input, init);

    const [rawPath, rawQs = ''] = toPath(url).split('?');
    const qs = rawQs ? '?' + rawQs : '';
    const base = await ready;

    // kalau basis 'api' sendiri yang dipakai, tidak perlu ditambal
    if (base === 'api') return originalFetch(input, init);

    let lastResponse = null;
    for (const candidate of [base, ...ORDER.filter((b) => b !== base && b !== 'api')]) {
      const target = BASES[candidate](rawPath, qs);
      // eslint-disable-next-line no-await-in-loop
      const res = await originalFetch(target, init);
      const ctype = res.headers.get('content-type') || '';
      if (res.ok && ctype.includes('json')) {
        resolved = candidate;
        try {
          sessionStorage.setItem(KEY, candidate);
        } catch (e) {}
        return res;
      }
      lastResponse = res;
    }
    return lastResponse;
  };

  window.__hhfApiBase = () => resolved;
})();
