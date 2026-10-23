# 국가별 SQL 수량 기준 평균 도착원가

## 승인·기준
- 2026-10-23 사용자는 소액 수기 차이를 허용하고 확인된 큰 계산틀에 맞춘 웹 수정을 승인했다. DB 수정은 금지한다.
- 기준 커밋 423b7fc2. 네덜란드·태국·중국·에콰도르의 재고평가만 확장한다. 나머지 평균식/품목별 경로는 보존한다.
- 식: `((상품외화 + 운임외화) × 해당차수 환율 + 통관비) / 같은 범위 매입수량 × SQL 잔량`.
- 중국은 단, 네덜란드·태국·에콰도르는 송이로 정규화한다. 분자에는 포함하면서 분모만 제외하거나 단·송이를 직접 합산하지 않는다.
- 품목명이 China Pink여도 실제 Product.CounName이 네덜란드면 네덜란드다. 명시 비용행 규칙과 국내 placeholder fallback은 보존한다.

## 근거
- 실제 dnSpy.Console `FormStockView.GetData`: StockMaster→ProductStock, Product의 ProdKey·CounName·OutUnit·EstUnit 사용. `FormWarehouseView.GetDetail`: WarehouseDetail의 Steam/Bunch/Box/Est 수량과 단가를 Product별로 조회한다. 삭제 handler/SP는 호출하지 않는다.
- 읽기 전용 SQL 근거: 이전 작업 `.verify/four-country-sql.json`, `.verify/four-country-product-probe.json` 및 `.verify/inventory-comparison-integrity.json`. 현재 구현 후 동일 키로 재검증한다.
- 중국 28차 평균식은 745단 매입/27단 재고로 Excel과 0.01원 미만 차이. 31차 China Pink 10단은 네덜란드 상품이다.
- 네덜란드 원본 28·31차 분모 송이/잔량 단·송이 혼합과 오래된 188송이 제외는 재현하지 않는다.
- 태국 Excel 역산 잔량 1004는 독립 SQL 근거가 없으므로 사용하지 않는다. 루스블룸을 금액에 넣고 수량에서만 빼지 않는다.
- 에콰도르 장미 Sample 350송이와 안개 sample 1박스는 다른 ProdKey다. 합치거나 재고를 복원하지 않는다.

## 기준 원장
| 기준 | 권위·규칙 | 소비자 |
|---|---|---|
| 업무키 | 명시 OrderYear + OrderWeek + ProdKey, 업체별 매출은 CustKey 유지 | SELECT, 기초/기말, 감사 |
| 현재 재고 | 해당 대차수 마지막 StockMaster의 ProductStock. 과거 재고 임의 제외 금지 | 평균평가/근거 |
| 매입 범위 | 기존 stockable 상품 필터, WarehouseMaster.isDeleted=0. 같은 차수 전체 | 금액/정규화 분모 |
| 환산 | 실제 입고 수량, 유효 Product 비율. 누락/상충이면 평균 사용 금지 | 공통 순수 helper |
| 과거 환산 | 같은 연도, 해당 스냅샷 차수 이하 입고만. 미래·다른 연도 금지 | 재고 단위 환산 |
| 누락 | 일부 품목만 계산하지 않고 기존 검증된 품목 원가 fallback + 사유 | API/화면 |
| 환율·통관 | 기존 선택 우선순위 및 명시 0 보존. 현재 환율로 과거 보충 금지 | 평균식 |
| 확정본 | 기존 immutable revision 보존. 조회만으로 재저장 금지 | API/다운로드 |

## 부작용·downstream
| 동작 | Order/Shipment/ShipmentDate/ShipmentFarm | ProductStock/StockHistory/입고 | Estimate·Amount/Vat/isFix | WebProfitReport/확정 revision |
|---|---|---|---|---|
| 보고서 조회·미리보기·엑셀·인쇄 | 보존(SELECT) | 보존(SELECT) | 보존(SELECT) | 보존(SELECT) |

계약/교차연도 fixture, 정규화 양성·누락·상충·명시0·음수·다른 샘플 fixture, 1~41차 SELECT 감사, ERP gates, build, CI, 배포 및 브라우저 smoke가 완료 조건이다. EXE UI 직접 검증은 별도로 미검증 표시한다.

## 실제 SQL 전후 대조
- 1~41차 기존/수정 로더를 같은 기간에 paired 조회: SELECT 43,406회, 산술·기초/기말 연속성·대상 외 국가/수기입력 보존 16,257검사 실패0.
- 관측 원천 지문 `f9fe97be906d43a85050568ad8d4ddd657ee21014a5c41c8415c0632c0026ab9` 전후 동일. 분류 CASE의 파생 Category/Stockable은 원장 지문에서 제외한다. 조회는 INSERT/UPDATE/DELETE/EXEC/트랜잭션 실행을 차단한 harness로 수행했다.
- 변경 국가는 위4개뿐이다. 값 변경484셀은 평가 E/F 및 손익 파생/분류 이동을 포함한다. 평균이 실제 적용된 기초/기말117구간의 곱셈·분모 검증 통과.
- Product 전체 카탈로그 분류 변경은 682 Domenichina, 2849/2883 China white, 2880 China Pink의 중국→네덜란드4품목뿐이다. CO/아나나스 CHINA placeholder는 그대로다.
- 독립조회만으로 atomic snapshot을 보장했다고 주장하지 않는다. 최초 별도 baseline은 업무 중 원천변경을 감지해 폐기했고 최종 paired 조회에서 안정성 확인 후 비교했다.

### 26~31차 기말 평가 변경(원 반올림)
| 국가 |26|27|28|29|30|31|
|---|---|---|---|---|---|---|
|네덜란드|1,517,734→667,579|1,551,927→654,018|1,761,834→942,088|1,634,933 유지|1,495,497→546,553|5,059,515 유지|
|태국|0 유지|64,270→18,274|49,825→13,799|20,080→10,927|0 유지|1,541,910→1,807,562|
|중국|−96,046→−217,112|1,672,876→1,627,442|192,947→242,459|66,355→73,159|0 유지|1,759,857→1,811,025|
|에콰도르|0 유지|0 유지|0 유지|0 유지|0 유지|4,067,249→2,881,915|

- 차이는 원본 소액 수기값을 보정한 결과가 아니라 품목별 원가에서 승인된 동일단위 평균으로 바뀐 영향이다. 31차 NL/CN에는 Q +18.5/−18.5 외화 및 순매출 약+61,364/−61,364원의 분류 이동도 포함된다. 총손익 차이를 재고평가만의 영향으로 설명하지 않는다.
- 변환 충돌 fallback: NL9/29/31 기말(다음차수 기초) Prod1959 `Tulip / Single Orange Juice`; EC33~35 기말(다음차수 기초) Prod3227 샘플. 실제 원장을 임의로 고치거나 과거 비율을 숨기지 않는다.
- CN26 −25단은 실제 음수재고다. 평가금액 음수를 숨기거나 0으로 바꾸지 않는다.
