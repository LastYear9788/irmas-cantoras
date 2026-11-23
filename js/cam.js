// Câmera (opcional): tira fotos pequenas durante a música. Nada é guardado — só fica na memória.
import { mediaUnavailableMsg } from './mic.js?v=23';

let stream = null;
let video = null;       // vídeo "invisível" usado pra tirar as fotos
const W = 320, H = 240;

export const cam = {
  active: false,
  onLost: null,

  /** liga a câmera e mostra a prévia no elemento <video> passado */
  async start(preview) {
    if (cam.active) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error(mediaUnavailableMsg('A câmera'));
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      });
    } catch (e) {
      const n = e && e.name;
      throw new Error(
        n === 'NotFoundError' || n === 'OverconstrainedError' ? 'Nenhuma câmera encontrada nesse PC.'
          : n === 'NotReadableError' ? 'A câmera está sendo usada por outro programa (Discord, Zoom…). Fecha ele e tenta de novo.'
            : 'A câmera foi bloqueada. Clica no cadeado ao lado do endereço do site e permite a câmera.');
    }
    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    // na página (minúsculo e invisível): alguns navegadores param de atualizar vídeo fora da página → foto preta
    video.setAttribute('aria-hidden', 'true');
    video.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1';
    document.body.appendChild(video);
    video.srcObject = stream;
    await video.play().catch(() => {});
    if (preview) { preview.srcObject = stream; preview.play().catch(() => {}); }
    cam.active = true;
    const mine = stream;
    stream.getVideoTracks().forEach((t) => t.addEventListener('ended', () => {
      if (stream !== mine) return;   // câmera antiga (já desligada e religada): não derruba a nova
      cam.stop(preview);
      if (cam.onLost) cam.onLost();
    }));
  },

  stop(preview) {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    if (video) { video.srcObject = null; video.remove(); }
    video = null;
    if (preview) preview.srcObject = null;
    cam.active = false;
  },

  /** tira uma foto (espelhada, igual selfie) e devolve como imagem JPEG pequena (~20 KB) */
  snap() {
    if (!cam.active || !video || !video.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    // recorta pro formato 4:3 sem distorcer
    const vw = video.videoWidth, vh = video.videoHeight;
    const scale = Math.max(W / vw, H / vh);
    const sw = W / scale, sh = H / scale;
    g.translate(W, 0); g.scale(-1, 1);
    g.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, W, H);
    return c.toDataURL('image/jpeg', 0.72);
  },
};
