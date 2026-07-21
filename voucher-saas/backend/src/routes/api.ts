import { Router, Request, Response } from 'express';
import {
  createImmediateCharge, getChargeStatus, verifyWebhook, configureWebhook,
  efiCredsFromAccount, isEfiConfigured,
} from '../services/efi';
import { provisionVoucher, grantCourtesyAccess, pingRouter, mkConnFromAccount } from '../services/mikrotik';
import { config } from '../config';
import * as store from '../store';
import { requireAuth, signToken, verifyPassword } from '../auth';

const router = Router();

// Resolve a conta do portal: por slug (?ac=) ou a primeira (fallback).
async function resolveAccount(slug?: string) {
  if (slug) return store.getAccountBySlug(slug);
  return store.getFirstAccount();
}

// =============================================================== Público (portal)
router.get('/plans', async (req: Request, res: Response) => {
  const acc = await resolveAccount(req.query.ac ? String(req.query.ac) : undefined);
  if (!acc) return res.status(404).json({ error: 'conta não encontrada' });
  res.json({ account: { slug: acc.slug, name: acc.name }, plans: await store.planCatalog(acc.id) });
});

router.post('/courtesy', async (req: Request, res: Response) => {
  const acc = await resolveAccount(req.body?.ac);
  if (!acc) return res.status(404).json({ error: 'conta não encontrada' });
  await grantCourtesyAccess(mkConnFromAccount(acc), String(req.body?.mac ?? 'unknown'), acc.courtesySeconds);
  res.json({ ok: true, seconds: acc.courtesySeconds });
});

router.post('/checkout', async (req: Request, res: Response) => {
  const acc = await resolveAccount(req.body?.ac);
  if (!acc) return res.status(404).json({ error: 'conta não encontrada' });
  const plan = await store.findPlan(acc.id, String(req.body?.planId));
  if (!plan) return res.status(400).json({ error: 'plano inválido' });

  const charge = await createImmediateCharge(efiCredsFromAccount(acc), { amount: plan.price, planId: plan.code, deviceMac: req.body?.mac });
  await store.createOrder({
    accountId: acc.id, txid: charge.txid, planCode: plan.code, planLabel: plan.label,
    minutes: plan.minutes, amount: plan.price, mac: req.body?.mac,
  });
  res.json({ txid: charge.txid, qrcodeImage: charge.qrcodeImage, pixCopiaECola: charge.pixCopiaECola, amount: charge.amount });
});

// Confirma o pagamento: provisiona na MikroTik da conta e marca pago (idempotente).
async function confirmAndProvision(order: NonNullable<Awaited<ReturnType<typeof store.getOrder>>>) {
  if (order.status === 'paid') return order;
  const acc = await store.getAccount(order.accountId);
  if (!acc) return order;
  const access = await provisionVoucher(mkConnFromAccount(acc), { minutes: order.minutes, mac: order.mac ?? undefined });
  return store.setOrderPaid(order.txid, { voucherLogin: access.login, voucherPassword: access.password, expiresAt: access.expiresAt });
}

router.get('/checkout/:txid/status', async (req: Request, res: Response) => {
  let order = await store.getOrder(req.params.txid);
  if (!order) return res.status(404).json({ error: 'não encontrado' });
  if (order.status === 'pending') {
    const acc = await store.getAccount(order.accountId);
    const remote = acc ? await getChargeStatus(efiCredsFromAccount(acc), order.txid) : 'ATIVA';
    if (remote === 'CONCLUIDA') order = await confirmAndProvision(order);
  }
  res.json({ status: order.status, voucherLogin: order.voucherLogin, voucherPassword: order.voucherPassword, expiresAt: order.expiresAt?.toISOString() });
});

// Webhook da Efí: POST /api/webhook/efi[/pix]?acc=<id>&hmac=<token>
async function efiWebhookHandler(req: Request, res: Response) {
  const accId = req.query.acc ? String(req.query.acc) : '';
  const acc = accId ? await store.getAccount(accId) : null;
  const hmac = typeof req.query.hmac === 'string' ? req.query.hmac : undefined;
  const secret = acc ? efiCredsFromAccount(acc).webhookToken : '';
  if (!verifyWebhook({ hmac, token: req.header('x-efi-token') }, secret)) {
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

// =============================================================== Auth
router.post('/admin/login', async (req: Request, res: Response) => {
  const email = String(req.body?.email ?? '').toLowerCase().trim();
  const user = await store.getAdminByEmail(email);
  if (!user || !verifyPassword(String(req.body?.password ?? ''), user.passwordHash)) {
    return res.status(401).json({ error: 'credenciais inválidas' });
  }
  res.json({ token: signToken({ sub: user.email, acc: user.accountId }), email: user.email });
});
router.get('/admin/me', requireAuth, async (req: Request, res: Response) => {
  const acc = await store.getAccount(accId(req));
  res.json({ email: (req as any).adminEmail, account: acc ? { id: acc.id, name: acc.name, slug: acc.slug } : null });
});

// =============================================================== Admin (protegido)
const accId = (req: Request) => (req as any).accountId as string;

// ----- Conta (Efí + rede/MikroTik) -----
router.get('/admin/account', requireAuth, async (req: Request, res: Response) => {
  res.json(store.publicAccount((await store.getAccount(accId(req)))!));
});
router.post('/admin/efi', requireAuth, async (req: Request, res: Response) => {
  await store.saveEfi(accId(req), req.body?.efi ?? {});
  res.json({ ok: true, account: store.publicAccount((await store.getAccount(accId(req)))!) });
});
router.post('/admin/network', requireAuth, async (req: Request, res: Response) => {
  await store.updateAccount(accId(req), req.body ?? {});
  res.json({ ok: true, account: store.publicAccount((await store.getAccount(accId(req)))!) });
});
router.post('/admin/efi/webhook', requireAuth, async (req: Request, res: Response) => {
  const acc = await store.getAccount(accId(req));
  const creds = efiCredsFromAccount(acc!);
  const url = `${config.publicUrl}/api/webhook/efi?acc=${acc!.id}&hmac=${creds.webhookToken}`;
  const result = await configureWebhook(creds, url);
  if (result.ok) await store.setWebhookConfigured(acc!.id, true);
  res.status(result.ok ? 200 : 400).json(result);
});

// ----- Planos -----
router.get('/admin/plans', requireAuth, async (req: Request, res: Response) => {
  res.json({ plans: await store.listPlans(accId(req)) });
});
router.post('/admin/plans', requireAuth, async (req: Request, res: Response) => {
  res.json(await store.createPlan(accId(req), req.body ?? {}));
});
router.post('/admin/plans/:id', requireAuth, async (req: Request, res: Response) => {
  const plan = await store.getPlan(req.params.id);
  if (!plan || plan.accountId !== accId(req)) return res.status(404).json({ error: 'plano não encontrado' });
  res.json(await store.updatePlan(plan.id, req.body ?? {}));
});

// ----- Vendas / relatório / status -----
router.get('/admin/sales', requireAuth, async (req: Request, res: Response) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  res.json({ sales: await store.listSales(accId(req), status) });
});
router.get('/admin/report', requireAuth, async (req: Request, res: Response) => {
  res.json(await store.buildReport(accId(req)));
});
router.get('/admin/status', requireAuth, async (req: Request, res: Response) => {
  const acc = await store.getAccount(accId(req));
  const routerStatus = await pingRouter(mkConnFromAccount(acc!));
  res.json({
    courtesySeconds: acc!.courtesySeconds,
    efi: { configured: isEfiConfigured(efiCredsFromAccount(acc!)) },
    mikrotik: routerStatus,
  });
});

export default router;
