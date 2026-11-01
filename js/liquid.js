// Visual novo: "Liquid Glass" de verdade nos cartões (só Chromium).
// Cada cartão ganha um filtro SVG próprio: a borda curva entorta o fundo como uma lente
// (lei de Snell num perfil "squircle") e uma linha de luz fina contorna o vidro.

const BEZEL = 34, THICK = 60, IOR = 1.5, MAX_SHIFT = 38, BLUR = 3, SATURATE = 1.5;
const LIGHT = Math.atan2(-1, -1);
const LX = Math.cos(LIGHT), LY = Math.sin(LIGHT);
const NS = 'http://www.w3.org/2000/svg';

let defs = null, svg = null, on = false, n = 0;
const watched = new Map();   // elemento -> { id, ro, timer, filter }

export function liquidSupported() {
  const brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
  return brands.some((b) => /Chromium/.test(b.brand)) && !matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// perfil da borda: quanto o fundo é puxado em cada ponto da curva (0..1)
const PROFILE = (() => {
  const N = 256, out = new Float32Array(N);
  let max = 0;
  for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N;
    const h = Math.pow(1 - Math.pow(1 - x, 4), 0.25);
    const dh = Math.pow(1 - Math.pow(1 - x, 4), -0.75) * Math.pow(1 - x, 3);
    const slope = dh * THICK / BEZEL;
    const a = Math.atan(slope);
    const b = Math.asin(Math.sin(a) / IOR);
    out[i] = Math.tan(a - b) * h * THICK;
    if (out[i] > max) max = out[i];
  }
  for (let i = 0; i < N; i++) out[i] /= max || 1;
  return out;
})();
const profile = (t) => PROFILE[Math.min(255, Math.max(0, Math.floor(t * 256)))];

// distância até a borda (pra dentro) e normal apontando pra fora, num retângulo arredondado
function edge(px, py, hw, hh, R) {
  const ax = Math.abs(px), ay = Math.abs(py);
  const qx = ax - (hw - R), qy = ay - (hh - R);
  const sx = px < 0 ? -1 : 1, sy = py < 0 ? -1 : 1;
  if (qx > 0 && qy > 0) {
    const l = Math.hypot(qx, qy) || 1;
    return { depth: R - l, nx: (qx / l) * sx, ny: (qy / l) * sy };
  }
  if (qx > qy) return { depth: R - qx, nx: sx, ny: 0 };
  return { depth: R - qy, nx: 0, ny: sy };
}

function displacementMap(w, h, R) {
  const cw = Math.max(1, Math.ceil(w / 2)), ch = Math.max(1, Math.ceil(h / 2));
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(cw, ch);
  const d = img.data;
  const hw = w / 2, hh = h / 2;
  for (let j = 0; j < ch; j++) {
    for (let i = 0; i < cw; i++) {
      const k = (j * cw + i) * 4;
      let dx = 0, dy = 0;
      const px = (i + 0.5) * 2 - hw, py = (j + 0.5) * 2 - hh;
      const e = edge(px, py, hw, hh, R);
      if (e.depth > 0 && e.depth < BEZEL) {
        const p = profile(e.depth / BEZEL);
        dx = -e.nx * p; dy = -e.ny * p;
      }
      d[k] = 128 + dx * 127; d[k + 1] = 128 + dy * 127; d[k + 2] = 128; d[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

function specularMap(w, h, R) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  const cw = Math.max(1, Math.ceil(w * dpr)), ch = Math.max(1, Math.ceil(h * dpr));
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(cw, ch);
  const d = img.data;
  const hw = w / 2, hh = h / 2, band = Math.ceil(16 * dpr) + 1;
  for (let j = 0; j < ch; j++) {
    const inBandY = j < band || j > ch - band - 1;
    for (let i = 0; i < cw; i++) {
      // longe da borda não tem brilho: pula o miolo (bem mais rápido)
      if (!inBandY && i >= band && i < cw - band) { i = cw - band - 1; continue; }
      const e = edge((i + 0.5) / dpr - hw, (j + 0.5) / dpr - hh, hw, hh, R);
      if (e.depth < 0 || e.depth > 16) continue;
      const dot = e.nx * LX + e.ny * LY;
      const face = Math.pow(Math.max(0, dot), 1.6) + 0.55 * Math.pow(Math.max(0, -dot), 2.2) + 0.12;
      const alpha = Math.min(1, (Math.exp(-e.depth / 0.9) * 0.95 + Math.exp(-e.depth / 5) * 0.35) * face);
      const k = (j * cw + i) * 4;
      d[k] = d[k + 1] = d[k + 2] = 255; d[k + 3] = alpha * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

function node(tag, attrs, parent) {
  const el = document.createElementNS(NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(el);
  return el;
}

function render(el) {
  const info = watched.get(el);
  if (!info || !on) return;
  const w = el.offsetWidth, h = el.offsetHeight;
  if (!w || !h) return;                              // tela escondida: faz quando aparecer
  if (info.w === w && info.h === h) return;
  info.w = w; info.h = h;
  const R = Math.min(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0, w / 2, h / 2);

  if (info.filter) info.filter.remove();
  const f = node('filter', {
    id: info.id, filterUnits: 'userSpaceOnUse', primitiveUnits: 'userSpaceOnUse',
    'color-interpolation-filters': 'sRGB', x: 0, y: 0, width: w, height: h,
  }, defs);
  node('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: BLUR, edgeMode: 'duplicate', result: 'blur' }, f);
  node('feImage', { href: displacementMap(w, h, R), x: 0, y: 0, width: w, height: h, preserveAspectRatio: 'none', result: 'map' }, f);
  node('feDisplacementMap', { in: 'blur', in2: 'map', scale: MAX_SHIFT * 2, xChannelSelector: 'R', yChannelSelector: 'G', result: 'bent' }, f);
  node('feColorMatrix', { in: 'bent', type: 'saturate', values: SATURATE, result: 'sat' }, f);
  const ct = node('feComponentTransfer', { in: 'sat', result: 'lit' }, f);
  for (const ch of ['R', 'G', 'B']) node('feFunc' + ch, { type: 'linear', slope: 1.06, intercept: 0.02 }, ct);
  node('feImage', { href: specularMap(w, h, R), x: 0, y: 0, width: w, height: h, preserveAspectRatio: 'none', result: 'spec' }, f);
  node('feComposite', { in: 'spec', in2: 'lit', operator: 'over' }, f);
  info.filter = f;

  // o Chrome só relê o filtro se ele "sumir" e voltar
  el.style.backdropFilter = 'none';
  void el.offsetWidth;
  el.style.backdropFilter = `url(#${info.id})`;
}

export function enableLiquid() {
  if (on || !liquidSupported()) return false;
  on = true;
  document.documentElement.classList.add('liquid-on');
  if (!svg) {
    svg = node('svg', { width: 0, height: 0, 'aria-hidden': 'true' });
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    defs = node('defs', {}, svg);
    document.body.appendChild(svg);
  }
  document.querySelectorAll('.liquid').forEach((el) => {
    const info = { id: 'lq' + (++n), timer: 0, filter: null, w: 0, h: 0 };
    info.ro = new ResizeObserver(() => { clearTimeout(info.timer); info.timer = setTimeout(() => render(el), 60); });
    info.ro.observe(el);
    watched.set(el, info);
    render(el);
  });
  return true;
}

export function disableLiquid() {
  if (!on) return;
  on = false;
  document.documentElement.classList.remove('liquid-on');
  for (const [el, info] of watched) {
    info.ro.disconnect();
    clearTimeout(info.timer);
    if (info.filter) info.filter.remove();
    el.style.backdropFilter = '';
  }
  watched.clear();
}
