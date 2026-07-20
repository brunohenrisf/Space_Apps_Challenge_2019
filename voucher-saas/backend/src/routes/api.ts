import { Router, Request, Response } from 'express';
import { PLANS, findPlan } from '../plans';
import { createImmediateCharge, getChargeStatus, verifyWebhook } from '../services/efi';
import { createVoucherUser, grantCourtesyAccess } from '../services/mikrotik';

const router = Router();

// Memória temporária de cobranças (trocar por banco de dados no produto final).
type Order = {
  txid: string;
  planId: string;
  amount: number;
  status: 'pending' | 'paid';
  voucherLogin?: string;
};
const orders = new Map<string, Order>();

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
  orders.set(charge.txid, { txid: charge.txid, planId: plan.id, amount: plan.price, status: 'pending' });

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
  res.json({ status: order.status, voucherLogin: order.voucherLogin });
});

// POST /api/webhook/efi — Efí notifica o pagamento
router.post('/webhook/efi', async (req: Request, res: Response) => {
  if (!verifyWebhook(req.header('x-efi-token'))) {
    return res.status(401).json({ error: 'webhook não autorizado' });
  }
  // A Efí envia uma lista de txids pagos em `pix[]`.
  const paid: string[] = (req.body?.pix ?? []).map((p: any) => p.txid);
  for (const txid of paid) {
    const order = orders.get(txid);
    if (!order || order.status === 'paid') continue;
    const plan = findPlan(order.planId)!;
    // Confirma → cria o usuário PPPoE no MikroTik com o tempo do voucher.
    const user = await createVoucherUser({
      minutes: plan.minutes,
      profile: process.env.MIKROTIK_PPPOE_PROFILE ?? 'voucher-default',
    });
    order.status = 'paid';
    order.voucherLogin = user.login;
  }
  res.json({ ok: true });
});

export default router;
