// Microfone: volume e altura (pitch) da voz, direto no navegador.

let half = null;
let ctx = null, analyser = null, buf = null, stream = null, src = null;
let mon = null, monToken = 0;   // "me ouvir": voz indo direto pro fone
function stopMonitor() {
  if (!mon) return;
  mon.s.getTracks().forEach((t) => t.stop());
  try { mon.c.close(); } catch (e) { /* ok */ }
  mon = null;
}

/* ---------- efeitos do "me ouvir" ---------- */
// fx.reverb: quanto reverb (0 = desligado, 1 = máximo)
// fx.room:   tamanho da sala (0 = quarto pequeno, 1 = catedral)
// fx.echo:   eco ligado/desligado
// fx.vol:    volume da voz no fone (0 a 1,5)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
const fx = (() => {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('ic-fx2') || '{}') || {}; } catch (e) { /* ok */ }
  return {
    reverb: clamp(parseFloat(saved.reverb ?? 0.35), 0, 1),
    room: clamp(parseFloat(saved.room ?? 0.4), 0, 1),
    echo: !!saved.echo,
    vol: clamp(parseFloat(saved.vol ?? 1), 0, 1.5),
  };
})();
const saveFx = () => { try { localStorage.setItem('ic-fx2', JSON.stringify(fx)); } catch (e) { /* ok */ } };

// como o tamanho da sala vira som: sala maior = cauda mais longa, mais espera antes
// do reverb começar e som mais abafado
function roomParams(room) {
  return {
    secs: Math.round((0.3 + Math.pow(room, 1.5) * 5.2) * 20) / 20,  // 0,3 s a 5,5 s
    pre: 0.002 + room * 0.045,                                       // 2 a 47 ms
    bright: Math.round((0.7 - room * 0.35) * 20) / 20,
  };
}
export function roomLabel(room) {
  return room < 0.2 ? 'Quarto' : room < 0.4 ? 'Sala' : room < 0.6 ? 'Estúdio grande' : room < 0.8 ? 'Teatro' : 'Catedral';
}

// "resposta" de uma sala inventada: chiado estéreo que vai sumindo e escurecendo
const irCache = new Map();
function impulse(c, secs, bright) {
  const key = c.sampleRate + ':' + secs + ':' + bright;
  if (irCache.has(key)) return irCache.get(key);
  const rate = c.sampleRate, len = Math.max(1, Math.floor(rate * secs));
  const ir = c.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const k = bright * (1 - t) + 0.05; // quanto mais pro fim, mais abafado (como numa sala de verdade)
      lp += k * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.pow(1 - t, 3.2);
    }
  }
  if (irCache.size > 12) irCache.clear();
  irCache.set(key, ir);
  return ir;
}

const fade = (g, c, to) => g.gain.setTargetAtTime(to, c.currentTime, 0.05);
const unplug = (nodes) => nodes.forEach((n) => { try { n.disconnect(); } catch (e) { /* ok */ } });

// reverb: monta um novo e faz a troca suave (sem estalo) quando a sala muda
function buildReverb() {
  if (!mon) return;
  const { c, input, out } = mon;
  const old = mon.rev;
  const p = roomParams(fx.room);
  const pre = c.createDelay(0.2); pre.delayTime.value = p.pre;
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180; // sem embolar os graves
  const conv = c.createConvolver(); conv.buffer = impulse(c, p.secs, p.bright);
  const g = c.createGain(); g.gain.value = 0;
  input.connect(pre); pre.connect(hp); hp.connect(conv); conv.connect(g); g.connect(out);
  mon.rev = { g, nodes: [pre, hp, conv, g], key: p.secs + ':' + p.bright };
  fade(g, c, fx.reverb * 0.7);
  if (old) { fade(old.g, c, 0); setTimeout(() => unplug(old.nodes), 400); }
}

function buildEcho() {
  if (!mon) return;
  const { c, input, out } = mon;
  if (!mon.echo) {
    const d = c.createDelay(2); d.delayTime.value = 0.3;
    const fb = c.createGain(); fb.gain.value = 0.38;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; // cada repetição mais abafada
    const g = c.createGain(); g.gain.value = 0;
    input.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(g); g.connect(out);
    mon.echo = { g };
  }
  fade(mon.echo.g, c, fx.echo ? 0.35 : 0);
}

// a voz seca nunca passa pelos efeitos: eles tocam em paralelo, então não somam atraso
function applyFx() {
  if (!mon) return;
  const p = roomParams(fx.room);
  if (!mon.rev || mon.rev.key !== p.secs + ':' + p.bright) buildReverb();
  else fade(mon.rev.g, mon.c, fx.reverb * 0.7);
  buildEcho();
  mon.out.gain.setTargetAtTime(fx.vol, mon.c.currentTime, 0.02);
}

let recorder = null;
let noiseFloor = 0.01;
let last = null, lastAt = 0;
let lastClarity = 0;

export const mic = {
  active: false,
  onLost: null,

  async start() {
    if (mic.active) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      throw new Error(e && e.name === 'NotFoundError'
        ? 'Nenhum microfone encontrado. Conecta um e tenta de novo.'
        : 'O microfone foi bloqueado. Clica no cadeado ao lado do endereço do site e permite o microfone.');
    }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);
    buf = new Float32Array(analyser.fftSize);
    half = new Float32Array(analyser.fftSize / 2);
    mic.active = true;
    calibrate();
    // fio puxado / fone bluetooth desligou
    stream.getAudioTracks().forEach((t) => t.addEventListener('ended', () => {
      mic.active = false;
      last = null;
      monToken++; stopMonitor();
      try { ctx.close(); } catch (e) { /* ok */ }
      if (mic.onLost) mic.onLost();
    }));
  },

  /**
   * Liga/desliga ouvir a própria voz no fone (só faz sentido com fone de ouvido).
   * Usa um caminho separado: microfone "cru" (sem o filtro de eco, que brigava com a voz
   * tocando no fone e deixava tudo travado) e um áudio próprio com o menor atraso possível.
   * Devolve (por promessa) o atraso estimado em segundos, ou null.
   */
  monitor(on) {
    const token = ++monToken;
    if (!on || !mic.active) { stopMonitor(); return Promise.resolve(null); }
    if (mon) return Promise.resolve(mon.latency);
    // cria o áudio primeiro e pede o microfone na MESMA taxa dele:
    // se as taxas forem diferentes o navegador converte no meio do caminho e isso atrasa
    let c;
    try { c = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 0 }); } catch (e) { return Promise.resolve(null); }
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        latency: 0, sampleRate: c.sampleRate, channelCount: 1,
      },
    }).then((s) => {
      if (token !== monToken || mon) { s.getTracks().forEach((t) => t.stop()); c.close(); return null; }
      const input = c.createMediaStreamSource(s);
      const out = c.createGain(); out.gain.value = fx.vol;
      input.connect(out);              // voz seca: caminho mais curto possível
      out.connect(c.destination);
      if (c.state === 'suspended') c.resume();
      const latency = (c.baseLatency || 0) + (c.outputLatency || 0);
      mon = { s, c, input, out, rev: null, echo: null, latency };
      applyFx();
      return latency;
    }).catch(() => { try { c.close(); } catch (e) { /* ok */ } return null; }); // sem permissão: só não toca
  },

  /** Efeitos do retorno: { reverb, room, echo, vol } */
  get fx() { return { ...fx }; },
  setFx(change) {
    if ('reverb' in change) fx.reverb = clamp(+change.reverb, 0, 1);
    if ('room' in change) fx.room = clamp(+change.room, 0, 1);
    if ('echo' in change) fx.echo = !!change.echo;
    if ('vol' in change) fx.vol = clamp(+change.vol, 0, 1.5);
    saveFx();
    applyFx();
  },

  /** Começa a gravar a voz (pra ouvir no final). */
  recStart() {
    mic.recCancel();
    if (!mic.active || typeof MediaRecorder === 'undefined') return false;
    try {
      const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
      recorder = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 96000 } : undefined);
      const chunks = recorder.chunks = [];
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.start(1000);
      return true;
    } catch (e) { recorder = null; return false; }
  },

  /** Para de gravar e devolve o áudio (Blob) ou null. */
  recStop() {
    const r = recorder; recorder = null;
    if (!r || r.state === 'inactive') return Promise.resolve(null);
    return new Promise((resolve) => {
      r.onstop = () => resolve(r.chunks.length ? new Blob(r.chunks, { type: r.mimeType || 'audio/webm' }) : null);
      try { r.stop(); } catch (e) { resolve(null); }
    });
  },

  recCancel() {
    if (recorder && recorder.state !== 'inactive') { recorder.ondataavailable = null; try { recorder.stop(); } catch (e) { /* ok */ } }
    recorder = null;
  },

  /** Lê o microfone agora. { rms, level (0-1 pra barra), pitch (Hz ou 0), voiced } */
  read() {
    if (!mic.active) return { rms: 0, level: 0, pitch: 0, voiced: false };
    const now = performance.now();
    // ~30 leituras por segundo bastam (e poupam PC fraco: a afinação é a conta mais pesada do jogo)
    if (last && now - lastAt < 30) return last;
    lastAt = now;
    if (ctx.state === 'suspended') ctx.resume();
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const loud = rms > Math.max(0.012, noiseFloor * 2.5);
    let pitch = 0;
    if (loud) {
      // metade das amostras (média de 2 em 2): voz vai até ~1100 Hz, então 24 mil por segundo sobra
      if (ctx.sampleRate >= 32000) {
        for (let i = 0; i < half.length; i++) half[i] = (buf[2 * i] + buf[2 * i + 1]) * 0.5;
        pitch = detectPitch(half, ctx.sampleRate / 2);
      } else pitch = detectPitch(buf, ctx.sampleRate);
    }
    last = { rms, level: Math.min(1, rms * 8), pitch, voiced: loud && pitch > 0, clarity: pitch > 0 ? lastClarity : 0 };
    return last;
  },
};

// mede o barulho ambiente no primeiro segundo e meio
function calibrate() {
  const samples = [];
  const iv = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    samples.push(Math.sqrt(s / buf.length));
    if (samples.length >= 30) {
      clearInterval(iv);
      samples.sort((a, b) => a - b);
      noiseFloor = Math.min(0.05, samples[Math.floor(samples.length / 2)]);
    }
  }, 50);
}

// Autocorrelação: acha a frequência fundamental da voz (80–1100 Hz)
function detectPitch(b, rate) {
  const n = b.length;
  const minLag = Math.floor(rate / 1100), maxLag = Math.floor(rate / 80);
  let bestLag = -1, best = 0;
  const corr = new Float32Array(maxLag + 2);
  let energy = 0;
  for (let i = 0; i < n; i++) energy += b[i] * b[i];
  if (!energy) return 0;

  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += b[i] * b[i + lag];
    corr[lag] = s / energy;
  }
  // primeiro pico forte (evita pegar a oitava de baixo)
  const globalMax = Math.max(...corr.subarray(minLag, maxLag + 1));
  if (globalMax < 0.5) return 0; // som sem tom definido (barulho)
  for (let lag = minLag + 1; lag <= maxLag; lag++) {
    if (corr[lag] > corr[lag - 1] && corr[lag] >= corr[lag + 1] && corr[lag] > globalMax * 0.9) {
      bestLag = lag; best = corr[lag]; break;
    }
  }
  if (bestLag < 0) return 0;
  lastClarity = best;
  // interpolação parabólica pra precisão
  const a = corr[bestLag - 1], c = corr[bestLag + 1];
  const shift = (a - c) / (2 * (a - 2 * best + c)) || 0;
  return rate / (bestLag + shift);
}
