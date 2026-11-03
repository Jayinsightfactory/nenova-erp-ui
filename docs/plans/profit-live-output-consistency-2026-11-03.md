# 운영 화면·엑셀 검증기 일치 진단

- 기준 4ffcdccf4 / 전용 codex/profit-live-output-consistency. 운영 46차 E 차이 경고의 원인은 아직 미확정.
- 가드 스킬과 저장소 지침 확인. 이전 작업에서 읽은 ERP 지침은 d0651146 이후 변경 없음을 대조. 실제 dnSpy FormWarehouseView 실행에서 OrderYear/OrderWeek 확인.
- 기존 SELECT-only 46차 산출물을 확인: 콜롬비아 수국 auto.E와 calc.E는 모두 60,188,985.606695466. 이 과거 산출물은 실패 시점 증거를 대체하지 않는다.
- 실제 웹은 profitDisplayCalculation을 사용하지만 운영 smoke는 confirmed만 검사하고 computeProfitRow로 다시 계산했다. 검증기를 실제 화면의 공통 함수와 맞추고 실패 때 허용된 집계 금액·재고 평가 메타만 기록한다.
- DB/스키마/저장·확정·재고·출고·견적 및 실제 금융 계산 코드는 변경하지 않는다. 검증 차이를 허용하거나 경고를 숨기지 않는다.
- 상태/count뿐이던 진단 로그에 차이 난 국가·열·양쪽 집계 값·차액과 선택된 기초/기말 평가 연도·차수·평가식 숫자만 추가한다. 원문 응답·인증정보·업체/개인정보·원문 sources는 출력하지 않는다.
- 기준표: 화면/엑셀은 공통 표시 계산, tolerance 기존 1e-8 유지, 이전 연도 입력 격리, frozen/confirmed/templateDuty 보존, 일반 live에는 기존 계산 적용.
- 표적 회귀 후 full verify, dnSpy, origin/master manifest/write guard 및 build를 수행한다. 운영 46차 진단은 부모가 CI로 수행한다.

| 동작 | ERP 원장 / Estimate / ShipmentDetail.Amount,Vat,isFix | WebProfitReport/확정/저장본 |
|---|---|---|
| 운영 GET 및 다운로드 비교 | 보존 | 보존 |
| 실패 진단 | 집계 필드 whitelist만 읽기 | 변경 없음 |
