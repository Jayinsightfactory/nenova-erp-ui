// 견적서 관리 — 인쇄 양식 (견적서 / 거래명세표)

export const ESTIMATE_PRINT_FORMAT = {
  ESTIMATE: 'estimate',
  STATEMENT: 'statement',
};

/** 거래명세표 부가세율 — 단가의 0.1% */
export const STATEMENT_VAT_RATE = 0.001;

export function isStatementPrintFormat(printFormat) {
  return printFormat === ESTIMATE_PRINT_FORMAT.STATEMENT;
}

/** 인쇄 품목명 옆 품종 라벨 (네덜란드, 중국, 콜롬비아 카네이션 등) */
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
  return '';
}

/** 거래명세표 행 금액 — 단가 유지, 공급가액=단가, 부가세=단가×0.1% */
export function applyStatementPrintAmounts(row) {
  const cost = Number(row?.Cost) || 0;
  return {
    ...row,
    Amount: cost,
    Vat: Math.round(cost * STATEMENT_VAT_RATE),
  };
}

/** 미리보기 합계 (거래명세표는 품목별 단가 기준 근사치) */
export function computePrintPreviewTotals(items, printFormat) {
  const list = items || [];
  if (!isStatementPrintFormat(printFormat)) {
    const supply = list.reduce((a, b) => a + (Number(b.Amount) || 0), 0);
    const vat = list.reduce((a, b) => a + (Number(b.Vat) || 0), 0);
    return { supply, vat, total: supply + vat, approximate: false };
  }
  const supply = list.reduce((a, b) => a + (Number(b.Cost) || 0), 0);
  const vat = list.reduce((a, b) => a + Math.round((Number(b.Cost) || 0) * STATEMENT_VAT_RATE), 0);
  return { supply, vat, total: supply + vat, approximate: true };
}

export function getPrintFormatDocTitle(printFormat) {
  return isStatementPrintFormat(printFormat) ? '거래명세표' : '견적서';
}

export function getPrintFormatBigoSuffix(printFormat) {
  return isStatementPrintFormat(printFormat) ? '종합거래명세표' : '종합견적서';
}
