// Microfone: volume e altura (pitch) da voz, direto no navegador.
import { detectPitch, VoiceGate, SignalWatch } from './pitch.js?v=19';

const CFG_KEY = 'ic-mic-cfg';

function loadCfg() {
  try {
    const raw = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
    return {
      deviceId: typeof raw.deviceId === 'string' ? raw.deviceId : '',
      rawMode: !!raw.rawMode,
      calFloor: Number.isFinite(raw.calFloor) ? raw.calFloor : null,
      calVoice: Number.isFinite(raw.calVoice) ? raw.calVoice : null,
      calDevice: typeof raw.calDevice === 'string' ? raw.calDevice : '',
      calibratedAt: Number.isFinite(raw.calibratedAt) ? raw.calibratedAt : 0,
    };
  } catch (e) {
    return { deviceId: '', rawMode: false, calFloor: null, calVoice: null, calDevice: '', calibratedAt: 0 };
  }
}

let cfg = loadCfg();
function saveCfg() {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) { /* ok */ }
}

let ctx = null, analyser = null, buf = null, half = null, stream = null, src = null;
let monGain = null;           // monitoramento direto quando o stream já está em rawMode (sem abrir 2º microfone)
let mon = null, monToken = 0; // "me ouvir" separado quando o stream principal usa echoCancellation
let activeRaw = false;        // se o stream atual foi aberto sem filtros do navegador
let activeDeviceId = '';

function stopMonitor() {
  if (monGain) {
    try { monGain.disconnect(); } catch (e) { /* ok */ }
    monGain = null;
  }
  if (!mon) return;
  const old = mon;
  mon = null;
  old.s.getTracks().forEach((t) => t.stop());
  try { old.c.close(); } catch (e) { /* ok */ }
}

let recorder = null;
let gate = new VoiceGate();
let last = null, lastAt = 0;
let watch = new SignalWatch();   // mudo de verdade / travado (do microfone principal)
let readCost = 0;         // quanto tempo (ms) uma leitura leva, média

const OFF = { rms: 0, level: 0, pitch: 0, voiced: false, loud: false, clarity: 0, peak: 0, dc: 0, threshold: 0.008 };

function pickFftSize(rate) {
  if (rate <= 12000) return 512;
  if (rate <= 24000) return 1024;
  return 2048;
}

function makeGate() {
  const g = new VoiceGate();
  if (cfg.calFloor != null && cfg.calVoice != null) g.calibrate(cfg.calFloor, cfg.calVoice);
  return g;
}

function buildAudioConstraints(rawMode, deviceId) {
  const audio = rawMode
    ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    // sem "redução de ruído": ela confunde nota sustentada com barulho e abafa a voz.
    // O cancelamento de eco fica (segura a música que vaza da caixa de som).
    : { echoCancellation: true, noiseSuppression: false, autoGainControl: true };
  if (deviceId) audio.deviceId = { ideal: deviceId };
  return audio;
}

function sampleSig(b) {
  const n = b.length;
  return `${b[0]},${b[n >> 3]},${b[n >> 2]},${b[(n * 3) >> 3]},${b[n >> 1]},${b[(n * 5) >> 3]},${b[(n * 3) >> 2]},${b[n - 1]}`;
}

/**
 * De onde ler: do "Me ouvir" (áudio cru) se ele estiver funcionando; senão do principal.
 * Em alguns PCs o Windows entrega silêncio pro 2º acesso ao mesmo microfone: aí
 * continua pelo principal em vez de ficar "surdo".
 */
function source(now) {
  if (mon && mon.c.state === 'running' && !mon.watch.problem(now)) {
    return { c: mon.c, an: mon.an, b: mon.buf, h: mon.half, g: mon.gate, w: mon.watch, s: mon.s };
  }
  return { c: ctx, an: analyser, b: buf, h: half, g: gate, w: watch, s: stream };
}

export const mic = {
  active: false,
  onLost: null,

  getConfig() { return { ...cfg }; },

  setConfig(patch) {
    cfg = { ...cfg, ...patch };
    saveCfg();
    return { ...cfg };
  },

  applyCalibration({ floor, voice, label }) {
    cfg.calFloor = floor;
    cfg.calVoice = voice;
    cfg.calDevice = label || mic.label();
    cfg.calibratedAt = Date.now();
    saveCfg();
    gate.calibrate(floor, voice);
    if (mon && mon.gate) mon.gate.calibrate(floor, voice);
  },

  async listDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter((d) => d.kind === 'audioinput');
    } catch (e) { return []; }
  },

  async start(opts = {}) {
    const wantRaw = opts.rawMode !== undefined ? !!opts.rawMode : cfg.rawMode;
    const wantDev = opts.deviceId !== undefined ? String(opts.deviceId || '') : cfg.deviceId;
    if (mic.active) {
      if (wantRaw === activeRaw && wantDev === activeDeviceId) return;
      mic.stop();
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: buildAudioConstraints(wantRaw, wantDev),
      });
    } catch (e) {
      const n = e && e.name;
      throw new Error(n === 'NotFoundError' || n === 'OverconstrainedError'
        ? 'Nenhum microfone encontrado. Conecta um e tenta de novo.'
        : n === 'NotReadableError' || n === 'AbortError'
          ? 'O microfone está sendo usado por outro programa (Discord, Zoom, WhatsApp…) ou travou. Fecha o outro programa e tenta de novo.'
          : 'O microfone foi bloqueado. Clica no cadeado ao lado do endereço do site e permite o microfone.');
    }
    ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = pickFftSize(ctx.sampleRate);
    src.connect(analyser);
    buf = new Float32Array(analyser.fftSize);
    half = new Float32Array(analyser.fftSize / 2);
    gate = makeGate();
    activeRaw = wantRaw;
    const tr = stream.getAudioTracks()[0];
    const st = tr && tr.getSettings ? tr.getSettings() : {};
    activeDeviceId = wantDev || st.deviceId || '';
    last = null; lastAt = 0; watch.reset();
    mic.active = true;
    // fio puxado / fone bluetooth desligou
    const mine = stream;
    stream.getAudioTracks().forEach((t) => t.addEventListener('ended', () => {
      if (stream !== mine) return;
      mic.active = false;
      last = null;
      monToken++; stopMonitor();
      try { ctx.close(); } catch (e) { /* ok */ }
      ctx = null; analyser = null; src = null; stream = null;
      if (mic.onLost) mic.onLost();
    }));
  },

  stop() {
    mic.recCancel();
    monToken++;
    stopMonitor();
    const s = stream;
    stream = null;
    mic.active = false;
    last = null; lastAt = 0; watch.reset();
    if (s) s.getTracks().forEach((t) => t.stop());
    if (ctx) { try { ctx.close(); } catch (e) { /* ok */ } ctx = null; }
    analyser = null; src = null;
  },

  async restart(opts = {}) {
    const wasMon = !!(monGain || mon);
    mic.stop();
    await mic.start(opts);
    if (wasMon) mic.monitor(true);
  },

  /**
   * Liga/desliga ouvir a própria voz no fone (só faz sentido com fone de ouvido).
   * Se o microfone já está em modo fone (sem filtro de eco), reaproveita o MESMO áudio
   * (zero conflito com Discord/Windows e gravação perfeita).
   * Se está com filtro de eco, abre um caminho paralelo cru pro fone e pra análise/gravação.
   */
  monitor(on) {
    const token = ++monToken;
    if (!on || !mic.active) { stopMonitor(); last = null; return; }
    if (activeRaw && ctx && src) {
      if (monGain) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      monGain = ctx.createGain();
      monGain.gain.value = 1;
      src.connect(monGain);
      monGain.connect(ctx.destination);
      return;
    }
    if (mon) return;
    const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, latency: 0 };
    if (activeDeviceId) audio.deviceId = { ideal: activeDeviceId };
    navigator.mediaDevices.getUserMedia({ audio }).then((s) => {
      if (token !== monToken || mon || !mic.active) { s.getTracks().forEach((t) => t.stop()); return; }
      const c = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 0 });
      const source = c.createMediaStreamSource(s);
      source.connect(c.destination);
      const an = c.createAnalyser();
      an.fftSize = pickFftSize(c.sampleRate);
      source.connect(an);
      if (c.state === 'suspended') c.resume().catch(() => {});
      const entry = { s, c, an, buf: new Float32Array(an.fftSize), half: new Float32Array(an.fftSize / 2), gate: makeGate(), watch: new SignalWatch() };
      s.getAudioTracks().forEach((t) => t.addEventListener('ended', () => {
        if (mon === entry) { stopMonitor(); last = null; }
      }));
      mon = entry;
      last = null;
    }).catch(() => { /* sem permissão: só não toca */ });
  },

  /** Começa a gravar a voz (pra ouvir no final). Usa o stream limpo se "Me ouvir" estiver ligado. */
  recStart() {
    mic.recCancel();
    if (!mic.active || typeof MediaRecorder === 'undefined') return false;
    const recStream = (mon && mon.s && mon.s.getAudioTracks().some((t) => t.readyState === 'live')) ? mon.s : stream;
    if (!recStream) return false;
    try {
      const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
      recorder = new MediaRecorder(recStream, type ? { mimeType: type, audioBitsPerSecond: 96000 } : undefined);
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

  /**
   * Lê o microfone agora.
   * needPitch=false faz leitura leve só de volume (pro medidor do lobby, sem gastar CPU com afinação).
   */
  read(needPitch = true) {
    if (!mic.active) return OFF;
    const now = performance.now();
    // ~30 leituras por segundo bastam (e poupam PC fraco: a afinação é a conta mais pesada do jogo)
    if (last && now - lastAt < 30 && (!needPitch || last._hasPitch)) return last;
    lastAt = now;
    // "Me ouvir" ficou de fora por estar mudo/travado: continua espiando, pra voltar quando ele acordar
    if (mon && mon.c.state === 'running' && mon.watch.problem(now)) {
      mon.an.getFloatTimeDomainData(mon.buf);
      let mp = 0;
      for (let i = 0; i < mon.buf.length; i++) { const v = Math.abs(mon.buf[i]); if (v > mp) mp = v; }
      mon.watch.update(mp, mp, mp ? sampleSig(mon.buf) : null, now);
    }
    const { c, an, b, h, g, w } = source(now);
    if (!c || !an || !b) return OFF;
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (mon && mon.c.state === 'suspended') mon.c.resume().catch(() => {});
    an.getFloatTimeDomainData(b);

    // remove deslocamento DC (média) antes de calcular volume real e pico
    let mean = 0, rawPeak = 0;
    for (let i = 0; i < b.length; i++) {
      const v = b[i];
      mean += v;
      const av = v < 0 ? -v : v;
      if (av > rawPeak) rawPeak = av;
    }
    mean /= b.length;
    let sum = 0, peak = 0;
    for (let i = 0; i < b.length; i++) {
      const v = b[i] - mean;
      sum += v * v;
      const av = v < 0 ? -v : v;
      if (av > peak) peak = av;
    }
    const rms = Math.sqrt(sum / b.length);
    w.update(rawPeak, peak, rawPeak ? sampleSig(b) : null, now);

    const th = g.threshold();
    if (!needPitch) {
      last = {
        rms, level: Math.min(1, rms * 8), pitch: 0, voiced: false, loud: rms > th,
        clarity: 0, peak, dc: Math.abs(mean), threshold: th, _hasPitch: false,
      };
      return last;
    }

    let pitch = 0, clarity = 0;
    if (rms > th) {
      // metade das amostras (média de 2 em 2): voz vai até ~1100 Hz, então 24 mil por segundo sobra
      let r;
      if (c.sampleRate >= 32000) {
        for (let i = 0; i < h.length; i++) h[i] = (b[2 * i] + b[2 * i + 1]) * 0.5;
        r = detectPitch(h, c.sampleRate / 2);
      } else {
        r = detectPitch(b, c.sampleRate);
      }
      pitch = r.pitch; clarity = r.clarity;
    }
    const { loud, voiced } = g.update(rms, pitch);
    readCost = readCost * 0.9 + (performance.now() - now) * 0.1;
    last = {
      rms, level: Math.min(1, rms * 8), pitch: voiced ? pitch : 0, voiced, loud,
      clarity: voiced ? clarity : 0, peak, dc: Math.abs(mean), threshold: g.threshold(), _hasPitch: true,
      // pro relatório de diagnóstico: o que o detector achou antes do portão, e de qual áudio leu
      rawPitch: pitch, rawClarity: clarity, floor: g.floor, src: w === watch ? 'main' : 'mon',
    };
    return last;
  },

  /** nome do microfone (ex.: "Fone Bluetooth Hands-Free"), pra dar tolerância de atraso */
  label() {
    const { s } = source(performance.now());
    const t = s && s.getAudioTracks()[0];
    return (t && t.label) || '';
  },

  /** informações técnicas pro diagnóstico / calibração */
  info() {
    const { s, c, g, w } = source(performance.now());
    const t = s && s.getAudioTracks()[0];
    const settings = (t && t.getSettings) ? t.getSettings() : {};
    const label = (t && t.label) || '';
    const sampleRate = (c && c.sampleRate) || settings.sampleRate || 0;
    const bluetooth = /bluetooth|hands-?free|headset|airpods|buds|\bbt\b/i.test(label) || (sampleRate > 0 && sampleRate <= 16000);
    return {
      active: mic.active,
      label,
      deviceId: settings.deviceId || activeDeviceId || cfg.deviceId || '',
      sampleRate,
      rawMode: activeRaw,
      settings,
      floor: g.floor,
      threshold: g.threshold(),
      calibrated: !!(cfg.calibratedAt && cfg.calVoice),
      bluetooth,
      heard: w.heard,     // já chegou som de verdade desde que abriu
      gated: w.gated,     // o microfone zera o som quando está quieto (filtro do Windows/fone)
    };
  },

  /** o navegador pausou o áudio? tenta voltar (precisa ser num clique) */
  resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (mon && mon.c.state === 'suspended') mon.c.resume().catch(() => {});
  },

  /** Situação do microfone, pro aviso na tela: o que pode estar impedindo de contar ponto */
  status() {
    if (!mic.active) return { problem: 'off' };
    const now = performance.now();
    const { s, c, g, w } = source(now);
    const track = s && s.getAudioTracks()[0];
    if (!track || track.readyState !== 'live') return { problem: 'off' };
    if (track.muted || track.enabled === false) return { problem: 'muted' };  // sistema/outro programa calou o microfone
    if (c && c.state !== 'running' && c.state !== 'suspended') return { problem: 'off' };
    if (c && c.state === 'suspended') return { problem: 'suspended' };
    const p = w.problem(now);
    if (p) return { problem: p };
    return { problem: null, floor: g.floor, cost: readCost, label: track.label || '' };
  },
};
