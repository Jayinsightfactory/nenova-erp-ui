import { normalizeOrderUnit } from './orderUtils.js';

export function roundQty(value) {
  const n = Math.round((Number(value) || 0) * 10000) / 10000;
  return Object.is(n, -0) ? 0 : n;
}

/**
 * Convert a quantity in `unit` to the product's `outUnit` using the exact
 * `toAllUnits` semantics from `pages/api/orders/index.js`.
 * If `unit === outUnit` or conversion factors are missing/zero, returns `Number(qty) || 0`.
 */
export function convertQtyToOutUnit({ qty, unit, outUnit, bunchOf1Box, steamOf1Box }) {
  const numQty = Number(qty) || 0;
  const targetUnit = normalizeOrderUnit(outUnit || unit || '박스', '박스');
  const srcUnit = normalizeOrderUnit(unit || targetUnit, targetUnit);

  if (srcUnit === targetUnit) {
    return roundQty(numQty);
  }

  const b1b = Number(bunchOf1Box) || 0;
  const s1b = Number(steamOf1Box) || 0;

  let box = 0;
  let bunch = 0;
  let steam = 0;

  if (srcUnit === '단') {
    bunch = numQty;
    box = b1b > 0 ? numQty / b1b : 0;
    steam = b1b > 0 && s1b > 0 ? box * s1b : 0;
  } else if (srcUnit === '송이') {
    steam = numQty;
    box = s1b > 0 ? numQty / s1b : 0;
    bunch = s1b > 0 && b1b > 0 ? box * b1b : 0;
  } else {
    box = numQty;
    bunch = b1b > 0 ? numQty * b1b : 0;
    steam = s1b > 0 ? numQty * s1b : 0;
  }

  const converted = targetUnit === '단' ? bunch : targetUnit === '송이' ? steam : box;
  if (numQty !== 0 && !(converted > 0)) {
    return roundQty(numQty);
  }
  return roundQty(converted);
}

function normalizeFallbackName(value) {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function compareCandidatesChronological(a, b) {
  const ta = a?.timestamp ? Date.parse(a.timestamp) : NaN;
  const tb = b?.timestamp ? Date.parse(b.timestamp) : NaN;
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) {
    return ta - tb;
  }
  const da = String(a?.dateKey || '');
  const db = String(b?.dateKey || '');
  if (da && db && da !== db) {
    return da.localeCompare(db);
  }
  return (a?._idx ?? 0) - (b?._idx ?? 0);
}

/**
 * Merge selected baseline candidates (`UPLOAD` / `ORDER_DATE`) in chronological order.
 * Preserves the earliest candidate's row order and metadata, merges duplicate `prodKey`
 * rows across candidates AND within a single sheet, and preserves `excelHeaders` / `rawCells`
 * when exactly one `UPLOAD` candidate with `sheetPreview` is selected.
 */
export function mergeBaselineCandidates(candidates = []) {
  const sorted = (Array.isArray(candidates) ? candidates : [])
    .filter(Boolean)
    .map((c, idx) => ({ ...c, _idx: idx }))
    .sort(compareCandidatesChronological);

  const isSingleUpload =
    sorted.length === 1 &&
    sorted[0].sourceKind === 'UPLOAD' &&
    Array.isArray(sorted[0].sheetPreview?.rows) &&
    sorted[0].sheetPreview.rows.length > 0;

  let excelHeaders = null;
  const rawCellsByRowNo = new Map();

  if (isSingleUpload) {
    const preview = sorted[0].sheetPreview;
    const headerRowNo = Number(preview.headerRow);
    for (const row of preview.rows) {
      const rn = Number(row?.rowNo);
      if (Number.isFinite(rn) && Array.isArray(row?.cells)) {
        rawCellsByRowNo.set(rn, row.cells.map((c) => String(c ?? '')));
      }
    }
    if (Number.isFinite(headerRowNo) && rawCellsByRowNo.has(headerRowNo)) {
      excelHeaders = rawCellsByRowNo.get(headerRowNo);
    }
  }

  const mergedMap = new Map();
  const orderedKeys = [];

  for (const candidate of sorted) {
    const items = Array.isArray(candidate.items) ? candidate.items : [];
    for (let i = 0; i < items.length; i += 1) {
      const it = items[i];
      if (!it) continue;

      const pkNum = Number(it.prodKey);
      const validPk = Number.isInteger(pkNum) && pkNum > 0 ? pkNum : null;
      const fallbackToken = normalizeFallbackName(it.inputName || it.prodName || it.displayName);
      const mergeKey = validPk
        ? `P:${validPk}`
        : `N:${fallbackToken || `${candidate.id}:${it.rowNo ?? i}`}`;

      const outUnit = normalizeOrderUnit(it.outUnit || it.unit || '박스', '박스');
      const unit = normalizeOrderUnit(it.unit || outUnit, outUnit);
      const qty = roundQty(Number(it.qty) || 0);
      const outQty =
        it.outQty != null && Number.isFinite(Number(it.outQty))
          ? roundQty(Number(it.outQty))
          : convertQtyToOutUnit({
              qty,
              unit,
              outUnit,
              bunchOf1Box: it.bunchOf1Box,
              steamOf1Box: it.steamOf1Box,
            });

      const rowNoNum = it.rowNo != null && Number(it.rowNo) > 0 ? Number(it.rowNo) : null;
      const rawCells = Array.isArray(it.rawCells)
        ? it.rawCells.map((c) => String(c ?? ''))
        : isSingleUpload && rowNoNum != null && rawCellsByRowNo.has(rowNoNum)
          ? rawCellsByRowNo.get(rowNoNum)
          : null;

      if (!mergedMap.has(mergeKey)) {
        const entry = {
          prodKey: validPk,
          rowNo: rowNoNum,
          rowNos: rowNoNum != null ? [rowNoNum] : [],
          inputName: String(it.inputName || ''),
          colorOrDetail: String(it.colorOrDetail || it.color || it.detailLabel || ''),
          matchName: String(it.matchName || ''),
          prodName: String(it.prodName || ''),
          displayName: String(it.displayName || it.prodName || ''),
          flowerName: String(it.flowerName || ''),
          counName: String(it.counName || ''),
          unit,
          rawUnit: String(it.rawUnit || unit),
          outUnit,
          bunchOf1Box: Number(it.bunchOf1Box) || 0,
          steamOf1Box: Number(it.steamOf1Box) || 0,
          unitPrice: Number(it.unitPrice) || 0,
          note: String(it.note || ''),
          rawCells,
          qty,
          outQty,
          unitMixed: false,
          sources: [
            {
              candidateId: candidate.id,
              sourceKind: candidate.sourceKind,
              dateKey: candidate.dateKey || '',
              label: candidate.label || '',
              qty,
              outQty,
              unit,
            },
          ],
        };
        mergedMap.set(mergeKey, entry);
        orderedKeys.push(mergeKey);
      } else {
        const existing = mergedMap.get(mergeKey);
        if (rowNoNum != null && !existing.rowNos.includes(rowNoNum)) {
          existing.rowNos.push(rowNoNum);
        }
        if (unit !== existing.unit) {
          existing.unitMixed = true;
        }
        existing.qty = roundQty(existing.qty + qty);
        existing.outQty = roundQty(existing.outQty + outQty);

        const prevSource = existing.sources.find(
          (s) => s.candidateId === candidate.id && s.unit === unit,
        );
        if (prevSource) {
          prevSource.qty = roundQty(prevSource.qty + qty);
          prevSource.outQty = roundQty(prevSource.outQty + outQty);
        } else {
          existing.sources.push({
            candidateId: candidate.id,
            sourceKind: candidate.sourceKind,
            dateKey: candidate.dateKey || '',
            label: candidate.label || '',
            qty,
            outQty,
            unit,
          });
        }
      }
    }
  }

  return {
    items: orderedKeys.map((k) => mergedMap.get(k)),
    excelHeaders,
    isSingleUpload,
  };
}

const STATUS_LABELS = {
  SAME: '변동없음',
  UNALLOCATED: '미분배',
  INCREASED: '증가',
  DECREASED: '감소',
  ADDED: '신규분배',
};

/**
 * Compare merged baseline items against current `ShipmentDetail` items (`shipQty` in `OutUnit`).
 */
export function buildCompareRows(mergedBaselineItems, shipmentItems = []) {
  const baselineItems = Array.isArray(mergedBaselineItems)
    ? mergedBaselineItems
    : mergedBaselineItems?.items || [];

  const shipmentMap = new Map();
  for (const s of Array.isArray(shipmentItems) ? shipmentItems : []) {
    const pk = Number(s?.prodKey);
    if (!Number.isInteger(pk) || pk <= 0) continue;
    const qty = roundQty(Number(s.shipQty) || 0);
    if (shipmentMap.has(pk)) {
      const prev = shipmentMap.get(pk);
      prev.shipQty = roundQty(prev.shipQty + qty);
    } else {
      shipmentMap.set(pk, { ...s, prodKey: pk, shipQty: qty });
    }
  }

  const matchedProdKeys = new Set();
  const rows = [];

  let baselineTotalQty = 0;
  let shipTotalQty = 0;
  let sameCount = 0;
  let increasedCount = 0;
  let decreasedCount = 0;
  let unallocatedCount = 0;
  let addedCount = 0;

  for (const item of baselineItems) {
    const pk = Number(item?.prodKey);
    const validPk = Number.isInteger(pk) && pk > 0 ? pk : null;
    const ship = validPk ? shipmentMap.get(validPk) : null;
    if (ship && validPk) {
      matchedProdKeys.add(validPk);
    }

    const baselineQty = roundQty(item?.outQty ?? item?.qty ?? 0);
    const shipQty = ship ? roundQty(ship.shipQty) : 0;
    const diff = roundQty(shipQty - baselineQty);

    let status = 'SAME';
    if (diff === 0) {
      status = 'SAME';
      sameCount += 1;
    } else if (shipQty === 0 && baselineQty > 0) {
      status = 'UNALLOCATED';
      unallocatedCount += 1;
    } else if (diff > 0) {
      status = 'INCREASED';
      increasedCount += 1;
    } else {
      status = 'DECREASED';
      decreasedCount += 1;
    }

    baselineTotalQty = roundQty(baselineTotalQty + baselineQty);
    shipTotalQty = roundQty(shipTotalQty + shipQty);

    rows.push({
      ...item,
      prodKey: validPk,
      prodName: item.prodName || ship?.prodName || '',
      displayName: item.displayName || item.prodName || ship?.displayName || ship?.prodName || '',
      flowerName: item.flowerName || ship?.flowerName || '',
      counName: item.counName || ship?.counName || '',
      outUnit: item.outUnit || ship?.outUnit || item.unit || '박스',
      baselineQty,
      shipQty,
      diff,
      status,
      statusLabel: STATUS_LABELS[status],
    });
  }

  for (const [pk, ship] of shipmentMap.entries()) {
    if (matchedProdKeys.has(pk)) continue;
    const shipQty = roundQty(ship.shipQty);
    if (!(shipQty > 0)) continue;

    addedCount += 1;
    shipTotalQty = roundQty(shipTotalQty + shipQty);

    const outUnit = normalizeOrderUnit(ship.outUnit || '박스', '박스');
    rows.push({
      prodKey: pk,
      rowNo: null,
      rowNos: [],
      inputName: ship.displayName || ship.prodName || '',
      colorOrDetail: '',
      matchName: '',
      prodName: ship.prodName || '',
      displayName: ship.displayName || ship.prodName || '',
      flowerName: ship.flowerName || '',
      counName: ship.counName || '',
      unit: outUnit,
      rawUnit: outUnit,
      outUnit,
      bunchOf1Box: 0,
      steamOf1Box: 0,
      unitPrice: 0,
      note: '',
      rawCells: null,
      qty: 0,
      outQty: 0,
      unitMixed: false,
      sources: [],
      baselineQty: 0,
      shipQty,
      diff: shipQty,
      status: 'ADDED',
      statusLabel: STATUS_LABELS.ADDED,
    });
  }

  const shipItemCount = rows.filter((r) => r.shipQty > 0).length;
  const changedCount = increasedCount + decreasedCount + unallocatedCount + addedCount;

  return {
    rows,
    summary: {
      baselineItemCount: baselineItems.length,
      baselineTotalQty,
      shipItemCount,
      shipTotalQty,
      changedCount,
      sameCount,
      increasedCount,
      decreasedCount,
      unallocatedCount,
      addedCount,
      netDiff: roundQty(shipTotalQty - baselineTotalQty),
    },
  };
}
