/* ===========================================================
   Hore-Hore Film — aplikasi (vanilla JS, hash router)
   =========================================================== */
(() => {
  'use strict';

  /* ------------------------------ konstanta ------------------------------ */
  const GENRES = [
    'Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime',
    'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror',
    'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western',
  ];

  const CATALOGS = {
    top: 'Populer',
    year: 'Terbaru',
    imdbRating: 'Rating Tertinggi',
  };

  const YEARS = (() => {
    const now = new Date().getFullYear();
    const list = [];
    for (let y = now; y >= 1950; y--) list.push(y);
    return list;
  })();

  // Penyedia pemutaran. Semua memakai iframe, dan sebagian memasang iklan/popup
  // lewat window.open. Karena itu iframe diberi sandbox tanpa allow-popups.
  // `hidden: true` = masih tersedia sebagai cadangan otomatis, tapi tidak ditampilkan
  // sebagai pilihan di bar sumber.
  const STREAM_PROVIDERS = [
    {
      id: '2embed',
      name: '2Embed',
      sandbox: true,
      movie: (id) => `https://www.2embed.cc/embed/${id}`,
      tv: (id, s, e) => `https://www.2embed.cc/embedtv/${id}&s=${s}&e=${e}`,
    },
    {
      id: 'vidlink',
      name: 'VidLink',
      sandbox: true,
      hidden: true,
      movie: (id) => `https://vidlink.pro/movie/${id}`,
      tv: (id, s, e) => `https://vidlink.pro/tv/${id}/${s}/${e}`,
    },
    {
      id: 'vsembed',
      name: 'VSEmbed',
      sandbox: true,
      hidden: true,
      movie: (id) => `https://vsembed.ru/embed/movie/${id}/`,
      tv: (id, s, e) => `https://vsembed.ru/embed/tv/${id}/${s}/${e}/`,
    },
    {
      id: 'vidsrc',
      name: 'VidSrc',
      sandbox: false, // pemutar ini menolak berjalan di dalam iframe sandbox
      hidden: true,
      movie: (id) => `https://vidsrc.to/embed/movie/${id}`,
      tv: (id, s, e) => `https://vidsrc.to/embed/tv/${id}/${s}/${e}`,
    },
  ];

  // Sumber yang ditampilkan ke pengguna (sekarang hanya 2Embed).
  const VISIBLE_PROVIDERS = STREAM_PROVIDERS.filter((p) => !p.hidden);
  const DEFAULT_PROVIDER = VISIBLE_PROVIDERS[0].id;

  // Sandbox ketat: tanpa allow-popups -> window.open / target=_blank diblokir browser,
  // jadi iklan tidak bisa membuka tab baru.
  const SANDBOX = 'allow-scripts allow-same-origin allow-forms allow-presentation allow-orientation-lock';

  /* ------------------------------ util ------------------------------ */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const esc = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem('hhf:' + key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) {
        return fallback;
      }
    },
    set(key, val) {
      try {
        localStorage.setItem('hhf:' + key, JSON.stringify(val));
      } catch (e) {
        /* penuh / private mode */
      }
    },
  };

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  // Basis API: `/api/*` (server lokal / redirect Netlify). Kalau itu tidak tersedia,
  // jatuh ke Netlify Function berbasis file (`/catalog`, `/meta`, `/search`, `/health`).
  let apiBase = null; // null = belum diketahui, 'api' | 'fn' | 'root'

  async function fetchWithFallback(path, qs) {
    const bases = apiBase ? [apiBase] : ['api', 'fn', 'root'];
    let lastErr = null;
    for (const base of bases) {
      // 'api' = proxy /api/*, 'fn' = /.netlify/functions/<nama>, 'root' = /<nama>
      const url =
        base === 'api'
          ? `/api/${path}${qs}`
          : base === 'fn'
            ? `/.netlify/functions/${path}${qs}`
            : `/${path}${qs}`;
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        const ctype = res.headers.get('content-type') || '';
        // Redirect SPA mengembalikan HTML (bukan JSON) -> anggap endpoint tidak ada
        if (!ctype.includes('json')) throw new Error('endpoint tidak tersedia (' + res.status + ')');
        if (!res.ok) {
          let msg = 'Gagal memuat data (' + res.status + ')';
          try {
            const j = await res.json();
            if (j && j.error) msg = j.error;
          } catch (e) {}
          throw new Error(msg);
        }
        apiBase = base;
        return await res.json();
      } catch (err) {
        lastErr = err;
      }
    }
    apiBase = null;
    throw lastErr || new Error('Gagal memuat data');
  }

  async function api(path, params) {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return fetchWithFallback(path, qs);
  }

  /* ------------------------------ watchlist & riwayat ------------------------------ */
  const Watchlist = {
    all: () => store.get('watchlist', []),
    has(id) {
      return this.all().some((x) => x.id === id);
    },
    add(item) {
      const list = this.all().filter((x) => x.id !== item.id);
      list.unshift({ ...item, addedAt: Date.now() });
      store.set('watchlist', list.slice(0, 300));
      renderWatchlistCount();
    },
    remove(id) {
      store.set('watchlist', this.all().filter((x) => x.id !== id));
      renderWatchlistCount();
    },
    toggle(item) {
      if (this.has(item.id)) {
        this.remove(item.id);
        return false;
      }
      this.add(item);
      return true;
    },
  };

  const History = {
    all: () => store.get('history', []),
    push(item) {
      const list = this.all().filter((x) => x.id !== item.id);
      list.unshift({ ...item, watchedAt: Date.now() });
      store.set('history', list.slice(0, 80));
    },
    clear() {
      store.set('history', []);
    },
  };

  function renderWatchlistCount() {
    const el = $('#watchlistCount');
    const n = Watchlist.all().length;
    el.textContent = n;
    el.hidden = n === 0;
  }

  /* ------------------------------ komponen ------------------------------ */
  function posterImg(src, alt, cls = '') {
    return `<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async" class="${cls}"
      onload="this.classList.add('loaded')" onerror="this.style.opacity=0.15;this.classList.add('loaded')" />`;
  }

  function cardHTML(item, opts = {}) {
    const isSeries = item.type === 'series';
    const rating = item.rating ? `<span class="star">★ ${item.rating.toFixed(1)}</span>` : '';
    const year = item.year ? `<span>${esc(item.year)}</span>` : '';
    return `<a class="card" href="#/${isSeries ? 'series' : 'film'}/${encodeURIComponent(item.id)}">
      <div class="card-poster">
        ${posterImg(item.poster, item.name)}
        <span class="card-badge ${isSeries ? 'series' : ''}">${isSeries ? 'SERIES' : 'FILM'}</span>
        <span class="card-play"><span><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span></span>
        ${opts.removable ? `<button class="card-remove" data-remove="${esc(item.id)}" aria-label="Hapus dari watchlist"><svg viewBox="0 0 24 24"><path d="M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3l6.3 6.3 6.3-6.3 1.4 1.4Z"/></svg></button>` : ''}
      </div>
      <div class="card-body">
        <h3 class="card-title">${esc(item.name)}</h3>
        <p class="card-sub">${year}${rating ? '<span class="sep">·</span>' : ''}${rating}</p>
      </div>
    </a>`;
  }

  function skeletonGrid(n = 12, cls = 'grid') {
    return `<div class="${cls}">${Array.from({ length: n })
      .map(
        () => `<div class="card sk-card"><div class="sk sk-poster"></div><div class="sk sk-line"></div><div class="sk sk-line short"></div></div>`
      )
      .join('')}</div>`;
  }

  function sectionHead(title, count, linkHref, linkText) {
    return `<div class="section-head">
      <h2>${esc(title)}${count != null ? `<span class="count">${count}</span>` : ''}</h2>
      ${linkHref ? `<a class="link" href="${linkHref}">${esc(linkText || 'Lihat Semua')} →</a>` : ''}
    </div>`;
  }

  function errorHTML(msg) {
    return `<div class="errorbox">⚠ ${esc(msg)}</div>`;
  }

  function emptyHTML(title, text, ctaHref, ctaText) {
    return `<div class="empty">
      <h3>${esc(title)}</h3>
      <p>${esc(text)}</p>
      ${ctaHref ? `<a class="btn" href="${ctaHref}">${esc(ctaText || 'Jelajahi')}</a>` : ''}
    </div>`;
  }

  /* ------------------------------ state ------------------------------ */
  const state = {
    heroItems: [],
    heroIndex: 0,
    heroTimer: null,
  };

  function stopHeroTimer() {
    if (state.heroTimer) {
      clearInterval(state.heroTimer);
      state.heroTimer = null;
    }
  }

  /* ------------------------------ hero ------------------------------ */
  function renderHero(container, items) {
    if (!items.length) return;
    state.heroItems = items;
    state.heroIndex = 0;

    container.innerHTML = `<div class="hero" id="hero">
      <div class="hero-bg" id="heroBg"></div>
      <div class="hero-inner" id="heroInner"></div>
      <div class="hero-dots" id="heroDots">
        ${items.map((_, i) => `<button data-hero="${i}" aria-label="Slide ${i + 1}" class="${i === 0 ? 'active' : ''}"></button>`).join('')}
      </div>
    </div>`;

    const paint = (i) => {
      const m = items[i];
      if (!m) return;
      const bg = $('#heroBg');
      const pre = new Image();
      pre.onload = () => (bg.style.backgroundImage = `url("${m.background}")`);
      pre.onerror = () => (bg.style.backgroundImage = `url("${m.poster}")`);
      pre.src = m.background;

      const genre = (m.genres || []).slice(0, 3).join(' • ');
      $('#heroInner').innerHTML = `
        <span class="hero-tag">★ ${m.rating ? m.rating.toFixed(1) : 'Baru'} · ${m.type === 'series' ? 'Series' : 'Film'}</span>
        <h1 class="hero-title">${esc(m.name)}</h1>
        <div class="hero-meta">
          <span>${esc(m.year || '')}</span>
          ${genre ? `<span class="sep">·</span><span>${esc(genre)}</span>` : ''}
          ${m.runtime ? `<span class="sep">·</span><span>${m.runtime} menit</span>` : ''}
          ${m.country && m.country[0] ? `<span class="sep">·</span><span>${esc(m.country[0])}</span>` : ''}
        </div>
        <p class="hero-desc">${esc(m.description || 'Sinopsis belum tersedia.')}</p>
        <div class="hero-actions">
          <a class="btn" href="#/${m.type === 'series' ? 'series' : 'film'}/${encodeURIComponent(m.id)}">
            <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg> Tonton Sekarang
          </a>
          <button class="btn ghost" data-hero-watch="${esc(m.id)}">
            <svg viewBox="0 0 24 24"><path d="M12 3a1 1 0 0 1 1 1v7h7a1 1 0 1 1 0 2h-7v7a1 1 0 1 1-2 0v-7H4a1 1 0 1 1 0-2h7V4a1 1 0 0 1 1-1Z"/></svg>
            Watchlist
          </button>
        </div>`;
      $$('#heroDots button').forEach((b, bi) => b.classList.toggle('active', bi === i));
      state.heroIndex = i;
    };

    paint(0);
    stopHeroTimer();
    state.heroTimer = setInterval(() => {
      const next = (state.heroIndex + 1) % state.heroItems.length;
      paint(next);
    }, 7000);

    $('#heroDots').addEventListener('click', (e) => {
      const b = e.target.closest('[data-hero]');
      if (!b) return;
      stopHeroTimer();
      paint(Number(b.dataset.hero));
      state.heroTimer = setInterval(() => {
        paint((state.heroIndex + 1) % state.heroItems.length);
      }, 7000);
    });

    $('#hero').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-hero-watch]');
      if (!btn) return;
      e.preventDefault();
      const m = items.find((x) => x.id === btn.dataset.heroWatch);
      if (!m) return;
      const added = Watchlist.toggle(m);
      toast(added ? 'Ditambahkan ke watchlist' : 'Dihapus dari watchlist');
    });
  }

  /* ------------------------------ halaman: home ------------------------------ */
  async function pageHome(view) {
    document.title = 'Hore-Hore Film — Nonton Film & Series';
    view.innerHTML = `
      <div id="heroWrap"></div>
      <section class="section" id="secIndonesia">${sectionHead('Film Indonesia 🇮🇩', null, '#/indonesia')}${skeletonGrid(12)}</section>
      <section class="section" id="secPopuler">${sectionHead('Film Populer', null, '#/films')}${skeletonGrid(12)}</section>
      <section class="section" id="secTerbaru">${sectionHead('Baru Ditambahkan', null, '#/films?catalog=year')}${skeletonGrid(12)}</section>
      <section class="section" id="secSeries">${sectionHead('Series Pilihan', null, '#/series')}${skeletonGrid(12)}</section>
      <section class="section" id="secTop">${sectionHead('Rating Tertinggi', null, '#/films?catalog=imdbRating')}${skeletonGrid(12)}</section>
      <section class="section" id="secHorror">${sectionHead('Lagi Horor?', null, '#/genre/Horror')}${skeletonGrid(12)}</section>`;

    const load = async (id, params, href, linkText, title) => {
      const box = $('#' + id);
      try {
        const data = await api('catalog', params);
        box.innerHTML =
          sectionHead(title, data.metas.length, href, linkText) +
          `<div class="grid">${data.metas.map((m) => cardHTML(m)).join('')}</div>`;
      } catch (err) {
        box.innerHTML = sectionHead(title) + errorHTML(err.message);
      }
    };

    // hero + populer
    try {
      const pop = await api('catalog', { type: 'movie', catalog: 'top', skip: 0 });
      const heroItems = pop.metas.filter((m) => m.background).slice(0, 5);
      renderHero($('#heroWrap'), heroItems.length ? heroItems : pop.metas.slice(0, 5));
      $('#secPopuler').innerHTML =
        sectionHead('Film Populer', pop.metas.length, '#/films') +
        `<div class="grid">${pop.metas.map((m) => cardHTML(m)).join('')}</div>`;
    } catch (err) {
      $('#heroWrap').innerHTML = errorHTML(err.message);
      $('#secPopuler').innerHTML = errorHTML(err.message);
    }

    load('secTerbaru', { type: 'movie', catalog: 'year', skip: 0 }, '#/films?catalog=year', 'Lihat Semua', 'Baru Ditambahkan');
    load('secSeries', { type: 'series', catalog: 'top', skip: 0 }, '#/series', 'Lihat Semua', 'Series Pilihan');
    load('secTop', { type: 'movie', catalog: 'imdbRating', skip: 0 }, '#/films?catalog=imdbRating', 'Lihat Semua', 'Rating Tertinggi');
    load('secHorror', { type: 'movie', catalog: 'top', genre: 'Horror', skip: 0 }, '#/genre/Horror', 'Lihat Semua', 'Lagi Horor?');

    // Baris khusus Indonesia (paling atas setelah hero)
    loadIndonesia($('#secIndonesia'));

    // lanjut menonton
    const hist = History.all().slice(0, 12);
    if (hist.length) {
      const el = document.createElement('section');
      el.className = 'section';
      el.innerHTML =
        sectionHead('Lanjut Menonton', null, '#/riwayat', 'Riwayat') +
        `<div class="grid dense">${hist.map((m) => cardHTML(m)).join('')}</div>`;
      view.insertBefore(el, $('#secTerbaru'));
    }
  }

  /* ------------------------------ halaman: browse ------------------------------ */
  /* ------------------------------ film indonesia ------------------------------ */
  let indonesiaCache = null;

  async function getIndonesia() {
    if (indonesiaCache) return indonesiaCache;
    const cached = store.get('indonesia', null);
    if (cached && Array.isArray(cached.items) && Date.now() - cached.at < 1000 * 60 * 60 * 24) {
      indonesiaCache = cached.items;
      return indonesiaCache;
    }
    try {
      const data = await api('indonesia', null);
      const items = (data.items || []).map((m) => ({ ...m, type: 'movie' }));
      indonesiaCache = items;
      store.set('indonesia', { at: Date.now(), items });
      return items;
    } catch (err) {
      if (cached && cached.items) return cached.items;
      throw err;
    }
  }

  // Urutkan: yang populer & berating lebih dulu, sisanya acak ringan supaya tidak monoton
  function indonesiaPicks(items, n) {
    const score = (m) => (m.popularity || 0) * 2 + (m.rating || 0) + (parseInt(m.year, 10) >= 2015 ? 2 : 0);
    const top = items.filter((m) => m.rating >= 6 || score(m) > 6).sort((a, b) => score(b) - score(a));
    const rest = items.filter((m) => !top.includes(m)).sort(() => Math.random() - 0.5);
    return top.slice(0, n - 4).concat(rest.slice(0, 4));
  }

  async function loadIndonesia(box) {
    if (!box) return;
    try {
      const items = await getIndonesia();
      if (!items.length) {
        box.innerHTML = sectionHead('Film Indonesia 🇮🇩');
        box.hidden = true;
        return;
      }
      const picks = indonesiaPicks(items, 14);
      box.innerHTML =
        sectionHead('Film Indonesia 🇮🇩', items.length, '#/indonesia', 'Lihat Semua') +
        `<div class="hrow">${picks.map((m) => cardHTML(m)).join('')}</div>`;
    } catch (err) {
      box.innerHTML = sectionHead('Film Indonesia 🇮🇩') + errorHTML(err.message);
    }
  }

  async function pageIndonesia(view) {
    document.title = 'Film Indonesia — Hore-Hore Film';
    view.innerHTML = `
      <div class="breadcrumb"><a href="#/">Home</a><span>/</span><span>Film Indonesia</span></div>
      ${sectionHead('Film Indonesia 🇮🇩')}
      <div class="filterbar">
        <div class="segmented" id="idSort">
          <button class="active" data-sort="populer">Populer</button>
          <button data-sort="rating">Rating</button>
          <button data-sort="baru">Terbaru</button>
        </div>
        <select class="select" id="idGenre" aria-label="Genre"><option value="">Semua Genre</option></select>
      </div>
      <div id="idResults">${skeletonGrid(18)}</div>`;

    let items;
    try {
      items = await getIndonesia();
    } catch (err) {
      $('#idResults').innerHTML = errorHTML(err.message);
      return;
    }

    const genreSet = [...new Set(items.flatMap((m) => m.genres || []))].sort();
    $('#idGenre').innerHTML =
      '<option value="">Semua Genre</option>' +
      genreSet.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('');

    let sort = 'populer';
    let genre = '';

    const paint = () => {
      let list = items.slice();
      if (genre) list = list.filter((m) => (m.genres || []).includes(genre));
      if (sort === 'rating') list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
      else if (sort === 'baru') list.sort((a, b) => parseInt(b.year || 0, 10) - parseInt(a.year || 0, 10));
      else list.sort((a, b) => (b.popularity || 0) - (a.popularity || 0) || (b.rating || 0) - (a.rating || 0));

      $('#idResults').innerHTML = list.length
        ? `<div class="grid">${list.map((m) => cardHTML(m)).join('')}</div>`
        : emptyHTML('Belum ada judul', 'Coba pilih genre lain.', '#/indonesia', 'Reset');
    };

    $('#idSort').addEventListener('click', (e) => {
      const b = e.target.closest('[data-sort]');
      if (!b) return;
      sort = b.dataset.sort;
      $$('#idSort button').forEach((x) => x.classList.toggle('active', x === b));
      paint();
    });
    $('#idGenre').addEventListener('change', (e) => {
      genre = e.target.value;
      paint();
    });

    paint();
  }

  async function pageBrowse(view, { type, catalog = 'top', genre = '', year = '' }) {
    const isSeries = type === 'series';
    const label = isSeries ? 'Series' : 'Film';
    document.title = `${genre ? genre + ' ' : ''}${label} — Hore-Hore Film`;

    view.innerHTML = `
      <div class="breadcrumb"><a href="#/">Home</a><span>/</span><span>${esc(label)}</span></div>
      ${sectionHead(genre ? `${label} ${genre}` : isSeries ? 'Semua Series' : 'Semua Film')}
      <div class="filterbar">
        <div class="segmented" id="typeSwitch">
          <button data-type="movie" class="${!isSeries ? 'active' : ''}">Film</button>
          <button data-type="series" class="${isSeries ? 'active' : ''}">Series</button>
        </div>
        <select class="select" id="catalogSel" aria-label="Urutkan">
          ${Object.entries(CATALOGS)
            .map(([k, v]) => `<option value="${k}" ${k === catalog ? 'selected' : ''}>${v}</option>`)
            .join('')}
        </select>
        <select class="select" id="genreSel" aria-label="Genre">
          <option value="">Semua Genre</option>
          ${GENRES.map((g) => `<option value="${esc(g)}" ${g === genre ? 'selected' : ''}>${esc(g)}</option>`).join('')}
        </select>
      </div>
      <div id="results">${skeletonGrid(18)}</div>
      <div class="loadmore-wrap" id="loadMoreWrap"></div>`;

    const qs = () => {
      const p = new URLSearchParams();
      if (catalog !== 'top') p.set('catalog', catalog);
      if (genre) p.set('genre', genre);
      if (year) p.set('year', year);
      return p.toString();
    };
    const go = () => {
      location.hash = `#/${isSeries ? 'series' : 'films'}${qs() ? '?' + qs() : ''}`;
    };

    $('#typeSwitch').addEventListener('click', (e) => {
      const b = e.target.closest('[data-type]');
      if (!b || b.dataset.type === type) return;
      location.hash = `#/${b.dataset.type === 'series' ? 'series' : 'films'}${qs() ? '?' + qs() : ''}`;
    });
    $('#catalogSel').addEventListener('change', (e) => {
      catalog = e.target.value;
      go();
    });
    $('#genreSel').addEventListener('change', (e) => {
      genre = e.target.value;
      go();
    });

    const results = $('#results');
    let skip = 0;
    let loaded = [];
    let busy = false;
    let done = false;

    const render = () => {
      results.innerHTML = loaded.length
        ? `<div class="grid">${loaded.map((m) => cardHTML(m)).join('')}</div>`
        : emptyHTML('Belum ada hasil', 'Coba ganti genre atau urutan katalog.', '#/films', 'Reset');
      const wrap = $('#loadMoreWrap');
      wrap.innerHTML = done
        ? loaded.length > 20
          ? `<span class="muted" style="font-size:12.5px">— semua ${loaded.length} judul sudah tampil —</span>`
          : ''
        : `<button class="btn ghost" id="loadMore">Muat Lebih Banyak</button>`;
      const btn = $('#loadMore');
      if (btn) btn.onclick = () => loadPage();
    };

    const loadPage = async () => {
      if (busy || done) return;
      busy = true;
      const btn = $('#loadMore');
      if (btn) btn.textContent = 'Memuat…';
      try {
        const data = await api('catalog', { type, catalog, genre, skip });
        const fresh = data.metas.filter((m) => !loaded.some((x) => x.id === m.id));
        loaded = loaded.concat(fresh);
        skip = data.nextSkip;
        if (!data.hasMore || data.metas.length < 20 || fresh.length === 0) done = true;
        render();
      } catch (err) {
        results.innerHTML = errorHTML(err.message);
      } finally {
        busy = false;
      }
    };

    await loadPage();
  }

  /* ------------------------------ halaman: genre ------------------------------ */
  async function pageGenres(view) {
    document.title = 'Genre Film — Hore-Hore Film';
    view.innerHTML = `
      <div class="breadcrumb"><a href="#/">Home</a><span>/</span><span>Genre</span></div>
      ${sectionHead('Jelajahi Genre')}
      <div class="yeargrid" style="grid-template-columns:repeat(auto-fill,minmax(140px,1fr))">
        ${GENRES.map((g) => `<a href="#/genre/${encodeURIComponent(g)}">${esc(g)}</a>`).join('')}
      </div>`;
  }

  /* ------------------------------ halaman: tahun ------------------------------ */
  async function pageYears(view) {
    document.title = 'Film Berdasarkan Tahun — Hore-Hore Film';
    view.innerHTML = `
      <div class="breadcrumb"><a href="#/">Home</a><span>/</span><span>Tahun</span></div>
      ${sectionHead('Film Berdasarkan Tahun')}
      <div class="yeargrid">
        ${YEARS.map((y) => `<a href="#/tahun/${y}">${y}</a>`).join('')}
      </div>`;
  }

  async function pageYear(view, year) {
    document.title = `Film ${year} — Hore-Hore Film`;
    view.innerHTML = `
      <div class="breadcrumb"><a href="#/">Home</a><span>/</span><a href="#/tahun">Tahun</a><span>/</span><span>${esc(year)}</span></div>
      ${sectionHead(`Film Rilis ${year}`)}
      <div id="results">${skeletonGrid(18)}</div>
      <div class="loadmore-wrap" id="loadMoreWrap"></div>`;

    const results = $('#results');
    let skip = 0;
    let loaded = [];
    let busy = false;
    let done = false;

    const render = () => {
      results.innerHTML = loaded.length
        ? `<div class="grid">${loaded.map((m) => cardHTML(m)).join('')}</div>`
        : emptyHTML('Tidak ada film', `Belum ada judul yang cocok untuk tahun ${year}.`, '#/tahun', 'Pilih tahun lain');
      const wrap = $('#loadMoreWrap');
      wrap.innerHTML = done ? '' : `<button class="btn ghost" id="loadMore">Muat Lebih Banyak</button>`;
      const btn = $('#loadMore');
      if (btn) btn.onclick = loadPage;
    };

    const loadPage = async () => {
      if (busy || done) return;
      busy = true;
      const btn = $('#loadMore');
      if (btn) btn.textContent = 'Memuat…';
      try {
        const data = await api('catalog', { type: 'movie', catalog: 'year', genre: year, skip });
        const fresh = data.metas.filter((m) => !loaded.some((x) => x.id === m.id));
        loaded = loaded.concat(fresh);
        skip = data.nextSkip;
        if (!data.hasMore || fresh.length === 0) done = true;
        render();
      } catch (err) {
        results.innerHTML = errorHTML(err.message);
      } finally {
        busy = false;
      }
    };

    await loadPage();
  }

  /* ------------------------------ halaman: pencarian ------------------------------ */
  async function pageSearch(view, term) {
    document.title = `Cari "${term}" — Hore-Hore Film`;
    view.innerHTML = `
      <div class="breadcrumb"><a href="#/">Home</a><span>/</span><span>Pencarian</span></div>
      ${sectionHead(`Hasil untuk “${term}”`)}
      <div id="results">${skeletonGrid(12)}</div>`;

    try {
      const data = await api('search', { q: term, type: 'all' });
      $('#results').innerHTML = data.metas.length
        ? `<div class="grid">${data.metas.map((m) => cardHTML(m)).join('')}</div>`
        : emptyHTML(
            'Tidak ditemukan',
            `Tidak ada film atau series yang cocok dengan “${term}”. Coba kata kunci lain, misal judul asli atau nama aktor.`,
            '#/films',
            'Lihat semua film'
          );
    } catch (err) {
      $('#results').innerHTML = errorHTML(err.message);
    }
  }

  /* ------------------------------ halaman: detail ------------------------------ */
  async function pageDetail(view, type, id) {
    const isSeries = type === 'series';
    view.innerHTML = `<div class="breadcrumb"><a href="#/">Home</a><span>/</span><a href="#/${isSeries ? 'series' : 'films'}">${isSeries ? 'Series' : 'Film'}</a><span>/</span><span>…</span></div>${skeletonGrid(6)}`;

    let meta;
    try {
      meta = await api('meta', { type, id });
    } catch (err) {
      view.innerHTML = errorHTML('Gagal memuat detail: ' + err.message);
      return;
    }

    document.title = `${meta.name} (${meta.year}) — Hore-Hore Film`;
    const inList = Watchlist.has(meta.id);
    const genres = meta.genres.map((g) => `<a class="tag" href="#/genre/${encodeURIComponent(g)}">${esc(g)}</a>`).join('');

    view.innerHTML = `
      <div class="breadcrumb"><a href="#/">Home</a><span>/</span>
        <a href="#/${isSeries ? 'series' : 'films'}">${isSeries ? 'Series' : 'Film'}</a><span>/</span>
        <span>${esc(meta.name)}</span></div>

      <div class="detail-hero">
        <div class="detail-bg" style="background-image:url('${esc(meta.background)}')"></div>
        <div class="detail-inner">
          <div class="detail-poster">${posterImg(meta.poster, meta.name)}</div>
          <div class="detail-info">
            <h1 class="detail-title">${esc(meta.name)}</h1>
            <div class="detail-facts">
              ${meta.rating ? `<span class="score">★ ${meta.rating.toFixed(1)}</span>` : ''}
              <span>${esc(meta.year || '')}</span>
              ${meta.runtime ? `<span class="sep"></span><span>${meta.runtime} menit</span>` : ''}
              ${meta.country.length ? `<span class="sep"></span><span>${esc(meta.country.join(', '))}</span>` : ''}
              <span class="sep"></span><span>${isSeries ? 'Series' : 'Film'}</span>
              ${meta.status ? `<span class="sep"></span><span>${esc(meta.status)}</span>` : ''}
            </div>
            <div class="detail-facts" style="margin-bottom:20px">${genres}</div>
            <p class="detail-desc">${esc(meta.description || 'Sinopsis belum tersedia untuk judul ini.')}</p>
            <div class="detail-actions">
              <button class="btn" id="btnPlay">
                <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg> ${isSeries ? 'Tonton Episode' : 'Tonton Sekarang'}
              </button>
              ${meta.trailer ? `<button class="btn ghost" id="btnTrailer"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg> Trailer</button>` : ''}
              <button class="btn ghost ${inList ? 'on' : ''}" id="btnWatch">
                <svg viewBox="0 0 24 24"><path d="M12 3a1 1 0 0 1 1 1v7h7a1 1 0 1 1 0 2h-7v7a1 1 0 1 1-2 0v-7H4a1 1 0 1 1 0-2h7V4a1 1 0 0 1 1-1Z"/></svg>
                ${inList ? 'Ada di Watchlist' : 'Tambah Watchlist'}
              </button>
            </div>
            <dl class="credits">
              ${meta.director.length ? `<div><dt>Sutradara</dt><dd>${esc(meta.director.join(', '))}</dd></div>` : ''}
              ${meta.cast.length ? `<div><dt>Pemain</dt><dd>${esc(meta.cast.join(', '))}</dd></div>` : ''}
              ${meta.awards ? `<div><dt>Penghargaan</dt><dd>${esc(meta.awards)}</dd></div>` : ''}
              ${meta.imdb ? `<div><dt>IMDb</dt><dd><a href="${esc(meta.imdb)}" target="_blank" rel="noopener" style="color:var(--accent)">Lihat di IMDb →</a></dd></div>` : ''}
            </dl>
          </div>
        </div>
      </div>

      ${isSeries && meta.seasons.length ? `<section class="section">
        <div class="section-head"><h2>Episode</h2></div>
        <div class="tabs" id="seasonTabs">
          ${meta.seasons.map((s, i) => `<button class="tab ${i === 0 ? 'active' : ''}" data-season="${s}">Season ${s}</button>`).join('')}
        </div>
        <div class="episode-list" id="episodes"></div>
      </section>` : ''}

      <section class="section" id="similarSection">${sectionHead('Mungkin Kamu Suka', null, '#/genre/' + encodeURIComponent(meta.genres[0] || 'Drama'))}${skeletonGrid(6)}</section>`;

    const watchBtn = $('#btnWatch');
    watchBtn.onclick = () => {
      const added = Watchlist.toggle(meta);
      watchBtn.classList.toggle('on', added);
      watchBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 3a1 1 0 0 1 1 1v7h7a1 1 0 1 1 0 2h-7v7a1 1 0 1 1-2 0v-7H4a1 1 0 1 1 0-2h7V4a1 1 0 0 1 1-1Z"/></svg> ${added ? 'Ada di Watchlist' : 'Tambah Watchlist'}`;
      toast(added ? 'Ditambahkan ke watchlist' : 'Dihapus dari watchlist');
    };

    $('#btnPlay').onclick = () => {
      if (isSeries && meta.episodes.length) openPlayer(meta, meta.episodes[0]);
      else openPlayer(meta, null);
    };

    if (meta.trailer) {
      $('#btnTrailer').onclick = () => openPlayer(meta, null, meta.trailer);
    }

    // episodes
    if (isSeries && meta.seasons.length) {
      const paintSeason = (season) => {
        const eps = meta.episodes.filter((e) => e.season === Number(season));
        $('#episodes').innerHTML = eps
          .map(
            (e) => `<div class="episode" data-ep="${esc(e.id)}">
              <div class="episode-thumb">${e.thumbnail ? `<img src="${esc(e.thumbnail)}" alt="" loading="lazy" />` : ''}</div>
              <div>
                <div class="episode-num">S${String(e.season).padStart(2, '0')} · E${String(e.episode).padStart(2, '0')}</div>
                <h4 class="episode-name">${esc(e.name)}</h4>
                <p class="episode-desc">${esc(e.description || 'Belum ada sinopsis episode.')}</p>
              </div>
              <span class="btn tiny ghost">Tonton</span>
            </div>`
          )
          .join('');
        $$('#episodes .episode').forEach((el) => {
          el.onclick = () => {
            const ep = meta.episodes.find((x) => x.id === el.dataset.ep);
            if (ep) openPlayer(meta, ep);
          };
        });
      };
      paintSeason(meta.seasons[0]);
      $('#seasonTabs').addEventListener('click', (e) => {
        const b = e.target.closest('[data-season]');
        if (!b) return;
        $$('#seasonTabs .tab').forEach((t) => t.classList.toggle('active', t === b));
        paintSeason(b.dataset.season);
      });
    }

    // rekomendasi
    try {
      const g = meta.genres[0] || 'Drama';
      const data = await api('catalog', { type, catalog: 'top', genre: g, skip: 0 });
      const list = data.metas.filter((m) => m.id !== meta.id).slice(0, 12);
      $('#similarSection').innerHTML =
        sectionHead('Mungkin Kamu Suka', null, '#/genre/' + encodeURIComponent(g)) +
        (list.length
          ? `<div class="grid">${list.map((m) => cardHTML(m)).join('')}</div>`
          : emptyHTML('Belum ada rekomendasi', 'Coba lihat katalog lengkap.', '#/films', 'Semua film'));
    } catch (err) {
      $('#similarSection').innerHTML = '';
    }

    History.push({
      id: meta.id,
      type: meta.type,
      name: meta.name,
      year: meta.year,
      rating: meta.rating,
      poster: meta.poster,
      background: meta.background,
      genres: meta.genres,
    });
  }

  /* ------------------------------ player ------------------------------ */
  const playerState = { meta: null, episode: null, provider: store.get('provider', DEFAULT_PROVIDER) };

  /* Anti pop-up iklan: kalau ada script di halaman ini yang mencoba window.open,
     jangan buka tab baru. Hanya berlaku selama pemutar terbuka. */
  let popupGuard = null;
  let popupBlocked = 0;

  function guardPopups() {
    if (popupGuard) return;
    popupGuard = window.open;
    window.open = function () {
      popupBlocked += 1;
      return null;
    };
  }

  function releasePopups() {
    if (popupGuard) {
      window.open = popupGuard;
      popupGuard = null;
    }
    popupBlocked = 0;
  }

  function openPlayer(meta, episode, trailerId) {
    playerState.meta = meta;
    playerState.episode = episode || null;
    if (trailerId) playerState.trailer = trailerId;
    else playerState.trailer = null;

    $('#playerTitle').textContent = meta.name;
    $('#playerSub').textContent = episode
      ? `Season ${episode.season} · Episode ${episode.episode} — ${episode.name}`
      : `${meta.year} · ${meta.type === 'series' ? 'Series' : 'Film'}${meta.runtime ? ' · ' + meta.runtime + ' menit' : ''}`;
    const imdb = $('#playerImdb');
    imdb.href = meta.imdb || '#';
    imdb.style.display = meta.imdb ? '' : 'none';

    $('#playerOverlay').hidden = false;
    document.body.style.overflow = 'hidden';
    guardPopups();
    renderPlayer();
  }

  function renderPlayer() {
    const { meta, episode, trailer } = playerState;
    const frame = $('#playerFrame');
    const foot = $('#playerFoot');

    if (trailer) {
      frame.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(trailer)}?autoplay=1&rel=0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen title="Trailer"></iframe>`;
      foot.innerHTML = `<span class="grow">Trailer resmi — diputar dari YouTube.</span>
        <button class="btn tiny ghost" id="btnCloseTrailer">Tutup Trailer</button>`;
      $('#btnCloseTrailer').onclick = () => {
        playerState.trailer = null;
        renderPlayer();
      };
      return;
    }

    const providers = VISIBLE_PROVIDERS;
    const current = providers.find((p) => p.id === playerState.provider) || providers[0];
    const url =
      meta.type === 'series' && episode
        ? current.tv(meta.id, episode.season, episode.episode)
        : current.movie(meta.id);

    const sandboxAttr = current.sandbox ? ` sandbox="${SANDBOX}"` : '';
    frame.innerHTML = `<iframe src="${esc(url)}"${sandboxAttr} allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="origin" title="${esc(meta.name)}"></iframe>`;

    foot.innerHTML = `
      ${providers.length > 1 ? '<span>Sumber:</span>' : ''}
      ${providers
        .map(
          (p) =>
            `<button class="chip ${p.id === current.id ? 'active' : ''}" data-provider="${p.id}" title="${
              p.sandbox ? 'Iklan popup diblokir' : 'Tanpa sandbox (bisa memunculkan popup iklan)'
            }">${esc(p.name)}</button>`
        )
        .join('')}
      <span class="grow"></span>
      <button class="btn tiny ghost" id="btnOpenTab" title="Buka di tab baru bila pemutar menolak tampil di sini">Buka Tab Baru</button>
      ${meta.trailer ? `<button class="btn tiny ghost" id="btnTrailerInPlayer">Trailer</button>` : ''}
      ${meta.imdb ? `<a class="btn tiny ghost" href="${esc(meta.imdb)}" target="_blank" rel="noopener">IMDb</a>` : ''}`;

    foot.querySelectorAll('[data-provider]').forEach((b) => {
      b.onclick = () => {
        playerState.provider = b.dataset.provider;
        store.set('provider', b.dataset.provider);
        renderPlayer();
      };
    });

    const openTab = $('#btnOpenTab');
    if (openTab)
      openTab.onclick = () => {
        // buka lewat guard supaya tab baru hanya dibuat oleh aksi klik user ini
        const fn = popupGuard || window.open;
        const w = fn.call(window, url, '_blank', 'noopener,noreferrer');
        if (w) w.opener = null;
        toast('Pemutar dibuka di tab baru — pakai adblocker agar bebas iklan');
      };

    const tb = $('#btnTrailerInPlayer');
    if (tb) tb.onclick = () => openPlayer(meta, episode, meta.trailer);
  }

  function closePlayer() {
    $('#playerOverlay').hidden = true;
    $('#playerFrame').innerHTML = '';
    document.body.style.overflow = '';
    releasePopups();
  }

  /* ------------------------------ halaman: watchlist & riwayat ------------------------------ */
  function pageWatchlist(view) {
    document.title = 'Watchlist — Hore-Hore Film';
    const list = Watchlist.all();
    view.innerHTML = `
      <div class="breadcrumb"><a href="#/">Home</a><span>/</span><span>Watchlist</span></div>
      ${sectionHead('Watchlist Saya', list.length || '')}
      ${
        list.length
          ? `<div class="grid">${list.map((m) => cardHTML(m, { removable: true })).join('')}</div>`
          : emptyHTML('Watchlist masih kosong', 'Simpan film atau series yang mau kamu tonton nanti — klik tombol Watchlist di halaman detail.', '#/films', 'Cari film')
      }`;
    view.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove]');
      if (!btn) return;
      e.preventDefault();
      Watchlist.remove(btn.dataset.remove);
      pageWatchlist(view);
    });
  }

  function pageHistory(view) {
    document.title = 'Riwayat Tonton — Hore-Hore Film';
    const list = History.all();
    view.innerHTML = `
      <div class="breadcrumb"><a href="#/">Home</a><span>/</span><span>Riwayat</span></div>
      <div class="section-head">
        <h2>Riwayat Tonton</h2>
        ${list.length ? '<button class="btn tiny ghost" id="clearHist">Hapus Riwayat</button>' : ''}
      </div>
      ${
        list.length
          ? `<div class="grid">${list.map((m) => cardHTML(m)).join('')}</div>`
          : emptyHTML('Belum ada riwayat', 'Judul yang kamu buka akan muncul di sini.', '#/', 'Mulai jelajah')
      }`;
    const clear = $('#clearHist');
    if (clear)
      clear.onclick = () => {
        History.clear();
        pageHistory(view);
        toast('Riwayat dihapus');
      };
  }

  function pageAbout(view) {
    document.title = 'Tentang — Hore-Hore Film';
    view.innerHTML = `
      <div class="breadcrumb"><a href="#/">Home</a><span>/</span><span>Tentang</span></div>
      ${sectionHead('Tentang Hore-Hore Film')}
      <div style="max-width:72ch;line-height:1.75;color:#ccd0db;font-size:14.5px">
        <p><strong>Hore-Hore Film</strong> adalah aplikasi katalog film &amp; series bergaya rebahan:
        jelajahi judul populer dan terbaru, saring per genre atau tahun, cari judul favorit,
        simpan ke watchlist, lalu tonton langsung dari halaman detail.</p>
        <h3 style="color:var(--text);margin-top:26px">Fitur</h3>
        <ul style="padding-left:20px">
          <li>Katalog film &amp; series: populer, terbaru, rating tertinggi, per genre, per tahun.</li>
          <li>Pencarian cepat (judul, termasuk judul asli).</li>
          <li>Halaman detail lengkap: sinopsis, pemain, sutradara, genre, rating IMDb, trailer.</li>
          <li>Watchlist &amp; riwayat tonton tersimpan di perangkat (localStorage).</li>
          <li>Pemutar bawaan dengan pilihan sumber dan pemilih season/episode.</li>
          <li>Responsif untuk desktop, tablet, dan ponsel.</li>
        </ul>
        <h3 style="color:var(--text);margin-top:26px">Sumber data</h3>
        <p>Metadata judul, poster, dan trailer diambil dari katalog publik (Cinemeta / IMDb).
        Aplikasi ini tidak menyimpan, meng-host, atau mendistribusikan file film apa pun;
        pemutaran dilakukan melalui penyedia pihak ketiga yang dapat berubah sewaktu-waktu.
        Jika sebuah judul tidak dapat diputar, gunakan tombol <em>IMDb</em> atau tonton lewat
        layanan resmi.</p>
      </div>`;
  }

  /* ------------------------------ router ------------------------------ */
  function setActiveNav(key) {
    $$('.mainnav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === key));
  }

  async function route() {
    stopHeroTimer();
    const view = $('#view');
    const raw = location.hash.replace(/^#\/?/, '');
    const [pathPart, queryPart] = raw.split('?');
    const parts = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
    const q = new URLSearchParams(queryPart || '');

    const seg = parts[0] || 'home';
    setActiveNav('');

    if (seg === 'home' || seg === '') {
      setActiveNav('home');
      await pageHome(view);
    } else if (seg === 'films') {
      setActiveNav('films');
      await pageBrowse(view, { type: 'movie', catalog: q.get('catalog') || 'top', genre: q.get('genre') || '' });
    } else if (seg === 'series') {
      setActiveNav('series');
      await pageBrowse(view, { type: 'series', catalog: q.get('catalog') || 'top', genre: q.get('genre') || '' });
    } else if (seg === 'film' && parts[1]) {
      setActiveNav('films');
      await pageDetail(view, 'movie', parts[1]);
    } else if (seg === 'series' && parts[1]) {
      setActiveNav('series');
      await pageDetail(view, 'series', parts[1]);
    } else if (seg === 'indonesia') {
      setActiveNav('indonesia');
      await pageIndonesia(view);
    } else if (seg === 'genre' && parts[1]) {
      setActiveNav('genre');
      await pageBrowse(view, { type: q.get('type') === 'series' ? 'series' : 'movie', genre: parts[1], catalog: 'top' });
    } else if (seg === 'genre') {
      setActiveNav('genre');
      await pageGenres(view);
    } else if (seg === 'tahun' && parts[1]) {
      setActiveNav('tahun');
      await pageYear(view, parts[1]);
    } else if (seg === 'tahun') {
      setActiveNav('tahun');
      await pageYears(view);
    } else if (seg === 'cari') {
      await pageSearch(view, parts[1] || '');
    } else if (seg === 'watchlist') {
      setActiveNav('watchlist');
      pageWatchlist(view);
    } else if (seg === 'riwayat') {
      pageHistory(view);
    } else if (seg === 'tentang') {
      pageAbout(view);
    } else {
      view.innerHTML = emptyHTML('Halaman tidak ditemukan', 'Tautan mungkin sudah berubah.', '#/', 'Kembali ke Home');
    }

    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
    view.focus({ preventScroll: true });
  }

  /* ------------------------------ init ------------------------------ */
  function init() {
    $('#year').textContent = new Date().getFullYear();
    renderWatchlistCount();

    // genre strip
    const strip = $('#genreStrip');
    strip.innerHTML =
      `<a class="chip" href="#/films">Semua</a>` +
      GENRES.map((g) => `<a class="chip" href="#/genre/${encodeURIComponent(g)}">${esc(g)}</a>`).join('');

    // pencarian
    const form = $('#searchForm');
    const input = $('#searchInput');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const term = input.value.trim();
      if (term) location.hash = `#/cari/${encodeURIComponent(term)}`;
    });
    const live = debounce(() => {
      const term = input.value.trim();
      if (term.length >= 3 && !location.hash.startsWith('#/cari/')) {
        location.hash = `#/cari/${encodeURIComponent(term)}`;
      }
    }, 650);
    input.addEventListener('input', live);

    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (e.key === '/' && tag !== 'input' && tag !== 'textarea') {
        e.preventDefault();
        input.focus();
        input.select();
      }
      if (e.key === 'Escape') {
        if (!$('#welcomeOverlay').hidden) closeWelcome();
        else if (!$('#playerOverlay').hidden) closePlayer();
        else if (document.activeElement === input) input.blur();
      }
    });

    // menu mobile
    const menuBtn = $('#menuBtn');
    menuBtn.addEventListener('click', () => {
      const nav = $('.mainnav');
      const open = nav.classList.toggle('open');
      menuBtn.setAttribute('aria-expanded', String(open));
    });
    $('.mainnav').addEventListener('click', () => {
      $('.mainnav').classList.remove('open');
      menuBtn.setAttribute('aria-expanded', 'false');
    });

    // player close
    $('#playerClose').addEventListener('click', closePlayer);
    $('#playerOverlay').addEventListener('click', (e) => {
      if (e.target.id === 'playerOverlay') closePlayer();
    });

    // genre strip active state
    const markStrip = () => {
      const hash = decodeURIComponent(location.hash);
      $$('#genreStrip .chip').forEach((c) => {
        const href = decodeURIComponent(c.getAttribute('href'));
        c.classList.toggle('active', hash === href);
      });
    };

    window.addEventListener('hashchange', () => {
      route();
      markStrip();
      // sinkronkan kata kunci pencarian
      const m = location.hash.match(/^#\/cari\/(.+)$/);
      if (m) input.value = decodeURIComponent(m[1]);
    });

    route();
    markStrip();
    initWelcome();
  }

  /* ------------------------------ pop-up sambutan ------------------------------ */
  const WELCOME_KEY = 'welcomeSeenV1';

  function closeWelcome() {
    const overlay = $('#welcomeOverlay');
    if (!overlay || overlay.hidden) return;
    overlay.style.transition = 'opacity 0.22s ease';
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.hidden = true;
      overlay.style.transition = '';
      overlay.style.opacity = '';
    }, 220);
    document.removeEventListener('keydown', onWelcomeKey);
    if (!document.querySelector('.player-overlay:not([hidden])')) document.body.style.overflow = '';
    try {
      sessionStorage.setItem('hhf:' + WELCOME_KEY, '1');
    } catch (e) {}
  }

  function onWelcomeKey(e) {
    if (e.key === 'Escape') closeWelcome();
  }

  function initWelcome() {
    const overlay = $('#welcomeOverlay');
    if (!overlay) return;
    let seen = false;
    try {
      seen = sessionStorage.getItem('hhf:' + WELCOME_KEY) === '1';
    } catch (e) {}
    if (seen) return;

    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onWelcomeKey);

    $('#welcomeClose').addEventListener('click', closeWelcome);
    $('#welcomeOk').addEventListener('click', closeWelcome);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeWelcome();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
