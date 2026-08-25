// lib/raumPnl.js — 라움 손익계산서
// 견적서(거래명세표) 엑셀 업로드 → 강남/건대 시트 파싱·합산(품목명+단가 동일할 때만) →
// 차수별 저장(WebRaumPnl/WebRaumPnlItem, 웹 전용) + 전산 참고단가(Product.Cost÷1.1) 조회.
// 매출단가 = 견적서 단가(확정), 매입단가 = 사용자 수기 입력(참고단가는 채우기 보조).
import { query, withTransaction, sql } from './db';
import { loadMappings, getMapping, findMappingFuzzy } from './parseMappings';
import { scoreMatch } from './displayName';
import { getArrivalCostsWithFallback } from './catalogArrival';
import { resolveCatalogArrivalDisplay } from './catalogUnitMatch';
import { normalizeRaumAssignedMonth, resolveRaumNenovaPct } from './raumPnlMonthly';
import { diffRaumPnlUpload } from './raumPnlUploadDiff';
import { learnManualRaumCost, saveRaumConsignedRecord, saveRaumItemMapRecord } from './raumPnlCost';
import {
  defaultPnlTitle, resolvePnlPartner,
} from './raumPnlPartner';
import { parseRaumQuoteWorkbook, parseRaumQuoteWorkbookGroups } from './raumPnlParse';

export { parseRaumQuoteWorkbook, parseRaumQuoteWorkbookGroups };

export const DEFAULT_NENOVA_PCT = 80; // 순익분배 네노바 80 : 미우 20 (2026-07 사장님 확정)

const normSpace = (s) => String(s ?? '').replace(/[\s ]+/g, ' ').trim();

// ── 전산 참고단가 조회 ──────────────────────────────────────
// 참고단가 = Product.Cost ÷ 1.1 (전산 품목원가는 VAT 포함 저장 — lib/profitReport.js 평가단가와 동일 해석).
// 매칭: order-mappings.json(라움 발주 업로드 학습) → 해당 차수 라움 분배 품목명 토큰 매칭.

const UNIT_WORDS = new Set(['단', '대', '박스', '송이', '스팀', '개']);

function tokensOf(name) {
  return normSpace(name).toLowerCase().split(' ').filter(t => t.length >= 2 && !UNIT_WORDS.has(t));
}

// quoteItems: [{ name, price }] — price 는 유사매칭 검증용(분배단가=견적단가 원리)
export async function lookupErpRefPrices(quoteItems, major, orderYear, partnerCode) {
  // 호텔 차수 규칙 (사장님 최종 확정 2026-07-17): 기준 창 = 전산 N-02 + (N+1)-01.
  // 창에서 분배를 못 찾는 품목(쌓아두는 선입고 품목: White Necklace·다미나·델피늄류)만 N-01 을 폴백으로 확인.
  const partner = resolvePnlPartner(partnerCode);
  const mj = String(major).padStart(2, '0');
  const nextMj = String(Number(major) + 1).padStart(2, '0');
  const wPrev = `${mj}-01`;
  const w1 = `${mj}-02`;
  const w2 = `${nextMj}-01`;
  const yw1 = `${orderYear}${mj}%`;
  const yw2 = `${orderYear}${nextMj}%`;
  // 도착원가 — 창의 마지막 전산 주((N+1)-01)부터 과거로 내려가며 품목별 가장 최근 값
  let arrivalMap = {};
  let arrivalErr = null;
  try {
    const arr = await getArrivalCostsWithFallback({
      orderYear: String(orderYear),
      anchorWeek: w2,
      maxWeeks: 26,
    });
    arrivalMap = arr.map || {};
  } catch (e) {
    arrivalErr = e.message;
  }
  // 라움(트라움) 분배 품목 — 창(N-02·(N+1)-01)과 폴백(N-01)을 zone 으로 구분해 집계
  const erp = await query(
    `SELECT p.ProdKey, p.ProdName, ISNULL(p.DisplayName, '') AS DisplayName,
            ISNULL(p.FlowerName, '') AS FlowerName, ISNULL(p.CounName, '') AS CounName,
            ISNULL(p.Cost, 0) AS Cost,
            p.EstUnit, p.OutUnit, p.SteamOf1Box, p.BunchOf1Box, p.SteamOf1Bunch,
            CASE WHEN sm.OrderWeek = @wPrev THEN 'prev' WHEN sm.OrderWeek = @w2 THEN 'w2' ELSE 'w1' END AS Zone,
            SUM(ISNULL(sd.EstQuantity, 0)) AS EstQty, SUM(ISNULL(sd.Amount, 0)) AS Amt
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
       JOIN Customer c ON sm.CustKey = c.CustKey
       JOIN Product p ON sd.ProdKey = p.ProdKey
      WHERE ISNULL(sm.isDeleted, 0) = 0
        AND c.isDeleted = 0 AND ${partner.custLikeSql}
        AND ((sm.OrderWeek IN (@wPrev, @w1) AND ISNULL(sm.OrderYearWeek, '') LIKE @yw1)
          OR (sm.OrderWeek = @w2 AND ISNULL(sm.OrderYearWeek, '') LIKE @yw2))
      GROUP BY p.ProdKey, p.ProdName, p.DisplayName, p.FlowerName, p.CounName, p.Cost,
               p.EstUnit, p.OutUnit, p.SteamOf1Box, p.BunchOf1Box, p.SteamOf1Bunch,
               CASE WHEN sm.OrderWeek = @wPrev THEN 'prev' WHEN sm.OrderWeek = @w2 THEN 'w2' ELSE 'w1' END`,
    {
      wPrev: { type: sql.NVarChar, value: wPrev },
      w1: { type: sql.NVarChar, value: w1 },
      w2: { type: sql.NVarChar, value: w2 },
      yw1: { type: sql.NVarChar, value: yw1 },
      yw2: { type: sql.NVarChar, value: yw2 },
    }
  );
  // 품목별: 창(win = N-02 + (N+1)-01) 우선, 창에 없으면 N-01(prev) 폴백 (fromPrev 표시)
  // (N+1)-01(w2) 분배량은 별도 보존 — 호텔 N차 분배는 N-02가 정위치라 w2 잔존분은 '이동 필요' 표시 대상
  const winByKey = new Map();
  const prevByKey = new Map();
  for (const r of erp.recordset || []) {
    if (r.Zone === 'prev') { prevByKey.set(Number(r.ProdKey), r); continue; }
    const pk = Number(r.ProdKey);
    const cur = winByKey.get(pk);
    if (!cur) {
      winByKey.set(pk, { ...r, w2Qty: r.Zone === 'w2' ? Number(r.EstQty) : 0 });
    } else {
      cur.EstQty = Number(cur.EstQty) + Number(r.EstQty);
      cur.Amt = Number(cur.Amt) + Number(r.Amt);
      if (r.Zone === 'w2') cur.w2Qty = (cur.w2Qty || 0) + Number(r.EstQty);
    }
  }
  const erpByKey = new Map();
  for (const [pk, r] of winByKey) erpByKey.set(pk, { ...r, fromPrev: false });
  for (const [pk, r] of prevByKey) if (!erpByKey.has(pk)) erpByKey.set(pk, { ...r, fromPrev: true, w2Qty: 0 });
  const erpRows = [...erpByKey.values()];

  // 아이엠 분배 (같은 창·같은 규칙) — 라움 견적이 전산보다 적을 때 잔량이 아이엠으로 가는 구조라 함께 보여준다.
  // 라움이 N-01 폴백(전차수분)인 품목은 아이엠도 N-01 을 본다. ShipmentHistory 로 최초 분배·최종 수정 시점.
  const imWinByKey = new Map();
  const imPrevByKey = new Map();
  try {
    const im = await query(
      `SELECT sd.ProdKey,
              CASE WHEN sm.OrderWeek = @wPrev THEN 'prev' ELSE 'win' END AS Zone,
              SUM(ISNULL(sd.EstQuantity, 0)) AS EstQty,
              CONVERT(varchar(16), MIN(h.firstDtm), 120) AS FirstDtm,
              CONVERT(varchar(16), MAX(h.lastDtm), 120) AS LastDtm, SUM(ISNULL(h.modCnt, 0)) AS ModCnt
         FROM ShipmentDetail sd
         JOIN ShipmentMaster sm ON sd.ShipmentKey = sm.ShipmentKey
         JOIN Customer c ON sm.CustKey = c.CustKey
        OUTER APPLY (SELECT MIN(sh.ChangeDtm) AS firstDtm, MAX(sh.ChangeDtm) AS lastDtm,
                            SUM(CASE WHEN sh.ChangeType = N'수정' THEN 1 ELSE 0 END) AS modCnt
                       FROM ShipmentHistory sh WHERE sh.SdetailKey = sd.SdetailKey) h
        WHERE ISNULL(sm.isDeleted, 0) = 0
          AND c.isDeleted = 0 AND c.CustName LIKE N'아이엠%'
          AND ((sm.OrderWeek IN (@wPrev, @w1) AND ISNULL(sm.OrderYearWeek, '') LIKE @yw1)
            OR (sm.OrderWeek = @w2 AND ISNULL(sm.OrderYearWeek, '') LIKE @yw2))
        GROUP BY sd.ProdKey, CASE WHEN sm.OrderWeek = @wPrev THEN 'prev' ELSE 'win' END`,
      {
        wPrev: { type: sql.NVarChar, value: wPrev },
        w1: { type: sql.NVarChar, value: w1 },
        w2: { type: sql.NVarChar, value: w2 },
        yw1: { type: sql.NVarChar, value: yw1 },
        yw2: { type: sql.NVarChar, value: yw2 },
      }
    );
    for (const r of im.recordset || []) {
      (r.Zone === 'win' ? imWinByKey : imPrevByKey).set(Number(r.ProdKey), r);
    }
  } catch { /* 아이엠 집계 실패는 치명 아님 — 표시만 생략 */ }

  const mappings = loadMappings(true);
  const dbMaps = await loadRaumItemMaps(quoteItems.map(it => it.name)); // 사장님 확정 매핑 — 최우선
  const results = {};
  const extraKeys = new Set(); // 매핑은 됐지만 이번 차수 분배에 없는 품목 → Product.Cost 별도 조회

  for (const { name, price } of quoteItems) {
    let prodKey = null;
    let matchType = null;
    const dbMapped = dbMaps[costKey(name)];
    if (dbMapped != null) { prodKey = Number(dbMapped); matchType = '확정매핑'; }
    const direct = prodKey == null ? getMapping(name) : null;
    if (direct?.prodKey) { prodKey = Number(direct.prodKey); matchType = '매핑'; }
    if (!prodKey) {
      const fuzzy = findMappingFuzzy(name, mappings);
      if (fuzzy?.value?.prodKey) { prodKey = Number(fuzzy.value.prodKey); matchType = '매핑(유사)'; }
    }
    if (!prodKey) {
      // 이번 차수 라움 분배 품목 안에서 토큰 포함 매칭 (후보 1개일 때만 채택)
      const toks = tokensOf(name);
      if (toks.length > 0) {
        const cands = erpRows.filter(r => {
          const hay = `${r.ProdName} ${r.DisplayName} ${r.FlowerName}`.toLowerCase();
          return toks.every(t => hay.includes(t));
        });
        if (cands.length === 1) { prodKey = Number(cands[0].ProdKey); matchType = '분배품목'; }
      }
    }
    if (!prodKey && erpRows.length > 0) {
      // scoreMatch(한글→영문 별칭+자모 매칭) — 이번 차수 라움 분배 품목만 후보로, 최고점 60+ 이고
      // 2위와 10점 이상 차이날 때만 채택 (참고단가 용도라 보수적으로).
      // 추가 가드: 견적서는 전산 분배에서 생성되므로 분배단가=견적단가 — 단가가 3% 이상 다르면 오매칭으로 보고 버림.
      const scored = erpRows
        .map(r => ({ r, s: scoreMatch(name, r) }))
        .sort((a, b) => b.s - a.s);
      if (scored[0].s >= 60 && (scored.length < 2 || scored[0].s - scored[1].s >= 10)) {
        const cand = scored[0].r;
        const candSale = Number(cand.EstQty) > 0 ? Number(cand.Amt) / Number(cand.EstQty) : null;
        const priceOk = candSale == null || price == null || Math.abs(candSale - price) <= Math.max(1, price * 0.03);
        if (priceOk) {
          prodKey = Number(cand.ProdKey);
          matchType = `유사(${scored[0].s}점)`;
        }
      }
    }
    if (!prodKey) { results[name] = null; continue; }
    const inWeek = erpByKey.get(prodKey);
    if (!inWeek) extraKeys.add(prodKey);
    results[name] = { prodKey, matchType, row: inWeek || null };
  }

  if (extraKeys.size > 0) {
    const keys = [...extraKeys];
    const params = Object.fromEntries(keys.map((k, i) => [`k${i}`, { type: sql.Int, value: k }]));
    const r = await query(
      `SELECT ProdKey, ProdName, ISNULL(Cost, 0) AS Cost,
              EstUnit, OutUnit, SteamOf1Box, BunchOf1Box, SteamOf1Bunch
         FROM Product
        WHERE ProdKey IN (${keys.map((_, i) => `@k${i}`).join(',')})`,
      params
    );
    const byKey = new Map((r.recordset || []).map(x => [Number(x.ProdKey), x]));
    for (const name of Object.keys(results)) {
      const m = results[name];
      if (m && !m.row && byKey.has(m.prodKey)) {
        const p = byKey.get(m.prodKey);
        m.row = { ...p, EstQty: 0, Amt: 0 };
        m.outOfWeek = true;
      }
    }
  }

  const quoteByName = new Map(quoteItems.map(it => [it.name, it]));
  const out = Object.fromEntries(Object.entries(results).map(([name, m]) => {
    if (!m?.row) return [name, null];
    const cost = Number(m.row.Cost || 0);
    const estQty = Number(m.row.EstQty || 0);
    const amt = Number(m.row.Amt || 0);
    // 매입단가 기준 = 도착원가(가장 최근, 100원 단위 반올림) — 사장님 확정(2026-07-14).
    // 도착원가는 박스/송이 단위일 수 있어 카탈로그와 동일하게 판매단위(EstUnit)로 환산 후 반올림.
    // 환산 실패(단위 불일치)나 견적단가 대비 3배 초과는 오류로 보고 자동입력하지 않음.
    const arrival = arrivalMap[m.prodKey];
    let arrival100 = null;
    let arrivalNote = null;
    if (arrival && Number(arrival.arrivalCost || 0) > 0) {
      const disp = resolveCatalogArrivalDisplay(m.row, arrival);
      const price = Number(quoteByName.get(name)?.price || 0);
      const sane = disp.arrivalCost > 0 && !disp.unitMismatch && disp.matchedBy !== 'none'
        && (!(price > 0) || disp.arrivalCost <= price * 3);
      if (sane) {
        arrival100 = Math.round(disp.arrivalCost / 100) * 100;
        arrivalNote = `도착원가 ${arrival.arrivalWeek}${arrival.isFallback ? '(이전차수)' : ''} ${Math.round(disp.arrivalCost).toLocaleString()}원/${disp.arrivalUnit}→100원반올림`;
      } else {
        arrivalNote = `도착원가 단위환산 불가(${Math.round(arrival.arrivalCost).toLocaleString()}원/${disp.rawUnit}) — 직접 입력 필요`;
      }
    }
    return [name, {
      prodKey: m.prodKey,
      prodName: m.row.ProdName,
      matchType: m.matchType + (m.outOfWeek ? '·차수외' : ''),
      refPrice: arrival100 != null ? arrival100 : (cost > 0 ? Math.round((cost / 1.1) * 10) / 10 : null),
      refSource: arrival100 != null
        ? arrivalNote
        : (cost > 0 ? `전산원가÷1.1 (${m.matchType})${arrivalNote ? ` · ${arrivalNote}` : ''}` : arrivalNote),
      isArrival: arrival100 != null,
      erpSalePrice: estQty > 0 ? Math.round((amt / estQty) * 10) / 10 : null, // 분배단가(검증용)
      erpQty: estQty,
      erpFromPrev: !!m.row.fromPrev, // 창엔 없고 N-01(쌓아두는 품목)에서 찾음
      erpW2Qty: Number(m.row.w2Qty || 0), // (N+1)-01 잔존 분배 — N-02 로 이동 필요 표시용
      // 아이엠 분배 (라움 부족분 확인용): 라움과 같은 존의 수량·최초/최종수정 시점
      ...(() => {
        const imRow = m.row.fromPrev ? imPrevByKey.get(m.prodKey) : imWinByKey.get(m.prodKey);
        return {
          imQty: imRow ? Number(imRow.EstQty) : null,
          imFirstDtm: imRow?.FirstDtm || null,
          imLastDtm: imRow?.LastDtm || null,
          imModCnt: imRow ? Number(imRow.ModCnt || 0) : 0,
        };
      })(),
    }];
  }));
  if (arrivalErr) out.__arrivalError = `도착원가 조회 실패: ${arrivalErr}`;
  return out;
}

// ── 저장/조회 (웹 전용 테이블) ─────────────────────────────

let _ensured = null;
export async function ensureRaumPnlTables() {
  if (_ensured) return _ensured;
  _ensured = (async () => {
    try {
      await query(
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebRaumPnl')
     BEGIN
       CREATE TABLE WebRaumPnl (
         PnlKey INT IDENTITY(1,1) PRIMARY KEY,
         OrderYear NVARCHAR(4) NOT NULL,
         MajorWeek NVARCHAR(4) NOT NULL,
         Title NVARCHAR(100) NULL,
         QuoteDate DATE NULL,
         NenovaPct FLOAT NOT NULL DEFAULT 80,
         Note NVARCHAR(2000) NULL,
         SourceFile NVARCHAR(200) NULL,
         CreatedBy NVARCHAR(50) NULL,
         CreatedAt DATETIME DEFAULT GETDATE(),
         UpdatedBy NVARCHAR(50) NULL,
         UpdatedAt DATETIME NULL,
         isDeleted BIT NOT NULL DEFAULT 0
       );
     END;
     IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebRaumPnlItem')
     BEGIN
       CREATE TABLE WebRaumPnlItem (
         ItemKey INT IDENTITY(1,1) PRIMARY KEY,
         PnlKey INT NOT NULL,
         Seq INT NULL,
         ItemName NVARCHAR(200) NOT NULL,
         Unit NVARCHAR(20) NULL,
         Qty FLOAT NOT NULL DEFAULT 0,
         BranchJson NVARCHAR(500) NULL,
         SalePrice FLOAT NULL,
         SaleAmount FLOAT NULL,
         CostPrice FLOAT NULL,
         RefPrice FLOAT NULL,
         RefSource NVARCHAR(60) NULL,
         ErpSalePrice FLOAT NULL,
         ProdKey INT NULL,
         Remark NVARCHAR(300) NULL
       );
       CREATE INDEX IX_WebRaumPnlItem_PnlKey ON WebRaumPnlItem(PnlKey);
     END;
     -- 2026-07-14 검증 리포트 저장 (기존 테이블에 컬럼 추가 — 웹 전용 테이블만 ALTER)
     IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('WebRaumPnl') AND name = 'VerifyJson')
       ALTER TABLE WebRaumPnl ADD VerifyJson NVARCHAR(MAX) NULL;
     -- 2026-07-21 이미지 주문 원본 메타데이터(JSON: id/url/fileName)
     IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('WebRaumPnl') AND name = 'ImageJson')
       ALTER TABLE WebRaumPnl ADD ImageJson NVARCHAR(MAX) NULL;
     -- 2026-08-24 차수별 월별 합산 수동 배정(YYYY-MM, 웹 전용)
     IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('WebRaumPnl') AND name = 'AssignedMonth')
       ALTER TABLE WebRaumPnl ADD AssignedMonth CHAR(7) NULL;
     -- 2026-07-14 수동 행(손실 등) 구분
     IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('WebRaumPnlItem') AND name = 'IsCustom')
       ALTER TABLE WebRaumPnlItem ADD IsCustom BIT NOT NULL DEFAULT 0;
     -- 2026-07-14 매입단가 출처 (manual=직접입력·학습대상 / arrival=도착원가 자동 / learned=학습값 자동)
     IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('WebRaumPnlItem') AND name = 'CostSource')
       ALTER TABLE WebRaumPnlItem ADD CostSource NVARCHAR(10) NULL;
     -- 2026-07-14 사입 분류 — 매출 합산 포함, 매입단가 입력 시 손익도 합산
     IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('WebRaumPnlItem') AND name = 'IsConsigned')
       ALTER TABLE WebRaumPnlItem ADD IsConsigned BIT NOT NULL DEFAULT 0;
     -- 2026-07-17 전산 분배 대조 — 해당 차수 라움 분배수량(EstQuantity 합) 스냅샷
     IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('WebRaumPnlItem') AND name = 'ErpQty')
       ALTER TABLE WebRaumPnlItem ADD ErpQty FLOAT NULL;
     -- 2026-07-21 이미지 주문행 — 저장 후 다시 열어도 수량/단가 편집을 유지
     IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('WebRaumPnlItem') AND name = 'IsImageRow')
       ALTER TABLE WebRaumPnlItem ADD IsImageRow BIT NOT NULL DEFAULT 0;
     -- 2026-07-14 매입단가 학습 — 품목명(정규화)별 마지막 입력값, 다음 업로드 때 자동 채움
     IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebRaumCostPrice')
     BEGIN
       CREATE TABLE WebRaumCostPrice (
         ItemName NVARCHAR(200) PRIMARY KEY,
         CostPrice FLOAT NOT NULL,
         UpdatedBy NVARCHAR(50) NULL,
         UpdatedAt DATETIME DEFAULT GETDATE()
       );
     END;
     -- 2026-07-17 품목 매칭(사장님 확정) — 견적 품목명 → 전산 ProdKey. DB 저장이라 배포에도 유지.
     -- order-mappings.json 보다 우선 적용 (파일은 배포 시 git reset 으로 초기화되는 함정)
     IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebRaumItemMap')
     BEGIN
       CREATE TABLE WebRaumItemMap (
         ItemName NVARCHAR(200) PRIMARY KEY,
         ProdKey INT NOT NULL,
         ProdName NVARCHAR(200) NULL,
         UpdatedBy NVARCHAR(50) NULL,
         UpdatedAt DATETIME DEFAULT GETDATE()
       );
     END;
     -- 2026-07-17 수동 사입 지정 — 원산지가 있어도 사입으로 표시할 품목명 (사장님 지정, 배포에도 유지)
     IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebRaumConsignedItem')
     BEGIN
       CREATE TABLE WebRaumConsignedItem (
         ItemName NVARCHAR(200) PRIMARY KEY,
         UpdatedBy NVARCHAR(50) NULL,
         UpdatedAt DATETIME DEFAULT GETDATE()
       );
     END`,
        {}
      );
      await query(
        `IF COL_LENGTH('dbo.WebRaumPnl', 'PartnerCode') IS NULL
           ALTER TABLE dbo.WebRaumPnl ADD PartnerCode NVARCHAR(20) NOT NULL CONSTRAINT DF_WebRaumPnl_PartnerCode DEFAULT N'raum';`,
        {}
      );
    } catch (error) {
      _ensured = null;
      throw error;
    }
  })();
  return _ensured;
}

const costKey = (name) => normSpace(name).toLowerCase();

// ── 품목 매칭 (사장님 확정 매핑 — DB, 최우선 적용) ─────────────
export async function loadRaumItemMaps(itemNames) {
  await ensureRaumPnlTables();
  const keys = [...new Set((itemNames || []).map(costKey).filter(Boolean))];
  if (!keys.length) return {};
  const params = Object.fromEntries(keys.map((k, i) => [`n${i}`, { type: sql.NVarChar, value: k }]));
  const r = await query(
    `SELECT ItemName, ProdKey FROM WebRaumItemMap WHERE ItemName IN (${keys.map((_, i) => `@n${i}`).join(',')})`,
    params
  );
  return Object.fromEntries((r.recordset || []).map(x => [x.ItemName, Number(x.ProdKey)]));
}

// ── 수동 사입 지정 — 지정된 품목명은 업로드 시 사입으로 표시 ──
export async function loadRaumConsignedSet(itemNames) {
  await ensureRaumPnlTables();
  const keys = [...new Set((itemNames || []).map(costKey).filter(Boolean))];
  if (!keys.length) return new Set();
  const params = Object.fromEntries(keys.map((k, i) => [`n${i}`, { type: sql.NVarChar, value: k }]));
  const r = await query(
    `SELECT ItemName FROM WebRaumConsignedItem WHERE ItemName IN (${keys.map((_, i) => `@n${i}`).join(',')})`,
    params
  );
  return new Set((r.recordset || []).map(x => x.ItemName));
}

// 수동 사입 지정 전체 목록 (정규화 키) — 대조 새로고침/⚖ 시 저장본에도 재적용하기 위함
export async function loadRaumConsignedAll() {
  await ensureRaumPnlTables();
  const r = await query(`SELECT ItemName FROM WebRaumConsignedItem`, {});
  return (r.recordset || []).map(x => x.ItemName);
}

export async function saveRaumConsigned(itemName, consigned, actor) {
  await ensureRaumPnlTables();
  const key = costKey(itemName).slice(0, 200);
  if (!key) throw new Error('품목명이 비어있습니다.');
  return saveRaumConsignedRecord(key, consigned, actor);
}

export async function saveRaumItemMap(itemName, prodKey, actor) {
  await ensureRaumPnlTables();
  const key = costKey(itemName).slice(0, 200);
  if (!key) throw new Error('품목명이 비어있습니다.');
  return saveRaumItemMapRecord(key, prodKey, actor);
}

/** 품목명별 학습된 매입단가 조회 — { 정규화품목명: 단가 } */
export async function loadLearnedCosts(itemNames) {
  await ensureRaumPnlTables();
  const keys = [...new Set((itemNames || []).map(costKey).filter(Boolean))];
  if (!keys.length) return {};
  const params = Object.fromEntries(keys.map((k, i) => [`n${i}`, { type: sql.NVarChar, value: k }]));
  const r = await query(
    `SELECT ItemName, CostPrice FROM WebRaumCostPrice WHERE ItemName IN (${keys.map((_, i) => `@n${i}`).join(',')})`,
    params
  );
  return Object.fromEntries((r.recordset || []).map(x => [x.ItemName, Number(x.CostPrice)]));
}

/** 차수(연도+대차수+거래처) 단위 upsert — 이미 있으면 마스터 갱신 + 품목 전체 교체 */
export async function saveRaumPnl({ orderYear, major, title, quoteDate, nenovaPct, note, sourceFile, images, items, verification, actor, partnerCode }) {
  await ensureRaumPnlTables();
  const partner = resolvePnlPartner(partnerCode);
  const mj = String(major).padStart(2, '0');
  const pc = { type: sql.NVarChar, value: partner.code };
  return withTransaction(async (tQuery) => {
    const existing = await tQuery(
      `SELECT TOP 1 PnlKey FROM WebRaumPnl WHERE OrderYear=@yr AND MajorWeek=@mj AND PartnerCode=@pc AND isDeleted=0 ORDER BY PnlKey DESC`,
      { yr: { type: sql.NVarChar, value: String(orderYear) }, mj: { type: sql.NVarChar, value: mj }, pc }
    );
    let pnlKey = existing.recordset[0]?.PnlKey || null;
    const common = {
      title: { type: sql.NVarChar, value: title || defaultPnlTitle(partner.code, mj) },
      // 날짜는 정오로 고정(루트 CLAUDE.md — 자정 Date 는 시간대 변환으로 하루 밀림)
      qd: { type: sql.Date, value: quoteDate ? new Date(`${String(quoteDate).slice(0, 10)}T12:00:00`) : null },
      pct: { type: sql.Float, value: resolveRaumNenovaPct(nenovaPct, DEFAULT_NENOVA_PCT) },
      note: { type: sql.NVarChar, value: note || '' },
      src: { type: sql.NVarChar, value: sourceFile || '' },
      ij: { type: sql.NVarChar, value: Array.isArray(images) ? JSON.stringify(images).slice(0, 200000) : null },
      vj: { type: sql.NVarChar, value: verification ? JSON.stringify(verification) : null },
      actor: { type: sql.NVarChar, value: actor || 'user' },
    };
    if (pnlKey) {
      await tQuery(
        `UPDATE WebRaumPnl SET Title=@title, QuoteDate=@qd, NenovaPct=@pct, Note=@note, SourceFile=@src,
                ImageJson=COALESCE(@ij, ImageJson), VerifyJson=COALESCE(@vj, VerifyJson), UpdatedBy=@actor, UpdatedAt=GETDATE() WHERE PnlKey=@key`,
        { ...common, key: { type: sql.Int, value: pnlKey } }
      );
      await tQuery(`DELETE FROM WebRaumPnlItem WHERE PnlKey=@key`, { key: { type: sql.Int, value: pnlKey } });
    } else {
      const ins = await tQuery(
        `INSERT INTO WebRaumPnl (OrderYear, MajorWeek, PartnerCode, Title, QuoteDate, NenovaPct, Note, SourceFile, ImageJson, VerifyJson, CreatedBy)
         OUTPUT INSERTED.PnlKey
         VALUES (@yr, @mj, @pc, @title, @qd, @pct, @note, @src, @ij, @vj, @actor)`,
        {
          ...common,
          yr: { type: sql.NVarChar, value: String(orderYear) },
          mj: { type: sql.NVarChar, value: mj },
          pc,
        }
      );
      pnlKey = ins.recordset[0].PnlKey;
    }
    for (const it of items || []) {
      const cp = it.costPrice != null && it.costPrice !== '' ? Number(it.costPrice) : null;
      await tQuery(
        `INSERT INTO WebRaumPnlItem
           (PnlKey, Seq, ItemName, Unit, Qty, BranchJson, SalePrice, SaleAmount, CostPrice, RefPrice, RefSource, ErpSalePrice, ProdKey, Remark, IsCustom, CostSource, IsConsigned, ErpQty, IsImageRow)
         VALUES (@key, @seq, @name, @unit, @qty, @bj, @sp, @sa, @cp, @rp, @rs, @esp, @pk, @rm, @ic, @cs, @icon, @eq, @irow)`,
        {
          key: { type: sql.Int, value: pnlKey },
          seq: { type: sql.Int, value: Number(it.seq) || 0 },
          name: { type: sql.NVarChar, value: String(it.name || '').slice(0, 200) },
          unit: { type: sql.NVarChar, value: String(it.unit || '').slice(0, 20) },
          qty: { type: sql.Float, value: Number(it.qty) || 0 },
          bj: { type: sql.NVarChar, value: JSON.stringify(it.byBranch || {}).slice(0, 500) },
          sp: { type: sql.Float, value: it.price != null ? Number(it.price) : null },
          sa: { type: sql.Float, value: it.supply != null ? Number(it.supply) : null },
          cp: { type: sql.Float, value: cp },
          rp: { type: sql.Float, value: it.refPrice != null ? Number(it.refPrice) : null },
          rs: { type: sql.NVarChar, value: it.refSource || (it.refPrice != null ? '전산원가÷1.1' : null) },
          esp: { type: sql.Float, value: it.erpSalePrice != null ? Number(it.erpSalePrice) : null },
          pk: { type: sql.Int, value: it.prodKey != null ? Number(it.prodKey) : null },
          rm: { type: sql.NVarChar, value: String(it.remark || '').slice(0, 300) },
          ic: { type: sql.Bit, value: it.isCustom ? 1 : 0 },
          cs: { type: sql.NVarChar, value: it.costSource || null },
          icon: { type: sql.Bit, value: it.consigned ? 1 : 0 },
          eq: { type: sql.Float, value: it.erpQty != null ? Number(it.erpQty) : null },
          irow: { type: sql.Bit, value: it.isImageRow ? 1 : 0 },
        }
      );
      // 매입단가 학습 — 사용자가 직접 타이핑한 값만 (도착원가/학습 자동채움값은 재학습 안 함 —
      // 안 그러면 낡은 도착원가가 학습으로 굳어 다음 차수의 새 도착원가를 가려버림). 수동 행 제외.
      if (cp != null && !it.isCustom && it.costSource === 'manual' && costKey(it.name)) {
        await learnManualRaumCost(tQuery, {
          itemName: costKey(it.name).slice(0, 200), costPrice: cp, actor,
        });
      }
    }
    return pnlKey;
  });
}

// 다차수 업로드의 기존 행 연결 키. 견적서 합산 키와 같아야 수기 원가가 엉뚱한
// 단가 행으로 이동하지 않는다.
const importItemKey = (it) => `${costKey(it?.name ?? it?.ItemName)}|${Number(it?.price ?? it?.SalePrice ?? 0).toFixed(2)}|${Number(it?.consigned ?? it?.IsConsigned ?? 0) ? 'C' : ''}`;
const importBatchKey = (orderYear, major, partnerCode) => `${resolvePnlPartner(partnerCode).code}:${String(orderYear)}-${String(major).padStart(2, '0')}`;

function pnlVersion(row) {
  if (!row) return 'new';
  const dt = row.UpdatedAt || row.CreatedAt;
  const stamp = dt instanceof Date ? dt.getTime() : String(dt || '');
  return `${Number(row.PnlKey)}:${stamp}`;
}

/** 업로드 미리보기의 stale 감지용 현재 결산 버전. 웹 전용 테이블만 읽는다. */
export async function loadRaumPnlImportSnapshots(batches) {
  await ensureRaumPnlTables();
  const out = {};
  for (const batch of batches || []) {
    const orderYear = String(batch.orderYear);
    const major = String(batch.major).padStart(2, '0');
    const r = await query(
      `SELECT PnlKey, UpdatedAt, CreatedAt FROM WebRaumPnl
        WHERE OrderYear=@yr AND MajorWeek=@mj AND PartnerCode=@pc AND isDeleted=0 ORDER BY PnlKey DESC`,
      {
        yr: { type: sql.NVarChar, value: orderYear },
        mj: { type: sql.NVarChar, value: major },
        pc: { type: sql.NVarChar, value: resolvePnlPartner(batch.partnerCode).code },
      }
    );
    if ((r.recordset || []).length > 1) throw new Error(`DUPLICATE_ACTIVE_PNL: ${orderYear}년 ${Number(major)}차 결산이 중복 저장돼 있습니다.`);
    const row = r.recordset[0] || null;
    out[importBatchKey(orderYear, major, batch.partnerCode)] = { pnlKey: row?.PnlKey || null, version: pnlVersion(row) };
  }
  return out;
}

function dbItemToDraft(row) {
  let byBranch = {};
  try { byBranch = row.BranchJson ? JSON.parse(row.BranchJson) : {}; } catch { /* old malformed row */ }
  return {
    seq: Number(row.Seq) || 0, name: row.ItemName, unit: row.Unit || '', qty: Number(row.Qty) || 0,
    byBranch, price: row.SalePrice, supply: row.SaleAmount, costPrice: row.CostPrice,
    refPrice: row.RefPrice, refSource: row.RefSource, erpSalePrice: row.ErpSalePrice,
    prodKey: row.ProdKey, remark: row.Remark || '', isCustom: !!row.IsCustom,
    costSource: row.CostSource || null, consigned: !!row.IsConsigned, erpQty: row.ErpQty,
    isImageRow: !!row.IsImageRow,
  };
}

function canonicalImportedItem(item) {
  return [item.name || '', item.unit || '', Number(item.qty || 0), Number(item.price || 0), Number(item.supply || 0),
    Number(item.costPrice ?? -1), item.costSource || '', Number(item.prodKey ?? -1), !!item.isCustom,
    !!item.consigned, JSON.stringify(item.byBranch || {}), item.remark || ''];
}
function canonicalItemFingerprint(items) { return JSON.stringify((items || []).map(canonicalImportedItem)); }

function mergedImportedItems(imported, existingRows) {
  const oldByKey = new Map();
  const oldByFallbackKey = new Map();
  const custom = [];
  const preservation = { manualCost: 0, prodKey: 0, custom: 0, fallback: 0, collisions: [] };
  for (const row of existingRows || []) {
    if (row.IsCustom) {
      custom.push(dbItemToDraft(row));
      preservation.custom += 1;
      continue;
    }
    const key = importItemKey(row);
    if (!oldByKey.has(key)) oldByKey.set(key, []);
    oldByKey.get(key).push(row);
    const fallbackKey = `${costKey(row.ItemName)}|${normSpace(row.Unit)}|${row.IsConsigned ? 'C' : ''}`;
    if (!oldByFallbackKey.has(fallbackKey)) oldByFallbackKey.set(fallbackKey, []);
    oldByFallbackKey.get(fallbackKey).push(row);
  }
  const merged = (imported || []).map((it, index) => {
    const exact = oldByKey.get(importItemKey(it)) || [];
    const fallbackKey = `${costKey(it.name)}|${normSpace(it.unit)}|${it.consigned ? 'C' : ''}`;
    const fallback = oldByFallbackKey.get(fallbackKey) || [];
    let old = null;
    if (exact.length === 1) old = exact.shift();
    else if (exact.length > 1) preservation.collisions.push(`${it.name}: 동일 품목·단가 기존행 ${exact.length}개`);
    else if (fallback.length === 1) { old = fallback.shift(); preservation.fallback += 1; }
    else if (fallback.length > 1) preservation.collisions.push(`${it.name}: 단가 변경 후보 기존행 ${fallback.length}개`);
    // manual 과 CostSource가 없던 구 저장본(legacy)의 직접 원가만 자동값보다 우선한다.
    const hasLegacyManualCost = old && old.CostPrice != null && (old.CostSource === 'manual' || !old.CostSource);
    if (hasLegacyManualCost) preservation.manualCost += 1;
    const explicitMap = it.prodKeySource === 'explicit-map';
    if (old?.ProdKey != null && !explicitMap) preservation.prodKey += 1;
    return {
      ...it,
      seq: index + 1,
      costPrice: hasLegacyManualCost ? Number(old.CostPrice) : it.costPrice,
      costSource: hasLegacyManualCost ? (old.CostSource || 'manual') : it.costSource,
      prodKey: explicitMap ? it.prodKey : (old?.ProdKey ?? it.prodKey ?? null),
    };
  });
  // 견적서 밖에서 추가한 손실/조정 행은 파일 교체 대상이 아니다.
  if (preservation.collisions.length) {
    const err = new Error(`PRESERVATION_COLLISION: ${preservation.collisions.join('; ')}`);
    err.code = 'PRESERVATION_COLLISION';
    throw err;
  }
  return { items: [...merged, ...custom.map((it, index) => ({ ...it, seq: merged.length + index + 1 }))], preservation };
}

/** 미리보기와 실제 저장이 같은 수기 데이터 병합 결과를 사용한다. */
export async function prepareRaumPnlImportPreview(batches) {
  const snapshots = await loadRaumPnlImportSnapshots(batches);
  const prepared = [];
  for (const batch of batches || []) {
    const pnlKey = snapshots[importBatchKey(batch.orderYear, batch.major, batch.partnerCode)]?.pnlKey;
    const oldItems = pnlKey
      ? (await query(`SELECT * FROM WebRaumPnlItem WHERE PnlKey=@key ORDER BY Seq, ItemKey`, { key: { type: sql.Int, value: pnlKey } })).recordset
      : [];
    const merged = mergedImportedItems(batch.items, oldItems);
    const existingImportedItems = oldItems.filter(row => !row.IsCustom).map(dbItemToDraft);
    const existingDiff = pnlKey ? diffRaumPnlUpload(existingImportedItems, batch.items) : null;
    prepared.push({ ...batch, importedItems: batch.items, items: merged.items, preservation: merged.preservation, existingDiff, itemFingerprint: canonicalItemFingerprint(merged.items) });
  }
  return { batches: prepared, snapshots };
}

function assertImportBatches(batches) {
  if (!Array.isArray(batches) || !batches.length) throw new Error('저장할 차수가 없습니다.');
  const identities = new Set();
  for (const batch of batches) {
    const major = String(batch.major || '').replace(/[^0-9]/g, '');
    if (!batch.orderYear || !major || !Array.isArray(batch.items) || !batch.items.length) {
      throw new Error('각 차수에 연도·차수·품목이 모두 필요합니다.');
    }
    const identity = importBatchKey(batch.orderYear, major, batch.partnerCode);
    if (identities.has(identity)) throw new Error(`중복 차수: ${identity}`);
    identities.add(identity);
    if (!Array.isArray(batch.verification) || batch.verification.some(c => !c?.ok)) {
      throw new Error(`${Number(major)}차 검증에 실패해 전체 저장을 중단했습니다.`);
    }
  }
}

/**
 * 한 XLSX의 모든 차수를 하나의 DB transaction 으로 반영한다.
 * 이 함수는 WebRaumPnl/WebRaumPnlItem만 변경하며 ERP 원장에는 쓰지 않는다.
 */
export async function saveRaumPnlImportBatch({ batches, sourceFile, actor, expectedSnapshots = {} }) {
  assertImportBatches(batches);
  await ensureRaumPnlTables();
  return withTransaction(async (tQuery) => {
    const results = [];
    for (const batch of batches) {
      const orderYear = String(batch.orderYear);
      const major = String(batch.major).padStart(2, '0');
      const partner = resolvePnlPartner(batch.partnerCode);
      const identity = importBatchKey(orderYear, major, partner.code);
      const found = await tQuery(
        `SELECT * FROM WebRaumPnl WITH (UPDLOCK, HOLDLOCK)
          WHERE OrderYear=@yr AND MajorWeek=@mj AND PartnerCode=@pc AND isDeleted=0 ORDER BY PnlKey DESC`,
        {
          yr: { type: sql.NVarChar, value: orderYear },
          mj: { type: sql.NVarChar, value: major },
          pc: { type: sql.NVarChar, value: partner.code },
        }
      );
      if ((found.recordset || []).length > 1) throw new Error(`DUPLICATE_ACTIVE_PNL: ${orderYear}년 ${Number(major)}차 결산이 중복 저장돼 있습니다.`);
      const existing = found.recordset[0] || null;
      if ((expectedSnapshots[identity]?.version || 'new') !== pnlVersion(existing)) {
        throw new Error(`${Number(major)}차가 미리보기 이후 변경되었습니다. 파일을 다시 미리보기한 뒤 저장하세요.`);
      }

      let pnlKey = existing?.PnlKey || null;
      const oldItems = pnlKey
        ? (await tQuery(`SELECT * FROM WebRaumPnlItem WITH (UPDLOCK, HOLDLOCK) WHERE PnlKey=@key ORDER BY Seq, ItemKey`, { key: { type: sql.Int, value: pnlKey } })).recordset
        : [];
      const liveMerged = mergedImportedItems(batch.importedItems || batch.items, oldItems);
      if (batch.itemFingerprint && batch.itemFingerprint !== canonicalItemFingerprint(liveMerged.items)) {
        throw new Error(`${Number(major)}차의 수기 원가·품목 매칭 보존 결과가 미리보기 이후 변경되었습니다. 다시 미리보기하세요.`);
      }
      const items = liveMerged.items;
      const qd = batch.quoteDate ? new Date(`${String(batch.quoteDate).slice(0, 10)}T12:00:00`) : null;
      const verify = JSON.stringify(batch.verification);
      if (pnlKey) {
        // 업로드는 원본 행만 갱신한다. 결산 메모/분배율/제목/이미지 주문 메타데이터는 유지한다.
        await tQuery(
          `UPDATE WebRaumPnl SET QuoteDate=@qd, SourceFile=@src, VerifyJson=@vj, UpdatedBy=@actor, UpdatedAt=GETDATE()
            WHERE PnlKey=@key`,
          {
            key: { type: sql.Int, value: pnlKey }, qd: { type: sql.Date, value: qd },
            src: { type: sql.NVarChar, value: sourceFile || '' }, vj: { type: sql.NVarChar, value: verify },
            actor: { type: sql.NVarChar, value: actor || 'user' },
          }
        );
        await tQuery(`DELETE FROM WebRaumPnlItem WHERE PnlKey=@key`, { key: { type: sql.Int, value: pnlKey } });
      } else {
        const ins = await tQuery(
          `INSERT INTO WebRaumPnl (OrderYear, MajorWeek, PartnerCode, Title, QuoteDate, NenovaPct, Note, SourceFile, VerifyJson, CreatedBy)
           OUTPUT INSERTED.PnlKey
           VALUES (@yr, @mj, @pc, @title, @qd, @pct, @note, @src, @vj, @actor)`,
          {
            yr: { type: sql.NVarChar, value: orderYear }, mj: { type: sql.NVarChar, value: major },
            pc: { type: sql.NVarChar, value: partner.code },
            title: { type: sql.NVarChar, value: defaultPnlTitle(partner.code, major) }, qd: { type: sql.Date, value: qd },
            pct: { type: sql.Float, value: DEFAULT_NENOVA_PCT }, note: { type: sql.NVarChar, value: '' },
            src: { type: sql.NVarChar, value: sourceFile || '' }, vj: { type: sql.NVarChar, value: verify },
            actor: { type: sql.NVarChar, value: actor || 'user' },
          }
        );
        pnlKey = ins.recordset[0].PnlKey;
      }

      for (const it of items) {
        const cp = it.costPrice != null && it.costPrice !== '' ? Number(it.costPrice) : null;
        await tQuery(
          `INSERT INTO WebRaumPnlItem
             (PnlKey, Seq, ItemName, Unit, Qty, BranchJson, SalePrice, SaleAmount, CostPrice, RefPrice, RefSource, ErpSalePrice, ProdKey, Remark, IsCustom, CostSource, IsConsigned, ErpQty, IsImageRow)
           VALUES (@key, @seq, @name, @unit, @qty, @bj, @sp, @sa, @cp, @rp, @rs, @esp, @pk, @rm, @ic, @cs, @icon, @eq, @irow)`,
          {
            key: { type: sql.Int, value: pnlKey }, seq: { type: sql.Int, value: Number(it.seq) || 0 },
            name: { type: sql.NVarChar, value: String(it.name || '').slice(0, 200) }, unit: { type: sql.NVarChar, value: String(it.unit || '').slice(0, 20) },
            qty: { type: sql.Float, value: Number(it.qty) || 0 }, bj: { type: sql.NVarChar, value: JSON.stringify(it.byBranch || {}).slice(0, 500) },
            sp: { type: sql.Float, value: it.price != null ? Number(it.price) : null }, sa: { type: sql.Float, value: it.supply != null ? Number(it.supply) : null },
            cp: { type: sql.Float, value: cp }, rp: { type: sql.Float, value: it.refPrice != null ? Number(it.refPrice) : null },
            rs: { type: sql.NVarChar, value: it.refSource || (it.refPrice != null ? '전산원가÷1.1' : null) },
            esp: { type: sql.Float, value: it.erpSalePrice != null ? Number(it.erpSalePrice) : null }, pk: { type: sql.Int, value: it.prodKey != null ? Number(it.prodKey) : null },
            rm: { type: sql.NVarChar, value: String(it.remark || '').slice(0, 300) }, ic: { type: sql.Bit, value: it.isCustom ? 1 : 0 },
            cs: { type: sql.NVarChar, value: it.costSource || null }, icon: { type: sql.Bit, value: it.consigned ? 1 : 0 },
            eq: { type: sql.Float, value: it.erpQty != null ? Number(it.erpQty) : null }, irow: { type: sql.Bit, value: it.isImageRow ? 1 : 0 },
          }
        );
      }
      results.push({ orderYear, major, pnlKey, itemCount: items.length });
    }
    return results;
  });
}

export async function loadRaumPnlList(partnerCode) {
  await ensureRaumPnlTables();
  const partner = resolvePnlPartner(partnerCode);
  const r = await query(
    `SELECT m.PnlKey, m.OrderYear, m.MajorWeek, m.PartnerCode, m.Title, m.QuoteDate, m.AssignedMonth, m.NenovaPct, m.Note, m.SourceFile,
            m.CreatedBy, m.CreatedAt, m.UpdatedBy, m.UpdatedAt,
            COUNT(i.ItemKey) AS ItemCount,
            SUM(ISNULL(i.SaleAmount, 0)) AS SaleTotal,
            SUM(CASE WHEN ISNULL(i.IsConsigned,0)=1 THEN ISNULL(i.SaleAmount,0) ELSE 0 END) AS ConsignedSale,
            SUM(CASE WHEN i.CostPrice IS NOT NULL THEN i.CostPrice * i.Qty ELSE 0 END) AS CostTotal,
            SUM(CASE WHEN i.CostPrice IS NOT NULL THEN ISNULL(i.SaleAmount,0) ELSE 0 END) AS PnlSaleTotal,
            SUM(CASE WHEN i.CostPrice IS NOT NULL THEN ISNULL(i.SaleAmount,0) - i.CostPrice * i.Qty ELSE 0 END) AS ProfitTotal,
            SUM(CASE WHEN i.CostPrice IS NULL THEN 1 ELSE 0 END) AS MissingCost
       FROM WebRaumPnl m
       LEFT JOIN WebRaumPnlItem i ON i.PnlKey = m.PnlKey
      WHERE m.isDeleted = 0 AND m.PartnerCode=@pc
      GROUP BY m.PnlKey, m.OrderYear, m.MajorWeek, m.PartnerCode, m.Title, m.QuoteDate, m.AssignedMonth, m.NenovaPct, m.Note, m.SourceFile,
               m.CreatedBy, m.CreatedAt, m.UpdatedBy, m.UpdatedAt
      ORDER BY m.OrderYear DESC, m.MajorWeek DESC`,
    { pc: { type: sql.NVarChar, value: partner.code } }
  );
  return r.recordset || [];
}

export async function loadRaumPnlDetail(pnlKey) {
  await ensureRaumPnlTables();
  const [m, i] = await Promise.all([
    query(`SELECT * FROM WebRaumPnl WHERE PnlKey=@key AND isDeleted=0`, { key: { type: sql.Int, value: Number(pnlKey) } }),
    query(`SELECT * FROM WebRaumPnlItem WHERE PnlKey=@key ORDER BY Seq, ItemKey`, { key: { type: sql.Int, value: Number(pnlKey) } }),
  ]);
  const master = m.recordset[0];
  if (!master) return null;
  let verification = null;
  try { verification = master.VerifyJson ? JSON.parse(master.VerifyJson) : null; } catch { /* 구버전 저장본 */ }
  let images = [];
  try { images = master.ImageJson ? JSON.parse(master.ImageJson) : []; } catch { /* 구버전 저장본 */ }
  return {
    master,
    verification,
    images: Array.isArray(images) ? images : [],
    items: (i.recordset || []).map(row => ({
      itemKey: row.ItemKey,
      seq: row.Seq,
      name: row.ItemName,
      unit: row.Unit || '',
      qty: Number(row.Qty || 0),
      byBranch: (() => { try { return JSON.parse(row.BranchJson || '{}'); } catch { return {}; } })(),
      price: row.SalePrice != null ? Number(row.SalePrice) : null,
      supply: row.SaleAmount != null ? Number(row.SaleAmount) : null,
      costPrice: row.CostPrice != null ? Number(row.CostPrice) : null,
      refPrice: row.RefPrice != null ? Number(row.RefPrice) : null,
      refSource: row.RefSource || null,
      erpSalePrice: row.ErpSalePrice != null ? Number(row.ErpSalePrice) : null,
      prodKey: row.ProdKey != null ? Number(row.ProdKey) : null,
      remark: row.Remark || '',
      isCustom: !!row.IsCustom,
      costSource: row.CostSource || null,
      isArrival: /도착원가/.test(row.RefSource || ''),
      consigned: !!row.IsConsigned,
      isImageRow: !!row.IsImageRow,
      erpQty: row.ErpQty != null ? Number(row.ErpQty) : null,
    })),
  };
}

export async function assignRaumPnlMonth(pnlKey, assignedMonth, actor) {
  await ensureRaumPnlTables();
  const current = await query(
    `SELECT TOP 1 PnlKey, OrderYear FROM WebRaumPnl WHERE PnlKey=@key AND isDeleted=0`,
    { key: { type: sql.Int, value: Number(pnlKey) } }
  );
  const row = current.recordset?.[0];
  if (!row) throw new Error('해당 손익계산서가 없습니다.');
  const normalized = normalizeRaumAssignedMonth(assignedMonth, row.OrderYear);
  await query(
    `UPDATE WebRaumPnl SET AssignedMonth=@month, UpdatedBy=@actor, UpdatedAt=GETDATE() WHERE PnlKey=@key AND isDeleted=0`,
    {
      key: { type: sql.Int, value: Number(pnlKey) },
      month: { type: sql.Char, value: normalized },
      actor: { type: sql.NVarChar, value: actor || 'user' },
    }
  );
  return { pnlKey: Number(pnlKey), assignedMonth: normalized };
}

export async function deleteRaumPnl(pnlKey, actor) {
  await ensureRaumPnlTables();
  await query(
    `UPDATE WebRaumPnl SET isDeleted=1, UpdatedBy=@actor, UpdatedAt=GETDATE() WHERE PnlKey=@key`,
    { key: { type: sql.Int, value: Number(pnlKey) }, actor: { type: sql.NVarChar, value: actor || 'user' } }
  );
}
