import fs from 'node:fs';
import './incomingQueryDateRange.test.js';
import './warehouseInlineIdentity.test.mjs';
import './warehouseDetailActions.test.mjs';
import assert from 'node:assert/strict';
import { sqlWarehouseViewGetData, sqlWarehouseViewGetDetail } from '../lib/exeWarehouseViewSql.js';
import { receiptBoxSuggestion } from '../lib/receiptBoxSuggestion.js';

const sql = sqlWarehouseViewGetData();
assert.match(sql, /SUM\(wd\.BoxQuantity\) AS BoxQuantity/);
assert.match(sql, /SUM\(wd\.BunchQuantity\) AS BunchQuantity/);
assert.match(sql, /SUM\(wd\.SteamQuantity\) AS SteamQuantity/);
assert.match(sql, /wd\.BoxQuantity AS totalBox/);
assert.match(sql, /wd\.BunchQuantity AS totalBunch/);
assert.match(sql, /wd\.SteamQuantity AS totalSteam/);
assert.match(sql, /GROUP BY WarehouseKey/);
assert.match(sql, /wm\.isDeleted = 0/);
for (const field of ['GrossWeight','ChargeableWeight','FreightRateUSD','DocFeeUSD']) assert.ok(sql.includes(`wm.${field}`));
const detailSql = sqlWarehouseViewGetDetail();
assert.match(detailSql, /wd\.UPrice AS 단가/);
assert.match(detailSql, /wd\.TPrice AS 총액/);
assert.match(detailSql, /wd\.SteamOf1Bunch AS 단송이/);
const detailEvidenceSql = sqlWarehouseViewGetDetail({ goodsTotals: true, boxEvidence: true });
assert.doesNotMatch(detailSql, /ReceiptGoodsLines/);
assert.match(detailEvidenceSql, /FROM WarehouseDetail wd\s+WHERE wd\.WarehouseKey=@warehouseKey/);
assert.match(detailEvidenceSql, /receiptGoods\.GoodsLines AS ReceiptGoodsLines/);

const confirmedPack = { WarehouseKey: 9001, OrderYear: '2026', OrderWeek: '47-02',
  BoxQuantity: null, IsWeightRow: false, ReceiptGoodsLines: 1, SteamQuantity: 200,
  박스송이: 100, BunchQuantity: 20, 단송이: 10, 단위: '단', OutQuantity: 20 };
const priorYear = { ...confirmedPack, WarehouseKey: 1000, OrderYear: '2025', 박스송이: 0 };
assert.deepEqual(receiptBoxSuggestion(confirmedPack), { quantity: 2, description: '원장행 200송이 ÷ 100송이/박스' });
assert.equal(receiptBoxSuggestion(priorYear), null);
for (const nearMiss of [
  { BoxQuantity: 0 }, { BoxQuantity: 0.5 }, { IsWeightRow: true }, { ReceiptGoodsLines: 2 },
  { 박스송이: 1 }, { 박스송이: 60 }, { BunchQuantity: 19 }, { 단위: 'kg' }, { OutQuantity: 19 },
]) assert.equal(receiptBoxSuggestion({ ...confirmedPack, ...nearMiss }), null);

const page = fs.readFileSync(new URL('../pages/incoming.js', import.meta.url), 'utf8');
assert.match(page, /\/api\/warehouse\/invoice-costs/);
assert.match(page, /Number\(line\.wdetailKey\)/);
assert.match(page, /seq === detailSeq\.current/);
assert.match(page, /invoiceCosts\?\.status === 'STALE'/);
assert.match(page, /미확정값을 0원으로 표시하지 않습니다/);
const productNameStart = page.indexOf("{ title: '품목명(색상)'");
const productNameEnd = page.indexOf("{ title: '단위'", productNameStart);
const productNameColumn = productNameStart >= 0 && productNameEnd > productNameStart
  ? page.slice(productNameStart, productNameEnd)
  : '';
assert.ok(productNameColumn, '입고 상세의 품목명 컬럼을 찾아야 한다.');
assert.doesNotMatch(productNameColumn, /ellipsis:\s*true/, '품목명 컬럼은 말줄임을 적용하지 않아야 한다.');
assert.match(productNameColumn, /width:\s*280/, '긴 품목명이 줄바꿈될 수 있는 기준 폭을 유지한다.');
assert.match(productNameColumn, /whiteSpace:\s*'normal'/, '품목명은 줄바꿈해야 한다.');
assert.match(productNameColumn, /overflowWrap:\s*'anywhere'/, '공백 없는 긴 품목명도 줄바꿈해야 한다.');
assert.match(productNameColumn, /title=\{d\.DisplayName \|\| d\.ProdName \|\| ''\}/, '전체 품목명은 툴팁으로 확인할 수 있어야 한다.');

console.log('✓ 입고관리 원장 합계 별칭 및 상세 품목명 전체 표시');
