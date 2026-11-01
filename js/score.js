// Pontuação. Mede só as linhas que são da jogadora (ou de todas juntas).
// Presença 40% · Afinação 40% · Ritmo 20%  →  0 a 10.000 pontos.
// Obs.: não existe fonte grátis da melodia original, então a nota mede
// "cantou na hora certa, afinada e firme" — não "igual ao cantor".

const W = { presence: 0.4, tune: 0.4, rhythm: 0.2 };

export class Scorer {
  constructor(lines, who, myIndex) {
    this.lines = lines;
    this.mine = lines.map((_, i) => who[i] === -1 || who[i] === myIndex);
    this.myCount = this.mine.filter(Boolean).length || 1;
    this.stats = lines.map(() => ({ frames: 0, voiced: 0, tuneSum: 0, onset: null }));
    this.done = new Set();
    this.lastCents = null;
    this.reached = -1;   // última linha que já tocou
  }

  /** chamado ~60x por segundo. lineIdx = linha atual (ou -1), lt = tempo da letra */
  frame(lineIdx, lt, m) {
    if (lineIdx > this.reached) this.reached = lineIdx;
    if (lineIdx < 0 || !this.mine[lineIdx]) { this.lastCents = null; return; }
    const s = this.stats[lineIdx];
    s.frames++;
    if (!m.voiced) { this.lastCents = null; return; }

    s.voiced++;
    if (s.onset === null) s.onset = lt - this.lines[lineIdx].t;

    // afinação: quão perto de uma nota musical (0 a 50 cents de erro)
    const cents = 1200 * Math.log2(m.pitch / 440);
    const dev = Math.abs(cents - Math.round(cents / 100) * 100);
    const inTune = clamp01(1 - (dev - 12) / 28);
    // firmeza: a nota não fica pulando de um frame pro outro
    let steady = 0.6;
    if (this.lastCents !== null) steady = clamp01(1 - (Math.abs(cents - this.lastCents) - 15) / 60);
    this.lastCents = cents;
    s.tuneSum += 0.55 * inTune + 0.45 * steady;
  }

  lineScore(i) {
    const s = this.stats[i];
    if (s.frames < 10) return null; // linha curta demais pra contar
    const presence = clamp01((s.voiced / s.frames) / 0.65);
    const tune = s.voiced ? s.tuneSum / s.voiced : 0;
    const rhythm = s.onset === null ? 0 : clamp01(1 - (s.onset - 0.35) / 1.5);
    return { presence, tune, rhythm };
  }

  /** Total até agora (vai subindo durante a música) */
  live() { return Math.round((this.sum() / this.countable(Infinity)) * 10000); }

  sum() {
    let sum = 0;
    this.lines.forEach((_, i) => {
      if (!this.mine[i]) return;
      const r = this.lineScore(i);
      if (r) sum += curve(W.presence * r.presence + W.tune * r.tune + W.rhythm * r.rhythm);
    });
    return sum;
  }

  final() {
    const acc = { presence: 0, tune: 0, rhythm: 0 };
    let n = 0;
    this.lines.forEach((_, i) => {
      if (!this.mine[i]) return;
      const r = this.lineScore(i);
      if (!r) return;
      n++;
      acc.presence += r.presence; acc.tune += r.tune; acc.rhythm += r.rhythm;
    });
    n = n || 1;
    const presence = acc.presence / n, tune = acc.tune / n, rhythm = acc.rhythm / n;
    return {
      // se encerrarem antes do fim, conta só o pedaço que tocou
      total: Math.round((this.sum() / this.countable(this.reached)) * 10000),
      presence: Math.round(presence * 100),
      tune: Math.round(tune * 100),
      rhythm: Math.round(rhythm * 100),
    };
  }

  countable(upTo) {
    // conta as linhas que eram pra ser cantadas e tinham duração suficiente
    let n = 0;
    this.lines.forEach((ln, i) => { if (i <= upTo && this.mine[i] && ln.end - ln.t >= 0.4) n++; });
    return n || 1;
  }
}

function clamp01(x) { return Math.max(0, Math.min(1, x)); }
// deixa a nota mais "generosa" no meio (quem canta direitinho fica entre 7 e 9 mil)
function curve(x) { return Math.pow(clamp01(x), 0.75); }
