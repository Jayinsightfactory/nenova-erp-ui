// Run only after the parser fix is deployed. Default: read-only review.
// Apply: node scripts/quarantine-arrival-china-week-20261005.mjs --apply --review-sha=<dry-run digest>
import fs from 'node:fs';
import crypto from 'node:crypto';
import sql from 'mssql';

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
}
const apply = process.argv.includes('--apply');
const reviewed = process.argv.find(value => value.startsWith('--review-sha='))?.slice(13);
const pool = await sql.connect({ server: process.env.DB_SERVER, port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true } });
const predicate = `l.ImportKey=33 AND l.OrderYear=N'2026' AND l.OrderWeek=N'40-1'
  AND l.SheetName IN (N'34-2A CLOUD',N'34-2B CLOUD') AND l.IsCurrent=1`;
let transaction;
try {
  if (apply) {
    if (!/^[a-f0-9]{64}$/.test(reviewed || '')) throw new Error('Apply requires the exact dry-run review digest');
    transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    await new sql.Request(transaction).query(`DECLARE @rc INT;
      EXEC @rc=sys.sp_getapplock @Resource=N'WebArrivalCostImport',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
      IF @rc<0 THROW 51000,N'Arrival import lock unavailable',1;`);
  }
  const request = () => new sql.Request(transaction || pool);
  const before = (await request().query(`SELECT l.* FROM dbo.WebArrivalCostLine l
    ${apply ? 'WITH (UPDLOCK,HOLDLOCK)' : ''} WHERE ${predicate} ORDER BY l.ArrivalLineKey`)).recordset;
  if (!before.length) throw new Error('No current incident rows; inspect prior quarantine history before rerunning');
  const edits = (await request().query(`SELECT h.HistoryKey,h.ArrivalLineKey,h.ActionType
    FROM dbo.WebArrivalCostHistory h JOIN dbo.WebArrivalCostLine l ON l.ArrivalLineKey=h.ArrivalLineKey
    WHERE ${predicate} AND h.ActionType IN (N'MATCH',N'BASIS_CHANGE') ORDER BY h.HistoryKey`)).recordset;
  const sha = crypto.createHash('sha256').update(JSON.stringify({ before, edits })).digest('hex');
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'review', count: before.length, manualEdits: edits.length,
    reviewSha: sha, keys: before.map(row => row.ArrivalLineKey),
    reason: 'Explicit sheets34-2A/34-2B CLOUD was incorrectly stored as40-1; source year remains unproven' }, null, 2));
  if (edits.length) throw new Error('Manual matching/basis history exists: quarantine requires a separate reviewed plan');
  if (apply) {
    if (sha !== reviewed) throw new Error('Incident rows changed since review');
    for (const row of before) {
      const after = { ...row, IsCurrent: false };
      await request().input('key', sql.Int, row.ArrivalLineKey).input('before', sql.NVarChar(sql.MAX), JSON.stringify(row))
        .input('after', sql.NVarChar(sql.MAX), JSON.stringify({ ...after, quarantineReason: 'SHEET_WEEK_MISMATCH_YEAR_UNPROVEN', reviewSha: sha }))
        .query(`INSERT dbo.WebArrivalCostHistory(ArrivalLineKey,ImportKey,ActionType,BeforeJson,AfterJson,ChangedBy,ChangedByName)
          VALUES(@key,33,N'QUARANTINE',@before,@after,N'nenovaSS3',N'2026-10-05 reviewed arrival repair');
          UPDATE dbo.WebArrivalCostLine SET IsCurrent=0 WHERE ArrivalLineKey=@key AND IsCurrent=1;
          IF @@ROWCOUNT<>1 THROW 51000,N'Quarantine row changed',1;`);
    }
    const after = (await request().query(`SELECT l.* FROM dbo.WebArrivalCostLine l WHERE l.ArrivalLineKey IN (${before.map(row => row.ArrivalLineKey).join(',')}) ORDER BY l.ArrivalLineKey`)).recordset;
    for (let index = 0; index < before.length; index++) {
      const expected = { ...before[index], IsCurrent: false };
      if (JSON.stringify(expected) !== JSON.stringify(after[index])) throw new Error('Preservation verification failed');
    }
    await transaction.commit();
    transaction = null;
    console.log('Committed quarantine. All original values retained; reversal must use audited keys and conflict checks.');
  }
} catch (error) {
  if (transaction) await transaction.rollback();
  throw error;
} finally { await pool.close(); }

