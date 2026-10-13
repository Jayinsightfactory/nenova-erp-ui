const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadDb(behaviors = []) {
  const transactions = [];
  class Transaction {
    constructor() {
      this.actions = [];
      this.behavior = behaviors[transactions.length] || {};
      this.listeners = {};
      transactions.push(this);
    }
    on(name, listener) { this.listeners[name] = listener; }
    emitRollback() { this.listeners.rollback?.(true); }
    async begin() {
      this.actions.push('begin');
      if (this.behavior.beginError) throw this.behavior.beginError;
    }
    async rollback() {
      this.actions.push('rollback');
      if (this.behavior.rollbackError) throw this.behavior.rollbackError;
      this.emitRollback();
    }
    async commit() {
      this.actions.push('commit');
      if (this.behavior.commitError) throw this.behavior.commitError;
    }
  }
  class Request {
    constructor(transaction) { this.transaction = transaction; }
    input() { return this; }
    async query() {
      this.transaction.actions.push('query');
      if (this.transaction.behavior.queryError) {
        if (this.transaction.behavior.autoRollback) this.transaction.emitRollback();
        throw this.transaction.behavior.queryError;
      }
      return { recordset: [{ transaction: transactions.indexOf(this.transaction) }] };
    }
  }
  const sql = { Transaction, Request, connect: async () => ({}) };
  const source = fs.readFileSync(require('node:path').join(__dirname, '../lib/db.js'), 'utf8')
    .replace("import sql from 'mssql';", 'const sql = globalThis.__sql;')
    .replace(/export (async )?function /g, '$1function ')
    .replace('export { sql };', 'globalThis.__exports = { isDeadlockError, withTransaction };');
  const context = { __sql: sql, process: { env: {} }, setTimeout, Math };
  vm.runInNewContext(source, context, { filename: 'lib/db.js' });
  return { ...context.__exports, transactions };
}

const deadlock = () => Object.assign(new Error('SQL Server victim'), { number: 1205 });

test('deadlock detection traverses all nested SQL errors and cycles without generic rerun false positives', () => {
  const { isDeadlockError } = loadDb();
  const error = new Error('wrapper');
  error.cause = error;
  error.originalError = { info: { precedingErrors: [{ number: 2601 }, { number: '1205' }] } };
  assert.equal(isDeadlockError(error), true);
  assert.equal(isDeadlockError({ message: 'Rerun the transaction after validation' }), false);
  assert.equal(isDeadlockError({ cause: { message: 'chosen as the deadlock victim' } }), true);
});

test('begin deadlock gets a fresh transaction and reruns the whole callback', async () => {
  const { withTransaction, transactions } = loadDb([{ beginError: deadlock() }, {}]);
  const calls = [];
  const result = await withTransaction(async (q, { attempt }) => {
    calls.push(attempt);
    return (await q('SELECT 1')).recordset[0].transaction;
  }, { retries: 1, baseDelay: 0 });
  assert.equal(result, 1);
  assert.deepEqual(calls, [1]);
  assert.deepEqual(transactions.map(t => t.actions), [['begin'], ['begin', 'query', 'commit']]);
});

test('auto rollback avoids a second rollback; callback results come only from successful attempt', async () => {
  const nested = new Error('query failed');
  nested.originalError = { info: { number: 1205 } };
  const { withTransaction, transactions } = loadDb([
    { queryError: nested, autoRollback: true },
    {},
  ]);
  const seen = [];
  const result = await withTransaction(async (q, { attempt }) => {
    seen.push(attempt);
    return (await q('UPDATE')).recordset;
  }, { retries: 1, baseDelay: 0 });
  assert.deepEqual(seen, [0, 1]);
  assert.equal(result[0].transaction, 1);
  assert.deepEqual(transactions.map(t => t.actions), [['begin', 'query'], ['begin', 'query', 'commit']]);
  assert.equal(nested.transactionRolledBack, true);
});

test('rollbackOnly rolls back once and does not commit', async () => {
  const { withTransaction, transactions } = loadDb([{}]);
  assert.equal(await withTransaction(() => 'preview', { rollbackOnly: true }), 'preview');
  assert.deepEqual(transactions[0].actions, ['begin', 'rollback']);
});

test('failed rollbackOnly cleanup is not attempted twice', async () => {
  const rollbackError = new Error('connection ended during preview rollback');
  const { withTransaction, transactions } = loadDb([{ rollbackError }, {}]);
  await assert.rejects(withTransaction(() => 'preview', {
    rollbackOnly: true, retries: 1, baseDelay: 0,
  }), rollbackError);
  assert.equal(transactions.length, 1);
  assert.deepEqual(transactions[0].actions, ['begin', 'rollback']);
});

test('deadlock exhaustion returns the final error with confirmed abort', async () => {
  const failures = [deadlock(), deadlock()];
  const { withTransaction, transactions } = loadDb(failures.map(queryError => ({ queryError })));
  await assert.rejects(withTransaction(q => q('UPDATE'), { retries: 1, baseDelay: 0 }), error => {
    assert.equal(error, failures[1]);
    assert.equal(error.transactionRolledBack, true);
    return true;
  });
  assert.equal(transactions.length, 2);
  assert.deepEqual(transactions.map(t => t.actions), [
    ['begin', 'query', 'rollback'], ['begin', 'query', 'rollback'],
  ]);
});

test('unknown rollback and commit errors never replay the transaction', async () => {
  const queryError = new Error('connection ended');
  const rollbackError = new Error('rollback failed');
  const first = loadDb([{ queryError, rollbackError }, {}]);
  await assert.rejects(first.withTransaction(q => q('UPDATE'), { retries: 2, baseDelay: 0 }), error => {
    assert.equal(error, queryError);
    assert.equal(error.rollbackError, rollbackError);
    assert.notEqual(error.transactionRolledBack, true);
    return true;
  });
  assert.equal(first.transactions.length, 1);

  const commitError = new Error('commit response lost');
  const second = loadDb([{ commitError }, {}]);
  await assert.rejects(second.withTransaction(() => 'write', { retries: 2, baseDelay: 0 }), commitError);
  assert.equal(second.transactions.length, 1);
  assert.deepEqual(second.transactions[0].actions, ['begin', 'commit', 'rollback']);

  const third = loadDb([{ commitError: deadlock() }, {}]);
  await assert.rejects(third.withTransaction(() => 'write', { retries: 2, baseDelay: 0 }));
  assert.equal(third.transactions.length, 1);
});
