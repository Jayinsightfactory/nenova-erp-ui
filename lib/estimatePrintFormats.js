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

/** 원산지/품종 열 — 콜롬비아 장미, 콜롬비아 카네이션, 중국, 네덜란드 등 */
export function getEstimateVarietyLabel(row) {
  const country = String(row?.CounName || '').trim();
  const flower = String(row?.FlowerName || '').trim();
  const prod = String(row?.ProdName || '').trim();
  const text = `${country} ${flower} ${prod}`.toUpperCase();

  if (/에콰도르|ECUADOR/.test(text)) return '에콰도르 장미';
  if (/콜롬비아|COLOMBIA/.test(country) || /COLOMBIA/.test(text)) {
    if (/카네이션|CARNATION/.test(flower) || /CARNATION/.test(text)) return '콜롬비아 카네이션';
    if (/장미|ROSE/.test(flower) || /ROSE/.test(text)) return '콜롬비아 장미';
    if (/수국|HYDRANGEA/.test(flower) || /HYDRANGEA/.test(text)) return '콜롬비아 수국';
    if (/알스트로|ALSTRO/.test(flower) || /ALSTRO/.test(text)) return '콜롬비아 알스트로';
    if (/루스커스|RUSCUS/.test(flower) || /RUSCUS/.test(text)) return '콜롬비아 루스커스';
    return '콜롬비아';
  }
  if (/중국|CHINA/.test(country) || /CHINA/.test(text)) return '중국';
  if (/네덜란드|NETHERLAND|HOLLAND/.test(country) || /NETHERLAND|HOLLAND/.test(text)) return '네덜란드';
  if (/호주|AUSTRALIA/.test(country) || /AUSTRALIA/.test(text)) return '호주';
  if (/수국|HYDRANGEA/.test(flower) || /HYDRANGEA/.test(text)) return '수국';
  if (/알스트로|ALSTRO/.test(flower) || /ALSTRO/.test(text)) return '알스트로메리아';
  if (/카네이션|CARNATION/.test(flower) || /CARNATION/.test(text)) return '카네이션';
  if (/장미|ROSE/.test(flower) || /ROSE/.test(text)) return '장미';
  return country || '';
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
