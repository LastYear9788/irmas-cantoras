// Decide quem canta cada linha.
// Retorna um array do mesmo tamanho de `lines`: número da jogadora (0, 1, 2…) ou -1 = todas juntas.

export const ALL = -1;

// preserva qualquer alfabeto (latino, japonês, coreano, chinês, cirílico, grego…)
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim();

export function assignParts(lines, mode, playerCount) {
  if (mode === 'together' || playerCount < 2) return lines.map(() => ALL);

  // linhas que se repetem na música (provavelmente refrão)
  // Object.create(null): palavras como "constructor" ou "toString" não colidem com o protótipo
  const count = Object.create(null);
  const keys = lines.map((ln) => norm(ln.text));
  keys.forEach((k) => { if (k) count[k] = (count[k] || 0) + 1; });
  const rep = keys.map((k) => !!k && count[k] >= 2);

  // 1) agrupa primeiro em estrofes naturais (pausa > 3s ou entra/sai do refrão)
  const sections = [];
  let cur = [];
  lines.forEach((ln, i) => {
    const gap = i > 0 ? ln.t - lines[i - 1].end : 0;
    if (cur.length && (gap > 3 || rep[i] !== rep[i - 1])) { sections.push(cur); cur = []; }
    cur.push(i);
  });
  if (cur.length) sections.push(cur);

  // estrofe com mais de 4 linhas: divide em pedaços equilibrados (5 → 3+2, 6 → 3+3, em vez de 4+1)
  const blocks = [];
  sections.forEach((sec) => {
    const n = sec.length;
    if (n <= 4) { blocks.push(sec); return; }
    const k = Math.ceil(n / 4);
    let pos = 0;
    for (let c = 0; c < k; c++) {
      const len = Math.floor(n / k) + (c < n % k ? 1 : 0);
      blocks.push(sec.slice(pos, pos + len));
      pos += len;
    }
  });

  // 2) refrão = bloco de linhas repetidas -> todas juntas
  const isChorus = blocks.map((b) => rep[b[0]]);

  // se quase tudo virou refrão, ignora essa regra (senão ninguém canta sozinha)
  const solo = isChorus.filter((c) => !c).length;
  const useChorus = solo >= playerCount * 2;

  // 3) cada bloco de solo vai pra quem cantou MENOS linhas até agora (empate: a próxima da vez)
  const who = new Array(lines.length);
  const sung = new Array(playerCount).fill(0);
  let turn = 0;
  blocks.forEach((b, bi) => {
    let owner;
    if (useChorus && isChorus[bi]) owner = ALL;
    else {
      owner = turn % playerCount;
      for (let k = 1; k < playerCount; k++) {
        const c = (turn + k) % playerCount;
        if (sung[c] < sung[owner]) owner = c;
      }
      sung[owner] += b.length;
      turn = owner + 1;
    }
    b.forEach((i) => { who[i] = owner; });
  });
  return who;
}
