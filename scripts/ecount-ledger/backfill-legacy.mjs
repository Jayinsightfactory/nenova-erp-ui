// dbo.WebEcountSnapshot/WebEcountRow(옛 적재 엔진) → ecount.Raw_* 이관. 기본 --dry-run, --apply 로 실제 적재.
// 읽기: dbo.WebEcount*. 쓰기: ecount 스키마만(--apply 일 때). 이카운트에는 접근하지 않는다.
// 사용: node scripts/ecount-ledger/backfill-legacy.mjs [--apply] [--dataset sales|ar|ap|cash]
import { loadEnv, parseArgs } from './_env.mjs';

loadEnv();
const { opt } = parseArgs(process.argv.slice(2));
const apply = opt.apply === true;
const MAP = { sales: 'E040207', ar: 'E040214', ap: 'E040309', cash: 'E010205' };
const MENU = { sales: '판매현황', ar: '거래처별채권', ap: '거래처별채무', cash: '입/출금계좌 조회' };
const SKIP_KEYS = new Set(['isSubtotal', '_flag']);

const { query, sql, getPool } = await import('../../lib/db.js');
const { prepareRows, loadRows } = await import('../../lib/ecountLedger/loader.js');
const { ensureEcountSchema } = await import('../../lib/ecountLedger/schema.js');

const normDate = (s) => {
  const t = String(s || '').trim().replace(/\//g, '-');
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
};

async function doneSnapshots(prgId) {
  const r = await query(
    `IF OBJECT_ID(N'ecount.LoadBatch', N'U') IS NULL SELECT CAST(NULL AS NVARCHAR(400)) AS Note WHERE 1 = 0
     ELSE SELECT Note FROM ecount.LoadBatch WHERE PrgId = @p AND Source = N'legacy_snapshot'`,
    { p: { type: sql.NVarChar(20), value: prgId } },
  );
  return new Set(r.recordset.map((x) => x.Note));
}

if (apply) await ensureEcountSchema();
const only = typeof opt.dataset === 'string' ? [opt.dataset] : Object.keys(MAP);
const summary = [];

for (const ds of only) {
  const prgId = MAP[ds];
  if (!prgId) { console.error(`알 수 없는 dataset: ${ds}`); process.exit(2); }
  const snaps = (await query(
    `SELECT SnapshotKey, PeriodFrom, PeriodTo, RowCnt, ScreenTotal FROM WebEcountSnapshot WHERE Dataset = @d ORDER BY SnapshotKey`,
    { d: { type: sql.NVarChar(20), value: ds } },
  )).recordset;
  const done = await doneSnapshots(prgId);
  const seen = new Set(); // dry-run 용 메모리 해시 집합
  let batches = 0; let totalRows = 0; let inserted = 0; let dedup = 0; let skipped = 0; let empty = 0;
  for (const sn of snaps) {
    const note = `SnapshotKey=${sn.SnapshotKey}`;
    if (done.has(note)) { skipped += 1; continue; }
    const rr = (await query(`SELECT Payload, IsSubtotal FROM WebEcountRow WHERE SnapshotKey = @k ORDER BY RowKey`, { k: { type: sql.Int, value: sn.SnapshotKey } })).recordset;
    const keys = [];
    const rows = [];
    for (const r of rr) {
      let o; try { o = JSON.parse(r.Payload || '{}'); } catch { continue; }
      for (const k of Object.keys(o)) if (!SKIP_KEYS.has(k) && !keys.includes(k)) keys.push(k);
      rows.push({ ...o, __isSubtotal: r.IsSubtotal === true || o.isSubtotal === true });
    }
    if (!rows.length) { empty += 1; continue; }
    batches += 1; totalRows += rows.length;
    if (apply) {
      const res = await loadRows({
        prgId, headers: keys, rows,
        batchMeta: { menuName: MENU[ds], source: 'legacy_snapshot', note, periodFrom: normDate(sn.PeriodFrom), periodTo: normDate(sn.PeriodTo), screenTotal: sn.ScreenTotal, loadedBy: 'backfill-legacy' },
      });
      inserted += res.inserted; dedup += res.dedup;
    } else {
      const { items } = prepareRows(prgId, keys, rows);
      const cur = new Set();
      for (const it of items) { if (seen.has(it.hash)) dedup += 1; else { cur.add(it.hash); inserted += 1; } }
      for (const h of cur) seen.add(h); // 같은 배치 안 동일 행은 DB 로더와 같이 모두 삽입
    }
  }
  summary.push({ dataset: ds, prgId, snapshots: snaps.length, alreadyDone: skipped, emptySnapshots: empty, batches, rows: totalRows, [apply ? 'inserted' : 'wouldInsert']: inserted, [apply ? 'dedupSkipped' : 'wouldDedupSkip']: dedup });
  console.log(JSON.stringify(summary[summary.length - 1]));
}
const t = summary.reduce((a, s) => ({ batches: a.batches + s.batches, rows: a.rows + s.rows, ins: a.ins + (s.inserted ?? s.wouldInsert), dup: a.dup + (s.dedupSkipped ?? s.wouldDedupSkip) }), { batches: 0, rows: 0, ins: 0, dup: 0 });
console.log(`${apply ? '[APPLY]' : '[DRY-RUN]'} 배치 ${t.batches} · 입력 ${t.rows}행 · 삽입 ${t.ins} · 중복 생략 ${t.dup}`);
(await getPool()).close();
