/**
 * Integração com o MikroTik (RouterOS API) — Hotspot / captive portal.
 *
 * Topologia:
 *   ether1  -> WAN (DHCP client) recebe o link da internet
 *   ether2  -> LAN (bridge) para a UniFi, com Hotspot (captive portal)
 *
 * Fluxo:
 *   - Cortesia: ao conectar, libera o MAC com ip-binding bypassed por N seg
 *     (internet ampla p/ pagar via app do banco) + scheduler que remove no fim.
 *   - Pago: cria /ip/hotspot/user com limit-uptime (tempo do voucher) preso ao
 *     MAC (1 dispositivo) e encerra a cortesia daquele MAC.
 *
 * Sem host/senha no .env, roda em modo MOCK (apenas loga as ações).
 */

import { config, mikrotikConfigured } from '../config';

// node-routeros não publica tipos e só é necessário quando há hardware.
// Carregamos sob demanda (lazy) para o modo mock rodar sem a dependência.
function loadRouterOSAPI(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('node-routeros').RouterOSAPI;
}

export interface VoucherAccess {
  login: string;
  password: string;
  profile: string;
  uptimeLimit: string; // ex: "3h"
  expiresAt: Date;
}

// ------------------------------------------------------------------ helpers

export function minutesToRouterOS(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

/** Converte minutos para o formato de intervalo do scheduler (ex: "1d02:30:00"). */
export function toRouterOSInterval(minutes: number): string {
  const total = minutes * 60;
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d > 0 ? d + 'd' : ''}${pad(h)}:${pad(m)}:${pad(s)}`;
}

function randomLogin(): string {
  return 'evt-' + Math.random().toString(16).slice(2, 8).toUpperCase();
}
function randomPassword(): string {
  return Math.random().toString(36).slice(2, 10);
}
function courtesySchedName(mac: string): string {
  return `courtesy-${mac.replace(/:/g, '')}`;
}

/** Executa um comando na API e fecha a conexão. Loga (mock) se não configurado. */
async function run(path: string, params: string[] = []): Promise<any[]> {
  if (!mikrotikConfigured) {
    console.log(`[mikrotik:mock] ${path} ${params.join(' ')}`);
    return [];
  }
  const RouterOSAPI = loadRouterOSAPI();
  const client = new RouterOSAPI({
    host: config.mikrotik.host,
    user: config.mikrotik.user,
    password: config.mikrotik.password,
    port: config.mikrotik.port,
    timeout: 8,
    ...(config.mikrotik.tls ? { tls: {} } : {}),
  });
  try {
    await client.connect();
    return await client.write(path, params);
  } finally {
    try { client.close(); } catch { /* noop */ }
  }
}

// ------------------------------------------------------------- provisionamento

/** Cria o usuário Hotspot do voucher (limit-uptime = tempo do plano). */
export async function provisionVoucher(input: {
  minutes: number;
  mac?: string;
}): Promise<VoucherAccess> {
  const login = randomLogin();
  const password = randomPassword();
  const uptimeLimit = minutesToRouterOS(input.minutes);
  const expiresAt = new Date(Date.now() + input.minutes * 60_000);
  const profile = config.mikrotik.hotspotProfile;

  // limit-uptime é nativo no hotspot: o próprio RouterOS encerra ao fim do tempo.
  const params = [
    `=name=${login}`,
    `=password=${password}`,
    `=profile=${profile}`,
    `=limit-uptime=${uptimeLimit}`,
    `=comment=ConectaVoucher ${uptimeLimit} exp:${expiresAt.toISOString()}`,
  ];
  if (input.mac) params.push(`=mac-address=${input.mac}`); // 1 dispositivo
  await run('/ip/hotspot/user/add', params);

  // Pago: encerra a cortesia (bypass) do dispositivo para que o limit-uptime
  // do voucher passe a valer. O portal faz o login do device com estas
  // credenciais (ver docs/MIKROTIK.md).
  if (input.mac) {
    await run('/ip/hotspot/ip-binding/remove', [`?mac-address=${input.mac}`]);
    await run('/system/scheduler/remove', [`?name=${courtesySchedName(input.mac)}`]);
  }
  console.log(`[mikrotik] hotspot user ${login} criado (limit-uptime=${uptimeLimit})`);
  return { login, password, profile, uptimeLimit, expiresAt };
}

/** Encerra e remove o voucher (usado no fim do tempo ou por cancelamento). */
export async function revokeVoucher(login: string): Promise<void> {
  await run('/ip/hotspot/active/remove', [`?user=${login}`]);
  await run('/ip/hotspot/user/remove', [`?name=${login}`]);
}

// ----------------------------------------------------------------- cortesia

/**
 * Cortesia: libera o MAC por `seconds` (ip-binding bypassed = internet ampla,
 * para o cliente pagar via app do banco). No fim, o scheduler remove o bypass.
 */
export async function grantCourtesyAccess(mac: string, seconds: number): Promise<void> {
  await run('/ip/hotspot/ip-binding/add', [
    `=mac-address=${mac}`,
    `=type=bypassed`,
    `=comment=cortesia ${seconds}s`,
  ]);
  const schedName = courtesySchedName(mac);
  const onEvent =
    `/ip/hotspot/ip-binding/remove [find mac-address="${mac}"]; ` +
    `/system/scheduler/remove [find name="${schedName}"]`;
  await run('/system/scheduler/add', [
    `=name=${schedName}`,
    `=interval=${toRouterOSInterval(Math.ceil(seconds / 60))}`,
    `=on-event=${onEvent}`,
    `=comment=ConectaVoucher cortesia`,
  ]);
}

export async function revokeCourtesyAccess(mac: string): Promise<void> {
  await run('/ip/hotspot/ip-binding/remove', [`?mac-address=${mac}`]);
}

// --------------------------------------------------------------- diagnóstico

export async function listActiveSessions(): Promise<any[]> {
  return run('/ip/hotspot/active/print');
}

/** Testa a conexão com o roteador (usado no /status e no painel). */
export async function pingRouter(): Promise<{ ok: boolean; identity?: string; error?: string }> {
  if (!mikrotikConfigured) return { ok: false, error: 'mikrotik não configurado (modo mock)' };
  try {
    const res = await run('/system/identity/print');
    return { ok: true, identity: res?.[0]?.name };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
