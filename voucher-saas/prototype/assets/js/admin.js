/* =========================================================
   ConectaVoucher — Painel do Administrador
   Navegação + dados ao vivo (vendas/relatório/settings quando
   servido por HTTP) + gerador de configuração da MikroTik.
   Sem backend (file://), mostra os dados de exemplo do HTML.
   ========================================================= */

const PAGES = ['dashboard', 'eventos', 'planos', 'vendas', 'relatorios', 'config'];
const TITLES = {
  dashboard: 'Dashboard', eventos: 'Eventos', planos: 'Planos',
  vendas: 'Vendas', relatorios: 'Relatórios', config: 'Configurações',
};

const API_BASE = location.protocol.startsWith('http') ? '/api' : null;
let apiOk = !!API_BASE;
async function api(path, opts) {
  const r = await fetch(API_BASE + path, opts);
  if (!r.ok) throw new Error('http ' + r.status);
  return r.json();
}
const jsonPost = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const BRL = (v) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const $ = (id) => document.getElementById(id);

// ---------- Login (simulado) ----------
const loginWrap = $('loginWrap');
const app = $('app');
$('loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  // TODO:BACKEND — POST /api/admin/login → JWT/sessão do organizador.
  loginWrap.style.display = 'none';
  app.classList.add('active');
  navigate('dashboard');
});
$('logoutBtn')?.addEventListener('click', () => {
  app.classList.remove('active');
  loginWrap.style.display = 'grid';
});

// ---------- Navegação ----------
function navigate(page) {
  if (!PAGES.includes(page)) return;
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  $('page-' + page).classList.add('active');
  document.querySelectorAll('[data-nav]').forEach((el) => el.classList.toggle('active', el.dataset.nav === page));
  if ($('pageTitle')) $('pageTitle').textContent = TITLES[page];
  if ($('mobileTitle')) $('mobileTitle').textContent = TITLES[page];
  document.querySelector('.main-body')?.scrollTo(0, 0);
  window.scrollTo(0, 0);
  if (page === 'relatorios') loadReport();       // usa mock sem backend
  if (!apiOk) return;
  if (page === 'vendas') loadSales(currentSalesFilter);
  if (page === 'config') loadSettings();
}
document.querySelectorAll('[data-nav]').forEach((el) => el.addEventListener('click', () => navigate(el.dataset.nav)));

// ====================================================== VENDAS
let currentSalesFilter = 'all';
let salesCache = [];

function statusPill(s) {
  if (s === 'paid') return '<span class="pill on">Pago</span>';
  if (s === 'pending') return '<span class="pill wait">Aguardando</span>';
  return '<span class="pill off">Expirado</span>';
}
const shortTxid = (t) => (t && t.length > 10 ? t.slice(0, 8) + '…' : t || '—');
const hhmm = (iso) => { try { return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); } catch { return '—'; } };

async function loadSales(filter) {
  try {
    const status = filter === 'all' ? '' : filter;
    const { sales } = await api('/admin/sales' + (status ? '?status=' + status : ''));
    salesCache = sales;
    const body = $('salesBody');
    body.innerHTML = sales.length
      ? sales.map((s) => `<tr>
          <td>${s.voucher}</td><td>${s.plan}</td><td>${BRL(s.amount)}</td>
          <td>${shortTxid(s.txid)}</td><td>${s.mac}</td>
          <td>${statusPill(s.status)}</td><td>${hhmm(s.paidAt || s.createdAt)}</td></tr>`).join('')
      : '<tr><td colspan="7" style="text-align:center;color:var(--ink-3);padding:22px">Nenhuma venda ainda.</td></tr>';
    // resumo
    const paid = sales.filter((s) => s.status === 'paid');
    const rev = paid.reduce((a, s) => a + s.amount, 0);
    $('sv-rev').textContent = BRL(rev);
    $('sv-paid').textContent = paid.length;
    $('sv-pending').textContent = sales.filter((s) => s.status === 'pending').length;
    $('sv-ticket').textContent = BRL(paid.length ? rev / paid.length : 0);
  } catch (e) { apiOk = false; }
}

$('salesFilters')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-sfilter]');
  if (!b) return;
  currentSalesFilter = b.dataset.sfilter;
  document.querySelectorAll('#salesFilters .filter').forEach((f) => f.classList.toggle('on', f === b));
  if (apiOk) loadSales(currentSalesFilter);
});

function downloadCSV(name, rows) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
$('salesExport')?.addEventListener('click', () => {
  const src = salesCache.length ? salesCache : [];
  const rows = [['Voucher', 'Plano', 'Valor', 'Txid', 'Dispositivo', 'Status', 'Quando']];
  (src.length ? src : readTableRows('salesBody')).forEach((s) =>
    Array.isArray(s) ? rows.push(s) : rows.push([s.voucher, s.plan, s.amount, s.txid, s.mac, s.status, s.paidAt || s.createdAt]));
  downloadCSV('vendas.csv', rows);
});
function readTableRows(tbodyId) {
  return [...document.querySelectorAll('#' + tbodyId + ' tr')].map((tr) =>
    [...tr.children].map((td) => td.innerText.trim()));
}

// ====================================================== RELATÓRIOS
let reportCache = null;

function mockReport() {
  const rev = [180, 240, 300, 150, 420, 380, 240];
  const byDay = rev.map((r, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    return { date: d.toISOString().slice(0, 10), revenue: r, count: Math.round(r / 12) };
  });
  return {
    totals: { revenue: 3860, vouchers: 312, ticket: 12.37, conversion: 64 },
    byPlan: [
      { time: '1 hora', count: 84, revenue: 420 },
      { time: '3 horas', count: 132, revenue: 1320 },
      { time: '6 horas', count: 54, revenue: 810 },
      { time: '12 horas', count: 18, revenue: 396 },
      { time: '24 horas', count: 24, revenue: 720 },
    ],
    byDay,
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
    return `<div class="cf-col"><div class="cf-val">${d.revenue ? 'R$' + d.revenue : ''}</div>
      <div class="cf-bars"><div class="cf-bar" style="height:${h}%"></div></div>
      <div class="cf-lbl">${wd}</div></div>`;
  }).join('');

  const maxP = Math.max(1, ...r.byPlan.map((p) => p.revenue));
  $('rp-byplan').innerHTML = r.byPlan.map((p) => `
    <div class="rep-row">
      <div class="rep-head"><span class="nm">${p.time}</span><span class="ct">${p.count} vendas</span><span class="amt">${BRL(p.revenue)}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round((p.revenue / maxP) * 100)}%"></div></div>
    </div>`).join('');
  reportCache = r;
}

async function loadReport() {
  if (!apiOk) return renderReport(mockReport());
  try { renderReport(await api('/admin/report')); }
  catch (e) { apiOk = false; renderReport(mockReport()); }
}
$('reportExport')?.addEventListener('click', () => {
  const rows = [['Plano', 'Vendas', 'Faturamento']];
  const src = reportCache ? reportCache.byPlan : [];
  src.forEach((p) => rows.push([p.time, p.count, p.revenue]));
  downloadCSV('relatorio-por-plano.csv', rows);
});

// ====================================================== CONFIGURAÇÕES (Efí)
async function loadSettings() {
  try {
    const s = await api('/admin/settings');
    $('efi-env').value = s.efi.env || 'producao';
    $('efi-clientId').value = s.efi.clientId || '';
    $('efi-pixKey').value = s.efi.pixKey || '';
    const st = $('efi-status');
    const ok = s.efi.clientId && s.efi.hasSecret;
    st.textContent = ok ? 'configurado' : 'não configurado';
    st.className = 'pill ' + (ok ? 'on' : 'off');
  } catch (e) { apiOk = false; }
}
$('efi-save')?.addEventListener('click', async () => {
  const efi = {
    env: $('efi-env').value,
    clientId: $('efi-clientId').value,
    clientSecret: $('efi-clientSecret').value,
    pixKey: $('efi-pixKey').value,
    webhookToken: $('efi-webhookToken').value,
  };
  $('efi-msg').textContent = 'Salvando…';
  if (!apiOk) { $('efi-msg').textContent = 'Protótipo: sem backend aqui.'; return; }
  try { await api('/admin/settings', jsonPost({ efi })); $('efi-msg').textContent = '✓ Salvo'; loadSettings(); }
  catch (e) { $('efi-msg').textContent = 'Erro ao salvar'; }
});
$('efi-webhook')?.addEventListener('click', async () => {
  $('efi-msg').textContent = 'Configurando webhook…';
  if (!apiOk) { $('efi-msg').textContent = 'Protótipo: sem backend aqui.'; return; }
  try { const r = await api('/efi/webhook', jsonPost({})); $('efi-msg').textContent = r.ok ? '✓ Webhook configurado' : (r.error || 'Falhou'); }
  catch (e) { $('efi-msg').textContent = 'Falhou (backend/efí)'; }
});

// ====================================================== GERADOR MikroTik
function buildRsc(v) {
  const ip = (v.lan.split('/')[0] || '10.10.0.1').trim();
  const net = ip.replace(/\.\d+$/, '.0');
  const walledPortal = v.portal ? `add dst-host=${v.portal} comment="Portal ConectaVoucher"` : `# add dst-host=SEU_DOMINIO comment="Portal ConectaVoucher"`;
  return `# =============================================================================
#  ConectaVoucher - Configuracao gerada pelo painel (Hotspot + WireGuard)
#  Importe no roteador:  /import file-name=conectavoucher.rsc
#  Faca backup antes:    /system backup save name=antes-conectavoucher
# =============================================================================

# ---- WAN (ether1, DHCP client) ----
/ip dhcp-client
add interface=ether1 disabled=no use-peer-dns=yes add-default-route=yes comment="WAN ConectaVoucher"

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
# Walled-garden: Efi + portal sempre acessiveis
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

# Pegue a chave publica da MikroTik p/ cadastrar como peer no VPS:
:put [/interface/wireguard/get wg-cv public-key]
# No backend/.env:  MIKROTIK_HOST=${v.wgPeer}  MIKROTIK_USER=${v.apiUser}
#
# IMPORTANTE: suba tambem o login.html gerado (botao "Baixar login.html")
# para a pasta /hotspot (Winbox -> Files). Ele redireciona o celular para o
# portal de compra levando o MAC e os links do Hotspot.
`;
}

function buildLoginHtml(portalDomain) {
  const url = portalDomain
    ? (/^https?:\/\//.test(portalDomain) ? portalDomain.replace(/\/$/, '') + '/portal.html' : 'https://' + portalDomain + '/portal.html')
    : 'https://conectavoucher.seudominio.com/portal.html';
  return `<!doctype html>
<!-- ConectaVoucher — login do Hotspot: redireciona o celular para o portal. -->
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ConectaVoucher</title></head>
<body>
  <script type="text/javascript">
    (function(){
      var portal = "${url}";
      var q = "?mac=$(mac)&ip=$(ip)&link-login-only=" + encodeURIComponent("$(link-login-only)") + "&link-orig=" + encodeURIComponent("$(link-orig)");
      location.href = portal + q;
    })();
  </script>
  <noscript><a href="${url}">Toque para comprar acesso à internet</a></noscript>
</body></html>
`;
}

let lastRsc = '';
$('gen-run')?.addEventListener('click', () => {
  const v = {
    hotspot: $('gen-hotspot').value.trim() || 'ConectaVoucher',
    lan: $('gen-lan').value.trim() || '10.10.0.1/24',
    dhcpFrom: $('gen-dhcpFrom').value.trim() || '10.10.0.10',
    dhcpTo: $('gen-dhcpTo').value.trim() || '10.10.0.254',
    dns: $('gen-dns').value.trim() || '1.1.1.1,8.8.8.8',
    portal: $('gen-portal').value.trim(),
    apiUser: $('gen-apiUser').value.trim() || 'api',
    apiPass: $('gen-apiPass').value.trim() || 'TROQUE_ESTA_SENHA',
    wgEndpoint: $('gen-wgEndpoint').value.trim() || 'IP_PUBLICO_DO_VPS',
    wgPort: $('gen-wgPort').value.trim() || '51820',
    wgKey: $('gen-wgKey').value.trim() || 'CHAVE_PUBLICA_DO_VPS',
    wgPeer: $('gen-wgPeer').value.trim() || '10.20.0.2',
  };
  lastRsc = buildRsc(v);
  lastLoginHtml = buildLoginHtml(v.portal);
  const out = $('gen-output');
  out.textContent = lastRsc;
  out.hidden = false;
  $('gen-copy').disabled = false;
  $('gen-download').disabled = false;
  $('gen-login').disabled = false;
});
let lastLoginHtml = '';
function downloadText(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}
$('gen-login')?.addEventListener('click', () => downloadText('login.html', lastLoginHtml, 'text/html'));
$('gen-copy')?.addEventListener('click', () => {
  navigator.clipboard?.writeText(lastRsc);
  const b = $('gen-copy'); b.textContent = 'Copiado!'; setTimeout(() => (b.textContent = 'Copiar'), 1500);
});
$('gen-download')?.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([lastRsc], { type: 'text/plain' }));
  const a = document.createElement('a'); a.href = url; a.download = 'conectavoucher.rsc'; a.click();
  URL.revokeObjectURL(url);
});
