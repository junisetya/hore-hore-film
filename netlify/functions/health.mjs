// Netlify Function: tersedia di /health dan /.netlify/functions/health
export default async () =>
  new Response(JSON.stringify({ ok: true, time: Date.now() }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
  });
