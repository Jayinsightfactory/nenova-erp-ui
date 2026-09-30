// 운송료·현지상차운임 판매행은 본표 N(순수매출액)이 아니라 O(그 외 매출액)에 들어간다(사장님 승인 2026-09-30).
// 근거: 22/25/27/28차 원본 엑셀 — 판매현황 시트엔 운송료 행 0건, '그 외 매출액' 시트에만 존재.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FREIGHT_SALES_RE, freightSalesProductSql, buildSalesRows } from '../lib/profitWorkbookRules.js';

// SQL 조각이 JS 정규식과 같은 판정을 하는지(LIKE 의미를 JS로 흉내)
const sqlFrag = freightSalesProductSql('p');
assert.match(sqlFrag, /ISNULL\(p\.ProdName,N''\) LIKE N'%운송료%'/);
assert.match(sqlFrag, /REPLACE\(ISNULL\(p\.ProdName,N''\),N' ',N''\) LIKE N'%현지상차운임%'/);
const sqlLike = (name) => name.includes('운송료') || name.replace(/ /g, '').includes('현지상차운임');
for (const name of ['운송료', '수국 운송료', '네덜란드 운송료', '현지상차운임', '현지상차 운임', '카네이션 Moon Light', 'SERVICE FEE', 'Gross weight']) {
  assert.equal(sqlLike(name), FREIGHT_SALES_RE.test(name), name);
}

// 판매현황 시트 행 분류도 같은 규칙(운송료 → other)
const rows = buildSalesRows([{ ProdName: '수국 운송료', Amount: 100, Vat: 10, EstQuantity: 1, Category: '콜롬비아 수국' }, { ProdName: 'Hydrangea', Amount: 200, Vat: 20, EstQuantity: 1, Category: '콜롬비아 수국' }]);
assert.deepEqual(rows.map((r) => r.sheet).sort(), ['other', 'sales']);

const src = fs.readFileSync(new URL('../lib/profitReport.js', import.meta.url), 'utf8');
const body = (name) => { const i = src.indexOf(`export async function ${name}(`); assert.ok(i >= 0, name); return src.slice(i, src.indexOf('\nexport ', i + 10)); };
assert.match(body('salesByCategory'), /AND NOT \$\{freightSalesProductSql\('p'\)\}/, 'N은 운송료 제외');
assert.match(body('freightSalesByCategory'), /AND \$\{freightSalesProductSql\('p'\)\}/, '운송료 판매 집계');
assert.match(body('freightSalesByCategory'), /ISNULL\(sm\.isFix,0\)=1 AND ISNULL\(sd\.isFix,0\)=1/, 'N과 같은 확정 필터');
assert.match(body('estimateByCategory'), /freightSalesByCategory\(major, orderYear\)/, 'O에 운송료 가산');

const mix = fs.readFileSync(new URL('../lib/profitReportCustomerMixSql.js', import.meta.url), 'utf8');
assert.match(mix, /AND NOT \$\{freightSalesProductSql\('p'\)\}/, '드라이버 분석 매출도 N과 동일 필터');

console.log('profitReportFreightSalesToO ok');
