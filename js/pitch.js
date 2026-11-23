// Detector de altura da voz (pitch), sem nada de navegador: dá pra testar no Node.
// Método NSDF (McLeod): autocorrelação normalizada em cada atraso, então voz grave
// (período longo) não perde pontos só por ser grave, e ruído não vira nota.

const MIN_F = 65, MAX_F = 1100;
let corr = new Float32Array(0);
let flt = new Float32Array(0);

/**
 * De quantas em quantas amostras juntar antes de procurar a nota: voz vai até ~1100 Hz,
 * então ~24 mil por segundo sobra. Em placa de 96/192 kHz junta de 4/8 (senão a janela
 * ficava curta demais pra voz grave e o detector errava).
 */
export function decimationFor(rate) {
  if (rate <= 24000) return 1;
  let d = 2;
  while (rate / d > 36000) d *= 2;
  return d;
}
/** Tamanho do pedaço de áudio lido: ~43 ms (e ~1024 amostras pro detector) em qualquer taxa */
export function fftSizeFor(rate) {
  if (rate <= 12000) return 512;
  if (rate <= 24000) return 1024;
  return 1024 * decimationFor(rate);
}
/** Junta as amostras de d em d (média) em out e devolve a nota de out */
export function detectPitchDecimated(b, rate, out) {
  const d = decimationFor(rate);
  if (d === 1) return detectPitch(b, rate);
  const n = Math.min(out.length, Math.floor(b.length / d));
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = 0; k < d; k++) sum += b[i * d + k];
    out[i] = sum / d;
  }
  return detectPitch(n === out.length ? out : out.subarray(0, n), rate / d);
}

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
 * Vigia o sinal bruto do microfone pra saber se ele está mudo/travado DE VERDADE.
 * Cuidado: muito microfone (filtro do Windows, do fone, cancelamento de eco do navegador)
 * manda zero absoluto quando a pessoa fica quieta. Isso não é defeito: se já chegou som
 * real alguma vez desde que o microfone abriu, silêncio digital é só "quieto".
 */
export const REAL_SIGNAL = 2e-6;
export class SignalWatch {
  constructor() { this.reset(); }
  reset() { this.heard = false; this.silentSince = 0; this.frozenSince = 0; this.prevSig = null; this.gated = false; }
  /** rawPeak = maior amostra, peak = maior amostra sem DC, sig = "assinatura" do buffer */
  update(rawPeak, peak, sig, now) {
    if (rawPeak === 0 || peak < REAL_SIGNAL) {
      // silêncio digital (ou nível constante, que também é silêncio)
      if (!this.silentSince) this.silentSince = now;
      if (this.heard) this.gated = true;
      this.frozenSince = 0; this.prevSig = null;
      return;
    }
    this.heard = true;
    this.silentSince = 0;
    // mesmo som real repetido entre leituras = o áudio parou de andar (driver travado)
    if (sig === this.prevSig) { if (!this.frozenSince) this.frozenSince = now; }
    else { this.prevSig = sig; this.frozenSince = 0; }
  }
  problem(now) {
    if (!this.heard && this.silentSince && now - this.silentSince > 2500) return 'silent';
    if (this.frozenSince && now - this.frozenSince > 2500) return 'frozen';
    return null;
  }
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
