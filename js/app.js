// Irmãs Cantoras — fluxo do app (telas, lobby, jogo, resultado)
import { net } from './net.js?v=2';
import * as yt from './youtube.js?v=2';
import { findLyrics } from './lyrics.js?v=2';
import { assignParts, ALL } from './parts.js?v=2';
import { mic } from './mic.js?v=2';
import { Scorer } from './score.js?v=2';

const COLORS = ['#ff5fa2', '#4fb3ff', '#ffd166', '#7cf29a'];
const ALL_COLOR = '#b388ff';
const colorOf = (i) => (i === ALL ? ALL_COLOR : COLORS[i % COLORS.length]);

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = {
  song: null,            // { videoId, title, lines, artist, track }
  mode: 'turns',
  preparedId: null,      // vídeo já carregado neste PC
  ready: false,
  round: 0,
  game: null,            // dados da rodada atual
  finals: {},            // id -> resultado final
  live: {},              // id -> pontuação ao vivo
};

/* ============================================================
   Utilidades de tela
   ============================================================ */
function show(screen) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + screen));
}

let toastTimer;
function toast(text, ms = 3500) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/* ============================================================
   INÍCIO
   ============================================================ */
const params = new URLSearchParams(location.search);
const inviteCode = (params.get('sala') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
$('in-name').value = localStorage.getItem('ic-name') || '';

/** mostra só um "caminho" por vez: escolher / digitar código / convite */
function homeMode(mode) {
  $('home-choose').classList.toggle('hidden', mode !== 'choose');
  $('home-join').classList.toggle('hidden', mode !== 'join');
  $('home-invite').classList.toggle('hidden', mode !== 'invite');
  $('home-msg').textContent = '';
  $('home-sub').innerHTML = mode === 'invite'
    ? `Você foi convidada pra sala <span class="invite-code">${inviteCode}</span> 🎉`
    : 'Duelo de karaokê. Quem canta melhor?';
  if (mode === 'join') $('in-code').focus();
  if (mode === 'invite' && !$('in-name').value) $('in-name').focus();
}
homeMode(inviteCode.length === 4 ? 'invite' : 'choose');

function getName() {
  const n = $('in-name').value.trim();
  if (!n) {
    $('home-msg').textContent = 'Primeiro coloca seu nome aqui em cima 👆';
    const el = $('in-name');
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
    el.focus();
    return null;
  }
  localStorage.setItem('ic-name', n);
  return n;
}

function busyHome(b) {
  ['btn-create', 'btn-show-join', 'btn-join', 'btn-invite-join'].forEach((id) => { $(id).disabled = b; });
}

async function doJoin(code) {
  const name = getName(); if (!name) return;
  if (code.length !== 4) {
    $('home-msg').textContent = 'O código tem 4 letras. Confere o que sua amiga mandou!';
    $('in-code').focus();
    return;
  }
  busyHome(true);
  $('home-msg').textContent = 'Entrando na sala…';
  try {
    await net.joinRoom(code, name);
    enterLobby();
  } catch (e) {
    $('home-msg').textContent = e.message || e;
  }
  busyHome(false);
}

$('btn-create').onclick = async () => {
  const name = getName(); if (!name) return;
  busyHome(true);
  $('home-msg').textContent = 'Criando sala…';
  try {
    await net.createRoom(name);
    enterLobby();
  } catch (e) {
    $('home-msg').textContent = e.message || e;
  }
  busyHome(false);
};
$('btn-show-join').onclick = () => { if (getName()) homeMode('join'); };
$('btn-back').onclick = () => homeMode('choose');
$('btn-join').onclick = () => doJoin($('in-code').value.trim().toUpperCase());
$('btn-invite-join').onclick = () => doJoin(inviteCode);
$('btn-own-room').onclick = () => { history.replaceState(null, '', location.pathname); homeMode('choose'); };

// código: só letras, maiúsculas; com 4 letras + Enter já entra
$('in-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
$('in-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });
$('in-name').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (!$('home-invite').classList.contains('hidden')) $('btn-invite-join').click();
  else if (!$('home-join').classList.contains('hidden')) $('in-code').focus();
});

/* ============================================================
   LOBBY
   ============================================================ */
function enterLobby() {
  $('home-msg').textContent = '';
  $('room-code').textContent = net.code;
  $('host-song-controls').classList.toggle('hidden', !net.isHost);
  $('guest-song-hint').classList.toggle('hidden', net.isHost || !!state.song);
  $('mode-toggle').classList.toggle('locked', !net.isHost);
  $('btn-start').classList.toggle('hidden', !net.isHost);
  $('btn-end').classList.toggle('hidden', !net.isHost);
  $('result-host').classList.toggle('hidden', !net.isHost);
  $('result-guest').classList.toggle('hidden', net.isHost);
  history.replaceState(null, '', location.pathname);
  renderMode();
  renderLobby();
  show('lobby');
}

$('btn-invite').onclick = async () => {
  const link = `${location.origin}${location.pathname}?sala=${net.code}`;
  try { await navigator.clipboard.writeText(link); toast('Convite copiado! Manda pra sua amiga 💌'); }
  catch { toast('Código da sala: ' + net.code); }
};

function renderLobby() {
  const list = $('player-list');
  list.innerHTML = net.players.map((p, i) => `
    <li style="color:${colorOf(i)}">
      <span class="dot"></span>
      <span class="pname" style="color:var(--text)">${esc(p.name)} ${p.id === net.myId ? '<span class="you">(você)</span>' : ''}</span>
      <span class="status ${p.ready ? 'ok' : ''}">${p.ready ? 'Pronta ✓' : 'Esperando…'}</span>
    </li>`).join('');

  $('wait-hint').textContent = net.players.length < 2
    ? (net.isHost ? 'Esperando sua amiga entrar… Clica em "Copiar convite" e manda o link pra ela.' : '')
    : '';

  const allReady = net.players.every((p) => p.ready);
  const hasSong = !!(state.song && state.song.lines);
  $('btn-start').disabled = !(allReady && hasSong);
  let hint = '';
  if (net.isHost) {
    if (!hasSong) hint = 'Cola um link do YouTube pra escolher a música.';
    else if (!allReady) hint = 'Esperando todas clicarem em "Estou pronta!".';
    else if (net.players.length < 2) hint = 'Dá pra começar sozinha pra treinar!';
  } else {
    hint = allReady && hasSong ? 'Esperando a dona da sala começar…' : '';
  }
  $('start-hint').textContent = hint;
  $('start-hint').classList.toggle('hidden', !hint);
  if (!net.isHost) { $('btn-start').classList.add('hidden'); }

  $('btn-ready').textContent = state.ready ? 'Pronta ✓ (clique pra desmarcar)' : 'Estou pronta!';
  $('btn-ready').classList.toggle('is-on', state.ready);
}

net.on('players', () => {
  renderLobby();
  if (state.game) renderScoreboard();
});
net.on('guestjoined', () => {
  broadcastSetup();
  toast('Uma amiga entrou na sala! 🎉');
});
net.on('guestleft', (p) => toast(`${p.name} saiu da sala.`));
net.on('hostgone', () => {
  toast('A dona da sala saiu. Voltando pro início…', 4000);
  setTimeout(() => location.reload(), 3000);
});
net.on('neterror', (e) => console.warn('net', e));

/* ---------- microfone ---------- */
$('btn-mic').onclick = startMic;
async function startMic() {
  try {
    await mic.start();
    $('btn-mic').textContent = 'Microfone ligado ✓';
    $('btn-mic').classList.add('is-on');
    $('btn-mic').disabled = true;
    $('mic-msg').textContent = 'Fale alguma coisa: a barra tem que mexer. Use fone de ouvido! 🎧';
    meterLoop();
    return true;
  } catch (e) {
    $('mic-msg').textContent = e.message;
    $('mic-msg').style.color = '#ffb4c8';
    return false;
  }
}
function meterLoop() {
  const m = mic.read();
  $('mic-meter').style.width = (m.level * 100) + '%';
  $('game-meter').style.width = (m.level * 100) + '%';
  requestAnimationFrame(meterLoop);
}

$('btn-ready').onclick = async () => {
  if (!state.ready && !mic.active) {
    if (!(await startMic())) { toast('Precisa ligar o microfone pra jogar 🎤'); return; }
  }
  state.ready = !state.ready;
  net.setReady(state.ready);
  renderLobby();
};

/* ---------- música (host) ---------- */
$('btn-load').onclick = loadSong;
$('in-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadSong(); });
$('in-url').addEventListener('paste', () => setTimeout(loadSong, 50));

let loadingId = null;
async function loadSong() {
  const id = yt.extractVideoId($('in-url').value);
  if (!id) { toast('Esse link não parece do YouTube 🤔'); return; }
  if (loadingId === id || (state.song && state.song.videoId === id)) return;
  loadingId = id;
  $('btn-load').disabled = true;
  state.song = null;
  broadcastSetup();
  songCard(id, 'Carregando…', 'Abrindo o vídeo…', '');

  try {
    const info = await yt.prepare(id);
    if (loadingId !== id) return;
    state.preparedId = id;
    songCard(id, info.title, 'Procurando a letra… 🔎', '');
    const ly = await findLyrics(info.title, info.author, info.duration);
    if (loadingId !== id) return;
    state.song = { videoId: id, title: info.title, lines: ly.lines, artist: ly.artist, track: ly.track };
    if (ly.diff > 8) songCard(id, info.title, `Letra encontrada ✓ (${ly.artist} – ${ly.track}). ⚠️ Esse vídeo tem partes a mais que a música, a letra pode ficar fora do tempo. Se der, usa o link do "áudio oficial".`, 'ok');
    else songCard(id, info.title, `Letra encontrada ✓ (${ly.artist} – ${ly.track})`, 'ok');
    broadcastSetup();
  } catch (e) {
    if (loadingId !== id) return;
    songCard(id, $('song-title').textContent, e.message, 'bad');
  } finally {
    if (loadingId === id) loadingId = null;
    $('btn-load').disabled = false;
    renderLobby();
  }
}

function songCard(id, title, status, cls) {
  $('song-card').classList.remove('hidden');
  $('song-thumb').src = yt.thumbUrl(id);
  $('song-title').textContent = title;
  $('song-status').textContent = status;
  $('song-status').className = 'song-status ' + cls;
}

function broadcastSetup() {
  if (!net.isHost) return;
  net.broadcast({ type: 'setup', song: state.song, mode: state.mode });
}

/* ---------- música (convidada) ---------- */
net.on('setup', async (msg) => {
  state.mode = msg.mode;
  renderMode();
  if (net.isHost) return;
  state.song = msg.song;
  $('guest-song-hint').classList.toggle('hidden', !!state.song);
  if (!state.song) { $('song-card').classList.add('hidden'); renderLobby(); return; }

  const s = state.song;
  if (state.preparedId === s.videoId) {
    songCard(s.videoId, s.title, `Letra encontrada ✓ (${s.artist} – ${s.track})`, 'ok');
  } else {
    songCard(s.videoId, s.title, 'Preparando o vídeo…', '');
    try {
      await yt.prepare(s.videoId);
      state.preparedId = s.videoId;
      songCard(s.videoId, s.title, `Letra encontrada ✓ (${s.artist} – ${s.track})`, 'ok');
    } catch (e) {
      if (e.message === 'cancelado') return;
      songCard(s.videoId, s.title, e.message, 'bad');
    }
  }
  renderLobby();
});

/* ---------- modo ---------- */
document.querySelectorAll('#mode-toggle .seg').forEach((b) => {
  b.onclick = () => {
    if (!net.isHost) return;
    state.mode = b.dataset.mode;
    renderMode();
    broadcastSetup();
  };
});
function renderMode() {
  document.querySelectorAll('#mode-toggle .seg').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
  $('mode-hint').textContent = state.mode === 'turns'
    ? 'O app divide a música: cada uma canta um pedaço, e o refrão é de todas.'
    : 'Todas cantam a música inteira ao mesmo tempo. Ganha quem cantar melhor!';
}

/* ---------- começar ---------- */
$('btn-start').onclick = () => startRound();
function startRound() {
  if (!net.isHost || !state.song) return;
  const players = net.players.map((p) => ({ id: p.id, name: p.name }));
  net.broadcast({
    type: 'start',
    round: state.round + 1,
    at: net.hostNow() + 4500,
    who: assignParts(state.song.lines, state.mode, players.length),
    players,
  });
}

/* ============================================================
   JOGO
   ============================================================ */
net.on('start', async (msg) => {
  if (!state.song) return;
  state.round = msg.round;
  state.finals = {};
  state.live = {};
  const myIndex = msg.players.findIndex((p) => p.id === net.myId);
  const lines = state.song.lines;
  state.game = {
    round: msg.round, at: msg.at, who: msg.who, players: msg.players, myIndex,
    lines, scorer: new Scorer(lines, msg.who, myIndex),
    shift: 0, finished: false, started: false, lastLiveSent: 0,
  };

  $('tap-overlay').classList.add('hidden');
  renderScoreboard();
  bannerKey = '';
  lastRendered = '';
  setLyrics(-1, -1);
  updateBanner(-1, -1, -99);
  show('game');
  document.body.classList.add('playing');

  yt.rewind();
  if (state.preparedId !== state.song.videoId) {
    try { await yt.prepare(state.song.videoId); state.preparedId = state.song.videoId; } catch (e) { toast(e.message, 6000); }
  }
  countdown(msg.round);
  gameLoop(msg.round);
});

function countdown(round) {
  const g = state.game;
  const ov = $('countdown');
  ov.classList.remove('hidden');
  const tick = () => {
    if (!state.game || state.game.round !== round) return ov.classList.add('hidden');
    const left = g.at - net.hostNow();
    if (left <= 0) {
      ov.classList.add('hidden');
      g.started = true;
      yt.play();
      // se o navegador bloquear o play automático, mostra um botão
      setTimeout(() => {
        if (state.game === g && !g.finished && !yt.isPlaying()) $('tap-overlay').classList.remove('hidden');
      }, 2500);
      return;
    }
    const n = Math.ceil(left / 1000);
    const el = $('countdown-num');
    const txt = n > 3 ? '🎤' : String(n);
    if (el.textContent !== txt) { el.textContent = txt; el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }
    // setTimeout (e não requestAnimationFrame) porque continua rodando com a janela minimizada
    setTimeout(tick, Math.min(100, left));
  };
  tick();
  heartbeat(round);
}

/**
 * Uma vez por segundo (funciona até minimizado): mantém o vídeo no mesmo tempo
 * que o das outras e confere se a música acabou.
 */
function heartbeat(round) {
  const iv = setInterval(() => {
    const g = state.game;
    if (!g || g.round !== round || g.finished) return clearInterval(iv);
    syncVideo(g);
    checkEnd(g);
  }, 1000);
}

function syncVideo(g) {
  if (!g.started || g.finished) return;
  const expected = (net.hostNow() - g.at) / 1000;   // onde o vídeo deveria estar
  if (expected < 0 || expected > yt.duration()) return;
  const st = yt.state();
  if (st === 3) return;                              // carregando: espera
  if (Math.abs(yt.time() - expected) > 0.5) yt.seek(expected);
  if (st !== 1 && $('tap-overlay').classList.contains('hidden')) yt.play();
}

function checkEnd(g) {
  if (!g.started) return;
  const last = g.lines[g.lines.length - 1];
  if (yt.state() === 0 || yt.time() - g.shift > last.end + 6) finishRound();
}

// voltou pra janela? acerta o tempo na hora
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.game) syncVideo(state.game);
});

$('btn-tap').onclick = () => {
  const g = state.game; if (!g) return;
  $('tap-overlay').classList.add('hidden');
  yt.seek((net.hostNow() - g.at) / 1000);
  yt.play();
};

function gameLoop(round) {
  const g = state.game;
  if (!g || g.round !== round || g.finished) return;
  requestAnimationFrame(() => gameLoop(round));
  if (!g.started) return;

  const lt = yt.time() - g.shift;          // tempo "da letra"
  const lines = g.lines;

  // linha atual = última que já começou
  let k = -1;
  for (let i = 0; i < lines.length; i++) { if (lines[i].t <= lt) k = i; else break; }
  const active = k >= 0 && lt < lines[k].end ? k : -1;
  g.active = active;

  const m = mic.read();
  if (yt.isPlaying()) g.scorer.frame(active, lt, m);

  if (active >= 0) setLyrics(active, k, (lt - lines[active].t) / (lines[active].end - lines[active].t));
  else setLyrics(-1, k);
  updateBanner(active, k, lt);

  // pontuação ao vivo
  const now = performance.now();
  if (now - g.lastLiveSent > 1000) {
    g.lastLiveSent = now;
    const score = g.scorer.live();
    state.live[net.myId] = score;
    updateScores(active);
    if (g.myIndex >= 0) net.broadcast({ type: 'live', round: g.round, score });
  }

  checkEnd(g);   // fim: vídeo acabou, ou 6s depois da última linha
}

let lastRendered = '';
function setLyrics(active, k, progress = 0) {
  const g = state.game;
  const lines = g.lines;
  // se não tem linha ativa, mostra a próxima como "atual" (ainda sem cor)
  const curIdx = active >= 0 ? active : k + 1;
  const key = active + ':' + curIdx;
  const cur = $('ly-cur');
  cur.style.setProperty('--p', (active >= 0 ? Math.min(100, progress * 100) : 0).toFixed(1) + '%');
  if (key === lastRendered) return;
  lastRendered = key;

  const prev = lines[curIdx - 1], line = lines[curIdx], next = lines[curIdx + 1];
  $('ly-prev').textContent = prev ? prev.text : '';
  cur.textContent = line ? line.text : (curIdx >= lines.length ? '🎉' : '');
  $('ly-next').textContent = next ? next.text : '';
  cur.style.setProperty('--c', line ? colorOf(g.who[curIdx]) : '#fff');

  // o cartão da letra brilha com a cor de quem canta
  const card = document.querySelector('.lyrics-card');
  const w = line ? g.who[curIdx] : null;
  card.style.setProperty('--c', w === null ? 'transparent' : colorOf(w));
  card.classList.toggle('turn-mine', w !== null && (w === g.myIndex || w === ALL) && g.myIndex >= 0);
  card.classList.toggle('turn-other', w !== null && w !== g.myIndex && w !== ALL);
  updateScores(active);
}

/** "SUA VEZ!", "VEZ DE BIA", "TODAS JUNTAS!"… */
function ownerLabel(w) {
  const g = state.game;
  if (w === ALL) return state.mode === 'together' || g.players.length < 2 ? '🎤 CANTA!' : '🎶 TODAS JUNTAS!';
  if (w === g.myIndex) return '🎤 SUA VEZ!';
  return `👀 VEZ DE ${(g.players[w] ? g.players[w].name : '?').toUpperCase()}`;
}
const isMine = (w) => w === ALL || w === state.game.myIndex;

/** Faixa grande em cima da letra dizendo de quem é a vez (atualiza todo quadro) */
let bannerKey = '';
function updateBanner(active, k, lt) {
  const g = state.game;
  const lines = g.lines;
  let main, sub = '', w = null, mode = 'idle';

  if (active >= 0) {
    w = g.who[active];
    main = ownerLabel(w);
    mode = isMine(w) ? 'mine' : 'other';
    if (isMine(w)) sub = 'Canta agora!';
    else {
      // quanto falta pra minha próxima parte
      const j = lines.findIndex((ln, i) => i > active && isMine(g.who[i]));
      const secs = j >= 0 ? Math.ceil(lines[j].t - lt) : Infinity;
      sub = secs <= 10 ? `Sua vez em ${secs}s… prepara!` : 'Descansa e torce 😄';
    }
  } else {
    const nx = lines[k + 1];
    if (!nx) { main = '🎉 Acabou!'; }
    else {
      w = g.who[k + 1];
      const secs = Math.ceil(nx.t - lt);
      if (secs > 6) { main = '🎵 Instrumental'; sub = `Depois: ${ownerLabel(w).replace(/^\S+\s/, '').toLowerCase()}`; }
      else { main = ownerLabel(w); sub = isMine(w) ? `Prepara… ${secs}` : `Em ${secs}s`; mode = isMine(w) ? 'soon' : 'other'; }
    }
  }

  const key = main + '|' + sub + '|' + mode;
  if (key === bannerKey) return;
  bannerKey = key;
  const b = $('turn-banner');
  b.className = 'turn-banner glass ' + mode;
  b.style.setProperty('--c', w === null ? '#ffffff' : colorOf(w));
  $('turn-main').textContent = main;
  $('turn-sub').textContent = sub;
}

function renderScoreboard() {
  const g = state.game; if (!g) return;
  $('scoreboard').innerHTML = g.players.map((p, i) => `
    <div class="glass score-pill" id="pill-${i}" style="--c:${colorOf(i)}">
      <span class="dot" style="color:${colorOf(i)}"></span>
      <span class="pname">${esc(p.name)}${p.id === net.myId ? ' <span class="hint">(você)</span>' : ''}</span>
      <span class="pscore" id="pscore-${i}">0</span>
    </div>`).join('');
}

function updateScores(active) {
  const g = state.game; if (!g) return;
  g.players.forEach((p, i) => {
    const el = $('pscore-' + i);
    if (el) el.textContent = (state.live[p.id] || 0).toLocaleString('pt-BR');
    const pill = $('pill-' + i);
    if (pill) pill.classList.toggle('singing', active >= 0 && (g.who[active] === ALL || g.who[active] === i));
  });
}

net.on('live', (msg) => {
  if (!state.game || msg.round !== state.game.round) return;
  state.live[msg.from] = msg.score;
  updateScores(state.game.active ?? -1);
});

/* ---------- som da música (cada uma escolhe no seu PC) ---------- */
let musicOff = localStorage.getItem('ic-music-off') === '1';
function renderMute() {
  $('btn-mute').textContent = musicOff ? '🔇 Música desligada' : '🔊 Música ligada';
  $('btn-mute').classList.toggle('is-on', musicOff);
}
$('btn-mute').onclick = () => {
  musicOff = !musicOff;
  localStorage.setItem('ic-music-off', musicOff ? '1' : '0');
  yt.setMuted(musicOff);
  renderMute();
  toast(musicOff ? 'Música desligada. A letra continua passando, é só cantar! 🎤' : 'Música ligada 🎶');
};
yt.setMuted(musicOff);
renderMute();

/* ---------- ajuste de sincronia da letra ---------- */
function setShift(d) {
  const g = state.game; if (!g) return;
  g.shift = Math.round((g.shift + d) * 10) / 10;
  $('sync-val').textContent = (g.shift > 0 ? '+' : '') + g.shift.toFixed(1).replace('.', ',') + 's';
}
$('btn-sync-plus').onclick = () => setShift(0.5);   // letra aparecendo cedo demais
$('btn-sync-minus').onclick = () => setShift(-0.5); // letra aparecendo tarde demais

/* ---------- fim da rodada ---------- */
$('btn-end').onclick = () => { if (net.isHost && state.game) net.broadcast({ type: 'end', round: state.game.round }); };
net.on('end', (msg) => { if (state.game && msg.round === state.game.round) finishRound(); });

function finishRound() {
  const g = state.game;
  if (!g || g.finished) return;
  g.finished = true;
  yt.pause();
  document.body.classList.remove('playing');
  $('countdown').classList.add('hidden');
  $('tap-overlay').classList.add('hidden');
  setShift(-g.shift); // zera pro próximo

  if (g.myIndex >= 0) {
    const result = g.scorer.final();
    net.broadcast({ type: 'final', round: g.round, result });
  }
  show('result');
  renderResults();
  // se alguém sumir, mostra o que tiver depois de 20s
  setTimeout(() => { if (state.game === g) { g.timeout = true; renderResults(); } }, 20000);
}

net.on('final', (msg) => {
  if (!state.game || msg.round !== state.game.round) return;
  state.finals[msg.from] = msg.result;
  if (state.game.finished) renderResults();
});

function renderResults() {
  const g = state.game; if (!g) return;
  const rows = g.players.map((p, i) => ({ ...p, i, r: state.finals[p.id] }));
  const missing = rows.filter((x) => !x.r);
  const done = rows.filter((x) => x.r).sort((a, b) => b.r.total - a.r.total);
  const complete = missing.length === 0 || g.timeout;

  const top = done[0];
  const tie = done.length > 1 && done[1].r.total === top.r.total;
  if (!complete) {
    $('result-crown').textContent = '⏳';
    $('result-title').textContent = 'Calculando…';
  } else if (!top) {
    $('result-crown').textContent = '🤷';
    $('result-title').textContent = 'Sem resultado';
  } else if (rows.length === 1) {
    $('result-crown').textContent = '🎤';
    $('result-title').textContent = 'Sua nota';
  } else if (rows.length > 1 && top.r.total === 0) {
    $('result-crown').textContent = '😅';
    $('result-title').textContent = 'Ninguém cantou!';
  } else if (tie) {
    $('result-crown').textContent = '🤝';
    $('result-title').textContent = 'Empate!';
  } else {
    $('result-crown').textContent = '👑';
    $('result-title').textContent = top.id === net.myId ? 'Você venceu!' : `${top.name} venceu!`;
  }

  const bar = (label, v) => `<span>${label}</span><div class="bar"><div style="width:${v}%"></div></div><span>${v}%</span>`;
  $('result-list').innerHTML = done.map((x, pos) => `
    <div class="result-item ${complete && pos === 0 && !tie && rows.length > 1 ? 'winner' : ''}" style="--c:${colorOf(x.i)}; animation-delay:${pos * 0.12}s">
      <div class="result-top">
        <span class="dot" style="color:${colorOf(x.i)}"></span>
        <span class="pname">${esc(x.name)}${x.id === net.myId ? ' <span class="hint">(você)</span>' : ''}</span>
        <span class="ptotal">${x.r.total.toLocaleString('pt-BR')}</span>
      </div>
      <div class="bars">
        ${bar('💨 Fôlego', x.r.presence)}
        ${bar('🎯 Afinação', x.r.tune)}
        ${bar('🎙️ Timbre', x.r.timbre ?? 0)}
        ${bar('⏱️ Ritmo', x.r.rhythm)}
      </div>
    </div>`).join('');

  $('result-wait').textContent = missing.length && !g.timeout
    ? `Esperando a nota de ${missing.map((x) => x.name).join(', ')}…`
    : (missing.length ? `${missing.map((x) => x.name).join(', ')} não mandou a nota.` : '');
}

$('btn-rematch').onclick = () => startRound();
$('btn-other').onclick = () => net.broadcast({ type: 'lobby' });
net.on('lobby', () => {
  state.game = null;
  document.body.classList.remove('playing');
  yt.pause();
  if (net.isHost) {
    state.song = null;
    $('in-url').value = '';
    $('song-card').classList.add('hidden');
    broadcastSetup();
  }
  renderLobby();
  show('lobby');
});
