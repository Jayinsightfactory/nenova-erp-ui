import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  formatShipmentDateWithWeekday,
  getShipmentRegionStyle,
  parseShipmentDateMeta,
  summarizeShipmentDates,
} from '../lib/shipmentWeekdayFormat.js';
import {
  buildCompareRows,
  buildUpdateCostPayload,
  formatShipDateShort,
  groupCompareRows,
  mergeBaselineCandidates,
} from '../lib/orderImportCompareLogic.js';

// 1. Timezone-safe YYYY-MM-DD -> Korean weekday + PR #2061 unified pivotVolumeColors palette
{
  // 2026-11-26 = Thursday (목), 2026-11-27 = Friday (금), 2026-11-28 = Saturday (토), 2026-11-30 = Monday (월)
  const thu = parseShipmentDateMeta('2026-11-26');
  assert.equal(thu.unassigned, false);
  assert.equal(thu.isoDate, '2026-11-26');
  assert.equal(thu.shortDate, '11-26');
  assert.equal(thu.weekday, '목');
  assert.equal(thu.weekdayFull, '목요일');
  assert.equal(thu.dayColor.fill, '#FCE4D6');
  assert.equal(thu.dayColor.ink, '#7C2D12');

  // Space-separated SQL datetime string must NEVER drift backward by KST offset
  const satSql = parseShipmentDateMeta('2026-11-28 00:00:00');
  assert.equal(satSql.weekday, '토');
  assert.equal(satSql.dayColor.fill, '#E2F0D9');
  assert.equal(satSql.dayColor.ink, '#14532D');

  const monIso = parseShipmentDateMeta('2026-11-30T00:00:00.000Z');
  assert.equal(monIso.weekday, '월');
  assert.equal(monIso.dayColor.fill, '#D9EAF7');
  assert.equal(monIso.dayColor.ink, '#0C4A6E');

  assert.equal(formatShipmentDateWithWeekday('2026-11-27'), '2026-11-27 (금)');
  assert.equal(formatShipmentDateWithWeekday('2026-11-27', { short: true }), '11-27 (금)');

  const emptyMeta = parseShipmentDateMeta('');
  assert.equal(emptyMeta.unassigned, true);
  assert.equal(emptyMeta.weekday, '미지정');
  assert.equal(emptyMeta.dayColor.fill, '#E8EEF4');

  const gbRegion = getShipmentRegionStyle('경부선');
  assert.equal(gbRegion.fill, '#DCFCE7');
  assert.equal(gbRegion.ink, '#23713D');

  const fallbackRegion = getShipmentRegionStyle('지역 미등록');
  assert.equal(fallbackRegion.label, '지역 미등록');
  assert.equal(fallbackRegion.fill, '#E2E8F0');
}

// 2. Multi-date split aggregation & chronological ordering for import-compare
{
  const agg = summarizeShipmentDates([
    { date: '2026-11-28', qty: 4 },
    { date: '2026-11-26', qty: 6 },
    { date: '2026-11-28', qty: 2 },
    { date: '', qty: 1 },
  ]);
  assert.equal(agg.length, 3);
  assert.deepEqual(
    agg.map((a) => [a.isoDate, a.weekday, a.qty, a.unassigned]),
    [
      ['2026-11-26', '목', 6, false],
      ['2026-11-28', '토', 6, false],
      ['', '미지정', 1, true],
    ],
  );

  const baseline = mergeBaselineCandidates([
    {
      id: 'upload:1',
      sourceKind: 'UPLOAD',
      dateKey: '2026-11-25',
      label: '엑셀 업로드',
      items: [
        { prodKey: 101, prodName: 'Rose Freedom 60cm', qty: 10, unit: '박스', outUnit: '박스', unitPrice: 120000 },
        { prodKey: 102, prodName: 'Hydrangea White', qty: 5, unit: '박스', outUnit: '박스', unitPrice: 95000 },
      ],
    },
  ]);

  const compared = buildCompareRows(baseline, [
    {
      prodKey: 101,
      prodName: 'Rose Freedom 60cm',
      counName: '콜롬비아',
      flowerName: '장미',
      outUnit: '박스',
      shipQty: 10,
      shipCost: 120000,
      shipAmount: 1200000,
      hasFixed: true,
      shipDates: [
        { dateKey: '2026-11-26', qty: 6, amount: 720000 },
        { dateKey: '2026-11-28', qty: 4, amount: 480000 },
      ],
      shipmentDetails: [{ shipmentKey: 1, sdetailKey: 11, outQty: 10, estQty: 10, cost: 120000, amount: 1200000, isFix: 1 }],
    },
    {
      prodKey: 205,
      prodName: 'Carnation Moon Light',
      counName: '콜롬비아',
      flowerName: '카네이션',
      outUnit: '단',
      shipQty: 20,
      shipCost: 8500,
      shipAmount: 170000,
      hasFixed: false,
      shipDates: [{ dateKey: '2026-11-27', qty: 20, amount: 170000 }],
      shipmentDetails: [{ shipmentKey: 1, sdetailKey: 12, outQty: 20, estQty: 20, cost: 8500, amount: 170000, isFix: 0 }],
    },
  ]);

  const row101 = compared.rows.find((r) => r.prodKey === 101);
  const row102 = compared.rows.find((r) => r.prodKey === 102);
  const row205 = compared.rows.find((r) => r.prodKey === 205);

  assert.equal(row101.status, 'SAME');
  assert.deepEqual(
    row101.shipDates.map((d) => `${formatShipDateShort(d.dateKey)}:${d.qty}`),
    ['11/26(목):6', '11/28(토):4'],
  );
  assert.equal(row102.status, 'UNALLOCATED');
  assert.equal(row102.shipDates.length, 0);
  assert.equal(row205.status, 'ADDED');
  assert.deepEqual(
    row205.shipDates.map((d) => `${formatShipDateShort(d.dateKey)}:${d.qty}`),
    ['11/27(금):20'],
  );

  const grouped = groupCompareRows(compared.rows, { groupByShipDate: true, groupByVariety: true });
  assert.deepEqual(
    grouped.sections.map((s) => s.dateKey),
    ['2026-11-26', '2026-11-27', '2026-11-28', 'NO_DATE'],
  );

  // Ensure inline price update payload remains 100% intact
  const costPayload = buildUpdateCostPayload(compared.rows, { '205': '9000' });
  assert.equal(costPayload.editedRowCount, 1);
  assert.equal(costPayload.items[0].sdetailKey, 12);
  assert.equal(costPayload.items[0].cost, 9000);
}

// 3. SQL Schema Guard & Editorial List Design / Weekday Column Source Contracts across all 4 screens
{
  const stockStatusApi = fs.readFileSync(
    new URL('../pages/api/shipment/stock-status.js', import.meta.url),
    'utf8',
  );
  const dispatchListUi = fs.readFileSync(
    new URL('../components/shipment/WeekPivotDispatchList.js', import.meta.url),
    'utf8',
  );
  const importCompareApi = fs.readFileSync(
    new URL('../pages/api/orders/import-compare.js', import.meta.url),
    'utf8',
  );
  const importCompareUi = fs.readFileSync(
    new URL('../pages/orders/import-compare.js', import.meta.url),
    'utf8',
  );
  const distributeImportUi = fs.readFileSync(
    new URL('../pages/shipment/distribute-import.js', import.meta.url),
    'utf8',
  );
  const shipmentViewUi = fs.readFileSync(
    new URL('../pages/shipment/view.js', import.meta.url),
    'utf8',
  );

  // 3a. stock-status.js dispatchList SQL: must COALESCE(d.ShipmentDtm, sd.ShipmentDtm) and NEVER reference non-existent sm.ShipmentDtm
  assert.match(stockStatusApi, /COALESCE\(\s*d\.ShipmentDtm\s*,\s*sd\.ShipmentDtm\s*\)/);
  assert.doesNotMatch(stockStatusApi, /\bsm\.ShipmentDtm\b/i);

  // 3b. WeekPivotDispatchList.js: dedicated 출고요일 column, unified badges, raw '[핵심 목적 · PURPOSE]' removed, smoke contract intact
  assert.doesNotMatch(dispatchListUi, /\[핵심 목적\s*·\s*PURPOSE\]/);
  assert.match(dispatchListUi, /<th scope="col" className="col-weekday">출고요일<\/th>/);
  assert.match(dispatchListUi, /weekday-badge/);
  assert.match(dispatchListUi, /region-badge/);
  assert.match(dispatchListUi, /'Pretendard Variable',\s*'Pretendard'/);
  assert.match(dispatchListUi, /font-variant-numeric:\s*tabular-nums/);
  assert.match(dispatchListUi, /content-visibility:\s*auto/);

  // 3c. import-compare: SELECTs ShipmentDtm + ShipmentDate splits without write statements, renders 분배 출고일 · 요일 with unified weekday badges
  assert.match(importCompareApi, /ShipmentDtm/);
  assert.match(importCompareApi, /ShipmentDate/);
  assert.match(importCompareUi, /분배 출고일 · 요일/);
  assert.match(importCompareUi, /ShipDateWeekdayBadge/);

  // 3d. distribute-import & shipment/view: explicit 출고요일 badges & clean editorial typography without monospace/decorative emojis
  assert.match(distributeImportUi, /출고일 · 요일/);
  assert.match(distributeImportUi, /ShipDateWithWeekday/);
  assert.match(shipmentViewUi, /출고요일/);
  assert.match(shipmentViewUi, /weekday-tag/);
  assert.doesNotMatch(shipmentViewUi, /\bmonospace\b|var\(--mono\)/i);
  assert.doesNotMatch(shipmentViewUi, /[🔄🖨️📷🔍⚠️🚀✨🔥💡🤖]/u);
  for (const src of [dispatchListUi, shipmentViewUi]) {
    assert.doesNotMatch(src, /감시|추적|모니터링|절감시간/);
  }
}

console.log('PASS Dispatch ship-date COALESCE recovery, timezone-safe weekday badges, and unified high-density list design across all 4 screens');
