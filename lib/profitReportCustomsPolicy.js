// 매출원가 양식의 콜롬비아 배분 표. 공용 도착원가/운송기준원가 설정은 변경하지 않는다.
export const PROFIT_REPORT_COLOMBIA_BOX_RATES = Object.freeze({
  BoxWeight_콜롬비아장미: 7,
  BoxWeight_콜롬비아카네이션: 11,
  BoxWeight_콜롬비아알스트로: 9.7,
  BoxWeight_콜롬비아루스커스: 8,
  BoxWeight_콜롬비아수국: 5.6,
  BoxCBM_콜롬비아장미: 10,
  BoxCBM_콜롬비아카네이션: 11,
  BoxCBM_콜롬비아알스트로: 7,
  BoxCBM_콜롬비아루스커스: 9.6,
  BoxCBM_콜롬비아수국: 7,
});

export function applyProfitReportColombiaRates(baseRates) {
  return { ...baseRates, ...PROFIT_REPORT_COLOMBIA_BOX_RATES };
}
