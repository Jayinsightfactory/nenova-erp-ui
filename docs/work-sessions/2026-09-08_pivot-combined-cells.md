# 피벗 물량표 합산셀

## 요청과 고정 기준
- 같은 연도·본차수의 선택한 시작~종료 세부차수를 업체·품목별 합산한다. 예: 36-01 10 + 36-02 20 = `30(10,20)`.
- `combineSubweeks` 생략/false/0은 기존 다운로드 그대로. `1`/`true`만 활성화.
- 기존 getPivotStats의 orders 수량과 단위 변환(알스트로 /16)을 그대로 사용한다. 출고요일 필터를 추가하지 않는다.
- 괄호 순서는 오름차순 세부차수. 없는 품목 수량은 0, 누락된 차수 버킷은 오류. 합계와 세부 합계 불일치는 다운로드 중단.
- 값은 숫자로 보존하고 표시 형식만 변경한다. 원본 양식·색상·수식·키맵 유지. 합산 옵션에서만 업체 열 폭을 확보한다.
- 서로 다른 본차수, 잘못된 연도, 단일 세부차수는 합산셀 요청에서 거부한다.

## 부작용 표
| 동작 | OrderMaster/Detail | ShipmentMaster/Detail/Date/Farm | StockHistory/ProductStock | Estimate/WebProfitReport/매출 |
|---|---|---|---|---|
| 목록 조회·일반 다운로드·합산셀 다운로드 | 보존 | 보존(Amount/Vat/isFix 포함) | 보존 | 보존 |

## 구현 전 근거
- 실제 설치 Nenova.exe를 dnSpy.Console로 FormQuantityPivot 디컴파일 확인: 차수 선택 ValueMember = OrderYearWeek, DisplayMember = OrderWeek.
- 기존 lib/pivotStats.js getPivotStats는 동일 연도 범위 집계와 byWeek 개별 행을 제공한다. 신규 SQL/ERP 쓰기 없음.
- 운영 읽기 probe: 2026, 36-01~36-02 `/api/stats/pivot-data` 성공, weeks 36-01/36-02와 byWeek 존재. 원장 변경 요청 없음.
- docs/CODEX_SUBTASK_ORCHESTRATION.md는 현재 저장소에 없음. 하위 작업은 수량 대조(read-only)로 제한, 최종 판단과 배포는 메인에서 수행.

## 검증/배포
- 운영 읽기 자료 대조: 1,442 업체·품목 조합, 범위 합계와 36-01+36-02 불일치 0건.
- test:erp-contract, test:nenova-dnspy-evidence, test:erp-manifest, guard:erp-writes, test:pivot, build 통과.
- 새 회귀 테스트: 생략/false/0/stale 옵션, 동일 이름 다른 ProdKey, 전년도 데이터 배제, 누락 차수 차단, 누락 품목 0, 합계 불일치 차단, 알스트로 변환, 소수 표시, 실제 시트 생성기·XLSX 왕복의 숫자값/수식/색상 보존.
- 배포 및 1920×1080 실브라우저 결과는 PR 검증 댓글에 기록한다.
