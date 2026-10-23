# 2026-10-23 재고 환산 근거 복구 — 읽기 전용

## 승인 범위와 기본값

- 사용자가 승인한 SQL 수량 기준 평균 도착원가 틀은 유지한다. DB/EXE/입출고 수량/가격 원장/확정 revision 변경 금지.
- 변경은 `normalizedCountryInventoryQuantities`의 SELECT 근거 및 순수 환산 정책으로 제한한다. 원가·환율 우선순위 변경은 별도 작업이다.
- 단순 최신 비율, 다른 샘플, 임의 FIFO로 잔존 lot를 추정하지 않는다. 기존 계산에 문제가 없는 품목은 기존 경로 그대로 보존한다.
- 같은 연도·품목의 실제 숫자 세부차수 스냅샷에서 마지막 확실한 잔량 0을 찾는다. 평가 스냅샷 이후, 타연도, 누락·잘못된 차수는 근거에서 제외한다.
- 같은 세부차수의 StockMaster는 기존 보고서와 동일하게 ProductStock 전체 행 수, StockKey 내림차순으로 canonical 1개를 선택한다. 품목이 없음을 0으로 간주하지 않는다.

## 실제 dnSpy / SQL 근거

실행 명령(2026-10-23):

```powershell
& 'C:/Users/USER/Desktop/백업/다운로드/dnSpy-net-win32/dnSpy.Console.exe' --no-color -t FormStockView 'C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe'
& 'C:/Users/USER/Desktop/백업/다운로드/dnSpy-net-win32/dnSpy.Console.exe' --no-color -t FormWarehouseView 'C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe'
```

- `FormStockView.GetData`: StockMaster→ProductStock.Stock, Product.OutUnit 표시. 입고는 ViewWarehouse.OutQuantity, 출고는 ViewShipment.OutQuantity, 조정은 StockHistory와 CodeInfo(Category='StockType')의 AfterValue−BeforeValue.
- `FormWarehouseView.GetDetail`: 실제 WarehouseDetail.Box/Bunch/Steam/OutQuantity 및 행별 SteamOf1Box/SteamOf1Bunch를 읽는다.
- ProductStock 스키마는 ProdKey/StockKey/Stock뿐이며 입고 lot FK가 없다. 두 품목의 ShipmentFarm 연결도 없으므로 농장 또는 최신 입고로 lot를 임의 지정할 수 없다.
- 읽기 전용 실행 스크립트: `.verify/conversion-lot-probe.cjs`. 자격증명·직원정보를 출력하지 않으며 모든 실행문을 SELECT로 제한했다.

| 품목·시점 | 직접 확인한 SQL | 판정 |
|---|---|---|
| NL Prod1959 / 09-01 | Wdetail23766 Bunch/Out10, Steam200, 저장SteamOf1Bunch10. 23777은25단250송이. 조정216430 +10단(입고10단누락 사유). 출고35단350송이, 잔량10단 | 조정과 물리수량 중복 해석 불명확. 계속 보류 |
| NL Prod1959 / 29-02 | 29-01 Stock250=0. Wdetail35875 10단100송이, 출고5단50송이, Stock258=5단 | zero-anchor 후 단일10송이/단, 잔량50송이 |
| NL Prod1959 / 31-02 | 31-01 Stock260=0. Wdetail36662 10단100송이, 출고0, Stock261=10단 | 잔량100송이 |
| EC Prod3227 / 29 | Wdetail35556 1박스150송이. 조정363226 −1박스(샘플건), 29-02 이후0 | 소진된 이전 입고 |
| EC Prod3227 / 33~35 | 30-02 Stock259=0 이후 Wdetail36698 1박스150송이 + Wdetail37271 1박스250송이. 출고0/조정0, 재고2박스 | 두 취득분 전량 잔존: 400송이. 2×최신250 또는2×과거150 금지 |

## 정책과 소비자

| 원천 | 판정 | 소비자 |
|---|---|---|
| 기존 유효 환산 | 기존 결과 보존 | 기존 국가 평균/품목별 fallback |
| 선택연도·ProdKey·canonical zero-anchor 이후 활동 | OutUnit 순수량과 평가 ProductStock.Stock 일치 필수 | 순수 환산 helper |
| 활성 취득분 비율 모두 동일 + 입고/출고/조정 대사 | 기존 master 비율과도 일치할 때만 동일 비율 사용 | NL29/31 등 |
| 활성 취득분 비율 혼합 + 출고0 + 조정0 + 전량 잔존 | 실제 송이/단 수량 합계 사용 | EC33~35 |
| 일부 혼합 lot 소진/조정/연결 누락/불일치/음수 등 | 새 추정 금지, 기존 보류 보존 | 근거 설명·검산 |

## 부작용 / downstream 표

| 동작 | Order/Shipment/ShipmentDate/ShipmentFarm | Warehouse/ProductStock/StockHistory/Product | Estimate/Amount/Vat/isFix | WebProfitReport/확정 revision |
|---|---|---|---|---|
| 환산 근거 조회·보고서 재계산·검산 | SELECT 또는 보존 | SELECT만 | 보존 | 조회만, 자동저장 금지 |

## 회귀와 완료 조건

- NL09 보류, NL29=50/NL31=100, EC33~35=400, 소진된 이전 비율의 비오염.
- 혼합 lot 일부 출고/조정/미확정 출고/OutQuantity 대사 실패는 보류. 타연도·미래·잘못된 차수·다른 품목·0 미기록·중복 canonical 검증.
- 명시0/음수/기존 정상 환산 결과 보존. 품목별 부분평균 금지.
- 관련 계약 테스트, manifest/write guard/dnSpy evidence, 전체 ERP 검증/build, 실제 SELECT 재검증은 통합 담당이 완료한다. EXE UI 직접 실행 검증과 배포는 아직 미검증.

## 구현 후 제한된 실제 SELECT smoke

- 새 `normalizedCountryInventoryQuantities`를 09/29/31/33/34/35차에 실행했다. 실행 중 mssql query는 SELECT/WITH만 허용하고 DML/DDL/EXEC 및 Request.execute를 차단했다.
- NL09는 기존 ambiguous_conversion 보류, NL29는 국가잔량338송이 중 Prod1959 50송이, NL31은 국가잔량2242송이 중 Prod1959 100송이로 확인했다.
- EC33/34/35는 국가잔량400송이로 확인했고 상세 근거가 Wdetail36698(150) +37271(250), anchor30-02/Stock259임을 대조했다.
- 기존 정상 환산 결과 보존, 미확정/일부 소진/조정/누락·invalid 활동/교차연도/동일·미래 anchor 차단 포함 순수회귀25개 및 기존 API 통합회귀 통과. 1~41차 paired 원천/금액 대조와 배포는 통합 담당의 별도 결과를 따른다.
