/**
 * Integração com a Efí (Pix) via SDK oficial `sdk-node-apis-efi`.
 *
 * As credenciais vêm das Configurações (banco) com fallback para o .env; o
 * certificado .p12 vem sempre do disco (EFI_CERT_PATH). Sem credenciais válidas,
 * roda em modo MOCK (Pix fictício) para o fluxo funcionar em desenvolvimento.
 */

import { config } from '../config';
import { getSettings } from '../store';

export interface PixCharge {
  txid: string;
  status: 'ATIVA' | 'CONCLUIDA' | 'REMOVIDA_PELO_USUARIO_RECEBEDOR';
  amount: number;
  qrcodeImage: string;
  pixCopiaECola: string;
  expiresInSeconds: number;
}

interface EfiConfig {
  env: string; clientId: string; clientSecret: string; pixKey: string; certPath: string; webhookToken: string;
}

/** Config efetiva: banco sobrepõe o .env; certificado sempre do disco. */
async function effectiveEfi(): Promise<EfiConfig> {
  const s = await getSettings().catch(() => null);
  return {
    env: s?.efiEnv || config.efi.env,
    clientId: s?.efiClientId || config.efi.clientId,
    clientSecret: s?.efiClientSecret || config.efi.clientSecret,
    pixKey: s?.efiPixKey || config.efi.pixKey,
    certPath: config.efi.certPath,
    webhookToken: s?.efiWebhookToken || config.efi.webhookToken,
  };
}
const isConfigured = (e: EfiConfig) => Boolean(e.clientId && e.clientSecret && e.certPath);

/** True se a Efí está pronta para operar (credenciais + certificado). */
export async function efiConfiguredNow(): Promise<boolean> {
  return isConfigured(await effectiveEfi());
}

function buildClient(e: EfiConfig): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const EfiPay = require('sdk-node-apis-efi');
  return new EfiPay({ sandbox: e.env !== 'producao', client_id: e.clientId, client_secret: e.clientSecret, certificate: e.certPath });
}

/** Segredo esperado do webhook (para validar as notificações). */
export async function webhookSecret(): Promise<string> {
  return (await effectiveEfi()).webhookToken;
}

/** Cria a cobrança Pix imediata e o QR Code. */
export async function createImmediateCharge(params: {
  amount: number; planId: string; deviceMac?: string;
}): Promise<PixCharge> {
  const expiresInSeconds = 3600;
  const e = await effectiveEfi();

  if (!isConfigured(e)) {
    const txid = 'DEMO' + Math.random().toString(36).slice(2, 12).toUpperCase();
    return {
      txid, status: 'ATIVA', amount: params.amount,
      qrcodeImage: 'data:image/png;base64,PLACEHOLDER',
      pixCopiaECola: `00020126580014BR.GOV.BCB.PIX0136${params.planId}-${txid}5204000053039865802BR`,
      expiresInSeconds,
    };
  }

  const efipay = buildClient(e);
  const body: any = {
    calendario: { expiracao: expiresInSeconds },
    valor: { original: params.amount.toFixed(2) },
    chave: e.pixKey,
    solicitacaoPagador: `Voucher internet (${params.planId})`,
    infoAdicionais: params.deviceMac ? [{ nome: 'dispositivo', valor: params.deviceMac }] : undefined,
  };
  const charge = await efipay.pixCreateImmediateCharge({}, body);
  const qr = await efipay.pixGenerateQRCode({ id: charge.loc.id });
  return {
    txid: charge.txid, status: charge.status, amount: params.amount,
    qrcodeImage: qr.imagemQrcode, pixCopiaECola: qr.qrcode, expiresInSeconds,
  };
}

/** Consulta o status da cobrança por txid (fallback do webhook). */
export async function getChargeStatus(txid: string): Promise<PixCharge['status']> {
  const e = await effectiveEfi();
  if (!isConfigured(e)) return 'ATIVA';
  const efipay = buildClient(e);
  const charge = await efipay.pixDetailCharge({ txid });
  return charge.status;
}

/** (Re)configura o webhook da chave Pix para apontar ao backend (HMAC na query). */
export async function configureWebhook(): Promise<{ ok: boolean; url?: string; error?: string }> {
  const url = `${config.publicUrl}/api/webhook/efi`;
  const e = await effectiveEfi();
  if (!isConfigured(e)) return { ok: false, error: 'efí não configurada' };
  try {
    const efipay = buildClient(e);
    await efipay.pixConfigWebhook({ chave: e.pixKey }, { webhookUrl: `${url}?hmac=${e.webhookToken}` });
    return { ok: true, url };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/**
 * Valida a autenticidade do webhook contra o segredo esperado.
 * - Produção (skip-mTLS): HMAC na query (?hmac=).
 * - Testes locais: header x-efi-token.
 */
export function verifyWebhook(input: { hmac?: string; token?: string }, secret: string): boolean {
  if (!secret) return false;
  return input.hmac === secret || input.token === secret;
}
