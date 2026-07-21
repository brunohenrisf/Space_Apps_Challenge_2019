import { Router, Request, Response } from 'express';
import {
  createImmediateCharge, getChargeStatus, verifyWebhook, configureWebhook,
  efiCredsFromAccount, isEfiConfigured,
} from '../services/efi';
import { provisionVoucher, grantCourtesyAccess, pingRouter, mkConnFromAccount } from '../services/mikrotik';
import { config } from '../config';
import * as store from '../store';
import { requireAuth, signToken, verifyPassword, hashPassword } from '../auth';
import { log } from '../services/log';

const router = Router();

// Rate limiting simples (por IP+rota) para endpoints sensíveis.
const rlHits = new Map<string, { count: number; ts: number }>();
function rateLimit(max: number, windowMs: number) {
  return (req: Request, res: Response, next: () => void) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const e = rlHits.get(key);
    if (!e || now - e.ts > windowMs) { rlHits.set(key, { count: 1, ts: now }); return next(); }
    if (++e.count > max) { log.warn('ratelimit.block', { ip: req.ip, path: req.path }); return res.status(429).json({ error: 'muitas tentativas, tente mais tarde' }); }
    next();
  };
}

function slugify(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'conta';
}
async function uniqueSlug(base: string) {
  let slug = base, i = 1;
  while (await store.getAccountBySlug(slug)) slug = `${base}-${++i}`;
  return slug;
}

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

// Confirma o pagamento: marca pago (pagamento é real) e provisiona na MikroTik.
// Se o provisionamento falhar, o pedido fica pago sem voucher e o job de
// reconciliação reprovisiona depois — o cliente que pagou nunca fica sem acesso.
async function confirmAndProvision(order: NonNullable<Awaited<ReturnType<typeof store.getOrder>>>) {
  if (order.status === 'paid') return order;
  const paid = await store.markOrderPaid(order.txid);
  log.info('payment.confirmed', { txid: order.txid, accountId: order.accountId, amount: order.amount });
  const acc = await store.getAccount(order.accountId);
  if (!acc) return paid;
  try {
    const access = await provisionVoucher(mkConnFromAccount(acc), { minutes: order.minutes, mac: order.mac ?? undefined });
    log.info('voucher.provisioned', { txid: order.txid, login: access.login });
    return store.setOrderVoucher(order.txid, { voucherLogin: access.login, voucherPassword: access.password, expiresAt: access.expiresAt });
  } catch (e: any) {
    log.warn('voucher.provision_failed', { txid: order.txid, error: e?.message });
    return paid; // reprovisionado pelo job de reconciliação
  }
}

// GET /api/voucher/active?ac=slug&mac=XX — voucher ativo do dispositivo (reconectar)
router.get('/voucher/active', async (req: Request, res: Response) => {
  const acc = await resolveAccount(req.query.ac ? String(req.query.ac) : undefined);
  const mac = req.query.mac ? String(req.query.mac) : '';
  if (!acc || !mac) return res.json({ active: null });
  const o = await store.getActiveVoucherByMac(acc.id, mac);
  res.json({ active: o ? { login: o.voucherLogin, password: o.voucherPassword, plan: o.planLabel, expiresAt: o.expiresAt?.toISOString() } : null });
});

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
router.get('/signup/open', (_req: Request, res: Response) => res.json({ open: config.allowSignup }));

router.post('/signup', rateLimit(5, 600_000), async (req: Request, res: Response) => {
  if (!config.allowSignup) return res.status(403).json({ error: 'cadastro fechado' });
  const name = String(req.body?.accountName ?? '').trim();
  const email = String(req.body?.email ?? '').toLowerCase().trim();
  const password = String(req.body?.password ?? '');
  if (!name || !/.+@.+\..+/.test(email) || password.length < 6) {
    return res.status(400).json({ error: 'dados inválidos (senha mínima de 6 caracteres)' });
  }
  if (await store.emailTaken(email)) return res.status(409).json({ error: 'e-mail já cadastrado' });
  const slug = await uniqueSlug(slugify(name));
  const account = await store.createAccountAndAdmin(name, slug, email, hashPassword(password));
  res.json({ token: signToken({ sub: email, acc: account.id }), email });
});

router.post('/admin/login', rateLimit(10, 300_000), async (req: Request, res: Response) => {
  const email = String(req.body?.email ?? '').toLowerCase().trim();
  const user = await store.getAdminByEmail(email);
  if (!user || !verifyPassword(String(req.body?.password ?? ''), user.passwordHash)) {
    return res.status(401).json({ error: 'credenciais inválidas' });
  }
  res.json({ token: signToken({ sub: user.email, acc: user.accountId }), email: user.email });
});

router.post('/admin/password', requireAuth, async (req: Request, res: Response) => {
  const email = (req as any).adminEmail as string;
  const user = await store.getAdminByEmail(email);
  if (!user || !verifyPassword(String(req.body?.current ?? ''), user.passwordHash)) {
    return res.status(401).json({ error: 'senha atual incorreta' });
  }
  const nw = String(req.body?.new ?? '');
  if (nw.length < 6) return res.status(400).json({ error: 'nova senha muito curta (mín. 6)' });
  await store.setAdminPassword(email, hashPassword(nw));
  res.json({ ok: true });
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
router.delete('/admin/plans/:id', requireAuth, async (req: Request, res: Response) => {
  const plan = await store.getPlan(req.params.id);
  if (!plan || plan.accountId !== accId(req)) return res.status(404).json({ error: 'plano não encontrado' });
  await store.deletePlan(plan.id);
  res.json({ ok: true });
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
