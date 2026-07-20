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
  orders.set(charge.txid, {
    txid: charge.txid,
    planId: plan.id,
    amount: plan.price,
    mac: req.body?.mac,
    status: 'pending',
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

export default router;
