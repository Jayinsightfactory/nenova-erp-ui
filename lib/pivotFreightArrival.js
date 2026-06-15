// lib/pivotFreightArrival.js — 도착원가 집계 (pivot 통계용)
//
// 역할:
//   1. aggregateArrivalCosts(records)  — 순수함수, DB 없음, 가중평균 집계
//   2. getArrivalCostsForWeekRange(…)  — DB 조회 + 집계, 차수 범위 → prodKey 별 arrivalCost 맵
//
// "도착원가" 의 정의 = lib/freightCalc.js computeFreightCost() 의 rows[].displayArrivalKRW
//   displayArrivalKRW = (FOB + freightPerDisplayUnit) * exchangeRate * (1 + tariffRate) + customsPerDisplayUnit
//   displayUnit 은 Product.OutUnit 최빈값(박스/단/송이). 이 값이 운송기준원가 탭 UI 표시와 동일.
//
// ── snapshot vs live 결정 규칙 ──────────────────────────────────────────────
//
//   FreightCostDetail 스냅샷에는 ArrivalPerStem (송이당), ArrivalPerBunch (단당) 만 있고
//   박스당(ArrivalPerBox) 컬럼은 없다.
//
//   displayUnit 이 '단'  → 스냅샷 ArrivalPerBunch 사용 가능 → source: 'snapshot'
//   displayUnit 이 '송이' → 스냅샷 ArrivalPerStem  사용 가능 → source: 'snapshot'
//   displayUnit 이 '박스' → 스냅샷 재현 불가 → LIVE computeFreightCost 호출 필요 → source: 'live'
//   스냅샷 자체가 없는 AWB  → LIVE 계산 → source: 'live'
//
//   결정 원칙: "의심스러우면 LIVE 우선" — freight 탭과 동일 로직이므로 수치가 일치함이 보장됨.
//   박스 displayUnit 판정: Product.OutUnit = '박스' OR (스냅샷에 없고 콜롬비아 품목).
//
// ── 다중 AWB/차수 → 입고수량 가중평균 ──────────────────────────────────────
//
//   동일 ProdKey 가 여러 AWB에 걸쳐 입고된 경우:
//     arrivalCost = Σ(inQty × displayArrivalKRW) / Σ(inQty)
//   inQty = WarehouseDetail.OutQuantity (입고수량)
//   inQty=0 행은 제외.
//
// ── Read-only — DB 쓰기 없음 ─────────────────────────────────────────────────

import { query, sql } from './db';
import {
  computeFreightCost,
  normalizeFlower,
  isFreightForwarder,
  isFreightRow,
  isGrossWeightItem,
  isChargeableWeightItem,
  freightWeightOfRow,
  detectInvoiceCurrency,
} from './freightCalc';
import { loadOverrides } from './categoryOverrides';
import { buildOrderYearWeek, normalizeOrderWeek, normalizeOrderYear } from './orderUtils';
import { aggregateArrivalCosts } from './pivotArrivalCalc';

// re-export so callers can import either file
export { aggregateArrivalCosts };

// ──────────────────────────────────────────────────────────────────────────────
// DB 로더
// (순수 집계함수 aggregateArrivalCosts は lib/pivotArrivalCalc.js に分離 — DB-free, node-testable)
// ──────────────────────────────────────────────────────────────────────────────

const DEFAULT_CUSTOMS = {
  bakSangRate: 460,
  handlingFee: 33000,
  quarantinePerItem: 10000,
  domesticFreight: 99000,
  deductFee: 40000,
  extraFee: 0,
};

/**
 * 차수 범위(weekStart ~ weekEnd)의 모든 AWB 를 조회해
 * prodKey 별 도착원가 맵을 반환한다. Read-only.
 *
 * @param {{ weekStart: string, weekEnd?: string, orderYear?: string }} param
 * @returns {Promise<{ [prodKey: number]: {
 *   arrivalCost: number,
 *   arrivalPerStem: number,
 *   arrivalPerBunch: number|null,
 *   displayUnit: string,
 *   source: 'snapshot'|'live'
 * } }>}
 */
export async function getArrivalCostsForWeekRange({ weekStart, weekEnd, orderYear }) {
  if (!weekStart) return {};

  const weekStartNorm = normalizeOrderWeek(weekStart);
  const wEnd = normalizeOrderWeek(weekEnd || weekStart);
  const startYear = normalizeOrderYear(weekStart, orderYear || new Date().getFullYear().toString());
  const endYear = normalizeOrderYear(weekEnd || weekStart, startYear);
  const yws = buildOrderYearWeek(startYear, weekStartNorm);
  const ywe = buildOrderYearWeek(endYear, wEnd);

  // Step A: 차수 범위의 WarehouseMaster 조회 (운송사 행 포함 — AWB 그룹화에 필요)
  const wmRes = await query(
    `SELECT WarehouseKey, OrderNo,
            ISNULL(GrossWeight,0)        AS GrossWeight,
            ISNULL(ChargeableWeight,0)   AS ChargeableWeight,
            ISNULL(FreightRateUSD,0)     AS FreightRateUSD,
            ISNULL(DocFeeUSD,0)          AS DocFeeUSD,
            FarmName, OrderYear, OrderWeek
     FROM WarehouseMaster
     WHERE (OrderYear + REPLACE(OrderWeek,'-','')) >= @yws
       AND (OrderYear + REPLACE(OrderWeek,'-','')) <= @ywe
       AND isDeleted = 0`,
    {
      yws: { type: sql.NVarChar, value: yws },
      ywe: { type: sql.NVarChar, value: ywe },
    }
  );
  const mastersAll = wmRes.recordset;
  if (mastersAll.length === 0) return {};

  const allWkIds = mastersAll.map(m => m.WarehouseKey);

  // Step B: WarehouseDetail (품목행 + 특수행 모두)
  // 한 번에 조회하되 큰 범위라면 IN 절이 길어질 수 있음 — 운영상 차수당 WarehouseKey 수십 건 수준으로 안전.
  const wkCSV = allWkIds.join(',');
  const [dRes, fRes, fcRes, curRes] = await Promise.all([
    query(
      `SELECT wd.WarehouseKey, wd.WdetailKey, wd.ProdKey,
              wd.BoxQuantity, wd.BunchQuantity, wd.SteamQuantity,
              ISNULL(wd.OutQuantity,0) AS OutQuantity,
              wd.UPrice, wd.TPrice,
              wm.FarmName,
              p.ProdName, p.FlowerName, p.CounName, p.SteamOf1Bunch, p.Cost, p.OutUnit,
              p.BoxWeight AS P_BoxWeight, p.BoxCBM AS P_BoxCBM, p.TariffRate AS P_TariffRate
       FROM WarehouseDetail wd
       INNER JOIN WarehouseMaster wm ON wd.WarehouseKey = wm.WarehouseKey
       LEFT  JOIN Product p ON wd.ProdKey = p.ProdKey
       WHERE wd.WarehouseKey IN (${wkCSV})
       ORDER BY wm.FarmName, wd.WdetailKey`
    ),
    query(`SELECT FlowerName, BoxWeight, BoxCBM, StemsPerBox, DefaultTariff FROM Flower WHERE isDeleted=0`),
    // FreightCost 스냅샷 — 해당 WarehouseKey 들 중 isDeleted=0 인 것 전부 (최신 1건씩 필요)
    query(
      `SELECT fc.FreightKey, fc.WarehouseKey, fc.ExchangeRate,
              fc.GrossWeight, fc.ChargeableWeight, fc.FreightRateUSD, fc.DocFeeUSD, fc.InvoiceTotalUSD,
              fc.WeightBasis,
              fc.BakSangRate, fc.HandlingFee, fc.QuarantinePerItem, fc.DomesticFreight, fc.DeductFee, fc.ExtraFee
       FROM FreightCost fc
       WHERE fc.WarehouseKey IN (${wkCSV}) AND fc.isDeleted=0`
    ),
    query(`SELECT CurrencyCode, ExchangeRate FROM CurrencyMaster WHERE IsActive=1`),
  ]);

  // FreightKey → FreightCostDetail 조회 (스냅샷 있는 것만)
  const freightKeys = fcRes.recordset.map(r => r.FreightKey);
  let snapshotDetailMap = {}; // freightKey → [FreightCostDetail rows]
  if (freightKeys.length > 0) {
    const fkCSV = freightKeys.join(',');
    const fdRes = await query(
      `SELECT FreightKey, ProdKey, ArrivalPerStem, ArrivalPerBunch, StemsPerBunch
       FROM FreightCostDetail
       WHERE FreightKey IN (${fkCSV})`
    );
    for (const r of fdRes.recordset) {
      if (!snapshotDetailMap[r.FreightKey]) snapshotDetailMap[r.FreightKey] = [];
      snapshotDetailMap[r.FreightKey].push(r);
    }
  }

  // WarehouseKey → 최신 FreightCost 스냅샷 맵 (최신 1건: CreateDtm 은 SELECT 에 없으므로 FreightKey DESC 기준)
  const fcByWk = new Map(); // warehouseKey → FreightCost row
  for (const fc of fcRes.recordset.sort((a, b) => b.FreightKey - a.FreightKey)) {
    if (!fcByWk.has(fc.WarehouseKey)) fcByWk.set(fc.WarehouseKey, fc);
  }

  // 통화 환율 맵
  const currencyRates = { KRW: 1 };
  for (const c of curRes.recordset) currencyRates[c.CurrencyCode] = Number(c.ExchangeRate) || 0;

  // Flower 기본값 맵
  const flowerMeta = {};
  for (const f of fRes.recordset) {
    flowerMeta[normalizeFlower(f.FlowerName)] = {
      boxWeight: f.BoxWeight != null ? Number(f.BoxWeight) : null,
      boxCBM: f.BoxCBM != null ? Number(f.BoxCBM) : null,
      stemsPerBox: f.StemsPerBox != null ? Number(f.StemsPerBox) : null,
      defaultTariff: f.DefaultTariff != null ? Number(f.DefaultTariff) : null,
    };
  }

  // 카테고리 오버라이드 (웹 전용)
  let catOverrides = {};
  try { catOverrides = loadOverrides(true); } catch (_) { /* 파일 없으면 무시 */ }

  // AWB 정규화 — 대시/공백 제거
  const normalizeAWB = (s) => (s || '').replace(/[-\s]/g, '').trim();

  // AWB 기준으로 WarehouseKey 그룹화 — loadFreightData 와 동일 패턴
  const awbGroupMap = new Map(); // normAWB → WarehouseKey[]
  for (const m of mastersAll) {
    const k = normalizeAWB(m.OrderNo) || `WK:${m.WarehouseKey}`;
    if (!awbGroupMap.has(k)) awbGroupMap.set(k, []);
    awbGroupMap.get(k).push(m.WarehouseKey);
  }

  // 모든 레코드 (prodKey, inQty, displayArrivalKRW, ...) 를 수집
  const allRecords = [];

  for (const [, wkIds] of awbGroupMap) {
    const records = _computeArrivalForAwbGroup(
      wkIds, mastersAll, dRes.recordset, flowerMeta, catOverrides, currencyRates, fcByWk, snapshotDetailMap
    );
    for (const rec of records) allRecords.push(rec);
  }

  return aggregateArrivalCosts(allRecords);
}

// ──────────────────────────────────────────────────────────────────────────────
// 내부 헬퍼 — AWB 그룹 1개에 대해 품목별 (prodKey, inQty, displayArrivalKRW) 레코드 반환
// loadFreightData 와 동일한 파이프라인을 재현. 리턴값은 aggregateArrivalCosts 용 레코드 배열.
// ──────────────────────────────────────────────────────────────────────────────
function _computeArrivalForAwbGroup(
  wkIds, mastersAll, allDetailsAll,
  flowerMeta, catOverrides, currencyRates, fcByWk, snapshotDetailMap
) {
  const keySet = new Set(wkIds.map(Number));

  const mastersInGroup  = mastersAll.filter(m => keySet.has(m.WarehouseKey));
  const freightMasters  = mastersInGroup.filter(m => isFreightForwarder(m.FarmName));
  const flowerMasters   = mastersInGroup.filter(m => !isFreightForwarder(m.FarmName));
  const masters         = flowerMasters.length > 0 ? flowerMasters : mastersInGroup;
  const primaryKey      = Math.min(...masters.map(m => m.WarehouseKey));

  const allRows = allDetailsAll.filter(r => keySet.has(r.WarehouseKey));
  const freightRows = allRows.filter(r => isFreightRow(r));
  const rows = allRows.filter(r => !isFreightRow(r));
  if (rows.length === 0) return [];

  // 항공료 추출 (loadFreightData 와 동일)
  const actualFreightUSD = freightRows.reduce((a, r) => a + (Number(r.TPrice) || 0), 0);
  const freightMainRow = freightRows.find(r => Number(r.UPrice) > 0);
  const isRatePattern = freightMainRow && (Number(freightMainRow.BunchQuantity) || 0) > 1;
  const extractedGW   = isRatePattern ? (Number(freightMainRow.BunchQuantity) || 0) : 0;
  const extractedRate  = isRatePattern ? (Number(freightMainRow.UPrice) || 0) : 0;
  const freightDocRows = freightRows.filter(r => (Number(r.UPrice) || 0) === 0 && Number(r.TPrice) > 0);
  const extractedDoc   = freightDocRows.reduce((a, r) => a + (Number(r.TPrice) || 0), 0);

  const gwRows = freightRows.filter(r => isGrossWeightItem(r.ProdName));
  const cwRows = freightRows.filter(r => isChargeableWeightItem(r.ProdName));
  const extractedGwFromRow = gwRows.reduce((a, r) => a + freightWeightOfRow(r), 0);
  const extractedCwFromRow = cwRows.reduce((a, r) => a + freightWeightOfRow(r), 0);

  // FreightCost 스냅샷 (primary key 기준)
  const snap = fcByWk.get(primaryKey) || null;

  // 통화 + 환율
  const invoiceCurrency = detectInvoiceCurrency(rows.map(r => ({ counName: r.CounName })));
  const suggestedExchangeRate = currencyRates[invoiceCurrency] || 0;

  // 카테고리 오버라이드 적용
  for (const r of rows) {
    const ov = r.ProdKey ? catOverrides[r.ProdKey] : null;
    if (ov && ov.category) r.FlowerName = ov.category;
  }

  // distinct FlowerName count (검역수수료 계산용)
  const itemCount = [...new Set(rows.map(r => (r.FlowerName || '').trim()))].filter(Boolean).length;

  // 카테고리별 박스수
  const boxByFlower = new Map();
  for (const r of rows) {
    const fn = (r.FlowerName || '').trim();
    boxByFlower.set(fn, (boxByFlower.get(fn) || 0) + (Number(r.BoxQuantity) || 0));
  }

  // steamQty resolve (loadFreightData.resolveSteamQty 와 동일)
  const resolveSteamQty = (r) => {
    const sq = Number(r.SteamQuantity) || 0;
    if (sq > 0) return sq;
    const spb = Number(r.SteamOf1Bunch) || 0;
    const bq = Number(r.BunchQuantity) || 0;
    if (bq > 0 && spb > 0) return bq * spb;
    const boxQ = Number(r.BoxQuantity) || 0;
    const fm = flowerMeta[normalizeFlower(r.FlowerName || '')];
    const stemsPerBox = Number(fm?.stemsPerBox) || 0;
    if (boxQ > 0 && stemsPerBox > 0) return boxQ * stemsPerBox;
    return 0;
  };

  // productMeta 빌드
  const productMeta = {};
  for (const r of rows) {
    if (r.P_BoxWeight != null || r.P_BoxCBM != null || r.P_TariffRate != null) {
      productMeta[r.ProdKey] = {
        boxWeight: r.P_BoxWeight != null ? Number(r.P_BoxWeight) : null,
        boxCBM: r.P_BoxCBM != null ? Number(r.P_BoxCBM) : null,
        tariffRate: r.P_TariffRate != null ? Number(r.P_TariffRate) : null,
      };
    }
  }

  // details 빌드 (loadFreightData 와 동일)
  const flowerSeen = new Set();
  const snapshotDetails = snap ? (snapshotDetailMap[snap.FreightKey] || []) : [];
  const details = rows.map(r => {
    const fn = (r.FlowerName || '').trim();
    const isFirst = !flowerSeen.has(fn);
    if (isFirst) flowerSeen.add(fn);
    const boxQty = isFirst ? (boxByFlower.get(fn) || 0) : 0;
    const snapRow = snap ? snapshotDetails.find(s => s.ProdKey === r.ProdKey) : null;
    return {
      warehouseDetailKey: r.WdetailKey,
      prodKey: r.ProdKey,
      prodName: r.ProdName,
      flowerName: fn,
      counName: r.CounName || null,
      farmName: r.FarmName || null,
      outUnit: (r.OutUnit || '').trim() || null,
      boxQty,
      rawBoxQty: Number(r.BoxQuantity) || 0,
      bunchQty: Number(r.BunchQuantity) || 0,
      steamQty: resolveSteamQty(r),
      fobUSD: Number(r.UPrice) || 0,
      totalPriceUSD: Number(r.TPrice) || 0,
      stemsPerBunch: snapRow?.StemsPerBunch != null ? Number(snapRow.StemsPerBunch) : (Number(r.SteamOf1Bunch) || 0),
      salePriceKRW: Number(r.Cost) || 0,
      tariffRate: r.P_TariffRate != null ? Number(r.P_TariffRate) : null,
    };
  });

  // liveMaster 빌드 (loadFreightData 와 동일)
  const sumField = (arr, field) => {
    const vals = arr.map(x => Number(x[field])).filter(v => !Number.isNaN(v) && v !== 0);
    return vals.length === 0 ? null : vals.reduce((a, b) => a + b, 0);
  };
  const firstNonNullField = (arr, field) => {
    for (const x of arr) if (x[field] != null && Number(x[field]) !== 0) return Number(x[field]);
    return null;
  };
  const invoiceUSD = rows.reduce((a, r) => a + (Number(r.TPrice) || 0), 0);
  const liveMaster = {
    warehouseKey: primaryKey,
    gw: snap?.GrossWeight ?? (extractedGwFromRow > 1 ? extractedGwFromRow : null) ?? sumField(masters, 'GrossWeight') ?? (extractedGW > 0 ? extractedGW : 0),
    cw: snap?.ChargeableWeight ?? (extractedCwFromRow > 1 ? extractedCwFromRow : null) ?? sumField(masters, 'ChargeableWeight') ?? (extractedGW > 0 ? extractedGW : 0),
    rateUSD: snap?.FreightRateUSD ?? firstNonNullField(masters, 'FreightRateUSD') ?? (extractedRate > 0 ? extractedRate : 0),
    docFeeUSD: snap?.DocFeeUSD ?? firstNonNullField(masters, 'DocFeeUSD') ?? (extractedDoc > 0 ? extractedDoc : 0),
    exchangeRate: (snap?.ExchangeRate > 0 ? snap.ExchangeRate : suggestedExchangeRate) || 0,
    invoiceUSD: snap?.InvoiceTotalUSD ?? invoiceUSD,
    itemCount,
    actualFreightUSD: actualFreightUSD > 0 ? actualFreightUSD : null,
  };
  const customs = snap ? {
    bakSangRate: Number(snap.BakSangRate) || DEFAULT_CUSTOMS.bakSangRate,
    handlingFee: Number(snap.HandlingFee) || DEFAULT_CUSTOMS.handlingFee,
    quarantinePerItem: Number(snap.QuarantinePerItem) || DEFAULT_CUSTOMS.quarantinePerItem,
    domesticFreight: Number(snap.DomesticFreight) || DEFAULT_CUSTOMS.domesticFreight,
    deductFee: Number(snap.DeductFee) || DEFAULT_CUSTOMS.deductFee,
    extraFee: Number(snap.ExtraFee) || DEFAULT_CUSTOMS.extraFee,
  } : { ...DEFAULT_CUSTOMS };
  const basis = snap?.WeightBasis || 'AUTO';

  // ── snapshot-vs-live 결정 ──────────────────────────────────────────────────
  //
  // 스냅샷 존재 + displayUnit 이 '단'/'송이' → 스냅샷에서 ArrivalPerBunch/ArrivalPerStem 읽기
  // 스냅샷 없음 OR 어떤 행이라도 displayUnit='박스' → LIVE computeFreightCost 호출
  //
  // 박스 품목 여부 판정: Product.OutUnit 의 과반수가 '박스' 이거나
  // 카테고리 국가가 콜롬비아(국가 미지정 포함)이면 '박스' 로 취급.
  //
  // 안전하게 처리하기 위해: 스냅샷이 있는 경우에도
  //   "전체 품목 중 하나라도 박스 단위가 있으면" LIVE 계산으로 전체를 대체.
  // 이유: 동일 AWB 에 박스/단 혼재하면 스냅샷 일부 + live 일부 섞는 것보다 일관된 LIVE 가 낫다.
  //
  // 결론: snap 없거나 + 그룹에 '박스' OutUnit 품목이 있으면 → 항상 LIVE.

  const hasBoxUnit = rows.some(r => (r.OutUnit || '').trim() === '박스');
  const useSnapshotPath = snap != null && !hasBoxUnit;

  if (useSnapshotPath) {
    // 스냅샷 경로: ArrivalPerBunch(단), ArrivalPerStem(송이) → displayUnit 선택
    const out = [];
    for (const r of rows) {
      const inQty = Number(r.OutQuantity) || 0;
      if (!(inQty > 0)) continue;
      const sdRow = snapshotDetails.find(s => s.ProdKey === r.ProdKey);
      if (!sdRow) continue; // 스냅샷에 없으면 이 품목은 스킵 (aggregateArrivalCosts 에서 live 쪽 결과로 덮여질 수도 있지만 여기선 skip)

      const outUnit = (r.OutUnit || '').trim();
      // displayUnit 결정 — Product.OutUnit 기준 (박스는 이미 필터됨)
      const displayUnit = outUnit === '송이' ? '송이' : '단';
      const displayArrivalKRW = displayUnit === '송이'
        ? (Number(sdRow.ArrivalPerStem) || 0)
        : (Number(sdRow.ArrivalPerBunch) || 0);

      out.push({
        prodKey: r.ProdKey,
        inQty,
        displayArrivalKRW,
        arrivalPerStem: Number(sdRow.ArrivalPerStem) || 0,
        arrivalPerBunch: sdRow.ArrivalPerBunch != null ? Number(sdRow.ArrivalPerBunch) : null,
        displayUnit,
        source: 'snapshot',
      });
    }
    return out;
  }

  // LIVE 경로: computeFreightCost 전체 실행
  let calcResult;
  try {
    calcResult = computeFreightCost({
      master: liveMaster,
      basis,
      customs,
      details,
      productMeta,
      flowerMeta,
    });
  } catch (_) {
    return []; // 계산 실패 시 빈 배열 → arrivalCost=0 으로 처리됨
  }

  const out = [];
  for (const row of calcResult.rows) {
    const whRow = rows.find(r => r.ProdKey === row.prodKey);
    const inQty = whRow ? (Number(whRow.OutQuantity) || 0) : 0;
    if (!(inQty > 0)) continue;
    out.push({
      prodKey: row.prodKey,
      inQty,
      displayArrivalKRW: Number(row.displayArrivalKRW) || 0,
      arrivalPerStem: Number(row.arrivalPerStem) || 0,
      arrivalPerBunch: row.arrivalPerBunch != null ? Number(row.arrivalPerBunch) : null,
      displayUnit: row.displayUnit || '단',
      source: 'live',
    });
  }
  return out;
}
