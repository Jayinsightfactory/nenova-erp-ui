// 실행: node __tests__/salesRegistrationConfirm.test.js
import fs from 'node:fs';
import assert from 'node:assert/strict';

function snap(overrides) {
  return {
    SnapshotKey: 1,
    OrderWeek: '33-01',
    SnapshotType: 'TUE_FINAL',
    takenAt: '2026-08-11 17:00:00',
    ...overrides,
  };
}

async function main() {
  const {
    SALES_CONFIRM_TYPE,
    salesCaptureYearPredicateSql,
    pickLatestSalesConfirm,
    latestSalesConfirmByWeek,
    resolveSalesHistoryBaseline,
    diffRowSets,
  } = await import('../lib/salesSnapshotPolicy.js');

  const snapshots = [
    snap({ SnapshotKey: 10, SnapshotType: 'TUE_FINAL' }),
    snap({ SnapshotKey: 11, SnapshotType: 'WED_CHECK', takenAt: '2026-08-12 16:00:00' }),
    snap({ SnapshotKey: 20, SnapshotType: SALES_CONFIRM_TYPE, takenAt: '2026-08-13 09:00:00' }),
    snap({ SnapshotKey: 30, SnapshotType: SALES_CONFIRM_TYPE, takenAt: '2026-08-14 11:00:00' }),
    snap({ SnapshotKey: 21, OrderWeek: '33-02', SnapshotType: SALES_CONFIRM_TYPE, takenAt: '2026-08-13 09:05:00' }),
  ];

  assert.equal(SALES_CONFIRM_TYPE, 'REG_CONFIRM');
  assert.ok(SALES_CONFIRM_TYPE.length <= 12, 'SnapshotType NVARCHAR(12) 한도');

  assert.equal(pickLatestSalesConfirm(snapshots, '33-01').SnapshotKey, 30);
  assert.equal(pickLatestSalesConfirm(snapshots, '33-02').SnapshotKey, 21);

  const latestByWeek = latestSalesConfirmByWeek(snapshots);
  assert.deepEqual(latestByWeek.map((s) => s.SnapshotKey), [30, 21]);

  const noConfirm = resolveSalesHistoryBaseline({
    snapshots: snapshots.filter((s) => s.SnapshotType !== SALES_CONFIRM_TYPE),
    week: '33-01',
  });
  assert.equal(noConfirm.type, 'TUE_FINAL');
  assert.equal(noConfirm.snapshotKey, 10);
  assert.equal(noConfirm.source, 'default');

  const autoConfirm = resolveSalesHistoryBaseline({ snapshots, week: '33-01' });
  assert.equal(autoConfirm.type, SALES_CONFIRM_TYPE);
  assert.equal(autoConfirm.snapshotKey, 30);
  assert.equal(autoConfirm.source, 'sales-confirm');

  const explicitTue = resolveSalesHistoryBaseline({
    snapshots,
    week: '33-01',
    confirmed: { snapshotKey: 10, confirmedBy: 'jay', confirmedDtm: '2026-08-14 12:00:00' },
  });
  assert.equal(explicitTue.snapshotKey, 10);
  assert.equal(explicitTue.type, 'TUE_FINAL');
  assert.equal(explicitTue.source, 'confirmed');

  const explicitOldConfirm = resolveSalesHistoryBaseline({
    snapshots,
    week: '33-01',
    confirmed: { snapshotKey: 20, confirmedBy: 'jay', confirmedDtm: '2026-08-13 09:01:00' },
  });
  assert.equal(explicitOldConfirm.snapshotKey, 20, '적용 확인한 스냅샷이 최신 REG_CONFIRM보다 우선');

  const yearSql = salesCaptureYearPredicateSql();
  assert.match(yearSql, /sm\.OrderYear = @yr/);
  assert.match(yearSql, /OrderYearWeek/);

  const baseRows = [{
    RowType: 'SD', RefKey: 101, CustKey: 7, CustName: 'A꽃', ProdKey: 9, ProdName: 'ROSE',
    OutQuantity: 12, EstQuantity: 12, Cost: 11000, Amount: 120000, Vat: 12000,
  }];
  const currRows = [{
    ...baseRows[0], OutQuantity: 10, EstQuantity: 10, Amount: 100000, Vat: 10000,
  }];
  const diff = diffRowSets(baseRows, currRows);
  assert.equal(diff.hasDiff, true);
  assert.equal(diff.changed.length, 1);
  assert.equal(diff.changed[0].diffs.OutQuantity.before, 12);
  assert.equal(diff.changed[0].diffs.OutQuantity.after, 10);
  assert.equal(Math.round(diff.amtDelta), -22000);

  const apiSrc = fs.readFileSync('pages/api/sales/registration-history.js', 'utf8');
  assert.match(apiSrc, /action === 'confirmSales'/);
  assert.match(apiSrc, /SALES_CONFIRM_TYPE/);
  assert.match(apiSrc, /req\.body\?\.year/);
  assert.match(apiSrc, /captureCurrentRows\(w, orderYear\)/);
  assert.match(apiSrc, /salesCaptureYearPredicateSql\(\)/);
  assert.doesNotMatch(apiSrc, /INSERT INTO (?:OrderMaster|OrderDetail|ShipmentMaster|ShipmentDetail|Estimate)\b/);

  const pageSrc = fs.readFileSync('pages/sales/registration-history.js', 'utf8');
  assert.match(pageSrc, /판매등록확정/);
  assert.match(pageSrc, /action: 'confirmSales'/);
  assert.match(pageSrc, /year: orderYear/);
  assert.match(pageSrc, /from '\.\.\/\.\.\/lib\/salesSnapshotPolicy'/);
  assert.doesNotMatch(pageSrc, /from '\.\.\/\.\.\/lib\/salesSnapshot'/);

  const snapSrc = fs.readFileSync('lib/salesSnapshot.js', 'utf8');
  assert.match(snapSrc, /LOCKED_TYPES = \['TUE_FINAL', 'WED_CHECK', 'TUE_CLOSE', 'CLOSE_CHECK'\]/);
  assert.doesNotMatch(snapSrc, /LOCKED_TYPES = \[[^\]]*REG_CONFIRM/);
  assert.match(snapSrc, /NVARCHAR\(12\)/);

  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert.match(pkg.scripts['test:erp-contract'], /salesRegistrationConfirm\.test\.js/);

  console.log('salesRegistrationConfirm tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
