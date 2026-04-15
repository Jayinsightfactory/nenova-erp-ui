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
