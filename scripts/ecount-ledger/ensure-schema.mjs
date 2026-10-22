// ecount 스키마·Dataset 시드 ensure (+ --views 로 존재하는 Raw 테이블에 대한 cmp 뷰 갱신). 멱등.
import { loadEnv, parseArgs } from './_env.mjs';

loadEnv();
const { opt } = parseArgs(process.argv.slice(2));
const { query, getPool } = await import('../../lib/db.js');
const { ensureEcountSchema } = await import('../../lib/ecountLedger/schema.js');
await ensureEcountSchema();
const ds = await query(`SELECT COUNT(*) AS n FROM ecount.Dataset`);
const lb = await query(`SELECT COUNT(*) AS n FROM ecount.LoadBatch`);
console.log(`ecount 스키마 OK · Dataset ${ds.recordset[0].n}건 · LoadBatch ${lb.recordset[0].n}건`);
if (opt.views) {
  const { ensureCompareViews } = await import('../../lib/ecountLedger/views.js');
  console.log(await ensureCompareViews());
}
(await getPool()).close();
