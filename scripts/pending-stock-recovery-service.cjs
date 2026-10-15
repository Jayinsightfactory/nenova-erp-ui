'use strict';
const { startRecoveryWorker } = require('../lib/pendingStockRecoveryWorker.cjs');

function startService({ env = process.env, loadEnv = () => require('@next/env').loadEnvConfig(process.cwd(), false), startWorker = startRecoveryWorker } = {}) {
  if (env.NODE_ENV !== 'production' || env.NENOVA_PENDING_STOCK_RECOVERY !== '1' || !env.NENOVA_STOCK_RECOVERY_DIR) throw Error('RECOVERY_SERVICE_NOT_CONFIGURED');
  loadEnv();
  const worker = startWorker({ directory: env.NENOVA_STOCK_RECOVERY_DIR });
  // The shared worker timer is unref'ed for web hosts. This dedicated service
  // must stay alive even while no SQL child is running.
  const keepAlive = setInterval(() => {}, 60000);
  return { async stop() { clearInterval(keepAlive); await worker.stop(); } };
}
if (require.main === module) {
  try {
    const service = startService();
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => service.stop().finally(() => process.exit(0)));
  } catch { console.error('RECOVERY_SERVICE_START_FAILED'); process.exitCode = 1; }
}
module.exports = { startService };
