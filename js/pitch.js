// Detector de altura da voz (pitch), sem nada de navegador: dá pra testar no Node.
// Método NSDF (McLeod): autocorrelação normalizada em cada atraso, então voz grave
// (período longo) não perde pontos só por ser grave, e ruído não vira nota.

const MIN_F = 65, MAX_F = 1100;
let corr = new Float32Array(0);
let flt = new Float32Array(0);

/** remove deslocamento DC (média) + passa-baixa (2 polos, ~1,6 kHz): tira chiado e ronco DC do microfone */
function lowpass(src, rate) {
  const n = src.length;
  if (flt.length !== n) flt = new Float32Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += src[i];
  mean /= n;
  const a = 1 - Math.exp(-2 * Math.PI * 1600 / rate);
  let y1 = src[0] - mean, y2 = y1;
  for (let i = 0; i < n; i++) {
    y1 += a * ((src[i] - mean) - y1);
    y2 += a * (y1 - y2);
    flt[i] = y2;
  }
  return flt;
}

/**
 * src = amostras, rate = amostras por segundo.
 * Retorna { pitch (Hz ou 0), clarity (0..1: quão "nota" é o som) }.
 */
export function detectPitch(src, rate) {
  const b = lowpass(src, rate);
  const n = b.length;
  const minLag = Math.max(2, Math.floor(rate / MAX_F));
  const maxLag = Math.min(n - 2, Math.ceil(rate / MIN_F));
  if (maxLag <= minLag) return { pitch: 0, clarity: 0 };
  if (corr.length < maxLag + 2) corr = new Float32Array(maxLag + 2);

  let energy = 0;
  for (let i = 0; i < n; i++) energy += b[i] * b[i];
  if (!(energy > 1e-9)) return { pitch: 0, clarity: 0 };

  // m(lag) = soma de b[i]² + b[i+lag]² sobre a parte que se sobrepõe (atualizada aos poucos).
  // No NSDF (McLeod), precisamos cruzar o zero saindo de lag=0 antes de procurar picos:
  // sem isso, a descida inicial do lag=0 (muito larga em voz masculina/grave) inflava
  // globalMax e fazia o detector ignorar o pico real da voz!
  let m = 2 * energy;
  let zeroLag = -1;
  const startLag = Math.max(1, minLag - 1);
  for (let lag = 1; lag < startLag; lag++) {
    m -= b[lag - 1] * b[lag - 1] + b[n - lag] * b[n - lag];
    if (zeroLag < 0) {
      let s = 0;
      const lim = n - lag;
      for (let i = 0; i < lim; i++) s += b[i] * b[i + lag];
      if (s <= 0) zeroLag = lag;
    }
  }
  for (let lag = startLag; lag <= maxLag + 1; lag++) {
    m -= b[lag - 1] * b[lag - 1] + b[n - lag] * b[n - lag];
    let s = 0;
    const lim = n - lag;
    for (let i = 0; i < lim; i++) s += b[i] * b[i + lag];
    const v = m > 1e-12 ? (2 * s) / m : 0;
    corr[lag] = v;
    if (zeroLag < 0 && v <= 0) zeroLag = lag;
  }
  if (zeroLag < 0) return { pitch: 0, clarity: 0 };

  // Só considera picos reais (máximos locais positivos) DEPOIS do primeiro cruzamento por zero
  const scanFrom = Math.max(minLag, zeroLag);
  let peakMax = 0;
  for (let lag = scanFrom; lag <= maxLag; lag++) {
    const v = corr[lag];
    if (v > peakMax && v > corr[lag - 1] && v >= corr[lag + 1]) peakMax = v;
  }
  if (peakMax < 0.55) return { pitch: 0, clarity: peakMax };   // som sem tom definido (barulho, fala sussurrada)

  // primeiro pico forte (evita pegar a oitava de baixo)
  let bestLag = -1;
  for (let lag = scanFrom; lag <= maxLag; lag++) {
    const v = corr[lag];
    if (v > corr[lag - 1] && v >= corr[lag + 1] && v > peakMax * 0.88) { bestLag = lag; break; }
  }
  if (bestLag < 0) return { pitch: 0, clarity: peakMax };
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
 * Também aceita calibração explícita (ruído ambiente + nível da voz) para microfones baixos ou ruidosos.
 */
export class VoiceGate {
  constructor(cal = null) {
    this.floor = 0.006;
    this.warm = 0;
    this.minTh = 0.004;
    this.maxTh = 0.035;
    this.unpitchedHigh = 0;   // evita que consoantes/respiros altos subam o piso de ruído
    if (cal) this.calibrate(cal.floor, cal.voice);
  }
  calibrate(floor, voice) {
    if (Number.isFinite(floor) && floor >= 0) {
      this.floor = Math.max(0.0005, Math.min(0.05, floor));
      this.warm = 40;
    }
    if (Number.isFinite(voice) && voice > 0) {
      // nunca deixa o corte subir acima de ~55% da voz real medida na calibração
      this.minTh = Math.max(0.0025, Math.min(0.006, voice * 0.2));
      this.maxTh = Math.max(this.minTh + 0.002, Math.min(0.035, voice * 0.55));
    }
  }
  threshold() { return Math.max(this.minTh, Math.min(this.maxTh, this.floor * 2.5)); }
  /** rms do quadro + pitch encontrado -> { loud, voiced } e atualiza o barulho ambiente */
  update(rms, pitch) {
    const loud = rms > this.threshold();
    // só aprende o "barulho" com som que não é nota (voz cantando não entra na conta)
    if (!pitch || !loud) {
      if (loud && !pitch) {
        // consoante/sílaba curta sem pitch não pode empurrar o piso pra cima e "engolir" a voz;
        // só sobe devagarinho se o barulho sem tom persistir por > ~0,5s seguidos
        this.unpitchedHigh++;
        if (this.unpitchedHigh >= 15) {
          this.floor += (Math.min(rms, 0.05) - this.floor) * 0.003;
        }
      } else {
        this.unpitchedHigh = 0;
        const k = this.warm < 40 ? 0.15 : rms < this.floor ? 0.08 : 0.004;   // desce rápido, sobe devagar
        this.floor += (Math.min(rms, 0.05) - this.floor) * k;
        this.warm++;
      }
    } else {
      this.unpitchedHigh = 0;
    }
    return { loud, voiced: loud && pitch > 0 };
  }
}
