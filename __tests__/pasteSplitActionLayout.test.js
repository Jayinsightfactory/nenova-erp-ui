import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('pages/orders/paste.js', 'utf8');
assert.match(page, /className="paste-action-split"/);
assert.match(page, /paste-global-action-board-top/);
assert.match(page, /className="paste-primary-batch-action"/);
assert.ok(
  page.indexOf('className="paste-primary-batch-action"') > page.indexOf('className="paste-input-grid"'),
  '전체 일괄 등록·분배 버튼은 4열 작업 결과 영역 안에 있어야 한다.',
);
assert.match(page, /@media \(min-width: 1600px\) \{[\s\S]*?\.paste-input-grid \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
assert.match(page, /@media \(max-width: 768px\) \{[\s\S]*?\.paste-input-grid \{ grid-template-columns: 1fr; \}/);
const baselineIndex = page.indexOf('className="paste-col paste-col-baseline"');
const pasteInputIndex = page.indexOf('className="paste-col paste-col-order paste-column-order-input"');
const topPreviewIndex = page.indexOf('renderGlobalActionPreviewBoard({ compact: true })');
const stockInputIndex = page.indexOf('className="paste-col paste-col-stock paste-column-base-input"');
const helperIndex = page.indexOf('className="paste-col paste-col-stock-side paste-column-helper"');
const resultsIndex = page.indexOf('className="paste-col paste-col-work-results"');
assert.ok(
  baselineIndex >= 0 && pasteInputIndex > baselineIndex && topPreviewIndex > pasteInputIndex && stockInputIndex > topPreviewIndex && helperIndex > stockInputIndex && resultsIndex > helperIndex,
  '4열은 기준·수신함, 주문+기초재고, 분석+보조, 결과·이력 순서로 렌더링해야 한다.',
);
assert.match(page, /\.paste-col-baseline \{ grid-column: 1; grid-row: 1 \/ span 2;/);
assert.match(page, /\.paste-column-order-input \{ grid-column: 2; grid-row: 1; \}/);
assert.match(page, /\.paste-column-base-input \{ grid-column: 2; grid-row: 2; \}/);
assert.match(page, /\.paste-column-analysis \{ grid-column: 3; grid-row: 1; \}/);
assert.match(page, /\.paste-column-helper \{ grid-column: 3; grid-row: 2; \}/);
assert.match(page, /\.paste-col-work-results \{ grid-column: 4; grid-row: 1 \/ span 2;/);
assert.equal(
  page.match(/renderGlobalActionPreviewBoard\(\{ compact: true \}\)/g)?.length,
  1,
  '상단 예상 결과표는 한 번만 렌더링해 아래에 중복 표시하지 않는다.',
);
assert.match(page, /분석 결과/);
assert.match(page, /입력 오른쪽에서 취소·추가 예상값을 바로 확인하세요/);
assert.match(page, /className="paste-order-helper-details"/);
assert.match(page, /StockImpactSummary[\s\S]*draft=\{stockDraft\}[\s\S]*selectedWeek=\{week\}/);
assert.match(page, /기초재고 변동 예상/);
assert.match(page, /예상잔량 = 기초재고 \+ 취소 − 추가/);
assert.match(page, /최근 붙여넣기 작업 이력/);
assert.match(page, /주문 변경 이력/);
assert.match(page, /주문 원장 변경만 표시합니다/);
assert.match(page, /저장본 불러오기/);
assert.match(page, /저장본 선택/);
assert.match(page, /새 기록으로 저장/);
assert.match(page, /현재 저장본 덮어쓰기/);
assert.match(page, /const handleBaseStockTextChange = \(nextText\) => \{[\s\S]*buildBaseStockMatchRows[\s\S]*refreshStockDraft/);
assert.match(page, /const entry = \{ status: 'matched', names: \[label\], prodKey: Number\(it\.prodKey\) \}/);
assert.match(page, /buildStockRowsByIdentity\(base, resolvedMatches\)/);
assert.match(page, /resolveStockProjectionIdentity\(record\.productName, resolvedMatches, stockNorm\)/);
assert.match(page, /const analyzedRecords = buildAnalyzedStockRecords\(analysisOrders, selectedWeek\)/);
assert.match(page, /const records = analyzedRecords\.length > 0 \? analyzedRecords : parsedChanges\.records/);
assert.match(page, /analysisOrders: ordersForMatch/);
assert.match(page, /height: clamp\(140px, 16vh, 180px\)/);
assert.match(page, /\.paste-global-action-board-top \{ grid-template-columns: 1fr !important; \}/);
assert.match(page, /왼쪽 · 취소 먼저 \(\$\{globalCancelEntries\.length\}건\)/);
assert.match(page, /오른쪽 · 추가·분배 \(\$\{globalAddEntries\.length\}건\)/);
assert.match(page, /적용 예상 · 주문 \$\{previewQty\(preview\.orderBefore\)\}→\$\{previewQty\(preview\.orderAfter\)\} \/ 분배 \$\{previewQty\(preview\.shipmentBefore\)\}→\$\{previewQty\(preview\.shipmentAfter\)\}/);
assert.match(page, /orders\.flatMap\(order =>/);
assert.match(page, /const handleAllMixedDistribute = async/);
assert.match(page, /const targets = orderPasteMixedBatchTargets\(eligible\);[\s\S]*fetch\('\/api\/shipment\/adjust-batch'/);
assert.match(page, /entries: targets\.map\(t =>/);
assert.match(page, /if \(matched\) \{[\s\S]*await fetchShipmentQtys\([\s\S]*matched\.custKey,[\s\S]*effectiveWeek/);
assert.match(page, /\/api\/shipment\/adjust\?type=current&week=\$\{encodeURIComponent\(week\)\}&year=\$\{encodeURIComponent\(orderYear\)\}&custKey=/);
assert.match(page, /일괄 대상이 아니었던 기존 품목[\s\S]*await Promise\.all\(orders\.filter/);
assert.match(page, /if \(!response\.ok \|\| result\.success !== true \|\| result\.verified !== true\)[\s\S]*throw rollbackError/);
assert.match(page, /okCount: 0,[\s\S]*failCount: targets\.length,[\s\S]*rolledBack: true/);
assert.match(page, /성공 0건 · 전체 \$\{bulkResult\.failCount\}건 모두 롤백 — 수정 후 전체 재실행/);
assert.doesNotMatch(page, /handleAllMixedDistribute\(\{ failedOnly: true \}\)/);
assert.doesNotMatch(page, /전체 업체[\s\S]{0,120}실패 품목만 재시도/);
const atomicHandler = page.slice(
  page.indexOf('const handleAllMixedDistribute = async'),
  page.indexOf('// 등록된 주문을 기준으로 분배만 다시 저장한다.'),
);
assert.match(atomicHandler, /const targets = orderPasteMixedBatchTargets\(eligible\);/);
assert.doesNotMatch(atomicHandler, /for \(const t of targets\)/);
assert.match(atomicHandler, /setRegisteredOrders[\s\S]*setShipmentQtys[\s\S]*loadOrderHistorySummary[\s\S]*\} catch \(error\)/);
const atomicCatch = atomicHandler.slice(
  atomicHandler.indexOf('} catch (error)'),
  atomicHandler.indexOf('const handleUndoAllMixedDistribute'),
);
assert.doesNotMatch(atomicCatch, /setRegisteredOrders|setShipmentQtys|loadOrderHistorySummary/);
assert.match(page, /추가·취소 전체 일괄 등록·분배/);
assert.match(page, /setBulkCompletionNotice\(completionNotice\)/, '전체 일괄 작업은 작업권 정리 뒤 완료 알림창을 열어야 한다.');
assert.match(page, /setBulkCompletionNotice\(\{[\s\S]*order\.custMatch\.CustName[\s\S]*okCount,[\s\S]*failCount/, '업체별 일괄 작업도 완료 알림창에 결과를 전달해야 한다.');
assert.match(page, /저장 완료 결과 — 아래 수량이 현재 전산에 반영되었습니다/, '전체 성공 직후 입력 옆에 현재 반영 결과를 표시해야 한다.');
assert.match(page, /주문.*batchResultQty\(row\.orderQtyBefore, row\.orderQtyAfter/, '성공 결과는 주문 전후 수량을 표시해야 한다.');
assert.match(page, /분배.*batchResultQty\(row\.outQtyBefore, row\.outQtyAfter/, '성공 결과는 분배 전후 수량을 표시해야 한다.');
assert.match(page, /if \(bulkResult\?\.orderId === 'ALL'[\s\S]*이미 일괄 등록·분배가 완료되었습니다[\s\S]*return;/, '같은 분석 결과의 성공 후 서버 재요청을 막고 중복 가산 안내를 보여야 한다.');
assert.match(page, /setBulkResult\(null\);[\s\S]*setBulkCompletionNotice\(null\);[\s\S]*setBulkProgress\(''\)/, '다시 분석하면 이전 완료 결과와 실행 잠금을 명시적으로 초기화해야 한다.');
assert.match(page, /role="dialog"/, '완료 결과는 별도 알림창으로 보여야 한다.');
assert.match(page, /title: '일괄 등록·분배 완료'/, '완료 알림창은 일괄 작업 완료를 명확히 알려야 한다.');
assert.match(page, /fetch\(`\/api\/shipment\/adjust\?type=current[\s\S]*AbortSignal\.timeout\(20_000\)/, '완료 후 분배 재조회가 무기한 대기해 처리중 상태에 머물면 안 된다.');
assert.match(page, /const handleUndoAllMixedDistribute = async/);
assert.match(page, /fetch\('\/api\/shipment\/adjust-batch-undo'/);
assert.match(page, /↩ 마지막 전체 일괄 되돌리기/);
assert.match(page, /orderQtyAfter: row\.orderQtyAfter, outQtyAfter: row\.outQtyAfter/);
assert.match(page, /왼쪽 · 취소 업체 저장내역/);
assert.match(page, /오른쪽 · 추가 업체 저장내역/);
assert.match(page, /hidden[\s\S]*onClick=\{\(\) => handleBulkDistribute\(order\.id\)\}/);
assert.match(page, /1\. 취소 먼저 \(\$\{cancelEntries\.length\}건\)/);
assert.match(page, /2\. 추가·분배 \(\$\{addEntries\.length\}건\)/);
assert.match(page, /gridTemplateColumns: 'minmax\(0, 1fr\) minmax\(0, 1fr\)'/);
assert.match(page, /order\.showDetailedItems \|\| unmatched\.length > 0/);
assert.match(page, /const openDetailedMatchEditor = \(oid, idx\) =>/);
assert.match(page, /unmatchedQueue\.findIndex\(q => q\.orderId === oid && q\.itemIdx === idx\)[\s\S]*setQueueIdx\(targetQueueIdx\)/);
assert.match(page, /showDetailedItems: true,[\s\S]*custEditOpen: true,[\s\S]*prodEditOpen: true/);
assert.match(page, /paste-match-\$\{oid\}-\$\{idx\}[\s\S]*scrollIntoView/);
assert.match(page, /onClick=\{\(\) => openDetailedMatchEditor\(order\.id, itemIdx\)\}/);
assert.match(page, /업체를 검색해 다시 선택하세요/);
assert.match(page, /onSelect=\{c => \{[\s\S]*setCustMatch\(order\.id, c\);[\s\S]*custEditOpen: false/);
assert.match(page, /추가·취소 일괄 등록·분배/);
assert.match(page, /const STOCK_NOTE_PAGE = 'paste-stock-note'/);
assert.match(page, /const buildStockNotePayload = \(baseWeek\) => \(\{[\s\S]*?baseWeek,[\s\S]*?orderWeek: week/);
assert.match(page, /const verification = await apiGet\('\/api\/favorites', \{ page: STOCK_NOTE_PAGE \}\)/);
assert.doesNotMatch(page, /saveStockNote[\s\S]*?\/api\/shipment\/start-stock-text/);
assert.match(page, /\.paste-action-split \{ grid-template-columns: 1fr !important; \}/);
assert.match(page, /\.paste-global-action-board \{ grid-template-columns: 1fr !important; \}/);
const contract = JSON.parse(fs.readFileSync('docs/contracts/week-pivot-distribution.json', 'utf8'));
assert.match(contract.pastePreviewPlacementPolicy.desktop, /top-right cell directly beside the paste input/);
assert.match(contract.pasteBaseStockProjectionPolicy.formula, /base \+ cancelled - added/);
assert.deepEqual(contract.pastePreviewPlacementPolicy.preserve, [
  'OrderMaster', 'OrderDetail', 'ShipmentMaster', 'ShipmentDetail', 'ShipmentDate',
  'ShipmentFarm', 'Stock', 'Estimate', 'WebProfitReport',
]);
console.log('paste split action layout tests passed');
