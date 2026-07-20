/**
 * Integração com a Efí (Pix) via SDK oficial `sdk-node-apis-efi`.
 *
 * Fluxo:
 *  1. createImmediateCharge(): cria a cobrança Pix (pixCreateImmediateCharge)
 *     e gera o QR Code (pixGenerateQRCode).
 *  2. A Efí notifica o pagamento no webhook (POST /api/webhook/efi/pix).
 *  3. getChargeStatus(): consulta por txid (pixDetailCharge) — fallback do webhook.
 *
 * Sem EFI_CLIENT_ID/SECRET/CERT no .env, roda em modo MOCK (dados fictícios),
 * para o fluxo funcionar em desenvolvimento sem credenciais.
 */

import { config, efiConfigured } from '../config';

export interface PixCharge {
  txid: string;
  status: 'ATIVA' | 'CONCLUIDA' | 'REMOVIDA_PELO_USUARIO_RECEBEDOR';
  amount: number;
  qrcodeImage: string;     // data URI (base64) do QR
  pixCopiaECola: string;   // "copia e cola"
  expiresInSeconds: number;
}

// SDK sem tipos: carrega sob demanda e mantém um cliente único.
let efiClient: any = null;
function getClient(): any {
  if (efiClient) return efiClient;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const EfiPay = require('sdk-node-apis-efi');
  efiClient = new EfiPay({
    sandbox: config.efi.env !== 'producao',
    client_id: config.efi.clientId,
    client_secret: config.efi.clientSecret,
    certificate: config.efi.certPath,
  });
  return efiClient;
}

/** Cria a cobrança Pix imediata e o QR Code. */
export async function createImmediateCharge(params: {
  amount: number;
  planId: string;
  deviceMac?: string;
}): Promise<PixCharge> {
  const expiresInSeconds = 3600;

  if (!efiConfigured) {
    const txid = 'DEMO' + Math.random().toString(36).slice(2, 12).toUpperCase();
    return {
      txid,
      status: 'ATIVA',
      amount: params.amount,
      qrcodeImage: 'data:image/png;base64,PLACEHOLDER',
      pixCopiaECola: `00020126580014BR.GOV.BCB.PIX0136${params.planId}-${txid}5204000053039865802BR`,
      expiresInSeconds,
    };
  }

  const efipay = getClient();
  const body: any = {
    calendario: { expiracao: expiresInSeconds },
    valor: { original: params.amount.toFixed(2) },
    chave: config.efi.pixKey,
    solicitacaoPagador: `Voucher internet (${params.planId})`,
    infoAdicionais: params.deviceMac
      ? [{ nome: 'dispositivo', valor: params.deviceMac }]
      : undefined,
  };

  const charge = await efipay.pixCreateImmediateCharge({}, body);
  const qr = await efipay.pixGenerateQRCode({ id: charge.loc.id });

  return {
    txid: charge.txid,
    status: charge.status,
    amount: params.amount,
    qrcodeImage: qr.imagemQrcode,
    pixCopiaECola: qr.qrcode,
    expiresInSeconds,
  };
}

/** Consulta o status da cobrança por txid (fallback do webhook). */
export async function getChargeStatus(txid: string): Promise<PixCharge['status']> {
  if (!efiConfigured) return 'ATIVA';
  const efipay = getClient();
  const charge = await efipay.pixDetailCharge({ txid });
  return charge.status;
}

/** (Re)configura o webhook da chave Pix para apontar ao backend. */
export async function configureWebhook(): Promise<{ ok: boolean; url?: string; error?: string }> {
  const url = `${config.publicUrl}/api/webhook/efi`;
  if (!efiConfigured) return { ok: false, error: 'efí não configurada (modo mock)' };
  try {
    const efipay = getClient();
    // headers com skip-mTLS: valida por HMAC na query (?hmac=) em vez de mTLS.
    await efipay.pixConfigWebhook(
      { chave: config.efi.pixKey },
      { webhookUrl: `${url}?hmac=${config.efi.webhookToken}` }
    );
    return { ok: true, url };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

/**
 * Valida a autenticidade do webhook.
 * - Produção (skip-mTLS): a Efí inclui o HMAC configurado na query (?hmac=).
 * - Testes locais: aceita o header x-efi-token igual ao EFI_WEBHOOK_TOKEN.
 */
export function verifyWebhook(input: { hmac?: string; token?: string }): boolean {
  const secret = config.efi.webhookToken;
  if (!secret) return false;
  return input.hmac === secret || input.token === secret;
}
