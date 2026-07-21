/**
 * Integração com a Efí (Pix) via SDK oficial `sdk-node-apis-efi`.
 * Multi-tenant: as credenciais vêm do ORGANIZADOR (por chamada). O certificado
 * .p12 vem do disco (EFI_CERT_PATH). Sem credenciais válidas, roda em MOCK.
 */
import { config } from '../config';

export interface EfiCreds {
  env: string; clientId: string; clientSecret: string; pixKey: string; certPath: string; webhookToken: string;
}

/** Deriva as credenciais efetivas do organizador (fallback para o .env). */
export function efiCredsFromOrganizer(o: {
  efiEnv?: string; efiClientId?: string; efiClientSecret?: string; efiPixKey?: string; efiWebhookToken?: string;
}): EfiCreds {
  return {
    env: o.efiEnv || config.efi.env,
    clientId: o.efiClientId || config.efi.clientId,
    clientSecret: o.efiClientSecret || config.efi.clientSecret,
    pixKey: o.efiPixKey || config.efi.pixKey,
    certPath: config.efi.certPath,
    webhookToken: o.efiWebhookToken || config.efi.webhookToken,
  };
}

export const isEfiConfigured = (e: EfiCreds) => Boolean(e.clientId && e.clientSecret && e.certPath);

export interface PixCharge {
  txid: string; status: 'ATIVA' | 'CONCLUIDA' | 'REMOVIDA_PELO_USUARIO_RECEBEDOR';
  amount: number; qrcodeImage: string; pixCopiaECola: string; expiresInSeconds: number;
}

function buildClient(e: EfiCreds): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const EfiPay = require('sdk-node-apis-efi');
  return new EfiPay({ sandbox: e.env !== 'producao', client_id: e.clientId, client_secret: e.clientSecret, certificate: e.certPath });
}

export async function createImmediateCharge(e: EfiCreds, params: { amount: number; planId: string; deviceMac?: string }): Promise<PixCharge> {
  const expiresInSeconds = 3600;
  if (!isEfiConfigured(e)) {
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
  return { txid: charge.txid, status: charge.status, amount: params.amount, qrcodeImage: qr.imagemQrcode, pixCopiaECola: qr.qrcode, expiresInSeconds };
}

export async function getChargeStatus(e: EfiCreds, txid: string): Promise<PixCharge['status']> {
  if (!isEfiConfigured(e)) return 'ATIVA';
  const efipay = buildClient(e);
  const charge = await efipay.pixDetailCharge({ txid });
  return charge.status;
}

/** (Re)configura o webhook da chave Pix para `webhookUrl` (com HMAC na query). */
export async function configureWebhook(e: EfiCreds, webhookUrl: string): Promise<{ ok: boolean; url?: string; error?: string }> {
  if (!isEfiConfigured(e)) return { ok: false, error: 'efí não configurada' };
  try {
    const efipay = buildClient(e);
    await efipay.pixConfigWebhook({ chave: e.pixKey }, { webhookUrl });
    return { ok: true, url: webhookUrl };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/** Valida a autenticidade do webhook contra o segredo esperado. */
export function verifyWebhook(input: { hmac?: string; token?: string }, secret: string): boolean {
  if (!secret) return false;
  return input.hmac === secret || input.token === secret;
}
