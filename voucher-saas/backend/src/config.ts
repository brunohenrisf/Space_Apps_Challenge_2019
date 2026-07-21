import 'dotenv/config';

/** Centraliza a leitura do .env e valida o que é essencial. */

export const config = {
  port: Number(process.env.PORT ?? 3000),
  publicUrl: process.env.PUBLIC_URL ?? 'http://localhost:3000',
  courtesySeconds: Number(process.env.COURTESY_WINDOW_SECONDS ?? 180),
  databaseUrl: process.env.DATABASE_URL ?? '',

  // Autenticação do painel do organizador
  authSecret: process.env.AUTH_SECRET || 'dev-inseguro-troque-em-producao',
  adminEmail: process.env.ADMIN_EMAIL || 'organizador@evento.com',
  adminPassword: process.env.ADMIN_PASSWORD || 'conecta123',
  // Cadastro aberto de novas contas (self-serve). Feche com ALLOW_SIGNUP=false.
  allowSignup: (process.env.ALLOW_SIGNUP ?? 'true') === 'true',

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

/** Sem client_id/secret/cert da Efí → roda em modo mock (Pix fictício). */
export const efiConfigured = Boolean(
  config.efi.clientId && config.efi.clientSecret && config.efi.certPath
);
