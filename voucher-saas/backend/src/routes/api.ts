import { Router, Request, Response } from 'express';
import {
  createImmediateCharge, getChargeStatus, verifyWebhook, configureWebhook,
  efiCredsFromOrganizer, isEfiConfigured,
} from '../services/efi';
import { provisionVoucher, grantCourtesyAccess, pingRouter, mkConnFromEvent } from '../services/mikrotik';
import { config } from '../config';
import * as store from '../store';
import { requireAuth, signToken, verifyPassword } from '../auth';

const router = Router();

// Resolve o evento do portal: por slug (?event=) ou o primeiro (fallback).
async function resolveEvent(slug?: string) {
  if (slug) return store.getEventBySlug(slug);
  return store.getFirstEvent();
}

// =============================================================== Público (portal)
router.get('/plans', async (req: Request, res: Response) => {
  const event = await resolveEvent(req.query.event ? String(req.query.event) : undefined);
  if (!event) return res.status(404).json({ error: 'evento não encontrado' });
  res.json({ event: { slug: event.slug, name: event.name }, plans: await store.planCatalog(event.id) });
});

router.post('/courtesy', async (req: Request, res: Response) => {
  const event = await resolveEvent(req.body?.event);
  if (!event) return res.status(404).json({ error: 'evento não encontrado' });
  await grantCourtesyAccess(mkConnFromEvent(event), String(req.body?.mac ?? 'unknown'), event.courtesySeconds);
  res.json({ ok: true, seconds: event.courtesySeconds });
});

router.post('/checkout', async (req: Request, res: Response) => {
  const event = await resolveEvent(req.body?.event);
  if (!event) return res.status(404).json({ error: 'evento não encontrado' });
  const plan = await store.findPlan(event.id, String(req.body?.planId));
  if (!plan) return res.status(400).json({ error: 'plano inválido' });

  const org = await store.getOrganizer(event.organizerId);
  const charge = await createImmediateCharge(efiCredsFromOrganizer(org!), { amount: plan.price, planId: plan.code, deviceMac: req.body?.mac });
  await store.createOrder({
    eventId: event.id, txid: charge.txid, planCode: plan.code, planLabel: plan.label,
    minutes: plan.minutes, amount: plan.price, mac: req.body?.mac,
  });
  res.json({ txid: charge.txid, qrcodeImage: charge.qrcodeImage, pixCopiaECola: charge.pixCopiaECola, amount: charge.amount });
});

// Confirma o pagamento: provisiona na MikroTik do evento e marca pago (idempotente).
async function confirmAndProvision(order: NonNullable<Awaited<ReturnType<typeof store.getOrder>>>) {
  if (order.status === 'paid') return order;
  const event = await store.getEvent(order.eventId);
  if (!event) return order;
  const access = await provisionVoucher(mkConnFromEvent(event), { minutes: order.minutes, mac: order.mac ?? undefined });
  return store.setOrderPaid(order.txid, { voucherLogin: access.login, voucherPassword: access.password, expiresAt: access.expiresAt });
}

router.get('/checkout/:txid/status', async (req: Request, res: Response) => {
  let order = await store.getOrder(req.params.txid);
  if (!order) return res.status(404).json({ error: 'não encontrado' });
  if (order.status === 'pending') {
    const event = await store.getEvent(order.eventId);
    const org = event ? await store.getOrganizer(event.organizerId) : null;
    const remote = org ? await getChargeStatus(efiCredsFromOrganizer(org), order.txid) : 'ATIVA';
    if (remote === 'CONCLUIDA') order = await confirmAndProvision(order);
  }
  res.json({ status: order.status, voucherLogin: order.voucherLogin, voucherPassword: order.voucherPassword, expiresAt: order.expiresAt?.toISOString() });
});

// Webhook da Efí: POST /api/webhook/efi[/pix]?org=<id>&hmac=<token>
async function efiWebhookHandler(req: Request, res: Response) {
  const orgId = req.query.org ? String(req.query.org) : '';
  const org = orgId ? await store.getOrganizer(orgId) : null;
  const hmac = typeof req.query.hmac === 'string' ? req.query.hmac : undefined;
  const secret = org ? efiCredsFromOrganizer(org).webhookToken : '';
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
  res.json({ token: signToken({ sub: user.email, org: user.organizerId }), email: user.email });
});
router.get('/admin/me', requireAuth, async (req: Request, res: Response) => {
  const org = await store.getOrganizer((req as any).organizerId);
  res.json({ email: (req as any).adminEmail, organizer: org ? { id: org.id, name: org.name } : null });
});

// =============================================================== Admin (protegido)
const orgId = (req: Request) => (req as any).organizerId as string;

// Garante que o evento pertence ao organizador autenticado.
async function ownedEvent(req: Request, res: Response) {
  const event = await store.getEvent(req.params.id);
  if (!event || event.organizerId !== orgId(req)) { res.status(404).json({ error: 'evento não encontrado' }); return null; }
  return event;
}

function slugify(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'evento';
}
async function uniqueSlug(base: string) {
  let slug = base, i = 1;
  while (await store.getEventBySlug(slug)) slug = `${base}-${++i}`;
  return slug;
}

// ----- Eventos -----
router.get('/admin/events', requireAuth, async (req: Request, res: Response) => {
  const events = await store.listEvents(orgId(req));
  res.json({ events: events.map((e) => ({ id: e.id, slug: e.slug, name: e.name, active: e.active })) });
});
router.post('/admin/events', requireAuth, async (req: Request, res: Response) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'nome obrigatório' });
  const event = await store.createEvent(orgId(req), name, await uniqueSlug(slugify(name)));
  res.json({ id: event.id, slug: event.slug, name: event.name });
});
router.get('/admin/events/:id', requireAuth, async (req: Request, res: Response) => {
  const event = await ownedEvent(req, res); if (!event) return;
  res.json(store.publicEvent(event));
});
router.post('/admin/events/:id', requireAuth, async (req: Request, res: Response) => {
  const event = await ownedEvent(req, res); if (!event) return;
  await store.updateEvent(event.id, req.body ?? {});
  res.json({ ok: true, event: store.publicEvent((await store.getEvent(event.id))!) });
});

// ----- Planos (por evento) -----
router.get('/admin/events/:id/plans', requireAuth, async (req: Request, res: Response) => {
  const event = await ownedEvent(req, res); if (!event) return;
  res.json({ plans: await store.listPlans(event.id) });
});
router.post('/admin/events/:id/plans', requireAuth, async (req: Request, res: Response) => {
  const event = await ownedEvent(req, res); if (!event) return;
  res.json(await store.createPlan(event.id, req.body ?? {}));
});
router.post('/admin/events/:id/plans/:planId', requireAuth, async (req: Request, res: Response) => {
  const event = await ownedEvent(req, res); if (!event) return;
  const plan = await store.getPlan(req.params.planId);
  if (!plan || plan.eventId !== event.id) return res.status(404).json({ error: 'plano não encontrado' });
  res.json(await store.updatePlan(plan.id, req.body ?? {}));
});

// ----- Vendas / relatório / status (por evento) -----
router.get('/admin/events/:id/sales', requireAuth, async (req: Request, res: Response) => {
  const event = await ownedEvent(req, res); if (!event) return;
  const status = req.query.status ? String(req.query.status) : undefined;
  res.json({ sales: await store.listSales(event.id, status) });
});
router.get('/admin/events/:id/report', requireAuth, async (req: Request, res: Response) => {
  const event = await ownedEvent(req, res); if (!event) return;
  res.json(await store.buildReport(event.id));
});
router.get('/admin/events/:id/status', requireAuth, async (req: Request, res: Response) => {
  const event = await ownedEvent(req, res); if (!event) return;
  const org = await store.getOrganizer(orgId(req));
  const [routerStatus] = await Promise.all([pingRouter(mkConnFromEvent(event))]);
  res.json({
    courtesySeconds: event.courtesySeconds,
    efi: { configured: isEfiConfigured(efiCredsFromOrganizer(org!)) },
    mikrotik: routerStatus,
  });
});

// ----- Conta Efí (organizador) -----
router.get('/admin/account', requireAuth, async (req: Request, res: Response) => {
  const org = await store.getOrganizer(orgId(req));
  res.json(store.publicOrganizer(org!));
});
router.post('/admin/account', requireAuth, async (req: Request, res: Response) => {
  await store.saveEfi(orgId(req), req.body?.efi ?? {});
  res.json({ ok: true, account: store.publicOrganizer((await store.getOrganizer(orgId(req)))!) });
});
router.post('/admin/efi/webhook', requireAuth, async (req: Request, res: Response) => {
  const org = await store.getOrganizer(orgId(req));
  const creds = efiCredsFromOrganizer(org!);
  const url = `${config.publicUrl}/api/webhook/efi?org=${org!.id}&hmac=${creds.webhookToken}`;
  const result = await configureWebhook(creds, url);
  if (result.ok) await store.setWebhookConfigured(org!.id, true);
  res.status(result.ok ? 200 : 400).json(result);
});

export default router;
