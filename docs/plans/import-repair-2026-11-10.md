# 수입 인보이스 매칭·비용·다운로드 정합 보완

## 기준 원천
- 2026-11-10 실제 dnSpy ExcelLoadingPackingList: Box/Bunch/Steam/UPrice/TPrice 별도 보존, CreateWarehouse 후 StockCalculation. EUR금액을 USD요율에 쓰지 않는다.
- 운영 SELECT-only NL46-01 입고8069: 상품11행1391.90EUR, 웹문서 운송321.49+문서50, 송장1763.39. GW102/CW114. 원장 운송료행0.
- 기존 원장 운송료 행과 웹문서 비용은 중복 가산 금지. 확인된0과미기재를 구분한다.

## 부작용·판정 기준
| 동작 | 웹매칭 | 웹문서 | Warehouse/Stock | Order/Shipment/Estimate/Profit |
|---|---|---|---|---|
| 일반품목 선택 | 기존 CAS로 원문+국가 매칭 저장 | 현재 행 선택 보존 | 보존 | 보존 |
| Woolly 분류 | 공용매칭 금지 유지 | 파일별 분류만 | 보존 | 보존 |
| 입고 비용 조회 | 읽기 | 같은입고/연도/차수의 COMMITTED 문서 및 live receipt 검증 후 비용 읽기 | SELECT만 | 보존 |
| 원가 preview/download | 보존 | 보존 | SELECT만 | 보존 |
| 테스트 입고등록 | 격리환경만 | 기존writer | 기존contract/native효과 검증 | 보존 |

## 구현 원칙
- 과거8069 자동보정·재업로드 없음. 웹입고문서에 이미 저장된 통화별 비용을 입고번호에 검증연결하여 표시·원가에 사용한다. ERP 운송료행을 생성한 것으로 표시하지 않는다.
- 두 다운로드 버튼은 수동입력 이후 동일한 현재 입력 payload를 사용. 수정전 자동버튼의 기본값 편의는 유지하되 수정값을 무시하지 않는다. stale/공식미확인 상태는 사유표시.
- 원문 수량(박스/단/송이 각각)과 상품합계/운송/문서/총송장금액은 매칭 전후 유지. 다른단위 합산 금지.
- 정상항목은 기본접힘, 수정필요만 표시. 확인은 실제문제만 요구. 원문별 다중상품 분류는 공용자동학습 제외.
- 미검증·오류를 숨겨 다운로드나입고완료로 표시하지 않음. 추가 유료분석0, 운영DB쓰기0.

## 검증 계획
- 8069 원본+저장AI 재사용 격리 SQL 저장·readback·수량/총금액 대조. browser 다운로드 XLSX 입력환율/품목관세 실제셀·재계산 확인.
- 기존운송료/sidecar일치·충돌/0/미기재/다른연도·차수/다른receipt/stale/noncommitted 반례.
- 다른국가 동일회귀 및 실제저장분석 중 재현가능자료. 실파일전체E2E와 합성회귀를 구별.
- ERP전체/dnSpy/manifest/writeguard/webpack build·가이드·PR CI·배포·운영readonly스모크. 아직 미실행.

## 후속 결과
- NL46 실제 브라우저 격리 입고→동일차수 원가→수정환율1600/관세25% 다운로드 및 XLSX 재계산 PASS.
- TH38 실제 입고→시험비용 명시 다운로드 및 재계산 PASS. 실제 비용 검증 아님.
- 8국가 공통 매칭/합계, 10공식 XLSX 회귀와 전체 ERP 계약 PASS. 모든국가 실파일 전체E2E와는 구별한다.
- 원가 연결은 exact document/current revision/year/week/warehouse 및 live readback을 공유한다. 상세 결과는 세션 기록 참조.
