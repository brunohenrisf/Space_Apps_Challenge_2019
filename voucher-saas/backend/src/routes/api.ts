import { Router, Request, Response } from 'express';
import {
  createImmediateCharge, getChargeStatus, verifyWebhook, configureWebhook,
  webhookSecret, efiConfiguredNow,
} from '../services/efi';
import { provisionVoucher, grantCourtesyAccess, pingRouter } from '../services/mikrotik';
import { config } from '../config';
import * as store from '../store';

const router = Router();

// GET /api/plans — catálogo de vouchers
router.get('/plans', async (_req: Request, res: Response) => {
  res.json({ plans: await store.listPlans() });
});

// POST /api/courtesy — libera a janela de cortesia ao conectar
router.post('/courtesy', async (req: Request, res: Response) => {
  const mac = String(req.body?.mac ?? 'unknown');
  await grantCourtesyAccess(mac, config.courtesySeconds);
  res.json({ ok: true, seconds: config.courtesySeconds });
});

// POST /api/checkout — cria a cobrança Pix na Efí
router.post('/checkout', async (req: Request, res: Response) => {
  const plan = await store.findPlan(String(req.body?.planId));
  if (!plan) return res.status(400).json({ error: 'plano inválido' });

  const charge = await createImmediateCharge({ amount: plan.price, planId: plan.code, deviceMac: req.body?.mac });
  await store.createOrder({
    txid: charge.txid, planCode: plan.code, planLabel: plan.label,
    minutes: plan.minutes, amount: plan.price, mac: req.body?.mac,
  });
  res.json({ txid: charge.txid, qrcodeImage: charge.qrcodeImage, pixCopiaECola: charge.pixCopiaECola, amount: charge.amount });
});

// Confirma o pagamento: provisiona no MikroTik e marca como pago (idempotente).
async function confirmAndProvision(order: NonNullable<Awaited<ReturnType<typeof store.getOrder>>>) {
  if (order.status === 'paid') return order;
  const access = await provisionVoucher({ minutes: order.minutes, mac: order.mac ?? undefined });
  return store.setOrderPaid(order.txid, {
    voucherLogin: access.login, voucherPassword: access.password, expiresAt: access.expiresAt,
  });
}

// GET /api/checkout/:txid/status — polling (fallback do webhook; também provisiona)
router.get('/checkout/:txid/status', async (req: Request, res: Response) => {
  let order = await store.getOrder(req.params.txid);
  if (!order) return res.status(404).json({ error: 'não encontrado' });
  if (order.status === 'pending') {
    const remote = await getChargeStatus(order.txid);
    if (remote === 'CONCLUIDA') order = await confirmAndProvision(order);
  }
  res.json({
    status: order.status, voucherLogin: order.voucherLogin,
    voucherPassword: order.voucherPassword, expiresAt: order.expiresAt?.toISOString(),
  });
});

// POST /api/webhook/efi[/pix] — Efí notifica o pagamento (acrescenta "/pix").
async function efiWebhookHandler(req: Request, res: Response) {
  const hmac = typeof req.query.hmac === 'string' ? req.query.hmac : undefined;
  if (!verifyWebhook({ hmac, token: req.header('x-efi-token') }, await webhookSecret())) {
    return res.status(401).json({ error: 'webhook não autorizado' });
  }
  const txids: string[] = (req.body?.pix ?? []).map((p: any) => p.txid).filter(Boolean);
  for (const txid of txids) {
    const order = await store.getOrder(txid);
    if (order && order.status === 'pending') await confirmAndProvision(order);
  }
  res.status(200).json({ ok: true });
}
router.post('/webhook/efi', efiWebhookHandler);
router.post('/webhook/efi/pix', efiWebhookHandler);

// POST /api/efi/webhook — (re)configura o webhook da chave Pix na Efí
router.post('/efi/webhook', async (_req: Request, res: Response) => {
  const result = await configureWebhook();
  if (result.ok) await store.setWebhookConfigured(true);
  res.status(result.ok ? 200 : 400).json(result);
});

// GET /api/status — saúde do roteador + Efí + cortesia
router.get('/status', async (_req: Request, res: Response) => {
  const [router, efiOk] = await Promise.all([pingRouter(), efiConfiguredNow()]);
  res.json({ courtesySeconds: config.courtesySeconds, efi: { configured: efiOk }, mikrotik: router });
});

// ---------------------------------------------------------------- Admin
router.get('/admin/sales', async (req: Request, res: Response) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  const planId = req.query.planId ? String(req.query.planId) : undefined;
  res.json({ sales: await store.listSales(status, planId) });
});

router.get('/admin/report', async (_req: Request, res: Response) => {
  res.json(await store.buildReport());
});

router.get('/admin/settings', async (_req: Request, res: Response) => {
  res.json(await store.publicSettings());
});

router.post('/admin/settings', async (req: Request, res: Response) => {
  res.json({ ok: true, settings: await store.saveSettings(req.body ?? {}) });
});

export default router;
