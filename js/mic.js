// Microfone: volume e altura (pitch) da voz, direto no navegador.
import { detectPitch, VoiceGate } from './pitch.js?v=17';

let ctx = null, analyser = null, buf = null, half = null, stream = null, src = null;
let mon = null, monToken = 0;   // "me ouvir": voz indo direto pro fone (e, nesse caso, a análise usa esse caminho)
function stopMonitor() {
  if (!mon) return;
  mon.s.getTracks().forEach((t) => t.stop());
  try { mon.c.close(); } catch (e) { /* ok */ }
  mon = null;
}
let recorder = null;
let gate = new VoiceGate();
let last = null, lastAt = 0;
let silentSince = 0;      // desde quando o microfone manda silêncio absoluto (zerado)
let readCost = 0;         // quanto tempo (ms) uma leitura leva, média

const OFF = { rms: 0, level: 0, pitch: 0, voiced: false, loud: false, clarity: 0 };

export const mic = {
  active: false,
  onLost: null,

  async start() {
    if (mic.active) return;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // sem "redução de ruído": ela confunde nota sustentada com barulho e abafa a voz.
        // O cancelamento de eco fica (segura a música que vaza da caixa de som).
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true },
      });
    } catch (e) {
      const n = e && e.name;
      throw new Error(n === 'NotFoundError' || n === 'OverconstrainedError'
        ? 'Nenhum microfone encontrado. Conecta um e tenta de novo.'
        : n === 'NotReadableError' || n === 'AbortError'
          ? 'O microfone está sendo usado por outro programa (Discord, Zoom, WhatsApp…) ou travou. Fecha o outro programa e tenta de novo.'
          : 'O microfone foi bloqueado. Clica no cadeado ao lado do endereço do site e permite o microfone.');
    }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);
    buf = new Float32Array(analyser.fftSize);
    half = new Float32Array(analyser.fftSize / 2);
    gate = new VoiceGate();
    last = null; silentSince = 0;
    mic.active = true;
    // fio puxado / fone bluetooth desligou
    const mine = stream;
    stream.getAudioTracks().forEach((t) => t.addEventListener('ended', () => {
      if (stream !== mine) return;
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
   * tocando no fone e deixava tudo travado) e um áudio próprio de baixa latência.
   * Enquanto está ligado, a pontuação também ouve por esse caminho: o filtro de eco do
   * caminho normal "escuta" a própria voz saindo no fone e apaga ela do microfone.
   */
  monitor(on) {
    const token = ++monToken;
    if (!on || !mic.active) { stopMonitor(); last = null; return; }
    if (mon) return;
    navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, latency: 0 },
    }).then((s) => {
      if (token !== monToken || mon) { s.getTracks().forEach((t) => t.stop()); return; }
      const c = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 0 });
      const source = c.createMediaStreamSource(s);
      source.connect(c.destination);
      const an = c.createAnalyser();
      an.fftSize = 2048;
      source.connect(an);
      if (c.state === 'suspended') c.resume();
      mon = { s, c, an, gate: new VoiceGate() };
      last = null;
    }).catch(() => { /* sem permissão: só não toca */ });
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

  /** Lê o microfone agora. { rms, level (0-1 pra barra), pitch (Hz ou 0), voiced, loud, clarity } */
  read() {
    if (!mic.active) return OFF;
    const now = performance.now();
    // ~30 leituras por segundo bastam (e poupam PC fraco: a afinação é a conta mais pesada do jogo)
    if (last && now - lastAt < 30) return last;
    lastAt = now;
    const useMon = mon && mon.c.state === 'running';
    const c = useMon ? mon.c : ctx;
    const an = useMon ? mon.an : analyser;
    const g = useMon ? mon.gate : gate;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (mon && mon.c.state === 'suspended') mon.c.resume().catch(() => {});
    an.getFloatTimeDomainData(buf);
    let sum = 0, peak = 0;
    for (let i = 0; i < buf.length; i++) { const v = buf[i]; sum += v * v; if (v > peak) peak = v; else if (-v > peak) peak = -v; }
    const rms = Math.sqrt(sum / buf.length);
    if (peak === 0) { if (!silentSince) silentSince = now; } else silentSince = 0;
    let pitch = 0, clarity = 0;
    if (rms > g.threshold()) {
      // metade das amostras (média de 2 em 2): voz vai até ~1100 Hz, então 24 mil por segundo sobra
      let r;
      if (c.sampleRate >= 32000) {
        for (let i = 0; i < half.length; i++) half[i] = (buf[2 * i] + buf[2 * i + 1]) * 0.5;
        r = detectPitch(half, c.sampleRate / 2);
      } else r = detectPitch(buf, c.sampleRate);
      pitch = r.pitch; clarity = r.clarity;
    }
    const { loud, voiced } = g.update(rms, pitch);
    readCost = readCost * 0.9 + (performance.now() - now) * 0.1;
    last = { rms, level: Math.min(1, rms * 8), pitch: voiced ? pitch : 0, voiced, loud, clarity: voiced ? clarity : 0, peak };
    return last;
  },

  /** nome do microfone (ex.: "Fone Bluetooth Hands-Free"), pra dar tolerância de atraso */
  label() {
    const t = stream && stream.getAudioTracks()[0];
    return (t && t.label) || '';
  },

  /** o navegador pausou o áudio? tenta voltar (precisa ser num clique) */
  resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (mon && mon.c.state === 'suspended') mon.c.resume().catch(() => {});
  },

  /** Situação do microfone, pro aviso na tela: o que pode estar impedindo de contar ponto */
  status() {
    if (!mic.active) return { problem: 'off' };
    const track = stream && stream.getAudioTracks()[0];
    if (track && track.muted) return { problem: 'muted' };                 // sistema/outro programa calou o microfone
    if (track && track.enabled === false) return { problem: 'muted' };
    if (ctx && ctx.state !== 'running' && ctx.state !== 'suspended') return { problem: 'off' };
    if (ctx && ctx.state === 'suspended') return { problem: 'suspended' };
    if (silentSince && performance.now() - silentSince > 2500) return { problem: 'silent' };
    return { problem: null, floor: (mon && mon.c.state === 'running' ? mon.gate : gate).floor, cost: readCost, label: track ? track.label : '' };
  },
};
