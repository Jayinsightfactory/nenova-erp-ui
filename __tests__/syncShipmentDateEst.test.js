// refreshShipmentDatesAfterDetailChange / scaleShipmentDateQtys 단위 검증 (DB mock)
// 실행: node __tests__/syncShipmentDateEst.test.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const fakeSql = { Int: 'Int', Float: 'Float', DateTime: 'DateTime' };

function makeMockTq(initial) {
  const state = structuredClone(initial);
  const log = [];

  const tQ = async (sql, params = {}) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    log.push({ sql: s.slice(0, 120), params });

    if (s.includes('FROM ShipmentDetail sd WHERE sd.SdetailKey')) {
      return { recordset: state.detail ? [state.detail] : [] };
    }
    if (s.includes('FROM ShipmentDate') && s.includes('ORDER BY ShipmentDtm')) {
      return { recordset: (state.dates || []).map((d) => ({ ...d })) };
    }
    if (s.includes('FROM ShipmentDetail sd') && s.includes('JOIN Product p')) {
      if (!state.detail) return { recordset: [] };
      return {
        recordset: [{
          SdetailKey: state.detail.SdetailKey,
          ShipmentKey: 1,
          ProdKey: 1,
          Cost: state.detail.Cost,
          ...state.product,
        }],
      };
    }
    if (s.includes('UPDATE ShipmentDate SET ShipmentQuantity')) {
      const sk = params.sk?.value;
      const sq = params.sq?.value;
      const row = (state.dates || []).find((d) => d.SdateKey === sk);
      if (row) row.ShipmentQuantity = sq;
      return { recordset: [], rowsAffected: [1] };
    }
    if (s.includes('UPDATE ShipmentDate') && s.includes('EstQuantity')) {
      const sk = params.sk?.value;
      const row = (state.dates || []).find((d) => d.SdateKey === sk);
      if (row) {
        row.EstQuantity = params.est?.value;
        row.Amount = params.amount?.value;
        row.Vat = params.vat?.value;
        row.Cost = params.cost?.value;
      }
      return { recordset: [], rowsAffected: [1] };
    }
    if (s.includes('UPDATE ShipmentDate') && s.includes('ShipmentDtm=COALESCE')) {
      const sk = params.sk?.value;
      const row = (state.dates || []).find((d) => d.SdateKey === sk);
      if (row) {
        row.ShipmentQuantity = params.sq?.value;
        if (params.dt?.value) row.ShipmentDtm = params.dt.value;
      }
      return { recordset: [], rowsAffected: [1] };
    }
    if (s.includes('INSERT INTO ShipmentDate')) {
      state.dates = state.dates || [];
      state.dates.push({
        SdateKey: 99,
        ShipmentDtm: params.dt?.value,
        ShipmentQuantity: params.sq?.value,
        EstQuantity: 0,
        Cost: state.detail?.Cost || 0,
        Amount: 0,
        Vat: 0,
      });
      return { recordset: [], rowsAffected: [1] };
    }
    if (s.includes('DELETE FROM ShipmentDate')) {
      state.dates = [];
      return { recordset: [], rowsAffected: [1] };
    }
    if (s.includes('DELETE FROM ShipmentDetail')) {
      state.detail = null;
      return { recordset: [], rowsAffected: [1] };
    }
    return { recordset: [] };
  };

  return { tQ, log, state };
}

async function main() {
  const {
    refreshShipmentDatesAfterDetailChange,
    scaleShipmentDateQtys,
    reconcileShipmentDateAmountsFromDetail,
  } = await import('../lib/syncShipmentDateEst.js');
  const { distributeUnits } = await import('../lib/distributeUnits.js');

  let pass = 0;
  let fail = 0;
  const assert = (label, cond) => {
    if (cond) pass++;
    else { fail++; console.log(`  ✗ ${label}`); }
  };

  console.log('=== scaleShipmentDateQtys edge cases ===');
  assert('empty rows', scaleShipmentDateQtys([], 10, 20).length === 0);
  const zeroOld = scaleShipmentDateQtys(
    [{ SdateKey: 1, ShipmentQuantity: 0 }, { SdateKey: 2, ShipmentQuantity: 0 }],
    0,
    100
  );
  assert('oldSum=0 균등분배 합=100', zeroOld.reduce((s, r) => s + r.newShipQty, 0) === 100);

  console.log('\n=== refresh: 다중 출고일 비율 스케일 (수국 10+180→200) ===');
  const hydrProduct = { OutUnit: '박스', EstUnit: '송이', BunchOf1Box: 0, SteamOf1Bunch: 0, SteamOf1Box: 30 };
  const multi = makeMockTq({
    detail: { SdetailKey: 75769, OutQuantity: 200, Cost: 700, ShipmentDtm: new Date('2026-06-04') },
    dates: [
      { SdateKey: 1, ShipmentDtm: '2026-06-04', ShipmentQuantity: 10, EstQuantity: 300, Cost: 700, Amount: 0, Vat: 0 },
      { SdateKey: 2, ShipmentDtm: '2026-06-07', ShipmentQuantity: 180, EstQuantity: 5400, Cost: 700, Amount: 0, Vat: 0 },
    ],
    product: hydrProduct,
  });
  const multiRes = await refreshShipmentDatesAfterDetailChange(multi.tQ, 75769, fakeSql);
  const scaledSum = multi.state.dates.reduce((s, d) => s + d.ShipmentQuantity, 0);
  assert('mode=scaled', multiRes.mode === 'scaled');
  assert('dateCount=2', multiRes.dateCount === 2);
  assert('ShipmentQuantity 합=Detail.OutQuantity', scaledSum === 200);
  const estThu = distributeUnits(multi.state.dates[0].ShipmentQuantity, hydrProduct).estQty;
  const estSun = distributeUnits(multi.state.dates[1].ShipmentQuantity, hydrProduct).estQty;
  assert('목 Est≈300 (11박스)', Math.abs(estThu - 330) <= 30);
  assert('일 Est 나머지', estSun > estThu);

  console.log('\n=== refresh: 단일 출고일 UPDATE ===');
  const single = makeMockTq({
    detail: { SdetailKey: 100, OutQuantity: 50, Cost: 500, ShipmentDtm: new Date('2026-06-04') },
    dates: [{ SdateKey: 5, ShipmentDtm: '2026-06-04', ShipmentQuantity: 40, EstQuantity: 400, Cost: 500, Amount: 0, Vat: 0 }],
    product: { OutUnit: '박스', EstUnit: '송이', BunchOf1Box: 0, SteamOf1Bunch: 0, SteamOf1Box: 10 },
  });
  const singleRes = await refreshShipmentDatesAfterDetailChange(single.tQ, 100, fakeSql);
  assert('mode=single-update', singleRes.mode === 'single-update');
  assert('단일 ShipmentQuantity=OutQuantity', single.state.dates[0].ShipmentQuantity === 50);

  console.log('\n=== refresh: OutQuantity=0 → Detail+Date 삭제 ===');
  const cleared = makeMockTq({
    detail: { SdetailKey: 101, OutQuantity: 0, Cost: 500, ShipmentDtm: new Date('2026-06-04') },
    dates: [{ SdateKey: 6, ShipmentDtm: '2026-06-04', ShipmentQuantity: 10, EstQuantity: 100, Cost: 500, Amount: 0, Vat: 0 }],
    product: { OutUnit: '박스', EstUnit: '송이', BunchOf1Box: 0, SteamOf1Bunch: 0, SteamOf1Box: 10 },
  });
  const clearRes = await refreshShipmentDatesAfterDetailChange(cleared.tQ, 101, fakeSql);
  assert('mode=purged-zero-detail', clearRes.mode === 'purged-zero-detail');
  assert('dates 비움', (cleared.state.dates || []).length === 0);
  assert('detail 삭제', cleared.state.detail == null);

  console.log('\n=== refresh: ShipmentDate 없음 → INSERT ===');
  const insert = makeMockTq({
    detail: { SdetailKey: 102, OutQuantity: 12, Cost: 600, ShipmentDtm: new Date('2026-06-05') },
    dates: [],
    product: { OutUnit: '박스', EstUnit: '송이', BunchOf1Box: 0, SteamOf1Bunch: 0, SteamOf1Box: 10 },
  });
  const insRes = await refreshShipmentDatesAfterDetailChange(insert.tQ, 102, fakeSql, {
    shipDtm: new Date('2026-06-05'),
  });
  assert('mode=single-insert', insRes.mode === 'single-insert');
  assert('1행 생성', insert.state.dates.length === 1);
  assert('INSERT 수량=12', insert.state.dates[0].ShipmentQuantity === 12);

  console.log('\n=== exe 정합: distributeUnits(OutQuantity) — Detail·Date 동일 금액 (희경 유형 방지) ===');
  const { estimateFromOutQuantity } = await import('../lib/distributeUnits.js');
  const heeProduct = { OutUnit: '박스', EstUnit: '박스', BunchOf1Box: 10, SteamOf1Bunch: 0, SteamOf1Box: 0 };
  const cost = 2000;
  const outQty = 74;
  const est = estimateFromOutQuantity(outQty, cost, heeProduct);
  assert('EstUnit=박스 → estQty=OutQuantity(박스)', est.estQty === 74);
  assert('amount=74*cost/1.1', est.amount === 134545);

  const heeRefresh = makeMockTq({
    detail: {
      SdetailKey: 79258,
      OutQuantity: outQty,
      Cost: cost,
      EstQuantity: est.estQty,
      Amount: est.amount,
      Vat: est.vat,
      ShipmentDtm: new Date('2026-06-04'),
    },
    dates: [{
      SdateKey: 2,
      ShipmentDtm: '2026-06-04',
      ShipmentQuantity: 75,
      EstQuantity: 750,
      Cost: cost,
      Amount: 1363636,
      Vat: 136364,
    }],
    product: heeProduct,
  });
  const heeRefreshRes = await refreshShipmentDatesAfterDetailChange(heeRefresh.tQ, 79258, fakeSql);
  assert('refresh 후 Date Amount=Detail', heeRefresh.state.dates[0].Amount === est.amount);
  assert('refresh 후 Date EstQuantity=Detail', heeRefresh.state.dates[0].EstQuantity === est.estQty);
  assert('sync만으로 정합( reconcile 불필요)', heeRefreshRes.reconcile === undefined);

  console.log('\n=== reconcile: 레거시 복구 (기존 Detail≠Date 불일치) ===');
  const legacyDetailAmt = 1345455;
  const legacy = makeMockTq({
    detail: {
      SdetailKey: 79257,
      OutQuantity: 74,
      Cost: cost,
      EstQuantity: 740,
      Amount: legacyDetailAmt,
      Vat: 134545,
      ShipmentDtm: new Date('2026-06-04'),
    },
    dates: [{
      SdateKey: 1,
      ShipmentDtm: '2026-06-04',
      ShipmentQuantity: 74,
      EstQuantity: 74,
      Cost: cost,
      Amount: 134545,
      Vat: 13455,
    }],
    product: heeProduct,
  });
  const recRes = await reconcileShipmentDateAmountsFromDetail(legacy.tQ, 79257, fakeSql);
  assert('legacy reconcile', recRes.reconciled === true);
  assert('legacy Date Amount=Detail', legacy.state.dates[0].Amount === legacyDetailAmt);

  console.log('\n=== 웹 경로 정적 회귀 검사 (위험 패턴) ===');
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const mustUseRefresh = [
    'pages/api/estimate/update-quantity.js',
    'pages/api/shipment/distribute.js',
    'pages/api/shipment/adjust.js',
    'pages/api/shipment/stock-status.js',
    'pages/api/public/shipments.js',
    'lib/shipmentImport.js',
  ];
  for (const f of mustUseRefresh) {
    const src = read(f);
    assert(`${f} → refreshShipmentDatesAfterDetailChange 사용`, src.includes('refreshShipmentDatesAfterDetailChange'));
  }
  const updateQty = read('pages/api/estimate/update-quantity.js');
  assert('견적 수량: distributeUnits(OutQuantity) 사용', updateQty.includes('estimateFromOutQuantity'));
  assert('견적 수량: bunch 우선 amountBase 금지', !updateQty.includes('amountBase'));
  assert('견적 수량: 다중출고일 차단 제거', !updateQty.includes('dateCount > 1'));
  assert('견적 수량: DELETE+단일INSERT 패턴 제거', !updateQty.includes('DELETE FROM ShipmentDate WHERE SdetailKey=@sdk'));
  const distribute = read('pages/api/shipment/distribute.js');
  assert('출고분배 저장: refresh 사용', distribute.includes('refreshShipmentDatesAfterDetailChange'));
  assert('출고분배 저장: 무조건 DELETE Detail 제거', !distribute.includes('DELETE FROM ShipmentDetail WHERE ShipmentKey=@sk AND ProdKey=@pk'));
  const publicShip = read('pages/api/public/shipments.js');
  assert('public API: 단일 Detail UPDATE 경로', publicShip.includes('oldList.length === 1'));
  assert('public API: refresh 사용', publicShip.includes('refreshShipmentDatesAfterDetailChange'));

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
