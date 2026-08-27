const assert = require('assert');
const fs = require('fs');
const path = require('path');

const page = fs.readFileSync(path.join(__dirname, '..', 'pages', 'stats', 'china-volume-board.js'), 'utf8');
assert.match(page, /width:92px;min-width:92px;max-width:92px;height:38px;min-height:38px/, '수량 셀 크기를 고정한다');
assert.match(page, /\.box-badges\{position:absolute/, '박스 배지는 셀 레이아웃 밖의 overlay다');
assert.match(page, /color:#d31616;border:1px solid #e32626/, '박스번호는 빨간 글씨와 빨간 테두리다');
assert.match(page, /draft\.allocations\.map/, '박스별로 독립 수정 입력행을 렌더링한다');
assert.match(page, /엑셀 다운로드/, '인쇄 대신 현재 편집 물량표를 엑셀로 다운로드한다');
assert.match(page, /chinaVolumeProductLabel\(row\.prodName\)/, '화면 품목명은 CHINA 접두어를 제거한 공용 라벨을 사용한다');
assert.match(page, /data-digits=\{digits\}/, '박스번호 자릿수를 배지 폭 정책에 전달한다');
assert.match(page, /flex-wrap:wrap/, '자릿수별 실제 폭의 누적값이 셀 폭을 넘으면 다음 줄로 배치한다');
assert.match(page, /box-badge\[data-digits="1"\]\{width:16px\}/, '1자리 번호는 가장 좁은 폭을 사용한다');
assert.match(page, /box-badge\[data-digits="2"\]\{width:20px\}/, '2자리 번호는 중간 폭을 사용한다');
assert.match(page, /box-badge\[data-digits="3"\]\{width:26px\}/, '3자리 번호는 넓은 폭을 사용한다');
assert.match(page, /grid-template-columns:minmax\(0,1fr\) 390px/, '1920 화면에서 물량표와 입고원장을 좌우 배치한다');
assert.ok(!page.includes('/api/shipment/'), '웹 물량표 화면은 ERP 출고 쓰기 API를 호출하지 않는다');
console.log('chinaVolumeBoard UI contract passed');

