// Pivot 통계 CSV 엑셀 — 화면과 동일한 컬럼·수량 필터 (순수함수)

import { sumIncomingQty, sumMapQty, sumOrderQty } from './pivotVolumeRows.js';

export { sumOrderQty, sumIncomingQty, sumMapQty };

export function lineDistAmt(qty, unit) {
  const q = Number(qty || 0);
  const u = Number(unit || 0);
  return q > 0 && u > 0 ? q * u : 0;
}

export function rowDistAmtSum(r, mapKey = 'orders') {
  const qm = mapKey === 'outOrders' ? (r?.outOrders || {}) : (r?.orders || {});
  const dc = r?.distCostOrders || {};
  let sum = 0;
  for (const c of Object.keys(qm)) sum += lineDistAmt(qm[c], dc[c]);
  return sum;
}

export function rowDistCostAvg(r) {
  const dc = r?.distCostOrders || {};
  const ord = r?.orders || {};
  let num = 0; let den = 0;
  for (const c of Object.keys(dc)) {
    const cost = Number(dc[c] || 0);
    if (!(cost > 0)) continue;
    const q = Number(ord[c] || 0) || 1;
    num += q * cost; den += q;
  }
  return den > 0 ? num / den : 0;
}

/** 주문·입고·출고 등 입력 수량이 하나라도 있는 행 */
export function rowHasPivotQty(row) {
  if (!row) return false;
  if (sumOrderQty(row) > 0) return true;
  if (sumIncomingQty(row) > 0) return true;
  if (Number(row.confirmedOut || 0) > 0) return true;
  if (sumMapQty(row.outOrders) > 0) return true;
  return false;
}

/**
 * 화면에 보이는 컬럼과 동일한 export 컬럼 정의
 * @returns {{ header: string, value: (row)=>*, total?: (rows)=>* }[]}
 */
export function buildPivotExportColumns({
  showArea, showOutDate, showInPrice, showInTotal, showArrival, showAWB, showDescr, showAmount,
  showQty, showCost, showDistCost,
  showSections,
  compact,
  showOrderCustCols, showOutCustCols, showIncomingFarmCols, showIncomingCompactTotal,
  sortedCusts, farms,
}) {
  const cols = [
    { header: '국가', value: r => r.country || '' },
    { header: '꽃', value: r => r.flower || '' },
    { header: '품목명', value: r => r.prodName || '' },
  ];
  const add = (header, value, total) => cols.push({ header, value, total });

  if (showArea) add('지역', r => r.area || '');
  if (showOutDate) add('출고일', r => r.outDate || '');
  if (showInPrice) add('입고단가', r => Number(r.inPrice || 0));
  if (showInTotal) add('입고총단가', r => Number(r.inTotal || 0));
  if (showArrival) add('도착원가', r => Number(r.arrivalCost || 0));
  if (showAWB) add('AWB', r => r.awb || '');
  if (showAmount) add('판매금액', r => Number(r.cost || 0) * sumOrderQty(r));
  if (showDescr) add('비고', r => r.descr || '');

  if (showSections?.prev) {
    add('01.전재고', r => Number(r.prevStock || 0), rows => rows.reduce((s, r) => s + Number(r.prevStock || 0), 0));
  }

  if (showOrderCustCols) {
    for (const c of sortedCusts) {
      if (showQty) add(`${c.custName}_수량`, r => Number(r.orders?.[c.custName] || 0));
      if (showCost) add(`${c.custName}_판매단가`, r => Number(r.costOrders?.[c.custName] || 0));
      if (showDistCost) {
        add(`${c.custName}_분배단가`, r => Number(r.distCostOrders?.[c.custName] || 0));
        add(`${c.custName}_분배금액`, r => lineDistAmt(r.orders?.[c.custName], r.distCostOrders?.[c.custName]));
      }
    }
  }

  if (showSections?.order) {
    if (showQty) add(compact ? '02.주문_수량' : '02.주문Total_수량', r => sumOrderQty(r));
    if (showDistCost) {
      add(compact ? '02.주문_분배금액' : '02.주문Total_분배금액', r => rowDistAmtSum(r, 'orders'));
      if (compact) add('02.주문_분배단가', r => rowDistCostAvg(r));
    }
  }

  if (showIncomingFarmCols) {
    for (const f of farms) {
      add(`입고_${f}`, r => Number(r.incoming?.[f] || 0));
    }
  }
  if (showIncomingCompactTotal) {
    add('03.입고', r => sumIncomingQty(r));
  }

  if (showOutCustCols) {
    for (const c of sortedCusts) {
      if (showQty) add(`출고_${c.custName}_수량`, r => Number(r.outOrders?.[c.custName] || 0));
      if (showDistCost) {
        add(`출고_${c.custName}_분배금액`, r => lineDistAmt(r.outOrders?.[c.custName], r.distCostOrders?.[c.custName]));
      }
    }
  }

  if (showSections?.out) {
    if (showQty) add('04.출고_수량', r => Number(r.confirmedOut || 0));
    if (showDistCost && !showOutCustCols) {
      add('04.출고_분배금액', r => rowDistAmtSum(r, 'outOrders'));
    }
    if (showDistCost && !showOutCustCols && compact) add('04.출고_분배단가', r => rowDistCostAvg(r));
  }

  if (showSections?.none) add('03.미발주', r => Number(r.noneOut || 0));
  if (showSections?.cur) add('05.현재고', r => Number(r.curStock || 0));

  // total 함수 기본: 숫자 합
  cols.forEach(col => {
    if (col.total) return;
    col.total = rows => rows.reduce((s, r) => {
      const v = col.value(r);
      return s + (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    }, 0);
  });

  return cols;
}

export function rowsToCsvAoA(columns, dataRows, { includeTotal = true } = {}) {
  const aoa = [columns.map(c => c.header)];
  for (const r of dataRows) {
    aoa.push(columns.map(c => c.value(r)));
  }
  if (includeTotal && dataRows.length > 0) {
    aoa.push(columns.map(c => c.total(dataRows)));
  }
  return aoa;
}
