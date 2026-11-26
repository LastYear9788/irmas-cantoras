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
export const normName = (x) => (x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9\u0370-\u03ff\u0400-\u04ff\u1100-\u11ff\u3040-\u9fff\uac00-\ud7af ]/g, ' ').replace(/\s+/g, ' ').trim();

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
let searchGen = 0;   // número da busca mais nova
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
      // "muitos pedidos", erro do servidor, travou, caiu (erro de rede/CORS), recusou (403) ou
      // devolveu algo que não é JSON (página de erro): deixa esse de lado por 2 minutos
      if (e.byDeadline) throw e;
      if (e.status === 429 || e.status >= 500 || e.status === 403 || e.name === 'AbortError'
        || e.name === 'TypeError' || e.name === 'SyntaxError') px.deadUntil = Date.now() + 120000;
    }
  }
  throw new Error('proxy');
}

const ODD_ALL = /remix|cover|live|ao vivo|acustico|instrumental|karaoke|sped up|slowed|bootleg|remaster/g;
const plain = (x) => (x || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** escolhe até 3 candidatas com o mesmo nome, da duração mais parecida pra menos */
function pickCandidates(items, videoDuration, hay, limit = 3) {
  return items
    .filter((c) => sameSong(c.track, c.artist, hay))
    .map((c) => {
      const diff = videoDuration ? Math.abs(c.duration - videoDuration) : 0;
      // versão diferente (remix, ao vivo, cover…) que o vídeo não tem no título = penalidade
      let extra = (plain(c.track).match(ODD_ALL) || []).filter((w) => !hay.includes(w)).length;
      // qualquer outra coisa entre parênteses que o vídeo não tem (ex: "(Pianoforte)", "(Acoustic)") = outra versão
      for (const m of plain(c.track).matchAll(/[(\[]([^)\]]+)[)\]]/g)) {
        const words = m[1].replace(/\b(feat|ft|with|com|part|from|remaster(ed)?|\d{4}|version|versao|radio edit)\b\.?/g, ' ').trim().split(/\s+/).filter((w) => w.length > 2);
        if (words.length && !words.every((w) => hay.includes(w))) extra++;
      }
      return { ...c, diff, score: diff + extra * 30 };
    })
    .sort((x, y) => x.score - y.score)
    .slice(0, limit);
}

/* ---------- fonte 2: Deezer (ótimo pra música brasileira) ---------- */
let dzJwt = null, dzJwtAt = 0;
async function deezerJwt() {
  if (dzJwt && Date.now() - dzJwtAt < 10 * 60 * 1000) return dzJwt;
  const authUrl = 'https://auth.deezer.com/login/anonymous?jo=p&rto=c&i=c';
  let d;
  try { d = await fetchJSON(authUrl); }
  catch (e) { if (e.byDeadline) throw e; d = await proxied(authUrl); }
  if (!d || typeof d.jwt !== 'string' || !d.jwt) throw new Error('deezer sem jwt');   // senão mandava "Bearer undefined"
  dzJwt = d.jwt; dzJwtAt = Date.now();
  return dzJwt;
}

let jsonpN = 0;
function deezerSearch(text) {
  const url = 'https://api.deezer.com/search?limit=10&q=' + encodeURIComponent(text);
  return cached('dz ' + url, () => deezerSearchNow(url));
}
async function deezerSearchNow(url) {
  if (typeof document === 'undefined') return fetchJSON(url);          // (testes fora do navegador)
  // 1º pelo intermediário (só dados, nada roda na página); se nenhum estiver de pé, JSONP direto
  try { return await proxied(url); }
  catch (e) { if (e.byDeadline) throw e; }
  return deezerJsonp(url);
}
function deezerJsonp(url) {
  if (outOfTime()) return Promise.reject(Object.assign(new Error('tempo esgotado'), { byDeadline: true }));
  return new Promise((resolve, reject) => {                             // JSONP: a busca do Deezer não libera fetch
    const cb = '__dz' + (++jsonpN);
    const sc = document.createElement('script');
    const done = (fn, v) => {
      clearTimeout(t);
      // resposta atrasada depois do tempo: a função continua existindo (vazia), senão dava erro na página
      window[cb] = () => {};
      setTimeout(() => { delete window[cb]; }, 60000);
      sc.remove();
      fn(v);
    };
    const wait = Math.max(500, Math.min(9000, deadline - Date.now()));   // respeita o tempo máximo da busca
    const t = setTimeout(() => done(reject, Object.assign(new Error('timeout'), { byDeadline: wait < 9000 })), wait);
    window[cb] = (d) => done(resolve, d);
    sc.onerror = () => done(reject, new Error('jsonp'));
    sc.src = url + '&output=jsonp&callback=' + cb;
    document.head.appendChild(sc);
  });
}

async function deezerFind(text, videoDuration, hay, st) {
  const res = await deezerSearch(text);
  if (st.stop()) return;
  const items = ((res && res.data) || []).map((t) => ({ id: t.id, track: t.title, artist: t.artist && t.artist.name, duration: t.duration }));
  const cands = pickCandidates(items, videoDuration, hay);
  if (!cands.length) return;
  const jwt = await deezerJwt();
  for (const c of cands) {
    if (st.stop() || outOfTime()) break;
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
    if (lines.length >= 4) {
      st.consider(lyricResult(c, lines, 'Deezer'));
      if (!st.collect) break;
    }
  }
}

/* ---------- fonte 3: NetEase (bom pra música internacional) ---------- */
async function neteaseFind(text, videoDuration, hay, st) {
  const data = await proxied('https://music.163.com/api/search/get?type=1&limit=10&s=' + encodeURIComponent(text));
  if (st.stop()) return;
  const items = ((data.result && data.result.songs) || []).map((s) => ({
    id: s.id, track: s.name, artist: (s.artists || []).map((a) => a.name).join(', '), duration: s.duration / 1000,
  }));
  for (const c of pickCandidates(items, videoDuration, hay)) {
    if (st.stop() || outOfTime()) break;
    const ly = await proxied(`https://music.163.com/api/song/lyric?id=${c.id}&lv=-1&kv=-1&tv=-1`);
    const lrc = ly && ly.lrc && ly.lrc.lyric;
    if (!lrc) continue;
    const lines = parseLRC(lrc);
    if (lines.length >= 4) {
      st.consider(lyricResult(c, lines, 'NetEase'));
      if (!st.collect) break;
    }
  }
}

function lyricResult(c, lines, source) {
  return { lines, diff: c.diff, score: c.score, artist: c.artist, track: c.track, album: c.album, duration: c.duration, source };
}

/**
 * Procura a letra. Retorna { lines, artist, track, diff } ou lança erro com mensagem amigável.
 * Ordem: LRCLIB -> Deezer -> NetEase. Tudo automático.
 */
export function findLyrics(title, author, videoDuration) {
  return searchLyrics(title, author, videoDuration, false);
}

export function findLyricVersions(title, author, videoDuration) {
  return searchLyrics(title, author, videoDuration, true);
}

async function searchLyrics(title, author, videoDuration, collect) {
  const queries = buildQueries(title, author);
  const hay = normName(title + ' ' + cleanAuthor(author)) + ' ' + plain(title);
  // Só a busca mais nova mexe em memo/relaxed/deadline: se pularam a música no meio,
  // a busca velha para no próximo passo (nem chega a perguntar pras outras fontes).
  const my = ++searchGen;
  const superseded = () => my !== searchGen;
  const versions = new Map();
  const st = { best: null, down: 0, tried: 0, stop: superseded, collect, consider(r) {
    if (superseded()) return;
    if (!st.best || r.score < st.best.score) st.best = r;
    if (!collect) return;
    const key = JSON.stringify(r.lines);
    if (!versions.has(key) || r.score < versions.get(key).score) versions.set(key, r);
  } };
  deadline = Date.now() + 20000;   // no máximo ~20s procurando
  memo = new Map();
  let timedOut = false;

  try {
    // 1ª passada: exige que o artista apareça no título/canal. 2ª: só o nome da música.
    for (const rel of [false, true]) {
      if (superseded()) throw new Error('cancelado');
      relaxed = rel;
      const r = await searchAll(queries, hay, videoDuration, st);
      if (superseded()) throw new Error('cancelado');
      if (!collect && (r || st.best)) return r || st.best;
      if (outOfTime()) { timedOut = true; break; }
      if (collect && versions.size >= 2) break;
    }
  } finally {
    if (!superseded()) {
      relaxed = false;
      deadline = Infinity;
      memo = new Map();
    }
  }

  if (collect && versions.size) return [...versions.values()].sort((a, b) => a.score - b.score).slice(0, 12);
  if (timedOut) throw new Error('Os sites de letras estão muito lentos agora 😢 Tenta de novo daqui a pouco.');
  if (st.down === st.tried) throw new Error('Os sites de letras estão fora do ar agora 😢 Tenta de novo daqui a pouco.');
  if (collect) return [];
  throw new Error('Não achei a letra dessa música 😕 Tenta outro link (de preferência o clipe oficial ou o áudio oficial).');
}

/** Procura em todas as fontes (cada fonte com todas as formas do título AO MESMO TEMPO).
 *  Devolve logo se achar uma bem parecida; senão guarda a melhor em st.best */
async function searchAll(queries, hay, videoDuration, st) {
  // nota = diferença de duração + 30 por "versão diferente" (remix, ao vivo, acústico…) que o vídeo não tem
  const good = () => !st.collect && st.best && st.best.score <= 4;

  // 1) LRCLIB (passa pela mesma peneira das outras fontes: versão errada perde pra original)
  st.tried++;
  const lr = await Promise.allSettled(queries.map((q) => search(q)));
  if (st.stop()) return null;
  if (lr.every((x) => x.status === 'rejected')) st.down++;
  const items = [];
  const seen = new Set();
  for (const x of lr) {
    if (x.status !== 'fulfilled') continue;
    for (const r of Array.isArray(x.value) ? x.value : []) {
      if (!r.syncedLyrics || r.instrumental) continue;
      const key = r.id != null ? 'id' + r.id : `${r.trackName}|${r.artistName}|${r.duration}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ track: r.trackName, artist: r.artistName, album: r.albumName, duration: r.duration || 0, lrc: r.syncedLyrics });
    }
  }
  for (const c of pickCandidates(items, videoDuration, hay, Infinity)) {
    const lines = parseLRC(c.lrc);
    if (lines.length < 4) continue;
    st.consider(lyricResult(c, lines, 'LRCLIB'));
  }
  if (good()) return st.best;

  // 2) e 3) Deezer e NetEase
  const texts = [...new Set(queries.map((q) => q.q || `${q.artist_name} ${q.track_name}`))].slice(0, 4);
  for (const find of [deezerFind, neteaseFind]) {
    if (outOfTime() || st.stop()) return null;
    // sem intermediário funcionando, nem tenta (Deezer precisa de um que aceite POST)
    if (!proxyAvailable(find === deezerFind)) continue;
    st.tried++;
    const res = await Promise.allSettled(texts.map((t) => find(t, videoDuration, hay, st)));
    if (res.every((x) => x.status === 'rejected')) st.down++;
    if (good()) return st.best;
  }
  return null;
}

// créditos no começo das letras da NetEase ("作词 : ...", "编曲：...", "混音 : ...");
// não corta versos reais em japonês/chinês que só têm ":" (ex.: "午前0時: 君を待つ")
const NETEASE_CREDIT = /^(?:(?:执行|執行|联合|聯合|音乐|音樂)?(?:作[词詞曲]|[词詞]\s*[/／]?\s*曲|[词詞]|曲|编曲|編曲|制作人?|製作人?|监制|監製|混音|母[带帶]|[录錄]音|缩混|縮混|配唱|和[声聲]|伴唱|主唱|演唱|原唱|翻唱|歌手|出品|发行|發行|企[划劃]|统[筹籌]|統籌|策[划劃]|版权|版權|吉他|贝斯|貝斯|钢琴|鋼琴|键盘|鍵盤|弦[乐樂]|鼓|人[声聲]|声乐|聲樂|总[监監]|總監)[师師棚室人方手工程]*)\s*[:：]/;

/** "[01:23.45] texto" -> [{ t, end, text }] */
export function parseLRC(lrc) {
  const stamps = [];
  for (const raw of lrc.split(/\r?\n/)) {
    // só os tempos do COMEÇO da linha marcam quando ela toca ("[00:10][01:20]Refrão" = repete);
    // um tempo no meio da frase é marcação de palavra (não pode duplicar a linha)
    const head = raw.match(/^\s*((?:\[\d+:\d+(?:[.:]\d+)?\]\s*)+)/);
    if (!head) continue;
    const tags = [...head[1].matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
    const text = raw.slice(head[0].length)
      .replace(/<\d+:\d+(?:[.:]\d+)?>/g, '')      // LRC "melhorado": <00:12.34> antes de cada palavra
      .replace(/\[[^\]]*\]/g, '')                  // marcações no meio da frase
      .replace(/\s+/g, ' ').trim();
    if (NETEASE_CREDIT.test(text)) continue;       // créditos da NetEase (sem apagar verso com ":")
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
