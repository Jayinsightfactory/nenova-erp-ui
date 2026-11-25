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
  const positiveFees = feeRows
    .map(row => Number(row?.TPrice))
    .filter(amount => Number.isFinite(amount) && amount > 0);
  let freightAmount = positiveFees.length > 0 ? round6(positiveFees.reduce((sum, amount) => sum + amount, 0)) : null;
  if (freightAmount === null && Number(head?.FreightRateUSD) > 0 && cw > 0) {
    freightAmount = round6(Number(head.FreightRateUSD) * cw + (Number(head?.DocFeeUSD) > 0 ? Number(head.DocFeeUSD) : 0));
  }
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
