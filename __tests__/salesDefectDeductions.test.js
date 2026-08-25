import assert from 'node:assert/strict';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { scoreMatch } from '../lib/displayName.js';
import {
  deductionManagerIdentity,
  normalizeParentWeek,
  normalizeDefectUnit,
  isEarlierOrSameScope,
  previousParentScope,
  normalizeDeductionRow,
  managerFilterForUser,
  partitionRegistrationPreflight,
  mergeSavedDeductionRows,
  partitionSelectedDeductionRows,
  lookupSelectionDelta,
  shiftParentWeek,
  isNoopDeductionHistory,
} from '../lib/salesDefectDeductionCore.js';
import { getStatementProductName } from '../lib/estimatePrintFormats.js';
import { deriveSupportProcessingStatus, isSupportManualCompleteSelectable, isSupportProcessingComplete, supportCarryoverFromLabel, supportProcessingLabel, supportRegisterUsageNotice, supportRegistrationDecisionLabel, supportStatusDetail } from '../lib/salesDefectSupportStatus.js';
import { buildEstimateCustomerUrl } from '../lib/estimateFixStatusLink.js';
import {
  parseQuantityCell,
  parseSalesDefectWorkbook,
  buildSalesDefectWorkbook,
  formatSalesDefectExportRows,
  paginateSalesDefectExportRows,
  customerExportName,
} from '../lib/salesDefectDeductionExcel.js';
import { matchImportRows, buildProductMappingStats, buildProductSuggestions } from '../lib/orderImportMatch.js';
import { rankProductSearchOptions } from '../lib/productSearchRanking.js';
import { resolveImportCustomer } from '../lib/orderImportCustomerMatch.js';
import { matchSalesDefectRows } from '../lib/salesDefectDeductions.js';

assert.equal(normalizeParentWeek('29-02'), 29);
assert.equal(normalizeParentWeek('29'), 29);
assert.deepEqual(previousParentScope(2026, 29), { year: 2026, week: 28 });
assert.deepEqual(previousParentScope(2026, 1), { year: 2025, week: 52 });
assert.deepEqual(shiftParentWeek(2026, 29, -1), { year: 2026, week: 28 });
assert.deepEqual(shiftParentWeek(2026, 29, 1), { year: 2026, week: 30 });
assert.deepEqual(shiftParentWeek(2026, 1, -1), { year: 2025, week: 52 });
assert.deepEqual(shiftParentWeek(2026, 52, 1), { year: 2027, week: 1 });
assert.deepEqual(parseQuantityCell('1,250단'), { quantity: 1250, unit: '단', raw: '1,250단' });
assert.deepEqual(parseQuantityCell('5대'), { quantity: 5, unit: '스팀(대)', raw: '5대' });
assert.equal(normalizeDeductionRow({ quantity: '-5', customerName: 'A' }).quantity, 5);
assert.equal(normalizeDefectUnit('단'), '단');
assert.equal(normalizeDefectUnit('box'), '박스');
assert.equal(normalizeDefectUnit('대'), '스팀(대)');
assert.equal(normalizeDefectUnit('unknown'), '');
assert.equal(isEarlierOrSameScope(2026, 29, 2026, 30), true);
assert.equal(isEarlierOrSameScope(2026, 31, 2026, 30), false);
assert.equal(isEarlierOrSameScope(2025, 52, 2026, 1), true);
assert.equal(getStatementProductName({ ProdName: 'CARNATION Moon Light' }), 'Moon Light');
assert.equal(getStatementProductName({ ProdName: 'CARNATION Novia' }), 'Novia');
const savedNewRows = mergeSavedDeductionRows(
  [
    { deductionKey: null, customerName: '상희꽃상사', productName: '카네이션', colorName: 'Moon Light', quantity: 1 },
    { deductionKey: null, customerName: '상희꽃상사', productName: '카네이션', colorName: 'Novia', quantity: 2 },
  ],
  [
    { deductionKey: 101, customerName: '상희꽃상사', colorName: 'Moon Light', quantity: 1 },
    { deductionKey: 102, customerName: '상희꽃상사', colorName: 'Novia', quantity: 2 },
  ],
  [
    { deductionKey: null, customerName: '상희꽃상사', productName: '카네이션', colorName: 'Moon Light', quantity: 1 },
    { deductionKey: null, customerName: '상희꽃상사', productName: '카네이션', colorName: 'Novia', quantity: 2 },
  ],
);
assert.deepEqual(savedNewRows.map((row) => row.deductionKey), [101, 102]);
assert.deepEqual(
  partitionSelectedDeductionRows(
    [{ deductionKey: 101 }, { deductionKey: null }, { deductionKey: 102 }],
    new Set([0, 1]),
  ),
  { indexes: [0, 1], storedKeys: [101], unsavedIndexes: [1] },
);
assert.equal(lookupSelectionDelta('ArrowRight'), 1);
assert.equal(lookupSelectionDelta('ArrowLeft'), -1);
assert.equal(lookupSelectionDelta('ArrowDown'), 1);
assert.equal(lookupSelectionDelta('Enter'), 0);
assert.equal(isNoopDeductionHistory({ ChangeSummary: 'UPDATE: 변경 없음' }), true);
assert.equal(isNoopDeductionHistory({ ChangeSummary: 'MATCH: 품목 매칭 변경' }), false);
assert.equal(managerFilterForUser('nenovaSD3', { userId: 'nenovaSD3', userName: '조현욱' }), '조현욱');
assert.equal(managerFilterForUser('조현욱', { userId: 'nenovaSD3', userName: '조현욱' }), '조현욱');
assert.equal(managerFilterForUser('', { userId: 'nenovaSD3', userName: '조현욱' }), '');
assert.deepEqual(
  partitionRegistrationPreflight([
    { deductionKey: 1, error: '' },
    { deductionKey: 2, error: '출고 없음' },
  ]),
  { valid: [{ deductionKey: 1, error: '' }], invalid: [{ deductionKey: 2, error: '출고 없음' }] },
);
const deductionSource = fs.readFileSync('lib/salesDefectDeductions.js', 'utf8');
const estimateTargetScopeSource = fs.readFileSync('lib/defectEstimateTargetScope.js', 'utf8');
const defectApiSource = fs.readFileSync('pages/api/sales/defect-deductions.js', 'utf8');
const pageSource = fs.readFileSync('pages/sales/defect-deductions.js', 'utf8');
const supportReviewSource = fs.readFileSync('pages/sales/defect-deduction-register-review.js', 'utf8');
const deductionContract = JSON.parse(fs.readFileSync('docs/contracts/sales-defect-deduction.json', 'utf8'));
assert.ok(deductionContract.actions.some((item) => item.name === 'MANUAL_PROCESSING_COMPLETE'), '수동처리완료 계약 동작이 있어야 한다.');
assert.match(deductionContract.sideEffects.salesSupportRegistration, /수동처리완료/);
const estimatePageSource = fs.readFileSync('pages/estimate.js', 'utf8');
const productSearchApiSource = fs.readFileSync('pages/api/products/search.js', 'utf8');
const orderImportSource = fs.readFileSync('lib/orderImportMatch.js', 'utf8');
const orderImportPageSource = fs.readFileSync('pages/orders/import.js', 'utf8');
const distributeImportSource = fs.readFileSync('pages/shipment/distribute-import.js', 'utf8');
const masterProductsApiSource = fs.readFileSync('pages/api/master/index.js', 'utf8');
const orderNewSource = fs.readFileSync('pages/orders/new.js', 'utf8');
const orderPasteSource = fs.readFileSync('pages/orders/paste.js', 'utf8');
const weekPivotSource = fs.readFileSync('pages/shipment/week-pivot.js', 'utf8');
const stockStatusSource = fs.readFileSync('pages/shipment/stock-status.js', 'utf8');
const distributeSource = fs.readFileSync('pages/shipment/distribute.js', 'utf8');
const mappingStatusSource = fs.readFileSync('components/orders/MappingStatusModal.js', 'utf8');
const estimateApiSource = fs.readFileSync('pages/api/estimate/index.js', 'utf8');
const estimateEditApiSource = fs.readFileSync('pages/api/estimate/update-entry.js', 'utf8');
const listDeductionsSource = deductionSource.slice(
  deductionSource.indexOf('export async function listDeductions'),
  deductionSource.indexOf('export async function markCarryoverDeductions'),
);
assert.match(listDeductionsSource, /d\.CreatedBy=@manager OR d\.CreatedByName=@manager/, '담당자 목록은 최초 작성 소유자를 우선해 필터해야 합니다.');
assert.match(listDeductionsSource, /NULLIF\(LTRIM\(RTRIM\(d\.CreatedBy\)\),N''\) IS NULL[\s\S]*d\.UpdatedBy=@manager/, '작성자 정보가 모두 없는 레거시 행만 최종 수정자를 담당자로 보완해야 합니다.');
assert.doesNotMatch(listDeductionsSource, /d\.CreatedByName=@manager\s+OR d\.UpdatedBy=@manager/, '다른 담당자 원장을 수정했다는 이유만으로 본인 목록에 포함하면 안 됩니다.');
assert.ok(pageSource.includes('authResolved') && pageSource.includes("activeTab === 'sales' && authResolved"), '로그인 담당자가 확정되기 전에 전체 영업 목록을 조회하면 안 됩니다.');
assert.ok(pageSource.includes('salesLoadRequestSeq') && pageSource.includes('requestSeq !== salesLoadRequestSeq.current'), '늦게 도착한 전체 조회가 최신 본인 담당자 결과를 덮어쓰면 안 됩니다.');
assert.doesNotMatch(listDeductionsSource, /ensureSalesDefectTables\(/, '영업수입불량차감 GET 목록 조회가 DDL ensure를 실행하면 안 됩니다.');
assert.match(deductionSource, /confirmIncomingDeductions[\s\S]*IsCarryoverLedger=1[\s\S]*RemainingQuantity=COALESCE\(RemainingQuantity,Quantity\)/, '수입부 컨펌 시 별도 조작 없이 자동 미처리·부분처리 원장으로 전환해야 합니다.');
assert.doesNotMatch(defectApiSource, /action === 'carryover-register'/, '별도 수동 이월업체 등록 API를 노출하면 안 됩니다.');
assert.match(deductionSource, /RemainingQuantity[\s\S]*WebSalesCarryoverApplication/, '이월 부분처리는 잔여수량과 적용이력을 모두 보존해야 합니다.');
assert.equal(pageSource.includes('특정 원차수 이월업체 직접등록'), false, '별도 수동 이월업체 직접등록 폼을 업무 흐름에 두면 안 됩니다.');
assert.equal(pageSource.includes("sourceFileName: '이월업체 직접등록'"), false, '이월은 별도 원장 생성이 아니라 기존 영업입력 원장을 다음 차수에 재시도해야 합니다.');
assert.match(deductionContract.sideEffects.operationalWorkflow, /영업입력 저장.*수입부.*확정.*견적 일괄등록/, '계약은 영업입력→수입부 수정·확정→견적 일괄등록 순서를 고정해야 합니다.');
assert.match(deductionContract.sideEffects.carryover, /판매행이 없는 행은 자동 미처리[\s\S]*다음 차수.*재시도/, '판매행 없는 행은 별도 수동 등록 없이 다음 차수에 재시도해야 합니다.');
assert.match(deductionContract.sideEffects.carryover, /부분 처리[\s\S]*잔량이 0이 될 때까지/, '부분 처리 잔량은 완료될 때까지 같은 원장에 남아야 합니다.');
assert.ok(pageSource.includes("action: 'incoming-confirm'"), '견적 일괄등록 전 수입부 수정·확정 단계가 있어야 합니다.');
assert.ok(pageSource.includes('registerSupport'), '수입부 확인 뒤 선택 행 견적 일괄등록 단계가 있어야 합니다.');
assert.ok(pageSource.includes('isCarryoverRetrySelectable') && pageSource.includes('row.registrationEligible === true'), '미처리 재시도는 같은 업체의 차수 확정 출고와 품목별 단가가 있는 행만 선택해야 한다.');
assert.ok(deductionSource.includes('registrationEligibilityCode') && deductionSource.includes('targetShipmentKey'), '목록은 사전검증과 같은 업체 단위 등록 판정 결과를 응답해야 한다.');
assert.ok(pageSource.includes('원차수 출고 확인') && pageSource.includes("setActiveTab('sales')"), '업체 출고가 없는 행은 원차수 출고 확인으로 이동할 수 있어야 한다.');
assert.equal(pageSource.includes('원차수 품목 수정'), false, '품목 매칭값만 바뀐 행을 원차수 수정으로 되돌리도록 유도하면 안 된다.');
assert.ok(pageSource.includes('supportSelectableKeys') && pageSource.includes('supportAllSelected'), '전체 선택 표시와 동작은 실제 등록 가능 행을 동일한 기준으로 사용해야 합니다.');
assert.match(pageSource, /disabled=\{activeTab === 'support' \|\| activeTab === 'carryover'/, '미처리 목록은 영업입력 양식으로 인쇄하면 안 됩니다.');
assert.match(pageSource, /disabled=\{loading \|\| activeTab === 'carryover'\}/, '미처리 목록을 다른 조회 계약의 엑셀로 내보내면 안 됩니다.');
assert.ok(supportReviewSource.includes('editQuantity') && supportReviewSource.includes('editNote'), '실제 등록 전에 처리수량과 적요를 수정할 수 있어야 합니다.');
const registerDeductionsSource = deductionSource.slice(
  deductionSource.indexOf('export async function registerDeductions'),
  deductionSource.indexOf('export async function deleteDeductions'),
);
assert.match(registerDeductionsSource, /skipped\.push\(\{ deductionKey: key, error: error\.message \}\)/, '판매행 없는 행은 전체 작업을 실패시키지 않고 행별 자동 미처리해야 합니다.');
assert.match(registerDeductionsSource, /if \(!ctx\.shipmentKey\) throw new Error\([\s\S]*이월 대기/, '대상 차수 판매행이 없으면 Estimate 생성 전에 미처리해야 합니다.');
assert.match(registerDeductionsSource, /RemainingQuantity=CASE WHEN IsCarryoverLedger=1[\s\S]*RemainingQuantity,Quantity\)-@applyQty/, '부분 처리 시 실제 처리수량만 잔량에서 차감해야 합니다.');
assert.doesNotMatch(registerDeductionsSource, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+)?(?:OrderDetail|ShipmentDetail|ShipmentDate|ShipmentMaster|StockHistory|ProductStock)\b/i, '견적 일괄등록은 Order/Shipment/Stock 원장을 변경하면 안 됩니다.');
const defectMigrationSource = fs.readFileSync('docs/migrations/2026-07-22_web_sales_defect_deduction.sql', 'utf8');
assert.match(defectMigrationSource, /CREATE TABLE dbo\.WebSalesDefectDeduction/, '웹 차감 원장은 migration에서 생성해야 합니다.');
assert.ok(pageSource.includes('useState(false)'), '수정 이력은 기본적으로 닫혀 있어야 한다.');
assert.ok(pageSource.includes('defect-inline-lookup'), '검색 결과는 입력 행 위의 인라인 패널로 표시되어야 한다.');
assert.ok(pageSource.includes('shiftParentWeek'), '차수 앞뒤 이동은 공통 경계 규칙을 사용해야 한다.');
assert.ok(pageSource.includes('handleQuantityKeyDown'), '차감수량 키보드 입력은 빈 행 추가 흐름을 사용해야 한다.');
assert.ok(pageSource.includes('handleUnitGroupKeyDown'), '수량 다음에는 단/박스/스팀 키보드 선택 그룹으로 이동해야 한다.');
assert.ok(pageSource.includes('data-defect-action={`unit-group-${index}`}'), '단위 선택 그룹은 행별 포커스 대상이어야 한다.');
assert.ok(pageSource.includes('data-defect-action="empty-row-add"'), '차감수량 다음 Tab 대상인 빈 행 추가 버튼이 있어야 한다.');
assert.ok(pageSource.includes('handleAddModeKeyDown'), '빈 행 추가 후 세 가지 입력 방식을 방향키·Enter 키보드로 선택해야 한다.');
assert.ok(pageSource.includes('add-mode-${index}-new-customer'), '빈 행 추가 방식에 신규업체 추가가 포함되어야 한다.');
assert.ok(pageSource.includes('handleRelatedAddKeyDown'), '동일업체 추가 선택은 방향키·Enter 키보드를 지원해야 한다.');
assert.ok(pageSource.includes('const closeLookup'), '다음 입력칸으로 이동할 때 검색 결과를 닫는 공통 함수가 있어야 한다.');
assert.ok(pageSource.includes('수입부 확인'), '수입부 전체 확인 탭이 있어야 한다.');
assert.ok(pageSource.includes("view: 'incoming'"), '수입부 탭은 담당자 필터 없이 차수 전체를 조회해야 한다.');
assert.ok(pageSource.includes("action: 'incoming-confirm'"), '수입부 확정은 전용 저장 액션을 사용해야 한다.');
assert.ok(pageSource.includes("action: 'incoming-confirm-cancel'"), '수입부 확정 취소는 전용 저장 액션을 사용해야 한다.');
assert.ok(pageSource.includes('확정 취소'), '수입부 확정 완료 행에는 확정 취소 버튼이 있어야 한다.');
assert.ok(pageSource.includes('영업지원 전산등록'), '영업지원 전산등록 탭이 있어야 한다.');
assert.ok(pageSource.includes('견적서관리에 불량차감 등록'), '영업지원은 선택 행을 견적서관리에 등록할 수 있어야 한다.');
assert.ok(pageSource.includes("buildEstimateFixStatusUrl(selectedWeek)"), '영업지원은 붙여넣기 주문등록과 같은 견적서관리 확정현황 링크를 사용해야 한다.');
assert.ok(pageSource.includes("window.open(url, 'estimate-fix-status'"), '영업지원 확정현황은 동일한 견적서관리 새창으로 열려야 한다.');
assert.ok(pageSource.includes('🔎 확정 현황 확인'), '영업지원 도구모음에 확정 현황 확인 버튼이 있어야 한다.');
assert.ok(pageSource.includes('buildEstimateCustomerUrl'), '영업지원 처리상태는 해당 차수·업체 견적서 딥링크를 사용해야 한다.');
assert.ok(pageSource.includes('openCustomerEstimate'), '영업지원 처리상태에서 해당 업체 견적서를 바로 열 수 있어야 한다.');
assert.ok(pageSource.includes('견적서 열기'), '영업지원 처리상태에 거래처 견적서 열기 버튼이 있어야 한다.');
assert.ok(pageSource.includes("window.open(url, 'estimate-customer'"), '업체 견적서는 견적서관리 새창으로 열려야 한다.');
assert.ok(pageSource.includes('<th>분배단가</th>'), '영업지원 목록은 분배단가 열을 표시해야 한다.');
assert.ok(pageSource.includes('row.distributionCost'), '영업지원 목록은 EXE 호환 분배단가 조회 결과를 표시해야 한다.');
assert.ok(pageSource.includes('.support-grid th, .support-grid td { padding: 4px 6px;'), '영업지원 목록은 텍스트 간격을 줄인 compact 행 간격을 사용해야 한다.');
assert.ok(pageSource.includes('toggleAllSupport'), '영업지원 전체 선택/해제를 지원해야 한다.');
assert.ok(pageSource.includes('support-usage-notice'), '영업지원 화면에 사용 방법 공지가 있어야 한다.');
assert.ok(pageSource.includes('SUPPORT_REGISTER_USAGE_STEPS'), '영업지원 공지는 공통 사용 방법 단계를 표시해야 한다.');
assert.ok(supportReviewSource.includes('supportRegisterUsageNotice'), '검토창에도 같은 사용 방법 공지가 있어야 한다.');
assert.equal(supportRegisterUsageNotice(), '사용 방법: 확정확인 → 전체선택 → 견적서관리에 불량차감 등록 → 기존 견적서 조회 완료가 뜨면 → 전산등록 실행 및 검증');
assert.ok(pageSource.includes('isSupportRegistrationSelectable'), '영업지원 선택은 등록 가능 상태를 공통 판정해야 한다.');
assert.ok(pageSource.includes('isSupportManualCompleteSelectable'), '수기 처리 행은 등록 가능 여부와 무관하게 체크할 수 있어야 한다.');
assert.ok(pageSource.includes('markSupportManualComplete'), '영업지원에 수동처리완료 동작이 있어야 한다.');
assert.ok(pageSource.includes('수동처리완료'), '영업지원 도구모음에 수동처리완료 버튼이 있어야 한다.');
assert.ok(pageSource.includes("action: 'manual-complete'"), '수동처리완료는 전용 저장 액션을 사용해야 한다.');
assert.ok(pageSource.includes('isSupportManualCompleteSelectable(row)'), '이미 연결되거나 기존 견적·수동처리완료된 행은 중복 선택할 수 없어야 한다.');
assert.ok(pageSource.includes('existingEstimateRecords'), '업체의 기존 음수 Estimate 내역을 목록에서 확인할 수 있어야 한다.');
assert.ok(pageSource.includes('supportRegistrationDecisionLabel(row)'), '정확히 일치하는 기존 차감은 처리완료 상태와 견적키로 표시해야 한다.');
assert.ok(pageSource.includes('supportStatusDetail(row, year, week)'), '처리상태는 이월 원차수를 숨기지 않고 보여야 한다.');
assert.equal(pageSource.includes('수정 필요'), false, '처리상태는 수정 필요 대신 등록 가능/불가만 보여야 한다.');
assert.ok(pageSource.includes('이 업체 기존 차감'), '동일 업체의 다른 기존 차감도 펼쳐 확인할 수 있어야 한다.');
assert.ok(pageSource.includes('&support=1'), '영업지원 등록은 처리로그 검토창 모드로 열려야 한다.');
assert.ok(pageSource.includes('meaningfulHistory'), '변경없는 수정 이력은 화면에 표시하지 않아야 한다.');
assert.ok(pageSource.includes('confirmIncomingRow'), '수입부 행별 확정 버튼이 있어야 한다.');
assert.ok(pageSource.includes('보완 필요'), '수입부 보완 필요 체크가 있어야 한다.');
assert.ok(pageSource.includes('incoming-note-input'), '수입부 행별 비고 입력이 있어야 한다.');
assert.ok(pageSource.includes('reviewRequiredCount'), '영업담당자 화면에 수입부 보완 필요 건수를 표시해야 한다.');
assert.ok(pageSource.includes('resolveReview'), '영업담당자 화면에 보완 해결 완료 동작이 있어야 한다.');
assert.ok(pageSource.includes('해결 완료'), '보완 필요 행에 해결 완료 버튼이 있어야 한다.');
assert.ok(pageSource.includes('setSupportRows((current) => current.map'), '영업지원에서 보완 해결 완료 후 해당 목록 행 상태를 즉시 갱신해야 한다.');
{
  const selectableSource = pageSource.slice(
    pageSource.indexOf('const isSupportRegistrationSelectable'),
    pageSource.indexOf('const existingEstimateLabel'),
  );
  assert.doesNotMatch(selectableSource, /importReviewRequired/, '보완 필요는 표시일 뿐 영업지원 견적 등록 선택을 막으면 안 된다.');
}
assert.ok(pageSource.includes('support-review-required'), '영업지원 목록은 수입부 확정과 별개로 보완 필요 상태를 표시해야 한다.');
assert.ok(pageSource.includes('sales-row-review-alert'), '보완 필요 행은 담당자 화면에 빨간 알림으로 표시해야 한다.');
assert.ok(pageSource.includes("const [salesViewMode, setSalesViewMode] = useState('edit')"), '영업 입력은 편집/완료 목록 보기 전환을 제공해야 한다.');
assert.ok(pageSource.includes('sales-summary-card'), '영업 입력 완료 목록은 수입부 확인처럼 간단한 다중 행 목록으로 보여야 한다.');
assert.ok(pageSource.includes('salesRowSaveState'), '초기화됨·미저장·저장 완료 상태를 행별로 구분해야 한다.');
assert.ok(pageSource.includes("if (activeTab === 'sales' && authResolved) load();"), '로그인 담당자 확정 후 수입부에서 영업 입력으로 돌아오면 최신 저장 상태를 다시 조회해야 한다.');
assert.ok(pageSource.includes('onFocusCapture={handleGridFocusCapture}'), '다른 입력칸으로 포커스가 이동하면 이전 검색 패널을 닫아야 한다.');
assert.match(pageSource, /if \(\w+\.key === 'Tab'\) \{\s+closeLookup\(\);/, '검색 입력에서 Tab으로 빠져나갈 때 검색 패널을 닫아야 한다.');
assert.ok(pageSource.includes('position: fixed'), '검색 결과는 표의 가로 스크롤에 갇히지 않는 고정 팝업이어야 한다.');
assert.ok(pageSource.includes(':global(.defect-inline-lookup)'), 'body 포털로 이동한 검색 팝업에도 위치·스크롤 스타일이 적용되어야 한다.');
assert.ok(pageSource.includes('createPortal(panel, document.body'), '검색 팝업은 표의 stacking context에 가려지지 않도록 body 포털로 표시해야 한다.');
assert.ok(pageSource.includes('lookupPanelRef.current?.getBoundingClientRect().height'), '검색 결과는 실제 팝업 높이를 측정해 화면 안에 배치해야 한다.');
assert.ok(pageSource.includes('const showAbove = availableAbove >= panelHeight || availableBelow < panelHeight;'), '검색 결과는 현재 행 아래 공간이 남아도 위쪽 배치를 우선해야 한다.');
assert.ok(pageSource.includes('rect.top - panelHeight - 8'), '검색 결과는 입력창 위쪽에 실제 높이만큼 띄워 배치해야 한다.');
assert.ok(pageSource.includes('focusUnitGroup(index)'), '수량 Enter/Tab은 단위 선택 그룹을 먼저 포커스해야 한다.');
assert.ok(pageSource.includes('related-row-action:focus'), '동일업체 추가 선택 버튼은 키보드 포커스 하이라이트가 있어야 한다.');
assert.ok(pageSource.includes('display: flex; align-items: flex-start;'), '품목 검색 결과는 국가·품종·품명을 일정한 열로 정렬해야 한다.');
assert.equal(pageSource.includes('defect-lookup-usage'), false, '품목 검색 결과에는 사용 횟수·매칭 건수를 표시하지 않아야 한다.');
assert.ok(pageSource.includes('overflow-x: hidden'), '품목 검색 결과는 가로 드래그 없이 세로 스크롤만 사용해야 한다.');
assert.ok(pageSource.includes('defect-product-match'), '전산 매칭 전체 품명 표시 영역이 있어야 한다.');
assert.ok(pageSource.includes('white-space: normal; overflow: visible; text-overflow: clip;'), '전산 매칭 품명은 말줄임 없이 전체가 보여야 한다.');
assert.ok(pageSource.includes('partitionRegistrationPreflight'), '견적서 등록은 유효행과 오류행을 분리해 처리해야 한다.');
assert.ok(deductionSource.includes('sm.OrderYear < @scopeYear'), '이전 차수 단가가 없으면 과거 연도까지 최신 유효 단가를 찾아야 한다.');
assert.ok(deductionSource.includes('COALESCE(NULLIF(sdd.Cost,0), NULLIF(sd.Cost,0), 0) > 0'), '0원 단가는 대체 단가 후보에서 제외해야 한다.');
assert.ok(deductionSource.includes('enrichSupportDistributionCosts'), '영업지원 전체 조회도 견적 등록과 같은 분배단가 컨텍스트를 사용해야 한다.');
assert.ok(deductionSource.includes('loadExistingEstimateDeductions'), '영업지원 조회는 업체의 기존 음수 Estimate를 자동으로 불러와야 한다.');
assert.ok(deductionSource.includes('sm.OrderYear=@year'), '기존 차감 조회는 선택 연도를 반드시 제한해야 한다.');
assert.ok(deductionSource.includes('e.Quantity<0'), '기존 차감 조회는 음수 Estimate만 대상으로 해야 한다.');
assert.ok(deductionSource.includes('assertNoExactUnlinkedEstimate'), '동일 미연결 견적은 사전검증과 등록 직전에 중복 차단해야 한다.');
assert.ok(deductionSource.includes("WITH (UPDLOCK,HOLDLOCK)"), '등록 직전 기존 견적 재검사는 트랜잭션 잠금을 사용해야 한다.');
assert.ok(deductionSource.includes('confirmIncomingDeductions'), '수입부 확인 전용 저장 경로가 있어야 한다.');
assert.ok(deductionSource.includes('ImportConfirmedAt=GETDATE()'), '수입부 확정 시 감사 시각을 저장해야 한다.');
assert.ok(deductionSource.includes('ImportReviewRequired=@reviewRequired'), '수입부 보완 필요 체크를 저장해야 한다.');
assert.ok(deductionSource.includes('Note=@note'), '수입부 비고를 확정 시 저장해야 한다.');
assert.ok(deductionSource.includes('hasReviewDetails'), '보완 필요/비고는 농장 미정이어도 우선 저장할 수 있어야 한다.');
assert.ok(deductionSource.includes('기존 농장값을 유지하고 확정 이력을 남긴다.'), '보완 우선 확정 시 기존 농장값을 보존해야 한다.');
assert.ok(deductionSource.includes('resolveIncomingReview'), '수입부 보완 필요 해제 전용 저장 경로가 있어야 한다.');
assert.ok(deductionSource.includes('cancelIncomingDeductions'), '수입부 확정 취소 전용 저장 경로가 있어야 한다.');
assert.ok(defectApiSource.includes("importConfirmedOnly: String(req.query.view || '') === 'support'"), '영업지원 목록은 수입부 확정 완료 건만 조회해야 한다.');
assert.ok(pageSource.includes('setSupportRows((current) => current.filter'), '수입부 확정 취소 즉시 영업지원 등록 대상에서도 제거해야 한다.');
assert.ok(deductionSource.includes("action: 'INCOMING_CONFIRM_CANCEL'"), '수입부 확정 취소 이력을 기록해야 한다.');
assert.ok(deductionSource.includes("ImportConfirmedBy=N''"), '수입부 확정 취소 시 NOT NULL 확정자 필드는 빈 문자열로 해제해야 한다.');
assert.ok(deductionSource.includes("ImportConfirmedByName=N''"), '수입부 확정 취소 시 NOT NULL 확정자명 필드는 빈 문자열로 해제해야 한다.');
assert.ok(deductionSource.includes('OUTPUT INSERTED.EstimateKey INTO @EstimateInserted(EstimateKey)'), 'Estimate 트리거가 활성화된 SQL Server에서도 신규 견적키를 회수해야 한다.');
assert.ok(estimateTargetScopeSource.includes('FROM ShipmentMaster sm'), '견적 차감 대상은 실제 ShipmentMaster 확정 원장을 기준으로 해야 한다.');
assert.ok(estimateTargetScopeSource.includes('JOIN ShipmentDetail sd'), '견적 차감 대상은 활성 출고 상세가 있는 업체 출고만 사용해야 한다.');
assert.match(estimateTargetScopeSource, /Number\(row\?\.ShipmentKey \|\| 0\) > 0/, '공통 판정은 해당 차수의 업체 ShipmentKey 존재를 기준으로 삼아야 한다.');
assert.equal(estimateTargetScopeSource.includes('FROM ViewShipment'), false, 'ViewShipment.DetailFix 불일치로 확정 출고를 제외하면 안 된다.');
assert.ok(deductionSource.includes('buildDefectEstimateTargetCandidatesSql'), '목록·사전검증·등록은 공통 EXE 견적 대상 scope를 사용해야 한다.');
assert.ok(deductionSource.includes('selectExeEstimateTargetCandidate'), '공통 EXE 견적 대상 판정으로 실제 ShipmentKey를 선택해야 한다.');
assert.ok(!deductionSource.includes('AND ISNULL(sdd.EstQuantity,0)>0'), 'GetDetail에 없는 ShipmentDate.EstQuantity 양수 필터를 추가하면 안 된다.');
assert.ok(deductionSource.includes('AppliedOrderYear'), '원차수와 적용차수를 분리 저장해야 한다.');
assert.ok(deductionSource.includes('이월 대기'), '현재 판매행이 없으면 이월 대기로 남겨야 한다.');
assert.equal(/INSERT INTO Estimate[\s\S]{0,500}OUTPUT INSERTED\.EstimateKey\s+VALUES/.test(deductionSource), false, '트리거가 있는 Estimate에 직접 반환 OUTPUT을 사용하면 안 된다.');
assert.ok(deductionSource.includes('const estimateDescr = text(dbRow.Note, 1000);'), '견적 적요 기본값은 자동 문구가 아닌 입력된 메모만 사용해야 한다.');
assert.ok(deductionSource.includes('loadProductPreview'), '견적서 등록 미리보기는 실제 Product DB 품명을 사용해야 한다.');
assert.ok(supportReviewSource.includes('originalRowByKey'), '신규 Estimate INSERT 후 발급된 견적키와 이월 잔여수량을 재조회 검증해야 한다.');
assert.ok(supportReviewSource.includes('<b>분배단가</b>'), '영업지원 전산등록 검토창은 분배단가를 표시해야 한다.');
assert.ok(supportReviewSource.includes('.compare-pane { padding: 5px 8px;'), '영업지원 전산등록 검토창은 텍스트 간격을 줄여야 한다.');
assert.ok(deductionSource.includes('if (/변경\\s*없음$/.test(summary)) return false;'), '변경없는 저장은 이력을 만들지 않아야 한다.');
assert.ok(deductionSource.includes('ImportReviewRequired=0'), '해결 완료 시 보완 필요 상태를 해제해야 한다.');
{
  const ledgerUpdateSql = deductionSource.slice(
    deductionSource.indexOf('SET DeductionType=@type, EstimateKey=@ek'),
    deductionSource.indexOf('const current = await getStoredRow(tQuery, key);'),
  );
  assert.doesNotMatch(ledgerUpdateSql, /ImportReviewRequired=0/, '보완필요는 견적 등록 원장 UPDATE를 막으면 안 된다.');
  assert.match(ledgerUpdateSql, /ImportConfirmed=1/, '수입부 미확정 행은 등록 UPDATE 대상이 아니다.');
}
assert.ok(deductionSource.includes('explainDefectLedgerRegisterMiss'), '등록 원장 갱신 실패는 확정·잔여 상태를 다시 읽어 안내해야 한다.');
assert.equal(deductionSource.includes('다른 사용자에 의해 변경되었습니다'), false, '보완필요 행을 다른 사용자 변경으로 오인하면 안 된다.');
assert.ok(deductionSource.includes("action: 'INCOMING_REVIEW_RESOLVE'"), '보완 해결 완료 이력을 기록해야 한다.');
assert.ok(deductionSource.includes("Status=N'MANUAL_COMPLETED'"), '수동처리완료는 웹 원장 상태만 바꿔야 한다.');
assert.ok(deductionSource.includes("action: 'MANUAL_COMPLETE'"), '수동처리완료는 별도 History ActionType을 남겨야 한다.');
assert.ok(deductionSource.includes('planManualProcessingComplete'), '수동처리완료는 순수 정책 함수로 부작용을 먼저 판정해야 한다.');
assert.doesNotMatch(
  deductionSource.slice(deductionSource.indexOf('export async function markManualProcessingComplete'), deductionSource.indexOf('async function getStoredRow')),
  /INSERT INTO Estimate|UPDATE Estimate/,
  '수동처리완료는 Estimate를 만들거나 고치면 안 된다.',
);
assert.ok(defectApiSource.includes("action === 'manual-complete'"), '수동처리완료 API action이 있어야 한다.');
assert.ok(deductionSource.includes('ImportReviewRequired=CASE WHEN ImportReviewRequired=1 THEN 1 ELSE @reviewRequired END'), '일반 영업 저장은 해결 완료 전 보완 필요 상태를 해제하면 안 된다.');
assert.ok(deductionSource.includes('Boolean(dbRow.ImportReviewRequired) || input.importReviewRequired === true'), '수입부 확정은 해결 완료 전까지 보완 필요 상태를 해제하면 안 된다.');
assert.ok(deductionSource.includes('const inputNote = input.note == null ? text(dbRow.Note, 1000) : text(input.note, 1000);'), '수입부 확정은 빈 비고로 기존 비고를 덮으면 안 된다.');
assert.ok(deductionSource.includes('ImportConfirmed=CASE WHEN @importReset=1 THEN 0'), '영업부가 수입부 확정 후 농장/크레딧/비고를 바꾸면 재확인이 필요해야 한다.');
assert.ok(supportReviewSource.includes('verifyAppliedRow'), '견적서 등록은 적용 후 Estimate 재조회 검증을 수행해야 한다.');
assert.ok(supportReviewSource.includes('처리 로그'), '영업지원 전산등록 검토창은 처리 로그를 표시해야 한다.');
assert.ok(supportReviewSource.includes('openEstimateManagement'), '전산등록 결과에서 견적서관리 새창을 열 수 있어야 한다.');
assert.ok(estimatePageSource.includes('＋ 불량차감등록'), '견적서관리에는 불량차감등록 전용 버튼이 있어야 한다.');
assert.ok(estimatePageSource.includes('＋ 불량/검역등록'), '견적서관리의 기존 불량/검역등록 버튼을 유지해야 한다.');
assert.ok(estimatePageSource.includes("openEstimateEntry('legacy')"), '기존 불량/검역등록은 독립된 legacy 상태로 열려야 한다.');
assert.ok(estimatePageSource.includes('options={estimateTypeOptions}'), '기존 불량/검역등록은 EstimateType 선택을 유지해야 한다.');
assert.ok(estimatePageSource.includes('＋ 판매요청'), '견적서관리에는 판매요청 전용 버튼이 있어야 한다.');
assert.ok(estimatePageSource.includes('＋ 추가 품목등록'), '견적서관리에는 추가 품목등록 버튼도 함께 있어야 한다.');
assert.ok(estimatePageSource.includes('openItemEditor'), '견적 품목명을 선택하면 정보 편집창을 열어야 한다.');
assert.ok(estimatePageSource.includes('/api/estimate/update-entry'), '견적 품목 정보창은 기존 Estimate 수정 API를 사용해야 한다.');
assert.ok(estimatePageSource.includes('품목 정보 수정'), '기존 비활성 수정 버튼 대신 품목 정보 수정 동작을 제공해야 한다.');
assert.ok(estimatePageSource.includes('rankProductSearchOptions'), '견적서관리 품목 선택은 사용량 기반 공용 후보 정렬을 사용해야 한다.');
assert.ok(productSearchApiSource.includes('UsageCount'), '품목 검색 API는 실제 주문 품목 사용량을 함께 반환해야 한다.');
assert.ok(productSearchApiSource.includes('rankProductSearchOptions'), '공용 품목 검색 API도 사용량 기반 후보 정렬을 사용해야 한다.');
assert.ok(productSearchApiSource.includes('rankAllProductRows'), '품목 검색 API의 그룹/전체 조회도 공용 랭킹을 사용해야 한다.');
assert.ok(orderImportSource.includes('scoreProductSearchOptions'), '주문등록 매칭 후보도 공용 품목 랭킹 엔진을 사용해야 한다.');
assert.ok(distributeImportSource.includes('Number(b.UsageCount || b.orderCount || 0)'), '엑셀 분배 품목 검색은 업무 맥락 이후 사용량 우선순위를 보존해야 한다.');
assert.ok(masterProductsApiSource.includes('RecentUsageCount') && masterProductsApiSource.includes('MappingCount'), '공통 기준 품목 API는 실제 사용량·저장 매칭 빈도를 함께 반환해야 한다.');
assert.ok(orderNewSource.includes('rankProductSearchOptions'), '주문등록 화면의 로컬 품목 필터도 공용 랭킹을 사용해야 한다.');
assert.ok(orderPasteSource.includes('rankProductSearchOptions'), '붙여넣기 주문등록의 수동 품목검색도 공용 랭킹을 사용해야 한다.');
assert.ok(orderImportPageSource.includes('scoreProductSearchOptions'), '엑셀 업로드 주문등록의 수동 품목검색도 공용 랭킹을 사용해야 한다.');
assert.ok(!orderImportPageSource.includes('nenova_import_local_mappings'), '엑셀 업로드 주문등록은 메뉴·브라우저 전용 품목 매핑을 저장하지 않아야 한다.');
assert.ok(orderImportPageSource.includes("'/api/orders/mappings'"), '엑셀 업로드 주문등록의 사용자 선택은 붙여넣기와 같은 공용 저장매핑 API에 누적해야 한다.');
assert.ok(weekPivotSource.includes('rankProductSearchOptions'), '차수피벗 품목 선택도 공용 랭킹을 사용해야 한다.');
assert.ok(stockStatusSource.includes('rankProductSearchOptions'), '재고·주문등록 모달 품목 선택도 공용 랭킹을 사용해야 한다.');
assert.ok(distributeSource.includes('rankProductSearchOptions'), '출고분배 품목 검색도 공용 랭킹을 사용해야 한다.');
assert.ok(mappingStatusSource.includes('rankProductSearchOptions'), '저장 매칭 재지정 검색도 공용 랭킹을 사용해야 한다.');
assert.ok(estimatePageSource.includes("view: 'defectContext'"), '품목 선택 시 EXE 판매행·분배단가 컨텍스트를 서버에서 다시 조회해야 한다.');
assert.ok(estimatePageSource.includes("['단','박스','스팀(대)']"), '견적 직접입력 단위는 단/박스/스팀(대) 세 가지여야 한다.');
assert.ok(estimatePageSource.includes('defectForm.negative'), '불량차감/판매요청은 - 체크 상태를 명시해야 한다.');
assert.ok(estimateApiSource.includes("view === 'defectContext'"), '견적 API는 품목 선택용 분배단가 컨텍스트를 제공해야 한다.');
assert.ok(estimateApiSource.includes('resolveEstimateContext'), '분배단가 조회는 공통 EXE 호환 컨텍스트를 사용해야 한다.');
assert.ok(estimateApiSource.includes('NO_EXE_SALE_ROW'), 'EXE 판매행 없는 불량차감은 구체적인 등록 불가 사유를 반환해야 한다.');
assert.ok(estimateApiSource.includes('OUTPUT INSERTED.EstimateKey INTO @EstimateInserted(EstimateKey)'), '견적 직접 입력도 Estimate 트리거 호환 INSERT를 사용해야 한다.');
assert.ok(estimateApiSource.includes('isSalesRequest'), '불량차감과 판매요청의 양/음수 저장 모드를 분리해야 한다.');
assert.ok(estimateApiSource.includes('isLegacyEntry'), '기존 불량/검역등록 API 상태를 신규 등록과 분리해야 한다.');
assert.ok(estimateApiSource.includes('normalizeEstimateTypeInput(estimateType, unit).typeText'), '기존 불량/검역등록은 선택 EstimateType을 저장해야 한다.');
assert.ok(estimateApiSource.includes('ESTIMATE_SCOPE_MISMATCH'), '직접 등록은 선택 출고와 요청 연도·차수·거래처 불일치를 차단해야 한다.');
assert.ok(estimateEditApiSource.includes('UPDATE Estimate'), '기존 견적 행 수정은 Estimate UPDATE를 사용해야 한다.');
assert.ok(estimateEditApiSource.includes('expectedQuantity'), '기존 견적 행 수정은 조회시점 수량을 검증해야 한다.');
assert.ok(estimateEditApiSource.includes('SELECT TOP 1 EstimateKey'), '견적 수정 후 저장 결과를 재조회해야 한다.');
assert.equal(/UPDATE Estimate[\s\S]{0,500}OUTPUT/.test(estimateEditApiSource), false, 'Estimate 수정에 트리거 비호환 OUTPUT을 사용하면 안 된다.');
assert.ok(pageSource.includes('registrationHistoryByKey'), '견적서 등록 확정자·시각을 작업 이력에서 다시 표시해야 한다.');
assert.ok(pageSource.includes('estimateStatusText'), '견적서 등록 상태와 견적키를 영업 목록에 표시해야 한다.');
assert.deepEqual(
  deductionManagerIdentity({ CreatedBy: 'jkim', CreatedByName: '김담당' }),
  { id: 'jkim', name: '김담당' },
);
assert.deepEqual(
  deductionManagerIdentity({ CreatedBy: '', CreatedByName: '', UpdatedBy: 'lee', UpdatedByName: '이담당' }),
  { id: 'lee', name: '이담당' },
);

const templatePath = 'data/sales-defect-deduction-template.xlsx';
assert.ok(fs.existsSync(templatePath), '원본 불량 차감 양식이 있어야 한다.');
const source = await parseSalesDefectWorkbook(fs.readFileSync(templatePath));
assert.equal(source.sheetName, '30차');
assert.equal(source.title.year, '2026');
assert.equal(source.title.week, '29');
assert.equal(source.rows[0].customerName, '광주천사');
assert.equal(source.rows[0].quantity, 5);

const buffer = await buildSalesDefectWorkbook([
  {
    customerName: '테스트거래처', productName: '카네이션', colorName: '카오리',
    countryName: '콜롬비아', quantity: 5, sourceUnit: '단', creditApplied: true, farmName: '테스트농장', note: '메모',
  },
], { year: 2026, week: 29, managerName: '테스트담당자' });
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(buffer);
assert.equal(wb.worksheets[0].name, '29차');
assert.equal(String(wb.worksheets[0].getCell('D2').value).includes('( 29 )'), true);
assert.equal(wb.worksheets[0].getCell('B6').value, '테스트거래처');
assert.equal(wb.worksheets[0].getCell('G6').value, '5단');
assert.equal(wb.worksheets[0].getCell('H6').value, '✓');
assert.equal(wb.worksheets[0].getColumn('F').width, 37.5, '엑셀 품명 열은 원본 대비 2.5배 폭이어야 한다.');
assert.equal(wb.worksheets[0].getCell('B6').alignment.horizontal, 'center');
assert.ok(!wb.worksheets[0].getCell('B6').alignment.indent || wb.worksheets[0].getCell('B6').alignment.indent === 0);
assert.equal(wb.worksheets[0].getRow(6).height >= 25, true);

const identityBuffer = await buildSalesDefectWorkbook([{
  customerName: '남대문청화', originalCustomerName: '남대문 청화꽃집', managerName: '임재용',
  productName: '수국', countryName: '콜롬비아', colorName: 'Blue', quantity: 1, sourceUnit: '박스',
}], { year: 2026, week: 33 });
const identityWb = new ExcelJS.Workbook();
await identityWb.xlsx.load(identityBuffer);
assert.equal(identityWb.worksheets[0].getCell('B6').value, '남대문청화 (임재용)');
assert.notEqual(identityWb.worksheets[0].getCell('B7').value, '기존명: 남대문 청화꽃집');
assert.equal(formatSalesDefectExportRows([{
  customerName: '남대문청화', originalCustomerName: '남대문 청화꽃집', managerName: '임재용',
  productName: '수국', countryName: '콜롬비아', colorName: 'Blue', quantity: 1,
}]).some((row) => String(row.customerName || '').startsWith('기존명:')), false, '엑셀 거래처 열에는 기존명을 별도 출력하지 않아야 한다.');

const managerWorkbook = await buildSalesDefectWorkbook([
  { customerName: '업체A', managerName: '김담당', productName: '카네이션', countryName: '콜롬비아', colorName: 'A', quantity: 1, sourceUnit: '단' },
  { customerName: '업체B', managerName: '이담당', productName: '장미', countryName: '중국', colorName: 'B', quantity: 2, sourceUnit: '단' },
  { customerName: '업체C', managerName: '김담당', productName: '수국', countryName: '콜롬비아', colorName: 'C', quantity: 3, sourceUnit: '박스' },
], { year: 2026, week: 33, includeManagerSheets: true });
const managerWb = new ExcelJS.Workbook();
await managerWb.xlsx.load(managerWorkbook);
assert.deepEqual(managerWb.worksheets.map((sheet) => sheet.name), ['전체품목', '김담당', '이담당'], '수입부 다운로드는 전체품목 시트와 담당자명 시트를 생성해야 한다.');
assert.equal(managerWb.getWorksheet('전체품목').getCell('B6').value, '업체A (김담당)');
assert.equal(managerWb.getWorksheet('김담당').getCell('B6').value, '업체A (김담당)');
assert.equal(managerWb.getWorksheet('이담당').getCell('B6').value, '업체B (이담당)');
assert.equal(managerWb.getWorksheet('김담당').getCell('B7').value, null);
assert.equal(managerWb.getWorksheet('김담당').pageSetup.printArea, 'B1:K44');

const manyCustomers = Array.from({ length: 22 }, (_, index) => ({
  customerName: `거래처${index + 1}`, managerName: '임재용', productName: '카네이션',
  countryName: '콜롬비아', colorName: `품목${index + 1}`, quantity: 1, sourceUnit: '단',
}));
const pagedRows = paginateSalesDefectExportRows(formatSalesDefectExportRows(manyCustomers));
assert.equal(pagedRows.length, 2, 'A4 39행을 넘으면 업체 단위로 다음 페이지를 만들어야 한다.');
const pagedBuffer = await buildSalesDefectWorkbook(manyCustomers, { year: 2026, week: 33 });
const pagedWb = new ExcelJS.Workbook();
await pagedWb.xlsx.load(pagedBuffer);
assert.deepEqual(pagedWb.worksheets.map((sheet) => sheet.name), ['33차'], '전체 내용은 하나의 시트에 있어야 한다.');
const pagedSheet = pagedWb.worksheets[0];
assert.equal(pagedSheet.pageSetup.paperSize, 9);
assert.equal(pagedSheet.pageSetup.fitToWidth, 1);
assert.equal(pagedSheet.pageSetup.fitToHeight, 0);
assert.equal(pagedSheet.pageSetup.printArea, 'B1:K88');
const pagedZip = await JSZip.loadAsync(pagedBuffer);
const pagedSheetXml = await pagedZip.file('xl/worksheets/sheet1.xml').async('string');
assert.match(pagedSheetXml, /<rowBreaks[^>]*count="1"[^>]*>.*<brk[^>]*id="44"[^>]*man="1"/s, '인쇄할 때만 44행 뒤에서 다음 A4 페이지로 나뉘어야 한다.');
assert.equal(pagedSheet.getImages().length, 2, '한 시트 안의 각 인쇄 페이지에 원본 로고가 반복되어야 한다.');
assert.equal(pagedSheet.getCell('D46').value?.toString().includes('( 33 )'), true, '두 번째 인쇄 페이지에도 제목이 반복되어야 한다.');
assert.equal(pagedSheet.getCell('D49').value, '품종', '두 번째 인쇄 페이지에도 표 헤더가 반복되어야 한다.');

const formattedExport = formatSalesDefectExportRows([
  { customerName: '그린화원(전산)', customerAlias: '그린화원/화요일', productName: '카네이션', countryName: '콜롬비아', colorName: '문라이트', quantity: 1 },
  { customerName: '그린화원(전산)', customerAlias: '그린화원/화요일', productName: '카네이션', countryName: '콜롬비아', colorName: '노비아', quantity: 2 },
  { customerName: '그린화원(전산)', customerAlias: '그린화원/화요일', productName: '장미', countryName: '콜롬비아', colorName: '화이트', quantity: 3 },
  { customerName: '그린화원(전산)', customerAlias: '그린화원/화요일', productName: '장미', countryName: '중국', colorName: '프라우드', quantity: 1 },
  { customerName: '다른화원', productName: '카네이션', countryName: '네덜란드', colorName: '화이트', quantity: 4 },
]);
assert.equal(customerExportName({ customerName: '그린화원(전산)', customerAlias: '그린화원/화요일' }), '그린화원');
assert.deepEqual(formattedExport.map((row) => row.blank ? 'blank' : [row.customerName, row.productName]), [
  ['그린화원', '콜롬비아 카네이션'],
  ['', ''],
  ['', '콜롬비아 장미'],
  ['', '중국 장미'],
  'blank',
  ['다른화원', '네덜란드 카네이션'],
]);

const kaoriScore = scoreMatch('카네이션 카오리', {
  ProdKey: 417,
  ProdName: 'CARNATION Kaori',
  DisplayName: '카오리',
  FlowerName: '카네이션',
  CounName: '콜롬비아',
});
assert.ok(kaoriScore >= 60, `CARNATION Kaori matching score should be registerable: ${kaoriScore}`);

const popularityProducts = [
  { ProdKey: 501, ProdName: 'CARNATION Moon Light', DisplayName: 'Moon Light', FlowerName: '카네이션', CounName: '콜롬비아' },
  { ProdKey: 502, ProdName: 'ROSE Moon Light', DisplayName: 'Moon Light', FlowerName: '장미', CounName: '에콰도르' },
];
const popularMoonLight = buildProductSuggestions('MOON LIGHT', popularityProducts, {
  usageByProdKey: new Map([[501, { usageCount: 100 }], [502, { usageCount: 1 }]]),
  limit: 2,
  minScore: 0,
});
assert.equal(popularMoonLight[0].prodKey, 501, '동점 품목은 실제 입력 사용빈도가 높은 후보가 먼저여야 한다.');
const blankRankedProducts = rankProductSearchOptions('', [
  { value: '503', label: 'Rare', ProdName: 'Rare', UsageCount: 1 },
  { value: '504', label: 'Frequent', ProdName: 'Frequent', UsageCount: 500, RecentUsageCount: 20, MappingCount: 3 },
]);
assert.equal(blankRankedProducts[0].value, '504', '검색어가 없어도 전체 품목 목록은 실제 사용량 우선이어야 한다.');
const rankedEstimateProducts = rankProductSearchOptions('MOON LIGHT', [
  { value: '501', label: 'CARNATION Moon Light', sub: '콜롬비아 · 카네이션 · 단', ProdName: 'CARNATION Moon Light', FlowerName: '카네이션', CounName: '콜롬비아', UsageCount: 100 },
  { value: '502', label: 'ROSE Moon Light', sub: '에콰도르 · 장미 · 단', ProdName: 'ROSE Moon Light', FlowerName: '장미', CounName: '에콰도르', UsageCount: 1 },
]);
assert.equal(rankedEstimateProducts[0].value, '501', '견적서 품목 검색도 실제 주문 사용량이 높은 동일 후보를 먼저 보여야 한다.');
const rankedKoreanProducts = rankProductSearchOptions('문라이트', [
  { value: '701', label: 'CARNATION Moon Light', ProdName: 'CARNATION Moon Light', FlowerName: '카네이션', CounName: '콜롬비아', UsageCount: 2298 },
  { value: '702', label: 'ROSE / Candlelight 50cm', ProdName: 'ROSE / Candlelight 50cm', FlowerName: '장미', CounName: '콜롬비아', UsageCount: 9999 },
]);
assert.equal(rankedKoreanProducts[0].value, '701', '한글 별칭 검색은 영문 DB 품목을 사용량 기반으로 찾아야 하며 Candlelight를 섞으면 안 된다.');
assert.equal(rankedKoreanProducts.some((item) => item.value === '702'), false, '문라이트 검색 결과에는 Candlelight 후보가 포함되면 안 된다.');
const countryRankedProducts = [
  { ProdKey: 701, ProdName: 'CARNATION Moon Light', DisplayName: null, FlowerName: '카네이션', CounName: '콜롬비아' },
  { ProdKey: 702, ProdName: 'Carnation CHINA / 문라이트 (Moonlight)', DisplayName: null, FlowerName: '카네이션', CounName: '중국' },
];
const countryRanked = buildProductSuggestions('문라이트', countryRankedProducts, {
  usageByProdKey: new Map([[701, { usageCount: 2298 }], [702, { usageCount: 2 }]]),
  mappingByProdKey: buildProductMappingStats({ '콜롬비아 카네이션 문라이트': { prodKey: 701 } }),
  limit: 2,
  minScore: 20,
});
assert.equal(countryRanked[0].prodKey, 701, '한글 별칭 검색은 실제 빈출 콜롬비아 카네이션을 먼저 보여야 한다.');
const candlelightCandidate = buildProductSuggestions('문라이트', [
  { ProdKey: 801, ProdName: 'CARNATION Moon Light', DisplayName: null, FlowerName: '카네이션', CounName: '콜롬비아' },
  { ProdKey: 802, ProdName: 'ROSE / Candlelight 50cm', DisplayName: null, FlowerName: '장미', CounName: '콜롬비아' },
], { limit: 5, minScore: 20 });
assert.equal(candlelightCandidate[0].prodKey, 801, '문라이트 검색은 Candlelight를 Moon Light 후보보다 앞세우거나 자동 선택하면 안 된다.');
assert.equal(candlelightCandidate.some((item) => item.prodKey === 802), false, '구분 별칭이 없는 Candlelight는 문라이트 후보에서 제외해야 한다.');
const explicitChina = buildProductSuggestions('중국 문라이트', countryRankedProducts, {
  usageByProdKey: new Map([[701, { usageCount: 2298 }], [702, { usageCount: 2 }]]),
  limit: 2,
  minScore: 20,
});
assert.equal(explicitChina[0].prodKey, 702, '중국을 명시하면 콜롬비아 사용량이 중국 후보를 앞지르면 안 된다.');
const popularCustomer = resolveImportCustomer('그린', [
  { CustKey: 601, CustName: '그린화원' },
  { CustKey: 602, CustName: '그린상사' },
], { usageByCustKey: new Map([[601, { usageCount: 100 }], [602, { usageCount: 1 }]]) });
assert.equal(popularCustomer.custKey, 601, '동점 거래처는 실제 입력 사용빈도가 높은 후보가 먼저여야 한다.');

// 불량차감은 과거 엑셀/붙여넣기 학습 매핑으로 품목을 자동 확정하지 않는다.
// 입력값은 원문으로 남고, Product DB에서 사용자가 선택한 ProdKey만 적용한다.
const matchingProducts = [{
  ProdKey: 417,
  ProdName: 'CARNATION Kaori',
  DisplayName: '카오리',
  FlowerName: '카네이션',
  CounName: '콜롬비아',
  OutUnit: '단',
  EstUnit: '단',
}];
const matchingContext = {
  allProducts: matchingProducts,
  productByKey: new Map([[417, matchingProducts[0]]]),
  prodUnitMap: {},
  savedMappings: {},
  unitCatalog: {},
};
const pasteMatch = matchImportRows([{
  rowNo: 1, inputName: '카네이션 카오리', qty: 5, unit: '단',
}], matchingContext)[0];
const defectUnselected = matchSalesDefectRows([{
  sourceRowNo: 1,
  customerName: '광주천사',
  productName: '카네이션',
  colorName: '카오리',
  quantity: 5,
  sourceUnit: '단',
}], {
  ...matchingContext,
  customers: [{ CustKey: 9001, CustName: '광주천사', CustArea: '' }],
  products: matchingProducts,
  farms: [],
});
assert.equal(defectUnselected[0].prodKey, null, '품목은 DB 후보를 사용자가 선택하기 전 자동 매칭하지 않는다.');
assert.equal(defectUnselected[0].matchedProductDbName, '', '미선택 품목은 DB 품명을 표시하지 않는다.');
assert.equal(defectUnselected[0].needsReview, true, '품목 미선택 행은 검토 필요 상태여야 한다.');
assert.equal(defectUnselected[0].custKey, 9001, '거래처는 현재 Customer DB 이름으로만 확인한다.');

const defectSelected = matchSalesDefectRows([{
  sourceRowNo: 1,
  customerName: '광주천사',
  productName: '카네이션',
  colorName: '카오리',
  prodKey: 417,
  quantity: 5,
  sourceUnit: '단',
}], {
  ...matchingContext,
  customers: [{ CustKey: 9001, CustName: '광주천사', CustArea: '' }],
  products: matchingProducts,
  farms: [],
});
assert.equal(defectSelected[0].prodKey, 417, '사용자가 선택한 DB 품목 ProdKey는 보존해야 한다.');
assert.equal(defectSelected[0].unit, pasteMatch.unit, '사용자가 선택한 DB 품목 단위를 적용해야 한다.');
assert.equal(defectSelected[0].matchedProductDbName, 'CARNATION Kaori', '선택 후에만 DB의 정확한 ProdName을 표시해야 한다.');
assert.equal(defectSelected[0].countryName, '콜롬비아', '선택된 Product.CounName을 국가 표시값으로 보존해야 한다.');

const existingCompleted = deriveSupportProcessingStatus({
  status: 'DRAFT', estimateKey: null, exactExistingEstimate: true, exactExistingEstimateKey: 4567,
});
assert.equal(existingCompleted.processingStatus, 'COMPLETED_EXISTING', '정확히 조회된 기존 불량차감은 처리완료 파생 상태여야 한다.');
assert.equal(existingCompleted.processingEstimateKey, 4567, '기존 불량차감 견적키를 처리상태에 표시해야 한다.');
assert.equal(isSupportProcessingComplete(existingCompleted), true, '기존 불량차감 처리완료 행은 중복 등록 대상에서 제외해야 한다.');
assert.equal(supportProcessingLabel(existingCompleted), '처리완료 (기존 불량차감 #4567)', '영업지원 처리상태에 기존 불량차감 완료를 명시해야 한다.');
assert.equal(supportRegistrationDecisionLabel({ registrationEligible: true }), '등록 가능');
assert.equal(supportRegistrationDecisionLabel({ registrationEligible: false }), '등록 불가');
assert.equal(supportCarryoverFromLabel({ orderYear: 2026, orderWeek: '32' }, 2026, 33), '2026년 32차부터 이월');
assert.equal(supportCarryoverFromLabel({ orderYear: 2026, orderWeek: '33-01' }, 2026, 33), '');
assert.equal(supportStatusDetail({
  orderYear: 2026, orderWeek: '32', registrationEligible: false, registrationEligibilityCode: 'CUSTOMER_SALE_MISSING',
  registrationError: '선택 차수에 이 업체의 출고가 없습니다.',
}, 2026, 33), '2026년 32차부터 이월', '출고 없음 문구가 이월 원차수를 가리면 안 된다.');
const crossYearOrMismatch = deriveSupportProcessingStatus({ status: 'DRAFT', exactExistingEstimate: false });
assert.equal(crossYearOrMismatch.processingStatus, 'UNREGISTERED', '다른 연도·수량·단위 불일치 후보는 처리완료로 표시하면 안 된다.');
assert.equal(isSupportManualCompleteSelectable({ deductionKey: 88, status: 'DRAFT', registrationEligible: false }), true, '등록 불가 행도 수기 처리완료 체크 대상이어야 한다.');
assert.equal(isSupportManualCompleteSelectable({ deductionKey: 88, status: 'MANUAL_COMPLETED' }), false, '이미 수동처리완료된 행은 다시 체크할 수 없어야 한다.');
const manualCompleted = deriveSupportProcessingStatus({ status: 'MANUAL_COMPLETED' });
assert.equal(manualCompleted.processingStatus, 'MANUAL_COMPLETED');
assert.equal(isSupportProcessingComplete(manualCompleted), true);
assert.equal(supportProcessingLabel(manualCompleted), '수동처리완료');
assert.match(supportStatusDetail({ status: 'MANUAL_COMPLETED', processingStatus: 'MANUAL_COMPLETED', orderYear: 2026, orderWeek: '32' }, 2026, 33), /수기 처리/);

const customerEstimateUrl = new URL(buildEstimateCustomerUrl({
  year: 2026, week: 33, custKey: 77, customerName: '청화원예',
}), 'https://nenova.test');
assert.equal(customerEstimateUrl.searchParams.get('year'), '2026', '업체 견적서 링크는 화면 선택 연도를 써야 한다.');
assert.equal(customerEstimateUrl.searchParams.get('week'), '33', '업체 견적서 링크는 부모차수만 전달해야 한다.');
assert.equal(customerEstimateUrl.searchParams.get('custKey'), '77', '업체 견적서 링크는 CustKey를 포함해야 한다.');
assert.equal(customerEstimateUrl.searchParams.get('highlightDeductions'), '1', '업체 견적서 링크는 불량차감 행을 강조해야 한다.');
assert.equal(new URL(buildEstimateCustomerUrl({ year: 2025, week: 33, custKey: 77 }), 'https://nenova.test').searchParams.get('year'), '2025', '같은 33차라도 2025년 선택이면 2025 견적서를 열어야 한다.');
assert.equal(buildEstimateCustomerUrl({ year: 2026, week: 33, custKey: 0 }), '', '거래처 키가 없으면 견적서 링크를 만들지 않아야 한다.');

console.log('sales defect deduction tests passed');
