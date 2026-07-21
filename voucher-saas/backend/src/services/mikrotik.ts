/**
 * Integração com o MikroTik (RouterOS API) — Hotspot. Multi-tenant: a conexão
 * vem do EVENTO (host = IP do peer no túnel WireGuard). Sem host/senha, roda em
 * modo MOCK (só loga as ações), útil para desenvolver sem hardware.
 */

export interface MkConn {
  host: string; port: number; user: string; password: string; tls: boolean; hotspotProfile: string;
}

/** Deriva a conexão do backend com a MikroTik da conta. */
export function mkConnFromAccount(a: {
  wgPeerAddress: string; mkPort: number; apiUser: string; apiPassword: string; mkTls: boolean; mkHotspotProfile: string;
}): MkConn {
  return { host: a.wgPeerAddress, port: a.mkPort, user: a.apiUser, password: a.apiPassword, tls: a.mkTls, hotspotProfile: a.mkHotspotProfile };
}

const configured = (c: MkConn) => Boolean(c.host && c.password);

export interface VoucherAccess { login: string; password: string; profile: string; uptimeLimit: string; expiresAt: Date; }

// ------------------------------------------------------------------ helpers
export function minutesToRouterOS(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}
export function toRouterOSInterval(minutes: number): string {
  const total = minutes * 60;
  const d = Math.floor(total / 86400), h = Math.floor((total % 86400) / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d > 0 ? d + 'd' : ''}${pad(h)}:${pad(m)}:${pad(s)}`;
}
const randomLogin = () => 'evt-' + Math.random().toString(16).slice(2, 8).toUpperCase();
const randomPassword = () => Math.random().toString(36).slice(2, 10);
const courtesySchedName = (mac: string) => `courtesy-${mac.replace(/:/g, '')}`;

function loadRouterOSAPI(): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('node-routeros').RouterOSAPI;
}

async function run(conn: MkConn, path: string, params: string[] = []): Promise<any[]> {
  if (!configured(conn)) { console.log(`[mikrotik:mock] ${path} ${params.join(' ')}`); return []; }
  const RouterOSAPI = loadRouterOSAPI();
  const client = new RouterOSAPI({
    host: conn.host, user: conn.user, password: conn.password, port: conn.port, timeout: 8,
    ...(conn.tls ? { tls: {} } : {}),
  });
  try {
    await client.connect();
    return await client.write(path, params);
  } finally {
    try { client.close(); } catch { /* noop */ }
  }
}

// ------------------------------------------------------------- provisionamento
export async function provisionVoucher(conn: MkConn, input: { minutes: number; mac?: string }): Promise<VoucherAccess> {
  const login = randomLogin();
  const password = randomPassword();
  const uptimeLimit = minutesToRouterOS(input.minutes);
  const expiresAt = new Date(Date.now() + input.minutes * 60_000);

  const params = [
    `=name=${login}`, `=password=${password}`, `=profile=${conn.hotspotProfile}`,
    `=limit-uptime=${uptimeLimit}`, `=comment=ConectaVoucher ${uptimeLimit} exp:${expiresAt.toISOString()}`,
  ];
  if (input.mac) params.push(`=mac-address=${input.mac}`);
  await run(conn, '/ip/hotspot/user/add', params);

  if (input.mac) {
    await run(conn, '/ip/hotspot/ip-binding/remove', [`?mac-address=${input.mac}`]);
    await run(conn, '/system/scheduler/remove', [`?name=${courtesySchedName(input.mac)}`]);
  }
  console.log(`[mikrotik] hotspot user ${login} criado (limit-uptime=${uptimeLimit})`);
  return { login, password, profile: conn.hotspotProfile, uptimeLimit, expiresAt };
}

export async function revokeVoucher(conn: MkConn, login: string): Promise<void> {
  await run(conn, '/ip/hotspot/active/remove', [`?user=${login}`]);
  await run(conn, '/ip/hotspot/user/remove', [`?name=${login}`]);
}

// ----------------------------------------------------------------- cortesia
export async function grantCourtesyAccess(conn: MkConn, mac: string, seconds: number): Promise<void> {
  await run(conn, '/ip/hotspot/ip-binding/add', [`=mac-address=${mac}`, `=type=bypassed`, `=comment=cortesia ${seconds}s`]);
  const schedName = courtesySchedName(mac);
  const onEvent =
    `/ip/hotspot/ip-binding/remove [find mac-address="${mac}"]; /system/scheduler/remove [find name="${schedName}"]`;
  await run(conn, '/system/scheduler/add', [
    `=name=${schedName}`, `=interval=${toRouterOSInterval(Math.ceil(seconds / 60))}`,
    `=on-event=${onEvent}`, `=comment=ConectaVoucher cortesia`,
  ]);
}
export async function revokeCourtesyAccess(conn: MkConn, mac: string): Promise<void> {
  await run(conn, '/ip/hotspot/ip-binding/remove', [`?mac-address=${mac}`]);
}

// --------------------------------------------------------------- diagnóstico
export async function listActiveSessions(conn: MkConn): Promise<any[]> {
  return run(conn, '/ip/hotspot/active/print');
}
export async function pingRouter(conn: MkConn): Promise<{ ok: boolean; identity?: string; error?: string }> {
  if (!configured(conn)) return { ok: false, error: 'mikrotik não configurado (modo mock)' };
  try {
    const res = await run(conn, '/system/identity/print');
    return { ok: true, identity: res?.[0]?.name };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
