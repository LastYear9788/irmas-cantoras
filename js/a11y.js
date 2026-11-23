// Acessibilidade das janelinhas (modais): o Tab fica dentro dela enquanto está aberta,
// o foco vai pra dentro ao abrir e volta pro botão que abriu ao fechar.

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const open = new Map();   // modal -> { back, onKey }

function visibleItems(modal) {
  return [...modal.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/** chama ao mostrar o modal. first = elemento que recebe o foco (senão o primeiro clicável) */
export function trapFocus(modal, first) {
  if (!modal || open.has(modal)) return;
  const back = document.activeElement;
  const onKey = (e) => {
    if (e.key !== 'Tab' || modal.classList.contains('hidden')) return;
    const items = visibleItems(modal);
    if (!items.length) return;
    const a = items[0], z = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === a || !modal.contains(document.activeElement))) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && (document.activeElement === z || !modal.contains(document.activeElement))) { e.preventDefault(); a.focus(); }
  };
  document.addEventListener('keydown', onKey);
  open.set(modal, { back, onKey });
  const target = first || visibleItems(modal)[0];
  if (target) setTimeout(() => { if (!modal.classList.contains('hidden')) target.focus({ preventScroll: true }); }, 0);
}

/** chama ao esconder o modal: devolve o foco pra onde estava */
export function releaseFocus(modal) {
  const st = open.get(modal);
  if (!st) return;
  open.delete(modal);
  document.removeEventListener('keydown', st.onKey);
  if (st.back && typeof st.back.focus === 'function' && document.contains(st.back) && st.back.offsetParent !== null) {
    st.back.focus({ preventScroll: true });
  }
}
