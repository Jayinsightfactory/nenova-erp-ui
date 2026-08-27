const assert = require('assert');
const fs = require('fs');
const path = require('path');

const page = fs.readFileSync(path.join(__dirname, '..', 'pages', 'stats', 'china-volume-board.js'), 'utf8');
assert.match(page, /width:92px;min-width:92px;max-width:92px;height:38px;min-height:38px/, '수량 셀 크기를 고정한다');
assert.match(page, /\.box-badges\{position:absolute/, '박스 배지는 셀 레이아웃 밖의 overlay다');
assert.match(page, /color:#d31616;border:1px solid #e32626/, '박스번호는 빨간 글씨와 빨간 테두리다');
assert.match(page, /draft\.allocations\.map/, '박스별로 독립 수정 입력행을 렌더링한다');
assert.match(page, /grid-template-columns:minmax\(0,1fr\) 390px/, '1920 화면에서 물량표와 입고원장을 좌우 배치한다');
assert.ok(!page.includes('/api/shipment/'), '웹 물량표 화면은 ERP 출고 쓰기 API를 호출하지 않는다');
console.log('chinaVolumeBoard UI contract passed');

