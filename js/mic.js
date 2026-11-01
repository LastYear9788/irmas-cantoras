// Microfone: volume e altura (pitch) da voz, direto no navegador.

let ctx = null, analyser = null, buf = null, stream = null;
let noiseFloor = 0.01;
let last = null, lastAt = 0;

export const mic = {
  active: false,

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
    const src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);
    buf = new Float32Array(analyser.fftSize);
    mic.active = true;
    calibrate();
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
    last = { rms, level: Math.min(1, rms * 8), pitch, voiced: loud && pitch > 0 };
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
  // interpolação parabólica pra precisão
  const a = corr[bestLag - 1], c = corr[bestLag + 1];
  const shift = (a - c) / (2 * (a - 2 * best + c)) || 0;
  return rate / (bestLag + shift);
}
