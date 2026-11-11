// Escolha do visual: "Novo" (bolhas + vidro líquido) ou "Clássico". Fica salvo no navegador.
import { startBubbles, stopBubbles, pauseBubbles, freezeBubbles, onSlow } from './bubbles.js?v=19';
import { enableLiquid, disableLiquid } from './liquid.js?v=19';

const btn = document.getElementById('btn-theme');
let theme = localStorage.getItem('ic-theme') === 'classic' ? 'classic' : 'new';

let lite = false;   // PC não aguentou o vidro líquido: fica só com o vidro normal (desde que abriu a página)

function apply() {
  document.documentElement.classList.toggle('theme-new', theme === 'new');
  if (theme === 'new') { startBubbles(); if (!lite) enableLiquid(); } else { stopBubbles(); disableLiquid(); }
  btn.textContent = theme === 'new' ? '🎨 Visual: Novo' : '🎨 Visual: Clássico';
  btn.title = theme === 'new' ? 'Trocar pro visual clássico' : 'Trocar pro visual novo';
}

btn.onclick = () => {
  theme = theme === 'new' ? 'classic' : 'new';
  localStorage.setItem('ic-theme', theme);
  apply();
};
apply();

// PC fraco: 1º desliga o vidro líquido (o que mais pesa); se ainda pesar, o fundo para de se mexer
onSlow((level) => {
  if (level === 1) { lite = true; disableLiquid(); }
  else { freezeBubbles(); document.documentElement.classList.add('still'); }
});

// durante a música (e ao ouvir a gravação) o vídeo cobre o fundo: pausa as bolhas
new MutationObserver(() => {
  const b = document.body.classList;
  pauseBubbles(b.contains('playing') || b.contains('replay'));
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });
