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

/**
 * Procura a letra. Retorna { lines, artist, track } ou lança erro com mensagem amigável.
 */
export async function findLyrics(title, author, videoDuration) {
  const queries = buildQueries(title, author);
  let best = null;
  let serverDown = 0;

  for (const q of queries) {
    let results;
    try { results = await search(q); }
    catch (e) { serverDown++; continue; }

    for (const r of results || []) {
      if (!r.syncedLyrics || r.instrumental) continue;
      const diff = videoDuration ? Math.abs((r.duration || 0) - videoDuration) : 0;
      if (!best || diff < best.diff) best = { r, diff };
    }
    if (best && best.diff <= 4) break;   // achou uma bem parecida, para de procurar
  }

  if (!best) {
    if (serverDown === queries.length) throw new Error('O site de letras está fora do ar agora 😢 Tenta de novo daqui a pouco.');
    throw new Error('Não achei a letra dessa música 😕 Tenta outro link (de preferência o clipe oficial ou o áudio oficial).');
  }

  const lines = parseLRC(best.r.syncedLyrics);
  if (lines.length < 4) throw new Error('A letra dessa música veio quebrada. Tenta outro link.');
  return { lines, artist: best.r.artistName, track: best.r.trackName };
}

/** "[01:23.45] texto" -> [{ t, end, text }] */
export function parseLRC(lrc) {
  const stamps = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
    if (!tags.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
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
