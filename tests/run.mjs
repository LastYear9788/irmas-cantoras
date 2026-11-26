// Testes automáticos (sem navegador). Rodar com:  node tests/run.mjs
import { Scorer, syllables } from '../js/score.js';
import { detectPitch, VoiceGate, SignalWatch, fftSizeFor, decimationFor, detectPitchDecimated } from '../js/pitch.js';
import { assignParts, ALL } from '../js/parts.js';
import { parseLRC, buildQueries, normName, findLyrics, findLyricVersions } from '../js/lyrics.js';
import { extractVideoId } from '../js/youtube.js';
import proxyWorker from '../proxy/worker.js';
import { cleanName } from '../js/net.js';
import { createLog, analyze } from '../js/singlog.js';
import { sanitizeAvatar, randomAvatar, vowelAt, AV_DEFAULT } from '../js/avatar.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✔ ' + name); }
  catch (e) { failed++; console.log('  ✘ ' + name + '\n      ' + e.message); }
}
function assert(c, msg) { if (!c) throw new Error(msg); }
const near = (a, b, tol, what) => assert(Math.abs(a - b) <= tol, `${what}: ${a} (esperado ${b} ± ${tol})`);

// ---------- uma "música" de teste ----------
const WORDS = ['eu quero te ver de novo amor', 'nunca vou desistir de você', 'a noite inteira sem parar',
  'quando a gente se encontrar', 'você sabe que eu sou assim', 'deixa a música tocar'];
function makeLines() {
  const lines = []; let t = 4;
  for (let i = 0; i < 24; i++) {
    const pause = i % 6 === 5 ? 6 : 0.4;
    lines.push({ t, end: t + 2.6 + pause, text: WORDS[i % WORDS.length] });
    t += 3 + (i % 6 === 5 ? 6 : 0);
  }
  return lines;
}
const lines = makeLines();
const allWho = lines.map(() => ALL);
const lineAt = (ls, t) => { let k = -1; for (let i = 0; i < ls.length; i++) { if (ls[i].t <= t) k = i; else break; } return k >= 0 && t < ls[k].end ? k : -1; };

// roda a música com "ticks" a cada 1/hz segundos (jogo normal = 25, janela minimizada = 1)
function play(ls, who, me, hz, sing, opts, jitter = 0) {
  const s = new Scorer(ls, who, me, opts);
  const endT = ls[ls.length - 1].end + 1;
  let lt = 0, seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  while (lt < endT) {
    const dt = (1 / hz) * (1 + (rnd() - 0.5) * jitter);
    lt += dt;
    s.frame(lineAt(ls, lt), lt, sing(lt), dt);
  }
  return s;
}

// cantora simulada: sílabas de 0,3s (o volume cai entre elas), melodia em dó maior, entra 0,2s depois
const SCALE = [0, 2, 4, 5, 7, 9, 11, 12];
const hzOf = (semi, cents = 0) => 261.63 * Math.pow(2, (semi * 100 + cents) / 1200);
function singer(o = {}) {
  return (t) => {
    const i = lines.findIndex((l) => t >= l.t + 0.2 + (o.late || 0) && t < l.t + 2.5);
    if (i < 0 || (o.only && !o.only(i))) return { voiced: false, pitch: 0, clarity: 0, rms: 0.002 };
    const x = t - lines[i].t - 0.2 - (o.late || 0), k = Math.floor(x / 0.3), ph = (x % 0.3) / 0.3;
    if (ph > 0.85) return { voiced: false, pitch: 0, clarity: 0, rms: 0.01 };     // consoante
    const semi = o.notes ? o.notes(i, k) : SCALE[(i * 3 + k) % SCALE.length];
    const c = (o.offset || 0) + (o.vibrato ? o.vibrato * Math.sin(t * 2 * Math.PI * 5.5) : 0) + (o.err ? o.err(i, k) : 0);
    return { voiced: true, pitch: hzOf(semi, c), clarity: 0.9, rms: 0.08 * Math.sin(Math.PI * Math.min(1, ph / 0.85)) + 0.03 };
  };
}
const good = singer();
const silent = () => ({ voiced: false, pitch: 0, clarity: 0, rms: 0.002 });
const total = (sing, hz = 25, opts) => play(lines, allWho, 0, hz, sing, opts).final().total;

console.log('\nPontuação');
test('cantora afinada passa de 9.000', () => { const t = total(good); assert(t > 9000, 'deu ' + t); });
test('a nota não depende da velocidade do PC (25, 15, 8, 4 e 1 leitura por segundo)', () => {
  const ref = total(good);
  for (const hz of [15, 8, 4, 1]) near(play(lines, allWho, 0, hz, good, {}, 0.4).final().total, ref, 900, `${hz} leituras/s`);
});
test('em silêncio a nota é 0', () => assert(total(silent) === 0, 'não deu 0'));
test('cantar metade das linhas dá mais ou menos metade', () => {
  const t = total(singer({ only: (i) => i % 2 === 0 }));
  assert(t > 4000 && t < 5800, 'deu ' + t);
});
test('respirar entre sílabas e no fim da frase não tira Fôlego', () => {
  const r = play(lines, allWho, 0, 25, good).final();
  assert(r.presence >= 95, 'Fôlego ' + r.presence + '%');
});
test('vibrato (±45 cents) quase não tira ponto', () => {
  const r = play(lines, allWho, 0, 25, singer({ vibrato: 45 })).final();
  assert(r.tune >= 85 && r.timbre >= 90 && r.total > 9000, JSON.stringify(r));
});
test('música gravada fora do lá 440 (−35 cents): quem canta junto não perde ponto', () => {
  near(total(singer({ offset: -35 })), total(good), 200, 'nota');
});
test('desafinar de verdade (erros variados até ±45 cents) tira bastante', () => {
  const r = play(lines, allWho, 0, 25, singer({ err: (i, k) => ((i * 7 + k * 13) % 91) - 45 })).final();
  assert(r.tune < 75 && r.total < total(good) - 900, JSON.stringify(r));
});
test('notas fora do tom da música tiram ponto', () => {
  const r = play(lines, allWho, 0, 25, singer({ notes: (i, k) => (i * 5 + k * 7) % 12 })).final();
  assert(r.tune < 85, 'afinação ' + r.tune);
});
test('trapaça: "aaaa" numa nota só, sem sílabas, fica bem atrás de quem canta', () => {
  const t = total(() => ({ voiced: true, pitch: 220, clarity: 0.95, rms: 0.08 }));
  assert(t < 7600, 'deu ' + t);
  const off = total(singer({ err: (i, k) => ((i * 7 + k * 13) % 91) - 45 }));
  assert(t < off, `"aaaa" (${t}) não pode ganhar de quem canta desafinado (${off})`);
});
test('trapaça: zumbido em notas aleatórias fica ainda mais atrás', () => {
  const t = total((x) => ({ voiced: true, pitch: 200 * Math.pow(2, (Math.floor(x * 3) * 37 % 100) / 1200 + (Math.floor(x * 3) % 17) / 17), clarity: 0.9, rms: 0.08 }));
  assert(t < 7200, 'deu ' + t);
});
test('ordem justa: afinada > amadora > desafinada > trapaça', () => {
  const a = total(good), b = total(singer({ err: (i, k) => ((i * 7 + k * 13) % 41) - 20 }));
  const c = total(singer({ err: (i, k) => ((i * 7 + k * 13) % 91) - 45 })), d = total(() => ({ voiced: true, pitch: 220, clarity: 0.95, rms: 0.08 }));
  assert(a >= b && b > c && c > d, [a, b, c, d].join(' > '));
});
test('entrar atrasada tira ponto do ritmo; fone bluetooth dá tolerância', () => {
  const late = play(lines, allWho, 0, 25, singer({ late: 0.45 })).final();
  const lateBt = play(lines, allWho, 0, 25, singer({ late: 0.45 }), { latency: 0.25 }).final();
  assert(late.rhythm < 95 && lateBt.rhythm > late.rhythm, `${late.rhythm} x bluetooth ${lateBt.rhythm}`);
});
test('a nota ao vivo só sobe durante a música', () => {
  const s = new Scorer(lines, allWho, 0);
  let prev = 0, rises = 0;
  for (let lt = 0; lt < 40; lt += 0.04) {
    s.frame(lineAt(lines, lt), lt, good(lt), 0.04);
    if (Math.round(lt * 25) % 25) continue;    // o jogo calcula 1x por segundo
    const v = s.live(); if (v > prev) rises++; assert(v >= prev - 150, `a nota ao vivo caiu de ${prev} pra ${v}`); prev = Math.max(prev, v);
  }
  assert(rises >= 8 && prev > 2000, `subiu ${rises} vezes, chegou a ${prev}`);
});
test('avaliação de cada linha: "perfeito" pra quem canta bem, nada pra linha da outra', () => {
  const who = assignParts(lines, 'turns', 2);
  const s = play(lines, who, 0, 25, good);
  const mine = who.findIndex((w) => w === 0), other = who.findIndex((w) => w === 1);
  const r = s.lineResult(mine);
  assert(r && r.v >= 0.92 && r.points > 0, JSON.stringify(r));
  assert(s.lineResult(other) === null, 'linha da outra deu nota');
  assert(s.final().perfect >= 5, 'linhas perfeitas: ' + s.final().perfect);
});
test('no revezamento, cantar na vez da outra não conta', () => {
  const who = assignParts(lines, 'turns', 2);
  const t = play(lines, who, 0, 25, (x) => { const a = lineAt(lines, x); return a >= 0 && who[a] === 1 ? good(x) : silent(); }).final().total;
  assert(t === 0, 'deu ' + t);
});
test('nunca passa de 10.000, nem com linhas curtinhas', () => {
  const short = []; for (let i = 0; i < 30; i++) short.push({ t: i * 0.5, end: i * 0.5 + 0.35, text: 'lá' });
  short.push({ t: 20, end: 22, text: 'lá lá lá' });
  const t = play(short, short.map(() => ALL), 0, 60, () => ({ voiced: true, pitch: 440, clarity: 0.9, rms: 0.05 })).final().total;
  assert(t <= 10000, 'deu ' + t);
});
test('encerrar no meio (até no comecinho de uma linha) conta só o que tocou', () => {
  for (const stop of [lines[6].end, lines[6].t + 0.05]) {
    const s = new Scorer(lines, allWho, 0);
    for (let lt = 0; lt < stop; lt += 0.04) s.frame(lineAt(lines, lt), lt, good(lt), 0.04);
    assert(s.final().total > 9000, 'deu ' + s.final().total);
  }
});
test('vídeo travado (tempo pulando 5s) não vira ponto de graça', () => {
  const s = new Scorer(lines, allWho, 0);
  s.frame(1, lines[1].t + 0.3, good(lines[1].t + 0.3), 5);
  assert(s.stats[1].time <= 1.2, 'contou ' + s.stats[1].time + 's');
});
test('vídeo travado quase a música toda: 2 linhas bem cantadas não viram nota cheia', () => {
  const s = new Scorer(lines, allWho, 0);
  for (let lt = 0; lt < lines[1].end; lt += 0.04) s.frame(lineAt(lines, lt), lt, good(lt), 0.04);
  for (let i = 2; i < lines.length; i++) s.frame(i, lines[i].t + 0.1, good(lines[i].t + 0.1), 0);   // passou sem medir
  const t = s.final().total;
  assert(t < 2000, 'deu ' + t);
  // travadinha curta (algumas linhas sem medir) continua sem prejudicar
  const s2 = new Scorer(lines, allWho, 0);
  for (let lt = 0; lt < lines[lines.length - 1].end + 1; lt += 0.04) {
    const i = lineAt(lines, lt);
    if (i >= 5 && i <= 7) { s2.frame(i, lt, good(lt), 0); continue; }
    s2.frame(i, lt, good(lt), 0.04);
  }
  assert(s2.final().total > 9000, 'travadinha curta deu ' + s2.final().total);
});
test('linhas emendadas (sem pausa entre elas) contam as sílabas igual a linhas separadas', () => {
  // voz alta bem na troca de linha: a 1ª sílaba da linha nova tem que contar
  const L = [{ t: 0, end: 2.13, text: 'la la la la la la' }, { t: 2.13, end: 4.1, text: 'la la la la la la' }];
  const voice = (t) => { const ph = (t % 0.3) / 0.3; return ph > 0.85 ? { voiced: false, pitch: 0, rms: 0.01, clarity: 0 } : { voiced: true, pitch: 262, clarity: 0.9, rms: 0.03 + 0.08 * Math.sin(Math.PI * ph / 0.85) }; };
  const run = (gapTick) => {
    const s = new Scorer(L, [ALL, ALL], 0);
    for (let lt = 0; lt < 4.1; lt += 0.02) {
      let i = lt < 2.13 ? 0 : 1;
      if (gapTick && lt >= 2.13 && lt < 2.15) i = -1;   // "separadas": uma leitura fora de linha na troca
      s.frame(i, lt, voice(lt), 0.02);
    }
    return s.stats[1].nuclei;
  };
  assert(run(false) === run(true), `emendadas ${run(false)} x separadas ${run(true)}`);
});
test('detector pulando de oitava não estraga a afinação', () => {
  const r = play(lines, allWho, 0, 25, (t) => { const m = good(t); if (m.voiced && Math.floor(t * 25) % 9 === 0) m.pitch *= 2; return m; }).final();
  assert(r.tune >= 90, 'afinação ' + r.tune);
});
test('conta sílabas da letra', () => {
  assert(syllables('nunca vou desistir de você') === 9, 'pt: ' + syllables('nunca vou desistir de você'));
  assert(syllables('') === 1 && syllables('愛してる') === 4, 'vazio / japonês');
});

// ---------- sinal de microfone sintético (caminho completo: áudio → porteiro → detector → nota) ----------
const RATE = 48000;
function synth(seconds, at, noise = 0.004, vol = 0.12) {
  const n = Math.floor(seconds * RATE), out = new Float32Array(n);
  let ph = 0, seed = 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; };
  for (let i = 0; i < n; i++) {
    const t = i / RATE, x = at(t);
    let v = 0;
    if (x) { ph += 2 * Math.PI * x.f / RATE; v = vol * x.a * (Math.sin(ph) + 0.5 * Math.sin(2 * ph + 1) + 0.3 * Math.sin(3 * ph + 2) + 0.15 * Math.sin(4 * ph)); }
    out[i] = v + noise * rnd();
  }
  return out;
}
// voz cantando as sílabas (sobe e desce o volume a cada sílaba), notas da escala, vibrato leve
const voice = (div = 1) => (t) => {
  const i = lines.findIndex((l) => t >= l.t + 0.2 && t < l.t + 2.5);
  if (i < 0) return null;
  const x = t - lines[i].t - 0.2, k = Math.floor(x / 0.3), ph = (x % 0.3) / 0.3;
  if (ph > 0.85) return null;
  return { f: hzOf(SCALE[(i * 3 + k) % SCALE.length] - 12, 15 * Math.sin(t * 2 * Math.PI * 5.5)) / div, a: 0.4 + 0.6 * Math.sin(Math.PI * Math.min(1, ph / 0.85)) };
};
/** o mesmo que mic.read() faz: janela de 2048, meia taxa, porteiro de ruído, detector */
function reader() {
  const gate = new VoiceGate(), half = new Float32Array(1024);
  return (audio, t) => {
    const end = Math.floor(t * RATE), start = end - 2048;
    if (start < 0 || end > audio.length) return { voiced: false, pitch: 0, loud: false, clarity: 0, rms: 0 };
    const buf = audio.subarray(start, end);
    let sum = 0; for (let i = 0; i < 2048; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / 2048);
    let r = { pitch: 0, clarity: 0 };
    if (rms > gate.threshold()) { for (let i = 0; i < 1024; i++) half[i] = (buf[2 * i] + buf[2 * i + 1]) * 0.5; r = detectPitch(half, RATE / 2); }
    const g = gate.update(rms, r.pitch);
    return { rms, voiced: g.voiced, loud: g.loud, pitch: g.voiced ? r.pitch : 0, clarity: g.voiced ? r.clarity : 0 };
  };
}
const songScore = (audio, hz) => { const read = reader(); return play(lines, allWho, 0, hz, (lt) => read(audio, lt)).final(); };

console.log('\nMicrofone → nota (caminho completo)');
const songEnd = lines[lines.length - 1].end + 1;
const sung = synth(songEnd, voice());
test('cantando afinado: nota alta, parecida em PC rápido, fraco e janela minimizada', () => {
  const fast = songScore(sung, 25).total, slow = songScore(sung, 8).total, min = songScore(sung, 1).total;
  assert(fast > 8500, 'PC rápido deu ' + fast);
  near(slow, fast, 900, 'PC fraco (8/s)');
  near(min, fast, 1500, 'janela minimizada (1/s)');
});
test('microfone baixinho (notebook longe) ainda conta', () => {
  const t = songScore(synth(songEnd, voice(), 0.002, 0.02), 25).total;
  assert(t > 7500, 'deu ' + t);
});
test('ligou o microfone com barulho/alguém falando: o app não fica surdo depois', () => {
  const n = synth(songEnd, voice(), 0.004, 0.06);
  let seed = 42;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647) * 2 - 1; };
  for (let i = 0; i < 3 * RATE; i++) n[i] += 0.09 * Math.sin(i * 0.37) * Math.sin(i * 0.011) + 0.05 * rnd();
  const t = songScore(n, 25).total;
  assert(t > 7500, 'deu ' + t);
});
test('só chiado/barulho no microfone não ganha ponto', () => {
  const t = songScore(synth(songEnd, () => null, 0.08), 25).total;
  assert(t < 1000, 'deu ' + t);
});
test('silêncio total no microfone = 0', () => assert(songScore(new Float32Array(Math.ceil(songEnd * RATE)), 25).total === 0, 'não deu 0'));
test('voz grave (homem, ~100 Hz) com microfone chiando conta', () => {
  const t = songScore(synth(songEnd, voice(2), 0.05, 0.1), 25).total;
  assert(t > 7000, 'deu ' + t);
});

console.log('\nDetector de afinação');
const cents = (a, b) => Math.abs(1200 * Math.log2(a / b));
test('acha a nota certa de 68 Hz a 1046 Hz (erro < 15 cents)', () => {
  for (const f of [68, 82, 110, 165, 220, 330, 440, 660, 880, 1046]) {
    const b = synth(0.05, () => ({ f, a: 1 })).subarray(0, 2048), h = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) h[i] = (b[2 * i] + b[2 * i + 1]) / 2;
    const r = detectPitch(h, RATE / 2);
    assert(r.pitch && cents(r.pitch, f) < 15, `${f} Hz -> ${r.pitch.toFixed(1)}`);
  }
});
test('voz masculina grave (90 Hz) com respiração/ar natural não some no detector', () => {
  const buf = new Float32Array(1024);
  let lp = 0, seed = 13;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; };
  for (let i = 0; i < buf.length; i++) {
    lp = lp * 0.88 + rnd() * 0.03;
    buf[i] = 0.08 * (Math.sin(2 * Math.PI * 90 * i / (RATE / 2)) + 0.25 * Math.sin(4 * Math.PI * 90 * i / (RATE / 2))) + lp;
  }
  const r = detectPitch(buf, RATE / 2);
  assert(r.pitch > 84 && r.pitch < 96, `90 Hz -> ${r.pitch.toFixed(1)} (clarity ${r.clarity.toFixed(2)})`);
});
test('microfone com deslocamento DC (+0,05) ainda reconhece a voz', () => {
  const buf = new Float32Array(1024);
  let lp = 0, seed = 13;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; };
  for (let i = 0; i < buf.length; i++) {
    lp = lp * 0.88 + rnd() * 0.025;
    buf[i] = 0.05 + 0.08 * Math.sin(2 * Math.PI * 100 * i / (RATE / 2)) + lp;
  }
  const r = detectPitch(buf, RATE / 2);
  assert(r.pitch > 94 && r.pitch < 106, `100 Hz + DC -> ${r.pitch.toFixed(1)}`);
});
test('VoiceGate calibrado mantém microfone baixo funcionando e não trava com consoantes altas', () => {
  const g = new VoiceGate({ floor: 0.001, voice: 0.01 });
  assert(g.threshold() < 0.006, 'threshold alto demais: ' + g.threshold());
  // simula 10 quadros curtos de consoante alta sem pitch (não pode subir o piso acima da voz)
  for (let i = 0; i < 10; i++) g.update(0.05, 0);
  const res = g.update(0.009, 150);
  assert(res.voiced, 'voz baixa sumiu depois de consoantes (th=' + g.threshold().toFixed(4) + ')');
});
test('leitura é leve o bastante pra PC fraco (< 1,5 ms aqui)', () => {
  const b = synth(0.05, () => ({ f: 220, a: 1 })).subarray(0, 1024), t0 = performance.now();
  for (let i = 0; i < 300; i++) detectPitch(b, RATE / 2);
  const ms = (performance.now() - t0) / 300;
  assert(ms < 1.5, ms.toFixed(2) + ' ms');
});
test('pontuação ao vivo é leve (música de 80 linhas: < 2 ms por cálculo)', () => {
  const big = []; for (let i = 0; i < 80; i++) big.push({ t: i * 3, end: i * 3 + 2.8, text: WORDS[i % 6] });
  const s = new Scorer(big, big.map(() => ALL), 0);
  for (let lt = 0; lt < 240; lt += 0.04) s.frame(lineAt(big, lt), lt, { voiced: true, pitch: 220 + (lt % 3) * 20, clarity: 0.9, rms: 0.05 }, 0.04);
  const t0 = performance.now(); for (let i = 0; i < 50; i++) s.live();
  const ms = (performance.now() - t0) / 50;
  assert(ms < 2, ms.toFixed(2) + ' ms');
});

console.log('\nMicrofone mudo x microfone com filtro');
{
  // simula leituras a cada 30ms: kind = 'zero' | 'voz' | 'igual'
  const feed = (w, t0, ms, kind) => {
    for (let t = t0; t < t0 + ms; t += 30) {
      if (kind === 'zero') w.update(0, 0, null, t);
      else if (kind === 'igual') w.update(0.1, 0.1, 'x', t);
      else w.update(0.1, 0.1, 's' + t, t);
    }
    return t0 + ms;
  };
  test('mudo de verdade (só zero desde o começo) avisa', () => {
    const w = new SignalWatch(); const t = feed(w, 0, 3000, 'zero');
    assert(w.problem(t) === 'silent', 'deu ' + w.problem(t));
  });
  test('filtro que zera quando quieta (calibração começa em silêncio) NÃO é mudo depois que canta', () => {
    const w = new SignalWatch(); let t = feed(w, 0, 2000, 'zero');
    t = feed(w, t, 3000, 'voz');
    assert(w.problem(t) === null, 'deu ' + w.problem(t));
  });
  test('zero longo entre frases (ou na vez da outra) depois de já ter ouvido som não é mudo', () => {
    const w = new SignalWatch(); let t = feed(w, 0, 500, 'voz');
    t = feed(w, t, 60000, 'zero');
    assert(w.problem(t) === null && w.gated, 'deu ' + w.problem(t));
  });
  test('áudio travado (mesmo som repetido) avisa e some quando volta a andar', () => {
    const w = new SignalWatch(); let t = feed(w, 0, 3000, 'igual');
    assert(w.problem(t) === 'frozen', 'não avisou');
    t = feed(w, t, 100, 'voz');
    assert(w.problem(t) === null, 'não limpou');
  });
}

console.log('\nBonequinha');
test('visual que chega pela rede só aceita opções conhecidas', () => {
  const c = sanitizeAvatar({ hair: '<img onerror=x>', hairColor: 'red;}', outfit: 'moletom', main: '#ffffff', blush: 'sim', extra: 1 });
  assert(c.hair === AV_DEFAULT.hair && c.hairColor === AV_DEFAULT.hairColor, JSON.stringify(c));
  assert(c.outfit === 'moletom' && c.main === '#ffffff' && c.blush === true && !('extra' in c), JSON.stringify(c));
  assert(JSON.stringify(sanitizeAvatar(null)) === JSON.stringify(AV_DEFAULT), 'vazio');
  for (let i = 0; i < 30; i++) { const r = randomAvatar(); assert(JSON.stringify(sanitizeAvatar(r)) === JSON.stringify(r), 'sorteio inválido'); }
});
test('vogal da sílaba cantada segue a letra', () => {
  const t = 'Nunca vou desistir de você';   // nu-nca-vou-de-sis-tir-de-vo-cê (9)
  const at = (p) => vowelAt(t, p).vowel;
  assert(at(0) === 'u' && at(0.15) === 'a' && at(0.25) === 'o' && at(0.99) === 'e', [0, 0.15, 0.25, 0.99].map(at).join(','));
  assert(vowelAt('quero', 0).vowel === 'e', 'qu: o u não soa');
  assert(vowelAt('', 0.5).vowel === 'a' && vowelAt('♪', 0.5).vowel === 'a', 'sem vogal');
  assert(vowelAt(t, 0).idx === 0 && vowelAt(t, 0.99).idx === 8, 'índice da sílaba');
});
test('vogal e ritmo da boca funcionam em japonês, chinês e coreano', () => {
  for (const s of ['夜に駆ける', '月亮代表我的心', '사랑해요']) {
    const a = vowelAt(s, 0), b = vowelAt(s, 0.5), c = vowelAt(s, 0.99);
    assert(a.idx === 0 && b.idx > a.idx && c.idx > b.idx, `${s}: ${a.idx}, ${b.idx}, ${c.idx}`);
    assert('aeiou'.includes(a.vowel) && 'aeiou'.includes(b.vowel), `${s}: vogal inválida`);
  }
});

console.log('\nRelatório de diagnóstico');
test('relatório registra, vira JSON e a análise acha o momento que parou de contar', () => {
  let now = 0;
  const log = createLog({ version: 'teste', song: { title: 'Música' } }, () => now);
  for (let k = 0; k < 1500; k++, now += 40) {   // 60s a 25x/s; depois de 30s o corte sobe acima da voz
    const late = k > 750;
    // voz de verdade sobe e desce; nos últimos 10s, só ruído parado (não chegou voz)
    const rms = k > 1250 ? 0.006 : k % 10 < 5 ? 0.033 : 0.015;
    log.tick({ lt: k * 0.04, active: 0, mine: true, yt: 1, dt: 0.04, rms, threshold: late ? 0.035 : 0.01, floor: 0.004,
      peak: 0.1, rawPitch: 220, rawClarity: 0.9, voiced: !late, loud: !late, problem: null, src: 'main' });
  }
  log.event('aviso', 'quiet');
  log.finish({ final: { total: 5000, presence: 50, tune: 90, timbre: 90, rhythm: 90 } });
  const back = JSON.parse(JSON.stringify(log));
  assert(back.rows === 1500 && back.cols.rms.length === 1500 && !back.tick, 'JSON errado');
  const txt = analyze(back);
  assert(/voz baixa demais/.test(txt) && /quase não contou/.test(txt) && /volume típico \d+ vs corte 350/.test(txt), txt);
  assert(/parado\)\s+1[67]%/.test(txt), txt);
});
test('relatório guarda tempos inteiros em ms (mesmo com performance.now fracionário)', () => {
  let now = 100.123456;
  const log = createLog({ version: 'teste' }, () => now);
  now += 40.6789;
  log.tick({ lt: 1.2, active: 0, mine: true, yt: 1, dt: 0.04, rms: 0.02, threshold: 0.01, floor: 0.004, peak: 0.1, rawPitch: 220, rawClarity: 0.9, voiced: true, loud: true, problem: null, src: 'main' });
  log.event('teste', 1);
  assert(Number.isInteger(log.cols.t[0]) && log.cols.t[0] === 41, 't=' + log.cols.t[0]);
  assert(Number.isInteger(log.ev[0][0]) && log.ev[0][0] === 41, 'ev t=' + log.ev[0][0]);
});

console.log('\nDivisão das partes');
test('toda linha tem dona e as duas cantam parecido', () => {
  const who = assignParts(lines, 'turns', 2);
  assert(who.length === lines.length && who.every((w) => w === ALL || w === 0 || w === 1), 'linha sem dona');
  const a = who.filter((w) => w === 0).length, b = who.filter((w) => w === 1).length;
  assert(Math.abs(a - b) <= 4, `${a} x ${b}`);
});
test('modo juntas e sozinha: tudo de todas', () => {
  assert(assignParts(lines, 'together', 3).every((w) => w === ALL), 'juntas');
  assert(assignParts(lines, 'turns', 1).every((w) => w === ALL), 'sozinha');
});
test('revezamento em japonês/coreano separa refrão e versos normalmente', () => {
  const mk = (texts) => texts.map((text, i) => ({ t: i * 3, end: i * 3 + 2.5, text }));
  // 4 versos únicos (com refrão repetido entre eles -> useChorus = true)
  const song = mk([
    '静かな夜に歩いてる', '遠くの街が見えるよ',
    '사랑해요 너를 사랑해', '사랑해요 영원히 함께',
    '風が少し冷たいね', '君の名前を呼んだよ',
    '사랑해요 너를 사랑해', '사랑해요 영원히 함께',
    '星がそっと瞬いて', '明日の朝を待ってる',
    '사랑해요 너를 사랑해', '사랑해요 영원히 함께',
    'もうすぐ日が昇るよ', '笑顔でまた会おうね',
  ]);
  const who = assignParts(song, 'turns', 2);
  assert(who[2] === ALL && who[3] === ALL && who[6] === ALL && who[7] === ALL && who[10] === ALL && who[11] === ALL, 'refrão não ficou de todas: ' + JSON.stringify(who));
  assert(who[0] !== ALL && who[4] !== ALL && who[0] !== who[4], 'versos não alternaram: ' + JSON.stringify(who));
});
test('palavras reservadas do JS ("constructor", "toString") não quebram a divisão', () => {
  const mk = (texts) => texts.map((text, i) => ({ t: i * 3, end: i * 3 + 2.5, text }));
  const song = mk(['constructor', 'toString', 'valueOf', 'linha quatro', 'constructor', 'toString', 'linha sete', 'linha oito', 'linha nove', 'linha dez']);
  const who = assignParts(song, 'turns', 2);
  assert(who.length === song.length && who.every((w) => w === ALL || w === 0 || w === 1), JSON.stringify(who));
});
test('estrofe de 5 linhas divide em 3+2 (e não 4+1)', () => {
  // 2 estrofes de 5 linhas únicas (separadas por pausa > 3s)
  const song = [
    ...[0, 1, 2, 3, 4].map((i) => ({ t: i * 2, end: i * 2 + 1.8, text: `verso um linha ${i}` })),
    ...[0, 1, 2, 3, 4].map((i) => ({ t: 20 + i * 2, end: 20 + i * 2 + 1.8, text: `verso dois linha ${i}` })),
  ];
  const who = assignParts(song, 'turns', 2);
  // 1ª estrofe: [0,0,0,1,1] (3+2, não 4+1)
  assert(who[0] === who[1] && who[1] === who[2] && who[2] !== who[3] && who[3] === who[4], '1ª estrofe: ' + JSON.stringify(who.slice(0, 5)));
});

console.log('\nLetras');
test('lê LRC, junta dueto e pula linha vazia', () => {
  const l = parseLRC('[00:01.00]Oi\n[00:03.50]\n[00:05.00]A\n[00:05.00]B\n[00:07.2]Fim');
  assert(l.length === 3, 'deu ' + l.length + ' linhas');
  assert(l[1].text === 'A / B', 'dueto: ' + l[1].text);
  near(l[0].end, 3.5, 0.001, 'fim da linha 1');
});
test('LRC melhorado (<tempo> / [tempo] no meio) limpa marcações sem duplicar linha, e mantém [t1][t2] repetido', () => {
  const l = parseLRC([
    '[00:01.00]<00:01.00>Olá <00:01.50>mundo',
    '[00:04.00]Palavra [00:04.80]no meio',
    '[00:08.00][00:20.00]Refrão repetido',
  ].join('\n'));
  assert(l.length === 4, 'esperado 4 linhas, deu ' + l.length + ': ' + JSON.stringify(l));
  assert(l[0].text === 'Olá mundo', 'enhanced: ' + l[0].text);
  assert(l[1].text === 'Palavra no meio', 'inline: ' + l[1].text);
  assert(l[2].text === 'Refrão repetido' && l[3].text === 'Refrão repetido', 'repetido');
  near(l[3].t, 20, 0.001, 'tempo da repetição');
});
test('filtra créditos da NetEase sem apagar versos em japonês/chinês com dois-pontos', () => {
  const l = parseLRC([
    '[00:00.00]作词 : 方文山',
    '[00:01.00]作曲：周杰伦',
    '[00:02.00]编曲 : 钟兴民',
    '[00:03.00]混音师 : João',
    '[00:05.00]午前0時: 君を待つ',
    '[00:08.00]君の答え：愛してる',
    '[00:11.00]爱：是一道光',
  ].join('\n'));
  assert(l.length === 3, 'esperado 3 versos reais, deu ' + l.length + ': ' + JSON.stringify(l.map((x) => x.text)));
  assert(l[0].text === '午前0時: 君を待つ' && l[1].text === '君の答え：愛してる' && l[2].text === '爱：是一道光', JSON.stringify(l));
});
test('extractVideoId aceita links do YouTube e recusa links falsos ou IDs quebrados', () => {
  const id = 'dQw4w9WgXcQ';
  for (const ok of [
    id,
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?si=abc&v=${id}&t=42s`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://music.youtube.com/watch?v=${id}&list=RD123`,
    `https://youtu.be/${id}?si=xyz`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/live/${id}/`,
    `https://www.youtube.com/v/${id}`,
    `youtu.be/${id}`,
    `youtube.com/watch?v=${id}`,
    `Olha essa música https://youtu.be/${id} boa demais`,
    `https://www.youtube.com/watch?other_v=12345678901&v=${id}`,
  ]) {
    assert(extractVideoId(ok) === id, `devia aceitar ${ok} -> ${extractVideoId(ok)}`);
  }
  for (const bad of [
    '',
    'abc',
    `${id}EXTRA`,
    `https://www.youtube.com/watch?v=${id}EXTRA`,
    'https://www.youtube.com/watch?other_v=12345678901',
    `https://evil.com/shorts/${id}`,
    `https://evil.com/watch?v=${id}`,
    `https://youtu.be/${id}EXTRA`,
    'https://www.youtube.com/playlist?list=PL12345678901',
    'https://www.youtube.com/@Anitta',
  ]) {
    assert(extractVideoId(bad) === null, `devia recusar ${bad} -> ${extractVideoId(bad)}`);
  }
});
test('monta busca a partir do título do vídeo', () => {
  const q = buildQueries('Anitta - Envolver (Official Music Video)', 'Anitta');
  assert(q.some((x) => x.artist_name === 'Anitta' && x.track_name === 'Envolver'), JSON.stringify(q[0]));
});
test('cleanName remove caracteres invisíveis/de controle e limita tamanho', () => {
  assert(cleanName('  \u0000Bia\u200b  \n ') === 'Bia', 'deu: ' + JSON.stringify(cleanName('  \u0000Bia\u200b  \n ')));
  assert(cleanName('\u0000\u0007   ') === 'Amiga', 'vazio');
  assert(cleanName('NomeMuitoCompridoDemaisMesmo').length === 16, 'limite 16');
});

console.log('\nPlacas de som (44,1 a 192 kHz)');
// voz com 3 harmônicos, como o microfone entrega (leitura do tamanho que mic.js usa)
function voiceAt(rate, f) {
  const b = new Float32Array(fftSizeFor(rate));
  for (let i = 0; i < b.length; i++) {
    const t = i / rate;
    b[i] = 0.1 * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.25 * Math.sin(6 * Math.PI * f * t));
  }
  return b;
}
test('a janela lida tem ~43 ms e ~1024 amostras pro detector em qualquer taxa', () => {
  for (const rate of [44100, 48000, 88200, 96000, 176400, 192000]) {
    const n = fftSizeFor(rate), d = decimationFor(rate);
    assert((n & (n - 1)) === 0, `${rate}: ${n} não é potência de 2`);
    assert(n / rate > 0.04, `${rate}: janela de ${(1000 * n / rate).toFixed(1)} ms`);
    assert(n / d === 1024, `${rate}: ${n / d} amostras pro detector`);
  }
});
test('voz grave e aguda é reconhecida igual a 48, 96 e 192 kHz (erro < 15 cents)', () => {
  for (const rate of [44100, 48000, 96000, 192000]) {
    const h = new Float32Array(fftSizeFor(rate) / decimationFor(rate));
    for (const f of [70, 90, 110, 220, 440, 880]) {
      const r = detectPitchDecimated(voiceAt(rate, f), rate, h);
      assert(r.pitch && cents(r.pitch, f) < 15, `${rate} Hz, ${f} Hz -> ${r.pitch.toFixed(1)}`);
    }
  }
});

console.log('\nBusca de letra');
test('nome de música em coreano, russo e grego não some ao comparar', () => {
  assert(normName('사랑해 (Official MV)') !== '', 'coreano sumiu');
  assert(normName('사랑해 (Official MV)') === normName('사랑해'), 'coreano: ' + normName('사랑해 (Official MV)'));
  assert(normName('Катюша') === normName('катюша') && normName('Катюша') !== '', 'russo');
  assert(normName('Αγάπη') !== '', 'grego');
  assert(normName('Évidemment (Live)') === 'evidemment', 'latino: ' + normName('Évidemment (Live)'));
  assert(normName('夜に駆ける') === '夜に駆ける', 'japonês');
});

// testes que esperam a rede (falsa): fetch trocado por um de mentira durante o teste
async function atest(name, fn) {
  const realFetch = globalThis.fetch;
  try { await fn(); passed++; console.log('  ✔ ' + name); }
  catch (e) { failed++; console.log('  ✘ ' + name + '\n      ' + e.message); }
  finally { globalThis.fetch = realFetch; }
}
const jsonRes = (x, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'Content-Type': 'application/json' } });
const LRC = Array.from({ length: 8 }, (_, i) => `[00:${String(10 + i * 3).padStart(2, '0')}.00] linha ${i + 1} da música`).join('\n');

await atest('LRCLIB: versão acústica com duração mais parecida perde pra original', async () => {
  globalThis.fetch = async (url) => {
    if (String(url).includes('lrclib.net')) return jsonRes([
      { id: 1, trackName: 'Never Gonna Give You Up (Acoustic)', artistName: 'Rick Astley', duration: 213, syncedLyrics: LRC },
      { id: 2, trackName: 'Never Gonna Give You Up', artistName: 'Rick Astley', duration: 211, syncedLyrics: LRC },
    ]);
    throw new TypeError('sem rede no teste');
  };
  const r = await findLyrics('Rick Astley - Never Gonna Give You Up (Official Video)', 'Rick Astley', 213);
  assert(r.track === 'Never Gonna Give You Up', 'escolheu: ' + r.track);
});
await atest('busca pulada no meio não continua procurando nas outras fontes', async () => {
  const asked = [];
  let releaseA;
  const gateA = new Promise((r) => { releaseA = r; });
  globalThis.fetch = async (url) => {
    const u = decodeURIComponent(String(url));
    asked.push(u);
    if (u.includes('lrclib.net') && u.includes('Primeira')) { await gateA; return jsonRes([]); }
    if (u.includes('lrclib.net')) return jsonRes([{ id: 9, trackName: 'Segunda Cancao', artistName: 'Banda B', duration: 200, syncedLyrics: LRC }]);
    throw new TypeError('sem rede no teste');
  };
  const a = findLyrics('Banda A - Primeira Musica', 'Banda A', 180).then(() => 'achou', (e) => e.message);
  await new Promise((r) => setTimeout(r, 20));
  const b = await findLyrics('Banda B - Segunda Cancao', 'Banda B', 200);
  releaseA();
  const ra = await a;
  assert(b.track === 'Segunda Cancao', 'a nova não achou');
  assert(ra === 'cancelado', 'a velha terminou com: ' + ra);
  const extra = asked.filter((u) => u.includes('Primeira') && !u.includes('lrclib.net'));
  assert(!extra.length, 'a velha ainda perguntou: ' + extra.join(', '));
});

await atest('escolha manual lista letras com tempos diferentes mesmo quando o automático já encontrou a versão exata', async () => {
  const shifted = LRC.replace(/\[00:(\d+)\.00\]/g, (_, seconds) => '[00:' + (+seconds + 1) + '.00]');
  globalThis.fetch = async (url) => {
    if (!String(url).includes('lrclib.net')) return jsonRes({ data: [], result: { songs: [] } });
    return jsonRes([
      { id: 1, trackName: 'Minha Cancao', artistName: 'Minha Banda', duration: 200, syncedLyrics: LRC },
      { id: 2, trackName: 'Minha Cancao (Ao Vivo)', artistName: 'Minha Banda', albumName: 'Ao Vivo', duration: 215, syncedLyrics: shifted },
      { id: 3, trackName: 'Minha Cancao', artistName: 'Minha Banda', duration: 200, syncedLyrics: LRC },
      { id: 4, trackName: 'Outra Cancao', artistName: 'Minha Banda', duration: 200, syncedLyrics: LRC },
    ]);
  };
  const versions = await findLyricVersions('Minha Banda - Minha Cancao', 'Minha Banda', 200);
  assert(versions.length === 2, 'esperava original e ao vivo sem duplicatas: ' + versions.length);
  assert(versions[0].lines[0].t === 10 && versions[1].lines[0].t === 11, 'perdeu os tempos de cada versão');
  assert(versions[1].source === 'LRCLIB' && versions[1].album === 'Ao Vivo', 'faltou identificação da versão');
});

console.log('\nQuem só assiste');
test('espectadora (fora da lista de jogadoras) não é dona das linhas de "todas"', () => {
  const s = play(lines, allWho, -1, 25, singer());
  assert(s.mine.every((m) => !m), 'marcou linhas como dela');
  assert(s.final().total === 0, 'ganhou ponto: ' + s.final().total);
});

console.log('\nIntermediário (proxy/worker.js)');
const ORIGIN = 'https://lastyear9788.github.io';
const askProxy = (target, { method = 'GET', origin = ORIGIN, headers = {}, body } = {}) => proxyWorker.fetch(new Request(
  'https://proxy.test/?url=' + encodeURIComponent(target), { method, headers: { Origin: origin, ...headers }, body }));
await atest('recusa site de fora, destino fora da lista, porta, senha na URL e método errado', async () => {
  let called = 0;
  globalThis.fetch = async () => { called++; return jsonRes({}); };
  const cases = [
    ['site de fora', await askProxy('https://lrclib.net/api/search?q=x', { origin: 'https://malvado.com' }), 403],
    ['destino fora da lista', await askProxy('https://example.com/'), 403],
    ['porta', await askProxy('https://lrclib.net:8443/api'), 403],
    ['senha na URL', await askProxy('https://a:b@lrclib.net/api'), 403],
    ['http', await askProxy('http://lrclib.net/api'), 403],
    ['POST onde só pode GET', await askProxy('https://api.deezer.com/search', { method: 'POST', body: '{}' }), 403],
    ['GET onde só pode POST', await askProxy('https://pipe.deezer.com/api'), 403],
    ['outro caminho no pipe', await askProxy('https://pipe.deezer.com/outra', { method: 'POST', body: '{}' }), 403],
    ['corpo gigante', await askProxy('https://pipe.deezer.com/api', { method: 'POST', body: 'x'.repeat(20000) }), 413],
  ];
  for (const [what, res, want] of cases) {
    assert(res.status === want, `${what}: ${res.status} (esperado ${want})`);
    assert(res.headers.get('Access-Control-Allow-Origin'), `${what}: sem CORS`);
  }
  assert(called === 0, `chamou a fonte ${called}x`);
});
await atest('repassa o que o app usa; Authorization só vai pro pipe do Deezer', async () => {
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url, init }); return jsonRes({ ok: 1 }); };
  const r1 = await askProxy('https://music.163.com/api/search/get?s=x', { headers: { Authorization: 'Bearer segredo' } });
  const r2 = await askProxy('https://pipe.deezer.com/api', { method: 'POST', body: '{"q":1}', headers: { Authorization: 'Bearer abc', 'Content-Type': 'application/json' } });
  assert(r1.status === 200 && (await r1.json()).ok === 1, 'GET não repassou');
  assert(r2.status === 200, 'POST não repassou');
  assert(r1.headers.get('Access-Control-Allow-Origin') === ORIGIN, 'sem CORS');
  assert(!seen[0].init.headers.Authorization, 'mandou Authorization pro NetEase');
  assert(seen[1].init.headers.Authorization === 'Bearer abc' && seen[1].init.body === '{"q":1}', 'pipe sem Authorization/corpo');
  assert(seen.every((s) => s.init.redirect === 'manual' && s.init.signal), 'sem redirect manual/tempo limite');
});
await atest('redirecionamento e fonte fora do ar viram erro COM CORS (não "erro de CORS" no navegador)', async () => {
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { Location: 'https://interno.local/' } });
  const r1 = await askProxy('https://lrclib.net/api/search?q=x');
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  const r2 = await askProxy('https://lrclib.net/api/search?q=x');
  globalThis.fetch = async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); };
  const r3 = await askProxy('https://lrclib.net/api/search?q=x');
  assert(r1.status === 502 && r2.status === 502 && r3.status === 504, `${r1.status} ${r2.status} ${r3.status}`);
  assert([r1, r2, r3].every((r) => r.headers.get('Access-Control-Allow-Origin') === ORIGIN), 'sem CORS');
});

console.log(`\n${passed} passaram, ${failed} falharam\n`);
process.exit(failed ? 1 : 0);
