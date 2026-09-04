// Read-only historical purchase-cost comparison for the Raum/Choimun P&L detail view.
// This module deliberately does not create/ensure tables and has no write path.
import { stripConsignedSuffix } from './raumPnlConsignedCost.js';

const normSpace = value => String(value == null ? '' : value).replace(/[\s\u00a0]+/g, ' ').trim();
const normUnit = value => normSpace(value).toLowerCase();
const normName = value => normSpace(value);

function positiveProdKey(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function raumPnlCostIdentity(item) {
  const prodKey = positiveProdKey(item?.prodKey ?? item?.ProdKey);
  const unit = normUnit(item?.unit ?? item?.Unit);
  const custom = item?.isCustom ?? item?.IsCustom;
  const customPart = custom ? 'custom' : 'ordinary';
  if (prodKey != null) return `prod:${prodKey}|unit:${unit}|${customPart}`;
  // ProdKey 없는 행은 사입 suffix를 제거한 이름으로 묶어 일반행과 (사입)행이 같은 공통단가 셀에서 보인다.
  const name = normName(stripConsignedSuffix(item?.name ?? item?.Name ?? item?.itemName ?? item?.ItemName));
  return name ? `name:${name}|unit:${unit}|${customPart}` : null;
}

const identity = raumPnlCostIdentity;

export function raumPnlCostSnapshot(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map(row => ({
      itemKey: Number(row?.itemKey ?? row?.ItemKey),
      costPrice: row?.costPrice ?? row?.CostPrice,
    }))
    .filter(row => Number.isInteger(row.itemKey) && row.itemKey > 0)
    .map(row => ({
      itemKey: row.itemKey,
      costPrice: row.costPrice == null || String(row.costPrice).trim() === '' ? null : Number(row.costPrice),
    }))
    .sort((a, b) => a.itemKey - b.itemKey);
}

export function sameRaumPnlCostSnapshot(left, right) {
  return JSON.stringify(raumPnlCostSnapshot(left)) === JSON.stringify(raumPnlCostSnapshot(right));
}

const SHARED_PARTNERS = ['raum', 'choimun'];

/** Shared-cost snapshot: every displayed Raum+Choimun matching row's partner+pnlKey+itemKey+old cost. */
export function raumPnlSharedCostSnapshot(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .map(row => ({
      partnerCode: String(row?.partnerCode ?? row?.PartnerCode ?? '').trim().toLowerCase(),
      pnlKey: Number(row?.pnlKey ?? row?.PnlKey),
      itemKey: Number(row?.itemKey ?? row?.ItemKey),
      costPrice: row?.costPrice ?? row?.CostPrice,
    }))
    .filter(row => SHARED_PARTNERS.includes(row.partnerCode) && Number.isInteger(row.pnlKey) && row.pnlKey > 0 && Number.isInteger(row.itemKey) && row.itemKey > 0)
    .map(row => ({
      partnerCode: row.partnerCode,
      pnlKey: row.pnlKey,
      itemKey: row.itemKey,
      costPrice: row.costPrice == null || String(row.costPrice).trim() === '' ? null : Number(row.costPrice),
    }))
    .sort((a, b) => a.partnerCode.localeCompare(b.partnerCode) || a.pnlKey - b.pnlKey || a.itemKey - b.itemKey);
}

export function sameRaumPnlSharedCostSnapshot(left, right) {
  return JSON.stringify(raumPnlSharedCostSnapshot(left)) === JSON.stringify(raumPnlSharedCostSnapshot(right));
}

/**
 * 공통 단가 입력이 현재 상태와 같은지 판정한다.
 * partial은 보이는 단가가 같아도 다른 파트너의 NULL을 채워야 하므로 항상 변경으로 본다.
 * mismatch의 빈 입력은 화면의 초기 표시이므로, 입력 후 다시 비우면 원래 상태로 되돌린다.
 */
export function isRaumPnlSharedDraftUnchanged(raw, cell = {}) {
  const text = String(raw ?? '').trim();
  const state = String(cell?.state || '');
  if (!text) return state === 'missing' || state === 'mismatch';
  if (state !== 'match' || !Array.isArray(cell?.values) || cell.values.length !== 1) return false;
  const number = Number(text.replace(/,/g, ''));
  return Number.isFinite(number) && number === Number(cell.values[0]);
}

function buildSharedPartnerDetail(rows) {
  if (!rows.length) return null;
  const salePrices = [...new Set(rows
    .map(row => row.salePrice ?? row.SalePrice)
    .filter(value => value != null && String(value).trim() !== '')
    .map(Number)
    .filter(Number.isFinite))].sort((a, b) => a - b);
  const costRows = rows.filter(row => {
    const cost = row.costPrice ?? row.CostPrice;
    return cost != null && String(cost).trim() !== '' && Number.isFinite(Number(cost));
  });
  const purchaseAmount = costRows.length
    ? costRows.reduce((sum, row) => sum + Number(row.costPrice ?? row.CostPrice) * Number(row.qty ?? row.Qty ?? 0), 0)
    : null;
  const saleAmountRows = rows.filter(row => {
    const amount = row.saleAmount ?? row.SaleAmount;
    return amount != null && String(amount).trim() !== '' && Number.isFinite(Number(amount));
  });
  const saleAmount = saleAmountRows.length
    ? saleAmountRows.reduce((sum, row) => sum + Number(row.saleAmount ?? row.SaleAmount), 0)
    : null;
  return {
    pnlKey: Number(rows[0].pnlKey ?? rows[0].PnlKey),
    salePrices,
    purchaseAmount,
    missingCostRows: rows.length - costRows.length,
    saleAmount,
    missingSaleAmountRows: rows.length - saleAmountRows.length,
    qty: rows.reduce((sum, row) => sum + Number(row.qty ?? row.Qty ?? 0), 0),
    rowCount: rows.length,
  };
}

/**
 * Build the combined Raum+Choimun product x major-week matrix for the shared purchase-cost
 * management screen. Columns are unique MajorWeek (desc); rows are shared product identity
 * (PartnerCode excluded); each cell carries the combined distinct cost values plus a
 * per-partner detail block (SalePrice/Qty/purchaseAmount/SaleAmount stay partner-separate).
 */
export function buildRaumPnlSharedPurchaseCostMatrix(rows = [], scope = {}) {
  const orderYear = String(scope.orderYear ?? '').trim();
  if (!/^\d{4}$/.test(orderYear)) return { weeks: [], items: [] };

  const scoped = (Array.isArray(rows) ? rows : []).filter(row =>
    String(row.orderYear ?? row.OrderYear ?? '').trim() === orderYear &&
    SHARED_PARTNERS.includes(String(row.partnerCode ?? row.PartnerCode ?? '').trim().toLowerCase()) &&
    Number(row.pnlKey ?? row.PnlKey) > 0 && Number(row.itemKey ?? row.ItemKey) > 0
  );

  const majorSet = new Set();
  const itemMap = new Map();
  for (const row of scoped) {
    const major = Number(row.major ?? row.MajorWeek);
    if (!Number.isInteger(major) || major <= 0) continue;
    majorSet.add(major);
    const itemIdentity = identity(row);
    if (!itemIdentity) continue;
    if (!itemMap.has(itemIdentity)) itemMap.set(itemIdentity, {
      identity: itemIdentity,
      name: String(row.name ?? row.Name ?? row.itemName ?? row.ItemName ?? ''),
      prodKey: positiveProdKey(row.prodKey ?? row.ProdKey),
      prodName: String(row.prodName ?? row.ProdName ?? ''),
      unit: normSpace(row.unit ?? row.Unit),
      isCustom: !!(row.isCustom ?? row.IsCustom),
      rowsByMajor: new Map(),
    });
    const item = itemMap.get(itemIdentity);
    if (!item.rowsByMajor.has(major)) item.rowsByMajor.set(major, []);
    item.rowsByMajor.get(major).push(row);
  }

  const weeks = [...majorSet].sort((a, b) => b - a).map(major => ({ key: String(major), major, label: `${major}차` }));
  const items = [...itemMap.values()].map(item => ({
    identity: item.identity,
    name: item.name,
    prodKey: item.prodKey,
    prodName: item.prodName,
    unit: item.unit,
    isCustom: item.isCustom,
    cells: weeks.map(week => {
      const cellRows = item.rowsByMajor.get(week.major) || [];
      if (!cellRows.length) return null;
      const values = [...new Set(cellRows
        .map(row => row.costPrice ?? row.CostPrice)
        .filter(value => value != null && String(value).trim() !== '')
        .map(Number)
        .filter(Number.isFinite))].sort((a, b) => a - b);
      const nullCount = cellRows.filter(row => {
        const cost = row.costPrice ?? row.CostPrice;
        return cost == null || String(cost).trim() === '';
      }).length;
      const state = values.length === 0 ? 'missing' : values.length > 1 ? 'mismatch' : nullCount > 0 ? 'partial' : 'match';
      const partners = {};
      for (const partnerCode of SHARED_PARTNERS) {
        partners[partnerCode] = buildSharedPartnerDetail(cellRows.filter(row =>
          String(row.partnerCode ?? row.PartnerCode ?? '').trim().toLowerCase() === partnerCode));
      }
      return {
        key: `${week.major}|${item.identity}`,
        major: week.major,
        identity: item.identity,
        values,
        state,
        singleValue: values.length === 1 ? values[0] : null,
        partners,
        snapshot: raumPnlSharedCostSnapshot(cellRows),
        rowCount: cellRows.length,
      };
    }),
  })).sort((a, b) => (a.prodName || a.name).localeCompare(b.prodName || b.name, 'ko'));

  return { weeks, items };
}

/** Build the editable product x settlement-week matrix from already scoped rows. */
export function buildRaumPnlPurchaseCostMatrix(rows = [], scope = {}) {
  const orderYear = String(scope.orderYear ?? '').trim();
  const partnerCode = String(scope.partnerCode ?? '').trim().toLowerCase();
  if (!/^\d{4}$/.test(orderYear) || !partnerCode) return { weeks: [], items: [] };

  const scoped = (Array.isArray(rows) ? rows : []).filter(row =>
    String(row.orderYear ?? row.OrderYear ?? '').trim() === orderYear &&
    String(row.partnerCode ?? row.PartnerCode ?? '').trim().toLowerCase() === partnerCode &&
    Number(row.pnlKey ?? row.PnlKey) > 0 && Number(row.itemKey ?? row.ItemKey) > 0
  );
  const weekMap = new Map();
  const itemMap = new Map();
  for (const row of scoped) {
    const pnlKey = Number(row.pnlKey ?? row.PnlKey);
    const major = Number(row.major ?? row.MajorWeek);
    if (!Number.isInteger(pnlKey) || pnlKey <= 0 || !Number.isInteger(major) || major <= 0) continue;
    if (!weekMap.has(pnlKey)) weekMap.set(pnlKey, {
      key: String(pnlKey), pnlKey, major, label: `${major}차`, title: String(row.title ?? row.Title ?? ''),
      updatedAt: row.pnlUpdatedAt ?? row.PnlUpdatedAt ?? null,
    });
    const itemIdentity = identity(row);
    if (!itemIdentity) continue;
    if (!itemMap.has(itemIdentity)) itemMap.set(itemIdentity, {
      identity: itemIdentity,
      name: String(row.name ?? row.Name ?? row.itemName ?? row.ItemName ?? ''),
      prodKey: positiveProdKey(row.prodKey ?? row.ProdKey),
      prodName: String(row.prodName ?? row.ProdName ?? ''),
      unit: normSpace(row.unit ?? row.Unit),
      isCustom: !!(row.isCustom ?? row.IsCustom),
      cells: new Map(),
    });
    const item = itemMap.get(itemIdentity);
    if (!item.cells.has(pnlKey)) item.cells.set(pnlKey, []);
    item.cells.get(pnlKey).push(row);
  }
  const weeks = [...weekMap.values()].sort((a, b) => b.major - a.major || b.pnlKey - a.pnlKey);
  const items = [...itemMap.values()].map(item => ({
    ...item,
    cells: weeks.map(week => {
      const cellRows = item.cells.get(week.pnlKey) || [];
      const values = [...new Set(cellRows
        .map(row => row.costPrice ?? row.CostPrice)
        .filter(value => value != null && String(value).trim() !== '')
        .map(Number)
        .filter(Number.isFinite))].sort((a, b) => a - b);
      const salePrices = [...new Set(cellRows
        .map(row => row.salePrice ?? row.SalePrice)
        .filter(value => value != null && String(value).trim() !== '')
        .map(Number)
        .filter(Number.isFinite))].sort((a, b) => a - b);
      const costRows = cellRows.filter(row => {
        const cost = row.costPrice ?? row.CostPrice;
        if (cost == null || String(cost).trim() === '') return false;
        const numericCost = Number(cost);
        return Number.isFinite(numericCost);
      });
      const purchaseAmount = costRows.length ? costRows.reduce((sum, row) =>
        sum + Number(row.costPrice ?? row.CostPrice) * Number(row.qty ?? row.Qty ?? 0), 0) : null;
      const saleAmountRows = cellRows.filter(row => {
        const amount = row.saleAmount ?? row.SaleAmount;
        return amount != null && String(amount).trim() !== '' && Number.isFinite(Number(amount));
      });
      const saleAmount = saleAmountRows.length
        ? saleAmountRows.reduce((sum, row) => sum + Number(row.saleAmount ?? row.SaleAmount), 0)
        : null;
      return cellRows.length ? {
        key: `${week.pnlKey}|${item.identity}`,
        pnlKey: week.pnlKey,
        major: week.major,
        identity: item.identity,
        values,
        salePrices,
        purchaseAmount,
        missingCostRows: cellRows.length - costRows.length,
        saleAmount,
        missingSaleAmountRows: cellRows.length - saleAmountRows.length,
        qty: cellRows.reduce((sum, row) => sum + Number(row.qty ?? row.Qty ?? 0), 0),
        snapshot: raumPnlCostSnapshot(cellRows),
        rowCount: cellRows.length,
      } : null;
    }),
  })).sort((a, b) => (a.prodName || a.name).localeCompare(b.prodName || b.name, 'ko'));
  return { weeks, items };
}

/**
 * Build a stable week-by-item matrix. Each cell contains all distinct numeric
 * stored costs for that week (never an average); missing/null costs are empty.
 */
export function buildRaumPnlCostComparison(items = [], rows = [], scope = {}) {
  const orderYear = String(scope.orderYear ?? '').trim();
  const partnerCode = String(scope.partnerCode ?? '').trim().toLowerCase();
  if (!orderYear || !partnerCode) {
    return { weeks: [], rows: (Array.isArray(items) ? items : []).map(() => []) };
  }
  const scopedRows = (Array.isArray(rows) ? rows : []).filter(row =>
    (orderYear === '' || String(row.orderYear ?? row.OrderYear ?? '').trim() === orderYear) &&
    (partnerCode === '' || String(row.partnerCode ?? row.PartnerCode ?? '').trim().toLowerCase() === partnerCode)
  );
  const weekNumbers = [...new Set(scopedRows
    .map(row => Number(row.major ?? row.MajorWeek))
    .filter(value => Number.isInteger(value) && value > 0))].sort((a, b) => b - a);
  const weeks = weekNumbers.map(major => ({ key: String(major), label: `${major}차` }));
  const byIdentityWeek = new Map();
  for (const row of scopedRows) {
    const major = Number(row.major ?? row.MajorWeek);
    const cost = row.costPrice ?? row.CostPrice;
    if (!Number.isInteger(major) || major <= 0 || typeof cost === 'boolean' || cost == null || String(cost).trim() === '') continue;
    const numeric = Number(cost);
    if (!Number.isFinite(numeric)) continue;
    const itemKey = identity(row);
    if (!itemKey) continue;
    const key = `${itemKey}|week:${major}`;
    if (!byIdentityWeek.has(key)) byIdentityWeek.set(key, new Set());
    byIdentityWeek.get(key).add(numeric);
  }
  return {
    weeks,
    rows: (Array.isArray(items) ? items : []).map(item =>
      weekNumbers.map(major => {
        const itemKey = identity(item);
        return itemKey ? [...(byIdentityWeek.get(`${itemKey}|week:${major}`) || [])].sort((a, b) => a - b) : [];
      })
    )
  };
}
