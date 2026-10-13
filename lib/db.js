// lib/db.js — MS-SQL 연결
import sql from 'mssql';

const config = {
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT || '1433'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
    connectTimeout: 30000,
    requestTimeout: 60000,
  },
  pool: { max: 20, min: 0, idleTimeoutMillis: 30000 },
};

let poolPromise = null;
let poolResolving = false;

export async function getPool() {
  if (poolPromise) return poolPromise;
  if (!poolResolving) {
    poolResolving = true;
    poolPromise = sql.connect(config).catch((err) => {
      poolPromise = null;
      poolResolving = false;
      throw err;
    });
  }
  return poolPromise;
}

// 단일 쿼리 실행 (트랜잭션 없이)
export async function query(q, params = {}) {
  const pool = await getPool();
  const req = pool.request();
  for (const [name, { type, value }] of Object.entries(params)) {
    req.input(name, type, value);
  }
  return req.query(q);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isDeadlockError(err) {
  const pending = [err];
  const seen = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    if (Number(current.number) === 1205 ||
      /deadlocked on lock resources|deadlock victim/i.test(String(current.message || ''))) return true;
    pending.push(current.originalError, current.info, current.cause);
    if (Array.isArray(current.precedingErrors)) pending.push(...current.precedingErrors);
  }
  return false;
}

function retryDelayMs(attempt, baseDelay) {
  return baseDelay * Math.pow(2, attempt) + Math.floor(Math.random() * 80);
}

// 트랜잭션 래퍼 — 여러 쿼리를 원자적으로 실행
// 사용법: await withTransaction(async (tQuery) => { await tQuery(...); await tQuery(...); })
export async function withTransaction(fn, options = {}) {
  const retries = Number(options.retries ?? 3);
  const baseDelay = Number(options.baseDelay ?? 150);
  const rollbackOnly = options.rollbackOnly === true;
  const pool = await getPool();

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const transaction = new sql.Transaction(pool);
    let began = false;
    let rolledBack = false;
    let rollbackAttempted = false;
    let phase = 'begin';
    // mssql emits rollback(true) when SQL Server has already aborted a deadlock victim.
    transaction.on('rollback', () => { rolledBack = true; });
    try {
      await transaction.begin();
      began = true;
      phase = 'work';
      const tQuery = async (q, params = {}) => {
        const req = new sql.Request(transaction);
        for (const [name, { type, value }] of Object.entries(params)) {
          req.input(name, type, value);
        }
        return req.query(q);
      };
      const result = await fn(tQuery, { attempt });
      phase = 'finish';
      if (rollbackOnly) {
        rollbackAttempted = true;
        await transaction.rollback();
      }
      else await transaction.commit();
      return result;
    } catch (err) {
      const failedPhase = phase;
      let rollbackError;
      if (began && !rolledBack && !rollbackAttempted) {
        rollbackAttempted = true;
        try {
          await transaction.rollback();
          rolledBack = true;
        } catch (error) {
          rollbackError = error;
        }
      }
      const deadlock = isDeadlockError(err);
      // SQL Server error 1205 (or its victim message) confirms that the server
      // aborted the transaction even if mssql's rollback call cannot complete.
      const aborted = rolledBack || deadlock;
      if (err && typeof err === 'object' && aborted) err.transactionRolledBack = true;
      if (err && typeof err === 'object' && rollbackError) err.rollbackError = rollbackError;
      // A failed commit has an unknown outcome; never replay its writes.
      if (deadlock && aborted && failedPhase !== 'finish' && attempt < retries) {
        await sleep(retryDelayMs(attempt, baseDelay));
        continue;
      }
      throw err;
    }
  }
}

export { sql };
