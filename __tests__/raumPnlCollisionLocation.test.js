import assert from 'node:assert/strict';
import fs from 'node:fs';
import { raumPnlCollisionLocationRows } from '../lib/raumPnlCollisionLocation.js';

const rows = raumPnlCollisionLocationRows([
  { incomingIndex: 1, reason: 'exact-preservation-metadata-differ', message: '기존 행 2개의 수기 매입단가 또는 품목 연결이 서로 다릅니다.', location: { hotel: '신라호텔', orderYear: '2025', major: '12', itemName: '장미 화이트', originalSource: '12차!A16', salePrice: 0 } },
  { incomingIndex: 2, reason: 'source-cardinality-change', message: '기존 행 수와 업로드 행 수가 달라 수기 정보를 안전하게 보존할 수 없습니다.', location: { hotel: '아주 긴 호텔 이름 '.repeat(18), orderYear: '2026', major: '12', itemName: '매우 긴 품목명 '.repeat(24), originalSource: '원본!A999' } },
  { incomingIndex: 3, location: {} },
]);
assert.deepEqual(rows.slice(0, 2).map(row => row.orderYear), ['2025', '2026'], 'same major must retain each explicit collision year');
assert.equal(rows[0].salePrice, 0, 'a zero sale price is structured data, not a missing value');
assert.equal(rows[0].confirmation, '기존 행 2개의 수기 매입단가 또는 품목 연결이 서로 다릅니다.', 'the original collision explanation remains available to the table');
assert.equal(rows[1].hotel.includes('아주 긴 호텔 이름'), true);
assert.equal(rows[1].itemName.includes('매우 긴 품목명'), true);
assert.deepEqual(rows[2], {
  key: '2:3:', hotel: '호텔 미상', orderYear: '연도 미상', major: '차수 미상',
  itemName: '품목 미상', originalSource: '원본 위치 미상', salePrice: null, confirmation: '확인 내용 미상',
});
assert.deepEqual(raumPnlCollisionLocationRows(null), []);

const page = fs.readFileSync(new URL('../pages/raum/pnl.js', import.meta.url), 'utf8');
const core = fs.readFileSync(new URL('../lib/raumPnl.js', import.meta.url), 'utf8');
assert.match(page, /RaumPnlCollisionLocations details=\{collisionAlert\.details\}/);
assert.match(page, /reportPnlError\(e\)/, 'preview, automatic save, bulk save, and detail save share structured collision reporting');
assert.match(core, /orderYear,\s*major,\s*itemName,\s*originalSource,\s*salePrice/);
assert.match(core, /item\.price \?\? item\.SalePrice \?\? null/, 'the core must preserve a source price of zero');
console.log('Raum P&L collision location tests passed');
