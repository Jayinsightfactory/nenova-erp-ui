# nenova ERP 웹 버전 — 작업 현황 문서
# 마지막 업데이트: 2026-03-27
# 담당: Claude (Anthropic)

## ════════════════════════════════════════
## 1. 프로젝트 개요
## ════════════════════════════════════════

목표:     기존 Windows ERP(화월 관리 프로그램 v1.0.13) → 반응형 웹으로 교체
DB:       MS-SQL, sql16ssd-014.localnet.kr:1433, nenova1_nenova
스택:     Next.js 14.2.0 + mssql + jsonwebtoken
포트:     3000 (nenova-erp-ui)
배포예정: Railway

설계 원칙:
  - 조회(GET)  → 실제 DB 직접 읽기
  - 쓰기(POST) → _new_ 테스트 테이블 저장 → 검증 후 실제 테이블 전환

## ════════════════════════════════════════
## 2. 파일 구조 (전체)
## ════════════════════════════════════════

nenova-erp-ui/
├── lib/
│   ├── db.js           ✅ MS-SQL 연결 풀 (getPool, query)
│   ├── auth.js         ✅ JWT 인증 (withAuth, createToken) - 8시간
│   ├── useApi.js       ✅ API 호출 유틸 (apiGet, apiPost, apiPatch, apiDelete)
│   └── useWeekInput.js ✅ 차수 자동 포맷 훅 ("13" → "13-01")
│
├── components/
│   └── Layout.js       ✅ 사이드바 + 탑바 레이아웃 (nenova ERP 타이틀)
│
├── styles/
│   └── globals.css     ✅ 심플 ERP 스타일 (Windows 클래식 스타일)
│
├── pages/
│   ├── index.js        ✅ /login 리다이렉트
│   ├── login.js        ✅ 실제 DB 인증 (Windows 대화상자 스타일)
│   ├── dashboard.js    ✅ 실시간 KPI (차수 매출/주문/재고부족/미확정)
│   │
│   ├── orders/
│   │   ├── index.js    ✅ 주문 관리 (날짜+거래처 필터, 엑셀 다운)
│   │   └── new.js      ✅ 주문 등록 (거래처검색, 품목그룹필터, 수량입력, 저장)
│   │
│   ├── warehouse.js    ✅ 발주 관리 (피벗 테이블 - 차수별 날짜 컬럼)
│   ├── incoming.js     ✅ 입고 관리 (원장목록+상세, CSV업로드)
│   │
│   ├── shipment/
│   │   ├── distribute.js ✅ 출고 분배 (품목기준/업체기준, 비율/우선분배, 확정처리)
│   │   ├── view.js     ✅ 출고 조회 (거래처클릭→상세연동)
│   │   └── history.js  ✅ 출고 내역 조회 (변경유형/기준값/변경값)
│   │
│   ├── estimate.js     ✅ 견적서 관리 (WeekDay필터, 불량/검역등록 모달)
│   ├── stock.js        ✅ 재고 관리 (품목별재고, 조정등록 모달)
│   │
│   ├── stats/
│   │   ├── monthly.js  ✅ 월별 판매 현황 (품목별/거래처별/지역별/담당자별)
│   │   ├── pivot.js    ✅ Pivot 통계 (전재고/입고/출고/미발주/현재고)
│   │   ├── area.js     ✅ 지역별 판매 비교 (현재차수 vs 전차수)
│   │   ├── manager.js  ✅ 영업사원 실적 (지역별 담당자 매출)
│   │   └── analysis.js ✅ 매출/물량 분석 (불량차감 상세)
│   │
│   ├── master/
│   │   ├── customers.js ✅ 거래처 관리 (CRUD 모달 - 사진과 동일 폼)
│   │   ├── products.js  ✅ 품목 관리 (CRUD 모달)
│   │   ├── pricing.js   ✅ 단가 관리 (변경항목 노란색, 일괄지정)
│   │   └── codes.js     ✅ 코드 관리 (국가/꽃/농장 탭)
│   │
│   └── admin/
│       └── users.js    ⏳ 사용자 관리 (조회만 구현, CRUD 미구현)
│
└── pages/api/
    ├── auth/
    │   ├── login.js    ✅ POST - UserInfo DB 조회, JWT 발급
    │   └── logout.js   ✅ POST - 쿠키 제거
    │
    ├── orders/
    │   ├── index.js    ✅ GET(실제DB), POST(_new_OrderMaster+Detail)
    │   └── history.js  ✅ GET - OrderHistory 변경 내역
    │
    ├── shipment/
    │   ├── index.js    ✅ GET(실제DB), POST(_new_ShipmentMaster+Detail)
    │   ├── [id].js     ✅ GET - 출고 상세 (ShipmentDetail)
    │   ├── distribute.js ✅ GET(products/custDist/custItems/custList), POST(_new_)
    │   ├── history.js  ✅ GET - ShipmentHistory 변경 내역
    │   └── fix.js      ✅ POST - 확정(isFix=1, ProductStock 업데이트) / 확정취소
    │
    ├── warehouse/
    │   ├── index.js    ✅ GET(원장목록), POST(엑셀업로드→WarehouseMaster+Detail), DELETE
    │   ├── [id].js     ✅ GET - 입고 상세 (WarehouseDetail)
    │   └── pivot.js    ✅ GET - 발주 피벗 (날짜별 품목 수량)
    │
    ├── stock/
    │   └── index.js    ✅ GET(실제DB), POST(_new_StockHistory)
    │
    ├── estimate/
    │   └── index.js    ✅ GET(출고목록+견적상세), POST(Estimate 저장)
    │
    ├── customers/
    │   └── search.js   ✅ GET - 거래처 검색 (드롭다운용)
    │
    ├── products/
    │   └── search.js   ✅ GET - 품목 검색 (드롭다운용)
    │
    ├── stats/
    │   ├── dashboard.js ✅ GET - 대시보드 KPI (차수매출/주문/재고/미확정)
    │   └── sales.js    ✅ GET - 통계 (monthly/area/manager/analysis/pivot)
    │
    └── master/
        └── index.js    ✅ GET/POST - 거래처/품목/단가/코드/사용자

## ════════════════════════════════════════
## 3. DB 테이블 매핑
## ════════════════════════════════════════

### 읽기 전용 (실제 DB)
OrderMaster, OrderDetail, OrderHistory
ShipmentMaster, ShipmentDetail, ShipmentHistory, ShipmentDate, ShipmentFarm
WarehouseMaster, WarehouseDetail
StockMaster, ProductStock, StockHistory
Estimate
Customer, Product, Farm, Flower, Country, CodeInfo
CustomerProdCost
UserInfo, AuthorityFormMapping
PeriodDay, ProductSort, KeyNumbering

### 쓰기 (테스트 테이블) → 검증 후 실제로 전환
_new_OrderMaster      ← OrderMaster 대응
_new_OrderDetail      ← OrderDetail 대응
_new_ShipmentMaster   ← ShipmentMaster 대응
_new_ShipmentDetail   ← ShipmentDetail 대응
_new_StockHistory     ← StockHistory 대응

### 직접 쓰기 (원본)
Estimate              ← 불량/검역 등록
Customer              ← 거래처 신규 등록
Product               ← 품목 신규 등록
StockHistory          ← 확정 시 재고 이력

## ════════════════════════════════════════
## 4. 핵심 비즈니스 로직
## ════════════════════════════════════════

### 차수 형식
입력: "13" → 출력: "13-01"
입력: "13-2" → 출력: "13-02"
입력: "132" → 출력: "13-02"
구현: lib/useWeekInput.js

### 확정 처리 (api/shipment/fix.js)
1. ShipmentMaster.isFix = 1 (해당 차수)
2. StockMaster에서 해당 차수 StockKey 조회/생성
3. 이전 확정 차수의 ProductStock에서 전재고 조회
4. 품목별: newStock = 전재고 + 입고수량 - 출고수량
5. ProductStock 업데이트 (upsert)
6. StockHistory 기록 (ChangeType='확정')
→ 다음 차수는 이번 확정재고를 전재고로 사용

### 출고 분배 로직 (shipment/distribute.js)
품목기준:
  - 차수+품목그룹 선택 → 조회
  - 품목 클릭 → 해당 품목의 거래처별 주문/출고 수량 표시
  - 비율분배: 각 거래처 주문비율 × 입고수량
  - 우선분배: 주문수량 그대로 적용
  - 수량 직접 입력 가능
  - 저장 → _new_ShipmentMaster + _new_ShipmentDetail

업체기준:
  - 거래처 선택 → 해당 업체 주문 품목 + 잔량 표시
  - 잔량 = 주문수량 - 출고수량

## ════════════════════════════════════════
## 5. 미구현 / 남은 작업
## ════════════════════════════════════════

⏳ 사용자 관리 CRUD (신규/수정/삭제)
⏳ 주문 수정 (기존 주문 불러와서 수정)
⏳ 출고분배 → 출고일 지정 탭 구현
⏳ 출고분배 집계 탭 실제 데이터 연동
⏳ 입고관리 엑셀(.xlsx) 파싱 (현재 CSV만 지원)
⏳ 견적서 출력 전용 레이아웃
⏳ _new_ 테이블 → 실제 테이블 전환 작업 (검증 완료 후)
⏳ 코드관리 저장 실제 동작
⏳ 단가관리 저장 API

## ════════════════════════════════════════
## 6. 환경 설정
## ════════════════════════════════════════

.env.local:
  DB_SERVER=sql16ssd-014.localnet.kr
  DB_PORT=1433
  DB_NAME=nenova1_nenova
  DB_USER=nenova1_nenova
  DB_PASSWORD=[카페24 DB 비밀번호]
  JWT_SECRET=nenova2026secretkey

실행:
  cd nenova-erp-ui
  npm install
  npm run dev
  → http://localhost:3000

## ════════════════════════════════════════
## 7. 파일별 수정 규칙
## ════════════════════════════════════════

수정 요청 시 반드시:
1. 수정할 파일명 명시
2. 해당 파일만 수정 (다른 파일 건드리지 않음)
3. 수정 후 이 문서(PROJECT_STATUS.md) 업데이트
4. 수정된 파일만 zip에 포함하여 전달

파일별 담당 기능:
  lib/db.js             → DB 연결 설정 변경 시
  lib/auth.js           → 인증 로직 변경 시
  lib/useWeekInput.js   → 차수 포맷 변경 시
  components/Layout.js  → 메뉴 추가/변경 시
  styles/globals.css    → 스타일 변경 시
  pages/orders/new.js   → 주문 등록 기능 변경 시
  pages/shipment/distribute.js → 출고 분배 변경 시
  pages/api/shipment/fix.js    → 확정 로직 변경 시
