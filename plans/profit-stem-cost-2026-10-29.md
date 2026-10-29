# 주차별 원가 송이 정규화 — 기준·부작용

## 요청과 범위

운영 DB는 변경하지 않는다. 웹 계산 수량을 송이로 정규화하고 표시만 단·박스로 환산한다. 같은 품목의 기초+당차입고 가중평균 취득원가를 사용하고 기존 엑셀식과 차이를 보여준다.2026 실제 전체차수 및38·39차를 읽기 검증하고 테스트/CI/배포한다.

## 기준 ledger

| 항목 | 기준 |
|---|---|
| 업무키 | OrderYear+OrderWeek+ProdKey 및 실제 원행 PK. 다른연도/농장/입고행 first-match 금지 |
| 원천 송이 | 입고/출고 당시 저장 SteamQuantity 우선. 값 존재/유효성 및 원행 상호대사 필요. 포워딩/GW/CW/비재고 항목 제외 |
| 역사 환산 | 당시 입고 환산 및 같은 품목 역사 원행의 입증된 변환만 사용. 현재 Product 설정으로 과거 수량 임의 역산 금지 |
| 단위 구분 | 원본 포장단, 전산 판매단, Stock의 OutUnit을 분리. COLON15송이포장단과 현재10송이판매단이 같은 단위가 아님 |
| 원가 | 같은 ProdKey의 기초원가+입고도착원가를 기초송이+입고송이로 나눔. 품목간 무조건평균 금지. 금액/분모의 scope와 단위를 일치시킴 |
| 누락 | 송이·환산·환율·운임·기초원가 또는 양수조정 취득원가 미확인은0이나판매단가로 대체하지 않음 |
| 재고/출고 | StockHistory,ProductStock은 원래단위 보존. 송이환산 근거와 수량흐름 대사 없으면 해당평가 보류 |
| 보고서 산식 | 새 E/F는 품목별 송이평가. C/G/H 및 I=E+G+H−F,J=C−I,K의 기존 국가/합계분모를 보존해 비교. 판매마진(ship×WAC)과 보고서K를 혼용하지 않음 |
| 원가 중복 | 도착원가 포함 운임/통관비를 재고평가와 매출원가 합산에서 중복 추가하지 않음 |
| 저장본 | 기존 DB 계산/확정snapshot 불변. 본표에서 신규 송이기준과 기존엑셀식 저장참고를 명확히 분리. 자동DB갱신 없음 |
| 빠른 조회 | 기존 저장조회 유지. 무거운 신규원천 계산은 명시조회, 상태/취소/범위변경/실패를 표시 |
| 전체 차수 | SQL에 있는 연도별 차수목록을 명시하고 완료/진행/미래를 구분. 미존재 차수를 계산성공으로 표시하지 않음 |

## 부작용 행렬

| 동작 | 주문/출고/ShipmentDate/Farm | Estimate/매출 | Stock/ProductStock/StockHistory | WebProfitReport/확정/계산Snapshot |
|---|---|---|---|---|
| 기존 조회 | 보존 | 읽기/보존 | 읽기/보존 | 읽기/보존 |
| 송이계산/비교 | SELECT만 | SELECT만 | SELECT만 | SELECT만 |
| 검증/실패/시간초과 | 보존 | 보존 | 보존 | 보존 |
| 코드배포 | 보존 | 보존 | 보존 | migration/보정 금지 |

## 실제 전산 근거

2026-10-29 설치 Nenova.exe를 dnSpy.Console로 재조회했다. FormWarehouseView.GetDetail은 WarehouseDetail.BunchQuantity/SteamQuantity/OutQuantity/SteamOf1Box/SteamOf1Bunch를 읽는다. ClassShipmentDetail.Insert/Update는 BoxQuantity/BunchQuantity/SteamQuantity/OutQuantity/EstQuantity를 별도로 저장한다. 판매단위와 물리수량을 같은값으로 강제할 근거가 없다. 이전조사PDF의 원본 송이와 SQL송이는 일치하며195단 차이는20대10송이 단수혼재다.

## 검증·배포 차단

-10/15/20송이 포장표현을 바꿔도 같은송이·금액이면 평가액동일한 실행fixture
- cross-year/duplicatePK/명시0/누락/불일치/음수·양수조정/부분원가/분모0/이월fixture
- 26~31원본수식 비교, 전체차수SELECT-only 원천대사,38/39 품목별 결과
- manifest/dnSpy/writeguard/전체ERP/build/격리UI/PRCI/배포/ping
- 근거없는 숫자채우기, 새계산실패를기존값으로정상대체, DB쓰기, 필수검사실패는배포차단
- 사용자로그인브라우저 도구가복구되지않으면 미검증범위를명시한다.
