'use strict';
// Dedicated process and pool. Process exit is the final disposal boundary even
// when an attention/rollback cannot complete. Never reuse the application pool.
const sql = require('mssql');
const { recoverPendingStock } = require('../lib/pendingStockRecovery.cjs');

async function main() {
  if (!process.send || process.env.NODE_ENV !== 'production' || process.env.NENOVA_PENDING_STOCK_RECOVERY !== '1') throw Error('RECOVERY_WORKER_NOT_ENABLED');
  const config = { server: process.env.DB_SERVER, port: Number(process.env.DB_PORT || 1433), database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    connectionTimeout: 10000, requestTimeout: 90000, pool: { max: 1, min: 0 }, options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true, appName: 'NenovaPendingStockRecovery' } };
  const pool = new sql.ConnectionPool(config); pool.on('error', () => {});
  let transaction, rolledBack = false, began = false, phase = 'connect';
  try {
    await pool.connect(); transaction = new sql.Transaction(pool); transaction.on('rollback', () => { rolledBack = true; });
    phase = 'begin'; await transaction.begin(); began = true;
    const tQuery = async (text, params = {}) => { const request = new sql.Request(transaction); for (const [name, p] of Object.entries(params)) request.input(name, p.type, p.value); return request.query(text); };
    await tQuery('SET XACT_ABORT ON; SET LOCK_TIMEOUT 5000; SET DEADLOCK_PRIORITY LOW;');
    phase = 'work';
    const result = await recoverPendingStock({ tQuery, types: sql, uid: 'stock-auto-recovery', onCandidate: scope => new Promise((resolve, reject) => {
      const listener = message => { if (message?.type === 'decision') { clearTimeout(timeout); process.off('message', listener); resolve(message.allow === true); } };
      const timeout = setTimeout(() => { process.off('message', listener); reject(Error('PARENT_DECISION_TIMEOUT')); }, 5000);
      process.on('message', listener); process.send({ type: 'candidate', scope });
    }) });
    if (result.status === 'skipped') {
      phase = 'rollback'; if (!rolledBack) await transaction.rollback();
    } else { phase = 'commit'; await transaction.commit(); }
    process.send({ type: 'result', result }, () => process.exit(0));
  } catch (error) {
    let rollbackConfirmed = rolledBack;
    if (began && !rolledBack) { try { await transaction.rollback(); rollbackConfirmed = true; } catch {} }
    const result = { status: phase === 'commit' || !rollbackConfirmed && began ? 'unknown' : 'failed', code: /^[A-Z_0-9]+$/.test(error.code || '') ? error.code : 'RECOVERY_FAILED', number: Number(error.number) || null, phase, rollbackConfirmed };
    process.send({ type: 'result', result }, () => process.exit(1));
  }
}
if (require.main === module) main().catch(() => process.exit(1));
