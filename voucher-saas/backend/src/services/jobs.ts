// Job de reconciliação: expira cobranças vencidas e reprovisiona pedidos pagos
// que ficaram sem voucher (MikroTik indisponível na hora do pagamento).
import { log } from './log';
import * as store from '../store';
import { provisionVoucher, mkConnFromAccount } from './mikrotik';

async function reconcileOnce() {
  try {
    const expired = await store.expireStalePending(60);
    if (expired) log.info('reconcile.expired', { count: expired });

    const orphans = await store.paidWithoutVoucher();
    for (const o of orphans) {
      const acc = await store.getAccount(o.accountId);
      if (!acc) continue;
      try {
        const access = await provisionVoucher(mkConnFromAccount(acc), { minutes: o.minutes, mac: o.mac ?? undefined });
        await store.setOrderVoucher(o.txid, { voucherLogin: access.login, voucherPassword: access.password, expiresAt: access.expiresAt });
        log.info('reconcile.reprovisioned', { txid: o.txid });
      } catch (e: any) {
        log.warn('reconcile.reprovision_failed', { txid: o.txid, error: e?.message });
      }
    }
  } catch (e: any) {
    log.error('reconcile.error', { error: e?.message });
  }
}

export function startReconciliation(intervalMs = 60_000) {
  const t = setInterval(reconcileOnce, intervalMs);
  t.unref?.();
  log.info('reconcile.started', { intervalMs });
}
