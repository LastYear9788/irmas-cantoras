// Calibração e diagnóstico do microfone (acessível na tela inicial e no lobby).
// Mede ruído ambiente + voz cantada, ajusta o VoiceGate pro microfone real da pessoa
// e detecta problemas comuns: mudo, conflito com Discord/Windows, driver travado,
// supressor de ruído externo (NVIDIA Broadcast/Krisp) e filtros do navegador cortando canto.
import { mic } from './mic.js?v=22';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const NOTE_NAMES = ['Dó', 'Dó#', 'Ré', 'Ré#', 'Mi', 'Fá', 'Fá#', 'Sol', 'Sol#', 'Lá', 'Lá#', 'Si'];
function freqToNote(hz) {
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  const oct = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${oct}`;
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

let open = false;
let raf = 0;
let testingHear = false;
let run = null;          // estado da calibração automática de 5s
let lastSummary = null;  // { status: 'ok' | 'warn' | 'bad', text }
let onStateChange = null;
let initialized = false;

export function isCalibrationOpen() { return open; }

export function initCalibration(cb) {
  if (initialized) return;
  initialized = true;
  onStateChange = cb || null;

  const modal = $('cal-modal');
  if (!modal) return;

  $('btn-home-cal').onclick = () => openCalibration();
  const lobbyBtn = $('btn-lobby-cal');
  if (lobbyBtn) lobbyBtn.onclick = () => openCalibration();

  $('cal-close').onclick = () => closeCalibration();
  $('cal-done').onclick = () => closeCalibration();
  modal.addEventListener('click', (e) => { if (e.target === modal) closeCalibration(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) closeCalibration(); });

  $('cal-device').onchange = async () => {
    const deviceId = $('cal-device').value;
    mic.setConfig({ deviceId });
    await connectAndRefresh(true);
  };

  $('cal-raw').onchange = async () => {
    const rawMode = $('cal-raw').checked;
    mic.setConfig({ rawMode });
    try { localStorage.setItem('ic-asked-phones', rawMode ? 'fone' : 'caixa'); } catch (e) { /* ok */ }
    await connectAndRefresh(true);
  };

  $('cal-restart').onclick = async () => {
    await connectAndRefresh(true);
  };

  $('cal-hear').onclick = () => {
    if (!mic.active) return;
    testingHear = !testingHear;
    mic.monitor(testingHear);
    renderHearBtn();
  };

  $('cal-run').onclick = () => startAutoCalibration();

  // ações rápidas dentro do checklist de diagnóstico
  $('cal-checks').addEventListener('click', async (e) => {
    const act = e.target.closest('[data-cal-act]');
    if (!act) return;
    const type = act.dataset.calAct;
    if (type === 'enable-raw') {
      $('cal-raw').checked = true;
      mic.setConfig({ rawMode: true });
      await connectAndRefresh(true);
      startAutoCalibration();
    } else if (type === 'disable-raw') {
      $('cal-raw').checked = false;
      mic.setConfig({ rawMode: false });
      await connectAndRefresh(true);
      startAutoCalibration();
    } else if (type === 'restart') {
      await connectAndRefresh(true);
    } else if (type === 'retry') {
      startAutoCalibration();
    }
  });

  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', () => {
      if (open) refreshDevices();
    });
  }

  renderBadges();
}

export async function openCalibration() {
  const modal = $('cal-modal');
  if (!modal) return;
  open = true;
  run = null;
  modal.classList.remove('hidden');

  const cfg = mic.getConfig();
  $('cal-raw').checked = !!cfg.rawMode;
  $('cal-progress-wrap').classList.add('hidden');
  $('cal-checks').innerHTML = '';
  $('cal-checks').classList.add('hidden');
  renderHearBtn();

  await connectAndRefresh(false);
  loop();
}

export function closeCalibration() {
  const modal = $('cal-modal');
  if (!modal || !open) return;
  open = false;
  run = null;
  cancelAnimationFrame(raf);
  if (testingHear) {
    testingHear = false;
    mic.monitor(false);
    renderHearBtn();
  }
  modal.classList.add('hidden');
  renderBadges();
  if (onStateChange) onStateChange();
}

function renderHearBtn() {
  const b = $('cal-hear');
  if (!b) return;
  b.textContent = testingHear ? '🎧 Ouvindo minha voz (parar)' : '🎧 Testar me ouvir';
  b.classList.toggle('is-on', testingHear);
  b.disabled = !mic.active;
}

async function refreshDevices() {
  const sel = $('cal-device');
  if (!sel) return;
  const devices = await mic.listDevices();
  const info = mic.info();
  const saved = mic.getConfig().deviceId;
  const currentId = saved || info.deviceId || '';
  const opts = ['<option value="">Padrão do sistema</option>'];
  devices.forEach((d, i) => {
    if (!d.deviceId || d.deviceId === 'default' || d.deviceId === 'communications') return;
    const name = d.label || `Microfone ${i + 1}`;
    const selected = d.deviceId === currentId ? ' selected' : '';
    opts.push(`<option value="${esc(d.deviceId)}"${selected}>${esc(name)}</option>`);
  });
  sel.innerHTML = opts.join('');
}

async function connectAndRefresh(forceRestart) {
  run = null;
  $('cal-progress-wrap').classList.add('hidden');
  $('cal-live-box').className = 'cal-live info';
  $('cal-live-text').textContent = 'Conectando ao microfone…';
  $('cal-run').disabled = true;
  $('cal-restart').disabled = true;
  try {
    const cfg = mic.getConfig();
    if (forceRestart && mic.active) await mic.restart({ deviceId: cfg.deviceId, rawMode: cfg.rawMode });
    else await mic.start({ deviceId: cfg.deviceId, rawMode: cfg.rawMode });
    await refreshDevices();
    renderTechMeta();
    $('cal-run').disabled = false;
    $('cal-hear').disabled = false;
    if (onStateChange) onStateChange();
  } catch (e) {
    $('cal-live-box').className = 'cal-live bad';
    $('cal-live-text').textContent = e.message || 'Não consegui acessar o microfone.';
    renderChecks([{
      level: 'bad',
      title: 'Microfone indisponível',
      detail: e.message || 'Não foi possível abrir o microfone.',
      action: { id: 'restart', label: '🔄 Tentar novamente' },
    }]);
    lastSummary = { status: 'bad', text: '⚠️ Microfone bloqueado ou em conflito' };
    renderBadges();
  }
  $('cal-restart').disabled = false;
  renderHearBtn();
}

function renderTechMeta() {
  const el = $('cal-meta');
  if (!el) return;
  if (!mic.active) { el.textContent = ''; return; }
  const info = mic.info();
  const parts = [];
  if (info.label) parts.push(info.label);
  if (info.sampleRate) parts.push(`${Math.round(info.sampleRate / 1000)} kHz`);
  parts.push(info.rawMode ? 'Modo fone (sem filtros)' : 'Modo normal');
  el.textContent = parts.join(' · ');
}

function startAutoCalibration() {
  if (!mic.active) return;
  $('cal-checks').classList.add('hidden');
  $('cal-checks').innerHTML = '';
  $('cal-progress-wrap').classList.remove('hidden');
  $('cal-run').disabled = true;
  run = {
    startedAt: performance.now(),
    quietMs: 2000,
    singMs: 3000,
    quietSamples: [],
    singSamples: [],
    dcMax: 0,
  };
}

function finishAutoCalibration(r) {
  run = null;
  $('cal-progress-wrap').classList.add('hidden');
  $('cal-run').disabled = false;

  const info = mic.info();
  const q = r.quietSamples;
  const s = r.singSamples;
  const checks = [];

  // "mudo" se decide SÓ pela etapa de canto: muito microfone (filtro do Windows/fone,
  // cancelamento de eco) manda zero absoluto enquanto a pessoa está quieta, e isso é normal
  const allPeaks = [...q, ...s].map((x) => x.peak);
  const maxPeak = allPeaks.length ? Math.max(...allPeaks) : 0;
  const singReal = s.filter((x) => x.peak >= 2e-6).length / Math.max(1, s.length);
  const singShare = (p) => s.filter((x) => x.problem === p).length / Math.max(1, s.length);
  const quietZero = q.length ? q.filter((x) => x.peak < 2e-6).length / q.length : 0;

  const floor = q.length ? percentile(q.map((x) => x.rms), 0.7) : info.floor;
  // ignora os primeiros 300ms da etapa de canto (tempo de reação da pessoa começar a cantar)
  const singActive = s.filter((x) => x.rel >= 300);
  const singRms = singActive.map((x) => x.rms);
  const voiceLevel = singRms.length ? percentile(singRms, 0.75) : 0;
  const voicePeakMax = singActive.length ? Math.max(...singActive.map((x) => x.peak)) : 0;
  const voicedFrames = singActive.filter((x) => x.voiced);
  const voicedRatio = voicedFrames.length / Math.max(1, singActive.length);
  const clarityAvg = voicedFrames.length ? voicedFrames.reduce((a, x) => a + x.clarity, 0) / voicedFrames.length : 0;
  const clipRatio = singActive.filter((x) => x.peak > 0.96).length / Math.max(1, singActive.length);

  // detecta corte abrupto no meio da nota sustentada (supressor de ruído / AEC / conflito)
  const early = singActive.filter((x) => x.rel >= 300 && x.rel <= 1350);
  const late = singActive.filter((x) => x.rel >= 1650);
  const earlyRms = early.length ? median(early.map((x) => x.rms)) : 0;
  const lateRms = late.length ? median(late.map((x) => x.rms)) : 0;
  const earlyVoiced = early.length ? early.filter((x) => x.voiced).length / early.length : 0;
  const lateVoiced = late.length ? late.filter((x) => x.voiced).length / late.length : 0;
  const dropOut = earlyRms > Math.max(0.01, floor * 2.2) && earlyVoiced >= 0.35
    && ((lateRms < earlyRms * 0.35) || (lateVoiced < 0.15 && lateRms < earlyRms * 0.55));

  // 1) Conflito / mudo / driver travado
  if (singShare('frozen') > 0.5) {
    checks.push({
      level: 'bad',
      title: 'Áudio do microfone travou (conflito de programa)',
      detail: 'O microfone parou de mandar áudio novo. Isso costuma acontecer quando Discord, Zoom ou o "Modo Exclusivo" do Windows trava o dispositivo. Tente reiniciar ou trocar o microfone acima.',
      action: { id: 'restart', label: '🔄 Reiniciar microfone' },
    });
  } else if (singShare('muted') > 0.5 || maxPeak === 0 || singReal < 0.1) {
    checks.push({
      level: 'bad',
      title: 'Microfone mudo ou sem sinal',
      detail: 'Chegou silêncio total. Confira o botão físico de mudo do fone, o volume no Windows, ou se outro programa (Discord/Zoom/WhatsApp) tomou o microfone no Modo Exclusivo.',
      action: { id: 'restart', label: '🔄 Reiniciar microfone' },
    });
  } else {
    checks.push({
      level: 'ok',
      title: 'Sinal do microfone chegando normalmente',
      detail: `${info.label || 'Microfone ativo'}${info.sampleRate ? ` (${Math.round(info.sampleRate / 1000)} kHz)` : ''}.`
        + (quietZero > 0.5 ? ' Ele zera o som quando você fica quieta (filtro do Windows/fone) — tudo bem, não atrapalha.' : ''),
    });
  }

  // 2) Bluetooth / taxa reduzida / webcam
  if (info.bluetooth) {
    checks.push({
      level: 'warn',
      title: 'Fone Bluetooth / modo chamada detectado',
      detail: 'Fones Bluetooth têm um pequeno atraso e às vezes reduzem a qualidade pra 16 kHz (principalmente com Discord aberto). O app já ativou tolerância extra de atraso e janela otimizada.',
    });
  } else if (/webcam|camera|integrated|internal|array|realtek/i.test(info.label) && $('cal-device').options.length > 2) {
    checks.push({
      level: 'warn',
      title: 'Parece ser microfone embutido / webcam',
      detail: 'Se você estiver de fone com microfone, escolha o microfone do fone no seletor lá em cima pra evitar eco e cortes.',
    });
  }

  // cantou/falou (ou tinha música tocando) na etapa do silêncio: o "ruído" medido é a própria voz,
  // então as contas de ruído e volume não valem. Avisa em vez de dizer "não ouvi voz".
  const quietVoiced = q.length ? q.filter((x) => x.voiced).length / q.length : 0;
  const noisyQuiet = maxPeak > 0 && quietVoiced > 0.25 && voiceLevel < floor * 1.5;
  if (noisyQuiet) {
    checks.push({
      level: 'warn',
      title: 'Ouvi voz ou música na etapa do silêncio',
      detail: 'Nos 2 primeiros segundos fique quietinha (e pause música/vídeo tocando na caixa de som) pra eu medir o ambiente. Seu microfone está funcionando — é só testar de novo.',
      action: { id: 'retry', label: '🔁 Calibrar de novo' },
    });
  }

  // 3) Ruído ambiente
  if (maxPeak > 0 && !noisyQuiet) {
    if (floor > 0.022) {
      checks.push({
        level: 'warn',
        title: 'Ruído de fundo alto',
        detail: 'Tem bastante barulho contínuo no ambiente (ventilador, ar, caixa de som). Chegue o microfone mais perto da boca e use fone de ouvido.',
      });
    } else {
      checks.push({
        level: 'ok',
        title: 'Ruído ambiente sob controle',
        detail: floor < 0.005 ? 'Ambiente bem silencioso!' : 'Ruído normal — calibramos o piso automaticamente.',
      });
    }
  }

  // 4) Corte no meio da nota sustentada (o clássico bug de voz "sumindo"!)
  if (dropOut) {
    if (!info.rawMode) {
      checks.push({
        level: 'warn',
        title: 'A voz começou bem e cortou no meio da nota!',
        detail: 'Os filtros automáticos do navegador (cancelamento de eco / ganho automático) provavelmente cortaram sua voz sustentada. Se você está de fone, ligue o Modo Fone e teste de novo.',
        action: { id: 'enable-raw', label: '🎧 Ligar Modo Fone e testar de novo' },
      });
    } else {
      checks.push({
        level: 'warn',
        title: 'A voz cortou no meio da nota sustentada',
        detail: 'Os filtros do navegador já estão desligados, então algum filtro FORA do navegador está cortando notas longas (NVIDIA Broadcast, Krisp, software do headset ou "Aprimoramentos de Áudio" nas Configurações de Som do Windows). Desative-o pra voz não sumir no meio da música.',
        action: { id: 'retry', label: '🔁 Testar de novo' },
      });
    }
  }

  // 5) Volume e reconhecimento da nota cantada
  if (maxPeak > 0 && !noisyQuiet) {
    if (voiceLevel < Math.max(0.006, floor * 1.5)) {
      checks.push({
        level: 'bad',
        title: 'Não ouvi voz suficiente na etapa de canto',
        detail: 'Fale/cante mais perto do microfone ou aumente o ganho dele no Windows. Se você ficou quieto sem querer, clique em testar de novo.',
        action: { id: 'retry', label: '🔁 Calibrar de novo' },
      });
    } else {
      // salva calibração adaptada pro microfone real!
      mic.applyCalibration({ floor, voice: voiceLevel, label: info.label });
      if (clipRatio > 0.25 || voicePeakMax > 0.98) {
        checks.push({
          level: 'warn',
          title: 'Microfone estourando (alto demais)',
          detail: 'Afaste um pouquinho o microfone ou abaixe o ganho no Windows pra voz não distorcer.',
        });
      } else if (voiceLevel < 0.015) {
        checks.push({
          level: 'warn',
          title: 'Microfone um pouco baixo (sensibilidade ajustada)',
          detail: 'Aumentamos a sensibilidade automaticamente pra sua voz continuar contando, mas se puder subir o volume do mic no Windows fica ainda melhor.',
        });
      }

      if (voicedRatio >= 0.55) {
        checks.push({
          level: 'ok',
          title: `Voz cantada reconhecida (${Math.round(voicedRatio * 100)}%)`,
          detail: clarityAvg >= 0.78
            ? 'Nota super limpa e estável! Seu microfone está calibrado e pronto pro duelo.'
            : 'Nota reconhecida direitinho! Calibração aplicada.',
        });
      } else if (!dropOut) {
        checks.push({
          level: 'warn',
          title: `Nota reconhecida em só ${Math.round(voicedRatio * 100)}% do teste`,
          detail: !info.rawMode
            ? 'O som chegou, mas falhou pra firmar a nota. Tente cantar um "Aaaa" mais firme ou ligar o Modo Fone (sem filtros do navegador).'
            : 'O som chegou, mas com pouca clareza de nota. Cante um "Aaaa" firme e verifique se não há eco/supressão de ruído externa (Windows/headset).',
          action: !info.rawMode ? { id: 'enable-raw', label: '🎧 Testar Modo Fone' } : { id: 'retry', label: '🔁 Testar de novo' },
        });
      }
    }
  }

  const hasBad = checks.some((c) => c.level === 'bad');
  const hasWarn = checks.some((c) => c.level === 'warn');
  lastSummary = hasBad
    ? { status: 'bad', text: '⚠️ Problema no microfone — toque pra revisar' }
    : hasWarn
      ? { status: 'warn', text: '⚠️ Microfone calibrado com avisos' }
      : { status: 'ok', text: `✅ Microfone calibrado (${shortLabel(info.label)})` };

  renderChecks(checks);
  renderBadges();
  if (onStateChange) onStateChange();
}

function shortLabel(label) {
  if (!label) return 'pronto';
  const clean = label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*/gi, '').trim();
  return clean.length > 22 ? clean.slice(0, 22) + '…' : clean;
}

function renderChecks(checks) {
  const box = $('cal-checks');
  if (!box) return;
  box.classList.remove('hidden');
  box.innerHTML = checks.map((c) => {
    const icon = c.level === 'ok' ? '✅' : c.level === 'warn' ? '⚠️' : '❌';
    const act = c.action ? `<button class="btn btn-small cal-act" data-cal-act="${esc(c.action.id)}">${esc(c.action.label)}</button>` : '';
    return `<div class="cal-check ${c.level}">
      <div class="cal-check-head"><span>${icon}</span><b>${esc(c.title)}</b></div>
      <p>${esc(c.detail)}</p>${act}
    </div>`;
  }).join('');
}

export function renderBadges() {
  const badge = $('cal-home-badge');
  const cfg = mic.getConfig();
  if (badge) {
    if (lastSummary) {
      badge.textContent = lastSummary.text;
      badge.className = 'cal-badge ' + lastSummary.status;
    } else if (mic.active && cfg.calibratedAt) {
      badge.textContent = `✅ Microfone calibrado (${shortLabel(mic.label() || cfg.calDevice)})`;
      badge.className = 'cal-badge ok';
    } else if (cfg.calibratedAt && cfg.calVoice) {
      badge.textContent = `✅ Calibração salva (${shortLabel(cfg.calDevice)})`;
      badge.className = 'cal-badge ok';
    } else {
      badge.textContent = 'Teste antes de começar pra evitar cortes na voz';
      badge.className = 'cal-badge';
    }
  }
  const lobbyBadge = $('cal-lobby-tag');
  if (lobbyBadge) {
    if (lastSummary && lastSummary.status === 'bad') {
      lobbyBadge.textContent = '⚠️ revisar mic';
      lobbyBadge.className = 'cal-tag bad';
    } else if (cfg.calibratedAt && cfg.calVoice) {
      lobbyBadge.textContent = cfg.rawMode ? '✓ calibrado · modo fone' : '✓ calibrado';
      lobbyBadge.className = 'cal-tag ok';
    } else {
      lobbyBadge.textContent = '';
      lobbyBadge.className = 'cal-tag';
    }
  }
}

function loop() {
  if (!open) return;
  raf = requestAnimationFrame(loop);
  if (!mic.active) return;

  const m = mic.read(true);
  const st = mic.status();
  const fill = $('cal-meter-fill');
  const mark = $('cal-meter-th');
  if (fill) fill.style.width = (m.level * 100).toFixed(1) + '%';
  if (mark) mark.style.left = Math.min(96, (Math.min(1, (m.threshold || 0.008) * 8) * 100)).toFixed(1) + '%';

  // etapa da calibração automática de 5s
  if (run) {
    const elapsed = performance.now() - run.startedAt;
    const total = run.quietMs + run.singMs;
    if (m.dc > run.dcMax) run.dcMax = m.dc;
    if (elapsed < run.quietMs) {
      run.quietSamples.push({ rms: m.rms, peak: m.peak, dc: m.dc, voiced: m.voiced });
      const left = Math.ceil((run.quietMs - elapsed) / 1000);
      $('cal-step-text').textContent = `1/2 · 🤫 Fique em silêncio (${left}s) — medindo ruído do ambiente…`;
      $('cal-progress-fill').style.width = ((elapsed / total) * 100).toFixed(1) + '%';
    } else if (elapsed < total) {
      const rel = elapsed - run.quietMs;
      run.singSamples.push({ rel, rms: m.rms, peak: m.peak, voiced: m.voiced, pitch: m.pitch, clarity: m.clarity, problem: st.problem });
      const left = Math.ceil((total - elapsed) / 1000);
      $('cal-step-text').textContent = `2/2 · 🎤 Cante um "Aaaaaaa" firme (${left}s)…`;
      $('cal-progress-fill').style.width = ((elapsed / total) * 100).toFixed(1) + '%';
    } else {
      finishAutoCalibration(run);
    }
  }

  // feedback ao vivo no modal
  const box = $('cal-live-box');
  const txt = $('cal-live-text');
  if (!box || !txt) return;
  if (st.problem === 'muted') {
    box.className = 'cal-live bad';
    txt.textContent = '🔇 Microfone no mudo (no Windows, botão do fone ou outro programa)';
  } else if (st.problem === 'silent') {
    box.className = 'cal-live bad';
    txt.textContent = '🔇 Nenhum som chegou ainda — fale algo; se continuar assim, confira o mudo do fone/Windows ou se Discord/Zoom pegou o microfone';
  } else if (st.problem === 'frozen') {
    box.className = 'cal-live bad';
    txt.textContent = '⚠️ Áudio travado (conflito de driver/programa) — clique em 🔄 Reiniciar';
  } else if (st.problem === 'suspended') {
    box.className = 'cal-live warn';
    txt.textContent = '🔈 Áudio pausado pelo navegador — clique em qualquer lugar da tela';
  } else if (m.peak > 0.97) {
    box.className = 'cal-live warn';
    txt.textContent = '📢 Alto demais (estourando) — afaste um pouco do microfone';
  } else if (m.voiced && m.pitch > 0) {
    box.className = 'cal-live ok';
    txt.textContent = `🎵 Nota reconhecida: ${freqToNote(m.pitch)} (${Math.round(m.pitch)} Hz) · Clareza ${Math.round(m.clarity * 100)}%`;
  } else if (m.loud) {
    box.className = 'cal-live info';
    txt.textContent = '🗣️ Som ouvido, mas sem nota cantada — solte a voz num "Aaaa"';
  } else {
    box.className = 'cal-live';
    txt.textContent = '🎤 Cante um "Aaaa" para testar o reconhecimento ao vivo';
  }
}
