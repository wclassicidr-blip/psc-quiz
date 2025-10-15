// /api/proxy.js — Vercel serverless function (Node 18) acting as a tiny CORS proxy
export default async function handler(req, res) {
  try {
    const url = req.query.url;
    if (!url) { res.status(400).json({error:"missing url"}); return; }
    const r = await fetch(url, { headers: { 'user-agent': 'psc-guru/1.0' } });
    const buf = await r.arrayBuffer();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
    res.setHeader('Content-Type', r.headers.get('content-type') || 'text/plain; charset=utf-8');
    res.status(r.status).send(Buffer.from(buf));
  } catch (e) {
    res.status(500).json({error: String(e)});
  }
}
