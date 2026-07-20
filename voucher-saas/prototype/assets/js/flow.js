/* =========================================================
   ConectaVoucher — lógica do portal do cliente.

   Funciona em dois modos automaticamente:
   - Servido por HTTP (pelo backend): usa a API real
     (/courtesy, /checkout, polling de status) e faz o
     login do dispositivo no Hotspot após o pagamento.
   - Aberto como arquivo (file://) ou sem backend: cai na
     simulação, para validar as telas sem hardware.
   ========================================================= */

// ---------- Catálogo de planos (fallback; a API sobrescreve via /plans) ----------
let PLANS = [
  { id: '1h',  time: '1 hora',   minutes: 60,   price: 5,   desc: 'Ideal para uma navegada rápida' },
  { id: '3h',  time: '3 horas',  minutes: 180,  price: 10,  desc: 'Redes sociais e mensagens', badge: 'Mais vendido' },
  { id: '6h',  time: '6 horas',  minutes: 360,  price: 15,  desc: 'Um período do evento' },
  { id: '12h', time: '12 horas', minutes: 720,  price: 22,  desc: 'O dia inteiro no evento' },
  { id: '24h', time: '24 horas', minutes: 1440, price: 30,  desc: 'Acesso liberado por 1 dia' },
];

const COURTESY_SECONDS = 3 * 60;
const BRL = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ---------- Parâmetros que o Hotspot do MikroTik injeta na URL ----------
const qs = new URLSearchParams(location.search);
const hotspot = {
  mac: qs.get('mac') || '',
  // link-login-only é o alvo do POST de login; link-login é a versão completa.
  linkLogin: qs.get('link-login-only') || qs.get('link-login') || '',
  linkOrig: qs.get('link-orig') || qs.get('dst') || '',
};

// API disponível quando servido por http(s). Vira false se um fetch falhar.
const API_BASE = location.protocol.startsWith('http') ? '/api' : null;
let apiOk = !!API_BASE;

async function api(path, opts) {
  const r = await fetch(API_BASE + path, opts);
  if (!r.ok) throw new Error('http ' + r.status);
  return r.json();
}
const jsonPost = (body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const state = {
  screen: 'connect',
  selected: null,
  paid: false,
  courtesyLeft: COURTESY_SECONDS,
  courtesyRunning: true,
  txid: null,
  voucherPassword: null,
  poll: null,
};

// ---------- Navegação entre telas ----------
const screens = {
  connect: document.getElementById('screen-connect'),
  plans:   document.getElementById('screen-plans'),
  payment: document.getElementById('screen-payment'),
  success: document.getElementById('screen-success'),
  expired: document.getElementById('screen-expired'),
};

function go(name) {
  if (state.screen === 'payment' && name !== 'payment') stopPolling();
  state.screen = name;
  Object.values(screens).forEach((s) => s.classList.remove('active'));
  screens[name].classList.add('active');
  document.querySelector('.content').scrollTop = 0;
  renderActionBar();
  const chip = document.getElementById('timerChip');
  chip.classList.toggle('hidden', name === 'success' || name === 'expired');
}

// ---------- Contagem regressiva da cortesia ----------
function tickCourtesy() {
  if (!state.courtesyRunning || state.paid) return;
  state.courtesyLeft -= 1;
  renderTimer();
  if (state.courtesyLeft <= 0) {
    state.courtesyRunning = false;
    if (!state.paid) go('expired');
  }
}
setInterval(tickCourtesy, 1000);

function renderTimer() {
  const m = String(Math.max(0, Math.floor(state.courtesyLeft / 60))).padStart(2, '0');
  const s = String(Math.max(0, state.courtesyLeft % 60)).padStart(2, '0');
  document.getElementById('timerText').textContent = `${m}:${s}`;
  const chip = document.getElementById('timerChip');
  chip.classList.toggle('warn', state.courtesyLeft <= 60 && state.courtesyLeft > 20);
  chip.classList.toggle('danger', state.courtesyLeft <= 20);
}

// ---------- Render dos planos ----------
function renderPlans() {
  const list = document.getElementById('planList');
  list.innerHTML = PLANS.map((p) => `
    <div class="plan${state.selected === p.id ? ' selected' : ''}" data-plan="${p.id}">
      <div class="plan-icon">⏱</div>
      <div class="plan-body">
        <div class="plan-time">${p.time}</div>
        <div class="plan-desc">${p.desc}</div>
        ${p.badge ? `<span class="badge">${p.badge}</span>` : ''}
      </div>
      <div class="plan-price">
        <span class="cur">R$</span> <span class="val">${p.price.toLocaleString('pt-BR')}</span>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.plan').forEach((el) => {
    el.addEventListener('click', () => {
      state.selected = el.dataset.plan;
      renderPlans();
      renderActionBar();
    });
  });
}

// ---------- Tela de pagamento ----------
async function openPayment() {
  const plan = PLANS.find((p) => p.id === state.selected);
  if (!plan) return;

  document.getElementById('sumPlan').textContent = plan.time;
  document.getElementById('sumPrice').textContent = BRL(plan.price);
  document.getElementById('awaitBox').classList.remove('hidden');
  go('payment');

  if (apiOk) {
    try {
      const r = await api('/checkout', jsonPost({ planId: plan.id, mac: hotspot.mac }));
      state.txid = r.txid;
      document.getElementById('qrImg').src = r.qrcodeImage;
      document.getElementById('pixCode').textContent = r.pixCopiaECola;
      startPolling(plan);
      return;
    } catch (e) {
      apiOk = false; // backend indisponível → cai na simulação
    }
  }
  // Simulação
  document.getElementById('qrImg').src = fakeQR(plan.id);
  document.getElementById('pixCode').textContent =
    `00020126580014BR.GOV.BCB.PIX0136${plan.id}-conectavoucher-txid-DEMO520400005303986540${plan.price}.005802BR5910EVENTO2026`;
}

// ---------- Polling do status (fallback do webhook) ----------
function startPolling(plan) {
  stopPolling();
  state.poll = setInterval(async () => {
    if (!state.txid) return;
    try {
      const r = await api(`/checkout/${state.txid}/status`);
      if (r.status === 'paid') {
        stopPolling();
        onPaid(plan, r.voucherLogin, r.voucherPassword);
      }
    } catch (e) { /* tenta de novo no próximo tick */ }
  }, 3000);
}
function stopPolling() {
  if (state.poll) { clearInterval(state.poll); state.poll = null; }
}

// ---------- Pagamento confirmado ----------
function onPaid(plan, login, password) {
  state.paid = true;
  state.courtesyRunning = false;
  state.voucherPassword = password || null;
  document.getElementById('okPlan').textContent = plan.time;
  document.getElementById('okTime').textContent = plan.time;
  document.getElementById('okLogin').textContent =
    login || 'evt-' + Math.random().toString(16).slice(2, 8).toUpperCase();
  go('success');
}

// Simulação local (usada pela devbar e no modo file://)
function confirmPaymentSim() {
  const plan = PLANS.find((p) => p.id === state.selected) || PLANS[1];
  state.selected = plan.id;
  onPaid(plan, null, Math.random().toString(36).slice(2, 10));
}

// ---------- Handoff: loga o dispositivo no Hotspot do MikroTik ----------
function startBrowsing() {
  const login = document.getElementById('okLogin').textContent;
  const password = state.voucherPassword;
  if (hotspot.linkLogin && login && password) {
    // Submete o login do Hotspot; o MikroTik redireciona para link-orig.
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = hotspot.linkLogin;
    const add = (n, v) => {
      const i = document.createElement('input');
      i.type = 'hidden'; i.name = n; i.value = v; form.appendChild(i);
    };
    add('username', login);
    add('password', password);
    if (hotspot.linkOrig) add('dst', hotspot.linkOrig);
    document.body.appendChild(form);
    form.submit();
  } else {
    alert('Protótipo: aqui o dispositivo é autenticado no Hotspot e volta a navegar.');
  }
}

// ---------- Rodapé de ação por tela ----------
function renderActionBar() {
  const bar = document.getElementById('actionBar');
  const plan = PLANS.find((p) => p.id === state.selected);

  if (state.screen === 'connect') {
    bar.innerHTML = `<button class="btn btn-primary" id="btnStart">Comprar acesso à internet</button>`;
    bar.querySelector('#btnStart').onclick = () => go('plans');

  } else if (state.screen === 'plans') {
    bar.innerHTML = `
      <button class="btn btn-primary" id="btnCheckout" ${state.selected ? '' : 'disabled'}>
        ${state.selected ? `Pagar ${BRL(plan.price)} no Pix` : 'Selecione um plano'}
      </button>`;
    const b = bar.querySelector('#btnCheckout');
    if (b) b.onclick = openPayment;

  } else if (state.screen === 'payment') {
    bar.innerHTML = `
      <button class="btn btn-outline" id="btnBack">Escolher outro plano</button>
      <p class="helper">A tela avança sozinha quando o Pix é confirmado.</p>`;
    bar.querySelector('#btnBack').onclick = () => go('plans');

  } else if (state.screen === 'success') {
    bar.innerHTML = `<button class="btn btn-success" id="btnDone">Começar a navegar</button>`;
    bar.querySelector('#btnDone').onclick = startBrowsing;

  } else if (state.screen === 'expired') {
    bar.innerHTML = `<button class="btn btn-primary" id="btnRetry">Escolher um voucher</button>`;
    bar.querySelector('#btnRetry').onclick = () => go('plans');
  }
}

// ---------- QR fake (só simulação) ----------
function fakeQR(seed) {
  const size = 25;
  let hash = 0;
  for (const c of seed + 'conectavoucher') hash = (hash * 31 + c.charCodeAt(0)) & 0xffffffff;
  const rand = () => {
    hash = (hash * 1103515245 + 12345) & 0x7fffffff;
    return hash / 0x7fffffff;
  };
  let rects = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const corner = (x < 7 && y < 7) || (x >= size - 7 && y < 7) || (x < 7 && y >= size - 7);
      const on = corner ? finderOn(x, y, size) : rand() > 0.5;
      if (on) rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><g fill="#0f172a">${rects}</g></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
function finderOn(x, y, size) {
  const lx = x >= size - 7 ? x - (size - 7) : x;
  const ly = y >= size - 7 ? y - (size - 7) : y;
  const border = lx === 0 || lx === 6 || ly === 0 || ly === 6;
  const core = lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4;
  return border || core;
}

// ---------- Copiar código Pix ----------
document.getElementById('copyBtn').addEventListener('click', () => {
  const code = document.getElementById('pixCode').textContent;
  navigator.clipboard?.writeText(code);
  const b = document.getElementById('copyBtn');
  b.textContent = 'Copiado!';
  setTimeout(() => (b.textContent = 'Copiar'), 1500);
});

// ---------- Barra dev (simulação) ----------
document.getElementById('devbar').addEventListener('click', (e) => {
  const go_ = e.target.dataset.go;
  const sim = e.target.dataset.sim;
  if (go_ === 'connect') go('connect');
  if (go_ === 'plans') go('plans');
  if (go_ === 'payment') { if (!state.selected) state.selected = '3h'; openPayment(); }
  if (sim === 'pay') { stopPolling(); confirmPaymentSim(); }
  if (sim === 'expire') { state.courtesyLeft = 1; }
});

// ---------- Init ----------
async function init() {
  if (apiOk) {
    try {
      const [{ plans }, status] = await Promise.all([
        api('/plans'),
        api('/courtesy', jsonPost({ mac: hotspot.mac })),
      ]);
      if (Array.isArray(plans) && plans.length) PLANS = plans;
      if (status?.seconds) { state.courtesyLeft = status.seconds; }
    } catch (e) {
      apiOk = false; // sem backend → segue em simulação
    }
  }
  renderPlans();
  renderTimer();
  renderActionBar();
}
init();
