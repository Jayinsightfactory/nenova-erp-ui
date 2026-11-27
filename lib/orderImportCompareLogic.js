import { normalizeOrderUnit } from './orderUtils.js';

export function roundQty(value) {
  const n = Math.round((Number(value) || 0) * 10000) / 10000;
  return Object.is(n, -0) ? 0 : n;
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * Derive display variety group label from Product `CounName` and `FlowerName`.
 */
export function getVarietyGroupLabel({ counName = '', flowerName = '' } = {}) {
  const coun = String(counName || '').trim();
  const flower = String(flowerName || '').trim();
  if (coun === '국내' && flower === '왁스') return '운임비';
  if (coun && flower) return `${coun} ${flower}`;
  if (coun) return coun;
  if (flower) return flower;
  return '기타 품목';
}

/**
 * Format `'YYYY-MM-DD'` into `'M/D(요)'` using timezone-safe UTC calendar math.
 */
export function formatShipDateShort(dateKey) {
  const m = String(dateKey || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const y = Number(m[1]);
  const mon = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mon - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mon - 1 ||
    dt.getUTCDate() !== d
  ) {
    return '';
  }
  const dayKo = WEEKDAY_KO[dt.getUTCDay()] || '';
  return `${mon}/${d}(${dayKo})`;
}

function normalizeShipDates(rawShipDates) {
  if (!Array.isArray(rawShipDates) || rawShipDates.length === 0) return [];
  const byDate = new Map();
  for (const sd of rawShipDates) {
    const dk = String(sd?.dateKey || '').trim();
    if (!dk) continue;
    const prev = byDate.get(dk);
    const qty = roundQty(Number(sd?.qty) || 0);
    const amount = Number(sd?.amount) || 0;
    if (prev) {
      prev.qty = roundQty(prev.qty + qty);
      prev.amount = Math.round((prev.amount + amount) * 100) / 100;
    } else {
      byDate.set(dk, {
        dateKey: dk,
        qty,
        amount: Math.round(amount * 100) / 100,
      });
    }
  }
  return [...byDate.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

function collectSubWeeks(sources = [], shipmentDetails = []) {
  const set = new Set();
  for (const s of Array.isArray(sources) ? sources : []) {
    const w = String(s?.orderWeek || '').trim();
    if (w) set.add(w);
  }
  for (const d of Array.isArray(shipmentDetails) ? shipmentDetails : []) {
    const w = String(d?.orderWeek || '').trim();
    if (w) set.add(w);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
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
              orderWeek: candidate.orderWeek || '',
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
        if (!existing.counName && it.counName) {
          existing.counName = String(it.counName);
        }
        if (!existing.flowerName && it.flowerName) {
          existing.flowerName = String(it.flowerName);
        }
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
            orderWeek: candidate.orderWeek || '',
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
    const details = Array.isArray(s.shipmentDetails) ? s.shipmentDetails : [];
    const shipDates = normalizeShipDates(s.shipDates);
    if (shipmentMap.has(pk)) {
      const prev = shipmentMap.get(pk);
      if (!prev.counName && s.counName) prev.counName = String(s.counName);
      if (!prev.flowerName && s.flowerName) prev.flowerName = String(s.flowerName);
      prev.shipQty = roundQty(prev.shipQty + qty);
      prev.shipAmount = Number(prev.shipAmount || 0) + Number(s.shipAmount || 0);
      prev.hasFixed = Boolean(prev.hasFixed || s.hasFixed);
      prev.shipmentDetails = [...prev.shipmentDetails, ...details];
      prev.shipDates = normalizeShipDates([...(prev.shipDates || []), ...shipDates]);
      const mergedCosts = [
        ...new Set(
          prev.shipmentDetails.length > 0
            ? prev.shipmentDetails.map((d) => Math.round(Number(d.cost || 0) * 100) / 100)
            : [prev.shipCost, s.shipCost].filter((c) => c != null).map((c) => Math.round(Number(c) * 100) / 100),
        ),
      ];
      prev.hasMixedShipCost = Boolean(prev.hasMixedShipCost || s.hasMixedShipCost || mergedCosts.length > 1);
      if (mergedCosts.length === 1) {
        prev.shipCost = mergedCosts[0];
      } else if (prev.shipCost == null && s.shipCost != null) {
        prev.shipCost = s.shipCost;
      }
    } else {
      shipmentMap.set(pk, {
        ...s,
        prodKey: pk,
        shipQty: qty,
        shipCost: s.shipCost ?? null,
        shipAmount: Number(s.shipAmount || 0),
        hasFixed: Boolean(s.hasFixed),
        hasMixedShipCost: Boolean(s.hasMixedShipCost),
        shipmentDetails: details,
        shipDates,
      });
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

    const counName = String(ship?.counName || item?.counName || '').trim();
    const flowerName = String(ship?.flowerName || item?.flowerName || '').trim();
    const varietyGroup = getVarietyGroupLabel({ counName, flowerName });
    const shipDates = normalizeShipDates(ship?.shipDates);
    const shipmentDetails = Array.isArray(ship?.shipmentDetails) ? ship.shipmentDetails : [];
    const subWeeks = collectSubWeeks(item?.sources, shipmentDetails);

    rows.push({
      ...item,
      prodKey: validPk,
      prodName: item.prodName || ship?.prodName || '',
      displayName: item.displayName || item.prodName || ship?.displayName || ship?.prodName || '',
      flowerName,
      counName,
      varietyGroup,
      shipDates,
      subWeeks,
      outUnit: item.outUnit || ship?.outUnit || item.unit || '박스',
      baselineQty,
      shipQty,
      diff,
      status,
      statusLabel: STATUS_LABELS[status],
      shipCost: ship ? (ship.shipCost ?? null) : null,
      shipAmount: ship ? Number(ship.shipAmount || 0) : 0,
      hasFixed: Boolean(ship?.hasFixed),
      hasMixedShipCost: Boolean(ship?.hasMixedShipCost),
      shipmentDetails,
    });
  }

  for (const [pk, ship] of shipmentMap.entries()) {
    if (matchedProdKeys.has(pk)) continue;
    const shipQty = roundQty(ship.shipQty);
    if (!(shipQty > 0)) continue;

    addedCount += 1;
    shipTotalQty = roundQty(shipTotalQty + shipQty);

    const outUnit = normalizeOrderUnit(ship.outUnit || '박스', '박스');
    const counName = String(ship.counName || '').trim();
    const flowerName = String(ship.flowerName || '').trim();
    const varietyGroup = getVarietyGroupLabel({ counName, flowerName });
    const shipDates = normalizeShipDates(ship.shipDates);
    const shipmentDetails = Array.isArray(ship.shipmentDetails) ? ship.shipmentDetails : [];
    const subWeeks = collectSubWeeks([], shipmentDetails);

    rows.push({
      prodKey: pk,
      rowNo: null,
      rowNos: [],
      inputName: ship.displayName || ship.prodName || '',
      colorOrDetail: '',
      matchName: '',
      prodName: ship.prodName || '',
      displayName: ship.displayName || ship.prodName || '',
      flowerName,
      counName,
      varietyGroup,
      shipDates,
      subWeeks,
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
      shipCost: ship.shipCost ?? null,
      shipAmount: Number(ship.shipAmount || 0),
      hasFixed: Boolean(ship.hasFixed),
      hasMixedShipCost: Boolean(ship.hasMixedShipCost),
      shipmentDetails,
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

/**
 * Build `/api/estimate/update-cost` payload items from compare rows and inline price edits.
 */
export function buildUpdateCostPayload(compareRows = [], priceEdits = {}) {
  const rows = Array.isArray(compareRows) ? compareRows : [];
  const edits = priceEdits && typeof priceEdits === 'object' ? priceEdits : {};

  const items = [];
  const invalidRows = [];
  let editedRowCount = 0;
  let hasFixedTarget = false;

  for (const row of rows) {
    if (!row?.prodKey || !Array.isArray(row.shipmentDetails) || row.shipmentDetails.length === 0) {
      continue;
    }
    const key = String(row.prodKey);
    if (!Object.prototype.hasOwnProperty.call(edits, key)) continue;
    const rawValue = edits[key];
    if (rawValue == null || String(rawValue).trim() === '') continue;

    const cleaned = String(rawValue).replace(/[,\s]+/g, '');
    const val = Number(cleaned);
    if (!Number.isFinite(val) || val < 0) {
      invalidRows.push({
        prodKey: Number(row.prodKey),
        prodName: row.displayName || row.prodName || row.inputName || String(row.prodKey),
        rawValue: String(rawValue),
      });
      continue;
    }

    if (Math.abs(val - Number(row.shipCost ?? 0)) >= 0.5 || row.hasMixedShipCost) {
      editedRowCount += 1;
      for (const d of row.shipmentDetails) {
        items.push({
          shipmentKey: d.shipmentKey,
          sdetailKey: d.sdetailKey,
          cost: val,
          expectedOldCost: Number(d.cost || 0),
        });
        if (Number(d.isFix) === 1 || d.isFix === true) {
          hasFixedTarget = true;
        }
      }
    }
  }

  return {
    items,
    editedRowCount,
    detailRowCount: items.length,
    hasFixedTarget,
    invalidRows,
  };
}

/**
 * Pick the default `orderWeek` for `selectedYear`:
 * 1) Latest `parentWeek` that has at least one subWeek with `hasShipment === true`,
 *    and within that `parentWeek`, the smallest `subWeek` with `hasShipment === true`.
 * 2) If no subWeek has `hasShipment === true`, fall back to the smallest `subWeek`
 *    of the latest `parentWeek`.
 * 3) Empty array returns `''`.
 */
export function pickDefaultOrderWeek(weeks = []) {
  const list = Array.isArray(weeks)
    ? weeks.filter((w) => w && String(w.orderWeek || w.subWeek || '').trim())
    : [];
  if (list.length === 0) return '';

  const parsed = list.map((w, idx) => {
    const orderWeek = String(w.orderWeek || w.subWeek || '').trim();
    const m = orderWeek.match(/^(\d+)-(\d+)$/);
    const parentNum = m ? Number(m[1]) : Number(w.parentWeek) || 0;
    const subNum = m ? Number(m[2]) : 0;
    const orderYear = Number(w.orderYear) || 0;
    return {
      orderWeek,
      orderYear,
      parentNum,
      subNum,
      hasShipment: Boolean(w.hasShipment),
      idx,
    };
  });

  const shipCandidates = parsed.filter((w) => w.hasShipment);
  const pool = shipCandidates.length > 0 ? shipCandidates : parsed;

  pool.sort((a, b) => {
    if (b.orderYear !== a.orderYear) return b.orderYear - a.orderYear;
    if (b.parentNum !== a.parentNum) return b.parentNum - a.parentNum;
    if (a.subNum !== b.subNum) return a.subNum - b.subNum;
    return a.idx - b.idx;
  });

  return pool[0]?.orderWeek || '';
}

function compareVarietyLabels(a, b) {
  const isOtherA = a === '기타 품목';
  const isOtherB = b === '기타 품목';
  if (isOtherA !== isOtherB) return isOtherA ? 1 : -1;
  return String(a || '').localeCompare(String(b || ''), 'ko');
}

function computeUnitSubtotals(groupRows) {
  const byUnit = new Map();
  for (const row of groupRows) {
    const unit = String(row?.outUnit || row?.unit || '단').trim() || '단';
    if (!byUnit.has(unit)) {
      byUnit.set(unit, {
        unit,
        baselineQty: 0,
        shipQty: 0,
        diff: 0,
        shipAmount: 0,
        hasSplitRows: false,
      });
    }
    const sub = byUnit.get(unit);
    if (row?.countsBaselineInSubtotal !== false) {
      sub.baselineQty = roundQty(sub.baselineQty + (Number(row?.baselineQty) || 0));
    }
    const effectiveShipQty =
      row?.displayShipQty != null ? Number(row.displayShipQty) : Number(row?.shipQty);
    sub.shipQty = roundQty(sub.shipQty + (Number(effectiveShipQty) || 0));
    const effectiveShipAmt =
      row?.displayShipAmount != null ? Number(row.displayShipAmount) : Number(row?.shipAmount);
    sub.shipAmount = Math.round((sub.shipAmount + (Number(effectiveShipAmt) || 0)) * 100) / 100;
    if (row?.isSplitDateRow) {
      sub.hasSplitRows = true;
    }
  }
  return [...byUnit.values()].map((sub) => ({
    ...sub,
    diff: roundQty(sub.shipQty - sub.baselineQty),
  }));
}

function buildVarietyGroupsForRows(bucketRows, groupByVariety) {
  if (!groupByVariety) {
    return [
      {
        varietyGroup: '',
        rows: bucketRows,
        unitSubtotals: computeUnitSubtotals(bucketRows),
      },
    ];
  }

  const byVariety = new Map();
  for (const row of bucketRows) {
    const label =
      String(row?.varietyGroup || '').trim() ||
      getVarietyGroupLabel({ counName: row?.counName, flowerName: row?.flowerName });
    if (!byVariety.has(label)) {
      byVariety.set(label, []);
    }
    byVariety.get(label).push(row);
  }

  const sortedLabels = [...byVariety.keys()].sort(compareVarietyLabels);
  return sortedLabels.map((varietyGroup) => {
    const grpRows = byVariety.get(varietyGroup);
    return {
      varietyGroup,
      rows: grpRows,
      unitSubtotals: computeUnitSubtotals(grpRows),
    };
  });
}

/**
 * Group compare rows into ship-date sections and/or variety groups with per-unit subtotals.
 */
export function groupCompareRows(rows = [], { groupByShipDate = true, groupByVariety = true } = {}) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (list.length === 0) {
    return { sections: [] };
  }

  if (!groupByShipDate) {
    const projected = list.map((row) => ({
      ...row,
      displayShipQty: roundQty(row.shipQty),
      displayShipAmount: Math.round((Number(row.shipAmount) || 0) * 100) / 100,
      isSplitDateRow: false,
      countsBaselineInSubtotal: true,
      shipDateKey: null,
    }));
    return {
      sections: [
        {
          dateKey: null,
          dateLabel: '',
          isNoDate: false,
          varietyGroups: buildVarietyGroupsForRows(projected, groupByVariety),
        },
      ],
    };
  }

  const buckets = new Map();
  const addToBucket = (bucketKey, projectedRow) => {
    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, []);
    }
    buckets.get(bucketKey).push(projectedRow);
  };

  for (const row of list) {
    const shipDates = normalizeShipDates(row.shipDates);
    if (shipDates.length === 0) {
      addToBucket('NO_DATE', {
        ...row,
        shipDates,
        displayShipQty: roundQty(row.shipQty),
        displayShipAmount: Math.round((Number(row.shipAmount) || 0) * 100) / 100,
        isSplitDateRow: false,
        countsBaselineInSubtotal: true,
        shipDateKey: 'NO_DATE',
      });
    } else if (shipDates.length === 1) {
      const sd = shipDates[0];
      addToBucket(sd.dateKey, {
        ...row,
        shipDates,
        displayShipQty: roundQty(row.shipQty),
        displayShipAmount: Math.round((Number(row.shipAmount) || 0) * 100) / 100,
        isSplitDateRow: false,
        countsBaselineInSubtotal: true,
        shipDateKey: sd.dateKey,
      });
    } else {
      shipDates.forEach((sd, idx) => {
        addToBucket(sd.dateKey, {
          ...row,
          shipDates,
          displayShipQty: roundQty(sd.qty),
          displayShipAmount: Math.round((Number(sd.amount) || 0) * 100) / 100,
          isSplitDateRow: true,
          splitDateCount: shipDates.length,
          splitDateIndex: idx,
          countsBaselineInSubtotal: idx === 0,
          totalBaselineQty: roundQty(row.baselineQty),
          totalShipQty: roundQty(row.shipQty),
          shipDateKey: sd.dateKey,
        });
      });
    }
  }

  const sortedKeys = [...buckets.keys()].sort((a, b) => {
    if (a === 'NO_DATE') return 1;
    if (b === 'NO_DATE') return -1;
    return a.localeCompare(b);
  });

  const sections = sortedKeys.map((dateKey) => {
    const isNoDate = dateKey === 'NO_DATE';
    const dateLabel = isNoDate
      ? '미분배 · 출고일 없음'
      : formatShipDateShort(dateKey) || dateKey;
    return {
      dateKey,
      dateLabel,
      isNoDate,
      varietyGroups: buildVarietyGroupsForRows(buckets.get(dateKey), groupByVariety),
    };
  });

  return { sections };
}
