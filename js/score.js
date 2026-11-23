// Pontuação. Mede só as linhas que são da jogadora (ou de todas juntas).
//   Fôlego   — quanto da linha ela cantou (respirar entre sílabas e no fim da frase não tira ponto).
//              Multiplica o resto: cantar metade da linha, mesmo perfeito, vale metade.
//   Afinação 43% — a voz bate nas notas, dentro do tom da música, e a melodia se mexe
//   Timbre   27% — voz limpa (som de nota, não de chiado) e firme (vibrato pode; tremedeira não)
//   Ritmo    30% — entrou na hora certa e acompanhou as sílabas
// → 0 a 10.000 pontos.
//
// Não existe fonte grátis da melodia original, então a nota não compara com o cantor. Pra ser
// justa mesmo assim:
//  • a afinação é medida na "nota percebida" (média curtinha), então vibrato não conta como erro;
//  • a referência de afinação é a da própria cantora na música toda (música gravada fora do
//    lá 440 não prejudica quem canta junto certinho);
//  • o tom da música é descoberto pelas notas cantadas: nota fora do tom tira um pouco;
//  • "aaaa" numa nota só, sem sílabas, perde ponto (não é cantar a letra).
// Tudo é medido por TEMPO (segundos), não por quadros: PC fraco ou janela minimizada dá a mesma nota.

// qualidade de quem está cantando (a soma dá 1); o Fôlego multiplica: cantar metade da linha vale metade
const Q = { tune: 0.43, timbre: 0.27, rhythm: 0.3 };
const MIN_LINE = 0.4;   // linhas mais curtas que isso não contam (nem pra mais, nem pra menos)
const MIN_MEASURED = 0.6;   // se o app mediu menos que 60% das linhas que tocaram, o que falta acima disso vale 0
const MAX_DT = 1.2;     // um "pulo" maior que isso (vídeo travou, pulou) não conta como tempo cantado
const BINS = 120;       // histograma das notas: 10 cents por casa, uma oitava
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const SMOOTH = 0.15;    // segundos: média que transforma vibrato na nota percebida
const CONSONANT = 0.3;  // pausa menor que isso entre sons é consoante/respiro, faz parte de cantar

/** quantas sílabas (grupos de vogais) tem a linha — serve pra saber quanto tempo ela leva e pro ritmo */
export function syllables(text) {
  const t = String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const cjk = (t.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) || []).length;
  return Math.max(1, (t.match(/[aeiouy]+/g) || []).length + cjk);
}

export class Scorer {
  /** opts.latency = segundos a mais de tolerância pra entrar (fone bluetooth atrasa o som) */
  constructor(lines, who, myIndex, opts = {}) {
    this.lines = lines;
    this.latency = opts.latency || 0;
    // myIndex -1 = só assistindo (não confundir com -1 = ALL, "todas cantam")
    this.mine = lines.map((_, i) => myIndex >= 0 && (who[i] === -1 || who[i] === myIndex));
    this.stats = lines.map((ln) => {
      const dur = ln.end - ln.t, syl = syllables(ln.text);
      return {
        time: 0, voiced: 0, onset: null, onsetDt: 0, pre: 0, ticks: 0,
        hist: new Float32Array(BINS), measured: 0, timbreSum: 0,
        mSum: 0, mSq: 0, mW: 0,           // pra saber se a melodia se mexe
        nuclei: 0, envOk: false, syl,     // sílabas cantadas x sílabas da letra
        // tempo "normal" pra cantar a linha; depois disso, silêncio é respiro antes da próxima
        exp: Math.min(dur, Math.max(1.2, syl * 0.3 + 0.8)),
      };
    });
    this.reached = -1;   // última linha que já tocou
    this.cur = -1;       // linha da última leitura
    this.resetVoice();
  }

  resetVoice() { this.smooth = null; this.jump = 0; this.jumpT = 0; this.pend = 0; this.gap = 9; this.env = { high: false, peak: 0, trough: 0 }; }

  /** até quando a linha i "deveria" estar sendo cantada (depois disso, pausa não é falha) */
  expectedEnd(i) { return this.lines[i].t + this.stats[i].exp; }

  /** lineIdx = linha atual (ou -1), lt = tempo da letra, m = leitura do microfone, dt = segundos desde a última chamada */
  frame(lineIdx, lt, m, dt = 1 / 60) {
    if (lineIdx > this.reached) this.reached = lineIdx;
    // linha nova (mesmo emendada na anterior, sem pausa): começa a contar sílabas e notas do zero,
    // senão a primeira sílaba da linha nova se perdia quando a voz estava alta na troca
    if (lineIdx !== this.cur) { this.cur = lineIdx; this.resetVoice(); }
    if (lineIdx < 0 || !this.mine[lineIdx]) { this.resetVoice(); return; }
    dt = Math.max(0, Math.min(MAX_DT, dt || 0));
    if (!dt) return;
    const s = this.stats[lineIdx], ln = this.lines[lineIdx];
    const voiced = !!(m.voiced && m.pitch > 0);

    if (!voiced) {
      this.gap += dt;
      this.syllable(s, 0, false);
      if (this.gap > 0.25) this.smooth = null;
      if (lt - ln.t > s.exp) return;                 // respiro depois da frase: não conta
      s.time += dt; s.ticks++;
      if (s.onset === null) { s.pre += dt; return; }
      // pausinha de consoante/respiro no meio da frase: conta como cantando (até ~0,3s, ou a
      // primeira leitura muda depois da voz quando as leituras são espaçadas)
      if (this.gap <= Math.max(CONSONANT, dt + 0.01)) s.voiced += dt;
      return;
    }
    this.gap = 0;
    s.time += dt; s.ticks++;
    s.voiced += dt;
    if (m.rms > 0) s.envOk = true;
    this.syllable(s, m.rms || 0, true);
    if (s.onset === null) { s.onset = Math.max(0, lt - ln.t - dt / 2); s.onsetDt = dt; }

    let cents = 1200 * Math.log2(m.pitch / 440);
    let glide = false;
    if (this.smooth === null) { this.smooth = cents; this.jump = 0; }
    else {
      let d = cents - this.smooth;
      const oct = Math.round(d / 1200);
      if (oct && Math.abs(d - oct * 1200) < 100) { cents -= oct * 1200; d -= oct * 1200; }   // detector pulou de oitava
      if (Math.abs(d) > 80) {
        // mudou de nota: os primeiros instantes são a "subida" até a nota nova, não contam
        // os primeiros ~70 ms da nota nova são a "subida" até ela: não contam.
        // Começa a nota na média dessas leituras (com vibrato, a 1ª pode estar no pico).
        // Com leituras espaçadas (janela minimizada) não dá pra ver subida: já mede.
        this.pend = this.jump ? this.pend + cents : cents;
        this.jump++; this.jumpT += dt;
        glide = true;
        if (this.jumpT >= 0.07) { this.smooth = this.pend / this.jump; this.jump = 0; this.jumpT = 0; glide = dt < 0.07; }
      } else { this.jump = 0; this.jumpT = 0; this.smooth += d * (1 - Math.exp(-dt / SMOOTH)); }
    }
    if (glide) return;

    const sm = this.smooth;
    // histograma da nota percebida (oitava dobrada), espalhando entre as duas casas vizinhas
    const pos = (((sm % 1200) + 1200) % 1200) / 10 - 0.5;
    const b0 = Math.floor(pos), f = pos - b0;
    s.hist[(b0 + BINS) % BINS] += dt * (1 - f);
    s.hist[(b0 + 1) % BINS] += dt * f;
    s.measured += dt;
    // firmeza: quanto a voz foge da nota percebida (vibrato normal fica dentro dos 45 cents)
    const steady = clamp01(1 - (Math.abs(cents - sm) - 45) / 80);
    const clean = clamp01(((m.clarity || 0.8) - 0.6) / 0.28);
    s.timbreSum += (0.6 * steady + 0.4 * clean) * dt;
    s.mSum += sm * dt; s.mSq += sm * sm * dt; s.mW += dt;
  }

  /** conta sílabas pelo volume: cada vez que a voz "sobe" depois de uma queda é uma sílaba */
  syllable(s, rms, voiced) {
    const e = this.env, v = voiced ? rms : 0;
    if (e.high) {
      if (v > e.peak) e.peak = v;
      else if (v < e.peak * 0.7) { e.high = false; e.trough = v; }
    } else if (v < e.trough) e.trough = v;
    else if (voiced && v > e.trough * 1.35 + 0.003) { e.high = true; e.peak = v; s.nuclei++; }
  }

  /** referência de afinação e tom da música, descobertos pelo que ela cantou até agora */
  context() {
    const pc = new Float64Array(BINS);
    this.stats.forEach((s, i) => { if (this.mine[i]) for (let b = 0; b < BINS; b++) pc[b] += s.hist[b]; });
    let tot = 0, cx = 0, cy = 0;
    for (let b = 0; b < BINS; b++) {
      const w = pc[b]; if (!w) continue;
      const a = (2 * Math.PI * ((b * 10 + 5) % 100)) / 100;
      tot += w; cx += w * Math.cos(a); cy += w * Math.sin(a);
    }
    // afinação "da música": só se tem dado suficiente e a cantora é consistente
    const offset = tot >= 3 && Math.hypot(cx, cy) / tot > 0.3 ? (Math.atan2(cy, cx) / (2 * Math.PI)) * 100 : 0;
    let scale = null;
    if (tot >= 8) {
      const cls = new Float64Array(12);
      for (let b = 0; b < BINS; b++) if (pc[b]) cls[(((Math.round((b * 10 + 5 - offset) / 100)) % 12) + 12) % 12] += pc[b];
      let best = -1, root = 0;
      for (let r = 0; r < 12; r++) {
        let sum = 0; for (const d of MAJOR) sum += cls[(r + d) % 12];
        if (sum > best) { best = sum; root = r; }
      }
      scale = new Uint8Array(12);
      for (const d of MAJOR) scale[(root + d) % 12] = 1;
    }
    return { offset, scale };
  }

  /** notas (0..1) de cada quesito numa linha, ou null se a linha não conta */
  lineScore(i, ctx = this.context()) {
    const s = this.stats[i], ln = this.lines[i];
    const dur = ln.end - ln.t;
    if (dur < MIN_LINE || s.time < Math.min(0.25, dur * 0.4)) return null;
    // o comecinho antes de ela entrar já pesa no Ritmo; no Fôlego só conta se demorou muito
    const time = s.onset === null ? s.time : s.time - Math.min(s.pre, 0.6);
    const presence = clamp01((s.voiced / Math.max(time, 1e-6)) / 0.8);

    let tune = 0, timbre = 0;
    if (s.measured > 0) {
      let good = 0, inKey = 0, w = 0;
      for (let b = 0; b < BINS; b++) {
        const h = s.hist[b]; if (!h) continue;
        const c = b * 10 + 5 - ctx.offset, n = Math.round(c / 100);
        good += h * clamp01(1 - (Math.abs(c - n * 100) - 15) / 30);
        if (!ctx.scale || ctx.scale[((n % 12) + 12) % 12]) inKey += h;
        w += h;
      }
      const key = clamp01((inKey / w - 0.5) / 0.4);           // ~90% das notas no tom = nota cheia
      let melody = 1;                                           // nota parada a linha inteira = "aaaa"
      if (s.mW >= 1.5) {
        const mean = s.mSum / s.mW, sd = Math.sqrt(Math.max(0, s.mSq / s.mW - mean * mean));
        melody = 0.6 + 0.4 * clamp01(sd / 60);
      }
      tune = (good / w) * (0.7 + 0.3 * key) * melody;
      timbre = s.timbreSum / s.measured;
    }

    // tolerância: 0,35s + atraso do fone + metade do intervalo entre leituras (com leituras espaçadas não dá pra saber o instante exato)
    let rhythm = s.onset === null ? 0 : clamp01(1 - (s.onset - 0.35 - this.latency - Math.min(1, s.onsetDt) / 2) / 1.5);
    // acompanhou as sílabas da letra? (só dá pra medir com leituras frequentes e volume conhecido)
    if (s.onset !== null && s.envOk && s.ticks && s.time / s.ticks <= 0.1 && s.syl >= 3 && s.voiced >= 0.8) {
      const want = s.syl * Math.min(1, s.voiced / s.exp);
      const art = clamp01(s.nuclei / Math.max(1, 0.4 * want));
      rhythm = 0.5 * rhythm + 0.5 * art;
    }
    return { presence, tune, timbre, rhythm };
  }

  /** valor da linha (0..1) já com a curva */
  value(r) { return curve(r.presence * (Q.tune * r.tune + Q.timbre * r.timbre + Q.rhythm * r.rhythm)); }

  sum(ctx = this.context()) {
    let sum = 0;
    this.lines.forEach((_, i) => {
      if (!this.mine[i]) return;
      const r = this.lineScore(i, ctx);
      if (r) sum += this.value(r);
    });
    return sum;
  }

  /** Total até agora (vai subindo durante a música) */
  live() { return Math.min(10000, Math.round((this.sum() / this.countable(Infinity)) * 10000)); }

  /** Resultado de uma linha que acabou de terminar (pro "Perfeito! +350" na tela) */
  lineResult(i) {
    if (!this.mine[i]) return null;
    const r = this.lineScore(i);
    if (!r) return null;
    const v = this.value(r);
    return { ...r, v, points: Math.round((v / this.countable(Infinity)) * 10000) };
  }

  final() {
    const ctx = this.context();
    const acc = { presence: 0, tune: 0, timbre: 0, rhythm: 0 };
    let n = 0, perfect = 0;
    this.lines.forEach((_, i) => {
      if (!this.mine[i]) return;
      const r = this.lineScore(i, ctx);
      if (!r) return;
      n++;
      if (this.value(r) >= 0.92) perfect++;
      for (const k in acc) acc[k] += r[k];
    });
    n = n || 1;
    const pct = (k) => Math.round((acc[k] / n) * 100);
    return {
      // se encerrarem antes do fim, conta só o pedaço que tocou; e linha que o app nem chegou a
      // medir (vídeo carregando, PC engasgou bem na hora) não conta contra a jogadora
      // …mas com um piso: travar quase a música toda e cantar 2 linhas não vira nota cheia
      total: Math.min(10000, Math.round((this.sum(ctx) / Math.max(
        this.countable(this.reached, ctx), Math.round(MIN_MEASURED * this.countable(this.reached)))) * 10000)),
      presence: pct('presence'), tune: pct('tune'), timbre: pct('timbre'), rhythm: pct('rhythm'),
      perfect,
    };
  }

  /** quantas linhas valem nota (até a linha upTo); com ctx, só as que deu pra medir */
  countable(upTo, ctx = null) {
    let n = 0;
    this.lines.forEach((ln, i) => {
      if (i <= upTo && this.mine[i] && ln.end - ln.t >= MIN_LINE && (!ctx || this.lineScore(i, ctx))) n++;
    });
    return n || 1;
  }
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
// deixa a nota um pouco mais "generosa" no meio, sem embolar todo mundo lá em cima
// (quem canta direitinho fica entre 7 e 9 mil; trapaça e desafinação ficam bem pra trás)
function curve(x) { return Math.pow(clamp01(x), 0.85); }
