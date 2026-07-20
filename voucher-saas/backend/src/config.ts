import 'dotenv/config';

/** Centraliza a leitura do .env e valida o que é essencial. */

export const config = {
  port: Number(process.env.PORT ?? 3000),
  publicUrl: process.env.PUBLIC_URL ?? 'http://localhost:3000',
  courtesySeconds: Number(process.env.COURTESY_WINDOW_SECONDS ?? 180),

  mikrotik: {
    host: process.env.MIKROTIK_HOST ?? '',
    port: Number(process.env.MIKROTIK_PORT ?? 8728),
    user: process.env.MIKROTIK_USER ?? 'api',
    password: process.env.MIKROTIK_PASSWORD ?? '',
    // TLS opcional (api-ssl na porta 8729)
    tls: (process.env.MIKROTIK_TLS ?? 'false') === 'true',
    hotspotProfile: process.env.MIKROTIK_HOTSPOT_PROFILE ?? 'default',
    hotspotServer: process.env.MIKROTIK_HOTSPOT_SERVER ?? 'all',
  },

  efi: {
    env: process.env.EFI_ENV ?? 'sandbox',
    clientId: process.env.EFI_CLIENT_ID ?? '',
    clientSecret: process.env.EFI_CLIENT_SECRET ?? '',
    certPath: process.env.EFI_CERT_PATH ?? '',
    pixKey: process.env.EFI_PIX_KEY ?? '',
    webhookToken: process.env.EFI_WEBHOOK_TOKEN ?? '',
  },
};

/** Sem host/senha do MikroTik → roda em modo mock (loga as ações, não conecta). */
export const mikrotikConfigured = Boolean(config.mikrotik.host && config.mikrotik.password);
