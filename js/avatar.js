// Bonequinha 3D fofinha que canta junto (uma por jogadora).
// Montada na hora com bolinhas e cilindros (sem modelo pra baixar) e sombreado de desenho (toon).
// A biblioteca 3D (three.js) só é carregada quando precisa: quem desliga as bonequinhas não paga nada.
// As partes "puras" (opções, limpeza do visual, vogal da sílaba) não usam navegador: dá pra testar no Node.

export const AV_OPTIONS = {
  hair: [['chanel', 'Chanel'], ['longo', 'Longo'], ['rabo', 'Rabo de cavalo'], ['chiquinha', 'Maria-chiquinha'], ['odango', 'Dois coquinhos'], ['coque', 'Coque alto'], ['cachos', 'Cachinhos'], ['curtinho', 'Curtinho']],
  bangs: [['franja', 'Franjinha'], ['lado', 'De lado'], ['sem', 'Sem franja']],
  hairColor: ['#4a2e22', '#1f1726', '#c4643a', '#f2cf7e', '#ff9ccd', '#b99cff', '#8fd0ff', '#9be6c8'],
  outfit: [['vestido', 'Vestido'], ['saia', 'Blusa + saia'], ['jardineira', 'Jardineira'], ['moletom', 'Moletom'], ['marinheira', 'Marinheira']],
  cloth: ['#ff8fc0', '#c3a6ff', '#8fe0c4', '#8ccaff', '#ffc38f', '#ffe27a', '#ffffff', '#5a4a7a'],
  skin: ['#ffe2cf', '#f6c9a7', '#dca47c', '#b57b55', '#7e5139'],
  eye: ['#5a3825', '#2b1d3a', '#3d6fd6', '#2f9e6b', '#8a5bd6', '#e0569b'],
  acc: [['laco', '🎀 Laço'], ['gatinho', '🐱 Orelhinha'], ['coroa', '👑 Coroa'], ['flor', '🌸 Flor'], ['estrela', '⭐ Presilha'], ['fone', '🎧 Fone'], ['nada', 'Nada']],
  accColor: ['#ff5fa2', '#ff9ccd', '#b79cff', '#7fdcbf', '#8ccaff', '#ffd56b', '#ffffff'],
};

export const AV_DEFAULT = {
  hair: 'chiquinha', bangs: 'franja', hairColor: '#4a2e22', outfit: 'vestido', main: '#ff8fc0', detail: '#ffffff',
  shoes: '#ff5fa2', skin: '#ffe2cf', eye: '#5a3825', blush: true, acc: 'laco', accColor: '#ff5fa2',
};

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const keys = (list) => list.map((x) => x[0]);
const oneOf = (v, list, dflt) => (list.includes(v) ? v : dflt);

/** visual que chegou da rede (ou do navegador) -> só valores conhecidos (nada de texto livre) */
export function sanitizeAvatar(x) {
  const o = x && typeof x === 'object' ? x : {};
  const O = AV_OPTIONS;
  return {
    hair: oneOf(o.hair, keys(O.hair), AV_DEFAULT.hair),
    bangs: oneOf(o.bangs, keys(O.bangs), AV_DEFAULT.bangs),
    hairColor: oneOf(o.hairColor, O.hairColor, AV_DEFAULT.hairColor),
    outfit: oneOf(o.outfit, keys(O.outfit), AV_DEFAULT.outfit),
    main: oneOf(o.main, O.cloth, AV_DEFAULT.main),
    detail: oneOf(o.detail, O.cloth, AV_DEFAULT.detail),
    shoes: oneOf(o.shoes, O.cloth, AV_DEFAULT.shoes),
    skin: oneOf(o.skin, O.skin, AV_DEFAULT.skin),
    eye: oneOf(o.eye, O.eye, AV_DEFAULT.eye),
    blush: o.blush !== false,
    acc: oneOf(o.acc, keys(O.acc), AV_DEFAULT.acc),
    accColor: oneOf(o.accColor, O.accColor, AV_DEFAULT.accColor),
  };
}

/** visual sorteado */
export function randomAvatar() {
  const O = AV_OPTIONS;
  return sanitizeAvatar({
    hair: pick(O.hair)[0], bangs: pick(O.bangs)[0], hairColor: pick(O.hairColor), outfit: pick(O.outfit)[0],
    main: pick(O.cloth), detail: pick(O.cloth), shoes: pick(O.cloth), skin: pick(O.skin), eye: pick(O.eye),
    blush: true, acc: pick(O.acc)[0], accColor: pick(O.accColor),
  });
}

/** visual guardado neste navegador */
const AV_KEY = 'ic-avatar';
export function loadMyAvatar() {
  try { const s = localStorage.getItem(AV_KEY); if (s) return sanitizeAvatar(JSON.parse(s)); } catch (e) { /* ok */ }
  return randomAvatar();   // 1ª vez: cada uma já começa com uma diferente
}
export function saveMyAvatar(cfg) { try { localStorage.setItem(AV_KEY, JSON.stringify(cfg)); } catch (e) { /* ok */ } }
export function avatarsEnabled() { try { return localStorage.getItem('ic-avatars') !== '0'; } catch (e) { return true; } }
export function setAvatarsEnabled(on) { try { localStorage.setItem('ic-avatars', on ? '1' : '0'); } catch (e) { /* ok */ } }

/**
 * Vogal da sílaba que está sendo cantada agora: progress = 0..1 dentro da linha.
 * (Divide a linha nos grupos de vogais, igual à contagem de sílabas da nota.)
 * Retorna { vowel: 'a'|'e'|'i'|'o'|'u', idx } — idx muda a cada sílaba (pra balançar no ritmo).
 */
export function vowelAt(text, progress) {
  const t = String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const re = /[aeiouy]+/g;
  const groups = [];
  let m;
  while ((m = re.exec(t))) groups.push(m);
  if (!groups.length) {
    // japonês/chinês/coreano: cada caractere é uma sílaba (a boca abre e fecha no ritmo)
    const cjk = String(text || '').match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g);
    if (!cjk) return { vowel: 'a', idx: 0 };
    const idx = Math.max(0, Math.min(cjk.length - 1, Math.floor((Number(progress) || 0) * cjk.length)));
    return { vowel: 'aoeai'[idx % 5], idx };
  }
  const idx = Math.max(0, Math.min(groups.length - 1, Math.floor((Number(progress) || 0) * groups.length)));
  const g = groups[idx];
  let v = g[0][0];
  // "que", "gui": o u não soa
  if (v === 'u' && g[0].length > 1 && /[qg]/.test(t[g.index - 1] || '')) v = g[0][1];
  if (v === 'y') v = 'i';
  return { vowel: v, idx };
}

/** carrega a biblioteca 3D (uma vez) */
let threeP = null;
export function loadThree(src) {
  if (typeof window === 'undefined') return Promise.reject(new Error('sem navegador'));
  if (window.THREE) return Promise.resolve(window.THREE);
  if (!threeP) {
    threeP = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => { if (window.THREE) resolve(window.THREE); else { threeP = null; reject(new Error('3D não carregou')); } };
      s.onerror = () => { threeP = null; reject(new Error('3D não carregou')); };
      document.head.appendChild(s);
    });
  }
  return threeP;
}

/* =====================================================================
   Montagem 3D (só roda no navegador, depois do loadThree)
   ===================================================================== */
let K = null;   // kit 3D (materiais/geometrias compartilhados)
let LO = false; // modo leve: bolinhas com menos detalhe
const q = (hi, lo) => (LO ? lo : hi);
function kit() {
  if (K) return K;
  const T = window.THREE;
  const grad = (() => { const d = new Uint8Array([158, 158, 158, 255, 196, 196, 196, 255, 232, 232, 232, 255, 252, 252, 252, 255]); const t = new T.DataTexture(d, 4, 1, T.RGBAFormat); t.minFilter = t.magFilter = T.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true; return t; })();
  const mats = new Map(), geos = new Map();
  const toon = (c, o = {}) => { const k = c + JSON.stringify(o); if (!mats.has(k)) mats.set(k, new T.MeshToonMaterial({ color: c, gradientMap: grad, ...o })); return mats.get(k); };
  const flat = (c, o = {}) => { const k = 'b' + c + JSON.stringify(o); if (!mats.has(k)) mats.set(k, new T.MeshBasicMaterial({ color: c, ...o })); return mats.get(k); };
  const geo = (k, make) => { k = (LO ? 'lo:' : '') + k; if (!geos.has(k)) geos.set(k, make()); return geos.get(k); };
  const SPH = () => geo('s', () => new T.SphereGeometry(1, q(40, 18), q(28, 12)));
  const SML = () => geo('sm', () => new T.SphereGeometry(1, q(18, 8), q(14, 6)));
  const CYL = () => geo('c', () => new T.CylinderGeometry(1, 1, 1, q(20, 8)));
  const CONE = () => geo('cone', () => new T.ConeGeometry(0.16, 0.38, q(16, 8)));
  const mesh = (g, m, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx) => { const o = new T.Mesh(g, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); return o; };
  const rx = (o, a) => { o.rotation.x = a; return o; };
  const shade = (hex, k) => { const c = new T.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); };
  const starShape = (r) => { const s = new T.Shape(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; if (i) s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); } return s; };
  const STAR = () => geo('star', () => { const g = new T.ExtrudeGeometry(starShape(1), { depth: 0.35, bevelEnabled: false }); g.center(); return g; });
  const blobTex = (color) => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 2, 32, 32, 30); g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new T.CanvasTexture(c);
  };
  const noteTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.font = '700 52px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineWidth = 8; x.strokeStyle = '#ffffff'; x.strokeText('♪', 32, 34); x.fillStyle = '#ff5fa2'; x.fillText('♪', 32, 34); return new T.CanvasTexture(c); })();
  K = { T, toon, flat, geo, SPH, SML, CYL, CONE, mesh, rx, shade, STAR, blobTex, noteTex };
  return K;
}

function buildHair(cfg, head) {
  const { T, toon, geo, SPH, SML, CONE, mesh, rx } = kit();
  const hm = toon(cfg.hairColor);
  const g = new T.Group(); const swing = [];
  head.add(g);
  const cap = mesh(geo('cap', () => new T.SphereGeometry(1.08, q(44, 20), q(24, 10), 0, Math.PI * 2, 0, Math.PI * 0.53)), hm);
  cap.rotation.x = -0.38; g.add(cap);
  if (cfg.hair !== 'curtinho' && cfg.hair !== 'cachos') g.add(mesh(geo('back', () => new T.SphereGeometry(1.1, q(44, 20), q(20, 8), Math.PI * 0.88, Math.PI * 1.24, Math.PI * 0.3, Math.PI * 0.5)), hm));
  if (cfg.bangs === 'franja') {
    for (let i = 0; i < 5; i++) {
      const x = -0.56 + i * 0.28, y = 0.48 - Math.abs(i - 2) * 0.03, z = Math.sqrt(Math.max(0, 1.12 - x * x - y * y));
      const b = mesh(SML(), hm, x, y, z - 0.08, 0.2, 0.27, 0.13); b.rotation.z = (2 - i) * 0.12; g.add(b);
    }
  } else if (cfg.bangs === 'lado') {
    const b = mesh(SML(), hm, -0.3, 0.52, 0.8, 0.62, 0.26, 0.18); b.rotation.z = -0.35; g.add(b);
    g.add(mesh(SML(), hm, 0.45, 0.62, 0.72, 0.3, 0.2, 0.16));
  }
  const sideLocks = (len) => [-1, 1].forEach((s) => g.add(mesh(SML(), hm, s * 0.98, -0.25 - len * 0.3, 0.18, 0.2, 0.45 + len * 0.3, 0.22)));
  const tail = (x, y, z, dir, n, r) => {
    const pivot = new T.Group(); pivot.position.set(x, y, z); g.add(pivot); swing.push(pivot);
    pivot.add(mesh(SML(), toon(cfg.accColor), 0, 0, 0, 0.13));
    let py = -0.1;
    for (let i = 0; i < n; i++) { const rr = r * (1 - i * 0.18); py -= rr * 1.25; pivot.add(mesh(SML(), hm, dir * (0.12 + i * 0.07), py, 0, rr, rr * 1.35, rr)); }
  };
  switch (cfg.hair) {
    case 'chanel': sideLocks(0.2); break;
    case 'longo':
      g.add(mesh(geo('long', () => new T.CylinderGeometry(0.98, 1.12, 1.7, q(36, 14), 1, true, Math.PI * 0.55, Math.PI * 0.9)), toon(cfg.hairColor, { side: T.DoubleSide }), 0, -0.95, 0));
      sideLocks(1.1); break;
    case 'rabo': sideLocks(0); tail(0, 0.5, -1.05, 0, 3, 0.36); break;
    case 'chiquinha': sideLocks(0); tail(-0.98, 0.35, -0.25, -1, 3, 0.3); tail(0.98, 0.35, -0.25, 1, 3, 0.3); break;
    case 'odango': sideLocks(0.1); [-1, 1].forEach((s) => { g.add(mesh(SPH(), hm, s * 0.62, 0.95, -0.15, 0.38)); g.add(mesh(SML(), toon(cfg.accColor), s * 0.5, 0.78, 0.05, 0.1)); }); break;
    case 'coque':
      sideLocks(0); g.add(mesh(SPH(), hm, 0, 1.18, -0.2, 0.46));
      g.add(rx(mesh(geo('ring', () => new T.TorusGeometry(0.4, 0.07, 8, 20)), toon(cfg.accColor), 0, 0.95, -0.16, 1), Math.PI / 2 - 0.2));
      break;
    case 'cachos':
      for (let i = 0; i < 46; i++) {
        const y = 1 - (i / 45) * 1.75, r = Math.sqrt(1 - Math.min(1, y * y)), a = i * 2.399;
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (z > 0.35 && y < 0.42 && y > -0.95) continue;   // deixa o rosto livre
        g.add(mesh(SML(), hm, x * 1.12, y * 1.05, z * 1.12, 0.3));
      }
      break;
    case 'curtinho':
      [-0.35, 0, 0.35].forEach((x) => { const t = mesh(CONE(), hm, x, 1.05, -0.05); t.rotation.z = -x * 0.9; t.rotation.x = -0.2; g.add(t); });
      break;
  }
  return swing;
}

function buildAcc(cfg, head) {
  const { T, toon, geo, SML, CYL, CONE, STAR, mesh, shade } = kit();
  const g = new T.Group(); head.add(g);
  const am = toon(cfg.accColor);
  if (cfg.acc === 'laco') {
    const b = new T.Group(); b.position.set(0.62, 0.92, 0.3); b.rotation.set(0.2, 0.4, -0.5); g.add(b);
    b.add(mesh(SML(), am, -0.22, 0, 0, 0.26, 0.19, 0.12)); b.add(mesh(SML(), am, 0.22, 0, 0, 0.26, 0.19, 0.12));
    b.add(mesh(SML(), toon(shade(cfg.accColor, 0.85)), 0, 0, 0.03, 0.09));
  } else if (cfg.acc === 'gatinho') {
    [-1, 1].forEach((s) => {
      const e = mesh(CONE(), toon(cfg.hairColor), s * 0.55, 1.0, 0, 1.5, 1.2, 1.1); e.rotation.z = -s * 0.5; g.add(e);
      const i = mesh(CONE(), toon('#ffb3d1'), s * 0.56, 0.98, 0.08, 0.9, 0.8, 0.6); i.rotation.z = -s * 0.5; g.add(i);
    });
  } else if (cfg.acc === 'coroa') {
    const c = new T.Group(); c.position.set(0, 1.12, -0.05); c.rotation.x = -0.2; g.add(c);
    c.add(mesh(geo('crown', () => new T.CylinderGeometry(0.36, 0.33, 0.16, 18, 1, true)), toon('#ffd56b', { side: T.DoubleSide })));
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; c.add(mesh(CONE(), toon('#ffd56b'), Math.cos(a) * 0.34, 0.15, Math.sin(a) * 0.34, 0.5)); }
    c.add(mesh(SML(), toon(cfg.accColor === '#ffd56b' ? '#ff5fa2' : cfg.accColor), 0, 0.02, 0.36, 0.06));
  } else if (cfg.acc === 'flor') {
    const f = new T.Group(); f.position.set(0.66, 0.75, 0.5); f.rotation.y = 0.6; g.add(f);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; f.add(mesh(SML(), am, Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0, 0.12, 0.12, 0.06)); }
    f.add(mesh(SML(), toon('#ffd56b'), 0, 0, 0.04, 0.08));
  } else if (cfg.acc === 'estrela') {
    const s = mesh(STAR(), toon(cfg.accColor), -0.62, 0.72, 0.56, 0.17); s.rotation.set(0, -0.6, 0.3); g.add(s);
  } else if (cfg.acc === 'fone') {
    g.add(mesh(geo('band', () => new T.TorusGeometry(1.12, 0.07, 8, 28, Math.PI)), am, 0, 0.05, -0.05));
    [-1, 1].forEach((s) => { const p = mesh(CYL(), am, s * 1.08, 0.02, 0, 0.26, 0.16, 0.26); p.rotation.z = Math.PI / 2; g.add(p); g.add(mesh(SML(), toon('#ffffff'), s * 1.18, 0.02, 0, 0.06, 0.18, 0.18)); });
  }
}

function buildOutfit(cfg, body) {
  const { T, toon, geo, SML, CYL, mesh, rx } = kit();
  const M = toon(cfg.main), D = toon(cfg.detail);
  const cone = (rt, rb, h) => geo(`k${rt}_${rb}_${h}`, () => new T.CylinderGeometry(rt, rb, h, q(32, 12)));
  switch (cfg.outfit) {
    case 'vestido':
      body.add(mesh(cone(0.36, 0.72, 0.85), M, 0, 0.7, 0));
      body.add(rx(mesh(geo('frill', () => new T.TorusGeometry(0.7, 0.06, 8, 48)), D, 0, 0.29, 0), Math.PI / 2));
      body.add(rx(mesh(geo('collar', () => new T.TorusGeometry(0.28, 0.07, 6, 20)), D, 0, 1.1, 0), Math.PI / 2));
      break;
    case 'saia':
      body.add(mesh(cone(0.36, 0.44, 0.46), M, 0, 0.92, 0));
      body.add(mesh(cone(0.42, 0.74, 0.42), D, 0, 0.53, 0));
      body.add(rx(mesh(geo('frill2', () => new T.TorusGeometry(0.72, 0.05, 8, 48)), M, 0, 0.33, 0), Math.PI / 2));
      break;
    case 'jardineira':
      body.add(mesh(cone(0.36, 0.46, 0.5), D, 0, 0.9, 0));
      body.add(mesh(cone(0.46, 0.56, 0.42), M, 0, 0.5, 0));
      body.add(mesh(geo('bib', () => new T.BoxGeometry(0.5, 0.36, 0.1)), M, 0, 0.86, 0.38));
      [-1, 1].forEach((s) => { body.add(mesh(geo('strap', () => new T.BoxGeometry(0.08, 0.36, 0.05)), M, s * 0.2, 1.04, 0.33)); body.add(mesh(SML(), toon('#ffd56b'), s * 0.18, 0.98, 0.44, 0.045)); });
      break;
    case 'moletom':
      body.add(mesh(cone(0.4, 0.52, 0.8), M, 0, 0.72, 0));
      body.add(rx(mesh(geo('hood', () => new T.TorusGeometry(0.34, 0.12, 8, 20)), M, 0, 1.12, -0.12), Math.PI / 2 - 0.4));
      body.add(mesh(geo('pocket', () => new T.BoxGeometry(0.46, 0.2, 0.08)), D, 0, 0.55, 0.47));
      [-1, 1].forEach((s) => body.add(mesh(CYL(), D, s * 0.1, 0.95, 0.4, 0.015, 0.25, 0.015)));
      break;
    case 'marinheira':
      body.add(mesh(cone(0.36, 0.48, 0.5), toon('#ffffff'), 0, 0.92, 0));
      body.add(mesh(cone(0.44, 0.74, 0.42), M, 0, 0.53, 0));
      body.add(rx(mesh(geo('sailor', () => new T.BoxGeometry(0.66, 0.06, 0.5)), M, 0, 1.12, -0.05), 0.25));
      body.add(mesh(SML(), toon(cfg.detail === '#ffffff' ? '#ff5fa2' : cfg.detail), 0, 1.0, 0.4, 0.12, 0.08, 0.06));
      break;
  }
}

function buildGirl(cfg, ringColor) {
  const { T, toon, flat, geo, SPH, SML, CYL, STAR, mesh, rx, shade, blobTex } = kit();
  const root = new T.Group();
  const shadow = new T.Mesh(geo('blob', () => new T.PlaneGeometry(1.9, 1.9)), new T.MeshBasicMaterial({ map: blobTex(ringColor || 'rgba(120,40,100,.4)'), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.01; root.add(shadow);
  const body = new T.Group(); root.add(body);
  const skin = toon(cfg.skin);
  [-1, 1].forEach((s) => { body.add(mesh(CYL(), skin, s * 0.17, 0.2, 0, 0.12, 0.36, 0.12)); body.add(mesh(SML(), toon(cfg.shoes), s * 0.18, 0.06, 0.06, 0.17, 0.11, 0.24)); });
  buildOutfit(cfg, body);
  const sleeve = toon(cfg.outfit === 'marinheira' ? '#ffffff' : cfg.outfit === 'jardineira' ? cfg.detail : cfg.main);
  const arms = [-1, 1].map((s) => {
    const a = new T.Group(); a.position.set(s * 0.4, 1.0, 0); body.add(a);
    a.add(mesh(SML(), sleeve, 0, -0.02, 0, 0.15));
    a.add(mesh(CYL(), skin, 0, -0.24, 0, 0.085, 0.38, 0.085));
    a.add(mesh(SML(), skin, 0, -0.45, 0, 0.11));
    a.rotation.z = s * 0.32;
    return a;
  });
  const mic = new T.Group(); mic.position.set(0, -0.46, 0); mic.rotation.x = 2.17; arms[1].add(mic);
  mic.add(mesh(CYL(), toon('#5b4a72'), 0, 0.16, 0, 0.045, 0.32, 0.045));
  mic.add(mesh(SML(), toon('#f2eef8'), 0, 0.37, 0, 0.12));
  mic.add(rx(mesh(geo('micring', () => new T.TorusGeometry(0.1, 0.025, 6, 16)), toon(cfg.accColor), 0, 0.3, 0, 1), Math.PI / 2));

  const head = new T.Group(); head.position.y = 2.0; body.add(head);
  head.add(mesh(SPH(), skin, 0, 0, 0, 1, 0.94, 0.98));
  [-1, 1].forEach((s) => head.add(mesh(SML(), skin, s * 0.97, -0.05, 0, 0.13, 0.17, 0.12)));
  const dark = toon('#2a1a33');
  const eyes = [-1, 1].map((s) => {
    const e = new T.Group(); e.position.set(s * 0.36, -0.04, 0.9); e.rotation.y = s * 0.37; head.add(e);
    const normal = new T.Group(); e.add(normal);
    normal.add(mesh(SML(), toon(cfg.eye), 0, 0, 0, 0.17, 0.22, 0.08));
    normal.add(mesh(SML(), dark, 0, -0.03, 0.035, 0.1, 0.13, 0.06));
    normal.add(mesh(SML(), flat('#ffffff'), 0.055, 0.085, 0.075, 0.058, 0.058, 0.03));
    normal.add(mesh(SML(), flat('#ffffff'), -0.05, -0.08, 0.07, 0.028, 0.028, 0.02));
    [0, 1].forEach((k) => { const l = mesh(CYL(), dark, s * (0.12 + k * 0.03), 0.17 - k * 0.06, 0.03, 0.014, 0.09, 0.014); l.rotation.z = s * (1.1 + k * 0.3); normal.add(l); });
    const happy = mesh(geo('arc', () => new T.TorusGeometry(0.1, 0.028, 6, 12, Math.PI)), dark, 0, -0.03, 0.05); e.add(happy);
    const star = mesh(STAR(), flat('#ffc93c'), 0, 0, 0.05, 0.19); e.add(star);
    const ops = new T.Group(); e.add(ops);
    const dir = s === -1 ? 1 : -1;
    [1, -1].forEach((k) => { const b = mesh(geo('bar', () => new T.BoxGeometry(0.17, 0.035, 0.03)), dark, 0, k * 0.04, 0.05); b.rotation.z = -k * dir * 0.45; ops.add(b); });
    return { normal, happy, star, ops };
  });
  const brows = [-1, 1].map((s) => { const b = mesh(CYL(), toon(shade(cfg.hairColor, 0.8)), s * 0.36, 0.3, 0.9, 0.022, 0.17, 0.022); b.rotation.z = Math.PI / 2; head.add(b); return b; });
  if (cfg.blush) [-1, 1].forEach((s) => head.add(mesh(SML(), toon('#ff8fb8', { transparent: true, opacity: 0.6 }), s * 0.6, -0.3, 0.75, 0.16, 0.09, 0.05)));
  const mouth = new T.Group(); mouth.position.set(0, -0.42, 0.89); mouth.rotation.x = 0.43; head.add(mouth);
  const inner = mesh(SML(), toon('#8a2a52'), 0, 0, 0, 0.12, 0.05, 0.05); mouth.add(inner);
  const tongue = mesh(SML(), toon('#ff8aa8'), 0, -0.04, 0.03, 0.07, 0.035, 0.03); mouth.add(tongue);
  const arcm = geo('arcm', () => new T.TorusGeometry(0.085, 0.022, 6, 12, Math.PI));
  const smile = mesh(arcm, toon('#8a2a52'), 0, 0.03, 0.01); smile.rotation.z = Math.PI; mouth.add(smile);
  const frown = mesh(arcm, toon('#8a2a52'), 0, -0.06, 0.01); mouth.add(frown);
  const swing = buildHair(cfg, head);
  buildAcc(cfg, head);
  const keep = new Set([shadow, inner, tongue, smile, frown, ...brows, ...eyes.flatMap((e) => [e.happy, e.star])]);
  const owned = mergeStatic(root, keep);
  return { root, body, head, arms, eyes, brows, inner, tongue, smile, frown, swing, shadow, owned };
}

/**
 * Junta as peças que não se mexem sozinhas (mesmo "pai" e mesma cor) numa peça só.
 * Cada bonequinha tem ~80 pecinhas; desenhar uma por uma pesa em PC fraco.
 * Depois de juntar ficam ~4x menos desenhos por quadro, com a mesma aparência.
 */
function mergeStatic(root, keep) {
  const T = window.THREE;
  const owned = [];
  const containers = [];
  root.traverse((o) => { if (!o.isMesh) containers.push(o); });
  containers.forEach((parent) => {
    const byMat = new Map();
    parent.children.forEach((c) => {
      if (!c.isMesh || keep.has(c) || c.children.length) return;
      if (!byMat.has(c.material)) byMat.set(c.material, []);
      byMat.get(c.material).push(c);
    });
    for (const [mat, list] of byMat) {
      if (list.length < 2) continue;
      const parts = list.map((m) => {
        m.updateMatrix();
        const g = m.geometry.clone();
        g.applyMatrix4(m.matrix);
        parent.remove(m);
        return g;
      });
      const nv = parts.reduce((n, g) => n + g.attributes.position.count, 0);
      const ni = parts.reduce((n, g) => n + (g.index ? g.index.count : g.attributes.position.count), 0);
      const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
      let vo = 0, io = 0;
      parts.forEach((g) => {
        pos.set(g.attributes.position.array, vo * 3);
        nor.set(g.attributes.normal.array, vo * 3);
        const cnt = g.attributes.position.count;
        if (g.index) { const src = g.index.array; for (let k = 0; k < src.length; k++) idx[io + k] = src[k] + vo; io += src.length; }
        else { for (let k = 0; k < cnt; k++) idx[io + k] = vo + k; io += cnt; }
        vo += cnt;
        g.dispose();
      });
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new T.BufferAttribute(nor, 3));
      geo.setIndex(new T.BufferAttribute(idx, 1));
      geo.computeBoundingSphere();
      parent.add(new T.Mesh(geo, mat));
      owned.push(geo);
    }
  });
  return owned;
}

const VOWEL = { a: [1.0, 1.0], e: [1.25, 0.55], i: [1.35, 0.36], o: [0.7, 0.9], u: [0.5, 0.65] };

/**
 * Um palco 3D num <canvas>.
 * mode 'game': várias bonequinhas na tela do jogo, cada uma no seu quadradinho (ao lado do cartão da
 *   letra ou nos cantos de baixo) e com a própria câmera de frente: sem a deformação de uma câmera larga.
 * mode 'preview': uma só, no provador.
 */
export class AvatarStage {
  constructor(canvas, { mode = 'game', lite = false } = {}) {
    const { T } = kit();
    this.T = T; this.canvas = canvas; this.mode = mode; this.lite = lite;
    this.renderer = new T.WebGLRenderer({ canvas, antialias: !lite, alpha: true, powerPreference: 'low-power' });
    this.renderer.setClearColor(0x000000, 0);
    if (mode === 'game') this.renderer.autoClear = false;
    this.anchor = null;      // (jogo) função que diz onde está o cartão da letra
    this.lastKey = '';
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(30, 2, 0.1, 100);
    this.scene.add(new T.HemisphereLight(0xffffff, 0xffd6ea, 0.62));
    const sun = new T.DirectionalLight(0xffffff, 0.42); sun.position.set(2, 6, 7); this.scene.add(sun);
    this.figs = [];
    this.fx = [];
    this.last = 0;
    this.reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.resize();
  }

  setLite(on) {
    if (this.lite === on) return;
    this.lite = on; this.resize();
    // no jogo, modo leve também troca as bonequinhas por versões com menos detalhe
    if (this.mode === 'game' && this.figs.length) { LO = on; this.figs.forEach((f, i) => { f.key = ''; this.setLook(i, f.cfg); }); LO = false; }
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setPixelRatio(this.lite ? 1 : Math.min(1.75, window.devicePixelRatio || 1));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.position.set(0, 2.1, 8.2); this.camera.lookAt(0, 1.6, 0);
    this.camera.updateProjectionMatrix();
    this.lastKey = '';
    this.rectsCache = null;
    this.layout();
  }

  /** (jogo) fn() -> retângulo do cartão da letra na tela (ou null) */
  setAnchor(fn) { this.anchor = fn; }

  /** no mundo 3D cada uma fica longe da outra: cada câmera só enxerga a sua */
  layout() {
    if (this.mode === 'preview') { this.figs.forEach((f) => { f.rig.root.position.x = 0; f.rig.root.rotation.y = 0.25; }); return; }
    this.figs.forEach((f) => { f.rig.root.position.x = f.slot * 14; });
  }

  /**
   * Quadradinho de cada uma na tela (px): eu à esquerda do cartão da letra, a 2ª à direita,
   * a 3ª e a 4ª um pouco atrás e menores. Sem espaço do lado da letra: cantos de baixo.
   */
  rects() {
    const W = this.canvas.clientWidth, Hs = this.canvas.clientHeight;
    let h = Math.max(200, Math.min(420, Hs * 0.36)), w = h * 0.72;
    const a = this.anchor ? this.anchor() : null;
    const card = a && a.card, right = Math.min(W, (a && a.right) || W);   // right: até onde dá (painel de emojis)
    let lx, rx, bottom;
    // cabe do lado da letra? (encolhe um pouco se precisar, mas não muito)
    const fit = card && card.width > 0 ? Math.min(w, card.left - 12, right - card.right - 12) : 0;
    if (fit >= 115) {
      w = fit; h = w / 0.72;
      lx = card.left - w - 6; rx = card.right + 6; bottom = Math.min(Hs - 70, card.bottom + h * 0.1);
    } else {
      lx = 12; rx = right - w - 8; bottom = Hs - 66;
    }
    return this.figs.map((f) => {
      const side = f.slot % 2 === 0 ? -1 : 1, back = f.slot >= 2;
      const k = back ? 0.8 : 1, ww = w * k, hh = h * k;
      let x = side < 0 ? lx : rx;
      if (back) x += side < 0 ? -ww * 0.62 : w - ww + ww * 0.62;
      x = Math.max(0, Math.min(right - ww, x));
      return { x: Math.round(x), y: Math.round(Math.max(4, bottom - hh)), w: Math.round(ww), h: Math.round(hh), side };
    });
  }

  /**
   * rects() mede a página (getBoundingClientRect força o navegador a recalcular o layout):
   * mede no máximo ~5x/s, e a altura vai deslizando — quando a letra quebra em 2 linhas
   * as bonequinhas descem suavemente em vez de dar um pulo.
   */
  placed(now, dt) {
    if (!this.rectsCache || this.rectsCache.length !== this.figs.length || now - this.rectsAt > 200 || now < this.rectsAt) {
      this.rectsCache = this.rects(); this.rectsAt = now;
    }
    const ys = this.shownY && this.shownY.length === this.rectsCache.length ? this.shownY : null;
    this.shownY = this.rectsCache.map((r, i) => (ys && Math.abs(ys[i] - r.y) < 400 ? ys[i] + (r.y - ys[i]) * Math.min(1, dt * 10) : r.y));
    return this.rectsCache.map((r, i) => ({ ...r, y: Math.round(this.shownY[i]) }));
  }

  /** list = [{ cfg, slot, color }] na ordem das jogadoras (índice = índice da jogadora) */
  setPlayers(list) {
    this.rectsCache = null; this.shownY = null;
    this.figs.forEach((f) => this.drop(f));
    this.figs = list.map((p) => this.makeFig(p));
    this.layout();
  }

  makeFig(p) {
    const cfg = sanitizeAvatar(p.cfg);
    LO = this.lite && this.mode === 'game';
    const rig = buildGirl(cfg, p.color ? hexA(p.color, 0.55) : null);
    LO = false;
    this.scene.add(rig.root);
    return { cfg, slot: p.slot || 0, color: p.color, rig, key: JSON.stringify(cfg), mouth: 0, mw: 1, mh: 1, brow: 0, tilt: 0, look: 0, bob: 0, bobV: 0, jump: 0, blink: 0, nextBlink: 1 + Math.random() * 3, mood: 'idle', moodT: 0, mic: 0, in: { singing: false, vol: 0, brow: 0, vowel: 'a', onset: false } };
  }

  /** troca o visual de uma (chegou pela rede / mudou no provador) */
  setLook(i, cfg) {
    const f = this.figs[i]; if (!f) return;
    const clean = sanitizeAvatar(cfg), key = JSON.stringify(clean);
    if (key === f.key) return;
    this.drop(f);
    const nf = this.makeFig({ cfg: clean, slot: f.slot, color: f.color });
    Object.assign(f, { cfg: nf.cfg, rig: nf.rig, key });
    this.layout();
  }

  drop(f) {
    this.scene.remove(f.rig.root);
    (f.rig.owned || []).forEach((g) => g.dispose());
    if (f.rig.shadow) { f.rig.shadow.material.map.dispose(); f.rig.shadow.material.dispose(); }
  }

  /** o que cada uma está fazendo agora: { singing, vol 0..1, brow -1..1, vowel, onset } */
  setInput(i, inp) {
    const f = this.figs[i]; if (!f) return;
    // "começou sílaba" fica guardado até o próximo quadro usar (no modo leve o quadro é mais lento
    // que as leituras, e o "false" da leitura seguinte apagava o "true" antes de a boneca pular)
    const keep = f.in.onset && inp.onset === false;
    Object.assign(f.in, inp);
    if (keep) f.in.onset = true;
  }

  react(i, kind) {
    const f = this.figs[i]; if (!f || !['perfect', 'good', 'miss'].includes(kind)) return;
    f.mood = kind; f.moodT = 1.8;
    if (kind === 'perfect') { f.jump = 1; if (!this.reduce) for (let n = 0; n < (this.lite ? 4 : 10); n++) this.spawn(f, 'star'); }
  }

  spawn(f, type) {
    const T = this.T, { mesh, STAR, flat, noteTex } = kit();
    if (this.fx.length > (this.lite ? 6 : 24)) return;
    const h = new T.Vector3(); f.rig.head.getWorldPosition(h);
    let o;
    const side = this.mode === 'game' ? -(f.side || -1) : 1;   // notinhas voam pro lado de dentro da tela
    if (type === 'note') { o = new T.Sprite(new T.SpriteMaterial({ map: noteTex, transparent: true, depthWrite: false })); o.scale.setScalar(0.45); o.position.set(h.x + side * 0.9, h.y + 0.2, h.z + 0.3); }
    else o = mesh(STAR(), flat('#ffc93c'), h.x, h.y + 1.1, h.z, 0.13);
    this.scene.add(o);
    const a = Math.random() * Math.PI * 2;
    this.fx.push({ o, type, t: 0, life: type === 'note' ? 1.6 : 1.0, vx: type === 'note' ? side * 0.25 + (Math.random() - 0.5) * 0.3 : Math.cos(a) * 2.2, vy: type === 'note' ? 0.9 : Math.sin(a) * 2 + 1.2 });
  }

  /** um quadro. now em ms. No modo leve desenha ~30x/s. */
  frame(now) {
    if (!this.last || now < this.last) this.last = now;
    const raw = (now - this.last) / 1000;
    const fps = this.mode === 'game' ? (this.lite ? 20 : 30) : (this.lite ? 30 : 60);
    if (raw < 1 / (fps + 2)) return;
    // palco escondido (janela estreita: o CSS some com as bonequinhas): não gasta placa de vídeo à toa
    if (this.mode === 'game' && !this.canvas.clientWidth) { this.last = now; this.shownY = null; return; }
    const t0 = performance.now();
    const dt = Math.min(0.05, raw); this.last = now;
    const t = now / 1000;
    const R = this.mode === 'game' ? this.placed(now, dt) : null;
    if (R) R.forEach((r, i) => { const f = this.figs[i]; f.side = r.side; f.sx = r.x + r.w / 2; f.rig.root.rotation.y = -r.side * 0.32; });
    // pra onde olha quem não está cantando: pra quem está
    const singerX = this.figs.filter((f) => f.in.singing).map((f) => (R ? f.sx : f.rig.root.position.x));
    this.figs.forEach((f, i) => this.animate(f, i, t, dt, singerX));
    this.stepFx(dt);
    if (!R) this.renderer.render(this.scene, this.camera);
    else {
      const rr = this.renderer, cam = this.camera, ch = this.canvas.clientHeight;
      const key = R.map((r) => `${r.x},${r.y},${r.w},${r.h}`).join('|');
      if (key !== this.lastKey) { this.lastKey = key; rr.setScissorTest(false); rr.clear(); }   // mudou de lugar: apaga tudo uma vez
      rr.setScissorTest(true);
      R.forEach((r, i) => {
        const vy = ch - r.y - r.h;
        rr.setViewport(r.x, vy, r.w, r.h); rr.setScissor(r.x, vy, r.w, r.h);
        rr.clear();
        const fx = this.figs[i].rig.root.position.x;
        cam.aspect = r.w / r.h; cam.position.set(fx, 2.05, 7.9); cam.lookAt(fx, 1.82, 0); cam.updateProjectionMatrix();
        rr.render(this.scene, cam);
      });
      rr.setScissorTest(false);
    }
    this.cost = (this.cost || 0) * 0.9 + (performance.now() - t0) * 0.1;   // ms por quadro (média)
  }

  animate(f, i, t, dt, singerX) {
    const R = f.rig, inp = f.in, singer = inp.singing;
    const v = singer ? inp.vol : 0;
    const target = v > 0.08 ? v : 0;
    f.mouth += (target - f.mouth) * Math.min(1, dt * (target > f.mouth ? 28 : 14));
    const [wv, hv] = VOWEL[inp.vowel] || VOWEL.a;
    f.mw += (wv - f.mw) * Math.min(1, dt * 16); f.mh += (hv - f.mh) * Math.min(1, dt * 16);
    const pn = singer && v > 0.08 ? Math.max(-1, Math.min(1, inp.brow || 0)) : 0;
    f.brow += (pn - f.brow) * Math.min(1, dt * 6);
    f.tilt += ((singer ? pn * 0.7 : Math.sin(t * 1.4 + i) * 0.4) - f.tilt) * Math.min(1, dt * 4);
    let lookT = 0;
    if (!singer && singerX.length) {
      const mx = this.mode === 'game' ? f.sx : R.root.position.x, k = this.mode === 'game' ? 0.003 : 0.15;
      const dx = singerX.reduce((a, b) => a + b, 0) / singerX.length - mx;
      lookT = Math.max(-0.6, Math.min(0.6, dx * k)) - R.root.rotation.y;
    }
    f.look += (lookT - f.look) * Math.min(1, dt * 4);
    if (!this.reduce) {
      if (singer && inp.onset && v > 0.2) f.bobV = -1;
      if (!singer) f.bobV += (Math.sin(t * 2.4 + i * 2) * 0.6 - f.bob) * 0.05;
      f.bob += (f.bobV - f.bob) * Math.min(1, dt * 12); f.bobV *= Math.pow(0.02, dt);
    }
    inp.onset = false;   // usado (ou perdeu a hora): não pula atrasado depois
    f.nextBlink -= dt; if (f.nextBlink <= 0) { f.blink = 1; f.nextBlink = 2 + Math.random() * 3; }
    f.blink = Math.max(0, f.blink - dt * 7);
    if (f.moodT > 0) { f.moodT -= dt; if (f.moodT <= 0) f.mood = 'idle'; }
    f.jump = Math.max(0, f.jump - dt * 1.5);
    f.mic += ((singer ? 1 : 0) - f.mic) * Math.min(1, dt * 7);
    if (!this.reduce && singer && v > 0.35 && Math.random() < dt * (this.lite ? 1.2 : 3)) this.spawn(f, 'note');

    R.body.position.y = Math.sin(Math.min(1, f.jump) * Math.PI) * 0.55 + f.bob * 0.06;
    R.body.scale.set(1 + f.bob * 0.03, 1 - f.bob * 0.04, 1 + f.bob * 0.03);
    R.head.rotation.z = f.tilt * 0.12; R.head.rotation.y = f.look; R.head.rotation.x = -f.brow * 0.08;
    R.arms[1].rotation.x = -1.25 * f.mic; R.arms[1].rotation.z = 0.32 - 0.62 * f.mic;
    R.arms[0].rotation.z = -0.32 - (f.mood === 'perfect' ? 1.9 * Math.min(1, f.moodT) : 0) + Math.sin(t * 2.4 + i) * 0.08;
    R.swing.forEach((p, k) => { p.rotation.z = Math.sin(t * 3 + k * 1.3) * 0.12 - f.bob * 0.15; p.rotation.x = Math.sin(t * 2.2 + k) * 0.06; });
    const mood = f.mood;
    R.eyes.forEach((e) => {
      e.normal.visible = mood === 'idle'; e.normal.scale.y = Math.max(0.08, 1 - f.blink);
      e.happy.visible = mood === 'good'; e.star.visible = mood === 'perfect'; e.ops.visible = mood === 'miss';
      if (mood === 'perfect') e.star.rotation.z = t * 3;
    });
    R.brows.forEach((b, k) => { const s = k ? 1 : -1; b.position.y = 0.3 + (mood === 'miss' ? -0.04 : f.brow * 0.07); b.rotation.z = Math.PI / 2 + (mood === 'miss' ? -s * 0.3 : s * f.brow * 0.18); });
    const open = f.mouth, isOpen = open >= 0.06;
    R.inner.visible = isOpen; R.tongue.visible = isOpen && open > 0.3;
    R.smile.visible = !isOpen && mood !== 'miss'; R.frown.visible = !isOpen && mood === 'miss';
    if (isOpen) {
      const sx = 0.12 * f.mw * (0.75 + open * 0.35), sy = 0.025 + 0.12 * f.mh * open;
      R.inner.scale.set(sx, sy, 0.05); R.tongue.position.y = -sy * 0.55; R.tongue.scale.set(sx * 0.6, sy * 0.35, 0.03);
    } else R.smile.scale.setScalar(mood === 'good' || mood === 'perfect' ? 1.3 : 1);
  }

  stepFx(dt) {
    for (let k = this.fx.length - 1; k >= 0; k--) {
      const p = this.fx[k]; p.t += dt;
      if (p.t > p.life) { this.scene.remove(p.o); if (p.type === 'note') p.o.material.dispose(); this.fx.splice(k, 1); continue; }
      p.o.position.x += p.vx * dt; p.o.position.y += p.vy * dt;
      const a = 1 - p.t / p.life;
      if (p.type === 'star') { p.vy -= 4 * dt; p.o.rotation.z += dt * 6; p.o.scale.setScalar(0.13 * (0.4 + a * 0.6)); }
      else p.o.material.opacity = a;
    }
  }

  /** gira devagarinho (provador) */
  spin(t) { this.figs.forEach((f) => { f.rig.root.rotation.y = 0.25 + Math.sin(t / 1600) * 0.45; }); }

  clear() {
    // as notinhas têm material próprio (as estrelas usam o do cache): libera da placa de vídeo
    this.fx.forEach((p) => { this.scene.remove(p.o); if (p.type === 'note') p.o.material.dispose(); });
    this.fx = [];
    this.renderer.setScissorTest(false); this.renderer.clear(); this.lastKey = '';
  }

  dispose() {
    this.clear();
    this.figs.forEach((f) => this.drop(f));
    this.figs = [];
    this.renderer.dispose();
    try { this.renderer.forceContextLoss(); } catch (e) { /* ok */ }
  }
}

function hexA(hex, a) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  if (!Number.isFinite(n)) return `rgba(120,40,100,${a})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
