// Player do YouTube (IFrame API oficial, grátis).

let player = null;
let apiReady = null;
let stateListeners = [];
let errorListener = null;
let cancelPrepare = null;

export function extractVideoId(text) {
  text = (text || '').trim();
  const m = text.match(/(?:v=|\/v\/|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/);
  if (m) return m[1];
  if (/^[\w-]{11}$/.test(text)) return text;
  return null;
}

export function thumbUrl(id) { return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`; }

function loadApi() {
  if (apiReady) return apiReady;
  apiReady = new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = resolve;
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
  return apiReady;
}

async function getPlayer() {
  await loadApi();
  if (player) return player;
  return new Promise((resolve) => {
    const p = new YT.Player('yt', {
      width: '1280', height: '720',
      playerVars: {
        controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1,
        iv_load_policy: 3, fs: 0, origin: location.origin,
      },
      events: {
        onReady: () => { player = p; resolve(p); },
        onStateChange: (e) => stateListeners.forEach((fn) => fn(e.data)),
        onError: (e) => errorListener && errorListener(e.data),
      },
    });
  });
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
  if (st === 0 || st === 1 || st === 2 || st === 3) { player.seekTo(0, true); player.pauseVideo(); }
}
export function seek(t) { if (player) player.seekTo(Math.max(0, t), true); }
export function time() { return player ? player.getCurrentTime() || 0 : 0; }
export function state() { return player ? player.getPlayerState() : -1; }
export function isPlaying() { return player && player.getPlayerState() === 1; }
export function duration() { return player ? player.getDuration() || 0 : 0; }
