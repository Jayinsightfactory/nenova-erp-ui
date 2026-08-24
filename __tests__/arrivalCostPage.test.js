import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../pages/arrival-cost.js', import.meta.url), 'utf8');

assert.match(source, /const formElement = event\.currentTarget;/);
assert.match(source, /const file = formElement\.elements\.namedItem\('file'\)\?\.files\?\.\[0\];/);
assert.match(source, /formElement\.reset\(\);/);
assert.doesNotMatch(source, /event\.currentTarget\.reset\(\);/);
assert.doesNotMatch(source, /import Layout from/);
assert.doesNotMatch(source, /<Layout title="도착원가">/);
assert.match(source, /품종을 선택하거나 전체보기를 누르세요/);
assert.match(source, /매칭데이터/);
assert.match(source, /applySearch\(\)/);
assert.doesNotMatch(source, /<label>국가 /);
assert.match(source, /aria-selected=/);
assert.match(source, /filters\.orderYear, filters\.orderWeek/);
assert.match(source, /matchedVarieties/);
assert.match(source, /const next = \{ \.\.\.filters, flower \}/);
assert.match(source, /전산 국가·품종\(CountryFlower\)/);
assert.match(source, /aria-label="국가·품종 선택"/);
assert.match(source, /fmt\(row\.sourceArrivalCostKRW, 2\)/, '원가(엑셀)은 도착원가(송이)처럼 소수까지 보여야 한다.');
assert.match(source, /parseJsonResponse/, '품목 검색이 HTML(502)을 받아도 JSON 파싱 오류로 깨지지 않아야 한다.');
assert.match(source, /차수 오름차순/, '차수를 오름차순·내림차순으로 볼 수 있어야 한다.');
assert.match(source, /groupArrivalCostRows/, '같은 차수·품목은 농장별 원가로 묶어야 한다.');
assert.match(source, /품목명 없이 품종 버튼만/, '품목명 검색 없이 품종만 선택해 조회할 수 있어야 한다.');
assert.match(source, /입고수량/, '수량 열은 단/박스 입고단위를 함께 보여야 한다.');

const upload = fs.readFileSync(new URL('../pages/api/arrival-cost/upload.js', import.meta.url), 'utf8');
assert.match(upload, /detectedTableCount/, '표는 있는데 도착원가 금액이 비면 다른 안내를 해야 한다.');

console.log('arrival cost upload form regression tests passed');
