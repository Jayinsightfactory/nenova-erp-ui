# 업체별 운임 제안 근거 복원

사용자: 기존 전수 분석대로 업체마다 다르게 적용해야 한다.

## 발견

9/18 전수 확인 문서는 서부꽃집 3,000원, 월드천사 1,000원 등 차이를 기록했지만 모달은 공통 1,500/2,000원을 사용했다. 중국/태국 묶음도 고객 근거와 무관했다. 문서에는 모든 업체의 세부차수 합산 규칙이 입증되어 있지 않다.

## 기준 및 부작용

- 동일 CustKey, 선택 연도, 현재 포함 최근 8개 대차수의 기존 EXE-parity 견적 GET을 순차 조회한다. 다른 업체/다른 연도/미래차수 가격을 쓰지 않는다.
- 정상 양수 박스 운임만 가격 근거. Estimate/차감 제외. 최신 대차수의 같은 세부차수 가격 우선, 상충 시 빈값. 공통 가격 fallback 없음.
- 국가명 운송료로 묶는 후보는 해당 업체의 실적 품명으로 확인한다. 계산 후보는 등록 동의가 아니며 기본 체크 없음.
- 기존 행 하나만으로 1/2차 합산을 추정하지 않는다. 현재 구현은 별도 차수/날짜 저장 유지. 합산 자동화는 추가 근거 필요.
- 조회/선택/계산은 모든 ERP 원장 보존. 적용은 기존 추가품목 경로 유지. OrderDetail/ShipmentDetail/ShipmentDate/Stock/Estimate/WebProfitReport SQL 변경 없음.
- EXE 저장 decompile `C:/Users/USER/nenova-decompiled/Nenova/FormEstimateView.cs` GetDetail(216~319): ViewShipment+ViewOrder+ShipmentDate, DetailFix=1, 날짜 Cost. 새 SQL 없이 같은 API 재사용.
- 앞선 운영 읽기 확인: 2026 37 영남꽃소재 운송료1,500/상차2,000, 기존 상차43박스. 이것만으로 합산정책을 확정하지 않는다.

## 검증

estimateFreightDraft 실행형 fixture: 고객/교차연도/미래 제외, 차감 제외, 서로 다른 고객 가격, 가격충돌, 세부차수 가격, 이력 없는 국가 묶음 금지.
배포와 브라우저 검증 결과는 완료 후 기록한다.
