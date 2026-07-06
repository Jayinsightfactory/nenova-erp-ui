// 견적서 관리 — 인쇄 양식 (견적서 / 거래명세표)

export const ESTIMATE_PRINT_FORMAT = {
  ESTIMATE: 'estimate',
  STATEMENT: 'statement',
};

/** 거래명세표 부가세율 — 금액(공급가)의 10% */
export const STATEMENT_VAT_RATE = 0.1;

export function isStatementPrintFormat(printFormat) {
  return printFormat === ESTIMATE_PRINT_FORMAT.STATEMENT;
}

/** 원산지 열 — 국가명만 (콜롬비아, 중국, 에콰도르 …) */
export function getEstimateOriginCountry(row) {
  const country = String(row?.CounName || '').trim();
  const text = `${country} ${row?.ProdName || ''} ${row?.FlowerName || ''}`.toUpperCase();

  if (/콜롬비아|COLOMBIA/.test(country) || /\bCOLOMBIA\b/.test(text)) return '콜롬비아';
  if (/중국|CHINA/.test(country) || /\bCHINA\b/.test(text)) return '중국';
  if (/에콰도르|ECUADOR/.test(country) || /\bECUADOR\b/.test(text)) return '에콰도르';
  if (/네덜란드|NETHERLAND|HOLLAND/.test(country) || /\bNETHERLAND|\bHOLLAND\b/.test(text)) return '네덜란드';
  if (/호주|AUSTRALIA/.test(country) || /\bAUSTRALIA\b/.test(text)) return '호주';
  return country;
}

/** @deprecated 거래명세표는 getEstimateOriginCountry 사용 */
export function getEstimateVarietyLabel(row) {
  return getEstimateOriginCountry(row);
}

/** 꽃 카테고리·국가 접두어 제거 패턴 (순서 유지) */
const PRODUCT_NOISE_PATTERNS = [
  /\b(?:rose\s*china|china\s*rose)\b/gi,
  /\brose\s*\/\s*/gi,
  /\brose\b/gi,
  /\b(?:hydrangea|alstroemeria|alstro\w*|carnation|ruscus|gerbera|lisianthus|tulip)\b/gi,
  /\b(?:colombia|colombian|netherlands|holland|ecuador)\b/gi,
  /\bchina\b/gi,
  /\bcol\b/gi,
  /수국|장미|카네이션|알스트로메리아|알스트로|루스커스|거베라|리시안셔스|튤립/g,
  /콜롬비아|중국|네덜란드|에콰도르|호주/g,
  /^COL\s+/i,
];

/** 거래명세표 품목 열 — 품종명만 (lavender, fifi, 프라우드 …) */
export function getStatementProductName(row) {
  const raw = String(row?.ProdName || row?.DisplayName || '').trim();
  if (!raw) return '';

  let name = raw;
  name = name.replace(/\d{2}(?:\s*-\s*\d{2})?\s*cm/gi, ' ');
  name = name.replace(/\[[^\]]*]/g, ' ');

  for (const re of PRODUCT_NOISE_PATTERNS) {
    name = name.replace(re, ' ');
  }

  name = name.replace(/[／/]+/g, ' ');
  name = name.replace(/\s+/g, ' ').trim();
  name = name.replace(/^[,.\-:;]+|[,.\-:;]+$/g, '').trim();

  if (!name) {
    const paren = raw.match(/\(([^)]+)\)/);
    if (paren?.[1]) name = paren[1].trim();
  }
  if (!name) {
    const tokens = raw.split(/[\s/]+/).filter(Boolean);
    const last = tokens[tokens.length - 1];
    if (last && !/^(rose|hydrangea|carnation|china|col)$/i.test(last)) name = last;
  }
  return name || raw;
}

/** 인쇄·엑셀 공통 품목 표시명 */
export function formatPrintProductName(row, printFormat) {
  if (isStatementPrintFormat(printFormat)) {
    return getStatementProductName(row);
  }
  return String(row?.ProdName || row?.DisplayName || '').trim();
}

/** 규격 열 — 50cm, 75-80cm 등 */
export function getEstimateSpecLabel(row) {
  const text = `${row?.ProdName || ''} ${row?.DisplayName || ''}`;
  const m = text.match(/(\d{2}(?:\s*-\s*\d{2})?\s*cm)/i);
  return m ? m[1].replace(/\s+/g, '') : '';
}

/** 공급 단가(부가세 제외) — 합산 행 기준 */
export function getStatementSupplyUnitPrice(row) {
  const qty = Number(row?.Quantity) || 0;
  const supplyTotal = Number(row?.Amount) || 0;
  if (qty > 0 && supplyTotal > 0) return Math.round(supplyTotal / qty);
  const cost = Number(row?.Cost) || 0;
  if (cost > 0) return Math.round(cost / (1 + STATEMENT_VAT_RATE));
  return 0;
}

/**
 * 거래명세표 행 금액
 * 단가=공급단가, 금액=수량×단가, 세액=금액×10%
 */
export function applyStatementPrintAmounts(row) {
  const qty = Number(row?.Quantity) || 0;
  const unitPrice = getStatementSupplyUnitPrice(row);
  const amount = Math.round(unitPrice * qty);
  const vat = Math.round(amount * STATEMENT_VAT_RATE);
  return {
    ...row,
    Cost: unitPrice,
    Amount: amount,
    Vat: vat,
  };
}

/** 미리보기 합계 */
export function computePrintPreviewTotals(items, printFormat) {
  const list = items || [];
  if (!isStatementPrintFormat(printFormat)) {
    const supply = list.reduce((a, b) => a + (Number(b.Amount) || 0), 0);
    const vat = list.reduce((a, b) => a + (Number(b.Vat) || 0), 0);
    return { supply, vat, total: supply + vat, approximate: false };
  }
  let supply = 0;
  let vat = 0;
  for (const item of list) {
    const row = applyStatementPrintAmounts(item);
    supply += Number(row.Amount) || 0;
    vat += Number(row.Vat) || 0;
  }
  return { supply, vat, total: supply + vat, approximate: true };
}

export function getPrintFormatDocTitle(printFormat) {
  return isStatementPrintFormat(printFormat) ? '거래명세표' : '견적서';
}

export function getPrintFormatBigoSuffix(printFormat) {
  return isStatementPrintFormat(printFormat) ? '종합거래명세표' : '종합견적서';
}
