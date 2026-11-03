// 정규화된 거래를 bank.Txn 에 적재. 파라미터 바인딩만 사용. (AccountKey,RowHash) 중복은 삽입 생략.
import { query, withTransaction, sql } from '../db.js';
import { ensureBankSchema } from './schema.js';
import { withHashes } from './core.js';

export async function getAccountByAlias(alias) {
  await ensureBankSchema();
  const r = await query('SELECT AccountKey, Bank, Alias FROM bank.Account WHERE Alias = @a AND IsActive = 1', { a: { type: sql.NVarChar(60), value: alias } });
  return r.recordset[0] || null;
}

export async function upsertAccount({ bank, alias, accountNoMasked }) {
  await ensureBankSchema();
  const r = await query(
    `IF NOT EXISTS (SELECT 1 FROM bank.Account WHERE Alias = @a) INSERT INTO bank.Account (Bank, Alias, AccountNoMasked) VALUES (@b, @a, @m);
     SELECT AccountKey FROM bank.Account WHERE Alias = @a`,
    { a: { type: sql.NVarChar(60), value: alias }, b: { type: sql.NVarChar(20), value: bank }, m: { type: sql.NVarChar(30), value: accountNoMasked ?? null } },
  );
  return r.recordset[0].AccountKey;
}

export async function loadTxns({ accountKey, txns, from, to, source = 'quick-inquiry', note = null }) {
  await ensureBankSchema();
  const items = withHashes(accountKey, txns);
  return withTransaction(async (tQuery) => {
    const b = await tQuery(
      'INSERT INTO bank.LoadBatch (AccountKey, PeriodFrom, PeriodTo, Source, RowCnt, Note) OUTPUT INSERTED.BatchKey VALUES (@ak, @pf, @pt, @src, 0, @n)',
      { ak: { type: sql.Int, value: accountKey }, pf: { type: sql.Date, value: from ?? null }, pt: { type: sql.Date, value: to ?? null }, src: { type: sql.NVarChar(40), value: source }, n: { type: sql.NVarChar(400), value: note } },
    );
    const batchKey = b.recordset[0].BatchKey;
    let inserted = 0;
    for (const t of items) {
      const r = await tQuery(
        `IF NOT EXISTS (SELECT 1 FROM bank.Txn WHERE AccountKey=@ak AND RowHash=@h)
         INSERT INTO bank.Txn (AccountKey,BatchKey,TxnDate,TxnTime,Type,Amount,Balance,Description,DisplayName,Counterparty,Branch,Memo,RawJson,RowHash)
         VALUES (@ak,@bk,@d,@tm,@ty,@am,@bal,@ds,@dn,@cp,@br,@me,@raw,@h)`,
        {
          ak: { type: sql.Int, value: accountKey }, bk: { type: sql.Int, value: batchKey }, h: { type: sql.Char(64), value: t.hash },
          d: { type: sql.Date, value: t.txnDate }, tm: { type: sql.NVarChar(8), value: t.txnTime }, ty: { type: sql.NVarChar(12), value: t.type },
          am: { type: sql.Decimal(18, 2), value: t.amount }, bal: { type: sql.Decimal(18, 2), value: t.balance },
          ds: { type: sql.NVarChar(200), value: t.description }, dn: { type: sql.NVarChar(100), value: t.displayName },
          cp: { type: sql.NVarChar(100), value: t.counterparty }, br: { type: sql.NVarChar(60), value: t.branch },
          me: { type: sql.NVarChar(200), value: t.memo }, raw: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(t.raw) },
        },
      );
      inserted += (r.rowsAffected || []).reduce((a, x) => a + x, 0) > 0 ? 1 : 0;
    }
    await tQuery('UPDATE bank.LoadBatch SET RowCnt=@c WHERE BatchKey=@b', { c: { type: sql.Int, value: inserted }, b: { type: sql.Int, value: batchKey } });
    return { batchKey, parsed: items.length, inserted, deduped: items.length - inserted };
  });
}
