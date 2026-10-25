// Netlify Function: /api/health (routing otomatis berbasis file)
export default async () => json(200, { ok: true, time: Date.now() });

function json(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
  });
}
