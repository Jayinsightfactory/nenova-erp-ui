// Pivot 통계 CSV 엑셀 — 화면과 동일한 컬럼·수량 필터 (순수함수)

import { sumIncomingQty, sumMapQty, sumOrderQty } from './pivotVolumeRows.js';
import { arrivalCostWithVat } from './pivotArrivalCalc.js';

export { sumOrderQty, sumIncomingQty, sumMapQty };

export function lineDistAmt(qty, unit) {
  const q = Number(qty || 0);
  const u = Number(unit || 0);
  return q > 0 && u > 0 ? q * u : 0;
}

export function rowDistAmtSum(r, mapKey = 'orders', custNames = null) {
  const qm = mapKey === 'outOrders' ? (r?.outOrders || {}) : (r?.orders || {});
  const dc = r?.distCostOrders || {};
  const keys = custNames?.length ? custNames : Object.keys(qm);
  let sum = 0;
  for (const c of keys) sum += lineDistAmt(qm[c], dc[c]);
  return sum;
}

export function rowOrderTotalForCusts(r, custNames) {
  if (!custNames?.length) return sumOrderQty(r);
  return custNames.reduce((s, n) => s + Number(r.orders?.[n] || 0), 0);
}

export function rowOutTotalForCusts(r, custNames) {
  if (!custNames?.length) return Number(r.confirmedOut || 0);
  return custNames.reduce((s, n) => s + Number(r.outOrders?.[n] || 0), 0);
}

export function rowDistCostAvg(r, mapKey = 'orders', custNames = null) {
  const qm = mapKey === 'outOrders' ? (r?.outOrders || {}) : (r?.orders || {});
  const dc = r?.distCostOrders || {};
  const keys = custNames?.length ? custNames : Object.keys(dc);
  let num = 0; let den = 0;
  for (const c of keys) {
    const cost = Number(dc[c] || 0);
    if (!(cost > 0)) continue;
    const q = Number(qm[c] || 0) || 1;
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

const EMPTY_WEEK_ROW = {
  prevStock: 0, totalOrder: 0, totalIncoming: 0, confirmedOut: 0, noneOut: 0, curStock: 0,
  orders: {}, outOrders: {}, incoming: {}, distCostOrders: {}, costOrders: {},
  inPrice: 0, inTotal: 0, awb: '', outDate: '', arrivalCost: 0,
};

/** byWeek API 응답에서 차수별 행 조회 */
export function getPivotWeekRow(baseRow, week, byWeek) {
  if (!week || !byWeek) return baseRow;
  const wr = byWeek[week]?.rows?.find(r => r.prodKey === baseRow.prodKey);
  if (wr) return wr;
  return { ...baseRow, ...EMPTY_WEEK_ROW, prodKey: baseRow.prodKey };
}

/** 표시 중인 차수 중 하나라도 수량이 있는 행만 (0 품목 제외) */
export function rowHasPivotQtyInWeeks(baseRow, weeks, byWeek) {
  if (!weeks?.length || weeks.length <= 1) return rowHasPivotQty(baseRow);
  return weeks.some(w => rowHasPivotQty(getPivotWeekRow(baseRow, w, byWeek)));
}

/** CSV 셀 — 0 은 빈칸 */
export function formatExportCell(v) {
  if (typeof v === 'number' && Number.isFinite(v) && v === 0) return '';
  return v ?? '';
}

function weightedDistAvg(rows, qtyFn, distFn) {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    const q = Number(qtyFn(r) || 0);
    const d = Number(distFn(r) || 0);
    if (q > 0 && d > 0) { num += q * d; den += q; }
  }
  return den > 0 ? num / den : 0;
}

/** export 에 포함된 구분·거래처 열 기준으로 수량 있는 행만 */
export function rowMatchesExportFilter(baseRow, opts) {
  const {
    weeks, byWeek,
    showSections = {},
    showOrderCustCols, showOutCustCols,
    showIncomingFarmCols, showIncomingCompactTotal,
    sortedCusts = [], farms = [],
  } = opts;
  const custNames = sortedCusts.map(c => c.custName);

  const hasQty = (r) => {
    if (!r) return false;
    if (showSections.prev && Number(r.prevStock || 0) > 0) return true;
    if (showOrderCustCols && custNames.some(n => Number(r.orders?.[n] || 0) > 0)) return true;
    if (showSections.order && rowOrderTotalForCusts(r, custNames) > 0) return true;
    if (showIncomingFarmCols && farms.some(f => Number(r.incoming?.[f] || 0) > 0)) return true;
    if (showIncomingCompactTotal && sumIncomingQty(r) > 0) return true;
    if (showOutCustCols && custNames.some(n => Number(r.outOrders?.[n] || 0) > 0)) return true;
    if (showSections.out && rowOutTotalForCusts(r, custNames) > 0) return true;
    if (showSections.none && Number(r.noneOut || 0) > 0) return true;
    if (showSections.cur && Number(r.curStock || 0) !== 0) return true;
    return false;
  };

  if (weeks?.length > 1) {
    return weeks.some(w => hasQty(getPivotWeekRow(baseRow, w, byWeek)));
  }
  return hasQty(baseRow);
}

/**
 * 화면에 보이는 컬럼과 동일한 export 컬럼 정의
 * @returns {{ header: string, value: (row)=>*, total?: (rows)=>* }[]}
 */
export function buildPivotExportColumns({
  showArea, showOutDate, showInPrice, showInTotal, showArrival, showArrivalVat, showAWB, showDescr, showAmount,
  showQty, showCost, showDistCost,
  showSections,
  compact,
  showOrderCustCols, showOutCustCols, showIncomingFarmCols, showIncomingCompactTotal,
  sortedCusts, farms,
  columnPrefix = '',
  resolveRow = r => r,
  measuresOnly = false,
}) {
  const cols = [];
  const custNames = sortedCusts.map(c => c.custName);
  const scopeCustTotals = custNames.length > 0;

  const addScalar = (header, value, total) => {
    cols.push({
      header: `${columnPrefix}${header}`,
      value: (r) => value(resolveRow(r)),
      total: total ? (rows) => total(rows.map(resolveRow)) : undefined,
    });
  };

  /** 값측정 — 엑셀 합산용으로 수량·단가·금액을 각각 별도 열 */
  const addMeasureCols = (baseHeader, { qty, sale, dist, amt }, { qtyTotal, amtTotal, distTotal }, opts = {}) => {
    const { includeSale = true, includeDistUnit = true } = opts;
    if (showQty) {
      addScalar(`${baseHeader}_수량`, qty, qtyTotal);
    }
    if (showCost && includeSale) {
      addScalar(`${baseHeader}_판매단가`, sale);
    }
    if (showDistCost) {
      if (includeDistUnit) {
        addScalar(`${baseHeader}_분배단가`, dist, distTotal);
      }
      addScalar(`${baseHeader}_분배금액`, amt, amtTotal);
    }
  };

  if (!measuresOnly) {
    cols.push(
      { header: '국가', value: r => r.country || '' },
      { header: '꽃', value: r => r.flower || '' },
      { header: '품목명', value: r => r.prodName || '' },
    );
    if (showArea) cols.push({ header: '지역', value: r => r.area || '' });
    if (showOutDate) cols.push({ header: '출고일', value: r => r.outDate || '' });
    if (showInPrice) cols.push({ header: '입고단가', value: r => Number(r.inPrice || 0) });
    if (showInTotal) cols.push({ header: '입고총단가', value: r => Number(r.inTotal || 0) });
    if (showArrival) cols.push({ header: '도착원가', value: r => Number(r.arrivalCost || 0) });
    if (showArrivalVat) cols.push({ header: '도착원가(부가세포)', value: r => arrivalCostWithVat(r.arrivalCost) });
    if (showAWB) cols.push({ header: 'AWB', value: r => r.awb || '' });
    if (showAmount) cols.push({ header: '판매금액', value: r => Number(r.cost || 0) * sumOrderQty(r) });
    if (showDescr) cols.push({ header: '비고', value: r => r.descr || '' });
  }

  if (showSections?.prev) {
    addScalar('01.전재고', r => Number(r.prevStock || 0), rows => rows.reduce((s, r) => s + Number(r.prevStock || 0), 0));
  }

  if (showOrderCustCols) {
    for (const c of sortedCusts) {
      const cn = c.custName;
      addMeasureCols(
        cn,
        {
          qty: r => Number(r.orders?.[cn] || 0),
          sale: r => Number(r.costOrders?.[cn] || 0),
          dist: r => Number(r.distCostOrders?.[cn] || 0),
          amt: r => lineDistAmt(r.orders?.[cn], r.distCostOrders?.[cn]),
        },
        {
          qtyTotal: rows => rows.reduce((s, r) => s + Number(r.orders?.[cn] || 0), 0),
          amtTotal: rows => rows.reduce((s, r) => s + lineDistAmt(r.orders?.[cn], r.distCostOrders?.[cn]), 0),
        },
      );
    }
  }

  if (showSections?.order) {
    const orderHeader = compact ? '02.주문' : '02.주문Total';
    const orderQty = r => (scopeCustTotals ? rowOrderTotalForCusts(r, custNames) : sumOrderQty(r));
    const orderAmt = r => (scopeCustTotals ? rowDistAmtSum(r, 'orders', custNames) : rowDistAmtSum(r, 'orders'));
    addMeasureCols(
      orderHeader,
      {
        qty: orderQty,
        sale: () => 0,
        dist: r => rowDistCostAvg(r, 'orders', scopeCustTotals ? custNames : null),
        amt: orderAmt,
      },
      {
        qtyTotal: rows => rows.reduce((s, r) => s + orderQty(r), 0),
        amtTotal: rows => rows.reduce((s, r) => s + orderAmt(r), 0),
        distTotal: rows => weightedDistAvg(
          rows,
          orderQty,
          r => rowDistCostAvg(r, 'orders', scopeCustTotals ? custNames : null),
        ),
      },
      { includeSale: false },
    );
  }

  if (showIncomingFarmCols) {
    for (const f of farms) {
      addScalar(`입고_${f}`, r => Number(r.incoming?.[f] || 0));
    }
  }
  if (showIncomingCompactTotal) {
    addScalar('03.입고', r => sumIncomingQty(r));
  }

  if (showOutCustCols) {
    for (const c of sortedCusts) {
      const cn = c.custName;
      addMeasureCols(
        `출고_${cn}`,
        {
          qty: r => Number(r.outOrders?.[cn] || 0),
          sale: r => Number(r.costOrders?.[cn] || 0),
          dist: r => Number(r.distCostOrders?.[cn] || 0),
          amt: r => lineDistAmt(r.outOrders?.[cn], r.distCostOrders?.[cn]),
        },
        {
          qtyTotal: rows => rows.reduce((s, r) => s + Number(r.outOrders?.[cn] || 0), 0),
          amtTotal: rows => rows.reduce((s, r) => s + lineDistAmt(r.outOrders?.[cn], r.distCostOrders?.[cn]), 0),
        },
      );
    }
  }

  if (showSections?.out) {
    const outHeader = showOutCustCols ? '04.출고Total' : '04.출고';
    const outQty = r => (scopeCustTotals ? rowOutTotalForCusts(r, custNames) : Number(r.confirmedOut || 0));
    const outAmt = r => (scopeCustTotals ? rowDistAmtSum(r, 'outOrders', custNames) : rowDistAmtSum(r, 'outOrders'));
    addMeasureCols(
      outHeader,
      {
        qty: outQty,
        sale: () => 0,
        dist: r => rowDistCostAvg(r, 'outOrders', scopeCustTotals ? custNames : null),
        amt: outAmt,
      },
      {
        qtyTotal: rows => rows.reduce((s, r) => s + outQty(r), 0),
        amtTotal: rows => rows.reduce((s, r) => s + outAmt(r), 0),
        distTotal: rows => weightedDistAvg(
          rows,
          outQty,
          r => rowDistCostAvg(r, 'outOrders', scopeCustTotals ? custNames : null),
        ),
      },
      { includeSale: false, includeDistUnit: !showOutCustCols },
    );
  }

  if (showSections?.none) addScalar('03.미발주', r => Number(r.noneOut || 0));
  if (showSections?.cur) addScalar('05.현재고', r => Number(r.curStock || 0));

  cols.forEach(col => {
    if (col.total) return;
    col.total = rows => rows.reduce((s, r) => {
      const v = col.value(r);
      return s + (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    }, 0);
  });

  return cols;
}

/** 단일 차수 또는 차수별 열 전개 — 피벗 UI 와 동일한 그리드 */
export function buildPivotExportGrid(opts) {
  const { weeks, byWeek, weekLabel = (w) => w } = opts;
  if (!weeks?.length || weeks.length <= 1) {
    return buildPivotExportColumns(opts);
  }

  const fixed = buildPivotExportColumns({
    ...opts,
    showSections: { prev: false, order: false, incoming: false, out: false, none: false, cur: false },
    showOrderCustCols: false,
    showOutCustCols: false,
    showIncomingFarmCols: false,
    showIncomingCompactTotal: false,
  });

  const weekCols = [];
  for (const week of weeks) {
    weekCols.push(...buildPivotExportColumns({
      ...opts,
      columnPrefix: `${weekLabel(week)}_`,
      resolveRow: (r) => getPivotWeekRow(r, week, byWeek),
      measuresOnly: true,
      showArea: false,
      showOutDate: false,
      showInPrice: false,
      showInTotal: false,
      showArrival: false,
      showArrivalVat: false,
      showAWB: false,
      showAmount: false,
      showDescr: false,
    }));
  }
  return [...fixed, ...weekCols];
}

export function rowsToCsvAoA(columns, dataRows, { includeTotal = true, blankZero = false } = {}) {
  const fmt = (v) => (blankZero ? formatExportCell(v) : (v ?? ''));
  const aoa = [columns.map(c => c.header)];
  for (const r of dataRows) {
    aoa.push(columns.map(c => fmt(c.value(r))));
  }
  if (includeTotal && dataRows.length > 0) {
    aoa.push(columns.map(c => (c.total ? fmt(c.total(dataRows)) : '')));
  }
  return aoa;
}
