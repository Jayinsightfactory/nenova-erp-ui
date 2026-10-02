# 주광 요일표 압축 표시와 ERP 확정 상태 확인

## 요청 / 범위

- 합계·마감잔량·변경·견적 표시를 짧고 정렬된 구조로 모은다.
- 수량은 셀 중앙, 기본 16px 진한 숫자로 표시한다. 좁은 셀은 단위별 줄바꿈을 허용하고 겹치지 않는다.
- 이전/현재/다음 연도·메인차수 제목 옆에 CountryFlower별 ERP 확정 상태를 표시한다.
- 요일 변경/견적 인쇄의 실제 EXE 조건과 웹 차이를 조사한다. 확정 해제/자동 확정/재확정 흐름은 추가하지 않는다.

## 기준 원천 / 소비자

| 기준 | 근거 | 소비자 |
|---|---|---|
| ERP 상세 확정 | 실제 CLI FormShipmentDistribution.GetFixStatus / FormEstimateView.GetPrintDetail: DetailFix=1 | 새 읽기 전용 확정 현황 API 및 차수 제목 배지 |
| 메인차수 범위 | 명시 OrderYear + 정규화 NN 대차수, 모든 NN-SS 세부차수 | 상태 SELECT / 순수 응답 집계 / 클라이언트 응답 확인 |
| 품종별 확정 범위 | Product.CountryFlower, 전체 거래처(공용 EXE 확정 범위) | 배지 title에 범위와 상세 건수 표시; 현재 품목/업체 필터로 축소하지 않음 |
| 상태 | 양수 분배행 전체 확정 / 일부 확정 / 미확정 / 자료 없음 / 조회 불명 | 자료 없음·실패를 확정으로 표시하지 않음; NULL isFix는 미확정 |
| 최초 기준 보관 | 기존 웹 전용 baseline | ERP 확정 배지와 별개. 최초 값·잔량 계산·수동 이월 보존 |

## 부작용

| 동작 | ERP Order/Shipment/Date/Farm/Stock/Estimate/WebProfitReport | 웹 기준·비고·이월 |
|---|---|---|
| 확정 현황 읽기 / 압축 표시 / 운영 smoke | SELECT only, 모두 보존 | 보존 |
| 기존 수량 입력 / 저장 / 출력 | 기존 핸들러·payload·SQL·상태 정책 변경 없음 | 기존 정책 보존 |

실제 CLI 재추출은 FormShipmentDistribution.SetButton의 확정 시 btnSave 비활성,
FormEstimateView의 확정 상세만 조회하는 조건을 확인했다. 이는 '모든 행이 확정됐는지
자동 보장'하는 SQL 조건과 다르다. 일부 확정은 견적 일부 누락 위험으로 보고하며,
원장 확정 상태를 UI 요청만으로 변경하지 않는다.

## 검증

- 동일 대차수의 01/02/추가 세부차수, 타 거래처, 타 품종, prior-year sentinel 포함 순수/API fixture.
- 전체/부분/미확정/NULL/자료 없음/조회 실패/잘못된 count 및 응답 scope 검증.
- 로컬 1920×1080/100%, 1280×800: 셀 중앙/글씨/겹침/헤더 배지/수동 잔량·비고/가로 스크롤/실패 표시.
- ERP 회귀·dnSpy 근거·manifest·쓰기 스코프·빌드. 운영 시험 저장 없음.
- 고성능 검토 담당은 EXE 작업 조건/웹 부작용을 read-only 분석한다. 범위 확정 구현은 중간 모델, 기계 검증은 저비용 모델. 지정 모델이 없으면 동일 등급 사용 가능 모델로 대체한다.
