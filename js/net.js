// Conexão entre os PCs usando PeerJS (WebRTC direto, servidor público grátis só pra "apresentar" os PCs).
// Topologia estrela: a dona da sala (host) recebe tudo e repassa pra todas.
// Funciona com qualquer número de jogadoras.

const PREFIX = 'irmascantoras-v1-';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sem I e O pra não confundir

const PEER_OPTS = {
  debug: 0,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ],
  },
};

function randomCode() {
  let c = '';
  for (let i = 0; i < 4; i++) c += LETTERS[Math.floor(Math.random() * LETTERS.length)];
  return c;
}

const NO_PEER = 'Não consegui carregar o sistema de salas. Confere a internet e recarrega a página (F5).';
const handlers = {};
let peer = null;
let hostConn = null;        // (convidada) conexão com a host
const conns = new Map();    // (host) peerId -> conexão
let clockOffset = 0;        // (convidada) relógio da host - meu relógio

export const net = {
  isHost: false,
  myId: null,
  code: null,
  players: [],              // [{ id, name, ready }]

  on(type, fn) { (handlers[type] ||= []).push(fn); },

  /** horário no relógio da host (pra sincronizar o começo) */
  hostNow() { return Date.now() + clockOffset; },

  /** manda pra todo mundo, inclusive pra mim */
  broadcast(msg) {
    msg.from = net.myId;
    if (net.isHost) {
      deliver(msg);
      for (const c of conns.values()) safeSend(c, msg);
    } else {
      deliver(msg);
      safeSend(hostConn, { ...msg, _relay: true });
    }
  },

  createRoom(name) {
    if (typeof Peer === 'undefined') return Promise.reject(new Error(NO_PEER));
    return new Promise((resolve, reject) => {
      let tries = 0;
      const attempt = () => {
        const code = randomCode();
        const p = new Peer(PREFIX + code, PEER_OPTS);
        p.on('open', (id) => {
          peer = p;
          net.isHost = true;
          net.myId = id;
          net.code = code;
          net.players = [{ id, name, ready: false }];
          p.on('connection', onGuestConnection);
          p.on('disconnected', () => p.reconnect());
          emit('players', net.players);
          resolve(code);
        });
        p.on('error', (err) => {
          if (peer === p) return emit('neterror', err);
          p.destroy();
          if (err.type === 'unavailable-id' && tries++ < 5) attempt();
          else reject(friendlyError(err));
        });
      };
      attempt();
    });
  },

  joinRoom(code, name) {
    if (typeof Peer === 'undefined') return Promise.reject(new Error(NO_PEER));
    return new Promise((resolve, reject) => {
      code = code.toUpperCase().trim();
      const p = new Peer(PEER_OPTS);
      let done = false;
      const fail = (e) => { if (!done) { done = true; p.destroy(); reject(e); } };
      const timer = setTimeout(() => fail('Não consegui conectar. Confere o código e tenta de novo.'), 12000);

      p.on('error', (err) => {
        if (done) return emit('neterror', err);
        clearTimeout(timer);
        fail(friendlyError(err));
      });
      p.on('open', (id) => {
        const c = p.connect(PREFIX + code, { reliable: true });
        c.on('open', () => {
          clearTimeout(timer);
          done = true;
          peer = p;
          hostConn = c;
          net.isHost = false;
          net.myId = id;
          net.code = code;
          safeSend(c, { type: 'hello', name });
          syncClock();
          resolve(code);
        });
        c.on('data', (msg) => {
          if (msg.type === 'hb') return safeSend(c, { type: 'hbr' });
          if (msg.type === 'hbr') return;
          if (msg.type === 'pong') return onPong(msg);
          if (msg.type === 'players') net.players = msg.players;
          deliver(msg);
        });
        watchConn(c, () => emit('hostgone'));
      });
    });
  },

  /** (host) marca/desmarca "pronta" de uma jogadora e avisa todas */
  setReady(ready) {
    if (net.isHost) {
      const me = net.players.find((p) => p.id === net.myId);
      if (me) me.ready = ready;
      pushPlayers();
    } else {
      safeSend(hostConn, { type: 'ready', ready });
    }
  },
};

/* ---------------- interno ---------------- */

function emit(type, data) { (handlers[type] || []).forEach((fn) => fn(data)); }
function deliver(msg) { emit(msg.type, msg); }
function safeSend(c, msg) { try { if (c && c.open) c.send(msg); } catch (e) { console.warn(e); } }

function pushPlayers() {
  const msg = { type: 'players', players: net.players };
  for (const c of conns.values()) safeSend(c, msg);
  emit('players', net.players);
}

function onGuestConnection(c) {
  c.on('data', (msg) => {
    switch (msg.type) {
      case 'hello':
        conns.set(c.peer, c);
        net.players.push({ id: c.peer, name: String(msg.name || 'Amiga').slice(0, 16), ready: false });
        pushPlayers();
        emit('guestjoined', c.peer);
        break;
      case 'ping':
        safeSend(c, { type: 'pong', t0: msg.t0, th: Date.now() });
        break;
      case 'hb':
        safeSend(c, { type: 'hbr' });
        break;
      case 'hbr':
        break;
      case 'ready': {
        const pl = net.players.find((p) => p.id === c.peer);
        if (pl) { pl.ready = !!msg.ready; pushPlayers(); }
        break;
      }
      default:
        // convidadas só podem mandar a nota ao vivo e a final (comandos de jogo são só da dona da sala)
        if (msg._relay && GUEST_CAN_SEND.has(msg.type)) {
          delete msg._relay;
          msg.from = c.peer;
          deliver(msg);
          for (const [id, other] of conns) if (id !== c.peer) safeSend(other, msg);
        }
    }
  });
  watchConn(c, () => {
    conns.delete(c.peer);
    const pl = net.players.find((p) => p.id === c.peer);
    net.players = net.players.filter((p) => p.id !== c.peer);
    pushPlayers();
    if (pl) emit('guestleft', pl);
    try { c.close(); } catch (e) { /* já fechou */ }
  });
}

const GUEST_CAN_SEND = new Set(['live', 'final', 'enqueue', 'react', 'photos', 'photo-hide']);

/**
 * "Sinal de vida": a cada 2s manda um oi; se a outra ponta passar 12s sem responder, ela saiu.
 * (Fechar a aba ou cair a internet nem sempre avisa a conexão na hora.)
 * Se o MEU relógio estiver atrasado (janela minimizada), não julga — pra não expulsar ninguém à toa.
 */
function watchConn(c, onGone) {
  let lastSeen = Date.now(), lastTick = Date.now(), gone = false;
  const bye = () => { if (gone) return; gone = true; clearInterval(iv); onGone(); };
  c.on('data', () => { lastSeen = Date.now(); });
  c.on('close', bye);
  const iv = setInterval(() => {
    const now = Date.now();
    const gap = now - lastTick;
    lastTick = now;
    if (gap < 5000 && now - lastSeen > 12000) return bye();
    safeSend(c, { type: 'hb' });
  }, 2000);
}

// Mede a diferença de relógio com a host (5 pings, fica com o mais rápido)
let pingResults = [];
function syncClock() {
  pingResults = [];
  for (let i = 0; i < 5; i++) setTimeout(() => safeSend(hostConn, { type: 'ping', t0: Date.now() }), i * 300);
}
function onPong({ t0, th }) {
  const t1 = Date.now();
  pingResults.push({ rtt: t1 - t0, offset: th - (t0 + t1) / 2 });
  pingResults.sort((a, b) => a.rtt - b.rtt);
  clockOffset = pingResults[0].offset;
}

function friendlyError(err) {
  switch (err && err.type) {
    case 'peer-unavailable': return 'Sala não encontrada. Confere o código!';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed': return 'Problema de internet. Tenta de novo daqui a pouco.';
    case 'browser-incompatible': return 'Esse navegador não funciona. Usa o Chrome ou o Edge.';
    default: return 'Deu ruim na conexão. Tenta de novo.';
  }
}
