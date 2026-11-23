// Escolha do visual: "Novo" (bolhas + vidro líquido) ou "Clássico", + controle do Modo Leve. Fica salvo no navegador.
import { startBubbles, stopBubbles, pauseBubbles, freezeBubbles, unfreezeBubbles, onSlow } from './bubbles.js?v=21';
import { enableLiquid, disableLiquid } from './liquid.js?v=21';

const btn = document.getElementById('btn-theme');
const btnLite = document.getElementById('btn-lite');
let theme = localStorage.getItem('ic-theme') === 'classic' ? 'classic' : 'new';

let lite = document.documentElement.classList.contains('lite');
const userForcedFull = () => { try { return localStorage.getItem('ic-lite') === '0'; } catch (e) { return false; } };

function renderLiteBtn() {
  if (!btnLite) return;
  btnLite.textContent = lite ? '⚡ Modo leve: Ligado' : '⚡ Modo leve';
  btnLite.title = lite ? 'Desligar modo leve (voltar efeitos completos)' : 'Ligar modo leve (menos efeitos, mais rápido em PC fraco)';
  btnLite.classList.toggle('is-on', lite);
}

// modo leve (PC fraco, detectado na hora ou escolhido manualmente): sem vidro líquido e fundo parado
const goLite = () => {
  lite = true;
  document.documentElement.classList.add('lite', 'still');
  disableLiquid();
  freezeBubbles();
  renderLiteBtn();
};

const exitLite = () => {
  lite = false;
  document.documentElement.classList.remove('lite', 'still');
  unfreezeBubbles();
  apply();
  renderLiteBtn();
};

addEventListener('ic-lite', goLite);

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

if (btnLite) {
  btnLite.onclick = () => {
    if (lite) {
      try { localStorage.setItem('ic-lite', '0'); } catch (e) { /* ok */ }
      exitLite();
    } else {
      try { localStorage.setItem('ic-lite', '1'); } catch (e) { /* ok */ }
      goLite();
    }
  };
}

apply();
renderLiteBtn();

// PC fraco: 1º desliga o vidro líquido (o que mais pesa); se ainda pesar, o fundo para de se mexer
// (respeita se o usuário desligou o modo leve manualmente)
onSlow((level) => {
  if (userForcedFull()) return;
  if (level === 1) { lite = true; disableLiquid(); renderLiteBtn(); }
  else {
    try { localStorage.setItem('ic-lite', '1'); } catch (e) { /* ok */ }
    goLite();
  }
});
if (lite) goLite();

// durante a música (e ao ouvir a gravação) o vídeo cobre o fundo: pausa as bolhas
new MutationObserver(() => {
  const b = document.body.classList;
  pauseBubbles(b.contains('playing') || b.contains('replay'));
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });
