// Repositório de dados (Prisma). Substitui o armazenamento em memória.
import { prisma } from './db';
import { DEFAULT_PLANS } from './plans';

// ---------- Bootstrap ----------
export async function seedPlans(): Promise<void> {
  const count = await prisma.plan.count();
  if (count > 0) return;
  await prisma.plan.createMany({
    data: DEFAULT_PLANS.map((p, i) => ({
      code: p.id, label: p.time, minutes: p.minutes, price: p.price,
      descr: p.desc, badge: p.badge ?? null, sort: i,
    })),
  });
}

export async function ensureSettings(): Promise<void> {
  const s = await prisma.appSettings.findUnique({ where: { id: 1 } });
  if (!s) await prisma.appSettings.create({ data: { id: 1 } });
}

// ---------- Planos ----------
export async function listPlans() {
  const plans = await prisma.plan.findMany({ where: { active: true }, orderBy: { sort: 'asc' } });
  return plans.map((p) => ({
    id: p.code, time: p.label, minutes: p.minutes, price: p.price,
    desc: p.descr, badge: p.badge ?? undefined,
  }));
}
export function findPlan(code: string) {
  return prisma.plan.findUnique({ where: { code } });
}

// ---------- Pedidos ----------
export function createOrder(data: {
  txid: string; planCode: string; planLabel: string; minutes: number; amount: number; mac?: string;
}) {
  return prisma.order.create({ data });
}
export function getOrder(txid: string) {
  return prisma.order.findUnique({ where: { txid } });
}
export function setOrderPaid(txid: string, v: { voucherLogin: string; voucherPassword: string; expiresAt: Date }) {
  return prisma.order.update({
    where: { txid },
    data: { status: 'paid', paidAt: new Date(), ...v },
  });
}

type OrderRow = Awaited<ReturnType<typeof getOrder>>;
function toSale(o: NonNullable<OrderRow>) {
  return {
    txid: o.txid, voucher: o.voucherLogin ?? '—', plan: o.planLabel, planId: o.planCode,
    amount: o.amount, mac: o.mac ?? '—', status: o.status,
    createdAt: o.createdAt.toISOString(), paidAt: o.paidAt?.toISOString(),
  };
}

export async function listSales(status?: string, planCode?: string) {
  const where: any = {};
  if (status) where.status = status;
  if (planCode) where.planCode = planCode;
  const rows = await prisma.order.findMany({ where, orderBy: { createdAt: 'desc' } });
  return rows.map(toSale);
}

export async function buildReport() {
  const all = await prisma.order.findMany();
  const paid = all.filter((o) => o.status === 'paid');
  const revenue = paid.reduce((s, o) => s + o.amount, 0);

  const plans = await prisma.plan.findMany({ orderBy: { sort: 'asc' } });
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
      vouchers: paid.length,
      revenue,
      orders: all.length,
      pending: all.filter((o) => o.status === 'pending').length,
      ticket: paid.length ? Math.round((revenue / paid.length) * 100) / 100 : 0,
      conversion: all.length ? Math.round((paid.length / all.length) * 100) : 0,
    },
    byPlan,
    byDay,
  };
}

// ---------- Settings ----------
export function getSettings() {
  return prisma.appSettings.findUnique({ where: { id: 1 } });
}

export async function publicSettings() {
  const s = (await getSettings())!;
  return {
    efi: { env: s.efiEnv, clientId: s.efiClientId, pixKey: s.efiPixKey, hasSecret: !!s.efiClientSecret, webhookConfigured: s.efiWebhookConfigured },
    network: {
      lanCidr: s.lanCidr, dhcpFrom: s.dhcpFrom, dhcpTo: s.dhcpTo, dns: s.dns,
      hotspotName: s.hotspotName, portalDomain: s.portalDomain, apiUser: s.apiUser,
      apiPassword: s.apiPassword ? '********' : '',
    },
    wireguard: { vpsPublicKey: s.wgVpsPublicKey, vpsEndpoint: s.wgVpsEndpoint, vpsPort: s.wgVpsPort, peerAddress: s.wgPeerAddress },
  };
}

export async function saveSettings(b: any) {
  const e = b.efi ?? {}, n = b.network ?? {}, w = b.wireguard ?? {};
  const data: any = {};
  const set = (k: string, v: any) => { if (v !== undefined && v !== '') data[k] = v; };
  set('efiEnv', e.env); set('efiClientId', e.clientId); set('efiClientSecret', e.clientSecret);
  set('efiPixKey', e.pixKey); set('efiWebhookToken', e.webhookToken);
  set('lanCidr', n.lanCidr); set('dhcpFrom', n.dhcpFrom); set('dhcpTo', n.dhcpTo); set('dns', n.dns);
  set('hotspotName', n.hotspotName); set('portalDomain', n.portalDomain); set('apiUser', n.apiUser); set('apiPassword', n.apiPassword);
  set('wgVpsPublicKey', w.vpsPublicKey); set('wgVpsEndpoint', w.vpsEndpoint); set('wgPeerAddress', w.peerAddress);
  if (w.vpsPort !== undefined && w.vpsPort !== '') data.wgVpsPort = Number(w.vpsPort);
  await prisma.appSettings.update({ where: { id: 1 }, data });
  return publicSettings();
}

export async function setWebhookConfigured(v: boolean) {
  await prisma.appSettings.update({ where: { id: 1 }, data: { efiWebhookConfigured: v } });
}
