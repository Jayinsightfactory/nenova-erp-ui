# 모든 호텔 매입단가·도착원가 참조 보완

## 완료 기준

- 차수별 매입단가 관리에서 라움·초이문 공통 단가와 신라 및 등록 호텔별 독립 단가를 선택·조회·수정·저장할 수 있다.
- 등록 호텔별 저장은 해당 `PartnerCode + OrderYear + MajorWeek + PnlKey + ItemKey` 범위만 수정하며 다른 호텔 및 ERP 원장을 변경하지 않는다.
- 호텔 손익 상세의 1개당 매입단가 바로 옆에서 같은 `OrderYear + MajorWeek + ProdKey`의 현재 도착원가를 세부차수별로 확인할 수 있다.
- 도착원가는 원본 단위에서 상세 품목 단위로 환산할 수 있을 때만 표시하고, 환산 불가·미연결은 명확히 표시한다.
- 도착원가 참조는 상세 웹 조회 전용이며 엑셀·인쇄 데이터에는 포함하지 않는다.
- 전년도 동일 차수 및 다른 품목의 도착원가가 섞이지 않는다.

## 보존 범위

- 매입단가 저장은 `WebRaumPnlItem.CostPrice/CostSource`와 부모 감사 필드만 변경한다.
- `OrderDetail`, `ShipmentDetail`, `ShipmentDate`, `ShipmentFarm`, `Warehouse*`, `StockHistory`, `Estimate`, `WebProfitReport`, 도착원가 원장은 읽기 전용으로 보존한다.
- 라움·초이문 공통 저장 계약은 그대로 유지하고, 신라·등록 호텔은 서로 독립 저장한다.

## 검증

- 순수 변환/범위 테스트, API 범위 테스트, 엑셀·인쇄 비노출 테스트
- ERP 계약·dnSpy 근거·쓰기 가드 및 Next.js 빌드
- 1920×1080 실브라우저에서 호텔 전환, 상세 도착원가 열, 가로 스크롤, 저장 상태 확인

## 로컬 결과

- `npm run test:raum-pnl` 통과
- `npm run test:erp-contract` 통과
- `npm run test:nenova-dnspy-evidence` 통과
- `npm run test:erp-manifest -- --changed-from origin/master` 통과
- `npm run guard:erp-writes -- --changed-from origin/master` 통과
- `npm run build` 통과 (Next.js 16.3.4)
