// Detector de altura da voz (pitch), sem nada de navegador: dá pra testar no Node.
// Método NSDF (McLeod): autocorrelação normalizada em cada atraso, então voz grave
// (período longo) não perde pontos só por ser grave, e ruído não vira nota.

const MIN_F = 80, MAX_F = 1100;
let corr = new Float32Array(0);
let flt = new Float32Array(0);

/** passa-baixa (2 polos, ~1,6 kHz): tira o chiado do microfone e deixa a voz */
function lowpass(src, rate) {
  const n = src.length;
  if (flt.length !== n) flt = new Float32Array(n);
  const a = 1 - Math.exp(-2 * Math.PI * 1600 / rate);
  let y1 = src[0], y2 = src[0];
  for (let i = 0; i < n; i++) { y1 += a * (src[i] - y1); y2 += a * (y1 - y2); flt[i] = y2; }
  return flt;
}

/**
 * b = amostras, rate = amostras por segundo.
 * Retorna { pitch (Hz ou 0), clarity (0..1: quão "nota" é o som) }.
 */
export function detectPitch(src, rate) {
  const b = lowpass(src, rate);
  const n = b.length;
  const minLag = Math.max(2, Math.floor(rate / MAX_F));
  const maxLag = Math.min(n - 2, Math.ceil(rate / MIN_F));
  if (corr.length < maxLag + 2) corr = new Float32Array(maxLag + 2);

  let energy = 0;
  for (let i = 0; i < n; i++) energy += b[i] * b[i];
  if (!(energy > 1e-9)) return { pitch: 0, clarity: 0 };

  // m(lag) = soma de b[i]² + b[i+lag]² sobre a parte que se sobrepõe (atualizada aos poucos)
  let m = 2 * energy;
  for (let lag = 1; lag < minLag - 1; lag++) m -= b[lag - 1] * b[lag - 1] + b[n - lag] * b[n - lag];
  let globalMax = 0;
  for (let lag = Math.max(1, minLag - 1); lag <= maxLag + 1; lag++) {
    m -= b[lag - 1] * b[lag - 1] + b[n - lag] * b[n - lag];
    let s = 0;
    const lim = n - lag;
    for (let i = 0; i < lim; i++) s += b[i] * b[i + lag];
    const v = m > 1e-12 ? (2 * s) / m : 0;
    corr[lag] = v;
    if (lag >= minLag && lag <= maxLag && v > globalMax) globalMax = v;
  }
  if (globalMax < 0.55) return { pitch: 0, clarity: globalMax };   // som sem tom definido (barulho, fala sussurrada)

  // primeiro pico forte (evita pegar a oitava de baixo)
  let bestLag = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (corr[lag] > corr[lag - 1] && corr[lag] >= corr[lag + 1] && corr[lag] > globalMax * 0.88) { bestLag = lag; break; }
  }
  if (bestLag < 0) return { pitch: 0, clarity: globalMax };
  const best = corr[bestLag];
  // interpolação parabólica pra precisão
  const a = corr[bestLag - 1], c = corr[bestLag + 1];
  const den = a - 2 * best + c;
  const shift = den ? (a - c) / (2 * den) : 0;
  const pitch = rate / (bestLag + Math.max(-0.5, Math.min(0.5, shift)));
  return { pitch: pitch >= MIN_F * 0.97 && pitch <= MAX_F * 1.03 ? pitch : 0, clarity: best };
}

/**
 * Decide se tem voz cantando agora e mantém a medida do barulho ambiente se adaptando
 * (antes era medido uma vez só ao ligar o microfone: se tivesse alguém falando naquela hora,
 * o app ficava "surdo" o resto da noite).
 */
export class VoiceGate {
  constructor() { this.floor = 0.006; this.warm = 0; }
  threshold() { return Math.max(0.008, Math.min(0.035, this.floor * 2.5)); }
  /** rms do quadro + pitch encontrado -> { loud, voiced } e atualiza o barulho ambiente */
  update(rms, pitch) {
    const loud = rms > this.threshold();
    // só aprende o "barulho" com som que não é nota (voz cantando não entra na conta)
    if (!pitch || !loud) {
      const k = this.warm < 40 ? 0.15 : rms < this.floor ? 0.08 : 0.004;   // desce rápido, sobe devagar
      this.floor += (Math.min(rms, 0.05) - this.floor) * k;
      this.warm++;
    }
    return { loud, voiced: loud && pitch > 0 };
  }
}
