// Decide quem canta cada linha.
// Retorna um array do mesmo tamanho de `lines`: número da jogadora (0, 1, 2…) ou -1 = todas juntas.

export const ALL = -1;

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

export function assignParts(lines, mode, playerCount) {
  if (mode === 'together' || playerCount < 2) return lines.map(() => ALL);

  // linhas que se repetem na música (provavelmente refrão)
  const count = {};
  lines.forEach((ln) => { const k = norm(ln.text); count[k] = (count[k] || 0) + 1; });
  const rep = lines.map((ln) => count[norm(ln.text)] >= 2);

  // 1) agrupa em blocos: quebra em pausas > 3s, a cada 4 linhas, ou quando entra/sai do refrão
  const blocks = [];
  let cur = [];
  lines.forEach((ln, i) => {
    const gap = i > 0 ? ln.t - lines[i - 1].end : 0;
    if (cur.length && (gap > 3 || cur.length >= 4 || rep[i] !== rep[i - 1])) { blocks.push(cur); cur = []; }
    cur.push(i);
  });
  if (cur.length) blocks.push(cur);

  // 2) refrão = bloco de linhas repetidas -> todas juntas
  const isChorus = blocks.map((b) => rep[b[0]]);

  // se quase tudo virou refrão, ignora essa regra (senão ninguém canta sozinha)
  const solo = isChorus.filter((c) => !c).length;
  const useChorus = solo >= playerCount * 2;

  // 3) blocos de solo vão alternando entre as jogadoras
  const who = new Array(lines.length);
  let turn = 0;
  blocks.forEach((b, bi) => {
    const owner = useChorus && isChorus[bi] ? ALL : (turn++ % playerCount);
    b.forEach((i) => { who[i] = owner; });
  });
  return who;
}
