// 주차별 매출이익 보고서 — "매출원가 양식.xlsx" 첫 시트와 동일 구조.
// nenova.exe DB 에서 자동으로 채울 수 있는 열(N순수매출·L불량·O그외매출·Q구매외화·S포워딩·R환율기본)은 SQL 로,
// 수기 열(E기초재고·F기말재고·H그외통관비·R환율수정·비고)은 웹 전용 테이블에 저장한다.
import { query, sql } from './db';

// 엑셀 8~23행 품명 순서 그대로
export const CATEGORIES = [
  { key: '콜롬비아 수국', coun: '콜롬비아', flower: /수국/ },
  { key: '콜롬비아 카네이션', coun: '콜롬비아', flower: /카네이션/ },
  { key: '콜롬비아 장미', coun: '콜롬비아', flower: /장미/ },
  { key: '콜롬비아 루스커스', coun: '콜롬비아', flower: /루스커스/ },
  { key: '콜롬비아 알스트로', coun: '콜롬비아', flower: /알스트로/ },
  { key: '네덜란드', coun: '네덜란드' },
  { key: '호주', coun: '호주' },
  { key: '태국', coun: '태국' },
  { key: '중국', coun: '중국' },
  { key: '에콰도르', coun: '에콰도르' },
  { key: '미국', coun: '미국' },
  { key: '이스라엘', coun: '이스라엘', variant: 'noEnding' },
  { key: '뉴질랜드', coun: '뉴질랜드', variant: 'noEnding' },
  { key: '일본', coun: '일본', variant: 'noEnding' },
  { key: '베트남', coun: '베트남' },
  { key: '공제', manualOnly: true },
];
export const EXTRA_CATEGORY = '기타(미분류)'; // 어떤 행에도 못 들어간 품목 — 유실 방지용 표시 행

export function classifyCategory(counName, flowerName) {
  const coun = String(counName || '');
  const flower = String(flowerName || '');
  for (const c of CATEGORIES) {
    if (c.manualOnly) continue;
    if (!coun.includes(c.coun)) continue;
    if (c.flower && !c.flower.test(flower)) continue;
    return c.key;
  }
  return EXTRA_CATEGORY;
}

// ── 수기값 저장 테이블 (웹 전용, idempotent)
let _ensured = null;
export async function ensureProfitReportTable() {
  if (_ensured) return _ensured;
  _ensured = query(
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebProfitReport')
     BEGIN
       CREATE TABLE WebProfitReport (
         AutoKey INT IDENTITY(1,1) PRIMARY KEY,
         OrderYear NVARCHAR(4) NOT NULL,
         MajorWeek NVARCHAR(4) NOT NULL,
         Category NVARCHAR(60) NOT NULL,   -- 품명 행 또는 '_note'
         ColKey NVARCHAR(20) NOT NULL,     -- E/F/H/R/S/note
         Value FLOAT NULL,
         TextValue NVARCHAR(2000) NULL,
         UpdatedBy NVARCHAR(50),
         UpdatedAt DATETIME DEFAULT GETDATE()
       );
       CREATE UNIQUE INDEX UX_WebProfitReport ON WebProfitReport(OrderYear, MajorWeek, Category, ColKey);
     END`,
    {}
  );
  return _ensured;
}

const CASE_CATEGORY = `
  CASE
    WHEN ISNULL(p.CounName,'') LIKE N'%콜롬비아%' AND ISNULL(p.FlowerName,'') LIKE N'%수국%' THEN N'콜롬비아 수국'
    WHEN ISNULL(p.CounName,'') LIKE N'%콜롬비아%' AND ISNULL(p.FlowerName,'') LIKE N'%카네이션%' THEN N'콜롬비아 카네이션'
    WHEN ISNULL(p.CounName,'') LIKE N'%콜롬비아%' AND ISNULL(p.FlowerName,'') LIKE N'%장미%' THEN N'콜롬비아 장미'
    WHEN ISNULL(p.CounName,'') LIKE N'%콜롬비아%' AND ISNULL(p.FlowerName,'') LIKE N'%루스커스%' THEN N'콜롬비아 루스커스'
    WHEN ISNULL(p.CounName,'') LIKE N'%콜롬비아%' AND ISNULL(p.FlowerName,'') LIKE N'%알스트로%' THEN N'콜롬비아 알스트로'
    WHEN ISNULL(p.CounName,'') LIKE N'%네덜란드%' THEN N'네덜란드'
    WHEN ISNULL(p.CounName,'') LIKE N'%호주%' THEN N'호주'
    WHEN ISNULL(p.CounName,'') LIKE N'%태국%' THEN N'태국'
    WHEN ISNULL(p.CounName,'') LIKE N'%중국%' THEN N'중국'
    WHEN ISNULL(p.CounName,'') LIKE N'%에콰도르%' THEN N'에콰도르'
    WHEN ISNULL(p.CounName,'') LIKE N'%미국%' THEN N'미국'
    WHEN ISNULL(p.CounName,'') LIKE N'%이스라엘%' THEN N'이스라엘'
    WHEN ISNULL(p.CounName,'') LIKE N'%뉴질랜드%' THEN N'뉴질랜드'
    WHEN ISNULL(p.CounName,'') LIKE N'%일본%' THEN N'일본'
    WHEN ISNULL(p.CounName,'') LIKE N'%베트남%' THEN N'베트남'
    ELSE N'기타(미분류)'
  END`;

/** N 순수매출액 — 판매현황(공급가액) 국가별. 엑셀 판매현황!E(공급가액) SUMIF 와 동일 기준 */
export async function salesByCategory(major, orderYear) {
  const r = await query(
    `SELECT ${CASE_CATEGORY} AS Category, SUM(ISNULL(sd.Amount,0)) AS v
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sd.ShipmentKey=sm.ShipmentKey
       LEFT JOIN Product p ON sd.ProdKey=p.ProdKey
      WHERE sm.OrderWeek LIKE @pfx AND ISNULL(sm.OrderYearWeek,'') = @yw AND ISNULL(sm.isDeleted,0)=0
        AND ISNULL(sd.OutQuantity,0) <> 0
      GROUP BY ${CASE_CATEGORY}`,
    { pfx: { type: sql.NVarChar, value: `${major}-%` }, yw: { type: sql.NVarChar, value: `${orderYear}${major}` } }
  );
  return Object.fromEntries(r.recordset.map(x => [x.Category, Number(x.v)]));
}

/** L 불량금액 / O 그외매출액 — Estimate 를 불량차감 vs 나머지(검역·취소·단가·부족·중복·출하오류·샘플·판매요청)로 분리 */
export async function estimateByCategory(major, orderYear) {
  const r = await query(
    `SELECT ${CASE_CATEGORY} AS Category,
            CASE WHEN ci.Descr2 = N'불량차감' THEN N'L' ELSE N'O' END AS Col,
            SUM(ISNULL(e.Amount,0)) AS v
       FROM Estimate e
       JOIN ShipmentMaster sm ON e.ShipmentKey=sm.ShipmentKey
       LEFT JOIN Product p ON e.ProdKey=p.ProdKey
       LEFT JOIN CodeInfo ci ON ci.Category=N'EstimateType' AND ci.DetailCode=e.EstimateType
      WHERE sm.OrderWeek LIKE @pfx AND ISNULL(sm.OrderYearWeek,'') = @yw AND ISNULL(sm.isDeleted,0)=0
      GROUP BY ${CASE_CATEGORY}, CASE WHEN ci.Descr2 = N'불량차감' THEN N'L' ELSE N'O' END`,
    { pfx: { type: sql.NVarChar, value: `${major}-%` }, yw: { type: sql.NVarChar, value: `${orderYear}${major}` } }
  );
  const L = {}; const O = {};
  for (const x of r.recordset) {
    if (x.Col === 'L') L[x.Category] = (L[x.Category] || 0) + Number(x.v);
    else O[x.Category] = (O[x.Category] || 0) + Number(x.v);
  }
  return { L, O };
}

/** Q 구매금액(외화) — 입고(WarehouseDetail.TPrice=외화총액) 국가별 */
export async function purchaseByCategory(major, orderYear) {
  const r = await query(
    `SELECT ${CASE_CATEGORY} AS Category, SUM(ISNULL(wd.TPrice,0)) AS v
       FROM WarehouseDetail wd
       JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
       LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
      WHERE wm.OrderWeek LIKE @pfx AND ISNULL(wm.isDeleted,0)=0 AND ISNULL(wm.OrderYear,'') = @yr
      GROUP BY ${CASE_CATEGORY}`,
    { pfx: { type: sql.NVarChar, value: `${major}-%` }, yr: { type: sql.NVarChar, value: String(orderYear) } }
  );
  return Object.fromEntries(r.recordset.map(x => [x.Category, Number(x.v)]));
}

/** S 포워딩(USD 추정) — BILL(WarehouseMaster) CW×운임률 + DocFee 를 그 BILL 품목 구성비로 국가별 배분 */
export async function forwardingByCategory(major, orderYear) {
  const r = await query(
    `WITH bill AS (
       SELECT wm.WarehouseKey,
              (ISNULL(wm.ChargeableWeight,0) * ISNULL(wm.FreightRateUSD,0) + ISNULL(wm.DocFeeUSD,0)) AS billUsd
         FROM WarehouseMaster wm
        WHERE wm.OrderWeek LIKE @pfx AND ISNULL(wm.isDeleted,0)=0 AND ISNULL(wm.OrderYear,'') = @yr
     ), alloc AS (
       SELECT b.WarehouseKey, b.billUsd, wd.ProdKey, ISNULL(wd.TPrice,0) AS tp,
              SUM(ISNULL(wd.TPrice,0)) OVER (PARTITION BY b.WarehouseKey) AS billTp
         FROM bill b JOIN WarehouseDetail wd ON wd.WarehouseKey=b.WarehouseKey
     )
     SELECT ${CASE_CATEGORY} AS Category,
            SUM(CASE WHEN a.billTp > 0 THEN a.billUsd * a.tp / a.billTp ELSE 0 END) AS v
       FROM alloc a LEFT JOIN Product p ON a.ProdKey=p.ProdKey
      GROUP BY ${CASE_CATEGORY}`,
    { pfx: { type: sql.NVarChar, value: `${major}-%` }, yr: { type: sql.NVarChar, value: String(orderYear) } }
  );
  return Object.fromEntries(r.recordset.map(x => [x.Category, Number(x.v)]));
}

/** R 환율 기본값 — CurrencyMaster 활성 환율 목록 */
export async function currencyRates() {
  try {
    const r = await query(
      `SELECT CurrencyCode, CurrencyName, ExchangeRate FROM CurrencyMaster WHERE ISNULL(IsActive,1)=1`,
      {}
    );
    return r.recordset;
  } catch {
    return [];
  }
}

export async function loadManual(major, orderYear) {
  await ensureProfitReportTable();
  const r = await query(
    `SELECT Category, ColKey, Value, TextValue FROM WebProfitReport
      WHERE OrderYear=@yr AND MajorWeek=@mw`,
    { yr: { type: sql.NVarChar, value: String(orderYear) }, mw: { type: sql.NVarChar, value: major } }
  );
  const manual = {};
  let note = '';
  for (const x of r.recordset) {
    if (x.Category === '_note') { note = x.TextValue || ''; continue; }
    if (!manual[x.Category]) manual[x.Category] = {};
    manual[x.Category][x.ColKey] = x.Value;
  }
  return { manual, note };
}

export async function saveManual(major, orderYear, values, note, actor) {
  await ensureProfitReportTable();
  const upsert = async (category, colKey, value, textValue) => {
    await query(
      `MERGE WebProfitReport AS t
       USING (SELECT @yr AS OrderYear, @mw AS MajorWeek, @cat AS Category, @col AS ColKey) AS s
          ON t.OrderYear=s.OrderYear AND t.MajorWeek=s.MajorWeek AND t.Category=s.Category AND t.ColKey=s.ColKey
       WHEN MATCHED THEN UPDATE SET Value=@val, TextValue=@txt, UpdatedBy=@actor, UpdatedAt=GETDATE()
       WHEN NOT MATCHED THEN INSERT (OrderYear, MajorWeek, Category, ColKey, Value, TextValue, UpdatedBy)
            VALUES (@yr, @mw, @cat, @col, @val, @txt, @actor);`,
      {
        yr: { type: sql.NVarChar, value: String(orderYear) },
        mw: { type: sql.NVarChar, value: major },
        cat: { type: sql.NVarChar, value: category },
        col: { type: sql.NVarChar, value: colKey },
        val: { type: sql.Float, value: value == null || value === '' ? null : Number(value) },
        txt: { type: sql.NVarChar, value: textValue == null ? null : String(textValue) },
        actor: { type: sql.NVarChar, value: actor || 'user' },
      }
    );
  };
  for (const [category, cols] of Object.entries(values || {})) {
    for (const [colKey, value] of Object.entries(cols || {})) {
      await upsert(category, colKey, value, null);
    }
  }
  if (note != null) await upsert('_note', 'note', null, note);
}
