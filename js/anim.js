// Animações das interações (GSAP, em js/vendor/gsap.min.js).
// Se o GSAP não carregar, quem pede "reduzir movimento" no sistema ou o PC estiver fraco
// ("modo leve"), tudo continua funcionando: só fica com as animações simples do CSS.

const G = () => window.gsap || null;
const reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
const lite = () => document.documentElement.classList.contains('still');
/** pode animar? (lite = só as animações leves continuam) */
const ok = (heavy = false) => !!G() && !reduce.matches && !(heavy && lite());

const SPRING = 'back.out(1.7)';

export const anim = {
  get on() { return ok(); },

  /* ============ telas ============ */
  /** entrada da tela: os cartões chegam um depois do outro */
  screen(el) {
    if (!ok() || !el) return;
    const vis = (c) => !c.classList.contains('hidden') && c.offsetParent !== null;
    const cards = [...el.querySelectorAll(':scope > .card, :scope > .lobby-grid > *, :scope > .scoreboard, :scope > .game-center > *, :scope > .game-bottom')].filter(vis);
    if (!cards.length) return;
    el.style.animation = 'none';
    G().fromTo(cards, { y: 30, opacity: 0, scale: 0.96 },
      { y: 0, opacity: 1, scale: 1, duration: 0.65, ease: 'power3.out', stagger: 0.09, clearProps: 'transform,opacity' });
    // tela de um cartão só: o que tem dentro também chega em sequência
    if (cards.length === 1 && cards[0].classList.contains('card')) {
      const inner = [...cards[0].children].filter(vis).slice(0, 12);
      G().fromTo(inner, { y: 14, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.45, ease: 'power2.out', stagger: 0.05, delay: 0.15, clearProps: 'transform,opacity' });
    }
  },

  /* ============ sala ============ */
  /** código da sala: as letras viram uma de cada vez */
  roomCode(el, code) {
    if (!ok() || !el) { if (el) el.textContent = code; return; }
    el.innerHTML = [...code].map((ch) => `<span class="rc-ch">${ch}</span>`).join('');
    G().fromTo(el.children, { rotationX: -90, y: -10, opacity: 0, transformPerspective: 400 },
      { rotationX: 0, y: 0, opacity: 1, duration: 0.55, ease: SPRING, stagger: 0.09, delay: 0.25 });
  },

  _seen: new Set(), _ready: new Set(),
  /** lista da sala: quem chega desliza, quem fica pronta ganha um "pop" */
  lobby(list, players) {
    if (!list) return;
    const now = new Set(players.map((p) => p.id));
    if (!ok()) { anim._seen = now; anim._ready = new Set(players.filter((p) => p.ready).map((p) => p.id)); return; }
    [...list.children].forEach((li, i) => {
      const p = players[i]; if (!p) return;
      if (!anim._seen.has(p.id)) {
        G().fromTo(li, { x: -40, opacity: 0, scale: 0.9 }, { x: 0, opacity: 1, scale: 1, duration: 0.6, ease: SPRING, delay: 0.05 * i });
      }
      const st = li.querySelector('.status');
      if (st && p.ready && !anim._ready.has(p.id)) {
        G().fromTo(st, { scale: 0.4, rotation: -12 }, { scale: 1, rotation: 0, duration: 0.6, ease: 'elastic.out(1, 0.45)' });
        G().fromTo(li, { boxShadow: '0 0 0 0 rgba(124,242,154,0.7)' }, { boxShadow: '0 0 0 14px rgba(124,242,154,0)', duration: 0.8, ease: 'power2.out', clearProps: 'boxShadow' });
      }
    });
    anim._seen = now;
    anim._ready = new Set(players.filter((p) => p.ready).map((p) => p.id));
  },

  /** botão que liga/desliga: amassa e volta */
  press(el) {
    if (!ok() || !el) return;
    G().fromTo(el, { scale: 0.9 }, { scale: 1, duration: 0.5, ease: 'elastic.out(1.1, 0.4)', clearProps: 'transform' });
  },

  /** contagem regressiva: cada número cai grande e encolhe girando */
  count(el, txt) {
    if (!el) return false;
    if (!ok()) return false;
    el.style.animation = 'none';
    el.textContent = txt;
    G().killTweensOf(el);
    G().timeline()
      .fromTo(el, { scale: 2.4, opacity: 0, rotation: txt === '🎤' ? -20 : 15, filter: 'blur(8px)' },
        { scale: 1, opacity: 1, rotation: 0, filter: 'blur(0px)', duration: 0.45, ease: 'back.out(2.2)' })
      .to(el, { scale: 0.75, opacity: 0.15, duration: 0.5, ease: 'power2.in' }, '+=0.05');
    return true;
  },

  /* ============ efeitos ============ */
  panel(el, open) {
    if (!el) return;
    if (!ok()) { el.classList.toggle('hidden', !open); return; }
    G().killTweensOf(el);
    if (open) {
      el.classList.remove('hidden');
      G().fromTo(el, { opacity: 0, y: 14, scale: 0.92, xPercent: -50, transformOrigin: '50% 100%' },
        { opacity: 1, y: 0, scale: 1, xPercent: -50, duration: 0.45, ease: SPRING });
      G().fromTo(el.querySelectorAll('label'), { opacity: 0, y: 8 },
        { opacity: 1, y: 0, duration: 0.35, stagger: 0.05, delay: 0.08, ease: 'power2.out', clearProps: 'all' });
    } else if (!el.classList.contains('hidden')) {
      G().to(el, { opacity: 0, y: 10, scale: 0.94, xPercent: -50, duration: 0.2, ease: 'power2.in',
        onComplete: () => { el.classList.add('hidden'); G().set(el, { clearProps: 'opacity,scale,y' }); } });
    }
  },

  /** tamanho da sala: uma onda que cresce mais quanto maior a sala */
  room(anchor, room) {
    if (!ok() || !anchor) return;
    const r = document.createElement('span');
    r.className = 'fx-ripple';
    anchor.appendChild(r);
    const size = 1.6 + room * 5;
    G().fromTo(r, { scale: 0.2, opacity: 0.8 },
      { scale: size, opacity: 0, duration: 0.5 + room * 1.3, ease: 'power2.out', onComplete: () => r.remove() });
  },

  /** valor que muda (ex.: "35%"): um pulinho */
  bump(el) {
    if (!ok() || !el) return;
    G().fromTo(el, { scale: 1.25 }, { scale: 1, duration: 0.3, ease: 'power2.out', clearProps: 'transform' });
  },

  /* ============ nota e resultado ============ */
  /** número que sobe contando até o valor */
  countUp(el, to, { from = 0, duration = 1.6, delay = 0 } = {}) {
    if (!el) return;
    const fmt = (v) => Math.round(v).toLocaleString('pt-BR');
    if (!ok()) { el.textContent = fmt(to); return; }
    const o = { v: from };
    G().killTweensOf(el.__cu || {});
    el.__cu = o;
    el.textContent = fmt(from);
    G().to(o, { v: to, duration, delay, ease: 'power2.out', onUpdate: () => { el.textContent = fmt(o.v); } });
  },

  /** placar ao vivo durante a música: conta e dá um pulo quando sobe */
  liveScore(el, to) {
    if (!el) return;
    const prev = el.__val ?? 0;
    el.__val = to;
    if (to === prev) return;
    if (!ok()) { el.textContent = to.toLocaleString('pt-BR'); return; }
    anim.countUp(el, to, { from: prev, duration: 0.8 });
    if (to > prev) G().fromTo(el, { scale: 1.3, color: '#7cf29a' }, { scale: 1, color: '', duration: 0.6, ease: 'power2.out', clearProps: 'color,transform' });
  },

  _crown: '',
  crown(el) {
    if (!el || el.textContent === anim._crown) return;
    anim._crown = el.textContent;
    if (!ok()) return;
    el.style.animation = 'none';
    const king = el.textContent === '👑';
    G().fromTo(el, { y: -80, scale: 0.3, rotation: king ? -30 : 0, opacity: 0 },
      { y: 0, scale: 1, rotation: 0, opacity: 1, duration: 0.9, ease: 'bounce.out' });
    if (king) G().to(el, { rotation: 8, yoyo: true, repeat: 3, duration: 0.18, delay: 0.9, ease: 'sine.inOut' });
  },

  _done: new Set(),
  /** cartões do resultado: entram um por um, nota conta, barras crescem, medalha pula */
  results(list, round) {
    if (!list) return;
    [...list.querySelectorAll('.result-item')].forEach((item, pos) => {
      const key = round + ':' + item.dataset.id + ':' + item.dataset.total;
      const total = Number(item.dataset.total) || 0;
      const tot = item.querySelector('.ptotal');
      if (anim._done.has(key)) { item.style.animation = 'none'; return; }
      anim._done.add(key);
      if (!ok()) return;
      const d = 0.15 + pos * 0.18;
      item.style.animation = 'none';
      G().fromTo(item, { y: 40, opacity: 0, scale: 0.94 }, { y: 0, opacity: 1, scale: 1, duration: 0.7, delay: d, ease: SPRING, clearProps: 'transform,opacity' });
      anim.countUp(tot, total, { delay: d + 0.15, duration: 1.8 });
      const bars = item.querySelectorAll('.bar > div');
      G().from(bars, { width: 0, duration: 1.1, delay: d + 0.35, stagger: 0.1, ease: 'power3.out' });
      const medal = item.querySelector('.medal');
      if (medal) G().fromTo(medal, { scale: 0, rotation: -25 }, { scale: 1, rotation: 0, duration: 0.7, delay: d + 1.6, ease: 'elastic.out(1, 0.45)' });
    });
  },

  _confetti: '',
  /** chuva de confete pra vencedora (uma vez por rodada) */
  confetti(key, colors) {
    if (anim._confetti === key || !ok(true)) return;
    anim._confetti = key;
    const box = document.createElement('div');
    box.className = 'confetti';
    document.body.appendChild(box);
    const W = innerWidth, H = innerHeight;
    const pal = colors && colors.length ? colors : ['#ff5fa2', '#ffd166', '#7cf29a', '#4fb3ff', '#b388ff'];
    for (let i = 0; i < 90; i++) {
      const p = document.createElement('i');
      p.style.background = pal[i % pal.length];
      if (i % 3 === 0) p.style.borderRadius = '50%';
      box.appendChild(p);
      const fromLeft = i % 2 === 0;
      G().set(p, { x: fromLeft ? -10 : W + 10, y: H * (0.55 + Math.random() * 0.3), rotation: Math.random() * 360 });
      G().timeline({ delay: Math.random() * 0.35 })
        .to(p, { x: fromLeft ? W * (0.1 + Math.random() * 0.55) : W * (0.35 + Math.random() * 0.55),
          y: H * (0.05 + Math.random() * 0.3), rotation: '+=' + (360 + Math.random() * 540),
          duration: 0.9 + Math.random() * 0.4, ease: 'power2.out' })
        .to(p, { y: H + 40, x: '+=' + (Math.random() * 160 - 80), rotation: '+=' + (Math.random() * 720),
          duration: 1.8 + Math.random() * 1.2, ease: 'power1.in' });
    }
    setTimeout(() => box.remove(), 4200);
  },

  /* ============ reações e voz ============ */
  /** emoji de reação: pula, sobe balançando e some */
  reaction(el) {
    if (!ok()) return false;
    el.style.animation = 'none';
    const H = innerHeight;
    const sway = 30 + Math.random() * 40, dir = Math.random() < 0.5 ? -1 : 1;
    const tl = G().timeline({ onComplete: () => el.remove() });
    tl.fromTo(el, { y: 0, scale: 0.2, opacity: 0, rotation: -20 * dir },
      { y: -H * 0.14, scale: 1.25, opacity: 1, rotation: 10 * dir, duration: 0.45, ease: 'back.out(2.5)' })
      .to(el, { scale: 1, duration: 0.2 })
      .to(el, { y: -H * 0.8, duration: 2.4, ease: 'power1.in' }, 0.45)
      .to(el, { x: sway * dir, rotation: -8 * dir, duration: 0.6, ease: 'sine.inOut', yoyo: true, repeat: 3 }, 0.45)
      .to(el, { opacity: 0, duration: 0.6 }, 2.3);
    return true;
  },

  /** botão de reação: dá um pulo quando clicado */
  reactBtn(el) {
    if (!ok() || !el) return;
    G().fromTo(el, { scale: 1.6, rotation: -15 }, { scale: 1, rotation: 0, duration: 0.5, ease: 'elastic.out(1.2, 0.4)', clearProps: 'transform' });
  },

  /** microfone que pulsa com a voz (chamado a cada quadro com o volume de 0 a 1) */
  _q: new Map(),
  voice(el, level) {
    if (!el || !ok(true)) return;
    let q = anim._q.get(el);
    if (!q) {
      q = { s: G().quickTo(el, 'scale', { duration: 0.12, ease: 'power2.out' }),
            g: G().quickTo(el, '--glow', { duration: 0.15, ease: 'power2.out' }) };
      anim._q.set(el, q);
    }
    const l = Math.min(1, level * 1.4);
    q.s(1 + l * 0.45);
    q.g(l);
  },
};
