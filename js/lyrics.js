// Busca automática de letra sincronizada no LRCLIB (grátis, sem cadastro).
// A pessoa só cola o link: aqui a gente tenta várias formas de achar a música pelo título do vídeo.

const API = 'https://lrclib.net/api/search';

// palavras que aparecem em título de vídeo e atrapalham a busca
const JUNK = [
  'karaoke version', 'versão karaokê', 'versao karaoke', 'versão instrumental', 'karaokê version',
  'official music video', 'official video', 'official audio', 'official lyric video', 'official visualizer',
  'music video', 'lyric video', 'lyrics video', 'lyrics', 'lyric', 'letra', 'legendado', 'tradução', 'traducao',
  'clipe oficial', 'videoclipe oficial', 'videoclipe', 'clipe', 'vídeo oficial', 'video oficial', 'áudio oficial', 'audio oficial',
  'visualizer', 'audio', 'áudio', 'official', 'oficial', 'remastered', 'remaster', 'hd', 'hq', '4k', 'mv', 'm/v', 'karaoke', 'karaokê', 'instrumental', 'playback', 'sem voz',
];

function stripJunk(s) {
  s = s
    .replace(/\(.*?\)|\[.*?\]|【.*?】|\{.*?\}/g, ' ')            // tudo entre parênteses/colchetes
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')   // emojis
    .replace(/["“”«»]/g, ' ');
  for (const j of JUNK) s = s.replace(new RegExp(`(^|\\s|-)${j.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?=\\s|$|-)`, 'gi'), ' ');
  return s.replace(/\s+/g, ' ').replace(/^[\s\-–—|:]+|[\s\-–—|:]+$/g, '').trim();
}

function stripFeat(s) {
  return s.replace(/\s+(ft\.?|feat\.?|featuring|part\.|participação( especial)?( de)?)\s+.*$/i, '').trim();
}

function cleanAuthor(a) {
  return stripJunk((a || '').replace(/\s*-\s*topic$/i, '').replace(/vevo$/i, '').replace(/official/ig, '')).trim();
}

/** Monta uma lista de buscas, da mais provável pra menos provável */
export function buildQueries(title, author) {
  const qs = [];
  const add = (q) => { const k = JSON.stringify(q); if (!qs.some((x) => JSON.stringify(x) === k)) qs.push(q); };

  const firstPart = title.split(/\s[|•]\s|\s\/\/\s/)[0];
  const clean = stripJunk(firstPart);
  const art = cleanAuthor(author);
  const parts = clean.split(/\s[-–—~]\s|\s[-–—]|[-–—]\s/).map((s) => s.trim()).filter(Boolean);

  if (parts.length >= 2) {
    const a = stripFeat(parts[0]);
    const t = stripFeat(parts.slice(1).join(' '));
    add({ artist_name: a, track_name: t });
    add({ q: `${a} ${t}` });
    const first = a.split(/\s*(?:,|&|\sx\s|\se\s|\sand\s)\s*/i)[0];   // "Anitta, Pedro Sampaio" -> "Anitta"
    if (first && first !== a) add({ artist_name: first, track_name: t });
    add({ artist_name: t, track_name: a });       // às vezes vem "Música - Artista"
  }
  if (art) {
    add({ artist_name: art, track_name: stripFeat(clean) });
    add({ q: `${art} ${stripFeat(clean)}` });
  }
  add({ q: stripFeat(clean) });
  // sem "ao vivo"/"live" (a busca às vezes não acha com isso)
  const noVer = stripFeat(clean).replace(/(^|\s)(ao vivo|live|acústico|acustico)(?=\s|$)/gi, ' ').replace(/\s+/g, ' ').trim();
  if (noVer) add({ q: noVer });
  add({ q: clean });
  return qs;
}

// respostas guardadas durante UMA busca (a 2ª tentativa reaproveita, sem pedir de novo)
let memo = new Map();
function cached(key, fn) {
  if (!memo.has(key)) memo.set(key, fn());
  return memo.get(key);
}

function search(params) {
  const url = API + '?' + new URLSearchParams(params).toString();
  return cached('lrclib ' + url, () => fetchJSON(url));
}

/* ---------- conferir se é a mesma música (pelo nome) ---------- */
const normName = (x) => (x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9぀-鿿 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** o nome da música encontrada tem que aparecer no título do vídeo (e o artista também, se der) */
let relaxed = false;   // 2ª tentativa: o título do vídeo não tem o nome do artista (ex: canal de TV)
function sameSong(foundTrack, foundArtist, haystack) {
  const t = normName(foundTrack);
  if (!t || !(' ' + haystack + ' ').includes(' ' + t + ' ')) return false;
  if (relaxed) return t.length >= 4;   // só o nome da música (e não pode ser curtinho demais)
  const artists = normName(foundArtist).split(/ (?:feat|ft|and|e|x) | /).filter((w) => w.length > 2);
  return !artists.length || artists.some((w) => haystack.includes(w));
}

/* ---------- intermediários públicos (pra fontes que bloqueiam o navegador) ---------- */
const PROXIES = [
  // o nosso (Cloudflare, grátis, código em proxy/worker.js); os outros dois são públicos, de reserva
  { wrap: (u) => 'https://irmas-cantoras-proxy.irmascantoras.workers.dev/?url=' + encodeURIComponent(u), post: true, deadUntil: 0 },
  { wrap: (u) => 'https://cors.eu.org/' + u, post: true, deadUntil: 0 },
  { wrap: (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u), post: false, deadUntil: 0 },
];
let proxyIdx = 0;

// tempo máximo da busca inteira (pra nunca ficar "Procurando a letra…" pra sempre)
let deadline = Infinity;
const outOfTime = () => Date.now() > deadline;

async function fetchJSON(url, opts = {}, ms = 6000) {
  if (outOfTime()) throw Object.assign(new Error('tempo esgotado'), { byDeadline: true });
  const ctl = new AbortController();
  const wait = Math.max(500, Math.min(ms, deadline - Date.now()));
  let byDeadline = false;
  // se quem cortou foi o tempo máximo da busca (e não o servidor travado), isso NÃO é defeito do servidor
  const timer = setTimeout(() => { byDeadline = wait < ms; ctl.abort(); }, wait);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal });
    if (!res.ok) throw Object.assign(new Error('http ' + res.status), { status: res.status });
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') e.byDeadline = byDeadline;
    throw e;
  } finally { clearTimeout(timer); }
}

/** algum intermediário que aceita esse tipo de pedido está funcionando agora? */
const proxyAvailable = (post) => PROXIES.some((p) => (!post || p.post) && p.deadUntil < Date.now());

function proxied(url, opts = {}) {
  return cached('px ' + url + ' ' + (opts.body || ''), () => proxiedNow(url, opts));
}
async function proxiedNow(url, opts) {
  const isPost = opts.method === 'POST';
  for (let n = 0; n < PROXIES.length; n++) {
    const i = (proxyIdx + n) % PROXIES.length;
    const px = PROXIES[i];
    if ((isPost && !px.post) || px.deadUntil > Date.now()) continue;
    try {
      const data = await fetchJSON(px.wrap(url), opts);
      proxyIdx = i;           // lembra qual funcionou
      return data;
    } catch (e) {
      // "muitos pedidos", erro do servidor ou travou: deixa esse de lado por 2 minutos
      if (e.byDeadline) throw e;
      if (e.status === 429 || e.status >= 500 || e.name === 'AbortError') px.deadUntil = Date.now() + 120000;
    }
  }
  throw new Error('proxy');
}

const ODD_ALL = /remix|cover|live|ao vivo|acustico|instrumental|karaoke|sped up|slowed|bootleg|remaster/g;
const plain = (x) => (x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** escolhe até 3 candidatas com o mesmo nome, da duração mais parecida pra menos */
function pickCandidates(items, videoDuration, wantsVersion, hay) {
  return items
    .filter((c) => sameSong(c.track, c.artist, hay))
    .map((c) => {
      const diff = videoDuration ? Math.abs(c.duration - videoDuration) : 0;
      // versão diferente (remix, ao vivo, cover…) que o vídeo não tem no título = penalidade
      let extra = (plain(c.track).match(ODD_ALL) || []).filter((w) => !hay.includes(w)).length;
      // qualquer outra coisa entre parênteses que o vídeo não tem (ex: "(Pianoforte)", "(Acoustic)") = outra versão
      for (const m of plain(c.track).matchAll(/[(\[]([^)\]]+)[)\]]/g)) {
        const words = m[1].replace(/(feat|ft|with|com|part|from|remaster(ed)?|\d{4}|version|versao|radio edit)\.?/g, ' ').trim().split(/\s+/).filter((w) => w.length > 2);
        if (words.length && !words.every((w) => hay.includes(w))) extra++;
      }
      return { ...c, diff, score: diff + extra * 30 };
    })
    .sort((x, y) => x.score - y.score)
    .slice(0, 3);
}

/* ---------- fonte 2: Deezer (ótimo pra música brasileira) ---------- */
let dzJwt = null, dzJwtAt = 0;
async function deezerJwt() {
  if (dzJwt && Date.now() - dzJwtAt < 10 * 60 * 1000) return dzJwt;
  const d = await fetchJSON('https://auth.deezer.com/login/anonymous?jo=p&rto=c&i=c');
  dzJwt = d.jwt; dzJwtAt = Date.now();
  return dzJwt;
}

let jsonpN = 0;
function deezerSearch(text) {
  const url = 'https://api.deezer.com/search?limit=10&q=' + encodeURIComponent(text);
  return cached('dz ' + url, () => deezerSearchNow(url));
}
function deezerSearchNow(url) {
  if (typeof document === 'undefined') return fetchJSON(url);          // (testes fora do navegador)
  return new Promise((resolve, reject) => {                             // JSONP: a busca do Deezer não libera fetch
    const cb = '__dz' + (++jsonpN);
    const sc = document.createElement('script');
    const done = (fn, v) => { clearTimeout(t); delete window[cb]; sc.remove(); fn(v); };
    const t = setTimeout(() => done(reject, new Error('timeout')), 9000);
    window[cb] = (d) => done(resolve, d);
    sc.onerror = () => done(reject, new Error('jsonp'));
    sc.src = url + '&output=jsonp&callback=' + cb;
    document.head.appendChild(sc);
  });
}

async function deezerFind(text, videoDuration, wantsVersion, hay) {
  const res = await deezerSearch(text);
  const items = ((res && res.data) || []).map((t) => ({ id: t.id, track: t.title, artist: t.artist && t.artist.name, duration: t.duration }));
  const cands = pickCandidates(items, videoDuration, wantsVersion, hay);
  if (!cands.length) return null;
  const jwt = await deezerJwt();
  for (const c of cands) {
    const d = await proxied('https://pipe.deezer.com/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt },
      body: JSON.stringify({
        variables: { trackId: String(c.id) },
        query: 'query L($trackId: String!) { track(trackId: $trackId) { lyrics { synchronizedLines { lrcTimestamp line } } } }',
      }),
    });
    const sl = d && d.data && d.data.track && d.data.track.lyrics && d.data.track.lyrics.synchronizedLines;
    if (!sl || !sl.length) continue;
    const lines = parseLRC(sl.map((l) => l.lrcTimestamp + l.line).join('\n'));
    if (lines.length >= 4) return { lines, diff: c.diff, artist: c.artist, track: c.track };
  }
  return null;
}

/* ---------- fonte 3: NetEase (bom pra música internacional) ---------- */
async function neteaseFind(text, videoDuration, wantsVersion, hay) {
  const data = await proxied('https://music.163.com/api/search/get?type=1&limit=10&s=' + encodeURIComponent(text));
  const items = ((data.result && data.result.songs) || []).map((s) => ({
    id: s.id, track: s.name, artist: (s.artists || []).map((a) => a.name).join(', '), duration: s.duration / 1000,
  }));
  for (const c of pickCandidates(items, videoDuration, wantsVersion, hay)) {
    const ly = await proxied(`https://music.163.com/api/song/lyric?id=${c.id}&lv=-1&kv=-1&tv=-1`);
    const lrc = ly && ly.lrc && ly.lrc.lyric;
    if (!lrc) continue;
    const lines = parseLRC(lrc);
    if (lines.length >= 4) return { lines, diff: c.diff, artist: c.artist, track: c.track };
  }
  return null;
}

/**
 * Procura a letra. Retorna { lines, artist, track, diff } ou lança erro com mensagem amigável.
 * Ordem: LRCLIB -> Deezer -> NetEase. Tudo automático.
 */
export async function findLyrics(title, author, videoDuration) {
  const queries = buildQueries(title, author);
  const hay = normName(title + ' ' + cleanAuthor(author)) + ' ' + plain(title);
  const st = { best: null, down: 0, tried: 0 };
  deadline = Date.now() + 20000;   // no máximo ~20s procurando
  memo = new Map();
  let timedOut = false;

  try {
    // 1ª passada: exige que o artista apareça no título/canal. 2ª: só o nome da música.
    for (const rel of [false, true]) {
      relaxed = rel;
      const r = await searchAll(queries, hay, title, videoDuration, st);
      if (r) return r;
      if (st.best) return st.best;
      if (outOfTime()) { timedOut = true; break; }
    }
  } finally {
    relaxed = false;
    deadline = Infinity;
    memo = new Map();
  }

  if (timedOut) throw new Error('Os sites de letras estão muito lentos agora 😢 Tenta de novo daqui a pouco.');
  if (st.down === st.tried) throw new Error('Os sites de letras estão fora do ar agora 😢 Tenta de novo daqui a pouco.');
  throw new Error('Não achei a letra dessa música 😕 Tenta outro link (de preferência o clipe oficial ou o áudio oficial).');
}

/** Procura em todas as fontes (cada fonte com todas as formas do título AO MESMO TEMPO).
 *  Devolve logo se achar uma bem parecida; senão guarda a melhor em st.best */
async function searchAll(queries, hay, title, videoDuration, st) {
  const consider = (r) => { if (r && (!st.best || r.diff < st.best.diff)) st.best = r; };
  const good = () => !!(st.best && st.best.diff <= 4);

  // 1) LRCLIB
  st.tried++;
  const lr = await Promise.allSettled(queries.map((q) => search(q)));
  if (lr.every((x) => x.status === 'rejected')) st.down++;
  for (const x of lr) {
    if (x.status !== 'fulfilled') continue;
    for (const r of x.value || []) {
      if (!r.syncedLyrics || r.instrumental) continue;
      if (!sameSong(r.trackName, r.artistName, hay)) continue;
      const lines = parseLRC(r.syncedLyrics);
      if (lines.length < 4) continue;
      consider({ lines, diff: videoDuration ? Math.abs((r.duration || 0) - videoDuration) : 0, artist: r.artistName, track: r.trackName });
    }
  }
  if (good()) return st.best;

  // 2) e 3) Deezer e NetEase
  const wantsVersion = /remix|cover|live|ao vivo|acústico|acustico/i.test(title);
  const texts = [...new Set(queries.map((q) => q.q || `${q.artist_name} ${q.track_name}`))].slice(0, 4);
  for (const find of [deezerFind, neteaseFind]) {
    if (outOfTime()) return null;
    // sem intermediário funcionando, nem tenta (Deezer precisa de um que aceite POST)
    if (!proxyAvailable(find === deezerFind)) continue;
    st.tried++;
    const res = await Promise.allSettled(texts.map((t) => find(t, videoDuration, wantsVersion, hay)));
    if (res.every((x) => x.status === 'rejected')) st.down++;
    res.forEach((x) => { if (x.status === 'fulfilled') consider(x.value); });
    if (good()) return st.best;
  }
  return null;
}

/** "[01:23.45] texto" -> [{ t, end, text }] */
export function parseLRC(lrc) {
  const stamps = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
    if (!tags.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (/[　-鿿]/.test(text) && /[:：]/.test(text)) continue;   // créditos em chinês da NetEase
    for (const m of tags) stamps.push({ t: +m[1] * 60 + parseFloat(m[2].replace(':', '.')), text });
  }
  stamps.sort((a, b) => a.t - b.t);

  // duas linhas no mesmo instante (dueto): junta numa só, "linha A / linha B"
  for (let i = stamps.length - 1; i > 0; i--) {
    if (Math.abs(stamps[i].t - stamps[i - 1].t) < 0.05) {
      const a = stamps[i - 1].text, b = stamps[i].text;
      stamps[i - 1].text = a && b ? `${a} / ${b}` : (a || b);
      stamps.splice(i, 1);
    }
  }

  const lines = [];
  for (let i = 0; i < stamps.length; i++) {
    const s = stamps[i];
    if (!s.text || /^[♪♫\s.…-]*$/.test(s.text)) continue;   // linha vazia/instrumental
    const next = stamps[i + 1] ? stamps[i + 1].t : s.t + 5;
    lines.push({ t: s.t, end: Math.min(next, s.t + 10), text: s.text });
  }
  return lines;
}
