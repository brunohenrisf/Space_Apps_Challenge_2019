/* =========================================================
   ConectaVoucher — Painel do Administrador (protótipo)
   Login simulado + navegação entre seções. Sem backend.
   ========================================================= */

const PAGES = ['dashboard', 'eventos', 'planos', 'vendas', 'config'];
const TITLES = {
  dashboard: 'Dashboard',
  eventos: 'Eventos',
  planos: 'Planos',
  vendas: 'Vendas',
  config: 'Configurações',
};

// ---------- Login (simulado) ----------
const loginWrap = document.getElementById('loginWrap');
const app = document.getElementById('app');

document.getElementById('loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  // TODO:BACKEND — POST /api/admin/login → JWT/sessão do organizador.
  loginWrap.style.display = 'none';
  app.classList.add('active');
  navigate('dashboard');
});

document.getElementById('logoutBtn')?.addEventListener('click', () => {
  app.classList.remove('active');
  loginWrap.style.display = 'grid';
});

// ---------- Navegação ----------
function navigate(page) {
  if (!PAGES.includes(page)) return;
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');

  document.querySelectorAll('[data-nav]').forEach((el) => {
    el.classList.toggle('active', el.dataset.nav === page);
  });
  const title = document.getElementById('pageTitle');
  if (title) title.textContent = TITLES[page];
  const mtitle = document.getElementById('mobileTitle');
  if (mtitle) mtitle.textContent = TITLES[page];
  document.querySelector('.main-body')?.scrollTo(0, 0);
  window.scrollTo(0, 0);
}

document.querySelectorAll('[data-nav]').forEach((el) => {
  el.addEventListener('click', () => navigate(el.dataset.nav));
});

// ---------- Ações de esqueleto (apenas feedback visual) ----------
document.addEventListener('click', (e) => {
  const demo = e.target.closest('[data-demo]');
  if (demo) {
    e.preventDefault();
    alert('Protótipo: “' + demo.dataset.demo + '” será implementado no backend.');
  }
});
