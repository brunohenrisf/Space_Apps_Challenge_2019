/* =========================================================
   ConectaVoucher — Painel do Administrador (por conta)
   Login + dados ao vivo da conta + gerador de configuração
   da MikroTik. Isolamento é entre contas (usuários); dentro
   da conta os dados são compartilhados. Sem backend (file://),
   mostra dados de exemplo.
   ========================================================= */

const PAGES = ['dashboard', 'planos', 'vendas', 'relatorios', 'config'];
const TITLES = { dashboard: 'Dashboard', planos: 'Planos', vendas: 'Vendas', relatorios: 'Relatórios', config: 'Configurações' };

const API_BASE = location.protocol.startsWith('http') ? '/api' : null;
let apiOk = !!API_BASE;

const TOKEN_KEY = 'cv-admin-token';
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const setToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch {} };

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const t = getToken(); if (t) headers['Authorization'] = 'Bearer ' + t;
  const r = await fetch(API_BASE + path, { ...opts, headers });
  if (r.status === 401) { setToken(''); showLogin(); throw new Error('401'); }
  if (!r.ok) throw new Error('http ' + r.status);
  return r.json();
}
const jsonPost = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const BRL = (v) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Conta atual (carregada no login)
let account = null;

// ---------- Dados de exemplo (modo offline) ----------
const MOCK_ACCOUNT = {
  id: 'demo', slug: 'principal', name: 'Feira de Tecnologia 2026', courtesySeconds: 180,
  efi: { env: 'producao', clientId: '', pixKey: '', hasSecret: false, webhookConfigured: false },
  network: { lanCidr: '10.10.0.1/24', dhcpFrom: '10.10.0.10', dhcpTo: '10.10.0.254', dns: '1.1.1.1,8.8.8.8', hotspotName: 'ConectaVoucher', portalDomain: '', apiUser: 'api', apiPassword: '', wgVpsPublicKey: '', wgVpsEndpoint: '', wgVpsPort: 51820, wgPeerAddress: '10.20.0.2' },
};
const MOCK_PLANS = [
  { id: 'p1', code: '1h', label: '1 hora', minutes: 60, price: 5, active: true },
  { id: 'p2', code: '3h', label: '3 horas', minutes: 180, price: 10, active: true, badge: 'Mais vendido' },
  { id: 'p3', code: '6h', label: '6 horas', minutes: 360, price: 15, active: true },
  { id: 'p4', code: '24h', label: '24 horas', minutes: 1440, price: 30, active: false },
];
const MOCK_SALES = [
  { txid: 'DEMO9AF3', voucher: 'evt-8F3A21', plan: '3 horas', amount: 10, mac: 'A4:83:E7…', status: 'paid', createdAt: new Date().toISOString(), paidAt: new Date().toISOString() },
  { txid: 'DEMO3C7B', voucher: 'evt-2B9C04', plan: '1 hora', amount: 5, mac: 'F0:18:98…', status: 'paid', createdAt: new Date().toISOString(), paidAt: new Date().toISOString() },
  { txid: 'DEMO1D0A', voucher: '—', plan: '6 horas', amount: 15, mac: '—', status: 'pending', createdAt: new Date().toISOString() },
];

// ---------- Login / sessão ----------
const loginWrap = $('loginWrap'), app = $('app');
function enterApp() { loginWrap.style.display = 'none'; app.classList.add('active'); initPanel(); }
function showLogin() { app.classList.remove('active'); loginWrap.style.display = 'grid'; }

let authMode = 'login';
function setAuthMode(m) {
  authMode = m;
  $('fieldAccount').classList.toggle('hidden', m !== 'signup');
  $('loginTitle').textContent = m === 'signup' ? 'Criar conta' : 'Painel do Administrador';
  $('loginSub').textContent = m === 'signup' ? 'ConectaVoucher · nova conta na plataforma' : 'ConectaVoucher · acesso do organizador';
  $('loginBtn').textContent = m === 'signup' ? 'Criar conta' : 'Entrar';
  $('signupToggle').textContent = m === 'signup' ? 'Já tenho conta' : 'Criar uma conta';
  $('loginError').textContent = '';
}
$('signupToggle')?.addEventListener('click', (e) => { e.preventDefault(); setAuthMode(authMode === 'signup' ? 'login' : 'signup'); });

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('loginError'); if (err) err.textContent = '';
  if (!apiOk) { enterApp(); return; }
  try {
    const r = authMode === 'signup'
      ? await api('/signup', jsonPost({ accountName: $('signupName').value, email: $('email').value, password: $('senha').value }))
      : await api('/admin/login', jsonPost({ email: $('email').value, password: $('senha').value }));
    setToken(r.token); enterApp();
  } catch (ex) {
    if (err) err.textContent = authMode === 'signup'
      ? 'Não foi possível criar (e-mail já usado ou senha curta).'
      : 'E-mail ou senha inválidos.';
  }
});
$('logoutBtn')?.addEventListener('click', () => { setToken(''); showLogin(); });
(async function initAuth() {
  if (apiOk) {
    api('/signup/open').then((r) => { if (!r.open) $('signupToggle').style.display = 'none'; }).catch(() => {});
    if (getToken()) { try { await api('/admin/me'); enterApp(); } catch (e) { setToken(''); } }
  }
})();

// ---------- Bootstrap ----------
async function initPanel() {
  account = MOCK_ACCOUNT;
  if (apiOk) { try { account = await api('/admin/account'); } catch (e) { apiOk = false; account = MOCK_ACCOUNT; } }
  $('acctName').textContent = account.name;
  $('acctNameM').textContent = account.name;
  navigate('dashboard');
}

// ---------- Navegação ----------
let currentPage = 'dashboard';
function navigate(page) {
  if (!PAGES.includes(page)) return;
  currentPage = page;
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  $('page-' + page).classList.add('active');
  document.querySelectorAll('[data-nav]').forEach((el) => el.classList.toggle('active', el.dataset.nav === page));
  if ($('pageTitle')) $('pageTitle').textContent = TITLES[page];
  if ($('mobileTitle')) $('mobileTitle').textContent = TITLES[page];
  window.scrollTo(0, 0);
  if (page === 'dashboard') loadDashboard();
  if (page === 'vendas') loadSales(currentSalesFilter);
  if (page === 'relatorios') loadReport();
  if (page === 'planos') loadPlans();
  if (page === 'config') { loadAccountPanel(); }
}
document.querySelectorAll('[data-nav]').forEach((el) => el.addEventListener('click', () => navigate(el.dataset.nav)));

// ---------- Helpers ----------
function statusPill(s) {
  if (s === 'paid') return '<span class="pill on">Pago</span>';
  if (s === 'pending') return '<span class="pill wait">Aguardando</span>';
  return '<span class="pill off">Expirado</span>';
}
const shortTxid = (t) => (t && t.length > 10 ? t.slice(0, 8) + '…' : t || '—');
const hhmm = (iso) => { try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch { return '—'; } };

async function fetchSales(status) {
  if (!apiOk) return MOCK_SALES.filter((s) => !status || s.status === status);
  try { return (await api('/admin/sales' + (status ? '?status=' + status : ''))).sales; }
  catch (e) { apiOk = false; return MOCK_SALES; }
}

// ====================================================== DASHBOARD
async function loadDashboard() {
  const rep = apiOk ? await api('/admin/report').catch(() => mockReport()) : mockReport();
  $('db-rev').textContent = BRL(rep.totals.revenue);
  $('db-vouchers').textContent = rep.totals.vouchers;
  $('db-pending').textContent = rep.totals.pending;
  $('db-conv').textContent = rep.totals.conversion + '%';

  const sales = (await fetchSales()).slice(0, 5);
  $('db-sales').innerHTML = sales.length ? sales.map((s) => `
    <div class="list-item"><div class="li-ico">${s.status === 'paid' ? '✓' : '⏳'}</div>
      <div class="li-body"><div class="li-title">${esc(s.voucher)} · ${esc(s.plan)}</div>
        <div class="li-sub">${s.status === 'paid' ? 'Pix confirmado' : 'aguardando Pix'} · ${hhmm(s.paidAt || s.createdAt)}</div></div>
      <span class="li-val ${s.status === 'paid' ? 'g' : ''}">${BRL(s.amount)}</span></div>`).join('')
    : '<div class="empty" style="padding:18px">Nenhuma venda ainda.</div>';

  let st = { mikrotik: { ok: false }, efi: { configured: false }, courtesySeconds: account.courtesySeconds || 180 };
  if (apiOk) { try { st = await api('/admin/status'); } catch (e) {} }
  $('db-router').innerHTML = st.mikrotik?.ok ? '<span style="color:var(--pos)">● conectada</span>' : '<span style="color:var(--ink-3)">● modo mock</span>';
  $('db-efi').innerHTML = st.efi?.configured ? '<span style="color:var(--pos)">● configurada</span>' : '<span style="color:var(--ink-3)">● não configurada</span>';
  $('db-courtesy').textContent = Math.round((st.courtesySeconds || 180) / 60) + ' min';
}

// ====================================================== VENDAS
let currentSalesFilter = 'all', salesCache = [];
async function loadSales(filter) {
  const sales = await fetchSales(filter === 'all' ? '' : filter);
  salesCache = sales;
  $('salesBody').innerHTML = sales.length ? sales.map((s) => `<tr>
      <td>${esc(s.voucher)}</td><td>${esc(s.plan)}</td><td>${BRL(s.amount)}</td>
      <td>${esc(shortTxid(s.txid))}</td><td>${esc(s.mac)}</td>
      <td>${statusPill(s.status)}</td><td>${hhmm(s.paidAt || s.createdAt)}</td></tr>`).join('')
    : '<tr><td colspan="7" style="text-align:center;color:var(--ink-3);padding:22px">Nenhuma venda ainda.</td></tr>';
  const paid = sales.filter((s) => s.status === 'paid'), rev = paid.reduce((a, s) => a + s.amount, 0);
  $('sv-rev').textContent = BRL(rev);
  $('sv-paid').textContent = paid.length;
  $('sv-pending').textContent = sales.filter((s) => s.status === 'pending').length;
  $('sv-ticket').textContent = BRL(paid.length ? rev / paid.length : 0);
}
$('salesFilters')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-sfilter]'); if (!b) return;
  currentSalesFilter = b.dataset.sfilter;
  document.querySelectorAll('#salesFilters .filter').forEach((f) => f.classList.toggle('on', f === b));
  loadSales(currentSalesFilter);
});
function downloadCSV(name, rows) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
$('salesExport')?.addEventListener('click', () => {
  const rows = [['Voucher', 'Plano', 'Valor', 'Txid', 'Dispositivo', 'Status', 'Quando']];
  salesCache.forEach((s) => rows.push([s.voucher, s.plan, s.amount, s.txid, s.mac, s.status, s.paidAt || s.createdAt]));
  downloadCSV('vendas.csv', rows);
});

// ====================================================== RELATÓRIOS
let reportCache = null;
function mockReport() {
  const rev = [180, 240, 300, 150, 420, 380, 240];
  const byDay = rev.map((r, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return { date: d.toISOString().slice(0, 10), revenue: r, count: Math.round(r / 12) }; });
  return {
    totals: { revenue: 3860, vouchers: 312, orders: 488, pending: 4, ticket: 12.37, conversion: 64 },
    byPlan: [
      { time: '1 hora', count: 84, revenue: 420 }, { time: '3 horas', count: 132, revenue: 1320 },
      { time: '6 horas', count: 54, revenue: 810 }, { time: '12 horas', count: 18, revenue: 396 }, { time: '24 horas', count: 24, revenue: 720 },
    ], byDay,
  };
}
function renderReport(r) {
  $('rp-rev').textContent = BRL(r.totals.revenue);
  $('rp-vouchers').textContent = r.totals.vouchers;
  $('rp-ticket').textContent = BRL(r.totals.ticket);
  $('rp-conv').textContent = r.totals.conversion + '%';
  const max = Math.max(1, ...r.byDay.map((d) => d.revenue));
  $('rp-bars').innerHTML = r.byDay.map((d) => {
    const h = Math.round((d.revenue / max) * 100);
    const wd = new Date(d.date + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
    return `<div class="cf-col"><div class="cf-val">${d.revenue ? 'R$' + d.revenue : ''}</div><div class="cf-bars"><div class="cf-bar" style="height:${h}%"></div></div><div class="cf-lbl">${wd}</div></div>`;
  }).join('');
  const maxP = Math.max(1, ...r.byPlan.map((p) => p.revenue));
  $('rp-byplan').innerHTML = r.byPlan.map((p) => `<div class="rep-row"><div class="rep-head"><span class="nm">${esc(p.time)}</span><span class="ct">${p.count} vendas</span><span class="amt">${BRL(p.revenue)}</span></div><div class="bar-track"><div class="bar-fill" style="width:${Math.round((p.revenue / maxP) * 100)}%"></div></div></div>`).join('');
  reportCache = r;
}
async function loadReport() {
  if (!apiOk) return renderReport(mockReport());
  try { renderReport(await api('/admin/report')); } catch (e) { renderReport(mockReport()); }
}
$('reportExport')?.addEventListener('click', () => {
  const rows = [['Plano', 'Vendas', 'Faturamento']];
  (reportCache ? reportCache.byPlan : []).forEach((p) => rows.push([p.time, p.count, p.revenue]));
  downloadCSV('relatorio-por-plano.csv', rows);
});

// ====================================================== PLANOS
async function loadPlans() {
  let plans = MOCK_PLANS, report = mockReport();
  if (apiOk) {
    try { plans = (await api('/admin/plans')).plans; report = await api('/admin/report').catch(() => mockReport()); }
    catch (e) { apiOk = false; }
  }
  const sold = {}; (report.byPlan || []).forEach((p) => { sold[p.time] = p.count; });
  $('pl-body').innerHTML = plans.map((p) => `<tr>
      <td>${esc(p.label)}${p.badge ? ` <span class="badge" style="margin-left:4px">${esc(p.badge)}</span>` : ''}</td>
      <td>${p.minutes} min</td><td>${BRL(p.price)}</td><td>${sold[p.label] ?? 0}</td>
      <td>${p.active === false ? '<span class="pill off">Pausado</span>' : '<span class="pill on">Ativo</span>'}</td>
      <td style="text-align:right">${apiOk ? `<button class="btn btn-sm btn-outline" data-plan-toggle="${p.id}" data-active="${p.active}" style="width:auto">${p.active === false ? 'Ativar' : 'Pausar'}</button>` : ''}</td></tr>`).join('');
}
$('pl-body')?.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-plan-toggle]'); if (!b || !apiOk) return;
  const active = b.dataset.active !== 'true';
  try { await api('/admin/plans/' + b.dataset.planToggle, jsonPost({ active })); loadPlans(); } catch (ex) {}
});
$('pl-create')?.addEventListener('click', async () => {
  const msg = $('pl-msg');
  const body = { code: $('pl-code').value.trim(), label: $('pl-label').value.trim(), minutes: $('pl-minutes').value, price: $('pl-price').value };
  if (!body.code || !body.label || !body.minutes || !body.price) { msg.textContent = 'Preencha todos os campos.'; return; }
  if (!apiOk) { msg.textContent = 'Protótipo: sem backend aqui.'; return; }
  try { await api('/admin/plans', jsonPost(body)); ['pl-code', 'pl-label', 'pl-minutes', 'pl-price'].forEach((i) => ($(i).value = '')); msg.textContent = '✓ Adicionado'; loadPlans(); }
  catch (e) { msg.textContent = 'Erro (código já existe?).'; }
});

// ====================================================== CONFIGURAÇÕES
function loadAccountPanel() {
  // Efí
  $('efi-env').value = account.efi.env || 'producao';
  $('efi-clientId').value = account.efi.clientId || '';
  $('efi-pixKey').value = account.efi.pixKey || '';
  const st = $('efi-status'), ok = account.efi.clientId && account.efi.hasSecret;
  st.textContent = apiOk ? (ok ? 'configurada' : 'não configurada') : 'demo';
  st.className = 'pill ' + (apiOk ? (ok ? 'on' : 'off') : '');
  // Rede / gerador
  const n = account.network || {};
  const set = (id, v) => { const el = $(id); if (el && v !== undefined && v !== null) el.value = v; };
  set('gen-eventName', account.name); set('gen-hotspot', n.hotspotName); set('gen-lan', n.lanCidr);
  set('gen-dhcpFrom', n.dhcpFrom); set('gen-dhcpTo', n.dhcpTo); set('gen-dns', n.dns);
  set('gen-portal', n.portalDomain); set('gen-apiUser', n.apiUser);
  set('gen-wgEndpoint', n.wgVpsEndpoint); set('gen-wgPort', n.wgVpsPort); set('gen-wgKey', n.wgVpsPublicKey); set('gen-wgPeer', n.wgPeerAddress);
  // Conta e segurança
  $('acc-name').textContent = account.name;
  $('acc-slug').textContent = account.slug;
  $('acc-portal').textContent = location.origin + '/portal.html?ac=' + account.slug;
}
$('pw-save')?.addEventListener('click', async () => {
  const msg = $('pw-msg'); msg.textContent = '';
  if (!apiOk) { msg.textContent = 'Protótipo: sem backend aqui.'; return; }
  try {
    await api('/admin/password', jsonPost({ current: $('pw-current').value, new: $('pw-new').value }));
    $('pw-current').value = ''; $('pw-new').value = ''; msg.textContent = '✓ Senha alterada';
  } catch (e) { msg.textContent = 'Senha atual incorreta ou nova muito curta.'; }
});
$('efi-save')?.addEventListener('click', async () => {
  const efi = { env: $('efi-env').value, clientId: $('efi-clientId').value, clientSecret: $('efi-clientSecret').value, pixKey: $('efi-pixKey').value, webhookToken: $('efi-webhookToken').value };
  const msg = $('efi-msg'); msg.textContent = 'Salvando…';
  if (!apiOk) { msg.textContent = 'Protótipo: sem backend aqui.'; return; }
  try { const r = await api('/admin/efi', jsonPost({ efi })); account = r.account; msg.textContent = '✓ Salvo'; loadAccountPanel(); } catch (e) { msg.textContent = 'Erro ao salvar'; }
});
$('efi-webhook')?.addEventListener('click', async () => {
  const msg = $('efi-msg'); msg.textContent = 'Configurando webhook…';
  if (!apiOk) { msg.textContent = 'Protótipo: sem backend aqui.'; return; }
  try { const r = await api('/admin/efi/webhook', jsonPost({})); msg.textContent = r.ok ? '✓ Webhook configurado' : (r.error || 'Falhou'); } catch (e) { msg.textContent = 'Falhou (backend/efí)'; }
});
$('gen-save')?.addEventListener('click', async () => {
  const msg = $('gen-msg'); msg.textContent = 'Salvando…';
  if (!apiOk) { msg.textContent = 'Protótipo: sem backend aqui.'; return; }
  const body = {
    name: $('gen-eventName').value, hotspotName: $('gen-hotspot').value, lanCidr: $('gen-lan').value,
    dhcpFrom: $('gen-dhcpFrom').value, dhcpTo: $('gen-dhcpTo').value, dns: $('gen-dns').value,
    portalDomain: $('gen-portal').value, apiUser: $('gen-apiUser').value,
    wgVpsEndpoint: $('gen-wgEndpoint').value, wgVpsPort: $('gen-wgPort').value, wgVpsPublicKey: $('gen-wgKey').value, wgPeerAddress: $('gen-wgPeer').value,
  };
  const pass = $('gen-apiPass').value; if (pass) body.apiPassword = pass;
  try {
    const r = await api('/admin/network', jsonPost(body)); account = r.account;
    $('acctName').textContent = account.name; $('acctNameM').textContent = account.name;
    msg.textContent = '✓ Salvo na conta';
  } catch (e) { msg.textContent = 'Erro ao salvar'; }
});

// ====================================================== Gerador MikroTik
function buildRsc(v) {
  const ip = (v.lan.split('/')[0] || '10.10.0.1').trim();
  const net = ip.replace(/\.\d+$/, '.0');
  const walledPortal = v.portal ? `add dst-host=${v.portal} comment="Portal ConectaVoucher"` : `# add dst-host=SEU_DOMINIO comment="Portal ConectaVoucher"`;
  return `# =============================================================================
#  ConectaVoucher - Configuracao gerada pelo painel (Hotspot + WireGuard)
#  Conta: ${v.accountName} (${v.slug})
#  Importe:  /import file-name=conectavoucher.rsc  | Backup antes recomendado.
# =============================================================================

# ---- WAN (ether1, DHCP client) ----
/ip dhcp-client add interface=ether1 disabled=no use-peer-dns=yes add-default-route=yes comment="WAN ConectaVoucher"

# ---- LAN (ether2 -> UniFi) ----
/interface bridge add name=bridge-lan comment="LAN p/ UniFi"
/interface bridge port add bridge=bridge-lan interface=ether2
/ip address add address=${v.lan} interface=bridge-lan comment="Gateway LAN"
/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade comment="NAT WAN"
/ip dns set allow-remote-requests=yes servers=${v.dns}

# ---- DHCP para os clientes ----
/ip pool add name=hs-pool ranges=${v.dhcpFrom}-${v.dhcpTo}
/ip dhcp-server add name=hs-dhcp interface=bridge-lan address-pool=hs-pool lease-time=1h disabled=no
/ip dhcp-server network add address=${net}/24 gateway=${ip} dns-server=${v.dns}

# ---- Hotspot (captive portal) ----
/ip hotspot profile set [find default=yes] login-by=http-chap,http-pap,mac-cookie html-directory=hotspot
/ip hotspot add name=${v.hotspot} interface=bridge-lan address-pool=hs-pool profile=default disabled=no
/ip hotspot user profile set [find default=yes] shared-users=1
/ip hotspot walled-garden add dst-host=*.efipay.com.br comment="Efi Pix"
/ip hotspot walled-garden add dst-host=*.gerencianet.com.br comment="Efi Pix"
${walledPortal}

# ---- Usuario da API (backend) ----
/user add name=${v.apiUser} group=full password="${v.apiPass}" comment="ConectaVoucher backend"
/ip service set api address=10.20.0.0/24

# ---- Tunel WireGuard (VPS) ----
/interface/wireguard add name=wg-cv listen-port=13231 comment="ConectaVoucher"
/ip/address add address=${v.wgPeer}/24 interface=wg-cv
/interface/wireguard/peers add interface=wg-cv \\
    public-key="${v.wgKey}" \\
    endpoint-address=${v.wgEndpoint} endpoint-port=${v.wgPort} \\
    allowed-address=10.20.0.0/24 persistent-keepalive=25s comment="VPS"
/ip/firewall/filter add chain=input in-interface=wg-cv protocol=tcp dst-port=8728 action=accept place-before=0

:put [/interface/wireguard/get wg-cv public-key]
# Na conta: apiUser=${v.apiUser}, IP no tunel=${v.wgPeer}
# Suba tambem o login.html gerado para a pasta /hotspot (botao "Baixar login.html").
`;
}
function buildLoginHtml(portalDomain, slug) {
  const base = portalDomain
    ? (/^https?:\/\//.test(portalDomain) ? portalDomain.replace(/\/$/, '') : 'https://' + portalDomain)
    : 'https://conectavoucher.seudominio.com';
  const url = base + '/portal.html?ac=' + encodeURIComponent(slug || 'principal');
  return `<!doctype html>
<!-- ConectaVoucher — login do Hotspot: redireciona o celular para o portal. -->
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ConectaVoucher</title></head>
<body>
  <script type="text/javascript">
    (function(){
      var portal = "${url}";
      var q = "&mac=$(mac)&ip=$(ip)&link-login-only=" + encodeURIComponent("$(link-login-only)") + "&link-orig=" + encodeURIComponent("$(link-orig)");
      location.href = portal + q;
    })();
  </script>
  <noscript><a href="${url}">Toque para comprar acesso à internet</a></noscript>
</body></html>
`;
}

let lastRsc = '', lastLoginHtml = '';
$('gen-run')?.addEventListener('click', () => {
  const val = (id, d) => ($(id).value.trim() || d);
  const v = {
    accountName: $('gen-eventName').value.trim() || (account?.name || 'Minha conta'), slug: account?.slug || 'principal',
    hotspot: val('gen-hotspot', 'ConectaVoucher'), lan: val('gen-lan', '10.10.0.1/24'),
    dhcpFrom: val('gen-dhcpFrom', '10.10.0.10'), dhcpTo: val('gen-dhcpTo', '10.10.0.254'),
    dns: val('gen-dns', '1.1.1.1,8.8.8.8'), portal: $('gen-portal').value.trim(),
    apiUser: val('gen-apiUser', 'api'), apiPass: val('gen-apiPass', 'TROQUE_ESTA_SENHA'),
    wgEndpoint: val('gen-wgEndpoint', 'IP_PUBLICO_DO_VPS'), wgPort: val('gen-wgPort', '51820'),
    wgKey: val('gen-wgKey', 'CHAVE_PUBLICA_DO_VPS'), wgPeer: val('gen-wgPeer', '10.20.0.2'),
  };
  lastRsc = buildRsc(v);
  lastLoginHtml = buildLoginHtml(v.portal, v.slug);
  const out = $('gen-output'); out.textContent = lastRsc; out.hidden = false;
  $('gen-copy').disabled = false; $('gen-download').disabled = false; $('gen-login').disabled = false;
});
function downloadText(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
$('gen-copy')?.addEventListener('click', () => { navigator.clipboard?.writeText(lastRsc); const b = $('gen-copy'); b.textContent = 'Copiado!'; setTimeout(() => (b.textContent = 'Copiar'), 1500); });
$('gen-download')?.addEventListener('click', () => downloadText('conectavoucher.rsc', lastRsc));
$('gen-login')?.addEventListener('click', () => downloadText('login.html', lastLoginHtml, 'text/html'));
