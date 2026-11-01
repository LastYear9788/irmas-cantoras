// Escolha do visual: "Novo" (bolhas + vidro líquido) ou "Clássico". Fica salvo no navegador.
import { startBubbles, stopBubbles } from './bubbles.js?v=14';
import { enableLiquid, disableLiquid } from './liquid.js?v=14';

const btn = document.getElementById('btn-theme');
let theme = localStorage.getItem('ic-theme') === 'classic' ? 'classic' : 'new';

function apply() {
  document.documentElement.classList.toggle('theme-new', theme === 'new');
  if (theme === 'new') { startBubbles(); enableLiquid(); } else { stopBubbles(); disableLiquid(); }
  btn.textContent = theme === 'new' ? '🎨 Visual: Novo' : '🎨 Visual: Clássico';
  btn.title = theme === 'new' ? 'Trocar pro visual clássico' : 'Trocar pro visual novo';
}

btn.onclick = () => {
  theme = theme === 'new' ? 'classic' : 'new';
  localStorage.setItem('ic-theme', theme);
  apply();
};
apply();
