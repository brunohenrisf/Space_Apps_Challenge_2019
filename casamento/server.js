import os from 'node:os';
import { createApp } from './src/app.js';
import { config, ensureDirectories, warnings } from './src/config.js';
import { startTmpCleanup } from './src/routes/photos.js';
import { PhotoStore } from './src/store.js';

ensureDirectories();

const store = new PhotoStore(config.dataFile);
await store.load();
startTmpCleanup();

const app = createApp(store);

function localAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((iface) => iface && iface.family === 'IPv4' && !iface.internal)
    .map((iface) => `http://${iface.address}:${config.port}`);
}

const server = app.listen(config.port, () => {
  const stats = store.stats();
  console.log(`\n  ${config.couple.names} — página de fotos do casamento`);
  console.log('  ────────────────────────────────────────────');
  console.log(`  Convidados:  ${config.publicUrl}`);
  console.log(`  Painel:      ${config.publicUrl}/painel`);
  console.log(`  QR Code:     ${config.publicUrl}/qr`);
  for (const address of localAddresses()) {
    console.log(`  Na rede:     ${address}`);
  }
  console.log(`  Fotos já recebidas: ${stats.total}\n`);
  for (const warning of warnings) console.warn(`  ⚠  ${warning}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log('\n  Encerrando…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
