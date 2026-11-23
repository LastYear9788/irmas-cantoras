// Irmãs Cantoras — fluxo do app (telas, lobby, jogo, resultado)
import { net } from './net.js?v=22';
import * as yt from './youtube.js?v=22';
import { findLyrics } from './lyrics.js?v=22';
import { assignParts, ALL } from './parts.js?v=22';
import { mic } from './mic.js?v=22';
import { Scorer } from './score.js?v=22';
import { cam } from './cam.js?v=22';
import { initCalibration, isCalibrationOpen, closeCalibration, renderBadges } from './calibrate.js?v=22';
import { createLog, saveLog, lastLog, downloadLog } from './singlog.js?v=22';
import { AV_OPTIONS, sanitizeAvatar, randomAvatar, loadMyAvatar, saveMyAvatar, avatarsEnabled, setAvatarsEnabled, vowelAt, loadThree, AvatarStage } from './avatar.js?v=22';

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
  $('in-game-hint').classList.add('hidden');
  $('in-url').placeholder = net.isHost ? 'Cole um link do YouTube aqui' : 'Cole um link pra sugerir uma música';
  $('btn-load').textContent = net.isHost ? 'Adicionar' : 'Sugerir';
  $('mode-toggle').classList.toggle('locked', !net.isHost);
  $('btn-start').classList.toggle('hidden', !net.isHost);
  $('btn-end').classList.toggle('hidden', !net.isHost);
  $('result-host').classList.toggle('hidden', !net.isHost);
  $('result-guest').classList.toggle('hidden', net.isHost);
  history.replaceState(null, '', location.pathname);
  if (!net.isHost) sessionStorage.setItem('ic-room', net.code); else sessionStorage.removeItem('ic-room');
  syncMicUi();
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
  // entrou alguém novo: todo mundo manda o visual da bonequinha de novo (pra ela ver as outras)
  const ids = net.players.map((p) => p.id).join(',');
  if (ids !== lastAvatarIds) { lastAvatarIds = ids; clearTimeout(avShareTimer); avShareTimer = setTimeout(shareAvatar, 500); }
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
function syncMicUi() {
  if (mic.active) {
    $('btn-mic').textContent = 'Microfone ligado ✓';
    $('btn-mic').classList.add('is-on');
    $('btn-mic').disabled = true;
    const lbl = mic.label();
    $('mic-msg').textContent = lbl
      ? `Usando: ${lbl.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*/gi, '')}${mic.info().rawMode ? ' · 🎧 Modo Fone' : ''}. Fale algo: a barra tem que mexer! 🎧`
      : 'Fale alguma coisa: a barra tem que mexer. Use fone de ouvido! 🎧';
    $('mic-msg').style.color = '';
    meterLoop();
  } else {
    $('btn-mic').textContent = 'Ativar microfone';
    $('btn-mic').classList.remove('is-on');
    $('btn-mic').disabled = false;
  }
  renderBadges();
}
initCalibration(syncMicUi);

mic.onLost = () => {
  logEv('micLost');
  toast('O microfone desconectou! Conecta de novo e clica em "Ativar microfone" 🎤', 6000);
  syncMicUi();
  if (state.ready) { state.ready = false; net.setReady(false); renderLobby(); }
};
/**
 * 1ª vez que liga o microfone: pergunta se está de fone. De fone, liga o "Modo Fone"
 * (sem cancelamento de eco / ganho automático do navegador): esses filtros de chamada
 * de vídeo chegaram a abafar a voz por 30s seguidos no meio da música (relatório do Kude).
 */
const PHONES_KEY = 'ic-asked-phones';
let phonesAsk = null;   // pergunta já aberta: quem chamar de novo espera a mesma resposta
function askHeadphones() {
  if (phonesAsk) return phonesAsk;
  let asked = false;
  try { asked = !!localStorage.getItem(PHONES_KEY); } catch (e) { asked = true; }
  if (asked || mic.getConfig().rawMode) return Promise.resolve();
  const modal = $('phones-modal');
  modal.classList.remove('hidden');
  phonesAsk = new Promise((resolve) => {
    const pick = (phones) => {
      phonesAsk = null;
      try { localStorage.setItem(PHONES_KEY, phones ? 'fone' : 'caixa'); } catch (e) { /* ok */ }
      mic.setConfig({ rawMode: phones });
      modal.classList.add('hidden');
      if (phones) toast('🎧 Modo Fone ligado: sua voz chega sem filtros', 4000);
      resolve();
    };
    $('phones-yes').onclick = () => pick(true);
    $('phones-no').onclick = () => pick(false);
  });
  return phonesAsk;
}

async function startMic() {
  try {
    // no meio da música (fio soltou) não pergunta nada: só religa
    if (!state.game || state.game.finished) await askHeadphones();
    await mic.start();
    syncMicUi();
    // religou no meio da música (o fio tinha soltado): volta a ouvir e a contar
    const g = state.game;
    if (g && !g.finished && g.myIndex >= 0) mic.monitor(hearMe);
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
  if (!mic.active) {
    meterRunning = false;
    $('mic-meter').style.width = '0%';
    $('game-meter').style.width = '0%';
    return;
  }
  // só mede volume quando o medidor está visível (no lobby ou jogando); sem gastar CPU de pitch no lobby/resultado
  const lobbyOn = $('screen-lobby').classList.contains('active');
  const gameOn = $('screen-game').classList.contains('active');
  if ((lobbyOn || gameOn) && !isCalibrationOpen()) {
    const m = mic.read(false);
    const w = (m.level * 100) + '%';
    if (lobbyOn) $('mic-meter').style.width = w;
    if (gameOn) $('game-meter').style.width = w;
  }
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
  if (ok) enqueue(item.videoId, item.by, item.title);
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

function enqueue(id, by, title = 'Vídeo do YouTube') {
  if (isQueued(id)) return;
  if (state.queue.length >= 20) { toast('A fila tá cheia (20 músicas) 😅'); return; }
  const item = { videoId: id, by, title: title || 'Vídeo do YouTube' };
  state.queue.push(item);
  broadcastSetup();
  if (item.title === 'Vídeo do YouTube') fetchTitle(item);
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
  net.broadcast({
    type: 'setup', song: state.song, mode: state.mode, queue: state.queue, pending: state.pending,
    wins: { ...state.wins }, inGame: !!(state.game && !state.game.finished),
  });
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
  $('in-game-hint').classList.toggle('hidden', !msg.inGame || !!state.game);
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
  closeCalibration();
  $('in-game-hint').classList.add('hidden');
  state.round = msg.round;
  state.finals = Object.create(null);
  state.live = Object.create(null);
  const myIndex = msg.players.findIndex((p) => p.id === net.myId);
  const lines = state.song.lines;
  const savedShift = getSavedShift(state.song.videoId);
  state.game = {
    round: msg.round, at: msg.at, who: msg.who, players: msg.players, myIndex,
    lines, scorer: new Scorer(lines, msg.who, myIndex, { latency: mic.info().bluetooth ? 0.25 : 0 }),
    prevActive: -1,
    shift: savedShift, finished: false, started: false, lastLiveSent: 0,
    diag: newDiag(),
    shots: cam.active ? planShots(lines, msg.who, myIndex) : null,
    myPhotos: [], peakPhoto: null, peak: 0, lastPeakShot: 0,
  };
  if (myIndex >= 0) state.game.log = newLog(state.game);
  setupAvatars(state.game);
  renderShiftVal(savedShift);
  state.photos = Object.create(null);
  renderPhotos();
  clearRecording();
  if (myIndex >= 0) mic.monitor(hearMe);

  $('tap-overlay').classList.add('hidden');
  renderScoreboard();
  setStatus(null);
  $('line-rate').classList.remove('show');
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
  scoreLoop(msg.round);
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
      if (g.myIndex >= 0 && mic.recStart()) g.recOffset = Math.max(0, (net.hostNow() - g.at) / 1000);
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

/**
 * Antes: se o vídeo estivesse 0,5s fora do tempo, pulava pro lugar certo — toda vez.
 * Em PC fraco / internet lenta, cada pulo faz o vídeo carregar de novo, e quando volta já
 * está atrasado de novo → pula de novo… o vídeo ficava travando e a nota não subia
 * (só conta ponto com a música andando). Agora: tolerância maior, espera entre pulos,
 * mira um pouco à frente (o tempo que o PC leva pra carregar) e, se continuar brigando, desiste.
 * Sozinha na sala não tem com quem sincronizar: não pula nunca.
 */
function syncVideo(g) {
  if (!g.started || g.finished) return;
  const expected = (net.hostNow() - g.at) / 1000;   // onde o vídeo deveria estar
  if (expected < 0 || expected > yt.duration()) return;
  const st = yt.state();
  if (st === 1) g.sawPlaying = true;
  if (st === 3 || st === 0) return;                  // carregando: espera / terminou: não recomeça
  const sy = g.sync || (g.sync = { lastSeek: -1e9, lead: 0.25, seeks: [], tol: 1, warned: false });
  const now = performance.now();
  const drift = yt.time() - expected;
  if (st === 1) {
    if (g.players.length < 2 || Math.abs(drift) <= sy.tol || now - sy.lastSeek < 6000) return;
    // o último pulo caiu atrás de novo? o PC demora pra carregar: mira mais à frente
    if (drift < 0 && now - sy.lastSeek < 20000) sy.lead = Math.min(3, sy.lead + Math.min(1.5, -drift));
    sy.seeks = sy.seeks.filter((t) => now - t < 90000);
    sy.seeks.push(now);
    if (sy.seeks.length >= 4) {
      sy.tol = Math.min(4, sy.tol * 1.8);
      if (!sy.warned) { sy.warned = true; toast('Seu PC/internet está lento pro vídeo: ele pode ficar um pouquinho fora do tempo das outras. A nota continua valendo 🙂', 6000); }
    }
    sy.lastSeek = now;
    logEv('seek', { drift: +drift.toFixed(2), lead: sy.lead, tol: sy.tol });
    yt.seek(expected + (drift < 0 ? sy.lead : 0));
    return;
  }
  // parado (não foi a pessoa que pausou: não tem botão de pausa): volta a tocar
  if ($('tap-overlay').classList.contains('hidden')) {
    if (Math.abs(drift) > sy.tol) yt.seek(expected + sy.lead);
    yt.play();
  }
}

function checkEnd(g) {
  if (!g.started) return;
  const last = g.lines[g.lines.length - 1];
  // "terminou" só vale se o vídeo chegou a tocar nesta rodada (senão é o fim da rodada anterior)
  if ((yt.state() === 0 && g.sawPlaying) || yt.time() - g.shift > last.end + 6) finishRound();
}

// voltou pra janela? acerta o tempo na hora
document.addEventListener('visibilitychange', () => {
  logEv(document.hidden ? 'hidden' : 'visible');
  if (document.hidden && state.game && state.game.log) saveLog(state.game.log);
  if (!document.hidden && state.game) syncVideo(state.game);
});
yt.onState((st) => logEv('yt', st));
addEventListener('error', (e) => logEv('error', String((e && e.message) || e).slice(0, 200)));
addEventListener('unhandledrejection', (e) => logEv('error', String((e && e.reason && e.reason.message) || (e && e.reason) || '').slice(0, 200)));
addEventListener('pagehide', () => { if (state.game && state.game.log) saveLog(state.game.log); });

$('btn-tap').onclick = () => {
  const g = state.game; if (!g) return;
  $('tap-overlay').classList.add('hidden');
  yt.seek((net.hostNow() - g.at) / 1000);
  yt.play();
};

/** onde a música está: tempo da letra, última linha que começou (k) e linha tocando agora (ou -1) */
function lyricPos(g) {
  const lt = yt.time() - g.shift;          // tempo "da letra"
  const lines = g.lines;
  let k = -1;
  for (let i = 0; i < lines.length; i++) { if (lines[i].t <= lt) k = i; else break; }
  const active = k >= 0 && lt < lines[k].end ? k : -1;
  return { lt, k, active };
}

/** Desenho da tela (letra, faixa da vez): só quando a tela está sendo mostrada. */
function gameLoop(round) {
  const g = state.game;
  if (!g || g.round !== round || g.finished) return;
  requestAnimationFrame((now) => { watchFps(now); g.frames = (g.frames || 0) + 1; gameLoop(round); });
  if (g.av && !document.hidden) { try { g.av.stage.frame(performance.now()); } catch (e) { stopAvatars(g); } }
  if (!g.started) return;

  const { lt, k, active } = lyricPos(g);
  const lines = g.lines;
  if (active >= 0) setLyrics(active, k, (lt - lines[active].t) / (lines[active].end - lines[active].t));
  else setLyrics(-1, k);
  updateBanner(active, k, lt);
  checkEnd(g);   // fim: vídeo acabou, ou 6s depois da última linha
}

/**
 * Pontuação: num relógio próprio (25x por segundo), separado do desenho.
 * Antes ela ia junto com o desenho da tela: PC fraco desenhando poucos quadros contava
 * menos, e com a janela minimizada ou coberta por outra (Discord, WhatsApp…) não contava NADA.
 */
function scoreLoop(round) {
  let lastT = 0;
  const iv = setInterval(() => {
    const g = state.game;
    if (!g || g.round !== round || g.finished) return clearInterval(iv);
    if (!g.started) return;
    const now = performance.now();
    const dt = lastT ? (now - lastT) / 1000 : 0;
    lastT = now;

    const { lt, active } = lyricPos(g);
    g.active = active;
    const m = mic.read();
    const playing = yt.isPlaying();
    if (playing) { g.sawPlaying = true; g.scorer.frame(active, lt, m, dt); cameraFrame(g, active, lt, m); }
    if (g.myIndex >= 0) diagnose(g, active, lt, m, playing, dt);
    if (g.log) {
      const ms = mic.status();
      g.log.tick({ ...m, lt, active, dt, mine: active >= 0 && isMine(g.who[active]), yt: yt.state(), problem: ms.problem });
    }
    if (g.av) avatarTick(g, active, lt, m, now);
    if (active !== g.prevActive) {
      if (g.prevActive >= 0 && g.myIndex >= 0) rateLine(g, g.prevActive);
      g.prevActive = active;
    }

    // pontuação ao vivo
    if (now - g.lastLiveSent > 1000) {
      g.lastLiveSent = now;
      const score = g.scorer.live();
      state.live[net.myId] = score;
      updateScores(active);
      if (g.myIndex >= 0) net.broadcast({ type: 'live', round: g.round, score });
      g.fps = g.frames || 0; g.frames = 0;
      avatarGuard(g);
      if (g.log) {
        g.log.event('score', score);
        g.log.event('fps', g.fps || 0);
        // guarda de tempos em tempos: se a aba fechar ou o PC travar, o relatório não se perde
        if (now - (g.logSaved || 0) > 30000) { g.logSaved = now; saveLog(g.log); }
      }
    }
  }, 40);
}

/* ---------- bonequinhas 3D ---------- */
const THREE_SRC = 'js/three.min.js?v=r128';
let myAvatar = loadMyAvatar();
saveMyAvatar(myAvatar);
state.avatars = Object.create(null);
let lastAvatarIds = '', avShareTimer = 0, avStage = null;
const isLite = () => document.documentElement.classList.contains('lite');

function shareAvatar() { if (net.myId) net.broadcast({ type: 'avatar', cfg: myAvatar }); }
net.on('avatar', (msg) => {
  if (!msg || !msg.from) return;
  const cfg = sanitizeAvatar(msg.cfg);
  state.avatars[msg.from] = cfg;
  const g = state.game;
  if (g && g.av) { const i = g.players.findIndex((p) => p.id === msg.from); const f = g.av.figOf.get(i); if (f !== undefined) g.av.stage.setLook(f, cfg); }
});

/** começo da música: monta o palco com as bonequinhas de quem está cantando */
async function setupAvatars(g) {
  if (!avatarsEnabled() || innerWidth <= 760) return;
  try { await loadThree(THREE_SRC); } catch (e) { return; }
  if (state.game !== g || g.finished) return;
  const canvas = $('av-layer');
  canvas.classList.remove('hidden');
  try {
    if (!avStage) { avStage = new AvatarStage(canvas, { mode: 'game', lite: isLite() }); avStage.setAnchor(() => ({ card: document.querySelector('.lyrics-card').getBoundingClientRect(), right: document.querySelector('.react-pill').getBoundingClientRect().left - 6 })); }
    avStage.setLite(isLite());
    avStage.resize();
  } catch (e) { canvas.classList.add('hidden'); avStage = null; return; }   // PC sem 3D (WebGL): segue sem bonequinha
  // eu no canto esquerdo; as outras do lado direito e depois pra dentro (até 4 no palco)
  const order = g.players.map((p, i) => i).sort((a, b) => (a === g.myIndex ? -1 : b === g.myIndex ? 1 : a - b)).slice(0, 4);
  const figOf = new Map();
  const list = order.map((pi, slot) => {
    figOf.set(pi, slot);
    const p = g.players[pi];
    if (!state.avatars[p.id]) state.avatars[p.id] = p.id === net.myId ? myAvatar : randomAvatar();
    return { cfg: state.avatars[p.id], slot, color: colorOf(pi) };
  });
  avStage.setPlayers(list);
  g.av = { stage: avStage, figOf, remote: Object.create(null), syl: -1, line: -1, pm: 0, sentAt: 0, sentL: -1, sentB: 99 };
}
/**
 * PC engasgando com as bonequinhas? 1º passa pro modo leve delas; se continuar,
 * desliga nesta música (a nota e o vídeo valem mais que o enfeite).
 */
function avatarGuard(g) {
  if (!g.av || document.hidden || !g.started) return;
  const slow = g.fps < 24 || (g.av.stage.cost || 0) > 12 || (g.sawPlaying && g.diag.notPlaying > 1.5);
  g.av.slow = slow ? (g.av.slow || 0) + 1 : Math.max(0, (g.av.slow || 0) - 1);
  if (g.av.slow >= 3 && !g.av.stage.lite) { g.av.stage.setLite(true); g.av.slow = 0; g.av.wasLite = true; logEv('bonequinha', 'leve'); }
  else if (g.av.slow >= 4 && g.av.stage.lite) {
    logEv('bonequinha', 'desligada');
    stopAvatars(g);
    toast('🎀 As bonequinhas foram desligadas nesta música pra não travar o seu PC.', 5000);
  }
}
function stopAvatars(g) {
  if (g) g.av = null;
  $('av-layer').classList.add('hidden');
  if (avStage) avStage.clear();
}
addEventListener('resize', () => { if (avStage && state.game && state.game.av) avStage.resize(); });
new MutationObserver(() => { if (avStage && isLite()) avStage.setLite(true); }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

/** 25x por segundo: o que cada bonequinha faz (minha voz daqui; das outras, pela rede) */
function avatarTick(g, active, lt, m, now) {
  const av = g.av;
  let vowel = 'a', onset = false;
  if (active >= 0) {
    const L = g.lines[active];
    const r = vowelAt(L.text, (lt - L.t) / Math.max(0.1, L.end - L.t));
    vowel = r.vowel;
    onset = r.idx !== av.syl || active !== av.line;
    av.syl = r.idx; av.line = active;
  }
  let myVol = 0, myBrow = 0;
  if (g.myIndex >= 0) {
    myVol = m.voiced ? Math.min(1, 0.35 + m.rms * 8) : m.loud ? Math.min(0.4, m.rms * 6) : 0;
    if (m.voiced && m.pitch > 0) {
      av.pm = av.pm ? av.pm + (m.pitch - av.pm) * 0.02 : m.pitch;          // nota "média" da pessoa
      myBrow = Math.max(-1, Math.min(1, (12 * Math.log2(m.pitch / av.pm)) / 6));
    }
    // manda pras outras (pouquinho: ~8x por segundo e só quando muda)
    const l = Math.round(myVol * 10), b = Math.round(myBrow * 10);
    if (now - av.sentAt > 120 && (l !== av.sentL || Math.abs(b - av.sentB) > 1 || now - av.sentAt > 600)) {
      av.sentAt = now; av.sentL = l; av.sentB = b;
      net.broadcast({ type: 'voz', round: g.round, l, b });
    }
  }
  const w = active >= 0 ? g.who[active] : null;
  for (const [pi, fi] of av.figOf) {
    const singing = w !== null && (w === pi || w === ALL);
    let vol = 0, brow = 0;
    if (pi === g.myIndex) { vol = myVol; brow = myBrow; }
    else { const r = av.remote[pi]; if (r && now - r.at < 700) { vol = r.l / 10; brow = r.b / 10; } }
    av.stage.setInput(fi, { singing, vol, brow, vowel, onset });
  }
}
function avatarReact(g, kind) {
  if (!kind || g.myIndex < 0) return;
  if (g.av) { const f = g.av.figOf.get(g.myIndex); if (f !== undefined) g.av.stage.react(f, kind); }
  net.broadcast({ type: 'voz', round: g.round, l: 0, b: 0, k: kind });
}
net.on('voz', (msg) => {
  const g = state.game;
  if (!g || !g.av || msg.round !== g.round || msg.from === net.myId) return;
  const pi = g.players.findIndex((p) => p.id === msg.from);
  if (pi < 0) return;
  const n = (x, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(x) || 0)));
  if (msg.k) { const f = g.av.figOf.get(pi); if (f !== undefined) g.av.stage.react(f, String(msg.k)); return; }
  g.av.remote[pi] = { l: n(msg.l, 0, 10), b: n(msg.b, -10, 10), at: performance.now() };
});

/* provador (no lobby) */
let avPrev = null, avPrevRaf = 0, avTab = 'cabelo';
function avTagText() { $('av-tag').textContent = avatarsEnabled() ? '' : '(desligadas durante a música)'; }
avTagText();
$('btn-avatar').onclick = openAvatarModal;
$('av-close').onclick = closeAvatarModal;
$('av-done').onclick = closeAvatarModal;
$('av-modal').addEventListener('click', (e) => { if (e.target === $('av-modal')) closeAvatarModal(); });
$('av-on').onchange = () => { setAvatarsEnabled($('av-on').checked); avTagText(); };
$('av-random').onclick = () => { setMyAvatar(randomAvatar()); renderAvPanel(); if (avPrev) avPrev.react(0, 'good'); };
document.querySelectorAll('.av-tab').forEach((b) => { b.onclick = () => { avTab = b.dataset.tab; renderAvPanel(); }; });
$('av-panel').addEventListener('click', (e) => {
  const b = e.target.closest('[data-k]'); if (!b) return;
  const k = b.dataset.k; const v = k === 'blush' ? b.dataset.v === 'true' : b.dataset.v;
  setMyAvatar({ ...myAvatar, [k]: v });
  $('av-panel').querySelectorAll(`[data-k="${k}"]`).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
});
function setMyAvatar(cfg) {
  myAvatar = sanitizeAvatar(cfg);
  saveMyAvatar(myAvatar);
  if (avPrev) avPrev.setLook(0, myAvatar);
  clearTimeout(avShareTimer); avShareTimer = setTimeout(shareAvatar, 600);
}
function renderAvPanel() {
  const O = AV_OPTIONS, me = myAvatar;
  document.querySelectorAll('.av-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === avTab)));
  const chips = (k, list) => `<div class="av-chips">${list.map(([v, l]) => `<button class="av-chip" type="button" data-k="${k}" data-v="${v}" aria-pressed="${String(me[k]) === String(v)}">${l}</button>`).join('')}</div>`;
  const sw = (k, list) => `<div class="av-chips">${list.map((c) => `<button class="av-sw" type="button" style="background:${c}" data-k="${k}" data-v="${c}" aria-pressed="${me[k] === c}" aria-label="cor ${c}"></button>`).join('')}</div>`;
  const opt = (label, html) => `<div class="av-opt"><span>${label}</span>${html}</div>`;
  const T = {
    cabelo: () => opt('Penteado', chips('hair', O.hair)) + opt('Franja', chips('bangs', O.bangs)) + opt('Cor do cabelo', sw('hairColor', O.hairColor)),
    roupa: () => opt('Roupa', chips('outfit', O.outfit)) + opt('Cor principal', sw('main', O.cloth)) + opt('Cor do detalhe', sw('detail', O.cloth)) + opt('Sapatinho', sw('shoes', O.cloth)),
    rosto: () => opt('Pele', sw('skin', O.skin)) + opt('Olhos', sw('eye', O.eye)) + opt('Bochechinha', chips('blush', [['true', 'Rosadinha'], ['false', 'Sem']])),
    enfeite: () => opt('Enfeite', chips('acc', O.acc)) + opt('Cor do enfeite (e dos elásticos)', sw('accColor', O.accColor)),
  };
  $('av-panel').innerHTML = T[avTab]();
}
async function openAvatarModal() {
  $('av-modal').classList.remove('hidden');
  $('av-on').checked = avatarsEnabled();
  $('av-msg').textContent = 'Carregando…';
  renderAvPanel();
  try {
    await loadThree(THREE_SRC);
    if ($('av-modal').classList.contains('hidden')) return;
    if (!avPrev) avPrev = new AvatarStage($('av-preview'), { mode: 'preview', lite: isLite() });
    avPrev.setPlayers([{ cfg: myAvatar, slot: 0 }]);
    $('av-msg').textContent = '';
  } catch (e) {
    $('av-msg').textContent = 'Não consegui abrir o 3D neste PC. Dá pra escolher o visual mesmo assim; as outras vão ver.';
    return;
  }
  cancelAnimationFrame(avPrevRaf);
  const loop = (now) => {
    if (!avPrev || $('av-modal').classList.contains('hidden')) return;
    avPrevRaf = requestAnimationFrame(loop);
    // "lá-lá-lá" de mentirinha pra ver a boquinha mexendo
    const k = Math.floor(now / 340), x = (now % 340) / 340;
    avPrev.setInput(0, { singing: Math.floor(now / 4000) % 2 === 0, vol: x < 0.8 ? 0.3 + 0.6 * Math.sin(Math.PI * x / 0.8) : 0, brow: Math.sin(k * 0.9) * 0.5, vowel: 'aeoia'[k % 5], onset: x < 0.1 });
    avPrev.spin(now);
    avPrev.frame(now);
  };
  avPrevRaf = requestAnimationFrame(loop);
}
function closeAvatarModal() {
  $('av-modal').classList.add('hidden');
  cancelAnimationFrame(avPrevRaf);
  // libera o 3D do provador (PC fraco não precisa ficar com 2 palcos abertos)
  if (avPrev) { avPrev.dispose(); avPrev = null; }
}

/* ---------- relatório de diagnóstico (pra descobrir depois por que não contou) ---------- */
function logEv(type, data) { const g = state.game; if (g && g.log && !g.finished) g.log.event(type, data); }
function newLog(g) {
  const info = mic.info();
  const cfg = mic.getConfig();
  return createLog({
    version: (new URL(import.meta.url).searchParams.get('v')) || '?',
    song: { videoId: state.song.videoId, title: state.song.title || '', lines: g.lines.length },
    mode: state.mode, players: g.players.length, myIndex: g.myIndex,
    myLines: g.who.filter((w) => isMine(w)).length,
    shift: g.shift, hearMe,
    device: {
      ua: navigator.userAgent, cores: navigator.hardwareConcurrency || 0, memory: navigator.deviceMemory || 0,
      lite: document.documentElement.classList.contains('lite'), screen: `${screen.width}x${screen.height}`,
    },
    mic: { ...info, settings: info.settings || {}, cal: { floor: cfg.calFloor, voice: cfg.calVoice, at: cfg.calibratedAt, device: cfg.calDevice } },
    latency: g.scorer.latency,
  });
}
$('btn-log').onclick = $('cal-log').onclick = () => {
  const g = state.game;
  const log = (g && g.log) || lastLog();
  if (!downloadLog(log)) toast('Ainda não tem relatório: cante uma música primeiro 🙂');
  else toast('Relatório baixado! Manda o arquivo .json pra quem está te ajudando 📋', 5000);
};

/* ---------- aviso ao vivo: por que a nota não está subindo ---------- */
function newDiag() {
  return { voicedAvg: 0, loudAvg: 0, clipAvg: 0, inLine: 0, outVoiced: 0, notPlaying: 0, why: Object.create(null), mineTime: 0, cand: null, candSince: 0, shown: '' };
}

const STATUS = {
  ok: ['ok', '✅ Contando pontos!'],
  go: ['info', '🎤 Sua vez, canta!'],
  off: ['bad', '🎤 O microfone desligou. Clique aqui pra ligar de novo'],
  muted: ['bad', '🔇 O microfone está no mudo (Windows, botão do fone ou outro app). Tira do mudo ou clique aqui pra reiniciar'],
  silent: ['bad', '🔇 Nenhum som chegou do microfone ainda (mudo ou Discord/Zoom usando). Canta, ou clique aqui pra reiniciar o microfone'],
  frozen: ['bad', '⚠️ O microfone travou por conflito com outro programa. Clique aqui pra reiniciar agora'],
  suspended: ['bad', '🔈 O navegador pausou o áudio. Clique aqui pra voltar a contar pontos'],
  buffering: ['warn', '⏳ O vídeo está carregando… os pontos voltam quando a música andar'],
  quiet: ['warn', '🔉 Não estou ouvindo sua voz. Canta mais alto ou chega mais perto do microfone'],
  noisy: ['warn', '🗣️ Estou ouvindo som, mas não uma nota cantada. Solta a voz nas vogais (sem sussurrar nem falar)'],
  leak: ['warn', '🎧 Tem muito barulho no microfone (ou a música está vazando da caixa de som). Usa fone de ouvido'],
  clip: ['warn', '📢 Alto demais: sua voz está estourando no microfone. Afasta um pouquinho'],
  offbeat: ['info', '🎵 Você está cantando numa parte sem letra. Se a letra estiver atrasada ou adiantada, ajuste em "Letra" − / +'],
  instrumental: ['info', '🎵 Parte sem letra: aqui não vale ponto'],
  other: ['info', ''],   // texto montado na hora: "Agora é a vez de Bia…"
};

function diagnose(g, active, lt, m, playing, dt) {
  const d = g.diag;
  const a = 1 - Math.exp(-dt / 0.6);           // média dos últimos ~0,6s
  d.voicedAvg += ((m.voiced ? 1 : 0) - d.voicedAvg) * a;
  d.loudAvg += ((m.loud ? 1 : 0) - d.loudAvg) * a;
  d.clipAvg += ((m.peak > 0.98 ? 1 : 0) - d.clipAvg) * a;
  d.notPlaying = playing ? 0 : d.notPlaying + dt;
  const mineNow = active >= 0 && isMine(g.who[active]);
  // terminou de cantar a frase e está respirando antes da próxima: não é problema
  const resting = mineNow && !m.voiced && lt > g.scorer.expectedEnd(active);
  d.inLine = mineNow ? d.inLine + dt : 0;
  d.outVoiced = active < 0 && m.voiced ? d.outVoiced + dt : active < 0 && !m.loud ? Math.max(0, d.outVoiced - dt * 0.5) : active >= 0 ? 0 : d.outVoiced;

  const ms = mic.status();
  let key = null;
  if (ms.problem === 'off' || ms.problem === 'muted' || ms.problem === 'silent' || ms.problem === 'frozen' || ms.problem === 'suspended') key = ms.problem;
  else if (d.notPlaying > 1.2 && $('tap-overlay').classList.contains('hidden') && yt.state() !== 0) key = 'buffering';
  else if (resting) key = d.shown === 'ok' ? 'ok' : null;
  else if (mineNow) {
    if (d.voicedAvg > 0.3) key = d.clipAvg > 0.4 ? 'clip' : 'ok';
    else if (d.inLine < 1) key = 'go';
    else if (d.clipAvg > 0.4) key = 'clip';
    else if (d.loudAvg > 0.5) key = ms.floor > 0.02 ? 'leak' : 'noisy';
    else key = 'quiet';
  } else if (active < 0) {
    if (d.outVoiced > 2.5) key = 'offbeat';
    else if (d.loudAvg > 0.6 && m.voiced) key = 'instrumental';
  } else if (d.loudAvg > 0.6 && d.voicedAvg > 0.3) key = 'other';

  // guarda o motivo de não contar (pra dica no resultado)
  if (mineNow && playing && !resting) {
    d.mineTime += dt;
    if (key && key !== 'ok' && key !== 'go' && key !== 'clip') d.why[key] = (d.why[key] || 0) + dt;
  }

  // só troca o aviso depois que ele se firmou (não fica piscando entre uma sílaba e outra)
  const now = performance.now();
  if (key !== d.cand) { d.cand = key; d.candSince = now; }
  const wait = !key || key === 'ok' || key === 'go' ? 250 : key === 'buffering' || STATUS[key][0] === 'bad' ? 300 : 900;
  if (now - d.candSince < wait || key === d.shown) return;
  d.shown = key;
  if (key === 'other') {
    const w = g.who[active];
    setStatus('other', `👀 Agora é a vez de ${(g.players[w] || {}).name || 'outra'}: seus pontos só contam na sua vez`);
  } else setStatus(key);
}

function setStatus(key, text) {
  logEv('aviso', key || '-');
  const el = $('score-status');
  if (!key) { el.classList.add('hidden'); el.dataset.key = ''; return; }
  const [cls, msg] = STATUS[key];
  el.className = 'score-status glass ' + cls;
  el.textContent = text || msg;
  el.dataset.key = key;
}

// clicar no aviso resolve o que dá pra resolver na hora
$('score-status').onclick = async () => {
  const key = $('score-status').dataset.key;
  if (key === 'off') { if (await startMic()) toast('Microfone ligado de novo 🎤'); }
  else if (key === 'suspended') mic.resume();
  else if (key === 'muted' || key === 'silent' || key === 'frozen') {
    logEv('micRestart', key);
    try {
      await mic.restart();
      syncMicUi();
      const g = state.game;
      if (g && !g.finished && g.myIndex >= 0) mic.monitor(hearMe);
      toast('Microfone reiniciado 🎤');
    } catch (e) { toast(e.message || 'Não consegui reiniciar o microfone', 5000); }
  }
};
// o navegador pode pausar o áudio até a pessoa clicar em algo
document.addEventListener('pointerdown', () => { if (mic.active) mic.resume(); }, { passive: true });

/* ---------- avaliação de cada linha que termina: "Perfeito! +412" ---------- */
let rateTimer = 0;
function rateLine(g, i) {
  const r = g.scorer.lineResult(i);
  if (!r) return;
  const v = r.v;
  logEv('linha', { i, nota: Math.round(v * 100), pts: r.points, fol: Math.round(r.presence * 100), afi: Math.round(r.tune * 100), tim: Math.round(r.timbre * 100), rit: Math.round(r.rhythm * 100) });
  const [label, cls] = v >= 0.92 ? ['✨ PERFEITO!', 'perfect'] : v >= 0.8 ? ['🔥 Ótimo!', 'great'] : v >= 0.6 ? ['👍 Bom', 'good']
    : v >= 0.35 ? ['🙂 Ok', 'ok'] : ['😬 Ops…', 'miss'];
  // o que mais atrapalhou nessa linha (só quando não foi ótima)
  let tip = '';
  if (v < 0.8) {
    const weak = [['presence', 'cantou pouco da linha'], ['tune', 'desafinou um pouco'], ['rhythm', 'entrou atrasada ou sem acompanhar as sílabas'], ['timbre', 'voz tremida ou fraquinha']]
      .map(([k, t]) => [r[k], t]).sort((a, b) => a[0] - b[0])[0];
    if (weak[0] < 0.7) tip = weak[1];
  }
  avatarReact(g, cls === 'perfect' ? 'perfect' : cls === 'miss' ? 'miss' : cls === 'ok' ? '' : 'good');
  const el = $('line-rate');
  el.className = 'line-rate ' + cls;
  el.innerHTML = `<b>${label}</b> <span class="pts">+${r.points.toLocaleString('pt-BR')}</span>${tip ? `<small>${esc(tip)}</small>` : ''}`;
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(rateTimer);
  rateTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

/** No resultado: se boa parte da vez a voz não contou, explica o porquê */
function resultTip(g) {
  const d = g && g.diag;
  if (!d || g.myIndex < 0 || d.mineTime < 5) return '';
  let top = null;
  for (const k in d.why) if (!top || d.why[k] > d.why[top]) top = k;
  if (!top || d.why[top] < Math.max(4, d.mineTime * 0.25)) return '';
  const pct = Math.round((d.why[top] / d.mineTime) * 100);
  const tips = {
    off: 'o microfone estava desligado',
    muted: 'o microfone estava no mudo',
    silent: 'o microfone estava mandando silêncio (mudo no fone/notebook ou outro programa usando)',
    frozen: 'o microfone travou por conflito com outro programa (Discord/Zoom/Windows)',
    suspended: 'o navegador tinha pausado o áudio',
    buffering: 'o vídeo estava carregando (internet ou PC lento)',
    quiet: 'não deu pra ouvir sua voz (canta mais alto ou chega perto do microfone)',
    noisy: 'o microfone ouviu som, mas não nota cantada (fala, sussurro ou barulho)',
    leak: 'tinha muito barulho no microfone (use fone de ouvido)',
  };
  return tips[top] ? `💡 Em ${pct}% da sua vez a nota não contou porque ${tips[top]}. Dica: use "🔧 Calibrar" no lobby.` : '';
}

/* ---------- PC fraco: se a tela estiver desenhando devagar, liga o modo leve ---------- */
let fpsStart = 0, fpsSum = 0, fpsN = 0, fpsLast = 0;
function watchFps(now) {
  if (document.documentElement.classList.contains('lite')) return;
  try { if (localStorage.getItem('ic-lite') === '0') return; } catch (e) { /* ok */ }
  const gap = fpsLast ? now - fpsLast : 0;
  fpsLast = now;
  if (!gap || gap > 400 || document.hidden) return;        // aba escondida / travadinha isolada não conta
  if (!fpsStart) fpsStart = now;
  fpsSum += gap; fpsN++;
  if (now - fpsStart < 3000) return;
  const slow = fpsSum / fpsN > 45;                          // menos de ~22 quadros por segundo
  fpsStart = 0; fpsSum = 0; fpsN = 0;
  if (!slow) return;
  document.documentElement.classList.add('lite');
  try { localStorage.setItem('ic-lite', '1'); } catch (e) { /* ok */ }
  window.dispatchEvent(new Event('ic-lite'));
  toast('Seu PC estava pesando: liguei o modo leve (dá pra desligar no topo da tela) ⚡', 5000);
}

let lastRendered = '';
let curWords = [];
function buildCurWords(el, text) {
  curWords = [];
  if (!text) { el.textContent = ''; return; }
  const parts = text.split(/(\s+)/);
  let totalChars = 0;
  for (const p of parts) if (p && !/^\s+$/.test(p)) totalChars += p.length;
  totalChars = Math.max(1, totalChars);
  let acc = 0;
  el.innerHTML = parts.map((p) => {
    if (!p) return '';
    if (/^\s+$/.test(p)) return p;
    const start = acc / totalChars;
    acc += p.length;
    const end = acc / totalChars;
    return `<span class="ly-word" data-s="${start}" data-e="${end}">${esc(p)}</span>`;
  }).join('');
  curWords = [...el.querySelectorAll('.ly-word')].map((node) => ({
    el: node, start: +node.dataset.s, end: +node.dataset.e, last: -1,
  }));
}
function paintCurWords(progress) {
  const p = Math.max(0, Math.min(1, progress));
  for (const w of curWords) {
    const raw = p <= w.start ? 0 : p >= w.end ? 100 : ((p - w.start) / Math.max(1e-4, w.end - w.start)) * 100;
    const pct = Math.round(raw * 2) / 2;
    if (pct !== w.last) { w.last = pct; w.el.style.setProperty('--wp', pct + '%'); }
  }
}

function setLyrics(active, k, progress = 0) {
  const g = state.game;
  const lines = g.lines;
  // se não tem linha ativa, mostra a próxima como "atual" (ainda sem cor)
  const curIdx = active >= 0 ? active : k + 1;
  const key = active + ':' + curIdx;
  const cur = $('ly-cur');
  if (key !== lastRendered) {
    lastRendered = key;
    const prev = lines[curIdx - 1], line = lines[curIdx], next = lines[curIdx + 1];
    $('ly-prev').textContent = prev ? prev.text : '';
    if (line) buildCurWords(cur, line.text);
    else { curWords = []; cur.textContent = curIdx >= lines.length ? '🎉' : ''; }
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
  paintCurWords(active >= 0 ? progress : 0);
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
  updateScores(g.active ?? -1);   // redesenhou (alguém saiu, mudou "pronta"…): não volta pra 0
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

/* ---------- me ouvir (voz no fone enquanto canta) ---------- */
let hearMe = localStorage.getItem('ic-hear') === '1';
function renderHear() {
  $('btn-hear').textContent = hearMe ? '🎧 Me ouvindo' : '🎧 Me ouvir';
  $('btn-hear').classList.toggle('is-on', hearMe);
}
$('btn-hear').onclick = () => {
  hearMe = !hearMe;
  localStorage.setItem('ic-hear', hearMe ? '1' : '0');
  const g = state.game;
  if (g && !g.finished && g.myIndex >= 0) mic.monitor(hearMe);
  renderHear();
  toast(hearMe ? 'Agora você escuta sua voz 🎧 Só use com fone de ouvido, senão dá microfonia!' : 'Não está mais escutando sua voz', 4500);
};
renderHear();

/* ---------- gravação: ouvir a música inteira depois ---------- */
const rec = { url: null, offset: 0, audio: null, iv: null };
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function setRecording(blob, g) {
  if (!blob || state.game !== g || blob.size < 2000) return;
  clearRecording();
  rec.url = URL.createObjectURL(blob);
  rec.offset = g.recOffset || 0;
  const ext = /mp4/.test(blob.type) ? 'm4a' : 'webm';
  const name = (state.song && state.song.title || 'música').replace(/[\\/:*?"<>|]+/g, '').slice(0, 60);
  $('rec-download').href = rec.url;
  $('rec-download').download = `Minha gravação - ${name}.${ext}`;
  $('rec-box').classList.remove('hidden');
}

function clearRecording() {
  stopRecording();
  if (rec.url) URL.revokeObjectURL(rec.url);
  rec.url = null;
  $('rec-box').classList.add('hidden');
}

function stopRecording() {
  clearInterval(rec.iv);
  if (!rec.audio) return;
  rec.audio.pause();
  rec.audio = null;
  yt.pause();
  yt.setMuted(musicOff);
  document.body.classList.remove('replay');
  $('btn-rec-play').textContent = '🎧 Ouvir minha gravação';
}

$('btn-rec-play').onclick = () => {
  if (rec.audio) return stopRecording();
  if (!rec.url || !state.song) return;
  const a = new Audio(rec.url);
  rec.audio = a;
  a.onended = () => { if (rec.audio === a) stopRecording(); };
  yt.setMuted(false);   // na gravação a música vem junto
  yt.seek(rec.offset);
  yt.play();
  document.body.classList.add('replay');
  $('btn-rec-play').textContent = '⏹ Parar';
  const t0 = Date.now();
  // a voz segue o vídeo: começa quando ele começa e é acertada se escorregar
  rec.iv = setInterval(() => {
    if (rec.audio !== a) return;
    const st = yt.state();
    const want = yt.time() - rec.offset;
    if (st === 1) {
      if (a.paused) { a.currentTime = Math.max(0, want); a.play().catch(() => {}); }
      else if (Math.abs(a.currentTime - want) > 0.3) a.currentTime = Math.max(0, want);
    } else if (st === 3 || st === 2) {
      if (!a.paused && st === 3) a.pause();            // vídeo carregando: a voz espera
      if (a.paused && Date.now() - t0 > 5000) a.play().catch(() => {});   // vídeo não quer tocar: vai só a voz
    } else if (a.paused && (st === 0 || Date.now() - t0 > 5000)) a.play().catch(() => {});
    $('btn-rec-play').textContent = `⏹ Parar (${mmss(a.currentTime)})`;
  }, 250);
};
$('rec-download').onclick = (e) => { if (!rec.url) e.preventDefault(); };

/* ---------- ajuste de sincronia da letra (salvo por música, mantém na revanche!) ---------- */
const SHIFTS_KEY = 'ic-shifts';
function loadShifts() {
  try { const x = JSON.parse(localStorage.getItem(SHIFTS_KEY) || '{}'); return x && typeof x === 'object' ? x : {}; }
  catch (e) { return {}; }
}
function getSavedShift(videoId) {
  if (!videoId) return 0;
  const v = Number(loadShifts()[videoId]);
  return Number.isFinite(v) ? Math.max(-30, Math.min(30, v)) : 0;
}
function saveShift(videoId, shift) {
  if (!videoId) return;
  try {
    const map = loadShifts();
    if (shift === 0) delete map[videoId];
    else map[videoId] = shift;
    const keys = Object.keys(map);
    if (keys.length > 50) delete map[keys[0]];
    localStorage.setItem(SHIFTS_KEY, JSON.stringify(map));
  } catch (e) { /* ok */ }
}
function renderShiftVal(v) {
  $('sync-val').textContent = (v > 0 ? '+' : '') + v.toFixed(1).replace('.', ',') + 's';
}
function setShift(d) {
  logEv('letra', d);
  const g = state.game; if (!g) return;
  g.shift = Math.max(-30, Math.min(30, Math.round((g.shift + d) * 10) / 10));
  renderShiftVal(g.shift);
  if (state.song) saveShift(state.song.videoId, g.shift);
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
  stopAvatars(g);
  yt.pause();
  mic.monitor(false);
  if (g.recOffset != null) mic.recStop().then((blob) => setRecording(blob, g));
  document.body.classList.remove('playing');
  $('countdown').classList.add('hidden');
  $('tap-overlay').classList.add('hidden');
  setStatus(null);
  $('line-rate').classList.remove('show');
  const tip = resultTip(g);
  $('result-tip').textContent = tip;
  $('result-tip').classList.toggle('hidden', !tip);

  if (g.myIndex >= 0) {
    const result = g.scorer.final();
    if (g.log) {
      g.log.finish({ final: result, diagWhy: g.diag && g.diag.why, mic: mic.info(), sync: g.sync || null });
      saveLog(g.log);
    }
    $('btn-log').classList.toggle('hidden', !g.log);
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
    timbre: num(r.timbre, 100), rhythm: num(r.rhythm, 100), perfect: num(r.perfect, 999),
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
      <div class="result-phrase">${phraseFor(x.r.total)}${x.r.perfect ? ` · ✨ ${x.r.perfect} ${x.r.perfect === 1 ? 'linha perfeita' : 'linhas perfeitas'}` : ''}</div>
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
  $('btn-rematch').disabled = !complete;
  $('btn-other').disabled = !complete;
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
  const ps = net.players;
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
  clearRecording();
  if (state.game) stopAvatars(state.game);
  state.game = null;
  $('in-game-hint').classList.add('hidden');
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
