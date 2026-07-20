/* =========================================================
   ConectaVoucher — lógica do protótipo (esqueleto)
   Sem backend: simula a janela de cortesia de 3 min, a
   seleção de plano, a tela Pix e a confirmação de pagamento.
   Toda integração real (Efí Pix / MikroTik) fica marcada
   com // TODO:BACKEND
   ========================================================= */

// ---------- Catálogo de planos (viria de GET /api/plans) ----------
const PLANS = [
  { id: '1h',  time: '1 hora',   minutes: 60,   price: 5,   desc: 'Ideal para uma navegada rápida' },
  { id: '3h',  time: '3 horas',  minutes: 180,  price: 10,  desc: 'Redes sociais e mensagens', badge: 'Mais vendido' },
  { id: '6h',  time: '6 horas',  minutes: 360,  price: 15,  desc: 'Um período do evento' },
  { id: '12h', time: '12 horas', minutes: 720,  price: 22,  desc: 'O dia inteiro no evento' },
  { id: '24h', time: '24 horas', minutes: 1440, price: 30,  desc: 'Acesso liberado por 1 dia' },
];

const COURTESY_SECONDS = 3 * 60; // janela de cortesia
const BRL = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const state = {
  screen: 'connect',
  selected: null,
  paid: false,
  courtesyLeft: COURTESY_SECONDS,
  courtesyRunning: true,
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
  state.screen = name;
  Object.values(screens).forEach((s) => s.classList.remove('active'));
  screens[name].classList.add('active');
  document.querySelector('.content').scrollTop = 0;
  renderActionBar();
  // Some o chip de cortesia quando não é mais relevante
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
    // TODO:BACKEND — aqui o MikroTik já teria cortado o acesso do walled-garden
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
function openPayment() {
  const plan = PLANS.find((p) => p.id === state.selected);
  if (!plan) return;

  // TODO:BACKEND — POST /api/checkout { planId } → cria cobrança Pix na Efí
  // e retorna { txid, qrcodeImage, pixCopiaECola }. Aqui usamos placeholders.
  document.getElementById('sumPlan').textContent = plan.time;
  document.getElementById('sumPrice').textContent = BRL(plan.price);
  document.getElementById('qrImg').src = fakeQR(plan.id);
  document.getElementById('pixCode').textContent =
    `00020126580014BR.GOV.BCB.PIX0136${plan.id}-conectavoucher-txid-DEMO520400005303986540${plan.price}.005802BR5910EVENTO2026`;

  document.getElementById('awaitBox').classList.remove('hidden');
  go('payment');

  // TODO:BACKEND — polling GET /api/checkout/:txid/status como fallback do webhook.
}

// ---------- Confirmação de pagamento (webhook simulado) ----------
function confirmPayment() {
  if (!state.selected) return;
  const plan = PLANS.find((p) => p.id === state.selected);
  state.paid = true;
  state.courtesyRunning = false;

  // TODO:BACKEND — webhook Efí confirma → cria /ip/hotspot/user com
  // limit-uptime = plan.minutes preso ao MAC (1 dispositivo), encerra a
  // cortesia e faz o login do dispositivo no Hotspot.
  document.getElementById('okPlan').textContent = plan.time;
  document.getElementById('okTime').textContent = plan.time;
  document.getElementById('okLogin').textContent =
    'evt-' + Math.random().toString(16).slice(2, 8).toUpperCase();
  go('success');
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
    bar.querySelector('#btnDone').onclick = () => {
      // TODO:BACKEND — redireciona para a URL original que o usuário tentou abrir
      alert('Protótipo: aqui o usuário volta a navegar normalmente.');
    };

  } else if (state.screen === 'expired') {
    bar.innerHTML = `<button class="btn btn-primary" id="btnRetry">Escolher um voucher</button>`;
    bar.querySelector('#btnRetry').onclick = () => {
      // Numa situação real o acesso já estaria cortado; para pagar, o MikroTik
      // mantém o walled-garden (portal + Efí) sempre acessível.
      go('plans');
    };
  }
}

// ---------- QR fake (só visual, viria da Efí) ----------
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
      // cantos de posicionamento (finder patterns)
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

// ---------- Barra dev ----------
document.getElementById('devbar').addEventListener('click', (e) => {
  const go_ = e.target.dataset.go;
  const sim = e.target.dataset.sim;
  if (go_ === 'connect') go('connect');
  if (go_ === 'plans') go('plans');
  if (go_ === 'payment') { if (!state.selected) state.selected = '3h'; openPayment(); }
  if (sim === 'pay') { if (!state.selected) state.selected = '3h'; confirmPayment(); }
  if (sim === 'expire') { state.courtesyLeft = 1; }
});

// ---------- Init ----------
renderPlans();
renderTimer();
renderActionBar();
