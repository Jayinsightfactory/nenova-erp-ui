# 콜롬비아 입고 차수 통합 도착원가

상태: 조사·구현 중, 미배포. 중국 발주서 PR1883과 분리한 작업이다.
기준 origin/master29f275c5, branch fix/co-arrival-week-1119.

## 확정 범위

명시 OrderYear+country CO+정확 OrderWeek의 활성 입고 전체를 읽는다.
일반꽃과 수국을 모두 포함한다. 입력 파일 분할/합산은 입고 원장의 범위를 바꾸지 않는다.
출력은 해당 차수 기존 콜롬비아 원가양식의 단일 합친 시트이며, 별도 첫 요약/AWB 시트를
추가하지 않는다. 과거 차수 원본과 통합본 버전은 덮지 않는다. 늦은 입고는 새 snapshot
버전으로 포함하며 기존 입고를 재등록하지 않는다.

## 선검증

2026-11-19 설치 Nenova.exe를 dnSpy CLI FormWarehouseView로 직접 실행했다.
GetData는 활성 WarehouseMaster와 상세 수량 합계를 읽고, GetDetail은 WarehouseKey로
WarehouseDetail+Product를 읽는다. 웹 계산은 이 SELECT 경계만 사용하고 삭제·입고·SP를
호출하지 않는다. 실제 스키마에 AWB 전용 헤더 컬럼은 없고 OrderNo를 검증해야 한다.
운영 SELECT: 2026/46-02 콜롬비아 품목이 연결된 활성입고22건, 품목연결상세94행
(상품/비용 분리 전), TPrice합계17,373.7. 전년도 같은46-02는25입고/90행으로 분리된다.
22헤더 OrderNo는 모두01441369974로 정규화된다. GW/CW/운임/서류비 누락을 0이나
전체 AWB 근거로 바꾸지 않는다. private probe와 EXE 출력은 .verify에만 보관한다.

새 SELECT source helper를 운영 읽기에 실행한 결과22입고/94상품행/1AWB,
HYDRANGEA25·CARNATION26·ROSE24·ALSTROMERIA19행, 상품귀속 이슈0을 확인했다.
별도 비용참고6행은 상품에 합산하지 않았다. 같은 AWB의 비용전표8109에
운임행13651.92/85.88, GW3942/CW4824가 있으나 다른 두 송장의15/15 비용은
귀속 근거를 확인하기 전 공동 운임으로 임의 합산하지 않는다. 원가 확정은 미검증이다.

현재 native-shared-cost는 MAIN/HYDRANGEA를 분리하고 사용자가 적은 단일 AWB를
전체 범위에 붙인다. 이 경로를 임의로 확장하지 않고 새 exact-week service를 붙인다.
기존 과거차수·개별 인보이스·공동AWB 계산과 출력은 보존한다.

## 기준 ledger

- receipt identity: OrderYear+OrderWeek+CO+WarehouseKey+WdetailKey, 원문 수량/단가/TPrice 보존.
- AWB: 같은 범위의 OrderNo/검증된 문서 근거만 정규화. 빈 값·상충은 그 행만 확인필요.
- 상품 분류: 기존 suggestGroup 및 calculateSharedAwbCost 재사용. 이미 유일한 분류를
  전 행 수동확인으로 바꾸지 않는다. 불명 품종/포장계수만 확인필요다.
- 운임/CW: 정규화 AWB별 단일 비용근거. 같은 AWB 중복입력 차단, 다른 AWB간 배분금지.
- 통관비: 명시 증빙 ID+대상 AWB 집합을 가진 pool을 한 번만 계산, 공유pool은 GW 기준
  분할 후 각 AWB 내부의 기존 무게배분식 사용. 같은 금액인 별개 증빙은 삭제하지 않는다.
- 혼합 품종 FB 환산은 원본 검증값 필수, 물리 QB/HB 박스수를 임의FB로 바꾸지 않는다.
- calculate→download 재조회 지문 일치, 소스 추가/변경은 명시 재조회 및 새 버전 필요.
- 신규 sheet만 파일전용 append-only 원본 보관, 과거 시트/버전/ERP 원장 보존.
- JS/React/일반 DB대기 CRUD이므로 Rust hotpath 해당 없음.

## 부작용

| 동작 | Warehouse/Order/Shipment/Stock/Estimate/WebProfitReport | 웹 파일 |
|---|---|---|
| 입고·근거 조회 | SELECT/보존 | 없음 |
| 비용 귀속 확인·계산 | 보존 | 없음 |
| 명시 다운로드 | 보존 | 새 불변 버전 |
| 늦은 수국 추가 후 재조회 | 기존입고 보존 | 다음 다운로드 새 버전 |

## 검증

합산/분할 원천 동일행 다중집합→동일 계산, 동일AWB22입고 운임1회·CW1회,
다른AWB2개 독립배분, 공유통관1회, 별개동액증빙보존, 부분/상충근거검토,
동일수량별개상세보존, 늦은수국추가시source-stale/새버전/기존버전불변,
2025동일차수 및 타국격리, 1개 차수시트·기존수식/금액/재계산 의존성 검증.
기존 계산코어+독립검산+실제Desktop격리 네이티브저장/Excel재열기·입력변경/복원,
실제버튼/결과캡처, 필수ERP/desktop CI/가이드 및 배포readonly smoke를 완료해야 한다.

가장 큰 약점: 과거 입고의 AWB별 CW·운임 및 공유 통관 청구근거가 없을 수 있다.
그 경우 출처를 추측하지 않고 해당 비용귀속만 확인필요로 남긴다. 현재 입력/헤더가
과거 실제 청구액이라는 인증도 하지 않는다. 운영 DB 테스트쓰기·유료분석은 금지다.
