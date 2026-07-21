// Repositório de dados (Prisma) — multi-tenant por CONTA.
import { prisma } from './db';
import { DEFAULT_PLANS } from './plans';
import { config } from './config';

// ============================================================ Bootstrap
/** Cria a conta padrão (Efí do .env) + planos, se não houver nenhuma. */
export async function ensureDefaultAccount() {
  const existing = await prisma.account.findFirst({ orderBy: { createdAt: 'asc' } });
  if (existing) return existing;
  const account = await prisma.account.create({
    data: {
      slug: 'principal', name: 'Meu Evento',
      courtesySeconds: config.courtesySeconds,
      efiEnv: config.efi.env, efiClientId: config.efi.clientId, efiClientSecret: config.efi.clientSecret,
      efiPixKey: config.efi.pixKey, efiWebhookToken: config.efi.webhookToken,
    },
  });
  await seedPlans(account.id);
  return account;
}

export async function seedPlans(accountId: string) {
  const count = await prisma.plan.count({ where: { accountId } });
  if (count > 0) return;
  await prisma.plan.createMany({
    data: DEFAULT_PLANS.map((p, i) => ({
      accountId, code: p.id, label: p.time, minutes: p.minutes, price: p.price,
      descr: p.desc, badge: p.badge ?? null, sort: i,
    })),
  });
}

// ============================================================ Conta
export function getAccount(id: string) {
  return prisma.account.findUnique({ where: { id } });
}
export function getAccountBySlug(slug: string) {
  return prisma.account.findUnique({ where: { slug } });
}
export function getFirstAccount() {
  return prisma.account.findFirst({ orderBy: { createdAt: 'asc' } });
}

type AccountRow = NonNullable<Awaited<ReturnType<typeof getAccount>>>;
export function publicAccount(a: AccountRow) {
  return {
    id: a.id, slug: a.slug, name: a.name, courtesySeconds: a.courtesySeconds,
    efi: { env: a.efiEnv, clientId: a.efiClientId, pixKey: a.efiPixKey, hasSecret: !!a.efiClientSecret, webhookConfigured: a.efiWebhookConfigured },
    network: {
      mkPort: a.mkPort, mkTls: a.mkTls, mkHotspotProfile: a.mkHotspotProfile,
      lanCidr: a.lanCidr, dhcpFrom: a.dhcpFrom, dhcpTo: a.dhcpTo, dns: a.dns,
      hotspotName: a.hotspotName, portalDomain: a.portalDomain, apiUser: a.apiUser,
      apiPassword: a.apiPassword ? '********' : '',
      wgVpsPublicKey: a.wgVpsPublicKey, wgVpsEndpoint: a.wgVpsEndpoint, wgVpsPort: a.wgVpsPort, wgPeerAddress: a.wgPeerAddress,
    },
  };
}

export async function saveEfi(accountId: string, e: any) {
  const data: any = {};
  const set = (k: string, v: any) => { if (v !== undefined && v !== '') data[k] = v; };
  set('efiEnv', e.env); set('efiClientId', e.clientId); set('efiClientSecret', e.clientSecret);
  set('efiPixKey', e.pixKey); set('efiWebhookToken', e.webhookToken);
  await prisma.account.update({ where: { id: accountId }, data });
}
export async function setWebhookConfigured(accountId: string, v: boolean) {
  await prisma.account.update({ where: { id: accountId }, data: { efiWebhookConfigured: v } });
}

/** Atualiza nome/cortesia + rede/MikroTik (usado pelo gerador). */
export async function updateAccount(accountId: string, b: any) {
  const data: any = {};
  const set = (k: string, v: any) => { if (v !== undefined && v !== '') data[k] = v; };
  const num = (k: string, v: any) => { if (v !== undefined && v !== '') data[k] = Number(v); };
  set('name', b.name); num('courtesySeconds', b.courtesySeconds);
  num('mkPort', b.mkPort); if (typeof b.mkTls === 'boolean') data.mkTls = b.mkTls; set('mkHotspotProfile', b.mkHotspotProfile);
  set('lanCidr', b.lanCidr); set('dhcpFrom', b.dhcpFrom); set('dhcpTo', b.dhcpTo); set('dns', b.dns);
  set('hotspotName', b.hotspotName); set('portalDomain', b.portalDomain);
  set('apiUser', b.apiUser); set('apiPassword', b.apiPassword);
  set('wgVpsPublicKey', b.wgVpsPublicKey); set('wgVpsEndpoint', b.wgVpsEndpoint); num('wgVpsPort', b.wgVpsPort); set('wgPeerAddress', b.wgPeerAddress);
  await prisma.account.update({ where: { id: accountId }, data });
}

// ============================================================ Planos
export async function planCatalog(accountId: string) {
  const plans = await prisma.plan.findMany({ where: { accountId, active: true }, orderBy: { sort: 'asc' } });
  return plans.map((p) => ({ id: p.code, time: p.label, minutes: p.minutes, price: p.price, desc: p.descr, badge: p.badge ?? undefined }));
}
export function listPlans(accountId: string) {
  return prisma.plan.findMany({ where: { accountId }, orderBy: { sort: 'asc' } });
}
export function findPlan(accountId: string, code: string) {
  return prisma.plan.findUnique({ where: { accountId_code: { accountId, code } } });
}
export function getPlan(id: string) {
  return prisma.plan.findUnique({ where: { id } });
}
export async function createPlan(accountId: string, b: any) {
  const count = await prisma.plan.count({ where: { accountId } });
  return prisma.plan.create({
    data: {
      accountId, code: String(b.code), label: String(b.label), minutes: Number(b.minutes),
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
  accountId: string; txid: string; planCode: string; planLabel: string; minutes: number; amount: number; mac?: string;
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

export async function listSales(accountId: string, status?: string, planCode?: string) {
  const where: any = { accountId };
  if (status) where.status = status;
  if (planCode) where.planCode = planCode;
  const rows = await prisma.order.findMany({ where, orderBy: { createdAt: 'desc' } });
  return rows.map(toSale);
}

export async function buildReport(accountId: string) {
  const all = await prisma.order.findMany({ where: { accountId } });
  const paid = all.filter((o) => o.status === 'paid');
  const revenue = paid.reduce((s, o) => s + o.amount, 0);

  const plans = await prisma.plan.findMany({ where: { accountId }, orderBy: { sort: 'asc' } });
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
export function createAdmin(email: string, passwordHash: string, accountId: string) {
  return prisma.adminUser.create({ data: { email, passwordHash, accountId } });
}
export async function emailTaken(email: string) {
  return !!(await prisma.adminUser.findUnique({ where: { email } }));
}
export async function setAdminPassword(email: string, passwordHash: string) {
  await prisma.adminUser.update({ where: { email }, data: { passwordHash } });
}

/** Cria uma nova conta (Efí vazia; configura a própria) + seu admin. */
export async function createAccountAndAdmin(name: string, slug: string, email: string, passwordHash: string) {
  const account = await prisma.account.create({ data: { slug, name, courtesySeconds: config.courtesySeconds } });
  await seedPlans(account.id);
  await prisma.adminUser.create({ data: { email, passwordHash, accountId: account.id } });
  return account;
}
