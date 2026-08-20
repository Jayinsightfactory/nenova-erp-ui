// 주차별 매출이익 보고서 설명 UI의 단일 소스.
export const PROFIT_REPORT_EXPLANATIONS = [
  { key: 'C', label: '매출액', source: '확정 ShipmentDetail.Amount의 순수매출(N) + 확정 차수 Estimate.Amount의 불량(L)/그외매출(O)', formula: 'C = N + L + O', confirmed: 'ShipmentMaster.isFix=1 행만 집계', manual: '직접입력 불가' },
  { key: 'D', label: '매출비율', source: '같은 표의 행별 매출액(C)', formula: 'D = 행 C ÷ 전체 C', confirmed: 'C의 확정 기준을 상속', manual: '직접입력 불가' },
  { key: 'E', label: '기초상품재고액', source: '같은 연도 직전 대차수(01차만 전년도 52차)의 F 원천과 마지막 EXE ProductStock', formula: 'E = 전차수 F 재계산값; 원본 수식 카테고리는 (G+H)÷매입수량×재고수량', confirmed: 'ProductStock 존재 + 숫자 세부차수 최신순; 현재 차수 E 리터럴을 이월하지 않음', manual: '최종값 직접입력 불가' },
  { key: 'F', label: '기말상품재고액', source: '현재 대차수의 마지막 EXE ProductStock.Stock, 당주 매입·통관 원천, 검증 품목단가, 또는 수량 없는 선언 기말상품재고액', formula: 'F = (매입액+그외통관비)÷매입수량×재고수량; 매입 없으면 직전 단가×수량; 수량 없고 금액만 있으면 선언 F', confirmed: 'StockMaster.isFix 미사용; 최근원가·Product.Cost fallback 금지', manual: '재고수량 없을 때만 선언 금액 입력; 수량 있으면 단가 근거만 등록' },
  { key: 'G', label: '매입액', source: 'Warehouse 구매외화(Q), 환율(R), 포워딩(S)', formula: 'G = P + T, P = Q×R, T = S×R', confirmed: '출고확정 비대상(입고/BILL 원천)', manual: 'G 직접입력 불가; R/S 보정 가능' },
  { key: 'H', label: '그외통관비', source: '구조화 통관 원천, 입고 GW/CW, 콜롬비아 배분', formula: '저장된 통관 항목 합계와 배분 자동값', confirmed: '출고확정 비대상', manual: '수기 보정 가능' },
  { key: 'I', label: '매출원가', source: 'E/G/H/F 계산 결과', formula: '일반 I = E + G + H - F; noEnding I = E + G + H', confirmed: '구성 원천의 상태를 상속', manual: '직접입력 불가' },
  { key: 'J', label: '매출이익', source: 'C와 I', formula: '일반 J = C - I; noEnding J = C - I + F', confirmed: '매출·원가 원천의 상태를 상속', manual: '직접입력 불가. 엑셀 베트남 ±4,576,000원은 메모만' },
  { key: 'K', label: '이익률', source: 'J, C, F', formula: '일반 행 K = J÷C; noEnding 행과 합계 K = J÷(C+F)', confirmed: 'J와 분모 원천의 상태를 상속', manual: '직접입력 불가' },
];
