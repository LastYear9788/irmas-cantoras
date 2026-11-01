// Intermediário próprio do Irmãs Cantoras (Cloudflare Worker, plano grátis).
// Só repassa pedidos para as fontes de letra e só aceita pedidos vindos do nosso site.
// Uso: https://<worker>/?url=<endereço da fonte>

const ALLOWED_HOSTS = [
  'lrclib.net',
  'api.deezer.com',
  'auth.deezer.com',
  'pipe.deezer.com',
  'music.163.com',
];

const ALLOWED_ORIGINS = [
  'https://lastyear9788.github.io',
  'http://localhost:8765',
  'http://localhost:8000',
];

export default {
  async fetch(req) {
    const origin = req.headers.get('Origin') || '';
    const okOrigin = ALLOWED_ORIGINS.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': okOrigin ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const reply = (body, status) => new Response(body, { status, headers: cors });

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (!okOrigin) return reply('Só o site Irmãs Cantoras pode usar este intermediário.', 403);
    if (req.method !== 'GET' && req.method !== 'POST') return reply('Método não permitido', 405);

    let target;
    try { target = new URL(new URL(req.url).searchParams.get('url')); }
    catch { return reply('Endereço inválido', 400); }
    if (target.protocol !== 'https:' || !ALLOWED_HOSTS.includes(target.hostname)) {
      return reply('Destino não permitido', 403);
    }

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
    };
    for (const h of ['Content-Type', 'Authorization']) {
      const v = req.headers.get(h);
      if (v) headers[h] = v;
    }

    const upstream = await fetch(target.toString(), {
      method: req.method,
      headers,
      body: req.method === 'POST' ? await req.text() : undefined,
    });

    return new Response(await upstream.arrayBuffer(), {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' },
    });
  },
};
