# 입고관리 수정 설계 · 2026-11-03

## 근거와 범위
앞선 조사 `../work-reports/2026-11-03-incoming-reupload-review.md`의 실제 dnSpy CLI와 SELECT-only SP/View 대조를 적용한다. FormWarehouseAdd의 새 품목만 재계산하는 결함은 복제하지 않는다. 기존 `/incoming` 메뉴에 농장 수정/수정 파일 교체/수정 이력을 추가한다. 신규 업로드는 별도 기능으로 유지한다. 스키마 변경 없음.

## 동작·부작용
| 동작 | WarehouseMaster | WarehouseDetail | Product.Stock/StockHistory/ProductStock | SystemActionLog | 주문/출고/견적/매출 |
|---|---|---|---|---|---|
| 조회/미리보기 | 읽기 | 읽기 | 읽기 | 읽기 | 읽기 |
| 농장 수정 | FarmName·수정자·수정시각 | 보존 | 보존 | 전후 감사 | 보존 |
| 파일 교체 | FarmName·수정자·수정시각 | 연결 없는 선택 원장 상세를 교체 | 기존·신규 품목별 차액/입고이력/native CALC 및 사후 검산 | 전후 감사 | 보존 |
| 실패 | 롤백 | 롤백 | 롤백 | 롤백 | 보존 |

농장 수정은 출고의 farm-only 분배 기능과 별개다. ShipmentFarm 변경 없음.

## 기준 원장
- WarehouseKey와 명시 OrderYear+OrderWeek 고정. 다른 연도/차수 이동 불가. 파일의 인보이스/AWB/일자가 있으면 기존 원장과 같아야 한다. 빈 값으로 기존 메타데이터를 지우지 않는다.
- 변경 농장명은 활성 Farm의 정확한 이름 1개. 기존 농장명을 유지하는 파일은 기존 문자열을 보존한다.
- 기존 파킹 파서 재사용. 전체 행이 활성 Product.ProdName 정확 일치여야 한다. 1~500행, 유한 음수 아닌 수량/단가/총액, 주문코드 20자. 원문의 박스/단/송이·UPrice·TPrice 각각 보존. OutUnit/EstUnit에 따라 각각 환산(native CASE).
- 모드 FARM은 상세/수량 payload를 받지 않는다. REPLACE는 파일 전체 최종값이다. 품목 A→B는 A의 기존 수량 제거 및 B 새 수량 반영. 같은 파일 동일값은 변경 없음으로 차단.
- 원가/인보이스 연결, 대상 품목의 도착원가/저장 원가, 해당 또는 이후 확정 손익, 관련 농장분배는 자동 이관하지 않고 차단 사유를 반환한다. 기존 연결키를 삭제하지 않는다.
- 확정 판정은 공통 readInvoiceReceiptEligibility(현재 확정/직전 미확정/직후 확정)로 기존+신규 품목 범위를 검사한다. 농장 수정도 같은 검사. 후속 StockMaster 존재 자체는 차단하지 않는다.
- 미리보기와 commit은 같은 prepareWarehouseCorrection 함수. baseline SHA256로 동시수정 검증. 명시 변경사유/확인 필수. 저장 시 native V2 게이트 → 원장/상세/품목/연결 HOLDLOCK 재검증 → 변경 → 재고 → readback → 감사의 한 트랜잭션.
- Product.Stock에는 현재 수량+차액만 반영. 임의 전체 재고 정렬이나 재고조정 생성 없음. 재계산은 변경 품목에 한정하여 현재 및 후속 차수를 순회, 음수 사후검사 실패시 전체 롤백.
- 공용 TempWarehouseDetail/usp_CreateWarehouse 사용 없음. 신규 schema/DDL 없음. 기존 SystemActionLog에 operation UUID, 요청해시, 원장 전후, 파일명, 사유와 결과를 같은 트랜잭션에서 기록. 같은 UUID 재시도는 감사 결과를 반환하며 다른 payload 재사용은 거부.
- 키보드 지원하는 기존 메뉴의 선택 및 버튼, 명시 확인, 모달 초점 복귀. 저장 중 닫기/중복 요청 금지. 미완료 초안은 해당 사용자 브라우저 sessionStorage로 복구하되 preview/승인은 복구하지 않는다.

## 검증 및 기준선
양성: FARM/동일품목 수량변경/A→B/품목추가·제외. 반례: stale/연도/오품목/음수/불일치 파일/원가연결/확정/권한/재고계산 실패/음수 후속연도/감사 실패. 동일 operation 재시도 중복쓰기0. 2025 동일 차수 보존. 실제 격리 MSSQL(운영 원장 쓰기 없음) 및 브라우저 검증 후 필수 gate, PR/CI/배포.
메뉴 기본값: 적용=기존 단일 shell, 반응형, 자연 세로스크롤, 키보드, 사전확인, 초안, 이력, 실패안내. 해당 없음=새 메뉴등록, 공용 품목매칭 변경. 모달 내부 스크롤은 명시 모달 예외.
