/* =========================================================================
   Painel ESP32 — protótipo de interface personalizável
   Cada porta (GPIO) recebe nome, tipo de equipamento, modo de controle e
   pode ser acionada individualmente. Configuração persistida no navegador.
   Contrato da API HTTP consumida: ver README.md
   ========================================================================= */

(() => {
  'use strict';

  const STORAGE_KEY = 'esp32-panel/v1';
  const POLL_MS = 4000;

  /* ---------------------------------------------------------------- tipos */

  const TYPES = [
    { id: 'lamp',     label: 'Lâmpada',              icon: '💡', mode: 'switch' },
    { id: 'ledstrip', label: 'Fita LED',             icon: '🌈', mode: 'dimmer' },
    { id: 'outlet',   label: 'Tomada',               icon: '🔌', mode: 'switch' },
    { id: 'fan',      label: 'Ventilador',           icon: '🌀', mode: 'dimmer' },
    { id: 'pump',     label: 'Bomba d\'água',        icon: '🚰', mode: 'switch' },
    { id: 'valve',    label: 'Válvula solenoide',    icon: '🚿', mode: 'switch' },
    { id: 'motor',    label: 'Motor',                icon: '⚙️', mode: 'dimmer' },
    { id: 'heater',   label: 'Aquecedor',            icon: '🔥', mode: 'switch' },
    { id: 'lock',     label: 'Fechadura elétrica',   icon: '🔒', mode: 'pulse'  },
    { id: 'gate',     label: 'Portão / cancela',     icon: '🚧', mode: 'pulse'  },
    { id: 'buzzer',   label: 'Sirene / buzzer',      icon: '🔔', mode: 'pulse'  },
    { id: 'temp',     label: 'Sensor de temperatura',icon: '🌡️', mode: 'sensor', unit: '°C' },
    { id: 'hum',      label: 'Sensor de umidade',    icon: '💧', mode: 'sensor', unit: '%'  },
    { id: 'lux',      label: 'Sensor de luz',        icon: '☀️', mode: 'sensor', unit: 'lx' },
    { id: 'presence', label: 'Sensor de presença',   icon: '🚶', mode: 'sensor', unit: ''   },
    { id: 'door',     label: 'Sensor de porta',      icon: '🚪', mode: 'sensor', unit: ''   },
    { id: 'generic',  label: 'Equipamento genérico', icon: '📦', mode: 'switch' },
  ];

  const typeOf = id => TYPES.find(t => t.id === id) || TYPES[TYPES.length - 1];

  const MODE_LABEL = {
    switch: 'Liga/Desliga',
    dimmer: 'Intensidade',
    pulse:  'Pulso',
    sensor: 'Leitura',
  };

  /* ------------------------------------------------------- configuração */

  const DEFAULT_PORTS = [
    { id: 'p1', name: 'Lâmpada da sala',    room: 'Sala',     type: 'lamp',     gpio: 2,  mode: 'switch', inverted: true,  value: 0 },
    { id: 'p2', name: 'Fita LED do balcão', room: 'Cozinha',  type: 'ledstrip', gpio: 4,  mode: 'dimmer', inverted: false, value: 0 },
    { id: 'p3', name: 'Ventilador de teto', room: 'Quarto',   type: 'fan',      gpio: 5,  mode: 'dimmer', inverted: false, value: 0 },
    { id: 'p4', name: 'Bomba da irrigação', room: 'Jardim',   type: 'pump',     gpio: 18, mode: 'switch', inverted: true,  value: 0 },
    { id: 'p5', name: 'Portão da garagem',  room: 'Garagem',  type: 'gate',     gpio: 19, mode: 'pulse',  inverted: false, value: 0, pulse: 800 },
    { id: 'p6', name: 'Temperatura externa',room: 'Varanda',  type: 'temp',     gpio: 34, mode: 'sensor', inverted: false, value: 24.5, unit: '°C' },
  ];

  const state = {
    host: '',
    demo: true,
    connected: false,
    ports: [],
    filter: '',
    editing: null,
  };

  const load = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (raw && Array.isArray(raw.ports)) {
        state.host = raw.host || '';
        state.demo = raw.demo !== false;
        state.ports = raw.ports;
        return;
      }
    } catch (_) { /* configuração corrompida: cai no padrão */ }
    state.ports = structuredClone(DEFAULT_PORTS);
  };

  const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify({
    host: state.host, demo: state.demo, ports: state.ports,
  }));

  /* ------------------------------------------------------------- helpers */

  const $  = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const uid = () => 'p' + Math.random().toString(36).slice(2, 9);

  const esc = s => String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  let toastTimer;
  function toast(msg, isError = false) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('err', isError);
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function log(msg, kind = '') {
    const li = document.createElement('li');
    const t = new Date().toLocaleTimeString('pt-BR');
    li.innerHTML = `<time>${t}</time><span class="${kind}">${esc(msg)}</span>`;
    const list = $('#log');
    list.prepend(li);
    while (list.children.length > 60) list.lastElementChild.remove();
  }

  /* ------------------------------------------------- camada de transporte */

  const baseUrl = () => {
    let h = state.host.trim();
    if (!h) return '';
    if (!/^https?:\/\//i.test(h)) h = 'http://' + h;
    return h.replace(/\/+$/, '');
  };

  async function request(path, options = {}) {
    if (state.demo) return demoRequest(path, options);

    const url = baseUrl() + path;
    if (!baseUrl()) throw new Error('Endereço do ESP32 não informado');

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(url, { ...options, signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      throw new Error(err.name === 'AbortError' ? 'tempo esgotado' : err.message);
    } finally {
      clearTimeout(timer);
    }
  }

  const getStatus = () => request('/api/status');

  const setPort = port => request('/api/port', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      gpio: port.gpio,
      mode: port.mode,
      value: port.value,
      inverted: !!port.inverted,
      pulse: port.pulse || 500,
    }),
  });

  /* ------------------------------------------- simulador (modo demo) ---- */

  const demoBoot = Date.now();

  function demoRequest(path, options) {
    return new Promise(resolve => setTimeout(() => {
      if (path === '/api/status') {
        const ports = {};
        state.ports.forEach(p => {
          if (p.mode === 'sensor') ports[p.gpio] = driftSensor(p);
          else ports[p.gpio] = p.value;
        });
        resolve({
          device: 'ESP32-DevKitC (demo)',
          ip: state.host.trim() || '192.168.0.50',
          rssi: -52 - Math.round(Math.random() * 12),
          uptime: Math.floor((Date.now() - demoBoot) / 1000),
          ports,
        });
      } else {
        const body = JSON.parse(options.body);
        resolve({ ok: true, gpio: body.gpio, value: body.value });
      }
    }, 120 + Math.random() * 180));
  }

  function driftSensor(p) {
    const t = typeOf(p.type);
    if (t.id === 'presence' || t.id === 'door') return Math.random() > 0.85 ? 1 : 0;
    const base = Number(p.value) || (t.id === 'lux' ? 420 : 24);
    const span = t.id === 'lux' ? 40 : 0.6;
    const next = base + (Math.random() - 0.5) * span;
    return Math.round(next * 10) / 10;
  }

  /* ------------------------------------------------------------ render */

  function render() {
    const grid = $('#grid');
    const q = state.filter.toLowerCase();

    const visible = state.ports.filter(p =>
      !q ||
      p.name.toLowerCase().includes(q) ||
      (p.room || '').toLowerCase().includes(q) ||
      typeOf(p.type).label.toLowerCase().includes(q) ||
      String(p.gpio) === q ||
      ('gpio' + p.gpio).includes(q)
    );

    grid.innerHTML = visible.map(cardHtml).join('');
    $('#empty').hidden = visible.length > 0 || state.ports.length === 0;
    bindCards();
    updateSummary();
  }

  function cardHtml(p) {
    const t = typeOf(p.type);
    const isSensor = p.mode === 'sensor';
    const on = !isSensor && Number(p.value) > 0;

    return `
    <article class="card ${on ? 'is-on' : ''} ${isSensor ? 'is-sensor' : ''}" data-id="${p.id}">
      <div class="card-head">
        <div class="icon">${t.icon}</div>
        <div class="card-title">
          <h3>${esc(p.name)}</h3>
          <p>${esc(t.label)}${p.room ? ' · ' + esc(p.room) : ''}</p>
          <p style="margin-top:6px">
            <span class="tag tag--gpio">GPIO ${p.gpio}</span>
            <span class="tag">${MODE_LABEL[p.mode]}</span>
            ${p.inverted && !isSensor ? '<span class="tag tag--inv">Invertida</span>' : ''}
          </p>
        </div>
        <button class="icon-btn" data-edit="${p.id}" type="button"
                title="Configurar porta" aria-label="Configurar ${esc(p.name)}">⚙</button>
      </div>
      <div class="card-body">${controlHtml(p, on)}</div>
    </article>`;
  }

  function controlHtml(p, on) {
    const t = typeOf(p.type);

    if (p.mode === 'sensor') {
      const unit = p.unit ?? t.unit ?? '';
      const isBinary = t.id === 'presence' || t.id === 'door';
      const txt = isBinary
        ? (Number(p.value) > 0 ? (t.id === 'door' ? 'Aberta' : 'Detectado') : (t.id === 'door' ? 'Fechada' : 'Livre'))
        : `${p.value}<small>${esc(unit)}</small>`;
      return `<div class="reading">${txt}</div>
              <div class="state-label">Atualizado automaticamente</div>`;
    }

    if (p.mode === 'pulse') {
      return `<div class="state-line">
                <span class="state-label">Acionamento momentâneo</span>
                <span class="state-value">${p.pulse || 500} ms</span>
              </div>
              <button class="btn btn-primary pulse-btn" data-pulse="${p.id}" type="button">Acionar</button>`;
    }

    const pct = p.mode === 'dimmer' ? clamp(Number(p.value) || 0, 0, 100) : (on ? 100 : 0);

    return `
      <div class="state-line">
        <span class="state-value">${on ? 'Ligado' : 'Desligado'}</span>
        <label class="toggle">
          <input type="checkbox" data-toggle="${p.id}" ${on ? 'checked' : ''}
                 aria-label="Ligar ou desligar ${esc(p.name)}">
          <span class="slider"></span>
        </label>
      </div>
      ${p.mode === 'dimmer' ? `
      <div class="range">
        <input type="range" min="0" max="100" step="1" value="${pct}" data-range="${p.id}"
               aria-label="Intensidade de ${esc(p.name)}">
        <output>${pct}%</output>
      </div>` : ''}`;
  }

  function bindCards() {
    $$('[data-edit]').forEach(b => b.onclick = () => openDialog(b.dataset.edit));

    $$('[data-toggle]').forEach(input => {
      input.onchange = () => {
        const p = find(input.dataset.toggle);
        p.value = input.checked ? (p.mode === 'dimmer' ? (p.lastLevel || 100) : 1) : 0;
        commit(p, `${p.name}: ${input.checked ? 'ligado' : 'desligado'}`);
      };
    });

    $$('[data-range]').forEach(input => {
      const out = input.nextElementSibling;
      input.oninput = () => { out.textContent = input.value + '%'; };
      input.onchange = () => {
        const p = find(input.dataset.range);
        p.value = Number(input.value);
        if (p.value > 0) p.lastLevel = p.value;
        commit(p, `${p.name}: intensidade ${p.value}%`);
      };
    });

    $$('[data-pulse]').forEach(btn => {
      btn.onclick = async () => {
        const p = find(btn.dataset.pulse);
        btn.disabled = true;
        p.value = 1;
        await commit(p, `${p.name}: pulso de ${p.pulse || 500} ms`, false);
        setTimeout(() => { p.value = 0; btn.disabled = false; }, p.pulse || 500);
      };
    });
  }

  const find = id => state.ports.find(p => p.id === id);

  async function commit(port, message, rerender = true) {
    save();
    if (rerender) render();
    try {
      await setPort(port);
      log(message, 'ok');
    } catch (err) {
      log(`${port.name}: falha ao enviar comando (${err.message})`, 'err');
      toast(`Falha ao comandar "${port.name}": ${err.message}`, true);
      setStatus('err', 'Erro de comunicação');
    }
  }

  function updateSummary() {
    const controllable = state.ports.filter(p => p.mode !== 'sensor');
    const on = controllable.filter(p => Number(p.value) > 0).length;
    $('#info-on').textContent = `${on} / ${controllable.length}`;
  }

  function setStatus(kind, text) {
    const el = $('#status');
    el.className = 'status status--' + kind;
    $('#status-text').textContent = text;
  }

  const fmtUptime = s => {
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600);
    const m = Math.floor(s % 3600 / 60), sec = s % 60;
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}min`;
    return m ? `${m}min ${sec}s` : `${sec}s`;
  };

  /* --------------------------------------------------------- polling */

  let pollTimer = null;

  async function poll() {
    try {
      const st = await getStatus();
      state.connected = true;
      setStatus(state.demo ? 'demo' : 'on', state.demo ? 'Modo demo' : 'Conectado');

      $('#info-device').textContent = st.device || 'ESP32';
      $('#info-ip').textContent = st.ip || baseUrl().replace(/^https?:\/\//, '') || '—';
      $('#info-rssi').textContent = st.rssi != null ? `${st.rssi} dBm` : '—';
      $('#info-uptime').textContent = st.uptime != null ? fmtUptime(st.uptime) : '—';

      // O ESP32 é a fonte da verdade: reflete o estado real dos pinos.
      if (st.ports) {
        let changed = false;
        state.ports.forEach(p => {
          const v = st.ports[p.gpio] ?? st.ports[String(p.gpio)];
          if (v != null && v !== p.value) { p.value = v; changed = true; }
        });
        if (changed) render();
      }
    } catch (err) {
      if (state.connected) log(`Conexão perdida: ${err.message}`, 'err');
      state.connected = false;
      setStatus('err', 'Sem resposta');
      $('#info-device').textContent = '—';
      $('#info-rssi').textContent = '—';
      $('#info-uptime').textContent = '—';
    }
  }

  function startPolling() {
    clearInterval(pollTimer);
    poll();
    pollTimer = setInterval(poll, POLL_MS);
  }

  /* ----------------------------------------------------------- modal */

  const dlg = $('#dlg');

  function buildTypeOptions() {
    $('#f-type').innerHTML = TYPES
      .map(t => `<option value="${t.id}">${t.icon}  ${esc(t.label)}</option>`)
      .join('');
  }

  function syncModeFields() {
    const mode = $('#f-mode').value;
    $$('[data-when]').forEach(el => {
      el.hidden = !el.dataset.when.split(' ').includes(mode);
    });
    checkGpio();
  }

  function checkGpio() {
    const gpio = Number($('#f-gpio').value);
    const mode = $('#f-mode').value;
    const hint = $('#gpio-hint');
    hint.className = 'hint';
    hint.textContent = '';

    if (Number.isNaN(gpio) || $('#f-gpio').value === '') return;

    const used = state.ports.find(p => p.gpio === gpio && p.id !== state.editing);
    if (used) {
      hint.textContent = `GPIO já usado por "${used.name}".`;
      hint.classList.add('warn');
    } else if (gpio >= 6 && gpio <= 11) {
      hint.textContent = 'GPIO 6–11 ligado à memória flash: não utilizar.';
      hint.classList.add('warn');
    } else if (gpio >= 34 && gpio <= 39 && mode !== 'sensor') {
      hint.textContent = 'GPIO 34–39 é somente entrada: use o modo Sensor.';
      hint.classList.add('warn');
    } else if ([0, 2, 12, 15].includes(gpio) && mode !== 'sensor') {
      hint.textContent = 'Pino de boot (strapping): pode afetar a inicialização.';
      hint.classList.add('warn');
    }
  }

  function openDialog(id) {
    state.editing = id || null;
    const p = id ? find(id) : null;

    $('#dlg-title').textContent = p ? 'Configurar porta' : 'Nova porta';
    $('#f-name').value = p?.name || '';
    $('#f-room').value = p?.room || '';
    $('#f-type').value = p?.type || 'lamp';
    $('#f-gpio').value = p ? p.gpio : nextFreeGpio();
    $('#f-mode').value = p?.mode || typeOf(p?.type || 'lamp').mode;
    $('#f-pulse').value = p?.pulse || 500;
    $('#f-unit').value = p?.unit ?? typeOf(p?.type || 'lamp').unit ?? '';
    $('#f-inverted').checked = !!p?.inverted;
    $('#f-delete').hidden = !p;

    syncModeFields();
    dlg.showModal();
    $('#f-name').focus();
  }

  function nextFreeGpio() {
    const used = new Set(state.ports.map(p => p.gpio));
    const candidates = [2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33];
    return candidates.find(g => !used.has(g)) ?? 2;
  }

  function submitDialog(ev) {
    ev.preventDefault();
    const mode = $('#f-mode').value;
    const type = $('#f-type').value;

    const data = {
      name: $('#f-name').value.trim() || 'Sem nome',
      room: $('#f-room').value.trim(),
      type,
      gpio: clamp(Number($('#f-gpio').value), 0, 39),
      mode,
      inverted: mode !== 'sensor' && $('#f-inverted').checked,
      pulse: mode === 'pulse' ? clamp(Number($('#f-pulse').value) || 500, 50, 10000) : undefined,
      unit: mode === 'sensor' ? ($('#f-unit').value.trim() || typeOf(type).unit || '') : undefined,
    };

    if (state.editing) {
      const p = find(state.editing);
      // Trocar o modo invalida o valor anterior (0–1 vs 0–100 vs leitura).
      if (p.mode !== data.mode) p.value = 0;
      Object.assign(p, data);
      log(`Porta reconfigurada: ${p.name} (GPIO ${p.gpio})`);
    } else {
      state.ports.push({ id: uid(), value: 0, ...data });
      log(`Porta adicionada: ${data.name} (GPIO ${data.gpio})`);
    }

    save();
    render();
    dlg.close();
    toast('Configuração salva.');
  }

  function deletePort() {
    const p = find(state.editing);
    if (!p || !confirm(`Excluir a porta "${p.name}" (GPIO ${p.gpio})?`)) return;
    state.ports = state.ports.filter(x => x.id !== state.editing);
    save();
    render();
    dlg.close();
    log(`Porta removida: ${p.name}`);
    toast('Porta removida.');
  }

  /* ----------------------------------------------------- ações globais */

  async function setAll(on) {
    const targets = state.ports.filter(p => p.mode === 'switch' || p.mode === 'dimmer');
    targets.forEach(p => {
      p.value = on ? (p.mode === 'dimmer' ? (p.lastLevel || 100) : 1) : 0;
    });
    save();
    render();
    for (const p of targets) {
      try { await setPort(p); } catch (_) { /* erro individual já refletido no status */ }
    }
    log(`Comando global: ${targets.length} porta(s) ${on ? 'ligadas' : 'desligadas'}`, 'ok');
    toast(on ? 'Todas as portas ligadas.' : 'Todas as portas desligadas.');
  }

  function exportConfig() {
    const blob = new Blob([JSON.stringify({ host: state.host, ports: state.ports }, null, 2)],
      { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'esp32-painel.json';
    a.click();
    URL.revokeObjectURL(a.href);
    log('Configuração exportada.');
  }

  function importConfig(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.ports)) throw new Error('arquivo sem lista de portas');
        state.ports = data.ports.map(p => ({ id: p.id || uid(), value: 0, ...p }));
        if (data.host) { state.host = data.host; $('#host').value = data.host; }
        save();
        render();
        toast('Configuração importada.');
        log(`Configuração importada (${state.ports.length} portas).`, 'ok');
      } catch (err) {
        toast('Arquivo inválido: ' + err.message, true);
      }
    };
    reader.readAsText(file);
  }

  /* ---------------------------------------------------------- PWA/iOS */

  const isStandalone = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  const isIOS = () =>
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ se identifica como Mac; o toque é o que o denuncia.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function setupPwa() {
    // No build de arquivo único não existe sw.js para registrar.
    const singleFile = document.documentElement.hasAttribute('data-single-file');

    // Service worker exige contexto seguro. Servido por HTTP puro pelo ESP32
    // o registro falha — e tudo bem: o painel só depende da rede local.
    if ('serviceWorker' in navigator && window.isSecureContext && !singleFile) {
      navigator.serviceWorker.register('sw.js').then(
        reg => log(`Service worker registrado (escopo ${reg.scope}).`),
        err => log(`Service worker não registrado: ${err.message}`)
      );
    } else if (isIOS()) {
      log('Sem HTTPS: app instalável em tela cheia, porém sem cache offline.');
    }

    // Aviso de "Adicionar à Tela de Início" — só no iOS, fora do modo app.
    const hint = $('#ios-hint');
    const dismissed = localStorage.getItem(STORAGE_KEY + '/ios-hint') === 'off';
    hint.hidden = !(isIOS() && !isStandalone() && !dismissed);
    $('#ios-hint-close').onclick = () => {
      hint.hidden = true;
      localStorage.setItem(STORAGE_KEY + '/ios-hint', 'off');
    };

    if (isStandalone()) document.body.classList.add('standalone');
  }

  // Em standalone o app fica congelado em segundo plano: revalida ao voltar.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) poll();
  });

  /* ------------------------------------------------------------- init */

  function init() {
    load();
    buildTypeOptions();

    $('#host').value = state.host;
    $('#demo').checked = state.demo;
    setStatus(state.demo ? 'demo' : 'off', state.demo ? 'Modo demo' : 'Desconectado');

    $('#btn-connect').onclick = () => {
      state.host = $('#host').value.trim();
      save();
      log(`Conectando a ${baseUrl() || '(sem endereço)'}…`);
      startPolling();
    };

    $('#host').addEventListener('keydown', e => {
      if (e.key === 'Enter') $('#btn-connect').click();
    });

    $('#demo').onchange = e => {
      state.demo = e.target.checked;
      save();
      log(state.demo ? 'Modo demo ativado (sem hardware).' : 'Modo demo desativado.');
      startPolling();
    };

    $('#search').oninput = e => { state.filter = e.target.value.trim(); render(); };

    $('#btn-add').onclick = () => openDialog(null);
    $('#btn-all-on').onclick = () => setAll(true);
    $('#btn-all-off').onclick = () => setAll(false);
    $('#btn-export').onclick = exportConfig;
    $('#btn-import').onclick = () => $('#file-import').click();
    $('#file-import').onchange = e => { if (e.target.files[0]) importConfig(e.target.files[0]); e.target.value = ''; };

    $('#btn-reset').onclick = () => {
      if (!confirm('Restaurar a configuração de portas padrão? As personalizações serão perdidas.')) return;
      state.ports = structuredClone(DEFAULT_PORTS);
      save();
      render();
      toast('Configuração padrão restaurada.');
    };

    $('#btn-clear-log').onclick = () => { $('#log').innerHTML = ''; };

    $('#form').addEventListener('submit', submitDialog);
    $('#f-delete').onclick = deletePort;
    $('[data-close]').onclick = () => dlg.close();
    $('#f-mode').onchange = syncModeFields;
    $('#f-gpio').oninput = checkGpio;
    $('#f-type').onchange = () => {
      const t = typeOf($('#f-type').value);
      $('#f-mode').value = t.mode;
      if (t.unit != null) $('#f-unit').value = t.unit;
      syncModeFields();
    };

    render();
    setupPwa();
    log('Painel carregado.');
    startPolling();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
