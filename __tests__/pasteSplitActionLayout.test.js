import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync('pages/orders/paste.js', 'utf8');
assert.match(page, /className="paste-action-split"/);
assert.match(page, /className="paste-global-action-board"/);
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
assert.match(page, /\.paste-action-split \{ grid-template-columns: 1fr !important; \}/);
assert.match(page, /\.paste-global-action-board \{ grid-template-columns: 1fr !important; \}/);
console.log('paste split action layout tests passed');
