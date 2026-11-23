// Relatório de diagnóstico da cantoria: registra, 25x por segundo, o que o microfone ouviu
// e o que o app decidiu (contou ou não, e por quê). Serve pra descobrir depois por que a
// nota de alguém "parou de contar". Fica só no navegador da pessoa até ela baixar o arquivo.
// Sem nada de navegador no núcleo (dá pra testar e analisar no Node).

const KEY = 'ic-last-log';
const MAX_ROWS = 30000;   // ~20 min a 25x/s
const COLS = ['t', 'lt', 'a', 'mine', 'yt', 'rms', 'th', 'fl', 'pk', 'p', 'c', 'v', 'ld', 'dt', 'pr', 'src'];
const r = (x, k) => Math.round((Number(x) || 0) * k);

/** clock = relógio em ms (dá pra trocar nos testes) */
export function createLog(meta, clock = Date.now) {
  const cols = {};
  COLS.forEach((c) => { cols[c] = []; });
  const t0 = clock();
  const log = {
    format: 'irmas-cantoras-log/1',
    meta: { ...meta, startedAt: new Date(t0).toISOString() },
    // legenda das colunas (pra quem abrir o arquivo)
    legend: {
      t: 'ms desde o início', lt: 'tempo da letra (s)', a: 'linha tocando (-1 = nenhuma)', mine: '1 = linha é minha',
      yt: 'estado do vídeo (1 tocando, 2 pausado, 3 carregando, 0 fim)', rms: 'volume ×10000', th: 'corte de volume ×10000',
      fl: 'ruído ambiente medido ×10000', pk: 'pico ×1000', p: 'nota achada (Hz, antes do corte)', c: 'clareza da nota ×100',
      v: '1 = contou como voz cantada', ld: '1 = acima do corte', dt: 'ms desde a leitura anterior', pr: 'problema do microfone',
      src: 'm = microfone principal, o = "Me ouvir"',
    },
    cols,
    ev: [],
    rows: 0,
    truncated: false,
    tick(o) {
      if (log.rows >= MAX_ROWS) { log.truncated = true; return; }
      log.rows++;
      cols.t.push(clock() - t0);
      cols.lt.push(Math.round((o.lt || 0) * 100) / 100);
      cols.a.push(o.active);
      cols.mine.push(o.mine ? 1 : 0);
      cols.yt.push(o.yt);
      cols.rms.push(r(o.rms, 1e4));
      cols.th.push(r(o.threshold, 1e4));
      cols.fl.push(r(o.floor, 1e4));
      cols.pk.push(r(o.peak, 1e3));
      cols.p.push(Math.round(o.rawPitch || 0));
      cols.c.push(r(o.rawClarity, 100));
      cols.v.push(o.voiced ? 1 : 0);
      cols.ld.push(o.loud ? 1 : 0);
      cols.dt.push(Math.round((o.dt || 0) * 1000));
      cols.pr.push(o.problem || '');
      cols.src.push(o.src === 'mon' ? 'o' : 'm');
    },
    event(type, data) {
      if (log.ev.length < 5000) log.ev.push([clock() - t0, type, data === undefined ? null : data]);
    },
    finish(extra) { log.meta.endedAt = new Date().toISOString(); Object.assign(log, extra || {}); },
    toJSON() {
      const { tick, event, finish, toJSON, ...plain } = log;
      return plain;
    },
  };
  return log;
}

/** guarda o último relatório no navegador (sobrevive a fechar a aba sem querer) */
export function saveLog(log) {
  try { localStorage.setItem(KEY, JSON.stringify(log)); return true; } catch (e) { return false; }
}
export function lastLog() {
  try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
}
/** baixa o relatório como arquivo .json */
export function downloadLog(log) {
  if (!log) return false;
  const blob = new Blob([JSON.stringify(log)], { type: 'application/json' });
  const a = document.createElement('a');
  const when = (log.meta && log.meta.startedAt ? log.meta.startedAt : new Date().toISOString()).slice(0, 16).replace(/[:T]/g, '-');
  a.href = URL.createObjectURL(blob);
  a.download = `irmas-cantoras-relatorio-${when}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return true;
}

const med = (arr) => { if (!arr.length) return 0; const s = [...arr].sort((x, y) => x - y); return s[s.length >> 1]; };
const pct = (x) => `${Math.round(x * 100)}%`;

/**
 * Lê um relatório e explica em texto o que aconteceu na vez da pessoa:
 * quanto tempo contou e, quando não contou, por quê. Também mostra a linha do tempo
 * em blocos de 10s, pra ver o momento em que "parou de contar".
 */
export function analyze(log) {
  const c = log.cols, n = log.rows || (c.t ? c.t.length : 0);
  const out = [];
  const m = log.meta || {};
  out.push(`Relatório ${m.startedAt || ''} · app v${m.version || '?'} · ${m.song && m.song.title ? m.song.title : ''}`);
  if (m.device) out.push(`PC: ${m.device.cores || '?'} núcleos, ${m.device.memory || '?'} GB, modo leve ${m.device.lite ? 'sim' : 'não'} · ${m.device.ua || ''}`);
  if (m.mic) out.push(`Microfone: ${m.mic.label || '?'} · ${m.mic.sampleRate || '?'} Hz · ${m.mic.rawMode ? 'modo fone' : 'modo normal'} · bluetooth ${m.mic.bluetooth ? 'sim' : 'não'} · calibrado ${m.mic.calibrated ? 'sim' : 'não'} · me ouvir ${m.hearMe ? 'sim' : 'não'}`);
  if (log.final) out.push(`Nota final: ${log.final.total} (fôlego ${log.final.presence}, afinação ${log.final.tune}, timbre ${log.final.timbre}, ritmo ${log.final.rhythm})`);
  out.push(`${n} leituras${log.truncated ? ' (cortado: música longa demais)' : ''}`);

  // por que não contou, nos momentos em que era a vez da pessoa e a música estava tocando
  // "parado": no último ~1s o volume quase não variou (quase sempre < 1,6× o mínimo). Voz cantando sobe e desce
  // a cada sílaba; ruído de fundo fica parado. Separa "não chegou voz nenhuma" de "voz baixa".
  const flat = new Uint8Array(n);
  // (usa 15% e 85% da janela: um estalo rápido no meio não estraga a conta)
  for (let i = 0; i < n; i++) {
    const win = c.rms.slice(Math.max(0, i - 12), Math.min(n, i + 13)).sort((x, y) => x - y);
    const lo = win[Math.floor(win.length * 0.15)], hi = win[Math.floor(win.length * 0.85)];
    flat[i] = hi < Math.max(1, lo) * 1.6 ? 1 : 0;
  }
  const NOVOICE = 'nenhuma voz chegou (só ruído de fundo parado)';
  const why = { contou: 0, 'problema no microfone': 0, 'vídeo parado/carregando': 0, [NOVOICE]: 0, 'voz baixa demais (abaixo do corte)': 0, 'som sem nota (fala/ruído/clareza baixa)': 0 };
  const quietRms = [], quietTh = [], noisyClar = [];
  let mineMs = 0, gaps = 0, maxGap = 0;
  for (let i = 0; i < n; i++) {
    if (c.dt[i] > 200) { gaps++; maxGap = Math.max(maxGap, c.dt[i]); }
    if (!c.mine[i]) continue;
    const w = Math.min(c.dt[i] || 40, 1200);
    mineMs += w;
    if (c.pr[i]) why['problema no microfone'] += w;
    else if (c.yt[i] !== 1) why['vídeo parado/carregando'] += w;
    else if (c.v[i]) why.contou += w;
    else if (!c.ld[i] && flat[i]) why[NOVOICE] += w;
    else if (!c.ld[i]) { why['voz baixa demais (abaixo do corte)'] += w; if (c.rms[i] > 0) { quietRms.push(c.rms[i]); quietTh.push(c.th[i]); } }
    else { why['som sem nota (fala/ruído/clareza baixa)'] += w; noisyClar.push(c.c[i]); }
  }
  out.push('');
  out.push(`Na vez dela (${(mineMs / 1000).toFixed(0)}s):`);
  for (const k in why) if (why[k]) out.push(`  ${k.padEnd(40)} ${pct(why[k] / Math.max(1, mineMs)).padStart(4)}  (${(why[k] / 1000).toFixed(1)}s)`);
  if (why[NOVOICE] > 3000) out.push('  → "nenhuma voz chegou": o microfone estava ligado (dá pra ver o ruído de fundo), mas a voz não apareceu. Ou a pessoa não cantou, ou algo calou a voz antes do app (cancelamento de eco com caixa de som, mudo no fone, outro programa).');
  if (quietRms.length) out.push(`  → quando ficou "baixo": volume típico ${med(quietRms)} vs corte ${med(quietTh)} (×10000). Inclui as pausas normais entre sílabas e respiros; só preocupa se for muito tempo.`);
  if (noisyClar.length) out.push(`  → quando foi "som sem nota": clareza típica ${med(noisyClar)}% (precisa de ~55%+). Pode ser fala, eco, supressor de ruído ou mic distorcendo.`);
  if (gaps) out.push(`  ⚠️ ${gaps} travadas do PC (leitura atrasou mais de 200ms; maior: ${maxGap}ms)`);

  // linha do tempo em blocos de 10s
  out.push('');
  out.push('Linha do tempo (só a vez dela):  início | na música | contou | sem voz | volume | corte | ruído | clareza | vídeo | problema');
  const B = 10000;
  let b0 = 0;
  while (n && b0 <= c.t[n - 1]) {
    const idx = [];
    for (let i = 0; i < n; i++) if (c.t[i] >= b0 && c.t[i] < b0 + B && c.mine[i]) idx.push(i);
    if (idx.length > 5) {
      const v = idx.filter((i) => c.v[i]).length / idx.length;
      const probs = [...new Set(idx.map((i) => c.pr[i]).filter(Boolean))].join(',');
      const yts = [...new Set(idx.map((i) => c.yt[i]))].join(',');
      const flag = v < 0.3 ? '  ◀ quase não contou' : '';
      const fv = idx.filter((i) => flat[i] && !c.ld[i]).length / idx.length;
      const mt = c.lt[idx[0]], mm = `${Math.floor(Math.max(0, mt) / 60)}:${String(Math.floor(Math.max(0, mt) % 60)).padStart(2, '0')}`;
      out.push(`  ${String(Math.round(b0 / 1000)).padStart(4)}s | ${mm.padStart(9)} | ${pct(v).padStart(4)} | ${pct(fv).padStart(5)} | ${String(med(idx.map((i) => c.rms[i]))).padStart(5)} | ${String(med(idx.map((i) => c.th[i]))).padStart(4)} | ${String(med(idx.map((i) => c.fl[i]))).padStart(4)} | ${String(med(idx.map((i) => c.c[i]))).padStart(3)}% | ${yts.padEnd(5)} | ${probs}${flag}`);
    }
    b0 += B;
  }

  // eventos que importam
  const evs = (log.ev || []).filter((e) => e[1] !== 'score' && e[1] !== 'fps');
  if (evs.length) {
    out.push('');
    out.push('Eventos:');
    evs.slice(0, 300).forEach((e) => out.push(`  ${(e[0] / 1000).toFixed(1).padStart(6)}s ${e[1]} ${e[2] == null ? '' : JSON.stringify(e[2])}`));
  }
  const fps = (log.ev || []).filter((e) => e[1] === 'fps').map((e) => e[2]);
  if (fps.length) out.push(`\nTela: ${med(fps)} quadros/s típico, pior ${Math.min(...fps)}`);
  return out.join('\n');
}
