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
// reverb: tempo da cauda (s), quanto de efeito, atraso antes do reverb (s), brilho (0 escuro, 1 claro)
export const EFFECTS = {
  off:      { label: 'Sem efeito' },
  sala:     { label: 'Sala',      rev: 0.9, wet: 0.28, pre: 0.008, bright: 0.55 },
  palco:    { label: 'Palco',     rev: 1.9, wet: 0.34, pre: 0.018, bright: 0.5 },
  catedral: { label: 'Catedral',  rev: 4.2, wet: 0.42, pre: 0.035, bright: 0.4 },
  eco:      { label: 'Eco',       echo: 0.3, fb: 0.38, wet: 0.36, rev: 1.0, revWet: 0.15, pre: 0.01, bright: 0.5 },
};
let effect = localStorage.getItem('ic-fx') || 'off';
if (!EFFECTS[effect]) effect = 'off';
let monVol = Math.min(1.5, Math.max(0, parseFloat(localStorage.getItem('ic-mon-vol') || '1') || 1));

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
      // quanto mais pro fim, mais abafado (como numa sala de verdade)
      const k = bright * (1 - t) + 0.05;
      lp += k * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.pow(1 - t, 3.2);
    }
  }
  irCache.set(key, ir);
  return ir;
}

function reverbInto(c, from, to, fx, wet) {
  const pre = c.createDelay(0.2); pre.delayTime.value = fx.pre || 0;
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 180; // sem embolar os graves
  const conv = c.createConvolver(); conv.buffer = impulse(c, fx.rev, fx.bright);
  const g = c.createGain(); g.gain.value = wet;
  from.connect(pre); pre.connect(hp); hp.connect(conv); conv.connect(g); g.connect(to);
  return [pre, hp, conv, g];
}

// monta (ou troca) o efeito sem reabrir o microfone; a voz seca nunca passa pelo efeito,
// então ligar reverb não acrescenta atraso nenhum
function applyEffect() {
  if (!mon) return;
  const { c, input, out } = mon;
  mon.fx.forEach((n) => { try { n.disconnect(); } catch (e) { /* ok */ } });
  mon.fx = [];
  const fx = EFFECTS[effect];
  if (fx.echo) {
    const d = c.createDelay(2); d.delayTime.value = fx.echo;
    const fb = c.createGain(); fb.gain.value = fx.fb;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200; // cada repetição mais abafada
    const g = c.createGain(); g.gain.value = fx.wet;
    input.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(g); g.connect(out);
    mon.fx.push(d, fb, lp, g, ...reverbInto(c, input, out, fx, fx.revWet));
  } else if (fx.rev) {
    mon.fx.push(...reverbInto(c, input, out, fx, fx.wet));
  }
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
      const out = c.createGain(); out.gain.value = monVol;
      input.connect(out);              // voz seca: caminho mais curto possível
      out.connect(c.destination);
      if (c.state === 'suspended') c.resume();
      const latency = (c.baseLatency || 0) + (c.outputLatency || 0);
      mon = { s, c, input, out, fx: [], latency };
      applyEffect();
      return latency;
    }).catch(() => { try { c.close(); } catch (e) { /* ok */ } return null; }); // sem permissão: só não toca
  },

  get effect() { return effect; },
  setEffect(name) {
    if (!EFFECTS[name]) return;
    effect = name;
    localStorage.setItem('ic-fx', name);
    applyEffect();
  },

  get monitorVolume() { return monVol; },
  setMonitorVolume(v) {
    monVol = Math.min(1.5, Math.max(0, v));
    localStorage.setItem('ic-mon-vol', String(monVol));
    if (mon) mon.out.gain.setTargetAtTime(monVol, mon.c.currentTime, 0.02);
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
