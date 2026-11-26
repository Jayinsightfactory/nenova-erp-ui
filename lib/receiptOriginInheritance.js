import { baseCountry, DOMESTIC_TOKENS } from './countryClassification.js';
import { isFreightItem } from './freightCalc.js';
import { isOrphanWeightDetailRow } from './warehouseWeightRows.js';
import { isBlankPlaceholderDetailRow, isValidAwbCode, normalizeAwbCode } from './awbReferenceReceipt.js';

export const DEPRECATED_ORIGIN_RE = /^(?:사용\s*금지|미사용|단종|폐기)$/i;

export const CO_DEFAULT_STEMS_PER_BUNCH = Object.freeze({
  HYDRANGEA: 1,
  ROSE: 10,
  CARNATION: 20,
  ALSTROMERIA: 10,
  RUSCUS: 25,
});

const normalizeCompact = value => String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');

export function isInheritableOriginValue(counName) {
  if (counName == null) return true;
  const trimmed = String(counName).trim();
  if (!trimmed) return true;
  return DEPRECATED_ORIGIN_RE.test(trimmed);
}

/**
 * dbo.Product 내 CounName='콜롬비아'로 오등록된 중국 운남([MEL]/[오경] ... CHINA ..., FlowerName='아나나스') 품목 157종 방어.
 */
export function isChinaMasterPollutedAsColombia(row) {
  const rawOrigin = row?.CounName ?? row?.originName;
  if (baseCountry(rawOrigin) !== '콜롬비아') return false;
  const prodName = String(row?.ProdName ?? row?.originalName ?? '').trim();
  const flowerName = String(row?.FlowerName ?? row?.flowerName ?? '').trim();
  if (/^\[(?:MEL|오경)\]/i.test(prodName) && /\bCHINA\b/i.test(prodName)) return true;
  if (flowerName === '아나나스' && /\bCHINA\b/i.test(prodName)) return true;
  return false;
}

export function hasProductIdentity(row) {
  if (!row || typeof row !== 'object') return false;
  const prodKey = Number(row.ProdKey ?? row.prodKey);
  if (Number.isFinite(prodKey) && prodKey > 0) return true;
  return Boolean(String(row.ProdName ?? row.originalName ?? '').trim());
}

/**
 * 행 자체의 원산지를 해석한다.
 * - 중국 마스터 오등록 품목은 '중국'으로 교정
 * - '사용금지'/'단종'/공란 등 비국가 상태어는 상속 가능하도록 null 반환
 * - 국내/한국은 '국내'로 명시해 타국/비수입 검증이 우회되지 않게 유지
 */
export function directProductCountry(row) {
  if (!row || typeof row !== 'object') return null;
  if (isChinaMasterPollutedAsColombia(row)) return '중국';
  const raw = row.CounName ?? row.originName;
  if (isInheritableOriginValue(raw)) return null;
  const compact = normalizeCompact(raw);
  if (DOMESTIC_TOKENS.some(t => compact === normalizeCompact(t))) return '국내';
  return baseCountry(raw) || String(raw).trim();
}

export function defaultIsGoodsDetailRow(row) {
  if (!row || typeof row !== 'object') return false;
  const prodName = row.ProdName ?? row.originalName;
  return !isFreightItem(prodName) && !isOrphanWeightDetailRow(row) && !isBlankPlaceholderDetailRow(row);
}

export function isUnmappedPaidGoodsRow(row) {
  if (!defaultIsGoodsDetailRow(row)) return false;
  if (hasProductIdentity(row)) return false;
  const amount = Number(row.TPrice ?? row.lineAmount);
  const stems = Number(row.SteamQuantity ?? row.stemQuantity);
  const outQty = Number(row.OutQuantity ?? row.outQuantity);
  return (Number.isFinite(amount) && amount > 0)
    || (Number.isFinite(stems) && stems > 0)
    || (Number.isFinite(outQty) && outQty > 0);
}

/**
 * 동일 입고(WarehouseKey) 또는 동일 11자리 AWB 내 정상 원산지 행들로부터
 * '사용금지'/'단종'/공란 품목의 원산지를 결정론적으로 상속한다.
 * - 서로 다른 2개 이상의 국가가 섞인 입고/AWB에서는 임의 상속하지 않는다(null 유지 → 기존 검증기 차단).
 * - 전산 품목 미연결(ProdKey=NULL & ProdName 공란) 행은 자동 상속하지 않고 미매핑 검토 대상으로 남긴다.
 */
export function resolveInheritedRowCountries(rawRows, { isGoodsRow = defaultIsGoodsDetailRow } = {}) {
  const rows = Array.isArray(rawRows) ? rawRows : [];
  const byWarehouse = new Map();
  const byAwb = new Map();

  for (const row of rows) {
    if (!row || !isGoodsRow(row)) continue;
    const direct = directProductCountry(row);
    if (!direct) continue;
    const wk = row.WarehouseKey ?? row.warehouseKey;
    if (wk != null) {
      if (!byWarehouse.has(wk)) byWarehouse.set(wk, new Set());
      byWarehouse.get(wk).add(direct);
    }
    const awb = normalizeAwbCode(row.OrderNo ?? row.awb);
    if (isValidAwbCode(awb)) {
      if (!byAwb.has(awb)) byAwb.set(awb, new Set());
      byAwb.get(awb).add(direct);
    }
  }

  const receiptCountry = new Map();
  for (const [wk, set] of byWarehouse) {
    if (set.size === 1) receiptCountry.set(wk, [...set][0]);
  }
  const awbCountry = new Map();
  for (const [awb, set] of byAwb) {
    if (set.size === 1) awbCountry.set(awb, [...set][0]);
  }

  function rowCountryOf(row) {
    if (!row || !isGoodsRow(row)) return null;
    const direct = directProductCountry(row);
    if (direct) return direct;
    if (!hasProductIdentity(row)) return null;
    if (!isInheritableOriginValue(row.CounName ?? row.originName)) return null;
    const wk = row.WarehouseKey ?? row.warehouseKey;
    if (wk != null && receiptCountry.has(wk)) return receiptCountry.get(wk);
    // 입고 내에 다른 타국 행이 섞여 receiptCountry가 모호해진 경우는 AWB 상속도 금지한다.
    if (wk != null && byWarehouse.has(wk) && byWarehouse.get(wk).size > 1) return null;
    const awb = normalizeAwbCode(row.OrderNo ?? row.awb);
    if (isValidAwbCode(awb) && awbCountry.has(awb)) return awbCountry.get(awb);
    return null;
  }

  return {
    rowCountryOf,
    receiptCountryOf: wk => receiptCountry.get(wk) ?? null,
    awbCountryOf: awb => awbCountry.get(normalizeAwbCode(awb)) ?? null,
  };
}

const positiveNumber = value => {
  if (value == null || typeof value === 'boolean' || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * 콜롬비아 단당 송이수(SteamOf1Bunch) 해석:
 * 1) 입고 상세(wd.SteamOf1Bunch > 0)
 * 2) 입고 상세 단·송이 역산(wd.BunchQuantity > 0 && wd.SteamQuantity > 0)
 * 3) 품목 마스터(p.SteamOf1Bunch > 0)
 * 4) 출고단위 '송이'(STEM) 또는 수국(HYDRANGEA) → 1
 * 5) 미니카네이션 → 10, 기타 콜롬비아 표준 5대 품종 기본값(ROSE:10, CARNATION:20, ALSTROMERIA:10, RUSCUS:25)
 */
export function resolveColombiaStemsPerBunch(row, groupId = '') {
  const detailSpb = positiveNumber(row?.SteamOf1Bunch ?? row?.stemsPerBunch);
  if (detailSpb) return detailSpb;

  const bunches = positiveNumber(row?.BunchQuantity ?? row?.bunchQuantity);
  const stems = positiveNumber(row?.SteamQuantity ?? row?.stemQuantity);
  if (bunches && stems) return stems / bunches;

  const masterSpb = positiveNumber(row?.ProductSteamOf1Bunch ?? row?.prodSteamOf1Bunch);
  if (masterSpb) return masterSpb;

  const outUnit = String(row?.OutUnit ?? row?.outUnit ?? '').trim().toUpperCase();
  if (['송이', 'STEM', 'STEMS', '스팀'].includes(outUnit)) return 1;

  const combined = `${row?.FlowerName ?? row?.flowerName ?? ''} ${row?.ProdName ?? row?.originalName ?? ''}`.trim();
  const normalizedGroup = String(groupId || '').trim().toUpperCase();
  if (normalizedGroup === 'HYDRANGEA' || /수국|hydrangea/i.test(combined)) return 1;
  if (/mini\s*carnation|미니\s*카네이션/i.test(combined)) return 10;
  if (CO_DEFAULT_STEMS_PER_BUNCH[normalizedGroup]) return CO_DEFAULT_STEMS_PER_BUNCH[normalizedGroup];
  return null;
}

export function resolveColombiaStemsPerBox(row) {
  const detailSpBox = positiveNumber(row?.SteamOf1Box ?? row?.stemsPerBox);
  if (detailSpBox) return detailSpBox;
  const boxes = positiveNumber(row?.BoxQuantity ?? row?.boxQuantity);
  const stems = positiveNumber(row?.SteamQuantity ?? row?.stemQuantity);
  if (boxes && stems) return stems / boxes;
  const masterSpBox = positiveNumber(row?.ProductSteamOf1Box ?? row?.prodSteamOf1Box);
  if (masterSpBox) return masterSpBox;
  return null;
}
