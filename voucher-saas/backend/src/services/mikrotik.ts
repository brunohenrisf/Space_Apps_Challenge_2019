/**
 * Integração com o MikroTik (RouterOS API) — STUB.
 *
 * No produto final, use uma lib como `node-routeros` conectando em
 * MIKROTIK_HOST:MIKROTIK_PORT com MIKROTIK_USER / MIKROTIK_PASSWORD.
 *
 * Responsabilidades:
 *  - Portal captivo (hotspot) redireciona o dispositivo para a página de compra.
 *  - Walled-garden: manter portal + Efí sempre acessíveis, mesmo sem crédito.
 *  - Cortesia: liberar acesso por COURTESY_WINDOW_SECONDS só para pagar.
 *  - Ao confirmar o Pix: criar o usuário PPPoE com limite de tempo do voucher
 *    (uptime-limit) e apenas 1 sessão simultânea (1 dispositivo por voucher).
 */

export interface PppoeUser {
  login: string;
  password: string;
  profile: string;
  uptimeLimit: string; // formato RouterOS, ex: "3h", "24h"
}

// TODO:BACKEND — /ip/hotspot/... liberar cortesia para o MAC informado.
export async function grantCourtesyAccess(mac: string, seconds: number): Promise<void> {
  console.log(`[mikrotik] cortesia de ${seconds}s liberada para ${mac}`);
}

// TODO:BACKEND — /ip/hotspot/... cortar acesso ao fim da cortesia.
export async function revokeCourtesyAccess(mac: string): Promise<void> {
  console.log(`[mikrotik] cortesia revogada para ${mac}`);
}

// TODO:BACKEND — /ppp/secret/add com uptime-limit e /ppp/profile (1 sessão).
export async function createVoucherUser(params: {
  minutes: number;
  profile: string;
  mac?: string;
}): Promise<PppoeUser> {
  const login = 'evt-' + Math.random().toString(16).slice(2, 8).toUpperCase();
  const user: PppoeUser = {
    login,
    password: Math.random().toString(36).slice(2, 10),
    profile: params.profile,
    uptimeLimit: minutesToRouterOS(params.minutes),
  };
  console.log(`[mikrotik] usuário PPPoE criado: ${login} (limite ${user.uptimeLimit})`);
  return user;
}

export function minutesToRouterOS(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}
