# 호텔 다음1차 도착원가 참조

> 후속 2026-10-05 사용자 지시에 따라 이 보고서의 최고 원가 한 건 선택은 폐기되었다. 현재 정책은 [농장·출처별 전체 참조](2026-10-05_hotel-arrival-all-farms.md)다. 다음1차 조회 범위는 그대로 유지한다.

## 확인한 문제와 정책

은화호텔 `hotel_87bc41c16ae5`의 2026년 39차 왁스 화이트는 `ItemKey=7738`, `ProdKey=2330`, 단위 `단`으로 정상 연결되어 있다. 원가는 같은 연도 `40-1`에 등록되어 있지만 참조 쿼리의 `MajorWeek<=39` 제한 때문에 화면에서 제외되었다.

`lib/raumPnl.js`의 기존 호텔 업무창은 `N-02 + (N+1)-01`이다. 이 근거와 요청에 맞춰 기존 같은 대차수의 모든 세부차수 표시는 유지하고, 같은 연도의 **정확한 다음 대차수 1차**를 추가한다. 같은 대차수 자료를 먼저 표시하고 다음1차를 뒤에 표시한다. 다음2차나 더 먼 미래 차수는 포함하지 않는다.

같은 대차수 또는 다음1차 자료가 있으면 그 범위만 참조한다. 둘 다 없을 때만 같은 연도에서 가장 최근 과거 대차수의 모든 세부차수를 표시한다. 연말에 다음 연도로 넘어가지 않는다. 2026-09-15 계약의 미래 차수 전체 제외 규칙은 이 명시적 다음1차 예외로 대체했다.

## 읽기 근거

- `node scripts/local-wax-probe.mjs`: 결산 연결과 2026 `40-1` 활성 양수 `WebArrivalCostLine` 확인. 스크립트는 로컬 진단용이며 커밋 대상이 아니다.
- 변경된 `loadRaumPnlArrivalReferences({orderYear:'2026',major:39,items:[{itemKey:7738,prodKey:2330,unit:'단'}]})`를 운영 DB에서 SELECT로 실행했다.
- 결과: `40-1`, `11450.6709원/단`, 원본 단위 `단`, `isNextHotelWeek=true`, `sourceMajor=40`, `requestedMajor=39`, 환산 오류 없음.
- 출처: `CHINA 중국 원가자료 (40-1차) - 해상.xlsx`, `해상` 42행, `MELODY`. 같은 차수에 원가가 여러 개면 최고 원가를 쓰는 기존 정책을 보존했다.
- dnSpy CLI `FormWarehouseView` 재실행 성공. `GetData`에서 연도/차수, `GetDetail`에서 `WarehouseDetail.UPrice/TPrice` 조회 확인. 웹 전용 참조 정책을 EXE 원가 저장 규칙으로 해석하지 않는다.

## 부작용 범위

| 대상 | 동작 |
| --- | --- |
| WebArrivalCostLine, Product | 선택 연도·상품의 SELECT |
| WebRaumPnlItem.CostPrice, 원본 도착원가 | 보존 |
| OrderMaster/Detail, ShipmentMaster/Detail, ShipmentDate/Farm | 보존 |
| Warehouse, ProductStock, StockHistory | 보존 |
| Estimate, ShipmentDetail.Amount/Vat/isFix, WebProfitReport | 보존 |
| 엑셀·인쇄·저장 payload | 기존 그대로 |

`isNextHotelWeek`와 실제 `sourceMajor`는 화면 참조 구분용이다. 매입원가를 자동 선택하거나 저장하지 않는다. 여러 차수를 한 번에 조회할 때도 각 행의 선택 대차수를 기준으로 다음1차를 판단한다.

## 검증

`node __tests__/raumPnlArrivalReference.test.js` 통과. 실제 사례와 현재+다음1차 조합, 다음2차·더 먼 미래·다른 연도·다른 상품 제외, 잘못된 차수 문자열 제외, 숫자상 같은 padded 차수 통합, 과거 fallback, 배치 차수별 범위 및 원본·저장값 불변을 확인했다. 전체 ERP 검사·빌드·1920×1080 실브라우저 확인은 메인 작업에서 수행한다.


## 모든 호텔 저장 단가 읽기 API

추가된 `lib/pnlHotelCostHistory.js`와 `GET /api/raum/hotel-cost-history?year=2026`은 모든 활성 호텔의 해당 연도 저장 원가를 반환한다. 각 행은 `partnerCode/partnerLabel`, `prodKey/unit/isCustom`과 원래의 `CostPrice`를 가진다. 이 API는 매칭이나 저장을 수행하지 않으며 기존 호텔별 편집 API를 바꾸지 않는다.

운영 SELECT 검증 결과 2026년 764행: 라움 499, 신라 213, 초이문 50, 은화 2. 다른 연도 및 NULL 원가는 각각 0행이고 명시적 0원은 1행이었다. 은화 39차 왁스 화이트의 저장값 `8280원/단`이 그대로 반환되었다. 도착원가 참조 `11450.6709원/단`은 별도 정보다.

화면에서 호텔 간 비교할 때는 동일 양수 `ProdKey + Unit + IsCustom`을 사용하고 미연결 이름 fallback은 현재 호텔 내부로 제한한다. 단위를 환산하거나 저장값을 평균내지 않는다. 실패는 비어 있는 조회 결과로 위장하지 않고 오류로 반환한다. `node __tests__/pnlHotelCostHistory.test.js` 통과.

메인 검증: test:erp-contract, test:nenova-dnspy-evidence, test:erp-manifest --changed-from 7a6be692, guard:erp-writes --changed-from 7a6be692, npm run build 모두 통과. 신규 조회 API 포함 manifest/write guard 재확인 통과. 호텔별 hover fixture는 다른 연도·다른 상품·다른 단위 제외, 미연결 현재호텔 제한 및 입력 rows 불변을 확인했다.
