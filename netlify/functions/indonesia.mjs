// Netlify Function: daftar film Indonesia (dibuat oleh tools/build-indonesia.cjs).
// Tersedia di /indonesia dan /.netlify/functions/indonesia
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const candidates = [
  join(here, '..', '..', 'src', 'data', 'indonesia.json'),
  join(process.cwd(), 'src', 'data', 'indonesia.json'),
];

let cached = null;

async function loadData() {
  if (cached) return cached;
  for (const file of candidates) {
    try {
      const raw = await readFile(file, 'utf8');
      cached = JSON.parse(raw);
      return cached;
    } catch (e) {
      /* coba path berikutnya */
    }
  }
  cached = { generatedAt: null, items: [] };
  return cached;
}

export default async () => {
  try {
    const data = await loadData();
    return new Response(JSON.stringify({ total: data.items.length, items: data.items }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, s-maxage=86400',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err && err.message) || err) }), {
      status: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
};
