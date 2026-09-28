# 피벗 필터 확인과 메인차수 합산

## 요청과 확인 근거

- 웹 필터 결과가 EXE와 다르고 01-01/01-02를 메인차수로 합산하는 전환 요청.
- 첨부 및 운영 브라우저 확인: 웹 행 FlowerName/CustName, 열 OrderYear/OrderWeek/ListType/CustArea/CustOrderCode, ListType=02. 주문. EXE 행 국가/꽃/품목, 열 연도/차수/구분/농장, ListType=03. 입고. 동일한 필터·배치가 아니다. 필터 엔진 오집계로 단정하지 않는다.
- 실제 dnSpy.Console --no-color -t FormQuantityPivot 설치 EXE 재실행: GetData는 입고 ViewWarehouse.OutQuantity 및 FarmName, 주문 ViewOrder.OutQuantity 및 CustName. ExportToXlsx WYSIWYG.
- 운영 SELECT-only probe: 2026 01-01~02-02 원본8,066행, 콜롬비아 장미1,362행. 입고수량01-01=4,148,01-02=710; 주문5,010/1,220. 입고 CustKey 모두 NULL. 따라서 거래처 주문코드로 농장을 대신할 수 없다.

## 구현 전 기준표

| 기준 | 처리/소비자 |
|---|---|
| 원본 | 기존 EXE SQL/GET 그대로, 연도·세부차수 범위 불변 |
| 기본 표시 | subweek; 명시 main만 메인차수 합산 |
| 필터 | 원본 세부차수에 먼저 적용; []는0행; 검색은 체크와 별개임을 안내 |
| 표시 합산 | 같은 연도·메인차수만 묶음; 연도 축이 없으면 차수 라벨에 연도 포함; 출고일 등 다른 축 유지 |
| 수량/가격 | 원본 수량 합계, 기존 가중평균/최대 등 선택 집계 유지; 재고 스냅샷 합계는 기초/기말 재고가 아님을 경고 |
| 소비자 | 동일 모델의 화면/XLSX, 사용자별 브라우저/즐겨찾기 설정 |
| 입고 배치 | 사용자 명시 버튼으로 EXE 기본축/수량 적용. 국가·꽃·품목 선택만 유지하고 나머지 조건 초기화 안내 |
| 필터 적용 | 명시 적용 시 필터 활성화; 모든 위치의 선택값 요약, 빈/과거값 필터도 표시 |

## 부작용과 downstream

| 동작 | Order/Shipment/Date/Farm | Warehouse/Stock | Estimate/Amount/Vat/isFix/WebProfitReport |
|---|---|---|---|
| 조회/필터/합산/엑셀 | SELECT 또는 브라우저 처리, 보존 | 보존 | 보존 |
| 개인 설정 | 기존 UserFavorite 명시 저장 외 쓰기 없음 | 보존 | 보존 |

DB 쓰기·보정·SP 변경 없음. 계약 pivot-exe-controls/pivot-stats 및 실행형 교차연도 fixture로 고정한다.

## 검증/배포

- test:pivot-exe (XLSX 재읽기 포함), test:erp-contract, test:nenova-dnspy-evidence, test:erp-manifest/guard:erp-writes --changed-from origin/master, test:ui-layout, build 통과.
- 원본 운영 SELECT 결과를 새 모델로 읽기 전용 집계: 콜롬비아 장미01차=4,858,02차=4,330. 첨부 EXE 농장 CONSTRUNORTE JAR은01-01=630/02-01=400/02-02=10으로 일치. 변경된 API/원장 쓰기0개.
- 실제 화면 배포 스모크는 배포 후 갱신. `.tmp` probe/로그는 커밋 제외.

## Q&A

Q. 필터를 적용했는데 EXE와 다르고 메인차수로 합쳐 볼 수 없다.
A. 사용자 화면의 주문/거래처 배치와 EXE 입고/농장 배치 차이를 확인했다. 명시적인 입고 배치 버튼과 선택조건 요약으로 보완하며 세부차수 필터 후 연도별 표시 합산을 추가했다. 필터 꺼짐 상태에서 명시 적용 시 활성화, 빈 후보의 전체 해제가 무필터로 변하던 경계도 수정했다. SQL 조회/저장 수량을 바꾸지 않았다.
