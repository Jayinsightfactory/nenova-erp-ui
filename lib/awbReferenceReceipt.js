import { isFreightItem, isGrossWeightItem, isChargeableWeightItem } from './freightCalc.js';
import { isOrphanWeightDetailRow } from './warehouseWeightRows.js';

const round6 = value => Math.round((Number(value) + Number.EPSILON) * 1e6) / 1e6;

const isBlankOrZero = value => value == null || String(value).trim() === ''
  || (typeof value !== 'boolean' && Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 1e-9);

export function normalizeAwbCode(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/[\s-]/g, '');
}

export function isValidAwbCode(value) {
  return /^\d{11}$/.test(normalizeAwbCode(value));
}

export function isBlankPlaceholderDetailRow(row) {
  if (!row || typeof row !== 'object') return false;
  const noProdKey = row.ProdKey == null || String(row.ProdKey).trim() === '';
  const noProdName = !String(row.ProdName ?? '').trim();
  return noProdKey && noProdName && isBlankOrZero(row.OutQuantity) && isBlankOrZero(row.UPrice) && isBlankOrZero(row.TPrice);
}

export function isNonGoodsDetailRow(row) {
  return Boolean(isFreightItem(row?.ProdName) || isOrphanWeightDetailRow(row) || isBlankPlaceholderDetailRow(row));
}

export function isCostReferenceReceiptRows(rows) {
  return Array.isArray(rows) && rows.length > 0 && rows.every(isNonGoodsDetailRow);
}

function detailWeightFromRows(rows, predicate) {
  const matched = rows.filter(row => predicate(row?.ProdName));
  if (matched.length !== 1) return null;
  const candidates = ['OutQuantity', 'BoxQuantity', 'BunchQuantity', 'SteamQuantity']
    .map(key => matched[0][key])
    .filter(value => typeof value === 'number' && Number.isFinite(value) && value > 0);
  const values = [...new Set(candidates.some(value => value > 1) ? candidates.filter(value => value > 1) : candidates)];
  return values.length === 1 ? values[0] : null;
}

function positiveHeaderWeight(value) {
  const n = typeof value === 'boolean' || value == null || value === '' ? NaN : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function splitReferenceFeeRows(feeRows, cw, head) {
  const positiveRows = feeRows
    .map(row => ({ row, amount: Number(row?.TPrice) }))
    .filter(({ amount }) => Number.isFinite(amount) && amount > 0);
  if (positiveRows.length === 0) {
    if (Number(head?.FreightRateUSD) > 0 && cw > 0) {
      const freightOnlyUSD = round6(Number(head.FreightRateUSD) * cw);
      const docFeeUSD = Number(head?.DocFeeUSD) > 0 ? round6(Number(head.DocFeeUSD)) : 0;
      const freightAmount = round6(freightOnlyUSD + docFeeUSD);
      return { freightAmount, freightOnlyUSD, docFeeUSD, freightRateUSD: round6(freightOnlyUSD / cw) };
    }
    return { freightAmount: null, freightOnlyUSD: null, docFeeUSD: null, freightRateUSD: null };
  }
  const freightAmount = round6(positiveRows.reduce((sum, item) => sum + item.amount, 0));
  if (positiveRows.length === 1) {
    const freightOnlyUSD = freightAmount;
    return {
      freightAmount,
      freightOnlyUSD,
      docFeeUSD: 0,
      freightRateUSD: cw > 0 ? round6(freightOnlyUSD / cw) : null,
    };
  }
  const matchesCwQty = item => cw > 1 && ['SteamQuantity', 'BunchQuantity', 'OutQuantity']
    .some(key => Number(item.row?.[key]) > 0 && Math.abs(Number(item.row[key]) - cw) < 1e-6);
  const isDocLabel = item => /서류|doc(?:ument)?\s*fee|other\s*charge/i.test(String(item.row?.ProdName ?? ''));
  const cwMatched = positiveRows.filter(matchesCwQty);
  if (cwMatched.length > 0 && cwMatched.length < positiveRows.length) {
    const freightOnlyUSD = round6(cwMatched.reduce((sum, item) => sum + item.amount, 0));
    const docFeeUSD = round6(freightAmount - freightOnlyUSD);
    return {
      freightAmount,
      freightOnlyUSD,
      docFeeUSD,
      freightRateUSD: cw > 0 ? round6(freightOnlyUSD / cw) : null,
    };
  }
  const docLabeled = positiveRows.filter(isDocLabel);
  if (docLabeled.length > 0 && docLabeled.length < positiveRows.length) {
    const docFeeUSD = round6(docLabeled.reduce((sum, item) => sum + item.amount, 0));
    const freightOnlyUSD = round6(freightAmount - docFeeUSD);
    return {
      freightAmount,
      freightOnlyUSD,
      docFeeUSD,
      freightRateUSD: cw > 0 ? round6(freightOnlyUSD / cw) : null,
    };
  }
  if (positiveRows.length === 2) {
    const sorted = [...positiveRows].sort((a, b) => a.amount - b.amount);
    const [smaller, larger] = sorted;
    if (smaller.amount < larger.amount && smaller.amount <= 500 && larger.amount > smaller.amount * 2) {
      const docFeeUSD = round6(smaller.amount);
      const freightOnlyUSD = round6(freightAmount - docFeeUSD);
      return {
        freightAmount,
        freightOnlyUSD,
        docFeeUSD,
        freightRateUSD: cw > 0 ? round6(freightOnlyUSD / cw) : null,
      };
    }
  }
  return {
    freightAmount,
    freightOnlyUSD: freightAmount,
    docFeeUSD: 0,
    freightRateUSD: cw > 0 ? round6(freightAmount / cw) : null,
  };
}

function parseReferenceReceipt(rows, awb) {
  const head = rows[0];
  const orphanWeights = rows.filter(isOrphanWeightDetailRow);
  const orphanGw = orphanWeights.length >= 1 && orphanWeights.length <= 2 && Number(orphanWeights[0].SteamQuantity) > 0
    ? Number(orphanWeights[0].SteamQuantity) : null;
  const orphanCw = orphanWeights.length === 2 && Number(orphanWeights[1].SteamQuantity) > 0
    ? Number(orphanWeights[1].SteamQuantity) : null;
  const gw = detailWeightFromRows(rows, isGrossWeightItem) ?? positiveHeaderWeight(head?.GrossWeight) ?? orphanGw;
  const cw = detailWeightFromRows(rows, isChargeableWeightItem) ?? positiveHeaderWeight(head?.ChargeableWeight) ?? orphanCw;
  const feeRows = rows.filter(row => isFreightItem(row?.ProdName) && !isGrossWeightItem(row?.ProdName) && !isChargeableWeightItem(row?.ProdName));
  const { freightAmount, freightOnlyUSD, docFeeUSD, freightRateUSD } = splitReferenceFeeRows(feeRows, cw, head);
  const farmName = String(head?.FarmName ?? '').trim();
  const invoiceNo = String(head?.InvoiceNo ?? '').trim();
  const warehouseKey = head?.WarehouseKey;
  return {
    warehouseKey,
    awb,
    farmName,
    invoiceNo,
    gw,
    cw,
    freightAmount,
    ...(freightOnlyUSD != null ? { freightOnlyUSD } : {}),
    ...(docFeeUSD != null ? { docFeeUSD } : {}),
    ...(freightRateUSD != null ? { freightRateUSD } : {}),
    sourceId: `입고 #${warehouseKey} ${farmName || '운임참고'}${invoiceNo ? ` (${invoiceNo})` : ''} · AWB ${awb}`,
  };
}

/**
 * 동일 연도·차수·11자리 AWB를 공유하는 운임·중량 참고 전용 입고(Apollo / EXCEL / FREIGHTWISE 등)에서
 * GW·CW·운송료 합계와 상품 입고 공유 현황을 읽기 전용으로 추출한다.
 * - 참고 전용 입고가 없거나 같은 AWB 참고 입고가 복수여서 모호하면 null을 반환한다(임의 합산·0원 위장 금지).
 */
export function extractAwbReferenceFromReceipts(rawRows, awbValue, options = {}) {
  const awb = normalizeAwbCode(awbValue);
  if (!isValidAwbCode(awb) || !Array.isArray(rawRows) || !rawRows.length) return null;
  const byWarehouse = new Map();
  for (const row of rawRows) {
    if (!row || normalizeAwbCode(row.OrderNo) !== awb || !Number.isSafeInteger(Number(row.WarehouseKey))) continue;
    const key = Number(row.WarehouseKey);
    if (!byWarehouse.has(key)) byWarehouse.set(key, []);
    byWarehouse.get(key).push(row);
  }
  if (!byWarehouse.size) return null;
  const referenceCandidates = [];
  const goodsReceipts = [];
  for (const [warehouseKey, rows] of byWarehouse) {
    if (isCostReferenceReceiptRows(rows)) {
      const parsed = parseReferenceReceipt(rows, awb);
      if (parsed.gw != null || parsed.cw != null || parsed.freightAmount != null) {
        referenceCandidates.push(parsed);
      }
    } else {
      const goodsRows = rows.filter(row => !isNonGoodsDetailRow(row));
      if (goodsRows.length > 0) {
        const stems = goodsRows.reduce((sum, row) => {
          const s = Number(row.SteamQuantity);
          if (Number.isFinite(s) && s > 0) return sum + s;
          const out = Number(row.OutQuantity);
          return Number.isFinite(out) && out > 0 ? sum + out : sum;
        }, 0);
        goodsReceipts.push({ warehouseKey, stems });
      }
    }
  }
  if (referenceCandidates.length !== 1) return null;
  const reference = referenceCandidates[0];
  const sharedGoodsReceiptCount = goodsReceipts.length;
  const goodsWarehouseKeys = goodsReceipts.map(item => item.warehouseKey);
  const stemShareDenominator = goodsReceipts.reduce((sum, item) => sum + item.stems, 0);
  const targetKey = Number(options.targetWarehouseKey);
  const targetEntry = Number.isSafeInteger(targetKey) ? goodsReceipts.find(item => item.warehouseKey === targetKey) : null;
  return {
    ...reference,
    sharedGoodsReceiptCount,
    goodsWarehouseKeys,
    stemShareNumerator: targetEntry ? targetEntry.stems : null,
    stemShareDenominator: stemShareDenominator > 0 ? stemShareDenominator : null,
  };
}
