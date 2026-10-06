// Main-agent operational repair only. Default is a read-only review, never DDL.
// Apply requires the exact reviewed snapshot SHA; generic deleteDeductions is
// deliberately not used because it also deletes linked Estimate rows.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import { REVIEWED_DEFECT_DUPLICATE_PAIRS, validateReviewedDefectDuplicate } from '../lib/defectDuplicateCleanup.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z_0-9]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
}
const arg = (name) => process.argv.find((v) => v.startsWith(`${name}=`))?.slice(name.length + 1);
const apply = process.argv.includes('--apply');
const expectedSha = arg('--expected-sha');
const actor = arg('--actor'), actorName = arg('--actor-name');
if (apply && (!/^[a-f0-9]{64}$/.test(expectedSha || '') || !actor || !actorName)) {
  throw new Error('Apply requires --expected-sha=<reviewed SHA256> --actor=<ID> --actor-name=<name>');
}
const ids = REVIEWED_DEFECT_DUPLICATE_PAIRS.flatMap((p) => [p.duplicateKey, p.canonicalKey]).join(',');
const pool = await sql.connect({ server: process.env.DB_SERVER, port: Number(process.env.DB_PORT || 1433),
  database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  options: { encrypt: false, trustServerCertificate: true }, requestTimeout: 120000 });
let tx;
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function readSnapshot(owner, lock = false) {
  const hint = lock ? 'WITH (UPDLOCK,HOLDLOCK)' : '';
  const ledger = (await new sql.Request(owner).query(`SELECT * FROM WebSalesDefectDeduction ${hint} WHERE DeductionKey IN (${ids}) ORDER BY DeductionKey`)).recordset;
  const applications = (await new sql.Request(owner).query(`SELECT * FROM WebSalesCarryoverApplication ${hint} WHERE DeductionKey IN (${ids}) ORDER BY ApplicationKey`)).recordset;
  const estimates = (await new sql.Request(owner).query(`SELECT e.*, sm.OrderYear,sm.OrderWeek,sm.CustKey,sm.isDeleted AS MasterDeleted
    FROM Estimate e ${hint} JOIN ShipmentMaster sm ${hint} ON sm.ShipmentKey=e.ShipmentKey
    WHERE e.EstimateKey IN (SELECT EstimateKey FROM WebSalesDefectDeduction WHERE DeductionKey IN (${ids}) AND EstimateKey IS NOT NULL)
    ORDER BY e.EstimateKey`)).recordset;
  return { ledger, applications, estimates };
}
function review(snapshot) {
  return REVIEWED_DEFECT_DUPLICATE_PAIRS.map((p) => {
    const duplicate = snapshot.ledger.find((r) => r.DeductionKey === p.duplicateKey);
    const canonical = snapshot.ledger.find((r) => r.DeductionKey === p.canonicalKey);
    const estimate = snapshot.estimates.find((r) => r.EstimateKey === canonical?.EstimateKey);
    return validateReviewedDefectDuplicate({ duplicate, canonical, estimate, applications: snapshot.applications });
  });
}
try {
  if (apply) { tx = new sql.Transaction(pool); await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE); }
  const before = await readSnapshot(tx || pool, apply);
  const plan = review(before), sha = digest(before);
  if (!apply) {
    console.log(JSON.stringify({ mode: 'read-only', sha256: sha, plan, before }, null, 2));
  } else {
    if (sha !== expectedSha) throw new Error('Reviewed snapshot changed; refresh dry-run and review again. No writes.');
    for (const item of plan) {
      const original = before.ledger.find((r) => r.DeductionKey === item.duplicateKey);
      const updated = await new sql.Request(tx).input('key', sql.Int, item.duplicateKey)
        .input('version', sql.Int, original.RowVersionNo).input('actor', sql.NVarChar(100), actor)
        .input('name', sql.NVarChar(100), actorName).query(`UPDATE WebSalesDefectDeduction
          SET IsDeleted=1,Status=N'DELETED',DeletedBy=@actor,DeletedAt=GETDATE(),
              UpdatedBy=@actor,UpdatedByName=@name,UpdatedAt=GETDATE(),RowVersionNo=RowVersionNo+1
          OUTPUT inserted.* WHERE DeductionKey=@key AND RowVersionNo=@version
            AND IsDeleted=0 AND Status=N'DRAFT' AND EstimateKey IS NULL`);
      if (updated.recordset.length !== 1) throw new Error('Concurrent duplicate change; rollback.');
      await new sql.Request(tx).input('key', sql.Int, item.duplicateKey)
        .input('actor', sql.NVarChar(100), actor).input('name', sql.NVarChar(100), actorName)
        .input('summary', sql.NVarChar(1000), `중복 초안 정리: 정상 원장 #${item.canonicalKey}, 견적 #${item.estimateKey} 보존; snapshot=${sha}`)
        .input('before', sql.NVarChar(sql.MAX), JSON.stringify(original))
        .input('after', sql.NVarChar(sql.MAX), JSON.stringify(updated.recordset[0]))
        .query(`INSERT INTO WebSalesDefectDeductionHistory
          (DeductionKey,ActionType,ChangedBy,ChangedByName,ChangeSummary,BeforeJson,AfterJson)
          VALUES (@key,N'DUPLICATE_CLEANUP',@actor,@name,@summary,@before,@after)`);
    }
    const after = await readSnapshot(tx, true);
    const duplicateIds = new Set(plan.map((p) => p.duplicateKey));
    if (digest(before.estimates) !== digest(after.estimates)
      || digest(before.applications) !== digest(after.applications)
      || digest(before.ledger.filter((r) => !duplicateIds.has(r.DeductionKey)))
         !== digest(after.ledger.filter((r) => !duplicateIds.has(r.DeductionKey)))) {
      throw new Error('Protected canonical/Estimate/application evidence changed; rollback.');
    }
    await tx.commit(); tx = null;
    console.log(JSON.stringify({ mode: 'applied', reviewedSha256: sha, plan, after }, null, 2));
  }
} catch (error) {
  if (tx) await tx.rollback();
  throw error;
} finally { await pool.close(); }
