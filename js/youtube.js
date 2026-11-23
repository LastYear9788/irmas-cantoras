// Player do YouTube (IFrame API oficial, grátis).

let player = null;
let apiReady = null;
let stateListeners = [];
let errorListener = null;
let cancelPrepare = null;

const ID_RE = /^[\w-]{11}$/;
const YT_HOST = /^(?:(?:www|m|music)\.)?youtube(?:-nocookie)?\.com$/;

export function extractVideoId(text) {
  text = (text || '').trim();
  if (!text) return null;
  if (ID_RE.test(text)) return text;
  // colou uma mensagem com texto + link (ex.: vinda do WhatsApp): pega só o endereço
  if (/\s/.test(text)) {
    const m = text.match(/https?:\/\/\S+/i);
    if (!m) return null;
    text = m[0];
  }
  let u;
  try { u = new URL(/^https?:\/\//i.test(text) ? text : 'https://' + text); }
  catch (e) { return null; }
  const host = u.hostname.toLowerCase();
  if (host === 'youtu.be') {
    const id = u.pathname.replace(/^\/+/, '').split('/')[0];
    return ID_RE.test(id) ? id : null;
  }
  if (!YT_HOST.test(host)) return null;
  const v = u.searchParams.get('v');
  if (v !== null) return ID_RE.test(v) ? v : null;
  const m = u.pathname.match(/^\/(?:v|shorts|embed|live)\/([\w-]{11})(?:\/|$)/);
  return m ? m[1] : null;
}

export function thumbUrl(id) { return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`; }

function loadApi() {
  if (apiReady) return apiReady;
  apiReady = new Promise((resolve, reject) => {
    window.onYouTubeIframeAPIReady = resolve;
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    // internet oscilou: esquece a tentativa, pra próxima música tentar baixar de novo (sem F5)
    s.onerror = () => { apiReady = null; s.remove(); reject(new Error('Não consegui abrir o YouTube. Confere a internet e tenta de novo.')); };
    document.head.appendChild(s);
  });
  return apiReady;
}

let playerP = null;   // criando o player agora (2 pedidos juntos não criam 2 players)
async function getPlayer() {
  await loadApi();
  if (player) return player;
  if (playerP) return playerP;
  playerP = new Promise((resolve) => {
    const p = new YT.Player('yt', {
      width: '1280', height: '720',
      playerVars: {
        controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1,
        iv_load_policy: 3, fs: 0, origin: location.origin, cc_load_policy: 0,
      },
      events: {
        onReady: () => { player = p; resolve(p); },
        onStateChange: (e) => {
          // legenda automática do YouTube por cima dos botões (a letra já está na tela)
          if (e.data === 1) { try { p.unloadModule('captions'); p.unloadModule('cc'); } catch (x) { /* ok */ } }
          stateListeners.forEach((fn) => fn(e.data));
        },
        onError: (e) => errorListener && errorListener(e.data),
      },
    });
  });
  return playerP;
}

export function onState(fn) { stateListeners.push(fn); }

/**
 * Carrega o vídeo e confirma que ele pode tocar aqui (alguns vídeos bloqueiam).
 * Dá um "play" mudo bem rapidinho pra testar e volta pro começo.
 * Retorna { title, author, duration }.
 */
export async function prepare(videoId) {
  // se o YouTube nem carregar (internet ruim, bloqueio), não fica esperando pra sempre
  const p = await Promise.race([
    getPlayer(),
    new Promise((_, rej) => setTimeout(() => rej(new Error('Não consegui abrir o YouTube. Confere a internet e tenta de novo.')), 20000)),
  ]);
  if (cancelPrepare) cancelPrepare();
  return new Promise((resolve, reject) => {
    let finished = false;
    cancelPrepare = () => finish(reject, new Error('cancelado'));
    const finish = (fn, val) => {
      if (finished) return;
      finished = true;
      clearInterval(poll);
      clearTimeout(timeout);
      errorListener = null;
      cancelPrepare = null;
      fn(val);
    };

    errorListener = (code) => {
      const msg = (code === 101 || code === 150 || code === 153 || code === 100)
        ? 'Esse vídeo não pode tocar aqui (ele bloqueia outros sites ou não existe mais). Tenta outro link da mesma música.'
        : 'Não consegui abrir esse vídeo. Confere o link!';
      finish(reject, new Error(msg));
    };

    p.mute();
    p.loadVideoById(videoId, 0);

    let metaAt = 0;
    const poll = setInterval(() => {
      const st = p.getPlayerState();
      const d = p.getDuration();
      const data = p.getVideoData() || {};
      if (!(d > 0 && data.title)) return;
      // logo depois de trocar de vídeo, o player ainda responde com o nome/duração do ANTERIOR
      if (data.video_id && data.video_id !== videoId) return;
      const info = { title: data.title, author: data.author || '', duration: d };
      if (st === YT.PlayerState.PLAYING) {
        p.pauseVideo();
        p.seekTo(0, true);
        return finish(resolve, info);
      }
      // às vezes o navegador não deixa nem o play mudo de teste; se já temos nome e
      // duração e não deu erro em 2,5s, o vídeo está ok (na hora do jogo tem o botão "Clique para começar")
      if (!metaAt) { metaAt = Date.now(); p.playVideo(); }
      else if (Date.now() - metaAt > 2500) {
        p.cueVideoById(videoId, 0);
        finish(resolve, info);
      }
    }, 200);

    const timeout = setTimeout(() => finish(reject, new Error('O vídeo demorou demais pra carregar. Tenta de novo.')), 15000);
  });
}

let muted = false;
export function play() { if (player) { if (muted) player.mute(); else { player.unMute(); player.setVolume(100); } player.playVideo(); } }
/** liga/desliga o som da música (só neste PC) */
export function setMuted(m) { muted = m; if (player) { if (m) player.mute(); else { player.unMute(); player.setVolume(100); } } }
export function pause() { if (player) player.pauseVideo(); }
/** volta pro começo sem dar play (se o vídeo estiver só "carregado", já está no começo) */
export function rewind() {
  if (!player) return;
  const st = player.getPlayerState();
  // inclui "terminou" (0): sem isso, a revanche achava que a música já tinha acabado
  if (st === 0 || st === 1 || st === 2 || st === 3) { tRaw = -1; player.seekTo(0, true); player.pauseVideo(); }
}
export function seek(t) { tRaw = -1; if (player) player.seekTo(Math.max(0, t), true); }
// O tempo que o YouTube informa anda "aos pulinhos" (principalmente em PC fraco).
// Entre um pulinho e outro, a gente completa com o relógio, pra letra andar lisinha.
let tRaw = -1, tAt = 0;
export function time() {
  if (!player) return 0;
  const raw = player.getCurrentTime() || 0;
  const now = performance.now();
  if (raw !== tRaw) { tRaw = raw; tAt = now; return raw; }
  return player.getPlayerState() === 1 ? raw + Math.min(0.4, (now - tAt) / 1000) : raw;
}
export function state() { return player ? player.getPlayerState() : -1; }
export function isPlaying() { return player && player.getPlayerState() === 1; }
export function duration() { return player ? player.getDuration() || 0 : 0; }
