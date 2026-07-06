# nenova.exe ↔ nenovaweb 메뉴·버튼 단위 매칭 보고서 (2026-07-06)

기준: dnSpy 디컴파일 `nenova-decompiled/Nenova/`(29 Form) ↔ `components/Layout.js` 메뉴 + `pages/*` 버튼.
상태: ✅ 일치 · 🔶 부분(방식차/통합) · ❌ 누락 · ➕ web전용(exe 없음)

## 0. 메뉴창(사이드바) 구조 — 8그룹

| 그룹 | 항목수 | exe 대응 |
|---|---|---|
| 주문관리 | 6 | 3 Form (OrderAdd/View/History) + web전용 3 |
| 입/출고관리 | 11 | 5 Form (Shipment*, Warehouse, QuantityPivot, Estimate) + web전용 5 |
| 구매관리 | 1 | web전용(Ecount) |
| 채권관리 | 6 | 대부분 web전용(Ecount/정산) |
| 재무관리 | 2 | web전용 |
| 통계화면 | 6 | 5 Form (Sales/Manager/Defect/Area/Stock) |
| 자동화 | 1 | web전용(n8n) |
| 코드관리 | 12 | 6 Form (Customer/Product/ProdCost/Code/User/History) + web전용 6 |

exe 표준 툴바 패턴: **새로고침/조회 · 신규 · 수정 · 삭제 · 저장 · 엑셀(xlsx) · 업로드 · 닫기** + 화면별 액션.

---

## 1. 주문관리

### 주문등록 — /orders/new ↔ **FormOrderAdd**
| exe 버튼 | 동작 | web 버튼 | 상태 |
|---|---|---|---|
| 조회 | 기존주문 로드 | 조회[Ctrl+R] | ✅ |
| 신규 | 폼 초기화 | 신규[Ctrl+N] | ✅ |
| 저장 | OrderMaster/Detail + ShipmentMaster Insert | 저장[Ctrl+S] | ✅ |
| 삭제 | isDeleted=1 | 삭제 | ✅ |
| 닫기 | 폼 종료 | 닫기[ESC] | ✅ |
| 지난 주문 불러오기 | 이전차수 MergeDataBefore | 지난 주문 불러오기 | ✅ |
| 주문 변경 내역 조회 | OrderHistory | 주문 변경 내역 조회 | ✅ |
| **클라이언트 넘버 생성** | Customer.OrderCode 자동생성 UPDATE | (없음) | ❌ 누락 |
| — | — | 업체 선택(담당자별 패널) | ➕ web전용 |

### 주문관리 — /orders ↔ **FormOrderView**
| exe | web | 상태 |
|---|---|---|
| 새로고침 | 새로고침 | ✅ |
| 수정(FormOrderAdd 팝업) | (행→주문등록 팝업) | ✅ |
| 삭제 | (관리화면 삭제) | 🔶 web는 조회중심 |
| 엑셀(xlsx) | 엑셀(**CSV**) | 🔶 형식차 |
| 닫기 | 닫기 | ✅ |

### 발주관리 — /warehouse ↔ **FormOrderHistory**
| exe | web | 상태 |
|---|---|---|
| 새로고침(PivotGrid) | 새로고침(피벗) | ✅ |
| 엑셀(xlsx) | 엑셀(CSV) | 🔶 |
| 닫기 | (펼침/닫기 그룹토글) | ✅ |
| 더블클릭→FormHistory | (컬럼토글: 차수/단위/변경수량) | 🔶 이력조회 방식차 |

### 붙여넣기 주문등록 /orders/paste · 업로드 주문등록 /orders/import · 카톡 변경 검증 /orders/kakao-audit
➕ **web전용** (exe 대응 없음). 단 저장 결과 row는 FormOrderAdd와 호환. 버튼: 새로고침·주문즐겨찾기·거래명세표Excel·주문추가/등록.

---

## 2. 입/출고관리

### 출고분배 — /shipment/distribute ↔ **FormShipmentDistribution** ⭐가장 중요
| exe 버튼 | 동작 | web 버튼 | 상태 |
|---|---|---|---|
| 조회 | GetFixStatus/ProductList/Pivot | 새로고침 | ✅ |
| **일괄 출고분배** | uspDistributeTotal | (전산 출고분배 실행에 통합?) | 🔶 |
| **개별 출고분배** | uspDistributeOne | (품목별 분배 UI) | 🔶 |
| **개별 초기화** | uspDistributeClear | (없음/암묵) | ❌ 누락 |
| 확정 | uspShipmentFix | 확정 | ✅ |
| 확정취소 | uspShipmentFixCancel + uspStockCalculation | 확정취소 | ✅ |
| 저장 | ShipmentDetail/Date Insert | (셀 저장) | 🔶 **JS 재구현**(distributeUnits) |
| 출고 분배 내역 조회 | ShipmentHistory | (없음) | ❌ 누락 |
| 닫기 | — | — | — |
| — | — | 엑셀 다운로드(XLSX) | ➕ |
| — | — | 전산 출고분배 실행 | ➕ SP 경로 |

✅ **정정(2026-07-06 SP 대조 완료)**: web은 일괄/개별 분배를 **실제 `EXEC usp_DistributeOne/Total` 호출**(distribute-sp.js), 확정/취소도 **`usp_ShipmentFix/FixCancel/StockCalculation` 호출**(fix.js). 수기 셀편집·import용 JS(distributeUnits.js)의 **수식도 SP와 라인단위 완전일치**(box/bunch/steam, EstQuantity=EstUnit별, Amount=ROUND(Cost×Est/1.1), Vat=Cost×Est−Amount). 희경 10배는 이 경로가 아니라 **이관 이전 레거시/수기** → 현재 차단+스캐너 탐지. "개별 초기화(uspDistributeClear)" 버튼과 "출고 분배 내역 조회"만 web 미노출(기능은 존재 가능).

### 견적서 관리 — /estimate ↔ **FormEstimateView (+EstimateAdd/PrintEstimate)**
| exe 버튼 | web | 상태 |
|---|---|---|
| 새로고침 | (필터 조회) | ✅ |
| 저장(견적수량 검증→ClassEstimate) | (인라인 저장) | 🔶 편집 parity 미검증 |
| 견적서 출력(FormPrintEstimate→XtraReport) | 인쇄(모달/iframe) | 🔶 엔진차 |
| 이카운트 업로드용 견적서 엑셀 | 엑셀 다운로드 | ✅ |
| (FormShipmentDistribution의 확정) | 확정/확정취소 | ➕ web가 견적화면에 통합 |

### 출고조회 — /shipment/view ↔ **FormShipmentView**
| exe | web | 상태 |
|---|---|---|
| 새로고침 | 조회 | ✅ |
| 출고물량표 출력(XtraReport) | 출고물량표 출력(window.print) | 🔶 엔진차 |
| 출고물량표 이미지 다운로드 | 이미지 다운로드(SVG) | ✅ |
| 닫기 | — | — |

### 출고내역조회 — /shipment/history ↔ **FormShipmentHistory**
| exe | web | 상태 |
|---|---|---|
| 새로고침 | 조회 | ✅ |
| 엑셀(xlsx) | 엑셀(CSV) | 🔶 |

### 차수피벗 — /shipment/week-pivot ↔ **FormQuantityPivot**
| exe | web | 상태 |
|---|---|---|
| 새로고침 | 새로고침 | ✅ |
| 엑셀(xlsx) | 엑셀 다운로드(XLSX) | ✅ |
| — | 주문 추가 · 기초재고 입력 | ➕ web전용 보강 |

### 입고관리 — /incoming ↔ **FormWarehouseView (+WarehouseAdd/FileUpload)**
| exe 버튼 | web | 상태 |
|---|---|---|
| 새로고침 | 새로고침 | ✅ |
| 업로드(FormFileUpload) | 업로드 | ✅ |
| 원장삭제(+uspStockCalculation) | 원장삭제 | 🔶 재고계산 재구현 |
| 엑셀(xlsx) | 엑셀(CSV) | 🔶 |
| 닫기 | 닫기 | ✅ |
| 신규/수정/삭제(FormWarehouseAdd) | (신규/상세 UI) | 🔶 등록 parity 미형식화 |

### 차수 확정 현황 /shipment/fix-status · 출고,재고상황 /shipment/stock-status · 출고분배 엑셀업로드 /shipment/distribute-import
🔶/➕ web 보강 화면. fix-status는 exe 확정상태(uspShipmentFix)와 연동, stock-status는 재고피벗 재구현.

### 수입방 카톡 수량집계 · 입고단가/송금 · 운송기준원가(/freight)
➕ **web전용** (exe 없음). freight는 운송기준원가 자동화(238 fixture).

---

## 3. 통계화면 — 전부 조회 parity 완료 ✅

| web | exe Form | exe 버튼 | web 버튼 | 상태 |
|---|---|---|---|---|
| 재고 관리 /stock | FormStockView (+StockAdd) | 새로고침·조정등록·엑셀·닫기 | 조회·조정등록·엑셀(CSV)·닫기 | ✅ (엑셀 🔶CSV, StockAdd 저장은 uspStockCalculation 재구현) |
| 월별 판매 현황 /stats/monthly | FormSalesView | 새로고침·엑셀·닫기 | 조회·엑셀 | ✅ |
| 매출/물량 분석 /stats/analysis | FormSalesDefectView | 새로고침·엑셀·닫기 | 조회·엑셀 | ✅ |
| 영업 사원 실적 /stats/manager | FormSalesManagerView | 새로고침·엑셀·닫기 | 조회·엑셀 | ✅ |
| 지역별 판매 비교 /stats/area | FormAreaSalesView | 새로고침·엑셀·닫기 | 조회·엑셀 | ✅ |
| Pivot 통계 /stats/pivot | (업체별 품목통계) | 새로고침·엑셀 | 조회·엑셀 | 🔶 기준테이블 확인필요 |

공통 차이: exe **엑셀=xlsx(ExportToXlsx)**, web **다수 CSV** → 🔶.

---

## 4. 코드관리

### 거래처관리 — /master/customers ↔ **FormCustomerInfo (+CustomerAdd)**
| exe 버튼 | web | 상태 |
|---|---|---|
| 새로고침·신규·수정·엑셀·닫기 | 새로고침·신규·수정·엑셀(CSV)·닫기 | ✅ (엑셀🔶) |
| 삭제(isDeleted=1) | (없음?) | ❌ 확인필요 |
| 업로드(ExcelLoadingCustomer) | (없음) | ❌ 누락 |
| 저장→**usp_CreateCustomer** | 저장(web 자체 INSERT) | 🔶 SP 미사용 |

### 품목관리 — /master/products ↔ **FormProductInfo (+ProductAdd)**
| exe 버튼 | web | 상태 |
|---|---|---|
| 새로고침·신규·수정·엑셀 | 새로고침·신규·수정·엑셀(CSV) | ✅ (🔶) |
| 삭제 | (없음?) | ❌ 확인필요 |
| 업로드(ExcelLoadingProduct) | (없음) | ❌ 누락 |
| 저장→**usp_CreateProduct** | 저장(자체 INSERT) | 🔶 SP 미사용 |
| — | 자연어명 일괄생성(AI) | ➕ web전용 |

### 업체별 품목 단가관리 — /master/pricing ↔ **FormCustomerProdCost** ✅
| exe | web | 상태 |
|---|---|---|
| 일괄지정 | (일괄?) | 🔶 |
| 저장(Delete/Insert 트랜잭션) | 저장(PUT MERGE) | ✅ |
| 새로고침·엑셀·닫기 | 조회·(엑셀)·닫기 | ✅ |

### 코드관리 — /master/codes ↔ **FormCodeInfo**
| exe(탭) | web | 상태 |
|---|---|---|
| 국가/꽃/농장 탭 각 저장·삭제 | 국가/꽃/농장 탭 | ✅ |
| 꽃 저장(ClassFlower) | 저장(무게/CBM/송이수) + 행별 💾 | ✅ |
| 국가/농장 삭제 | (삭제 확인필요) | 🔶 |

### 사용자관리 — /admin/users ↔ **FormUserInfo (+UserAdd)**
| exe 버튼 | web | 상태 |
|---|---|---|
| 신규·수정·삭제·닫기 | (읽기전용 조회만) | ❌ 등록/수정/삭제 누락 |
| 저장→ClassUserInfo Insert/Update | (없음) | ❌ 누락 |

### 작업내역 — /master/activity ↔ **FormHistory**
| exe | web | 상태 |
|---|---|---|
| 닫기(단순 조회) | (작업내역 조회) | 🔶 web는 분산(order/shipment/chat 로그) |

### 세부카테고리·액션로그·챗봇 현황·업무플로우·작업기획·테넌트스튜디오
➕ **web전용** (exe 없음).

---

## 5. web전용 그룹 (exe 대응 전혀 없음)
- **구매관리**: 구매현황(외화/수입) — Ecount 계산
- **채권관리**: 판매현황·영업매출관리·거래처카탈로그·거래처별채권·세금계산서·이카운트연동
- **재무관리**: 입출금계좌·외화환율
- **자동화**: 업무 자동화(n8n)

⚠️ 채권/재무/구매는 **Ecount 원본 pull 대조 미완** — web 계산값이 ERP 원본과 100% 일치 미검증.

---

## 6. 종합 결론 — 미완성·부족 리스트

### ❌ 누락 (exe에 있는데 web에 없음)
1. **출고분배 "개별 초기화"(uspDistributeClear)** 명시 버튼 — 재분배시 필요
2. **출고분배/주문/견적 "변경 내역 조회"** — exe는 Shipment/OrderHistory 팝업, web 일부 누락
3. **주문등록 "클라이언트 넘버 생성"**(Customer.OrderCode 자동생성)
4. **거래처/품목 "엑셀 업로드"**(ExcelLoadingCustomer/Product) — 대량등록 수단
5. **사용자관리 신규/수정/삭제** — web는 읽기전용
6. **거래처/품목 "삭제"** 버튼 확인필요

### 🔶 부분/방식차 (기능은 있으나 exe와 다름)
1. **분배·재고계산·마스터등록을 SP 대신 JS 재구현** (uspDistributeTotal/One/Clear, uspStockCalculation, usp_Create*) → **데이터 사고 진원**(희경 10배)
2. **엑셀 출력 형식**: exe=xlsx(ExportToXlsx) vs web=다수 CSV → 이카운트/서식 차이 가능
3. **인쇄 엔진**: exe=XtraReport vs web=window.print/iframe → 레이아웃 차이
4. **견적 편집 저장** parity 미검증(update-cost 이력 등)

### ➕ web전용 보강 (exe에 없는 추가 기능 — 유지)
붙여넣기/업로드 주문등록, 카톡검증, 운송기준원가, 차수확정현황, 기초재고입력, 자연어명 AI생성, Ecount/채권/재무/자동화 등

### 우선순위
| 순위 | 항목 | 이유 |
|---|---|---|
| 1 | 분배 SP(uspDistribute*) vs JS 재구현 수치 대조 | 희경 10배 등 데이터 사고 진원 |
| 2 | 엑셀 xlsx 통일(이카운트 업로드 서식) | CSV→xlsx 서식 불일치 위험 |
| 3 | 마스터 등록 SP(usp_Create*) 대조 + 엑셀 업로드 복원 | 대량 등록 수단 누락 |
| 4 | 사용자관리 편집 기능 | web 읽기전용 |
| 5 | Ecount 재무/채권 원본 pull 대조 | 계산값 100% 미검증 |
