// Intermediário próprio do Irmãs Cantoras (Cloudflare Worker, plano grátis).
// Só repassa pedidos para as fontes de letra e só aceita pedidos vindos do nosso site.
// Uso: https://<worker>/?url=<endereço da fonte>

// o que cada fonte pode receber (nada além do que o app usa)
const ROUTES = {
  'lrclib.net': { methods: ['GET'] },
  'api.deezer.com': { methods: ['GET'] },
  'auth.deezer.com': { methods: ['GET'] },
  'pipe.deezer.com': { methods: ['POST'], paths: ['/api'], auth: true },
  'music.163.com': { methods: ['GET'] },
};

const ALLOWED_ORIGINS = [
  'https://lastyear9788.github.io',
  'http://localhost:8765',
  'http://localhost:8000',
];

const MAX_BODY = 16 * 1024;     // o pedido de letra do Deezer tem ~300 bytes
const TIMEOUT_MS = 10000;

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
    // toda resposta (até erro) leva os cabeçalhos de CORS: senão o navegador só diz "erro de CORS"
    const reply = (body, status) => new Response(body, { status, headers: cors });

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (!okOrigin) return reply('Só o site Irmãs Cantoras pode usar este intermediário.', 403);
    if (req.method !== 'GET' && req.method !== 'POST') return reply('Método não permitido', 405);

    let target;
    try { target = new URL(new URL(req.url).searchParams.get('url')); }
    catch { return reply('Endereço inválido', 400); }
    const route = Object.prototype.hasOwnProperty.call(ROUTES, target.hostname) ? ROUTES[target.hostname] : null;
    if (target.protocol !== 'https:' || !route || target.port !== '' || target.username || target.password) {
      return reply('Destino não permitido', 403);
    }
    if (!route.methods.includes(req.method) || (route.paths && !route.paths.includes(target.pathname))) {
      return reply('Pedido não permitido para esse destino', 403);
    }

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
    };
    const ct = req.headers.get('Content-Type');
    if (ct && req.method === 'POST') headers['Content-Type'] = ct;
    const auth = req.headers.get('Authorization');
    if (auth && route.auth) headers.Authorization = auth;

    let body;
    if (req.method === 'POST') {
      if (Number(req.headers.get('Content-Length') || 0) > MAX_BODY) return reply('Pedido grande demais', 413);
      body = await req.text();
      if (body.length > MAX_BODY) return reply('Pedido grande demais', 413);
    }

    let upstream;
    try {
      upstream = await fetch(target.toString(), {
        method: req.method,
        headers,
        body,
        redirect: 'manual',                       // não segue pra fora da lista (cada salto teria que ser conferido)
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      const timeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
      return reply(timeout ? 'A fonte demorou demais' : 'A fonte não respondeu', timeout ? 504 : 502);
    }
    if (upstream.status >= 300 && upstream.status < 400) return reply('A fonte tentou redirecionar (bloqueado)', 502);

    // repassa aos pouquinhos (sem carregar a resposta inteira na memória do Worker)
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' },
    });
  },
};
