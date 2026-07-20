/**
 * Integração com o MikroTik (RouterOS API).
 *
 * Topologia alvo:
 *   ether1  -> WAN (DHCP client) recebe o link da internet
 *   ether2  -> LAN (bridge) para a UniFi, com servidor PPPoE
 *
 * Dois modos (config.accessMode):
 *   - 'pppoe'  : cria /ppp/secret por voucher. O RouterOS NÃO tem limite de
 *                tempo nativo no secret, então criamos também um /system/scheduler
 *                que derruba e desabilita o secret quando o tempo acaba.
 *   - 'hotspot': cria /ip/hotspot/user com limit-uptime NATIVO (ideal p/ o
 *                captive portal de celular: auto-redirect + cortesia).
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

/** Cria o acesso do voucher (PPPoE ou Hotspot conforme o modo). */
export async function provisionVoucher(input: {
  minutes: number;
  mac?: string;
}): Promise<VoucherAccess> {
  const login = randomLogin();
  const password = randomPassword();
  const uptimeLimit = minutesToRouterOS(input.minutes);
  const expiresAt = new Date(Date.now() + input.minutes * 60_000);

  if (config.accessMode === 'hotspot') {
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

  // --- modo PPPoE (padrão) ---
  const profile = config.mikrotik.pppoeProfile;
  await run('/ppp/secret/add', [
    `=name=${login}`,
    `=password=${password}`,
    `=service=pppoe`,
    `=profile=${profile}`,
    `=comment=ConectaVoucher ${uptimeLimit} exp:${expiresAt.toISOString()}`,
  ]);

  // Como o secret não tem limite de tempo nativo, agenda o encerramento.
  const schedName = `exp-${login}`;
  const onEvent =
    `/ppp/active/remove [find name="${login}"]; ` +
    `/ppp/secret/disable [find name="${login}"]; ` +
    `/system/scheduler/remove [find name="${schedName}"]`;
  await run('/system/scheduler/add', [
    `=name=${schedName}`,
    `=interval=${toRouterOSInterval(input.minutes)}`,
    `=on-event=${onEvent}`,
    `=comment=ConectaVoucher expira ${login}`,
  ]);

  console.log(`[mikrotik] pppoe secret ${login} criado (expira em ${uptimeLimit} via scheduler)`);
  return { login, password, profile, uptimeLimit, expiresAt };
}

/** Encerra e remove o voucher (usado no fim do tempo ou por cancelamento). */
export async function revokeVoucher(login: string): Promise<void> {
  if (config.accessMode === 'hotspot') {
    await run('/ip/hotspot/active/remove', [`?user=${login}`]);
    await run('/ip/hotspot/user/remove', [`?name=${login}`]);
    return;
  }
  await run('/ppp/active/remove', [`?name=${login}`]);
  await run('/ppp/secret/remove', [`?name=${login}`]);
  await run('/system/scheduler/remove', [`?name=exp-${login}`]);
}

// ----------------------------------------------------------------- cortesia

/**
 * Cortesia (só faz sentido no modo hotspot / captive portal): libera o MAC por
 * `seconds` para o cliente pagar. No fim, o scheduler remove o bypass.
 */
export async function grantCourtesyAccess(mac: string, seconds: number): Promise<void> {
  if (config.accessMode !== 'hotspot') {
    console.log(`[mikrotik] cortesia ignorada no modo pppoe (sem captive portal) mac=${mac}`);
    return;
  }
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
  if (config.accessMode !== 'hotspot') return;
  await run('/ip/hotspot/ip-binding/remove', [`?mac-address=${mac}`]);
}

// --------------------------------------------------------------- diagnóstico

export async function listActiveSessions(): Promise<any[]> {
  return config.accessMode === 'hotspot'
    ? run('/ip/hotspot/active/print')
    : run('/ppp/active/print');
}

/** Testa a conexão com o roteador (usado no /health e no painel). */
export async function pingRouter(): Promise<{ ok: boolean; identity?: string; error?: string }> {
  if (!mikrotikConfigured) return { ok: false, error: 'mikrotik não configurado (modo mock)' };
  try {
    const res = await run('/system/identity/print');
    return { ok: true, identity: res?.[0]?.name };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
