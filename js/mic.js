// Microfone: volume e altura (pitch) da voz, direto no navegador.

let ctx = null, analyser = null, buf = null, stream = null, src = null;
let monitorGain = null;   // "me ouvir": voz indo direto pro fone
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
    mic.active = true;
    calibrate();
    // fio puxado / fone bluetooth desligou
    stream.getAudioTracks().forEach((t) => t.addEventListener('ended', () => {
      mic.active = false;
      last = null;
      monitorGain = null;
      try { ctx.close(); } catch (e) { /* ok */ }
      if (mic.onLost) mic.onLost();
    }));
  },

  /** Liga/desliga ouvir a própria voz no fone (só faz sentido com fone de ouvido). */
  monitor(on) {
    if (!mic.active) return;
    if (on && !monitorGain) {
      if (ctx.state === 'suspended') ctx.resume();
      monitorGain = ctx.createGain();
      monitorGain.gain.value = 1;
      src.connect(monitorGain);
      monitorGain.connect(ctx.destination);
    } else if (!on && monitorGain) {
      try { src.disconnect(monitorGain); monitorGain.disconnect(); } catch (e) { /* ok */ }
      monitorGain = null;
    }
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
    if (last && now - lastAt < 8) return last;   // já leu neste quadro
    lastAt = now;
    if (ctx.state === 'suspended') ctx.resume();
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const loud = rms > Math.max(0.012, noiseFloor * 2.5);
    const pitch = loud ? detectPitch(buf, ctx.sampleRate) : 0;
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
