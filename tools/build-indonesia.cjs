// Skrip sekali pakai: menyusun daftar film Indonesia dari katalog publik Cinemeta.
// Hasil: src/data/indonesia.json (dipakai homepage untuk baris "Film Indonesia").
const fs = require('fs');
const path = require('path');

const QUERIES = [
  'pengabdi setan', 'dilan', 'kkn', 'impetigore', 'laskar pelangi', 'the raid', 'siksa kubur',
  'vina', 'warkop', 'suzzanna', 'perahu kertas', 'ada apa dengan cinta', 'rumah dara', 'marlina',
  'arlinah', 'nussa', 'bumi manusia', 'kartini', 'habibie', 'my stupid boss', 'ijab kabul',
  'mencuri radden', 'losmen melati', 'qorin', 'mangkujiwo', 'sijjin', 'petualangan sherina',
  'sang pemimpi', 'siti nurbaya', 'van der wijck', '5 cm', 'eiffel', 'dear nathan', 'ancika',
  'kisah tanah jawa', 'november 10th', 'abu raihan', 'beranak dalam kubur', 'jatuh cinta',
  'seperti dendam', 'srimulat', 'nanti kita cerita', 'yowis ben', 'kadet 1947', 'mata batin',
  'danur', 'kuntilanak', 'makmum', 'rasuk', 'keramat', 'pengantin', 'sewu dino', 'tarung sarung',
  'ali topan', 'lara ati', 'norma antara', 'tuhan izinkan', 'siksa neraka', 'menjelang maghrib',
  'jaka tarub', 'agak laen', 'indonesia', 'jakarta', 'bandung', 'sunda', 'jawa',
];

const CINEMETA = 'https://v3-cinemeta.strem.io';

async function getJSON(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
      clearTimeout(t);
      if (res.ok) return await res.json();
    } catch (e) {
      /* coba lagi */
    }
  }
  return null;
}

(async () => {
  const candidates = new Map();
  for (const q of QUERIES) {
    const d = await getJSON(`${CINEMETA}/catalog/movie/top/search=${encodeURIComponent(q)}&skip=0.json`);
    for (const m of (d && d.metas) || []) {
      if (m.imdb_id && !candidates.has(m.imdb_id)) candidates.set(m.imdb_id, m.name);
    }
    process.stdout.write('.');
  }
  console.log('\nkandidat:', candidates.size);

  const ids = [...candidates.keys()];
  const found = [];
  let i = 0;
  const workers = Array.from({ length: 6 }, async () => {
    while (i < ids.length) {
      const id = ids[i++];
      const d = await getJSON(`${CINEMETA}/meta/movie/${id}.json`);
      const m = d && d.meta;
      if (!m) continue;
      const country = Array.isArray(m.country) ? m.country.join(', ') : String(m.country || '');
      if (!country.toLowerCase().includes('indonesia')) continue;
      found.push({
        id,
        name: m.name,
        year: m.year || '',
        rating: parseFloat(m.imdbRating) || null,
        genres: (Array.isArray(m.genre) ? m.genre : String(m.genre || '').split(', ')).filter(Boolean),
        description: m.description || '',
        country,
        poster: `https://images.metahub.space/poster/medium/${id}/img`,
        background: `https://images.metahub.space/background/medium/${id}/img`,
        popularity: m.popularity || 0,
      });
    }
  });
  await Promise.all(workers);

  found.sort((a, b) => (b.popularity || 0) - (a.popularity || 0) || (b.rating || 0) - (a.rating || 0));
  const out = path.join(__dirname, '..', 'src', 'data', 'indonesia.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), items: found }, null, 1));
  console.log('Indonesia ditemukan:', found.length, '->', out);
  console.log(found.slice(0, 20).map((m) => `${m.id} ${m.name} (${m.year}) ${m.rating || ''}`).join('\n'));
})();
