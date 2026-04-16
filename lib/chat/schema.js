// lib/chat/schema.js — DB 스키마 학습 (Text-to-SQL 에이전트용)
//
// INFORMATION_SCHEMA 에서 모든 BASE TABLE 의 컬럼/타입 추출.
// 10분 캐시. 시스템 프롬프트에 주입해 LLM 이 실존 컬럼만 참조하도록.

import { query } from '../db';

const TTL_MS = 10 * 60 * 1000;
let _cache = null;
let _cacheAt = 0;
let _building = null;

async function build() {
  const r = await query(
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_CATALOG = DB_NAME() AND TABLE_SCHEMA = 'dbo'
      ORDER BY TABLE_NAME, ORDINAL_POSITION`
  );

  // 테이블별 그룹화
  const tables = {};
  for (const c of r.recordset) {
    const t = c.TABLE_NAME;
    if (!tables[t]) tables[t] = [];
    tables[t].push({
      name: c.COLUMN_NAME,
      type: c.DATA_TYPE,
      nullable: c.IS_NULLABLE === 'YES',
      maxLen: c.CHARACTER_MAXIMUM_LENGTH,
    });
  }

  // 시스템 메타 테이블 제외 (sys*, MSreplication* 등)
  const userTables = Object.keys(tables).filter(t =>
    !/^(sys|MS|spt_|dt_|queue_)/i.test(t)
  );

  return {
    tables,
    userTables,
    builtAt: new Date().toISOString(),
    tableCount: userTables.length,
  };
}

export async function getSchema({ force = false } = {}) {
  const now = Date.now();
  if (!force && _cache && now - _cacheAt < TTL_MS) return _cache;
  if (_building) return _building;
  _building = (async () => {
    try {
      _cache = await build();
      _cacheAt = Date.now();
      return _cache;
    } finally {
      _building = null;
    }
  })();
  return _building;
}

// ── LLM 시스템 프롬프트용 스키마 요약 텍스트 생성
// 전체 테이블 포함하면 토큰 많음 → 주요 테이블은 전체, 나머지는 이름만.
export async function getSchemaPrompt() {
  const s = await getSchema();

  // 핵심 테이블 (챗봇에서 자주 쿼리할 것들) — 전체 컬럼 노출
  const PRIORITY = [
    'Customer', 'Product', 'ProductStock',
    'OrderMaster', 'OrderDetail',
    'ShipmentMaster', 'ShipmentDetail',
    'Purchase', 'PurchaseDetail',
    'Account', 'Payment',
  ];

  const priority = [];
  const others = [];

  for (const t of s.userTables) {
    if (PRIORITY.includes(t)) {
      const cols = s.tables[t]
        .map(c => `${c.name}:${c.type}`)
        .join(', ');
      priority.push(`  ${t}(${cols})`);
    } else {
      others.push(t);
    }
  }

  return `# DB SCHEMA (MSSQL)

## 핵심 테이블 (전체 컬럼)
${priority.join('\n')}

## 기타 테이블 (이름만 — 필요 시 컬럼 물어볼 것)
${others.join(', ')}

## 주요 관계
- OrderDetail.OrderMasterKey = OrderMaster.OrderMasterKey
- ShipmentDetail.ShipmentKey = ShipmentMaster.ShipmentKey
- Product.ProdKey / CounName(국가) / FlowerName(꽃종류)
- Customer.CustKey / CustName / CustArea(지역)
- OrderMaster.OrderWeek = "NN-NN" (예: "16-01")
- isDeleted=0 인 행만 유효

## 수량 컬럼 (OrderDetail / ShipmentDetail 공통) — **중요**
- **한 행에 BoxQuantity / BunchQuantity / SteamQuantity 세 값이 모두 "환산" 되어 저장됨**
  - 예: 1박스 주문 → BoxQuantity=1, BunchQuantity=15 (=1×BunchOf1Box),
                    SteamQuantity=300 (=1×SteamOf1Box)
  - 세 값을 **단순 합산하면 절대 안 됨** (111 등 무의미한 숫자)
- 실제 주문·출고 수량은 Product.OutUnit 에 해당하는 컬럼 하나만 사용:
    CASE
      WHEN p.OutUnit IN (N'박스','BOX','Box')  THEN od.BoxQuantity
      WHEN p.OutUnit IN (N'단','BUNCH','Bunch') THEN od.BunchQuantity
      WHEN p.OutUnit IN (N'송이','STEAM','STEM') THEN od.SteamQuantity
      ELSE od.BoxQuantity
    END
- ShipmentDetail.OutQuantity 컬럼은 이미 OutUnit 기준 단일 값으로 저장됨 (합산 아님).

## 금액 컬럼
- ShipmentDetail.Amount (공급가액), Cost (원가), Vat
- Product.Cost (원가)

## 카톡 주문 키워드 (거래처/직원이 실제로 쓰는 말)
주문 의도: 주문, 발주, 보내주세요, 부탁, 추가, 취소, 변경
수량 표현: 숫자 + (단/박스/개/EA/kg/팩/봉/병/캔/케이스/BOX/BUNCH/STEAM)
예: "카네이션 체리오 3박스 보내주세요" = 주문 등록 의도
예: "루스커스 2박스 추가요" = 기존 주문에 품목 추가
예: "장미 취소해주세요" = 주문 취소
→ 이런 말투가 들어오면 주문 관련 데이터 조회/처리로 분류

## 직원들의 반복 수동 업무 (챗봇이 대신 답해야 하는 것)
| 업무 | 일일 소요 | 빈도 | 챗봇이 해야 할 것 |
| 카톡 주문→전산 입력 | 120분 | 일 다수 | "XX가 뭐 주문했어?" → OrderDetail 즉시 조회 |
| 물량표 작업 | 193분 | 일 1회 | "오늘 물량표" → 당일 출고예정 품목·수량 집계 |
| 차감 대조 | 40분 | 일 1회 | "차감 대조" → 주문수량 vs 출고수량 차이 |
| 발주 작업 | 61분 | 일 1회 | "발주 현황" → Purchase 테이블 조회 |
| 매출 보고 | 30분 | 주 1회 | "이번주 매출" → ShipmentDetail.Amount SUM |
| 거래처 단가 관리 | 25분 | 주 2-3회 | "XX 단가 얼마?" → Product.Cost + 거래처별 단가 |
| 클레임 처리 | 15분 | 주 3-5건 | "불량 접수/현황" → 차감 데이터 조회 |
| 배송 추적 | 20분 | 일 다수 | "XX 배송 어디?" → ShipmentDtm/isFix 확인 |

## 정보 위치 가이드 (ERP 어디서 볼 수 있는지)
사용자가 "이거 어디서 봐?" 물으면 아래 URL 안내:
| 데이터 | ERP 페이지 | URL |
| 주문 등록/수정 | 주문등록 | /orders (PC) 또는 챗봇에서 주문 조회 |
| 주문 목록/조회 | 주문관리 | /orders |
| 출고 확정/배분 | 출고분배 | /shipment/distribute |
| 출고 내역 조회 | 출고조회 | /shipment (출고조회 메뉴) |
| 재고 현황 | 출고,재고상황 | /shipment (재고 탭) |
| 견적서 출력 | 견적서 관리 | /estimate |
| 거래처 정보 | 거래처 목록 | /customers (PC 사이드바) |
| 매출/실적 | 판매현황 | /sales (PC) |
| 미수금/채권 | 채권관리 | /receivable (PC) |
| 구매/발주 | 구매관리 | /purchase |
| 품목/상품 | 상품관리 | /products (PC) |
| 모바일 챗봇 | 모바일 전용 | /m/chat |
→ "견적서 어디서 출력해?" → "nenovaweb.com/estimate 에서 가능합니다"

## 화면 분류 카테고리 (직원 행동 패턴 기반)
신규주문: 주문 등록 화면 (카톡에서 받은 주문 전산 입력)
주문관리: 등록된 주문 조회/수정/삭제
출하관리: 출고 배분·확정·조회
재고관리: 품목별 현재고·부족 알림
견적관리: 견적서 생성·출력·이메일
거래처관리: 거래처 정보·단가·히스토리
상품관리: 품목 등록·수정·원산지·꽃종류
매출분석: 기간별·거래처별·품목별 매출 집계
정산관리: 미수금·입금·세금계산서
기타전산: 대시보드·설정·로그

## 자주 하는 질문 패턴 (학습 예시)

### 1. 주문 조회
질문: "XX 16-01 주문 품목별" / "XX 16차 주문수량"
  - WHERE om.CustKey = ? AND om.OrderWeek = 'NN-NN'
  - SELECT p.ProdName, p.OutUnit, [OutUnit CASE WHEN] AS Qty
  - 대차수만 주어지면 OrderWeek LIKE 'NN-%' 로 세부차수 먼저 확인

### 2. 출고 조회
질문: "오늘 출고 확정 업체" / "15차 미확정 업체"
  - WHERE sm.isFix=1 (확정만), sm.isFix=0 (미확정)
  - CONVERT(date, sd.ShipmentDtm) = CONVERT(date, GETDATE()) (오늘)
  - Amount 는 공급가. VAT 별도 합산 필요 시 + sd.Vat.

### 3. 매출 / TOP N 품목
질문: "이번 달 매출 TOP 5 품목" / "작년 장미 매출"
  - FROM ShipmentMaster sm JOIN ShipmentDetail sd
  - WHERE sm.isFix=1 (확정된 출고만 매출로 인정)
  - GROUP BY p.ProdKey, p.ProdName ORDER BY SUM(sd.Amount) DESC
  - YEAR/MONTH(sd.ShipmentDtm) 로 기간 필터

### 4. 재고
질문: "루스커스 재고" / "재고 부족 품목"
  - FROM Product p LEFT JOIN ProductStock ps ON ps.ProdKey=p.ProdKey
  - 부족: WHERE ISNULL(ps.CurrentStock,0) <= 0

### 5. 미수금 / 채권
질문: "꽃길 미수금" / "미수금 상위 10곳"
  - Customer 테이블의 Credit 관련 컬럼 우선 확인
  - 판매현황 - 결제내역 = 미수금 (정확한 테이블 확인 필요 시 INFORMATION_SCHEMA 참조)

### 6. 원산지 / 꽃종류 기반 집계
질문: "작년 네덜란드산 장미 몇 단" / "에콰도르산 재고"
  - Product.CounName (원산지), Product.FlowerName (꽃종류) 로 필터
  - 원산지 언급 시 전 거래처 합산 (COUNT(DISTINCT om.CustKey) 로 거래처수 표기)

### 7. 순위 / 상위 N
질문: "상위 3곳" / "가장 많이 한"
  - SELECT TOP N ... ORDER BY SUM(...) DESC

## 답변 포매팅 규칙
- 수치 : 천단위 콤마 (toLocaleString 스타일) + 단위 명시 (원·단·송이·박스·건 등)
- 차수 : "NN-NN차" 형식 (예: "16-01차")
- 거래처 : CustName 그대로 사용 (괄호 포함)
- 품목 : FlowerName + ProdName (예: "카네이션 Doncel")`;
}
