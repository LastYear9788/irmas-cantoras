// Irmãs Cantoras — fluxo do app (telas, lobby, jogo, resultado)
import { net } from './net.js?v=12';
import * as yt from './youtube.js?v=12';
import { findLyrics } from './lyrics.js?v=12';
import { assignParts, ALL } from './parts.js?v=12';
import { mic } from './mic.js?v=12';
import { Scorer } from './score.js?v=12';
import { cam } from './cam.js?v=12';

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
  finals: Object.create(null),   // id -> resultado final
  live: Object.create(null),     // id -> pontuação ao vivo
  queue: [],             // playlist (aprovadas) [{ videoId, by, title }]
  pending: [],           // sugestões esperando a dona da sala [{ sid, videoId, by, byId, title }]
  wins: Object.create(null),     // id -> vitórias na noite
  autoStart: false,      // começar sozinha quando a próxima música carregar
  photos: Object.create(null),   // id -> fotos da rodada (só na memória)
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
const fromLink = (params.get('sala') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
const lastRoom = (sessionStorage.getItem('ic-room') || '').replace(/[^A-Z]/g, '').slice(0, 4);
const inviteCode = fromLink.length === 4 ? fromLink : lastRoom;
const isRejoin = fromLink.length !== 4 && lastRoom.length === 4;
$('in-name').value = localStorage.getItem('ic-name') || '';

/** mostra só um "caminho" por vez: escolher / digitar código / convite */
function homeMode(mode) {
  $('home-choose').classList.toggle('hidden', mode !== 'choose');
  $('home-join').classList.toggle('hidden', mode !== 'join');
  $('home-invite').classList.toggle('hidden', mode !== 'invite');
  $('home-msg').textContent = '';
  $('home-sub').innerHTML = mode !== 'invite' ? 'Duelo de karaokê. Quem canta melhor?'
    : isRejoin ? `Você estava na sala <span class="invite-code">${inviteCode}</span>. Quer voltar?`
      : `Você foi convidada pra sala <span class="invite-code">${inviteCode}</span> 🎉`;
  $('btn-invite-join').textContent = isRejoin ? 'Voltar pra sala' : 'Entrar na sala';
  $('btn-own-room').textContent = isRejoin ? 'Não, quero começar do zero' : 'Não fui convidada, quero criar minha própria sala';
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
$('btn-own-room').onclick = () => { history.replaceState(null, '', location.pathname); sessionStorage.removeItem('ic-room'); homeMode('choose'); };

// código: só letras, maiúsculas; com 4 letras + Enter já entra
$('in-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); });
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
  $('guest-song-hint').classList.add('hidden');
  $('in-url').placeholder = net.isHost ? 'Cole um link do YouTube aqui' : 'Cole um link pra sugerir uma música';
  $('btn-load').textContent = net.isHost ? 'Adicionar' : 'Sugerir';
  $('mode-toggle').classList.toggle('locked', !net.isHost);
  $('btn-start').classList.toggle('hidden', !net.isHost);
  $('btn-end').classList.toggle('hidden', !net.isHost);
  $('result-host').classList.toggle('hidden', !net.isHost);
  $('result-guest').classList.toggle('hidden', net.isHost);
  history.replaceState(null, '', location.pathname);
  if (!net.isHost) sessionStorage.setItem('ic-room', net.code); else sessionStorage.removeItem('ic-room');
  renderMode();
  renderLobby();
  show('lobby');
}

$('btn-invite').onclick = async () => {
  // só o código: a amiga abre o site, clica em "Entrar na sala de uma amiga" e cola
  try { await navigator.clipboard.writeText(net.code); toast(`Código ${net.code} copiado! Manda pra sua amiga 💌`); }
  catch { toast('Código da sala: ' + net.code); }
};

function renderLobby() {
  const list = $('player-list');
  list.innerHTML = net.players.map((p, i) => `
    <li style="color:${colorOf(i)}">
      <span class="dot"></span>
      <span class="pname" style="color:var(--text)">${esc(p.name)} ${p.id === net.myId ? '<span class="you">(você)</span>' : ''}</span>
      ${state.wins[p.id] ? `<span class="wins" title="Vitórias hoje">🏆 ${state.wins[p.id]}</span>` : ''}
      <span class="status ${p.ready ? 'ok' : ''}">${p.ready ? 'Pronta ✓' : 'Esperando…'}</span>
    </li>`).join('');

  $('wait-hint').textContent = net.players.length < 2
    ? (net.isHost ? 'Esperando sua amiga entrar… Clica em "Copiar código" e manda pra ela.' : '')
    : '';

  const allReady = net.players.every((p) => p.ready);
  const hasSong = !!(state.song && state.song.lines);
  $('btn-start').disabled = !(allReady && hasSong);
  let hint = '';
  if (net.isHost) {
    if (!hasSong) hint = loadingId ? (state.autoStart ? 'Carregando a próxima… começa sozinha 🎶' : 'Carregando a música…') : 'Cola um link do YouTube pra escolher a música.';
    else if (!allReady) hint = 'Esperando todas clicarem em "Estou pronta!".';
    else if (net.players.length < 2) hint = 'Dá pra começar sozinha pra treinar!';
  } else {
    hint = !hasSong ? '' : allReady ? 'Esperando a dona da sala começar…' : '';
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
net.on('guestreplaced', ({ oldId, newId }) => {
  if (state.wins[oldId]) { state.wins[newId] = state.wins[oldId]; delete state.wins[oldId]; }
});
let leaving = false;
function leaveAndReload() { leaving = true; sessionStorage.removeItem('ic-room'); location.reload(); }
window.addEventListener('beforeunload', (e) => {
  if (net.code && !leaving) { e.preventDefault(); e.returnValue = ''; }   // "Tem certeza que quer sair?"
});

net.on('hostgone', () => {
  if (net.full) return;
  toast('A dona da sala saiu. Voltando pro início…', 4000);
  setTimeout(leaveAndReload, 3000);
});
net.on('full', () => {
  toast('Essa sala está cheia 😕 Voltando pro início…', 4000);
  setTimeout(leaveAndReload, 3000);
});
net.on('neterror', (e) => console.warn('net', e));

/* ---------- microfone ---------- */
$('btn-mic').onclick = startMic;
mic.onLost = () => {
  toast('O microfone desconectou! Conecta de novo e clica em "Ativar microfone" 🎤', 6000);
  $('btn-mic').textContent = 'Ativar microfone';
  $('btn-mic').classList.remove('is-on');
  $('btn-mic').disabled = false;
  if (state.ready) { state.ready = false; net.setReady(false); renderLobby(); }
};
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
let meterRunning = false;
function meterLoop() {
  if (meterRunning) return;
  meterRunning = true;
  meterTick();
}
function meterTick() {
  const m = mic.read();
  $('mic-meter').style.width = (m.level * 100) + '%';
  $('game-meter').style.width = (m.level * 100) + '%';
  requestAnimationFrame(meterTick);
}

$('btn-ready').onclick = async () => {
  if (!state.ready && !mic.active) {
    if (!(await startMic())) { toast('Precisa ligar o microfone pra jogar 🎤'); return; }
  }
  state.ready = !state.ready;
  net.setReady(state.ready);
  renderLobby();
};

/* ---------- música + fila (qualquer uma cola link; a dona da sala organiza) ---------- */
$('btn-load').onclick = submitLink;
$('in-url').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitLink(); });
// botão "Adicionar" fica destacado quando tem link no campo
$('in-url').addEventListener('input', () => $('btn-load').classList.toggle('btn-primary', !!$('in-url').value.trim()));

const myName = () => (net.players.find((p) => p.id === net.myId) || {}).name || 'Alguém';

function submitLink() {
  const raw = $('in-url').value.trim();
  if (!raw) return;
  const id = yt.extractVideoId(raw);
  if (!id) {
    toast(/list=/.test(raw) ? 'Esse é o link de uma playlist. Abre a música que você quer e copia o link dela 🙂'
      : /youtube\.com\/(@|c\/|channel\/|user\/)/i.test(raw) ? 'Esse é o link de um canal. Abre a música que você quer e copia o link dela 🙂'
        : 'Esse link não parece de um vídeo do YouTube 🤔', 5000);
    return;
  }
  $('in-url').value = '';
  $('btn-load').classList.remove('btn-primary');
  if (isQueued(id)) { toast('Essa música já está aí 😉'); return; }
  if (state.pending.some((p) => p.videoId === id)) { toast('Essa música já foi sugerida 😉'); return; }
  if (!net.isHost) {
    net.broadcast({ type: 'suggest', videoId: id });
    toast(`Sugestão enviada! ${hostName()} vai aprovar ou não 🙂`, 4000);
    return;
  }
  const busy = !!(state.song || loadingId || state.queue.length);
  enqueue(id, myName());
  toast(busy ? 'Adicionada na playlist 🎶' : 'Carregando a música… 🎶');
}

const hostName = () => (net.players[0] || {}).name || 'A dona da sala';

/* ---------- sugestões das convidadas: a dona da sala aprova ou recusa ---------- */
const lastSuggestFrom = Object.create(null);
let suggestN = 0;
net.on('suggest', (msg) => {
  if (!net.isHost || msg.from === net.myId) return;
  const now = Date.now();
  if (now - (lastSuggestFrom[msg.from] || 0) < 1000) return;      // no máximo 1 por segundo de cada
  lastSuggestFrom[msg.from] = now;
  const id = yt.extractVideoId(String(msg.videoId || ''));
  const who = net.players.find((p) => p.id === msg.from);
  if (!id || !who || isQueued(id) || state.pending.some((p) => p.videoId === id)) return;
  if (state.pending.length >= 10) return;
  const item = { sid: 's' + (++suggestN), videoId: id, by: who.name, byId: who.id, title: 'Vídeo do YouTube' };
  state.pending.push(item);
  broadcastSetup();
  fetchTitle(item);
  toast(`${who.name} sugeriu uma música 🎶 Aprova ou não aqui embaixo.`, 4000);
});

function decide(sid, ok) {
  const i = state.pending.findIndex((p) => p.sid === sid);
  if (i < 0) return;
  const [item] = state.pending.splice(i, 1);
  if (ok) enqueue(item.videoId, item.by);
  else broadcastSetup();
  net.broadcast({ type: 'decision', ok, byId: item.byId, title: item.title });
}
$('pending-list').addEventListener('click', (e) => {
  const b = e.target.closest('.q-ok, .q-no');
  if (!b || !net.isHost) return;
  decide(b.dataset.sid, b.classList.contains('q-ok'));
});
// a convidada fica sabendo o que aconteceu com a sugestão dela
net.on('decision', (msg) => {
  if (msg.byId !== net.myId || net.isHost) return;
  toast(msg.ok ? `${hostName()} aprovou "${msg.title}" 🎉 Tá na playlist!` : `${hostName()} não aprovou "${msg.title}" 😅`, 5000);
});

function renderPending() {
  $('pending-box').classList.toggle('hidden', !state.pending.length);
  $('pending-list').innerHTML = state.pending.map((q) => `
    <li>
      <img src="${yt.thumbUrl(q.videoId)}" alt="">
      <div class="q-info"><div class="q-title">${esc(q.title)}</div><div class="q-by">sugerida por ${esc(q.by)}</div></div>
      ${net.isHost
        ? `<div class="q-actions"><button class="q-ok" data-sid="${esc(q.sid)}" title="Aprovar: vai pra playlist">✓ Aprovar</button><button class="q-no" data-sid="${esc(q.sid)}" title="Recusar">✕</button></div>`
        : `<span class="q-wait">⏳ esperando ${esc(hostName())}</span>`}
    </li>`).join('');
}

// convidada mandou uma música: só a dona da sala coloca na fila
// (só a dona da sala escolhe as músicas; convidadas não mandam links)

const isQueued = (id) => !!((state.song && state.song.videoId === id) || loadingId === id || state.queue.some((q) => q.videoId === id));

function enqueue(id, by) {
  if (isQueued(id)) return;
  if (state.queue.length >= 20) { toast('A fila tá cheia (20 músicas) 😅'); return; }
  const item = { videoId: id, by, title: 'Vídeo do YouTube' };
  state.queue.push(item);
  broadcastSetup();
  fetchTitle(item);
  maybeLoadNext();
}

// nome do vídeo só pra mostrar na fila (se não conseguir, fica "Vídeo do YouTube")
async function fetchTitle(item) {
  try {
    const r = await fetch('https://noembed.com/embed?url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + item.videoId));
    const d = await r.json();
    if (d && d.title) { item.title = d.title; broadcastSetup(); }
  } catch (e) { /* tudo bem */ }
}

/** (dona da sala) sem música atual? puxa a próxima da fila */
function maybeLoadNext() {
  if (!net.isHost || state.song || loadingId || state.game || !state.queue.length) return;
  const item = state.queue.shift();
  broadcastSetup();
  loadSong(item.videoId);
}

let loadingId = null;
async function loadSong(id) {
  loadingId = id;
  state.song = null;
  broadcastSetup();
  songCard(id, 'Carregando…', 'Abrindo o vídeo…', '');

  let ok = false;
  try {
    const info = await yt.prepare(id);
    if (loadingId !== id) return;
    state.preparedId = id;
    songCard(id, info.title, 'Procurando a letra… 🔎', '');
    const ly = await findLyrics(info.title, info.author, info.duration);
    if (loadingId !== id) return;
    state.song = { videoId: id, title: info.title, lines: ly.lines, artist: ly.artist, track: ly.track };
    if (ly.diff > 8) songCard(id, info.title, `Letra encontrada ✓ (${songName(ly)}). ⚠️ Esse vídeo tem partes a mais que a música, a letra pode ficar fora do tempo. Se der, usa o link do "áudio oficial".`, 'ok');
    else songCard(id, info.title, `Letra encontrada ✓ (${songName(ly)})`, 'ok');
    ok = true;
  } catch (e) {
    if (loadingId !== id) return;
    songCard(id, $('song-title').textContent, e.message, 'bad');
  } finally {
    if (loadingId === id) loadingId = null;
    renderLobby();
  }

  broadcastSetup();
  if (ok) {
    // veio do "Próxima música": começa sozinha se todas continuam prontas
    if (state.autoStart) {
      state.autoStart = false;
      if (net.players.every((p) => p.ready)) setTimeout(() => { if (!state.game && state.song && state.song.videoId === id) startRound(); }, 1500);
    }
  } else if (state.queue.length) {
    // não deu pra tocar essa? pula pra próxima da fila
    toast('Não deu pra usar essa música, indo pra próxima da fila…', 4000);
    setTimeout(() => { if (!state.song && !loadingId) maybeLoadNext(); }, 3000);
  } else {
    state.autoStart = false;
  }
}

// (dona da sala) pular a música atual
$('btn-skip').onclick = () => {
  if (!net.isHost || state.game) return;
  loadingId = null;
  state.song = null;
  $('song-card').classList.add('hidden');
  broadcastSetup();
  maybeLoadNext();
  renderLobby();
};

function renderQueue() {
  $('queue-box').classList.toggle('hidden', !state.queue.length);
  $('queue-list').innerHTML = state.queue.map((q, i) => `
    <li>
      <img src="${yt.thumbUrl(q.videoId)}" alt="">
      <div class="q-info"><div class="q-title">${esc(q.title)}</div><div class="q-by">por ${esc(q.by)}</div></div>
      ${net.isHost ? `<button class="q-del" data-i="${i}" title="Tirar da fila">✕</button>` : ''}
    </li>`).join('');
  $('btn-skip').classList.toggle('hidden', !net.isHost || $('song-card').classList.contains('hidden'));
}
$('queue-list').addEventListener('click', (e) => {
  const b = e.target.closest('.q-del');
  if (!b || !net.isHost) return;
  state.queue.splice(+b.dataset.i, 1);
  broadcastSetup();
});

const songName = (x) => (x.artist ? `${x.artist} – ` : '') + x.track;

function songCard(id, title, status, cls) {
  $('song-card').classList.remove('hidden');
  $('btn-skip').classList.toggle('hidden', !net.isHost);
  $('song-thumb').src = yt.thumbUrl(id);
  $('song-title').textContent = title;
  $('song-status').textContent = status;
  $('song-status').className = 'song-status ' + cls;
}

function broadcastSetup() {
  if (!net.isHost) return;
  // { ...wins } = objeto comum (o PeerJS não sabe enviar o objeto "sem protótipo" usado aqui dentro)
  net.broadcast({ type: 'setup', song: state.song, mode: state.mode, queue: state.queue, pending: state.pending, wins: { ...state.wins } });
}

/* ---------- música (convidada) ---------- */
net.on('setup', async (msg) => {
  state.mode = msg.mode;
  state.queue = msg.queue || [];
  state.pending = Array.isArray(msg.pending) ? msg.pending : [];
  state.wins = Object.assign(Object.create(null), msg.wins || {});
  renderMode();
  renderQueue();
  renderPending();
  renderNight();
  if (net.isHost) { renderLobby(); return; }
  if (state.song && msg.song && state.song.videoId === msg.song.videoId && state.preparedId === msg.song.videoId) { renderLobby(); return; }
  state.song = msg.song;
  $('guest-song-hint').classList.add('hidden');
  if (!state.song) { $('song-card').classList.add('hidden'); renderLobby(); return; }

  const s = state.song;
  if (state.preparedId === s.videoId) {
    songCard(s.videoId, s.title, `Letra encontrada ✓ (${songName(s)})`, 'ok');
  } else {
    songCard(s.videoId, s.title, 'Preparando o vídeo…', '');
    try {
      await yt.prepare(s.videoId);
      state.preparedId = s.videoId;
      songCard(s.videoId, s.title, `Letra encontrada ✓ (${songName(s)})`, 'ok');
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
  if (state.game && !state.game.finished) return;            // clique duplo não reinicia a música
  const notReady = net.players.filter((p) => !p.ready);
  if (notReady.length) {
    toast(`Esperando ${notReady.map((p) => p.name).join(', ')} clicar em "Estou pronta!" 🙂`, 4000);
    return;
  }
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
  state.finals = Object.create(null);
  state.live = Object.create(null);
  const myIndex = msg.players.findIndex((p) => p.id === net.myId);
  const lines = state.song.lines;
  state.game = {
    round: msg.round, at: msg.at, who: msg.who, players: msg.players, myIndex,
    lines, scorer: new Scorer(lines, msg.who, myIndex),
    shift: 0, finished: false, started: false, lastLiveSent: 0,
    shots: cam.active ? planShots(lines, msg.who, myIndex) : null,
    myPhotos: [], peakPhoto: null, peak: 0, lastPeakShot: 0,
  };
  state.photos = Object.create(null);
  renderPhotos();

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
  if (st === 1) g.sawPlaying = true;
  if (st === 3) return;                              // carregando: espera
  if (Math.abs(yt.time() - expected) > 0.5) yt.seek(expected);
  if (st !== 1 && $('tap-overlay').classList.contains('hidden')) yt.play();
}

function checkEnd(g) {
  if (!g.started) return;
  const last = g.lines[g.lines.length - 1];
  // "terminou" só vale se o vídeo chegou a tocar nesta rodada (senão é o fim da rodada anterior)
  if ((yt.state() === 0 && g.sawPlaying) || yt.time() - g.shift > last.end + 6) finishRound();
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
  if (yt.isPlaying()) { g.sawPlaying = true; g.scorer.frame(active, lt, m); cameraFrame(g, active, lt, m); }

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
  const nextEl = $('ly-next');
  nextEl.textContent = next ? next.text : '';
  const nw = next ? g.who[curIdx + 1] : null;
  const handoff = !!(next && line && nw !== g.who[curIdx]);
  nextEl.classList.toggle('handoff', handoff);
  nextEl.style.setProperty('--nc', next ? colorOf(nw) : '#fff');
  nextEl.dataset.who = !handoff ? '' : nw === ALL ? 'todas ↓' : nw === g.myIndex ? 'você ↓' : `${(g.players[nw] || {}).name || '?'} ↓`;
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
const SOON = 5;   // segundos de aviso antes da minha vez
let bannerKey = '';
function updateBanner(active, k, lt) {
  const g = state.game;
  const lines = g.lines;
  let main, sub = '', w = null, mode = 'idle';

  // quanto falta pra minha próxima parte (a partir da linha "from")
  const untilMine = (from) => {
    const j = lines.findIndex((ln, i) => i >= from && isMine(g.who[i]));
    return j < 0 ? null : { j, secs: Math.ceil(lines[j].t - lt) };
  };
  // contagem regressiva grande, na minha cor
  const countdownTo = (m) => {
    w = g.who[m.j];
    mode = 'soon';
    main = `⏳ SUA VEZ EM ${Math.max(1, m.secs)}`;
    sub = 'Prepara!';
  };

  if (active >= 0 && isMine(g.who[active])) {
    w = g.who[active];
    main = ownerLabel(w);
    mode = 'mine';
    sub = 'Canta agora!';
  } else if (active >= 0) {
    const m = untilMine(active + 1);
    if (m && m.secs <= SOON) countdownTo(m);
    else {
      w = g.who[active];
      main = ownerLabel(w);
      mode = 'other';
      sub = m && m.secs <= 10 ? `Sua vez em ${m.secs}s` : 'Descansa e torce 😄';
    }
  } else {
    const nx = lines[k + 1];
    const m = untilMine(k + 1);
    if (!nx) main = '🎉 Acabou!';
    else if (m && m.j === k + 1 && m.secs <= SOON) countdownTo(m);
    else {
      w = g.who[k + 1];
      const secs = Math.ceil(nx.t - lt);
      if (secs > 6) { main = '🎵 Instrumental'; sub = `Depois: ${ownerLabel(w).replace(/^\S+\s/, '').toLowerCase()}`; }
      else { main = ownerLabel(w); sub = `Em ${secs}s`; mode = 'other'; }
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
  // o cartão da letra também pisca na minha cor durante a contagem
  const card = document.querySelector('.lyrics-card');
  card.classList.toggle('turn-soon', mode === 'soon');
  card.style.setProperty('--sc', w === null ? '#ffffff' : colorOf(w));
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

const inRound = (id) => !!(state.game && state.game.players.some((p) => p.id === id));
const num = (x, max) => { const v = Math.round(Number(x)); return Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0; };

net.on('live', (msg) => {
  if (!state.game || msg.round !== state.game.round || !inRound(msg.from)) return;
  state.live[msg.from] = num(msg.score, 10000);
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
    sendPhotos(g);
  }
  show('result');
  renderResults();
  // se alguém sumir, mostra o que tiver depois de 20s
  setTimeout(() => { if (state.game === g) { g.timeout = true; renderResults(); } }, 20000);
}

net.on('final', (msg) => {
  if (!state.game || msg.round !== state.game.round || !inRound(msg.from) || state.finals[msg.from]) return;
  const r = msg.result || {};
  state.finals[msg.from] = {
    total: num(r.total, 10000), presence: num(r.presence, 100), tune: num(r.tune, 100),
    timbre: num(r.timbre, 100), rhythm: num(r.rhythm, 100),
  };
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
  if (complete && net.isHost && !g.counted) {
    g.counted = true;
    if (top && !tie && rows.length > 1 && top.r.total > 0) {
      state.wins[top.id] = (state.wins[top.id] || 0) + 1;
      broadcastSetup();
    }
  }
  const medals = complete ? medalsFor(done) : {};
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
      <div class="result-phrase">${phraseFor(x.r.total)}</div>
      ${medals[x.id] ? `<span class="medal">${medals[x.id]}</span>` : ''}
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
  renderNight();
}

/* ---------- reações ao vivo ---------- */
const REACTIONS = ['👏', '😂', '🔥', '😍', '😱'];
let lastReact = 0;
document.querySelectorAll('.react').forEach((b) => {
  b.onclick = () => {
    const now = Date.now();
    if (now - lastReact < 400 || !state.game) return;   // sem metralhadora de emoji
    lastReact = now;
    net.broadcast({ type: 'react', emoji: b.dataset.e });
  };
});
const lastReactFrom = Object.create(null);
net.on('react', (msg) => {
  if (!state.game || !REACTIONS.includes(msg.emoji) || !inRound(msg.from)) return;
  const now = Date.now();
  if (now - (lastReactFrom[msg.from] || 0) < 300 || $('reactions').childElementCount >= 30) return;
  lastReactFrom[msg.from] = now;
  const idx = state.game.players.findIndex((p) => p.id === msg.from);
  const name = idx >= 0 ? state.game.players[idx].name : '';
  const el = document.createElement('div');
  el.className = 'reaction';
  el.style.left = (8 + Math.random() * 80) + '%';
  el.style.setProperty('--c', idx >= 0 ? colorOf(idx) : '#fff');
  el.innerHTML = `<span class="r-emoji">${msg.emoji}</span><span class="r-name">${esc(name)}</span>`;
  $('reactions').appendChild(el);
  setTimeout(() => el.remove(), 3100);
});

/* ---------- câmera e fotos da rodada ---------- */
const CAM_MSG = 'O app tira umas fotos suas cantando e mostra no final. Nada fica salvo.';
cam.onLost = () => {
  toast('A câmera desconectou. Sem fotos por enquanto 📸', 5000);
  $('cam-preview').classList.add('hidden');
  $('btn-cam').textContent = '📸 Ligar câmera';
  $('btn-cam').classList.remove('is-on');
  $('cam-msg').textContent = CAM_MSG;
};
$('btn-cam').onclick = async () => {
  const btn = $('btn-cam'), prev = $('cam-preview'), msg = $('cam-msg');
  msg.style.color = '';
  if (cam.active) {
    cam.stop(prev);
    prev.classList.add('hidden');
    btn.textContent = '📸 Ligar câmera';
    btn.classList.remove('is-on');
    msg.textContent = CAM_MSG;
    return;
  }
  btn.disabled = true;
  try {
    await cam.start(prev);
    prev.classList.remove('hidden');
    btn.textContent = 'Câmera ligada ✓ (desligar)';
    btn.classList.add('is-on');
    msg.textContent = 'Tá se vendo aí? Então tá pronta pras fotos! 📸';
  } catch (e) {
    msg.textContent = e.message;
    msg.style.color = '#ffb4c8';
  }
  btn.disabled = false;
};

/** escolhe os momentos das fotos: no refrão, na minha vez e esperando a vez */
function planShots(lines, who, me) {
  if (me < 0 || !lines.length) return [];
  const mid = (i) => (lines[i].t + lines[i].end) / 2;
  const pick = (pred) => {
    const idx = lines.map((_, i) => i).filter(pred);
    return idx.length ? idx[Math.floor(idx.length / 2)] : -1;
  };
  const allTogether = who.every((w) => w === ALL);
  const shots = [];
  const solo = pick((i) => who[i] === me);
  const rest = pick((i) => who[i] !== me && who[i] !== ALL);
  const chorus = pick((i) => who[i] === ALL);
  if (solo >= 0) shots.push({ t: mid(solo), label: '🎤 Solando' });
  if (rest >= 0) shots.push({ t: mid(rest), label: '😴 Esperando a vez' });
  if (chorus >= 0) shots.push({ t: mid(chorus), label: allTogether ? '🎤 Cantando' : '🎶 No refrão' });
  if (allTogether && lines.length > 6) shots.push({ t: mid(Math.floor(lines.length * 0.85)), label: '🎶 Lá pro final' });
  return shots.sort((a, b) => a.t - b.t);
}

/** chamado todo quadro durante a música */
function cameraFrame(g, active, lt, m) {
  if (!cam.active || !g.shots) return;
  for (const s of g.shots) {
    if (!s.done && lt >= s.t) {
      s.done = true;
      const img = cam.snap();
      if (img) g.myPhotos.push({ label: s.label, img });
    }
  }
  // "momento mais forte": a voz mais alta numa parte minha (fica só a melhor)
  if (active >= 0 && isMine(g.who[active]) && m.voiced && lt > 8 &&
      m.rms > g.peak * 1.15 && performance.now() - g.lastPeakShot > 3000) {
    g.peak = m.rms;
    g.lastPeakShot = performance.now();
    const img = cam.snap();
    if (img) g.peakPhoto = { label: '🔥 Momento mais forte', img };
  }
}

/** no fim da rodada: manda minhas fotos pra todas */
function sendPhotos(g) {
  if (g.myIndex < 0) return;
  const mine = [...g.myPhotos, g.peakPhoto].filter(Boolean).slice(0, 5);
  if (!mine.length) return;
  const photos = mine.map((p, i) => ({ pid: `${g.round}-${i}`, label: p.label, img: p.img }));
  net.broadcast({ type: 'photos', round: g.round, photos });
}

const IMG_OK = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
net.on('photos', (msg) => {
  if (!state.game || msg.round !== state.game.round || !Array.isArray(msg.photos) || !inRound(msg.from)) return;
  state.photos[msg.from] = msg.photos
    .filter((p) => p && typeof p.img === 'string' && p.img.length < 200000 && IMG_OK.test(p.img))
    .slice(0, 6)
    .map((p) => ({ pid: String(p.pid), label: String(p.label || '').slice(0, 40), img: p.img }));
  renderPhotos();
});
net.on('photo-hide', (msg) => {
  if (!state.game || msg.round !== state.game.round || !state.photos[msg.from]) return;
  state.photos[msg.from] = state.photos[msg.from].filter((p) => p.pid !== String(msg.pid));
  renderPhotos();
});

function renderPhotos() {
  const g = state.game;
  const items = [];
  if (g) {
    g.players.forEach((p, i) => {
      for (const ph of state.photos[p.id] || []) items.push({ ...ph, owner: p.id, name: p.name, i });
    });
  }
  $('photo-wall').classList.toggle('hidden', !items.length);
  $('photo-grid').innerHTML = items.map((x, n) => `
    <div class="photo" style="--c:${colorOf(x.i)}">
      <img src="${x.img}" alt="Foto de ${esc(x.name)}">
      <div class="p-cap"><span class="p-name">${esc(x.name)}</span><span class="p-label">${esc(x.label)}</span></div>
      <div class="p-actions">
        <a href="${x.img}" download="irmas-cantoras-${esc(x.name)}-${n + 1}.jpg" title="Baixar essa foto">⬇</a>
        ${x.owner === net.myId ? `<button class="p-hide" data-pid="${esc(x.pid)}" title="Tirar essa foto (some pra todas)">✕</button>` : ''}
      </div>
    </div>`).join('');
}
$('photo-grid').addEventListener('click', (e) => {
  const b = e.target.closest('.p-hide');
  if (!b || !state.game) return;
  net.broadcast({ type: 'photo-hide', round: state.game.round, pid: b.dataset.pid });
});

/* ---------- resultado: frases e medalhas ---------- */
function phraseFor(total) {
  if (total >= 9000) return 'Diva absoluta 👑';
  if (total >= 8000) return 'Arrasou! Já pode lançar álbum 💿';
  if (total >= 7000) return 'Mandou muito bem 🎶';
  if (total >= 6000) return 'Ensaiou no chuveiro, né? 🚿';
  if (total >= 4500) return 'Tá quase lá… bora de novo 😅';
  if (total >= 3000) return 'O microfone tava ligado? 🎤';
  if (total > 0) return 'Melhor nem comentar 🙈';
  return 'Ficou só olhando a letra 👀';
}

const MEDAL_CATS = [
  // [quesito, medalha de quem foi a melhor, medalha engraçada de quem foi pior]
  ['tune', '🎯 Mais afinada', '🎲 Afinação criativa'],
  ['presence', '💨 Maior fôlego', '🤫 Cantou no modo silencioso'],
  ['timbre', '🎙️ Voz mais firme', '🌬️ Voz tremidinha'],
  ['rhythm', '⏱️ Rainha do ritmo', '🐢 Entrou atrasada em tudo'],
];
/** uma medalha pra cada (só quando tem 2 ou mais) */
function medalsFor(done) {
  const out = {};
  if (done.length < 2) return out;
  for (const [k, good] of MEDAL_CATS) {
    const sorted = [...done].sort((a, b) => b.r[k] - a.r[k]);
    if (sorted[0].r[k] > sorted[1].r[k] && !out[sorted[0].id]) out[sorted[0].id] = good;
  }
  for (const x of done) {
    if (out[x.id]) continue;
    if (x.r.total === 0) { out[x.id] = '😶 Modo plateia'; continue; }
    const worst = MEDAL_CATS.reduce((w, c) => (x.r[c[0]] < x.r[w[0]] ? c : w));
    out[x.id] = worst[2];
  }
  return out;
}

/** "Placar da noite: Ana 3 · Bia 2" */
function renderNight() {
  const el = $('night-score');
  const ps = net.players.filter((p) => true);
  const any = ps.some((p) => state.wins[p.id]);
  el.classList.toggle('hidden', !any || ps.length < 2);
  el.textContent = '🏆 Placar da noite: ' + ps.map((p) => `${p.name} ${state.wins[p.id] || 0}`).join(' · ');
  renderResultButtons();
}

function renderResultButtons() {
  const next = state.queue[0];
  $('btn-other').textContent = next ? `▶ Próxima: ${next.title.length > 28 ? next.title.slice(0, 28) + '…' : next.title}` : 'Outra música';
}

$('btn-rematch').onclick = () => startRound();
$('btn-other').onclick = () => {
  if (!net.isHost || !$('screen-result').classList.contains('active') || !state.game) return;
  state.game = null;   // segundo clique não faz nada
  net.broadcast({ type: 'lobby', autoStart: state.queue.length > 0 });
};
net.on('lobby', (msg) => {
  state.game = null;
  document.body.classList.remove('playing');
  yt.pause();
  if (net.isHost) {
    state.song = null;
    state.autoStart = !!msg.autoStart;
    $('in-url').value = '';
    $('song-card').classList.add('hidden');
    broadcastSetup();
    maybeLoadNext();
  }
  renderLobby();
  show('lobby');
});
