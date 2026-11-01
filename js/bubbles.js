// Fundo do visual novo: bolhas coloridas que fogem do mouse, atrás de um vidro fosco.

const COLORS = ['255,95,162', '79,179,255', '155,92,255', '255,209,102', '124,242,154', '255,159,67', '0,229,255'];

let box = null, list = [], raf = 0, last = 0, running = false;
let W = 0, H = 0;
let paused = false, frozen = false;
// medidor de fôlego do PC: se ficar abaixo de ~45 quadros por segundo, avisa (modo leve)
let slowCb = null, perfStart = 0, perfSum = 0, perfN = 0, slowLevel = 0;
const mouse = { x: -1e4, y: -1e4, vx: 0, vy: 0, has: false };
let resizeT = 0;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function build() {
  box.innerHTML = '';
  W = innerWidth; H = innerHeight;
  const n = Math.max(8, Math.min(18, Math.round((W * H) / 90000)));
  const minSide = Math.min(W, H);
  list = [];
  for (let i = 0; i < n; i++) {
    const r = minSide * (0.09 + Math.random() * 0.13);
    const el = document.createElement('span');
    el.className = 'bubble';
    el.style.width = el.style.height = `${r * 2}px`;
    el.style.setProperty('--rgb', COLORS[i % COLORS.length]);
    box.appendChild(el);
    list.push({
      el, r, x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.5) * 0.6,
      phase: Math.random() * Math.PI * 2, hover: 0, squish: 0, lastH: -1,
    });
  }
  list.forEach(draw);
}

function draw(b) {
  const s = 1 + 0.15 * b.hover;
  const a = Math.atan2(b.vy, b.vx);
  const q = b.squish;
  b.el.style.transform = `translate3d(${(b.x - b.r).toFixed(1)}px,${(b.y - b.r).toFixed(1)}px,0) rotate(${a.toFixed(3)}rad) scale(${(s * (1 + q)).toFixed(3)},${(s * (1 - q * 0.7)).toFixed(3)}) rotate(${(-a).toFixed(3)}rad)`;
  if (Math.abs(b.hover - b.lastH) > 0.01) { b.lastH = b.hover; b.el.style.setProperty('--h', b.hover.toFixed(2)); }
}

function step(now) {
  if (!running) return;
  raf = requestAnimationFrame(step);
  const gap = last ? now - last : 16.7;
  const dt = Math.min(3, gap / (1000 / 60));
  last = now;
  checkPerf(now, gap);
  const fr = Math.pow(0.97, dt);

  for (const b of list) {
    // deriva suave
    b.vx += Math.cos(b.phase * 1.3) * 0.006 * dt;
    b.vy += Math.sin(b.phase) * 0.006 * dt;
    b.phase += 0.004 * dt;

    // mouse empurra
    let hoverTarget = 0;
    if (mouse.has) {
      const dx = b.x - mouse.x, dy = b.y - mouse.y;
      const d = Math.hypot(dx, dy) || 1;
      const reach = b.r + 140;
      if (d < reach) {
        const near = 1 - d / reach;
        const f = near * near * 0.9 * dt;
        b.vx += (dx / d) * f + mouse.vx * near * 0.02 * dt;
        b.vy += (dy / d) * f + mouse.vy * near * 0.02 * dt;
        hoverTarget = Math.min(1, near * 1.8);
      }
    }
    b.hover += (hoverTarget - b.hover) * Math.min(1, 0.08 * dt);
  }

  // bolhas se empurram
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], c = list[j];
      const dx = c.x - a.x, dy = c.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      const min = (a.r + c.r) * 0.85;
      if (d < min) {
        const f = ((min - d) / min) * 0.35 * dt;
        const ux = dx / d, uy = dy / d;
        a.vx -= ux * f; a.vy -= uy * f;
        c.vx += ux * f; c.vy += uy * f;
      }
    }
  }

  for (const b of list) {
    b.vx *= fr; b.vy *= fr;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > 9) { b.vx *= 9 / sp; b.vy *= 9 / sp; }
    b.x += b.vx * dt; b.y += b.vy * dt;

    // quica de leve nas bordas
    const m = b.r * 0.4;
    if (b.x < m) { b.x = m; b.vx = Math.abs(b.vx) * 0.6; }
    if (b.x > W - m) { b.x = W - m; b.vx = -Math.abs(b.vx) * 0.6; }
    if (b.y < m) { b.y = m; b.vy = Math.abs(b.vy) * 0.6; }
    if (b.y > H - m) { b.y = H - m; b.vy = -Math.abs(b.vy) * 0.6; }

    // gelatina
    const target = Math.min(0.22, Math.hypot(b.vx, b.vy) * 0.035);
    b.squish += (target - b.squish) * Math.min(1, 0.15 * dt);
    draw(b);
  }
  mouse.vx *= 0.85; mouse.vy *= 0.85;
}

function checkPerf(now, gap) {
  if (slowLevel >= 2 || !slowCb) return;
  if (!perfStart) { perfStart = now + 1200; return; }     // ignora o comecinho (carregando)
  if (now < perfStart || gap > 250) return;               // aba escondida / travada de propósito não conta
  perfSum += gap; perfN++;
  if (now - perfStart > 2000) {
    if (perfSum / perfN > 22) { slowLevel++; slowCb(slowLevel); }
    perfStart = now; perfSum = 0; perfN = 0;
  }
}

/** Chama fn(1) e depois fn(2) se o PC continuar sem dar conta da animação. */
export function onSlow(fn) { slowCb = fn; }

/** Pausa/volta a animação (durante a música o vídeo cobre tudo: não precisa gastar PC). */
export function pauseBubbles(p) {
  if (frozen) p = true;
  if (!running || paused === p || reduced()) { paused = p; return; }
  paused = p;
  if (p) cancelAnimationFrame(raf);
  else { last = 0; perfStart = 0; perfSum = 0; perfN = 0; raf = requestAnimationFrame(step); }
}

/** PC bem fraco: bolhas ficam paradas de vez. */
export function freezeBubbles() { pauseBubbles(true); frozen = true; }

function onMove(e) {
  if (e.pointerType === 'touch') return;
  if (mouse.has) { mouse.vx = e.clientX - mouse.x; mouse.vy = e.clientY - mouse.y; }
  mouse.x = e.clientX; mouse.y = e.clientY; mouse.has = true;
}
function onLeave() { mouse.has = false; }
function onDown(e) {
  if (e.pointerType !== 'touch') return;
  // toque no celular: empurrãozinho nas bolhas perto
  for (const b of list) {
    const dx = b.x - e.clientX, dy = b.y - e.clientY;
    const d = Math.hypot(dx, dy) || 1;
    const reach = b.r + 200;
    if (d < reach) {
      const near = 1 - d / reach;
      b.vx += (dx / d) * near * 7;
      b.vy += (dy / d) * near * 7;
      b.hover = Math.max(b.hover, near);
    }
  }
}
function onResize() {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { if (running) build(); }, 200);
}

export function startBubbles() {
  box = document.getElementById('bubbles');
  if (!box || running) return;
  running = true;
  build();
  addEventListener('resize', onResize);
  if (reduced()) return;   // menos movimento: só deixa as bolhas paradas
  addEventListener('pointermove', onMove, { passive: true });
  addEventListener('pointerdown', onDown, { passive: true });
  document.addEventListener('pointerleave', onLeave);
  last = 0; perfStart = 0;
  if (!paused) raf = requestAnimationFrame(step);
}

export function stopBubbles() {
  if (!running) return;
  running = false;
  cancelAnimationFrame(raf);
  removeEventListener('resize', onResize);
  removeEventListener('pointermove', onMove);
  removeEventListener('pointerdown', onDown);
  document.removeEventListener('pointerleave', onLeave);
  if (box) box.innerHTML = '';
  list = [];
}
