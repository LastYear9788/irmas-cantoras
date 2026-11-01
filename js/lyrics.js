// Busca automática de letra sincronizada no LRCLIB (grátis, sem cadastro).
// A pessoa só cola o link: aqui a gente tenta várias formas de achar a música pelo título do vídeo.

const API = 'https://lrclib.net/api/search';

// palavras que aparecem em título de vídeo e atrapalham a busca
const JUNK = [
  'official music video', 'official video', 'official audio', 'official lyric video', 'official visualizer',
  'music video', 'lyric video', 'lyrics video', 'lyrics', 'lyric', 'letra', 'legendado', 'tradução', 'traducao',
  'clipe oficial', 'videoclipe oficial', 'videoclipe', 'clipe', 'vídeo oficial', 'video oficial', 'áudio oficial', 'audio oficial',
  'visualizer', 'audio', 'áudio', 'official', 'oficial', 'remastered', 'remaster', 'hd', 'hq', '4k', 'mv', 'm/v', 'karaoke', 'karaokê',
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
  add({ q: clean });
  return qs;
}

async function search(params) {
  const url = API + '?' + new URLSearchParams(params).toString();
  const res = await fetch(url);
  if (!res.ok) throw Object.assign(new Error('http ' + res.status), { server: res.status >= 500 });
  return res.json();
}

/* ---------- conferir se é a mesma música (pelo nome) ---------- */
const normName = (x) => (x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9぀-鿿 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** o nome da música encontrada tem que aparecer no título do vídeo (e o artista também, se der) */
function sameSong(foundTrack, foundArtist, haystack) {
  const t = normName(foundTrack);
  if (!t || !(' ' + haystack + ' ').includes(' ' + t + ' ')) return false;
  const artists = normName(foundArtist).split(/ (?:feat|ft|and|e|x) | /).filter((w) => w.length > 2);
  return !artists.length || artists.some((w) => haystack.includes(w));
}

/* ---------- fonte 2: NetEase (via intermediário público, porque ela bloqueia o navegador) ---------- */
const PROXIES = [
  (u) => 'https://cors.eu.org/' + u,
  (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
];
let proxyIdx = 0;

async function proxied(url) {
  for (let n = 0; n < PROXIES.length; n++) {
    const i = (proxyIdx + n) % PROXIES.length;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 9000);
      const res = await fetch(PROXIES[i](url), { signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data = await res.json();
      proxyIdx = i;           // lembra qual funcionou
      return data;
    } catch (e) { /* tenta o próximo */ }
  }
  throw new Error('proxy');
}

async function neteaseFind(text, videoDuration, wantsVersion, hay) {
  const data = await proxied('https://music.163.com/api/search/get?type=1&limit=10&s=' + encodeURIComponent(text));
  const songs = (data.result && data.result.songs) || [];
  const cands = songs.map((s) => {
    const name = s.name || '';
    const diff = videoDuration ? Math.abs(s.duration / 1000 - videoDuration) : 0;
    const odd = !wantsVersion && /remix|cover|live|ao vivo|instrumental|karaoke|sped|slowed|bootleg/i.test(name) ? 30 : 0;
    return { s, score: diff + odd, diff };
  }).filter((c) => sameSong(c.s.name, (c.s.artists || []).map((a) => a.name).join(' '), hay))
    .sort((x, y) => x.score - y.score).slice(0, 3);

  for (const c of cands) {
    const ly = await proxied(`https://music.163.com/api/song/lyric?id=${c.s.id}&lv=-1&kv=-1&tv=-1`);
    const lrc = ly && ly.lrc && ly.lrc.lyric;
    if (!lrc) continue;
    const lines = parseLRC(lrc);
    if (lines.length >= 4) {
      return { lines, diff: c.diff, artist: (c.s.artists || []).map((a) => a.name).join(', '), track: c.s.name };
    }
  }
  return null;
}

/**
 * Procura a letra. Retorna { lines, artist, track } ou lança erro com mensagem amigável.
 * Ordem: LRCLIB -> NetEase. Tudo automático.
 */
export async function findLyrics(title, author, videoDuration) {
  const queries = buildQueries(title, author);
  const hay = normName(title + ' ' + cleanAuthor(author));
  let best = null;
  let lrclibDown = false;

  // 1) LRCLIB
  for (const q of queries) {
    let results;
    try { results = await search(q); }
    catch (e) { if (e.server || e instanceof TypeError) { lrclibDown = true; break; } continue; }

    for (const r of results || []) {
      if (!r.syncedLyrics || r.instrumental) continue;
      if (!sameSong(r.trackName, r.artistName, hay)) continue;
      const lines = parseLRC(r.syncedLyrics);
      if (lines.length < 4) continue;
      const diff = videoDuration ? Math.abs((r.duration || 0) - videoDuration) : 0;
      if (!best || diff < best.diff) best = { lines, diff, artist: r.artistName, track: r.trackName };
    }
    if (best && best.diff <= 4) return best;   // achou uma bem parecida
  }

  // 2) NetEase (se o LRCLIB caiu ou não achou nada bom)
  const wantsVersion = /remix|cover|live|ao vivo|acústico|acustico/i.test(title);
  let proxyDown = 0, tried = 0;
  const texts = [...new Set(queries.map((q) => q.q || `${q.artist_name} ${q.track_name}`))].slice(0, 3);
  for (const text of texts) {
    tried++;
    try {
      const r = await neteaseFind(text, videoDuration, wantsVersion, hay);
      if (r && (!best || r.diff < best.diff)) best = r;
      if (best && best.diff <= 4) break;
    } catch (e) { proxyDown++; }
  }

  if (!best) {
    if (lrclibDown && proxyDown === tried) throw new Error('Os sites de letras estão fora do ar agora 😢 Tenta de novo daqui a pouco.');
    throw new Error('Não achei a letra dessa música 😕 Tenta outro link (de preferência o clipe oficial ou o áudio oficial).');
  }
  return best;
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

  const lines = [];
  for (let i = 0; i < stamps.length; i++) {
    const s = stamps[i];
    if (!s.text || /^[♪♫\s.…-]*$/.test(s.text)) continue;   // linha vazia/instrumental
    const next = stamps[i + 1] ? stamps[i + 1].t : s.t + 5;
    lines.push({ t: s.t, end: Math.min(next, s.t + 10), text: s.text });
  }
  return lines;
}
