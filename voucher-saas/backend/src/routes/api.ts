import { Router, Request, Response } from 'express';
import { PLANS, findPlan } from '../plans';
import {
  createImmediateCharge,
  getChargeStatus,
  verifyWebhook,
  configureWebhook,
} from '../services/efi';
import { provisionVoucher, grantCourtesyAccess, pingRouter } from '../services/mikrotik';
import { config, efiConfigured } from '../config';

const router = Router();

// Memória temporária de cobranças (trocar por banco de dados no produto final).
type Order = {
  txid: string;
  planId: string;
  amount: number;
  mac?: string;
  status: 'pending' | 'paid';
  voucherLogin?: string;
  voucherPassword?: string;
  expiresAt?: string;
  createdAt: string;
  paidAt?: string;
};
const orders = new Map<string, Order>();

// Configurações do organizador em memória (trocar por banco no multi-tenant).
// Segredos são guardados mas nunca devolvidos pela API (só um booleano).
const settings = {
  efi: { env: 'producao', clientId: '', clientSecret: '', pixKey: '', webhookToken: '', webhookConfigured: false },
  network: {
    lanCidr: '10.10.0.1/24', dhcpFrom: '10.10.0.10', dhcpTo: '10.10.0.254',
    dns: '1.1.1.1,8.8.8.8', hotspotName: 'ConectaVoucher', portalDomain: '',
    apiUser: 'api', apiPassword: '',
  },
  wireguard: { vpsPublicKey: '', vpsEndpoint: '', vpsPort: 51820, peerAddress: '10.20.0.2' },
};
function publicSettings() {
  const s = settings;
  return {
    efi: { env: s.efi.env, clientId: s.efi.clientId, pixKey: s.efi.pixKey, hasSecret: !!s.efi.clientSecret, webhookConfigured: s.efi.webhookConfigured },
    network: { ...s.network, apiPassword: s.network.apiPassword ? '********' : '' },
    wireguard: s.wireguard,
  };
}

// GET /api/plans — catálogo de vouchers
router.get('/plans', (_req: Request, res: Response) => {
  res.json({ plans: PLANS });
});

// POST /api/courtesy — libera a janela de cortesia ao conectar
router.post('/courtesy', async (req: Request, res: Response) => {
  const mac = String(req.body?.mac ?? 'unknown');
  const seconds = Number(process.env.COURTESY_WINDOW_SECONDS ?? 180);
  await grantCourtesyAccess(mac, seconds);
  res.json({ ok: true, seconds });
});

// POST /api/checkout — cria a cobrança Pix na Efí
router.post('/checkout', async (req: Request, res: Response) => {
  const plan = findPlan(String(req.body?.planId));
  if (!plan) return res.status(400).json({ error: 'plano inválido' });

  const charge = await createImmediateCharge({
    amount: plan.price,
    planId: plan.id,
    deviceMac: req.body?.mac,
  });
  orders.set(charge.txid, {
    txid: charge.txid,
    planId: plan.id,
    amount: plan.price,
    mac: req.body?.mac,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });

  res.json({
    txid: charge.txid,
    qrcodeImage: charge.qrcodeImage,
    pixCopiaECola: charge.pixCopiaECola,
    amount: charge.amount,
  });
});

// GET /api/checkout/:txid/status — polling (fallback do webhook)
router.get('/checkout/:txid/status', async (req: Request, res: Response) => {
  const order = orders.get(req.params.txid);
  if (!order) return res.status(404).json({ error: 'não encontrado' });
  if (order.status === 'pending') {
    const remote = await getChargeStatus(order.txid);
    if (remote === 'CONCLUIDA') order.status = 'paid';
  }
  res.json({
    status: order.status,
    voucherLogin: order.voucherLogin,
    voucherPassword: order.voucherPassword,
    expiresAt: order.expiresAt,
  });
});

// Provisiona os txids pagos que ainda estão pendentes.
async function processPaidTxids(txids: string[]): Promise<void> {
  for (const txid of txids) {
    const order = orders.get(txid);
    if (!order || order.status === 'paid') continue;
    const plan = findPlan(order.planId)!;
    // Confirma → provisiona o voucher no MikroTik com o tempo do plano.
    const access = await provisionVoucher({ minutes: plan.minutes, mac: order.mac });
    order.status = 'paid';
    order.paidAt = new Date().toISOString();
    order.voucherLogin = access.login;
    order.voucherPassword = access.password;
    order.expiresAt = access.expiresAt.toISOString();
  }
}

// POST /api/webhook/efi[/pix] — Efí notifica o pagamento.
// A Efí acrescenta "/pix" à URL configurada, por isso as duas rotas.
async function efiWebhookHandler(req: Request, res: Response) {
  const hmac = typeof req.query.hmac === 'string' ? req.query.hmac : undefined;
  if (!verifyWebhook({ hmac, token: req.header('x-efi-token') })) {
    return res.status(401).json({ error: 'webhook não autorizado' });
  }
  const paid: string[] = (req.body?.pix ?? []).map((p: any) => p.txid).filter(Boolean);
  await processPaidTxids(paid);
  res.status(200).json({ ok: true }); // Efí espera 200
}
router.post('/webhook/efi', efiWebhookHandler);
router.post('/webhook/efi/pix', efiWebhookHandler);

// POST /api/efi/webhook — (re)configura o webhook da chave Pix na Efí
router.post('/efi/webhook', async (_req: Request, res: Response) => {
  const result = await configureWebhook();
  res.status(result.ok ? 200 : 400).json(result);
});

// GET /api/status — usado pelo painel: saúde do roteador + Efí + cortesia
router.get('/status', async (_req: Request, res: Response) => {
  const router = await pingRouter();
  res.json({
    courtesySeconds: config.courtesySeconds,
    efi: { configured: efiConfigured, env: config.efi.env },
    mikrotik: router,
  });
});

// ---------------------------------------------------------------- Admin

function orderToSale(o: Order) {
  const plan = findPlan(o.planId);
  return {
    txid: o.txid,
    voucher: o.voucherLogin ?? '—',
    plan: plan?.time ?? o.planId,
    planId: o.planId,
    amount: o.amount,
    mac: o.mac ?? '—',
    status: o.status, // pending | paid
    createdAt: o.createdAt,
    paidAt: o.paidAt,
  };
}

// GET /api/admin/sales?status=&planId= — lista de vendas (filtro opcional)
router.get('/admin/sales', (req: Request, res: Response) => {
  const status = String(req.query.status ?? '');
  const planId = String(req.query.planId ?? '');
  let list = [...orders.values()].map(orderToSale);
  if (status) list = list.filter((s) => s.status === status);
  if (planId) list = list.filter((s) => s.planId === planId);
  list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ sales: list });
});

// GET /api/admin/report — agregados para o relatório
router.get('/admin/report', (_req: Request, res: Response) => {
  const all = [...orders.values()];
  const paid = all.filter((o) => o.status === 'paid');
  const revenue = paid.reduce((s, o) => s + o.amount, 0);

  const byPlan = PLANS.map((p) => {
    const ps = paid.filter((o) => o.planId === p.id);
    return { planId: p.id, time: p.time, count: ps.length, revenue: ps.reduce((s, o) => s + o.amount, 0) };
  });

  // faturamento dos últimos 7 dias (por paidAt)
  const days: { date: string; revenue: number; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const ds = paid.filter((o) => (o.paidAt ?? '').slice(0, 10) === key);
    days.push({ date: key, revenue: ds.reduce((s, o) => s + o.amount, 0), count: ds.length });
  }

  res.json({
    totals: {
      vouchers: paid.length,
      revenue,
      orders: all.length,
      pending: all.filter((o) => o.status === 'pending').length,
      ticket: paid.length ? Math.round((revenue / paid.length) * 100) / 100 : 0,
      conversion: all.length ? Math.round((paid.length / all.length) * 100) : 0,
    },
    byPlan,
    byDay: days,
  });
});

// GET /api/admin/settings — parâmetros (sem devolver segredos)
router.get('/admin/settings', (_req: Request, res: Response) => {
  res.json(publicSettings());
});

// POST /api/admin/settings — grava os parâmetros (merge parcial)
router.post('/admin/settings', (req: Request, res: Response) => {
  const b = req.body ?? {};
  if (b.efi) Object.assign(settings.efi, pick(b.efi, ['env', 'clientId', 'clientSecret', 'pixKey', 'webhookToken']));
  if (b.network) Object.assign(settings.network, pick(b.network, ['lanCidr', 'dhcpFrom', 'dhcpTo', 'dns', 'hotspotName', 'portalDomain', 'apiUser', 'apiPassword']));
  if (b.wireguard) Object.assign(settings.wireguard, pick(b.wireguard, ['vpsPublicKey', 'vpsEndpoint', 'vpsPort', 'peerAddress']));
  res.json({ ok: true, settings: publicSettings() });
});

function pick(obj: any, keys: string[]) {
  const out: any = {};
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== '') out[k] = obj[k];
  return out;
}

export default router;
