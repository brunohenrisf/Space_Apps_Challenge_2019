// Repositório de dados (Prisma) — multi-tenant.
import { prisma } from './db';
import { DEFAULT_PLANS } from './plans';
import { config } from './config';

// ============================================================ Bootstrap
/** Cria o organizador padrão (semeia a conta Efí a partir do .env). */
export async function ensureDefaultOrganizer() {
  const existing = await prisma.organizer.findFirst({ orderBy: { createdAt: 'asc' } });
  if (existing) return existing;
  return prisma.organizer.create({
    data: {
      name: 'Meu Evento',
      efiEnv: config.efi.env,
      efiClientId: config.efi.clientId,
      efiClientSecret: config.efi.clientSecret,
      efiPixKey: config.efi.pixKey,
      efiWebhookToken: config.efi.webhookToken,
    },
  });
}

/** Cria o evento padrão + planos, se o organizador ainda não tiver eventos. */
export async function ensureDefaultEvent(organizerId: string) {
  const existing = await prisma.event.findFirst({ where: { organizerId }, orderBy: { createdAt: 'asc' } });
  if (existing) return existing;
  const event = await prisma.event.create({
    data: { organizerId, slug: 'principal', name: 'Meu Evento', courtesySeconds: config.courtesySeconds },
  });
  await seedPlansForEvent(event.id);
  return event;
}

export async function seedPlansForEvent(eventId: string) {
  const count = await prisma.plan.count({ where: { eventId } });
  if (count > 0) return;
  await prisma.plan.createMany({
    data: DEFAULT_PLANS.map((p, i) => ({
      eventId, code: p.id, label: p.time, minutes: p.minutes, price: p.price,
      descr: p.desc, badge: p.badge ?? null, sort: i,
    })),
  });
}

// ============================================================ Organizador
export function getOrganizer(id: string) {
  return prisma.organizer.findUnique({ where: { id } });
}
export function publicOrganizer(o: NonNullable<Awaited<ReturnType<typeof getOrganizer>>>) {
  return {
    id: o.id, name: o.name,
    efi: { env: o.efiEnv, clientId: o.efiClientId, pixKey: o.efiPixKey, hasSecret: !!o.efiClientSecret, webhookConfigured: o.efiWebhookConfigured },
  };
}
export async function saveEfi(organizerId: string, e: any) {
  const data: any = {};
  const set = (k: string, v: any) => { if (v !== undefined && v !== '') data[k] = v; };
  set('efiEnv', e.env); set('efiClientId', e.clientId); set('efiClientSecret', e.clientSecret);
  set('efiPixKey', e.pixKey); set('efiWebhookToken', e.webhookToken);
  await prisma.organizer.update({ where: { id: organizerId }, data });
}
export async function setWebhookConfigured(organizerId: string, v: boolean) {
  await prisma.organizer.update({ where: { id: organizerId }, data: { efiWebhookConfigured: v } });
}

// ============================================================ Eventos
export function listEvents(organizerId: string) {
  return prisma.event.findMany({ where: { organizerId }, orderBy: { createdAt: 'asc' } });
}
export function getEvent(id: string) {
  return prisma.event.findUnique({ where: { id } });
}
export function getEventBySlug(slug: string) {
  return prisma.event.findUnique({ where: { slug } });
}
export function getFirstEvent() {
  return prisma.event.findFirst({ orderBy: { createdAt: 'asc' } });
}
export function getPlan(id: string) {
  return prisma.plan.findUnique({ where: { id } });
}
export function getEventWithOrg(id: string) {
  return prisma.event.findUnique({ where: { id }, include: { organizer: true } });
}
export async function createEvent(organizerId: string, name: string, slug: string) {
  const event = await prisma.event.create({ data: { organizerId, name, slug, courtesySeconds: config.courtesySeconds } });
  await seedPlansForEvent(event.id);
  return event;
}
export async function updateEvent(id: string, b: any) {
  const data: any = {};
  const set = (k: string, v: any) => { if (v !== undefined && v !== '') data[k] = v; };
  const num = (k: string, v: any) => { if (v !== undefined && v !== '') data[k] = Number(v); };
  set('name', b.name);
  num('courtesySeconds', b.courtesySeconds); num('mkPort', b.mkPort); num('wgVpsPort', b.wgVpsPort);
  if (typeof b.mkTls === 'boolean') data.mkTls = b.mkTls;
  set('mkHotspotProfile', b.mkHotspotProfile);
  set('lanCidr', b.lanCidr); set('dhcpFrom', b.dhcpFrom); set('dhcpTo', b.dhcpTo); set('dns', b.dns);
  set('hotspotName', b.hotspotName); set('portalDomain', b.portalDomain);
  set('apiUser', b.apiUser); set('apiPassword', b.apiPassword);
  set('wgVpsPublicKey', b.wgVpsPublicKey); set('wgVpsEndpoint', b.wgVpsEndpoint); set('wgPeerAddress', b.wgPeerAddress);
  if (typeof b.active === 'boolean') data.active = b.active;
  return prisma.event.update({ where: { id }, data });
}
export function publicEvent(e: NonNullable<Awaited<ReturnType<typeof getEvent>>>) {
  return {
    id: e.id, slug: e.slug, name: e.name, active: e.active, courtesySeconds: e.courtesySeconds,
    mkPort: e.mkPort, mkTls: e.mkTls, mkHotspotProfile: e.mkHotspotProfile,
    lanCidr: e.lanCidr, dhcpFrom: e.dhcpFrom, dhcpTo: e.dhcpTo, dns: e.dns,
    hotspotName: e.hotspotName, portalDomain: e.portalDomain, apiUser: e.apiUser,
    apiPassword: e.apiPassword ? '********' : '',
    wgVpsPublicKey: e.wgVpsPublicKey, wgVpsEndpoint: e.wgVpsEndpoint, wgVpsPort: e.wgVpsPort, wgPeerAddress: e.wgPeerAddress,
  };
}

// ============================================================ Planos
export async function planCatalog(eventId: string) {
  const plans = await prisma.plan.findMany({ where: { eventId, active: true }, orderBy: { sort: 'asc' } });
  return plans.map((p) => ({ id: p.code, time: p.label, minutes: p.minutes, price: p.price, desc: p.descr, badge: p.badge ?? undefined }));
}
export function listPlans(eventId: string) {
  return prisma.plan.findMany({ where: { eventId }, orderBy: { sort: 'asc' } });
}
export function findPlan(eventId: string, code: string) {
  return prisma.plan.findUnique({ where: { eventId_code: { eventId, code } } });
}
export async function createPlan(eventId: string, b: any) {
  const count = await prisma.plan.count({ where: { eventId } });
  return prisma.plan.create({
    data: {
      eventId, code: String(b.code), label: String(b.label), minutes: Number(b.minutes),
      price: Number(b.price), descr: b.descr ?? '', badge: b.badge || null, sort: count,
    },
  });
}
export function updatePlan(id: string, b: any) {
  const data: any = {};
  if (b.label !== undefined) data.label = b.label;
  if (b.minutes !== undefined) data.minutes = Number(b.minutes);
  if (b.price !== undefined) data.price = Number(b.price);
  if (b.descr !== undefined) data.descr = b.descr;
  if (b.badge !== undefined) data.badge = b.badge || null;
  if (typeof b.active === 'boolean') data.active = b.active;
  return prisma.plan.update({ where: { id }, data });
}

// ============================================================ Pedidos
export function createOrder(data: {
  eventId: string; txid: string; planCode: string; planLabel: string; minutes: number; amount: number; mac?: string;
}) {
  return prisma.order.create({ data });
}
export function getOrder(txid: string) {
  return prisma.order.findUnique({ where: { txid } });
}
export function setOrderPaid(txid: string, v: { voucherLogin: string; voucherPassword: string; expiresAt: Date }) {
  return prisma.order.update({ where: { txid }, data: { status: 'paid', paidAt: new Date(), ...v } });
}

type OrderRow = NonNullable<Awaited<ReturnType<typeof getOrder>>>;
function toSale(o: OrderRow) {
  return {
    txid: o.txid, voucher: o.voucherLogin ?? '—', plan: o.planLabel, planId: o.planCode,
    amount: o.amount, mac: o.mac ?? '—', status: o.status,
    createdAt: o.createdAt.toISOString(), paidAt: o.paidAt?.toISOString(),
  };
}

export async function listSales(eventId: string, status?: string, planCode?: string) {
  const where: any = { eventId };
  if (status) where.status = status;
  if (planCode) where.planCode = planCode;
  const rows = await prisma.order.findMany({ where, orderBy: { createdAt: 'desc' } });
  return rows.map(toSale);
}

export async function buildReport(eventId: string) {
  const all = await prisma.order.findMany({ where: { eventId } });
  const paid = all.filter((o) => o.status === 'paid');
  const revenue = paid.reduce((s, o) => s + o.amount, 0);

  const plans = await prisma.plan.findMany({ where: { eventId }, orderBy: { sort: 'asc' } });
  const byPlan = plans.map((p) => {
    const ps = paid.filter((o) => o.planCode === p.code);
    return { planId: p.code, time: p.label, count: ps.length, revenue: ps.reduce((s, o) => s + o.amount, 0) };
  });

  const byDay: { date: string; revenue: number; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const ds = paid.filter((o) => o.paidAt && o.paidAt.toISOString().slice(0, 10) === key);
    byDay.push({ date: key, revenue: ds.reduce((s, o) => s + o.amount, 0), count: ds.length });
  }

  return {
    totals: {
      vouchers: paid.length, revenue, orders: all.length,
      pending: all.filter((o) => o.status === 'pending').length,
      ticket: paid.length ? Math.round((revenue / paid.length) * 100) / 100 : 0,
      conversion: all.length ? Math.round((paid.length / all.length) * 100) : 0,
    },
    byPlan, byDay,
  };
}

// ============================================================ Admin users
export function countAdmins() {
  return prisma.adminUser.count();
}
export function getAdminByEmail(email: string) {
  return prisma.adminUser.findUnique({ where: { email } });
}
export function createAdmin(email: string, passwordHash: string, organizerId: string) {
  return prisma.adminUser.create({ data: { email, passwordHash, organizerId } });
}
