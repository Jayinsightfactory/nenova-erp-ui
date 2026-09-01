import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('pages/orders/paste.js', 'utf8');
assert.match(page, /className="paste-action-split"/);
assert.match(page, /paste-global-action-board-top/);
assert.match(page, /className="paste-primary-batch-action"/);
assert.match(page, /1\. 전체 확인 → 2\. 왼쪽 취소 → 3\. 오른쪽 추가·분배/);
assert.ok(
  page.indexOf('className="paste-primary-batch-action"') < page.indexOf('className="paste-input-grid"'),
  '전체 일괄 등록·분배 버튼은 붙여넣기 입력 영역보다 위에 있어야 한다.',
);
assert.match(page, /\.paste-input-grid \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
const pasteInputIndex = page.indexOf('className="paste-col paste-col-order"');
const topPreviewIndex = page.indexOf('renderGlobalActionPreviewBoard({ compact: true })');
const stockInputIndex = page.indexOf('className="paste-col paste-col-stock"');
assert.ok(
  pasteInputIndex >= 0 && topPreviewIndex > pasteInputIndex && topPreviewIndex < stockInputIndex,
  '취소·추가 예상 결과는 붙여넣기 입력 바로 오른쪽, 기초재고 영역보다 위에 렌더링해야 한다.',
);
assert.equal(
  page.match(/renderGlobalActionPreviewBoard\(\{ compact: true \}\)/g)?.length,
  1,
  '상단 예상 결과표는 한 번만 렌더링해 아래에 중복 표시하지 않는다.',
);
assert.match(page, /분석 결과/);
assert.match(page, /입력 오른쪽에서 취소·추가 예상값을 바로 확인하세요/);
assert.match(page, /className="paste-order-helper-details"/);
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
assert.deepEqual(contract.pastePreviewPlacementPolicy.preserve, [
  'OrderMaster', 'OrderDetail', 'ShipmentMaster', 'ShipmentDetail', 'ShipmentDate',
  'ShipmentFarm', 'Stock', 'Estimate', 'WebProfitReport',
]);
console.log('paste split action layout tests passed');
