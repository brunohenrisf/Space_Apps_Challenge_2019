/**
 * Integração com a Efí (Pix) — STUB.
 *
 * No produto final, use o SDK oficial `sdk-node-apis-efi` com os dados de
 * EFI_CLIENT_ID / EFI_CLIENT_SECRET / EFI_CERT_PATH definidos no .env.
 *
 * Fluxo real:
 *  1. createImmediateCharge(): cria cobrança Pix (pixCreateImmediateCharge)
 *     e gera o QR Code (pixGenerateQRCode).
 *  2. A Efí notifica o pagamento no webhook configurado (ver routes/webhook.ts).
 *  3. getChargeStatus(): consulta de status usada como fallback do webhook.
 */

export interface PixCharge {
  txid: string;
  status: 'ATIVA' | 'CONCLUIDA' | 'REMOVIDA_PELO_USUARIO_RECEBEDOR';
  amount: number;
  qrcodeImage: string;     // data URI (base64) do QR
  pixCopiaECola: string;   // "copia e cola"
  expiresInSeconds: number;
}

// TODO:BACKEND — substituir pela chamada real ao SDK da Efí.
export async function createImmediateCharge(params: {
  amount: number;
  planId: string;
  deviceMac?: string;
}): Promise<PixCharge> {
  const txid = 'DEMO' + Math.random().toString(36).slice(2, 12).toUpperCase();
  return {
    txid,
    status: 'ATIVA',
    amount: params.amount,
    qrcodeImage: 'data:image/png;base64,PLACEHOLDER',
    pixCopiaECola: `00020126580014BR.GOV.BCB.PIX0136${params.planId}-${txid}5204000053039865802BR`,
    expiresInSeconds: 3600,
  };
}

// TODO:BACKEND — consultar Pix por txid (pixDetailCharge).
export async function getChargeStatus(txid: string): Promise<PixCharge['status']> {
  void txid;
  return 'ATIVA';
}

// TODO:BACKEND — validar assinatura/mTLS do webhook da Efí.
export function verifyWebhook(token: string | undefined): boolean {
  return !!token && token === process.env.EFI_WEBHOOK_TOKEN;
}
