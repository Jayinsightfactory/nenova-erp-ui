# 인보이스 원가 계산·다운로드 독립

## 범위·기준
- 기존 native 입고/승인 원가 다운로드 유지. 업로드 인보이스는 입고연결 없이 원가 계산본을 만든다. 계산본은 미승인·입고 미반영이며 최신 승인 원가에 자동 반영하지 않는다.
- 현재 업로드 원문 수량/통화/단가/금액을 권위로 유지. native AU 저장총액5100 환산은 기존 입고 경로에만 적용한다. 두 출처를 섞거나 덮지 않는다.
- 원가 버튼은 native 연결/입고 저장/재고 SP에 의존하지 않는다. 인보이스→품목 매칭→원가 입력→미리보기→다운로드. 매칭 미완료·가격/수량 불일치·미확인 원문·분류 합계 오류는 행별로 차단한다.
- 실제 EXE MakeTempTable의 박스/단/송이/UPrice/TPrice 별도 필드, InsertMaster의 입고·재고 SP를 재확인. 이번 경로에서 호출 금지.

## 부작용
|동작|Product|Warehouse/Stock/Order/Shipment/Estimate/WebProfitReport|WebInvoice/원가 승인|
|---|---|---|---|
|인보이스 계산 준비·미리보기·엑셀|선택 품목 SELECT|보존|보존 (계산본만 반환)|
|기존 자료 다운로드|기존 조회 계약|보존|보존|

## 입력 ledger
- 연도/세부차수/sourceHash/행 UUID: normalizeInvoiceDraft. 연도 충돌 거절, 2025/2026 분리.
- 품목/단위/환산: 서버 Product SELECT와 validateInvoiceReceiptLines 공용. ERP에 저장하지 않으므로 FarmKey·invoiceYear·AWB·헤더 SQL precision/USD 운임제약만 계산 준비에서 제외. 날짜/연도 및 금액 검산은 유지.
- 국가/운송: 기존 검증 공식과 일치. 누락 비용/환율 자동0 금지, AU 운임포함 기본0 정책 유지.
- 미리보기/다운로드 같은 helper, 입력+Product 지문 대조. 다운로드 재검증 및 생성중 변경 차단. 타 문서/입력 변경 후 늦은 응답 폐기.
- UI: 기존 shell·페이지스크롤·키보드 버튼 적용. 승인 저장/ERP 반영 확인은 해당 없음(신규 경로 쓰기 없음). 기존 저장 경로의 검증은 보존.

## 검증 계획
- 신규/미입고 AU, 이미 입고 존재 AU, 전년 동일차수, 미매칭·삭제·타국품목·원문 불일치·Woolly 분류 미확인·비용누락·잘못된 공식·stale 지문.
- 서버 호출 SQL SELECT-only, 반환 계산본 원문총액 유지, 기존 native5100 및 승인 원가 guard 회귀.
- 격리 실제 UI 다운로드, 계약/빌드/CI, 코드 배포 후 운영 조회-only 스모크.
