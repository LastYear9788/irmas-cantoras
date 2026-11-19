// Testes automáticos (sem navegador). Rodar com:  node tests/run.mjs
import { Scorer, syllables } from '../js/score.js';
import { detectPitch, VoiceGate } from '../js/pitch.js';
import { assignParts, ALL } from '../js/parts.js';
import { parseLRC, buildQueries } from '../js/lyrics.js';
import { cleanName } from '../js/net.js';

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
  for (let i = 0; i < 3 * RATE; i++) n[i] += 0.09 * Math.sin(i * 0.37) * Math.sin(i * 0.011) + 0.05 * (Math.random() * 2 - 1);
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

console.log('\nLetras');
test('lê LRC, junta dueto e pula linha vazia', () => {
  const l = parseLRC('[00:01.00]Oi\n[00:03.50]\n[00:05.00]A\n[00:05.00]B\n[00:07.2]Fim');
  assert(l.length === 3, 'deu ' + l.length + ' linhas');
  assert(l[1].text === 'A / B', 'dueto: ' + l[1].text);
  near(l[0].end, 3.5, 0.001, 'fim da linha 1');
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

console.log(`\n${passed} passaram, ${failed} falharam\n`);
process.exit(failed ? 1 : 0);
