// node __tests__/shipmentImportFinalStateRollback.test.js
//
// 엑셀 출고분배 업로드 — 최종상태(SET, additive 아님) / preflight 전체중단 /
// 0·빈칸·누락의 주문보존+분배0 / 연도 필수화 / 트랜잭션 내부 검증 롤백 계약을 고정한다.
//
// lib/shipmentImport.js 는 모듈 최상단에서 './db'(DB 커넥션 풀)를 import 하기 때문에
// 이 저장소의 plain-node ESM 테스트(빌드 로더 없음, package.json "type" 미지정)에서는
// 확장자 없는 상대경로 해석이 실패해 직접 import 로 함수를 호출할 수 없다(다른 기존
// shipmentImport*.test.js 도 lib/shipmentImportQty.js 처럼 DB 의존이 없는 하위 모듈만
// 직접 import 하고, DB 를 만지는 lib/shipmentImport.js 는 어떤 기존 테스트도 직접
// import 하지 않는다 — 이 저장소의 기존 관례). 따라서 DB 의존 로직은
// __tests__/orderImportRollback20260831.test.js 와 동일한 방식(소스 텍스트 계약 고정)으로
// 회귀를 잠그고, DB 의존이 없는 하위 유틸(lib/orderUtils.js 의 requireOrderYear)만 직접
// 호출해 실제 동작을 검증한다.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const assertLabel = (label, cond) => {
  if (!cond) { console.error(`  ✗ ${label}`); process.exitCode = 1; }
  else console.log(`  ✓ ${label}`);
};

async function main() {
  console.log('=== 요구사항3: requireOrderYear — 연도를 추정하지 않는다 (lib/orderUtils.js 직접 호출) ===');
  const { requireOrderYear } = await import('../lib/orderUtils.js');
  const { compareVerifyResult } = await import('../lib/shipmentImportQty.js');
  const { mergeSnapshotEntries } = await import('../lib/shipmentImportSnapshot.js');
  assert.throws(() => requireOrderYear('29-01', ''), (e) => e.code === 'ORDER_YEAR_REQUIRED' && e.statusCode === 400);
  assertLabel('연도 누락(짧은 NN-NN, 빈 year) → ORDER_YEAR_REQUIRED/400', true);
  assert.throws(() => requireOrderYear('29-01', 'abcd'), (e) => e.code === 'INVALID_ORDER_YEAR');
  assertLabel('4자리 아닌 연도 → INVALID_ORDER_YEAR', true);
  assert.throws(() => requireOrderYear('2025-29-01', '2026'), (e) => e.code === 'ORDER_YEAR_MISMATCH');
  assertLabel('차수내 연도(2025)와 요청연도(2026) 불일치 → ORDER_YEAR_MISMATCH', true);
  {
    const r = requireOrderYear('2026-29-01', '');
    assertLabel('차수에 연도가 박혀있으면(YYYY-NN-NN) 그 값을 그대로 사용', r.orderYear === '2026');
  }
  {
    const r = requireOrderYear('29-01', '2026');
    assertLabel('짧은 NN-NN + 명시 year → 명시 year 사용(추정 아님)', r.orderYear === '2026' && r.orderWeek === '29-01');
  }

  {
    const verified = compareVerifyResult(
      [{ custKey: 1, prodKey: 2, intended: 5, verifyOrder: true, intendedOrder: 5 }],
      new Map([['1|2', { orderQty: 10, outQuantity: 5, dateQty: 5, dateIssueCount: 0 }]]),
    );
    assertLabel('분배가 맞아도 주문이 최종값과 다르면 같은 트랜잭션 검증 실패', verified.mismatchCount === 1 && verified.mismatches[0].reason === '주문수량 불일치');
  }

  {
    const verified = compareVerifyResult(
      [{ custKey: 1, prodKey: 2, intended: 0, verifyOrder: false, intendedOrder: 10 }],
      new Map([['1|2', { orderQty: 10, outQuantity: 0, dateQty: 0, dateIssueCount: 0 }]]),
    );
    assertLabel('0·빈칸·행누락은 주문 10을 보존하고 분배 0만 검증', verified.mismatchCount === 0 && verified.matched === 1);
  }

  {
    const merged = mergeSnapshotEntries([
      { entityType: 'OrderMaster', entityKey: 9, beforeJson: '{"v":1}', afterJson: '{"v":2}', changeKind: 'UPDATED' },
      { entityType: 'OrderMaster', entityKey: 9, beforeJson: '{"v":2}', afterJson: '{"v":3}', changeKind: 'UPDATED' },
    ]);
    assertLabel('같은 마스터 반복 캡처는 최초 before·최종 after 한 건으로 합침', merged.length === 1 && merged[0].beforeJson === '{"v":1}' && merged[0].afterJson === '{"v":3}');
  }

  console.log('\n=== 소스 계약 고정(회귀 방지) — lib/shipmentImport.js ===');
  const src = fs.readFileSync('lib/shipmentImport.js', 'utf8');

  assertLabel(
    '[요구사항1] 빈 셀도 최종 분배 0 지시 행으로 생성',
    /const blankInExcel = !hasCellValue\(XLSX, sheet, r, cc\.col\);/.test(src) &&
    /hasFinalDistributionDirective: true/.test(src),
  );
  assertLabel(
    '[요구사항2] missingFromExcel(엑셀누락)도 분배 0 적용 대상에 포함',
    /applyRows = previewRows\.filter\(r => !r\.fixBlocked && \(!sameQty\(r\.orderDiffQty, 0\) \|\| r\.needsShipmentApply\)\);/.test(src),
  );
  assertLabel(
    '[요구사항2] 주문 차이는 양수 셀만 계산하고 0·빈칸·누락은 0',
    /const orderDiffQty = uploadQty > 0 \? \(uploadQty - r\.orderQty\) : 0;/.test(src),
  );
  assertLabel(
    '[요구사항2] 주문 없이 남은 분배도 NOT EXISTS 주문 대조로 비교대상에 포함',
    /const shipmentOnlyDbResult = await query\(/.test(src) &&
    /AND NOT EXISTS \(\s*SELECT 1\s*FROM OrderMaster om\s*JOIN OrderDetail od/.test(src),
  );
  assertLabel(
    '[요구사항3] applyImportRowsCore/applyImportRows 모두 requireOrderYear 사용(연도 추정 금지) — resolveImportOrderYear 아님',
    (src.match(/const \{ orderYear \} = requireOrderYear\(rawWeek, rawYear\);/g) || []).length >= 2,
  );
  assertLabel(
    '[요구사항4] preflight 단계에서 확정행/stale/단위환산불가를 모아 전체 중단(PREFLIGHT_BLOCKED, partial skip 아님)',
    /err\.code = 'PREFLIGHT_BLOCKED';/.test(src) &&
    /preflightBlockers\.length/.test(src) &&
    /if \(fixCheck\.fixBlocked\) \{\s*\n\s*preflightBlockers\.push/.test(src),
  );
  assertLabel(
    '[요구사항4] 최종값 stale 판정 — 목표 도달은 허용하고 제3값만 차단하는 공용 정책 사용',
    /evaluateImportFinalStateStale\(\{/.test(src) &&
    /if \(finalStateStale\.orderBlocked\)/.test(src) &&
    /if \(finalStateStale\.shipmentBlocked\)/.test(src),
  );
  assertLabel(
    '[요구사항5] 같은 트랜잭션 내부(tQ)에서 커밋 전 재조회·검증하고 불일치 시 throw(rollback)',
    /const inTxVerification = await verifyAppliedShipmentRows\(tQ, week, inTxTargets, orderYear\);/.test(src) &&
    /if \(inTxVerification\.mismatchCount > 0\) \{/.test(src) &&
    /err\.code = 'APPLY_VERIFICATION_FAILED';/.test(src),
  );
  assertLabel(
    '업무 쓰기·복원 스냅샷·이력 완료 상태를 같은 트랜잭션에서 확정',
    /await markShipmentImportAuditAppliedInTransaction\(tQ, \{/.test(src),
  );
  assertLabel(
    '[요구사항5] 커밋 후 재검증에서도 불일치면 success:true 를 반환하지 않음',
    /success: !\(verification\.mismatchCount > 0\),/.test(src),
  );
  assertLabel(
    'verifyAppliedShipmentRows 는 queryFn 을 주입받아 트랜잭션 내부(tQ)/커밋후(query) 양쪽에서 재사용',
    /async function verifyAppliedShipmentRows\(queryFn, week, targets, orderYear/.test(src) &&
    /await verifyAppliedShipmentRows\(query, week, dedupedVerifyTargets, orderYear\);/.test(src),
  );

  console.log('\n=== 소스 계약 고정 — API/UI 연동 ===');
  const apiSrc = fs.readFileSync('pages/api/shipment/distribute-import-apply.js', 'utf8');
  assertLabel(
    'apply API가 requireOrderYear 등에서 던진 statusCode/code 를 그대로 응답에 반영',
    /if \(e\.statusCode\) \{/.test(apiSrc) && /code: e\.code/.test(apiSrc),
  );

  const uiSrc = fs.readFileSync('pages/shipment/distribute-import.js', 'utf8');
  assertLabel(
    'UI apply 요청이 preview.orderYear 를 함께 보냄(서버가 추정하지 않도록)',
    /body: JSON\.stringify\(\{ week: preview\.week, year: preview\.orderYear, rows: applyRows/.test(uiSrc),
  );
  assertLabel(
    'UI도 엑셀누락 행을 분배 0 적용대상에 포함',
    /const applyTarget = r => !r\.fixBlocked && \(orderChanged\(r\) \|\| shipmentNeedsApply\(r\)\);/.test(uiSrc),
  );
  assertLabel('UI가 0·빈칸·누락의 주문보존·분배0을 설명', uiSrc.includes('주문등록값을 유지하고 출고분배만 0으로 처리합니다.'));
  assertLabel(
    'UI 이력에서 증거 삭제 대신 전체 되돌리기 API 사용',
    uiSrc.includes('/api/shipment/distribute-import-rollback') && uiSrc.includes('업로드 이력 · 전체 되돌리기'),
  );
  assertLabel(
    '분배만 반영 선택은 제거되고 주문등록+분배만 제공',
    !uiSrc.includes('분배만 반영(주문 미변경)') && !uiSrc.includes('shipmentOnly, jobId') && uiSrc.includes('승인 후 주문등록+분배'),
  );
  assertLabel(
    '서버도 분배만 요청을 명시적으로 거부',
    apiSrc.includes("SHIPMENT_ONLY_NOT_ALLOWED") && /shipmentOnly: false/.test(apiSrc) && src.includes("SHIPMENT_ONLY_NOT_ALLOWED"),
  );

  const snapshotSrc = fs.readFileSync('lib/shipmentImportSnapshot.js', 'utf8');
  const rollbackSrc = fs.readFileSync('lib/shipmentImportRollback.js', 'utf8');
  const migrationSrc = fs.readFileSync('docs/migrations/2026-08-31_shipment_import_snapshot_rollback.sql', 'utf8');
  const deploySrc = fs.readFileSync('.github/workflows/deploy.yml', 'utf8');
  assertLabel('조회·저장 경로는 런타임 DDL 대신 설치 여부만 검사', snapshotSrc.includes('assertShipmentImportSnapshotSchema') && !snapshotSrc.includes('CREATE TABLE dbo.ShipmentImportSnapshot'));
  assertLabel('스냅샷 설치는 별도 migration에만 존재', migrationSrc.includes('CREATE TABLE dbo.ShipmentImportSnapshot') && migrationSrc.includes('RollbackStatus'));
  assertLabel('운영 배포는 새 코드 실행 전에 스냅샷 migration을 적용', deploySrc.includes('node scripts/apply-shipment-import-snapshot-migration.mjs --apply'));
  assertLabel('롤백 전 현재값과 저장된 after 스냅샷을 전부 비교', rollbackSrc.includes("currentJson !== snapshot.AfterJson") && rollbackSrc.includes('SHIPMENT_IMPORT_ROLLBACK_CONFLICT'));
  assertLabel('롤백은 원본 이력을 삭제하지 않고 ROLLED_BACK 상태·작업자·사유를 기록', rollbackSrc.includes("AuditStatus=N'ROLLED_BACK'") && rollbackSrc.includes('RolledBackBy=@actor') && !rollbackSrc.includes('DELETE FROM ShipmentImportAudit'));
  assertLabel('되돌리기 API는 서버 관리자 권한을 재검사', fs.readFileSync('pages/api/shipment/distribute-import-rollback.js', 'utf8').includes('isAdminUser(req.user)'));

  if (!process.exitCode) console.log('\n=== RESULT: all passed ===');
}

main().catch(e => { console.error(e); process.exitCode = 1; });
