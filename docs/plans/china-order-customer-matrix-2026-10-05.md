# 중국 발주 품목×업체 수량표 — 2026-10-05

## 요청과 기준
- 첨부 `Pivot 통계_2026-10-05.xlsx`, Sheet A1:U39: 선택 2026/39-01, 세로 품목/가로 업체/오른쪽 품목 Total. 이 구조를 중국 발주 화면·엑셀에 적용한다. 파일의 필터/주문 수량은 양식 참고이며 운영 주문을 대체하지 않는다.
- 이전3+현재+다음3은 선택 범위만 유지한다. 실제 연도+세부차수 하나를 표시/다운로드한다.
- 사용자 정정: 품목 괄호의 코드번호는 앞서 올린 엑셀의 **HF CODE**다. `품목명(HF 코드) | 단위 | 총수량 | 업체명(CL 번호)…`로 표시한다. Product.ProdCode/ProdKey를 HF로 대체하지 않는다. 미등록 HF/CL은 명시하고 같은 CL/품목명도 내부키가 다르면 분리한다.
- 총수량은 현재 검색/HF 상태 필터에 포함된 업체 수량의 합. 업체 검색으로 일부 업체만 보이면 필터 합계임을 명시한다. 박스/단/송이는 행과 footer 모두 별도 집계한다.
- UI 1920×1080 CSS px/100%. 품목(HF)·단위·총수량을 좌측 고정, 업체 열 가로 스크롤. 헤더 고정, 짙은 중앙 숫자, 행 hover. 작은 화면에서는 품목+총수량 우선. 파일 헤더 wrap/자동 높이, 얇은 전체 테두리/교차 음영.
- 엑셀 첫 시트 `품목별업체수량` 추가, 기존 발주현황/업체별발주/주문상세/조회기준 유지. 단일 선택 때만 matrix. 합계는 SUM 수식, 숫자는 숫자, 모든 코드/이름은 문자열(수식 실행 금지).

## 공용 계약
`buildChinaOrderCustomerMatrix(report)` → selectedColumnKey, customers[{custKey,custName,custOrderCode}], rows[{rowKey,prodKey,prodCode,prodName,unit,quantities[custKey],total}], totals[{unit,quantities[custKey],total}].
연도/fullOrderWeek 검증 후 실제 orders에서만 집계. 표와 Excel 동일 helper. 비정상 수량/업체 정보 모순/다른 차수 혼입 차단. HF는 기존 exact mapping 정책 유지.

## 기준 ledger·부작용
| 동작 | 주문 Order* | 출고 Shipment*/Date/Farm | Warehouse*/Stock* | Estimate/Amount/Vat/isFix/WebProfitReport |
|---|---|---|---|---|
| 조회/필터/수량표 표시 | SELECT 결과 집계만 | 보존 | 보존 | 보존 |
| HF 업로드 | 보존 | 보존 | 보존 | 보존 |
| Excel 다운로드 | 동일 orders 메모리 집계 | 보존 | 보존 | 보존 |
API SQL/EXE/SP/스키마 변경 없음. `ViewOrder.OutQuantity` 단일값이 수량 원천, 동일 연도/fullOrderWeek/CustKey/ProdKey 유지. 기존 환산/확정/인쇄 경로 호출 금지.

## 준비 근거·검증
main 실제 dnSpy CLI FormQuantityPivot.GetData 재실행: `vo.OutQuantity Quantity`, `ViewOrder vo`, `WHERE vo.OutQuantity > 0` 확인. 운영 read-only 2026/40 7차수 1336주문/42업체, 실제 40-03 포함. 첨부 render+값 검사 완료. 인증정보/raw 고객자료는 output에만 보관.
회귀: 같은 CL 다른 업체/같은 품목명 다른키, 소수/빈값, mixed units, 전년 같은주/03/03A, 검색후 합계와 다운 일치, 입력 리터럴, stale 차수/실패 다운로드, 양끝 스크롤/sticky/100%/1100px.
필수: ERP contract, manifest, dnSpy evidence, write guard, build, production browser와 Excel 재읽기/렌더, 배포후 운영 smoke.

## 담당
main 설계·모델·UI·통합·외부 작업. 범위 확정된 Excel 구현은 gpt-6-luna/high (지정 terra/저비용 모델 미제공으로 사용 가능한 경제 모델 대체). 최종 독립 검토 gpt-5.6-sol/xhigh. 하위작업 승인/외부 쓰기/운영 쓰기 금지.
