const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const myOrders = read('pages/orders/my-customers.js');
const pnl = read('pages/raum/pnl.js');

assert(/addEventListener\(MENU_BACK_REQUEST_EVENT, handleContextualBack\)/.test(myOrders));
assert(/setSelectionCollapsed\(false\)/.test(myOrders), '내 업체 주문등록은 차수·업체 선택을 다시 펼쳐야 합니다.');
assert(/setShowTemplates\(false\)/.test(myOrders) && /setShowExecutionLog\(false\)/.test(myOrders));
assert(/주문 처리가 끝난 뒤 차수·업체 선택으로 돌아가세요/.test(myOrders));

assert(/addEventListener\(MENU_BACK_REQUEST_EVENT, handleContextualBack\)/.test(pnl));
assert(/const returnToSettlementList = \(\) =>/.test(pnl));
assert(/setDetail\(null\)/.test(pnl) && /setBulkPreview\(null\)/.test(pnl));
assert(/저장하지 않은 상세 또는 업로드 미리보기가 사라집니다/.test(pnl));
assert.equal((pnl.match(/onClick=\{returnToSettlementList\}>← 결산 목록/g) || []).length, 2);

console.log('contextualMenuBack tests passed');
