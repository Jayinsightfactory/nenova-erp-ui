// 그외통관비(H) + 포워딩(S) — "매출원가 양식.xlsx" 그외통관비/포워딩/콜롬비아 1차·2차 시트 재현.
// 2026-07-10 완성본(22차/23차/26차) 실셀 역분석 결과, H의 관세·선율·방역 등 잔여비용은 웹 입력값을
// 사용하되, 28차 이후 입고관리의 국가별 Gross/Chargeable weight는 자동으로 병합한다.
//
// 포워딩(S)은 재발견(2026-07-10): WarehouseDetail 에 ProdName='운송료'|'SERVICE FEE' 라인으로 이미 입고관리에
// 들어가 있음(농장 인보이스에 운송료가 한 줄로 섞인 경우도, 인보이스 자체가 순수 운송료(FREIGHTWISE AWB류)인
// 경우도 전부 이 이름으로 저장됨). WarehouseMaster.FarmName 에 'FREIGHTWISE'(콜롬비아)/'Freightwise Ecuador'
// (에콰도르)/'EXCEL'(태국) 이 그대로 저장되어 있고, InvoiceNo 에 '콜수국'/'콜카장'으로 수국·나머지4품목 구분까지
// 있음. 네덜란드/중국은 FarmName이 실제 농장명(Holex/Yunnan Melody 등, 매주 바뀔 수 있음)이라 국가패턴 매칭이
// 안 되므로, 같은 BILL(WarehouseKey) 안의 다른(비운송료) 라인의 Product.CounName 으로 역추정(2단계 판별,
// autoForwardingByCountry). 22~26차 6개 반차수 54건 실측 대조 결과 미분류 0건 — 자동집계가 오히려 엑셀보다
// 정확함(엑셀은 Cloudland 등 추가 농장이나 소액 임베디드 라인을 누락한 사례 발견). 통화(EUR=네덜란드,
// CNY=중국, 나머지 USD)는 profitReport.js 의 CATEGORY_CURRENCY/CurrencyMaster 환율 로직을 그대로 재사용.
//
// 구조:
// - 국가별(콜롬비아 수국 포함 11개 카테고리): 백상창고료(GW×단가)+관세(리터럴)+선율(리터럴)+월드운송료(GW 등급×단가)+한국방역(리터럴)
//   = 그외통관비 총액. 월드운송료는 입고 GW가 있으면 매출원가 양식의 1t/2.5t/5t 등급공식을 적용하고, 사용자가 저장한 금액이 있으면
//   그 명시적 수기값을 우선한다. VAT 처리는 엑셀 그대로 혼합
//   (백상·관세는 그대로, 선율·월드운송료·한국방역은 ÷1.1). 단, 베트남 선율은 엑셀 22/24/26차처럼
//   공급가 리터럴이므로 ÷1.1 하지 않는다.
// - 콜롬비아 4품목(카네이션·장미·알스트로·루스커스)은 반차수(세부차수) 단위로 그 4품목 합산 BILL의
//   그외통관비 TOTAL을 계산한 뒤 카테고리별 "박스당무게×박스수량" 비율로 배분 — 항상 무게비율(GW/CW 무관, 엑셀 원본).
// - 포워딩(S)도 같은 반차수 무게배분표를 공유: 콜롬비아 나머지4품목 반차수 운송료 총액(자동감지, 수기 override 가능)
//   × 배분비율 — 단, 포워딩만 GW≈CW면 무게비율, 아니면 CBM비율(박스당CBM×박스수량)로 전환(엑셀 F21 IF문 그대로).
//   그외통관비는 전환 없음. 콜롬비아 수국·네덜란드·중국·에콰도르·태국은 국가별 자동감지 합계(수기 override 가능).
import { query, sql, withTransaction } from './db.js';
import { isFreightItem, isGrossWeightItem, isChargeableWeightItem, freightWeightOfRow } from './freightCalc.js';
import { deriveColombiaTruckAllocation } from './colombiaTruck.js';
import { COUNTRY_SPLIT_GROUPS, COUNTRY_INPUT_FIELDS } from './customsFields.js';

export { deriveColombiaTruckAllocation } from './colombiaTruck.js';
export { COUNTRY_SPLIT_GROUPS, COUNTRY_INPUT_FIELDS } from './customsFields.js';

export const COUNTRY_CATEGORIES = [
  '콜롬비아 수국', '네덜란드', '태국', '호주', '미국', '중국',
  '에콰도르', '이스라엘', '뉴질랜드', '일본', '베트남',
];
const COUNTRY_STORAGE_FIELDS = [
  'GW1', 'GW2', 'Customs1', 'Customs2', 'SunYul1', 'SunYul2',
  'WorldFreight1', 'WorldFreight2', 'Quarantine1', 'Quarantine2',
  'WorldFreight1Manual', 'WorldFreight2Manual',
  ...COUNTRY_SPLIT_GROUPS.flatMap((g) => g.parts),
];
const WORLD_FREIGHT_MANUAL_FIELDS = {
  WorldFreight1: 'WorldFreight1Manual',
  WorldFreight2: 'WorldFreight2Manual',
};
// 콜롬비아 4품목 — 무게배분 대상 (엑셀 콜롬비아1차/2차 시트 순서: 장미/카네이션/알스트로/루스커스)
export const COLOMBIA_ALLOC_CATEGORIES = ['콜롬비아 장미', '콜롬비아 카네이션', '콜롬비아 알스트로', '콜롬비아 루스커스'];
// 포워딩 국가별 직접입력 대상 (콜롬비아 4품목은 별도 반차수 테이블에서 배분 계산)
export const FORWARDING_DIRECT_CATEGORIES = ['네덜란드', '중국', '콜롬비아 수국', '에콰도르', '태국'];

const CASE_COLOMBIA_ALLOC = `
  CASE
    WHEN ISNULL(p.FlowerName,'') LIKE N'%장미%' THEN N'콜롬비아 장미'
    WHEN ISNULL(p.FlowerName,'') LIKE N'%카네이션%' THEN N'콜롬비아 카네이션'
    WHEN ISNULL(p.FlowerName,'') LIKE N'%알스트로%' THEN N'콜롬비아 알스트로'
    WHEN ISNULL(p.FlowerName,'') LIKE N'%루스커스%' THEN N'콜롬비아 루스커스'
    ELSE NULL
  END`;

// ── 단가표 (관리자 수정 가능, 전역 설정값 — key/value)
export const RATE_DEFAULTS = {
  BakSangRate: 460,          // 백상 창고료 원/kg
  Truck1t: 99000,            // 월드운송료 1t 트럭 단가
  Truck2_5t: 187000,         // 월드운송료 2.5t 트럭 단가
  Truck5t: 275000,           // 월드운송료 5t 트럭 단가
  QuarantinePerItemRate: 10000, // 선율 검역대행수수료 품목당 단가
  // 콜롬비아 4품목 박스당무게(kg)/CBM — Flower.BoxWeight/BoxCBM 기본시드값(2026-04-16_freight_cost.sql), 실측과 다를 수 있어 수정 가능
  BoxWeight_콜롬비아장미: 7, BoxCBM_콜롬비아장미: 10,
  BoxWeight_콜롬비아카네이션: 11, BoxCBM_콜롬비아카네이션: 11,
  BoxWeight_콜롬비아알스트로: 9.7, BoxCBM_콜롬비아알스트로: 7,
  BoxWeight_콜롬비아루스커스: 8, BoxCBM_콜롬비아루스커스: 9.6,
};

let _ensured = null;
export async function ensureCustomsTables() {
  if (_ensured) return _ensured;
  _ensured = (async () => {
    await query(
      `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebCustomsRateConfig')
       BEGIN
         CREATE TABLE WebCustomsRateConfig (
           ConfigKey NVARCHAR(40) PRIMARY KEY,
           Value FLOAT NOT NULL,
           UpdatedBy NVARCHAR(50), UpdatedAt DATETIME DEFAULT GETDATE()
         );
       END`, {}
    );
    await query(
      `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebCustomsWeekly')
       BEGIN
         CREATE TABLE WebCustomsWeekly (
           AutoKey INT IDENTITY(1,1) PRIMARY KEY,
           OrderYear NVARCHAR(4) NOT NULL, MajorWeek NVARCHAR(4) NOT NULL, Category NVARCHAR(60) NOT NULL,
           GW1 FLOAT, GW2 FLOAT,                    -- 백상창고료 Gross Weight(kg), 1차/2차
           Customs1 FLOAT, Customs2 FLOAT,           -- 관세, 1차/2차 (리터럴)
           SunYul1 FLOAT, SunYul2 FLOAT,             -- 선율, 1차/2차 (리터럴)
           WorldFreight1 FLOAT, WorldFreight2 FLOAT, -- 월드운송료, 1차/2차 (GW 자동계산값 또는 명시적 수기 override)
           WorldFreight1Manual BIT NULL, WorldFreight2Manual BIT NULL, -- 명시적 수기 override 여부
           Quarantine1 FLOAT, Quarantine2 FLOAT,     -- 한국방역, 1차/2차 (리터럴)
           UpdatedBy NVARCHAR(50), UpdatedAt DATETIME DEFAULT GETDATE()
         );
         CREATE UNIQUE INDEX UX_WebCustomsWeekly ON WebCustomsWeekly(OrderYear, MajorWeek, Category);
       END`, {}
    );
    // 기존 운영 DB에도 분할 입력 컬럼을 무중단으로 추가한다. 컬럼명은 코드 고정값만 사용한다.
    for (const column of COUNTRY_SPLIT_GROUPS.flatMap((g) => g.parts)) {
      await query(
        `IF COL_LENGTH('dbo.WebCustomsWeekly', '${column}') IS NULL
         ALTER TABLE dbo.WebCustomsWeekly ADD [${column}] FLOAT NULL`, {}
      );
    }
    for (const column of Object.values(WORLD_FREIGHT_MANUAL_FIELDS)) {
      await query(
        `IF COL_LENGTH('dbo.WebCustomsWeekly', '${column}') IS NULL
         ALTER TABLE dbo.WebCustomsWeekly ADD [${column}] BIT NULL`, {}
      );
    }
    await query(
      `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebColombiaWeekly')
       BEGIN
         CREATE TABLE WebColombiaWeekly (
           AutoKey INT IDENTITY(1,1) PRIMARY KEY,
           OrderYear NVARCHAR(4) NOT NULL, OrderWeek NVARCHAR(10) NOT NULL,  -- 세부(반)차수 e.g. '23-01'
           GW FLOAT, CW FLOAT,
           HandlingFee FLOAT, ItemCount FLOAT,
           Truck1t FLOAT, Truck2_5t FLOAT, Truck5t FLOAT,
           CustomsFee FLOAT, DisinfectFee FLOAT, QuarantineDeductFee FLOAT,
           AirRateUSD FLOAT,  -- 포워딩 항공료 총액(USD). 기존 컬럼명은 호환을 위해 유지
           UpdatedBy NVARCHAR(50), UpdatedAt DATETIME DEFAULT GETDATE()
         );
         CREATE UNIQUE INDEX UX_WebColombiaWeekly ON WebColombiaWeekly(OrderYear, OrderWeek);
       END`, {}
    );
    await query(
      `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebForwardingWeekly')
       BEGIN
         CREATE TABLE WebForwardingWeekly (
           AutoKey INT IDENTITY(1,1) PRIMARY KEY,
           OrderYear NVARCHAR(4) NOT NULL, MajorWeek NVARCHAR(4) NOT NULL, Category NVARCHAR(60) NOT NULL,
           AmountUSD FLOAT,
           UpdatedBy NVARCHAR(50), UpdatedAt DATETIME DEFAULT GETDATE()
         );
         CREATE UNIQUE INDEX UX_WebForwardingWeekly ON WebForwardingWeekly(OrderYear, MajorWeek, Category);
       END`, {}
    );
    // 수정 이력(INSERT 전용) — 필드 단위로 이전값→새값+수정자 계정을 남긴다. ShipmentAdjustment와 동일한 감사로그 관례.
    await query(
      `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebCustomsHistory')
       BEGIN
         CREATE TABLE WebCustomsHistory (
           HistoryKey INT IDENTITY(1,1) PRIMARY KEY,
           OrderYear NVARCHAR(4) NOT NULL,
           ScopeType NVARCHAR(20) NOT NULL,   -- 'Rate' | 'Country' | 'Colombia' | 'Forwarding'
           ScopeKey NVARCHAR(60) NOT NULL,    -- Country: 'MajorWeek|Category' / Colombia: OrderWeek / Forwarding: 'MajorWeek|Category' / Rate: ConfigKey
           FieldName NVARCHAR(40) NOT NULL,
           OldValue FLOAT NULL, NewValue FLOAT NULL,
           ChangedBy NVARCHAR(50), ChangedAt DATETIME DEFAULT GETDATE()
         );
         CREATE INDEX IX_WebCustomsHistory_Scope ON WebCustomsHistory(ScopeType, ScopeKey);
       END`, {}
    );
  })();
  return _ensured;
}

// ── 이력 기록 — 바뀐 필드만 INSERT (둘 다 null/동일값이면 기록 안 함)
async function logHistory(tQ, orderYear, scopeType, scopeKey, fieldName, oldValue, newValue, actor) {
  const o = oldValue == null || oldValue === '' ? null : Number(oldValue);
  const n = newValue == null || newValue === '' ? null : Number(newValue);
  if (o === n) return;
  if (o != null && n != null && Math.abs(o - n) < 0.0001) return;
  await tQ(
    `INSERT INTO WebCustomsHistory (OrderYear, ScopeType, ScopeKey, FieldName, OldValue, NewValue, ChangedBy)
     VALUES (@yr, @st, @sk, @fn, @ov, @nv, @actor)`,
    {
      yr: { type: sql.NVarChar, value: String(orderYear) }, st: { type: sql.NVarChar, value: scopeType },
      sk: { type: sql.NVarChar, value: scopeKey }, fn: { type: sql.NVarChar, value: fieldName },
      ov: { type: sql.Float, value: o }, nv: { type: sql.Float, value: n },
      actor: { type: sql.NVarChar, value: actor || 'user' },
    }
  );
}

/** 특정 범위의 최근 수정이력 (최신순) — 화면에 "누가 언제 무엇을 얼마→얼마로" 표시용 */
export async function loadHistory(orderYear, scopeType, scopeKey, limit = 30) {
  await ensureCustomsTables();
  const r = await query(
    `SELECT TOP (${Number(limit) || 30}) FieldName, OldValue, NewValue, ChangedBy, CONVERT(varchar(19), ChangedAt, 120) AS ChangedAt
       FROM WebCustomsHistory WHERE OrderYear=@yr AND ScopeType=@st AND ScopeKey=@sk
      ORDER BY HistoryKey DESC`,
    { yr: { type: sql.NVarChar, value: String(orderYear) }, st: { type: sql.NVarChar, value: scopeType }, sk: { type: sql.NVarChar, value: scopeKey } }
  );
  return r.recordset;
}

// ── 단가표
export async function getRateConfig() {
  await ensureCustomsTables();
  const r = await query(`SELECT ConfigKey, Value FROM WebCustomsRateConfig`, {});
  const saved = Object.fromEntries(r.recordset.map((x) => [x.ConfigKey, Number(x.Value)]));
  return { ...RATE_DEFAULTS, ...saved };
}
export async function saveRateConfig(values, actor) {
  await ensureCustomsTables();
  const current = await getRateConfig();
  await withTransaction(async (tQ) => {
    for (const [key, value] of Object.entries(values || {})) {
      if (!(key in RATE_DEFAULTS)) continue; // 알 수 없는 키 무시(오타 방지)
      await logHistory(tQ, '_global', 'Rate', key, 'Value', current[key], value, actor);
      await tQ(
        `MERGE WebCustomsRateConfig AS t USING (SELECT @k AS ConfigKey) AS s ON t.ConfigKey=s.ConfigKey
         WHEN MATCHED THEN UPDATE SET Value=@v, UpdatedBy=@actor, UpdatedAt=GETDATE()
         WHEN NOT MATCHED THEN INSERT (ConfigKey, Value, UpdatedBy) VALUES (@k, @v, @actor);`,
        { k: { type: sql.NVarChar, value: key }, v: { type: sql.Float, value: Number(value) }, actor: { type: sql.NVarChar, value: actor || 'user' } }
      );
    }
  });
}

// ── 세부차수(반차수) 목록 — 그 대차수에 실제 입고 데이터가 있는 세부차수
export async function weeksForMajor(major, orderYear) {
  const r = await query(
    `SELECT DISTINCT OrderWeek FROM WarehouseMaster WHERE OrderYear=@yr AND OrderWeek LIKE @pfx AND ISNULL(isDeleted,0)=0`,
    { yr: { type: sql.NVarChar, value: String(orderYear) }, pfx: { type: sql.NVarChar, value: `${major}-%` } }
  );
  const weeks = r.recordset.map((x) => x.OrderWeek).sort();
  return weeks.length ? weeks : [`${major}-01`, `${major}-02`]; // 데이터 없으면 관례상 1/2차로 폼만 노출
}

// ── 입고 GW 기본값 병합 — 수기 저장값 우선, 없으면 입고관리 Gross weight 사용 (사용자 방침: 입고 GW = 기준)
export function mergeCountryGw(row, gwDef) {
  const eff = { ...(row || {}) };
  if (!(Number(eff.GW1) > 0) && Number(gwDef?.GW1) > 0) eff.GW1 = gwDef.GW1;
  if (!(Number(eff.GW2) > 0) && Number(gwDef?.GW2) > 0) eff.GW2 = gwDef.GW2;
  return eff;
}
export function mergeColombiaGw(row, gwDef) {
  const eff = { ...(row || {}) };
  if (!(Number(eff.GW) > 0) && Number(gwDef?.GW) > 0) eff.GW = gwDef.GW;
  if (!(Number(eff.CW) > 0) && Number(gwDef?.CW) > 0) eff.CW = gwDef.CW;
  return eff;
}

// 입고 GW가 있으면 과거에 저장된 트럭 대수보다 자동선정값을 우선한다.
// 수기 GW 교정값이 있으면 그 교정된 GW를 기준으로 다시 등급을 정한다.
export function mergeColombiaTruck(row, gwDef) {
  const eff = { ...(row || {}) };
  const grossWeight = Number(eff.GW) > 0 ? Number(eff.GW) : Number(gwDef?.GW) || 0;
  if (grossWeight > 0) {
    const allocation = deriveColombiaTruckAllocation(grossWeight);
    Object.assign(eff, allocation, { truckSource: allocation.source });
  }
  return eff;
}

// ── 이 차수에 입고가 있는 국가 카테고리 — 입력 화면에서 필요한 행만 노출(나머지는 접기)
export async function activeCustomsCategories(major, orderYear) {
  const r = await query(
    `SELECT LTRIM(RTRIM(ISNULL(p.CounName, N''))) AS coun,
            SUM(CASE WHEN p.FlowerName LIKE N'%수국%' THEN 1 ELSE 0 END) AS hydCnt
       FROM WarehouseMaster wm
       JOIN WarehouseDetail wd ON wd.WarehouseKey = wm.WarehouseKey
       LEFT JOIN Product p ON p.ProdKey = wd.ProdKey
      WHERE ISNULL(wm.isDeleted,0)=0 AND wm.OrderWeek LIKE @pfx
        AND ISNULL(CAST(wm.OrderYear AS NVARCHAR(4)), @yr) = @yr
      GROUP BY LTRIM(RTRIM(ISNULL(p.CounName, N'')))`,
    { pfx: { type: sql.NVarChar, value: `${major}-%` }, yr: { type: sql.NVarChar, value: String(orderYear) } }
  );
  const set = new Set();
  for (const row of r.recordset) {
    const c = String(row.coun || '').trim();
    if (/콜롬비아/.test(c) && Number(row.hydCnt) > 0) set.add('콜롬비아 수국');
    for (const cat of COUNTRY_CATEGORIES) {
      if (cat === '콜롬비아 수국') continue;
      if (c && (c === cat || c.includes(cat))) set.add(cat);
    }
  }
  return [...set];
}

// ── 입고관리 Gross/Chargeable weight — 그외통관비 무게(백상 창고료 kg) 기준값.
// 특수 품목행의 Box/Bunch/Steam/OutQuantity 중 실제 중량을 freightCalc와 동일하게 추출한다.
// 국가 판별은 농장명 고정 목록보다 같은 AWB의 Product.CounName을 우선하고,
// FREIGHTWISE/InvoiceNo 태그와 기존 농장명 패턴을 fallback으로 사용한다.
export async function loadWarehouseGw(major, orderYear) {
  const r = await query(
    `SELECT wm.WarehouseKey, wm.OrderWeek, wm.OrderNo AS AWB,
            LTRIM(RTRIM(ISNULL(wm.FarmName, N''))) AS farm,
            LTRIM(RTRIM(ISNULL(wm.InvoiceNo, N''))) AS inv,
            ISNULL(wm.GrossWeight,0) AS masterGW,
            ISNULL(wm.ChargeableWeight,0) AS masterCW,
            wd.BoxQuantity, wd.BunchQuantity, wd.SteamQuantity, wd.OutQuantity,
            LTRIM(RTRIM(ISNULL(p.ProdName, N''))) AS prodName,
            LTRIM(RTRIM(ISNULL(p.FlowerName, N''))) AS flowerName,
            LTRIM(RTRIM(ISNULL(p.CounName, N''))) AS counName
       FROM WarehouseMaster wm
       JOIN WarehouseDetail wd ON wd.WarehouseKey = wm.WarehouseKey
       LEFT JOIN Product p ON p.ProdKey = wd.ProdKey
      WHERE ISNULL(wm.isDeleted,0)=0 AND wm.OrderWeek LIKE @pfx
        AND ISNULL(CAST(wm.OrderYear AS NVARCHAR(4)), @yr) = @yr`,
    { pfx: { type: sql.NVarChar, value: `${major}-%` }, yr: { type: sql.NVarChar, value: String(orderYear) } }
  );
  const countries = {}; // 카테고리 → { GW1, GW2 }
  const colombia = {};  // 반차수 → { GW, CW } (콜카장 4품목)

  const normalizeToken = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, '');
  const baseCountry = (value) => {
    const token = normalizeToken(value);
    if (!token || token === '국내' || token === '한국') return null;
    if (token.includes('콜롬비아') || token.includes('colombia')) return '콜롬비아';
    if (token.includes('네덜란드') || token.includes('netherlands') || token === 'nl') return '네덜란드';
    if (token.includes('호주') || token.includes('australia')) return '호주';
    if (token.includes('태국') || token.includes('thailand')) return '태국';
    if (token.includes('중국') || token.includes('china')) return '중국';
    if (token.includes('에콰도르') || token.includes('ecuador')) return '에콰도르';
    if (token.includes('미국') || token.includes('usa') || token.includes('unitedstates')) return '미국';
    if (token.includes('이스라엘') || token.includes('israel')) return '이스라엘';
    if (token.includes('뉴질랜드') || token.includes('newzealand')) return '뉴질랜드';
    if (token.includes('일본') || token.includes('japan')) return '일본';
    if (token.includes('베트남') || token.includes('vietnam')) return '베트남';
    return null;
  };
  const normalizeAwb = (value) => normalizeToken(value).replace(/-/g, '');
  const entries = new Map();
  const awbContext = new Map();
  const addContext = (map, key, row) => {
    const k = normalizeAwb(key);
    if (!k) return;
    const ctx = map.get(k) || { countries: new Set(), flowers: new Set() };
    const country = baseCountry(row.counName);
    if (country) ctx.countries.add(country);
    if (row.flowerName) ctx.flowers.add(row.flowerName);
    map.set(k, ctx);
  };

  for (const row of r.recordset) {
    const e = entries.get(row.WarehouseKey) || {
      warehouseKey: row.WarehouseKey, orderWeek: row.OrderWeek, awb: row.AWB,
      farm: row.farm, inv: row.inv, masterGW: Number(row.masterGW) || 0, masterCW: Number(row.masterCW) || 0,
      gw: 0, cw: 0, countries: new Set(), flowers: new Set(),
    };
    const isGross = isGrossWeightItem(row.prodName);
    const isChargeable = isChargeableWeightItem(row.prodName);
    if (isGross) e.gw += freightWeightOfRow(row);
    if (isChargeable) e.cw += freightWeightOfRow(row);
    const country = baseCountry(row.counName);
    // Freight Wise 업로드가 특수 GW/CW 행 자체에 국가를 저장하는 경우도 보존한다.
    if (country) e.countries.add(country);
    if (!isFreightItem(row.prodName)) {
      if (row.flowerName) e.flowers.add(row.flowerName);
      addContext(awbContext, row.AWB, row);
    }
    entries.set(row.WarehouseKey, e);
  }

  const toArray = (set) => [...(set || [])];
  const inferCategory = (entry) => {
    const inv = normalizeToken(entry.inv);
    const farm = normalizeToken(entry.farm);
    const ownCountries = toArray(entry.countries);
    const context = awbContext.get(normalizeAwb(entry.awb));
    const contextCountries = toArray(context?.countries);
    const flowers = [...toArray(entry.flowers), ...toArray(context?.flowers)];
    const text = `${inv} ${farm} ${flowers.join(' ')}`.toLowerCase();
    const isHydrangea = /수국|hydrangea/.test(text);
    const knownCountry = baseCountry(ownCountries.length === 1 ? ownCountries[0] : '')
      || baseCountry(contextCountries.length === 1 ? contextCountries[0] : '')
      || baseCountry(entry.farm);
    if (knownCountry === '콜롬비아') return isHydrangea ? '콜롬비아 수국' : '콜롬비아 4품목';
    if (knownCountry) return knownCountry;
    if (/수국|hydrangea/.test(inv) && /freightwise|apollo/.test(farm)) return '콜롬비아 수국';
    if (/^freightwiseecuador/.test(farm)) return '에콰도르';
    if (/^freightwise|^apollo/.test(farm) && (/콜수국/.test(inv))) return '콜롬비아 수국';
    if (/^freightwise|^apollo/.test(farm) && (/콜카장/.test(inv))) return '콜롬비아 4품목';
    if (/^holex|^ezflower/.test(farm)) return '네덜란드';
    if (/^excel$/.test(farm)) return '태국';
    if (/^cloudland|^yunnan/.test(farm)) return '중국';
    return null;
  };

  for (const entry of entries.values()) {
    const half = /-0?2$/.test(entry.orderWeek) ? 2 : 1;
    const gw = entry.gw > 1 ? entry.gw : entry.masterGW > 1 ? entry.masterGW : 0;
    const cw = entry.cw > 1 ? entry.cw : entry.masterCW > 1 ? entry.masterCW : 0;
    if (gw <= 0 && cw <= 0) continue;
    const cat = inferCategory(entry);
    if (cat === '콜롬비아 4품목') {
      const c = colombia[entry.orderWeek] || (colombia[entry.orderWeek] = { GW: 0, CW: 0 });
      c.GW += gw; c.CW += cw;
      continue;
    }
    if (!cat) continue;
    const e = countries[cat] || (countries[cat] = { GW1: 0, GW2: 0, CW1: 0, CW2: 0 });
    e[half === 1 ? 'GW1' : 'GW2'] += gw;
    e[half === 1 ? 'CW1' : 'CW2'] += cw;
  }
  return { countries, colombia };
}

// ── 콜롬비아 4품목 박스수량 — WarehouseDetail 자동집계(수정 가능, 화면에서 override)
export async function colombiaBoxQtyByCategory(orderWeek, orderYear) {
  const r = await query(
    `SELECT ${CASE_COLOMBIA_ALLOC} AS Category, SUM(ISNULL(wd.BoxQuantity,0)) AS q
       FROM WarehouseDetail wd
       JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
       LEFT JOIN Product p ON wd.ProdKey=p.ProdKey
      WHERE wm.OrderWeek=@wk AND wm.OrderYear=@yr AND ISNULL(wm.isDeleted,0)=0
        AND ISNULL(p.CounName,'') LIKE N'%콜롬비아%' AND (${CASE_COLOMBIA_ALLOC}) IS NOT NULL
      GROUP BY ${CASE_COLOMBIA_ALLOC}`,
    { wk: { type: sql.NVarChar, value: orderWeek }, yr: { type: sql.NVarChar, value: String(orderYear) } }
  );
  return Object.fromEntries(r.recordset.map((x) => [x.Category, Number(x.q)]));
}

/** 포워딩(S) 자동감지 — WarehouseDetail 의 '운송료'/'SERVICE FEE' 라인을 국가별로 자동 집계.
 * 2단계 판별(2026-07-10, 22~26차 6개 반차수 54건 실측 대조 — 미분류 0건):
 *  ① 같은 BILL(WarehouseKey) 안에 실제 꽃(국내 아닌 CounName) 라인이 있으면 그 국가 사용
 *     — 네덜란드(Holex 등)·중국(Yunnan Melody/Cloudland 등, 매주 다른 농장)은 이 경로로만 잡힘,
 *       또 콜롬비아 농장 인보이스에 운송료가 한 줄 섞인 경우(Flores De Funza 등 소액)도 이 경로로 정확히 잡힘.
 *  ② 없으면(=BILL 전체가 순수 운송료, FREIGHTWISE AWB류) FarmName 패턴 매칭.
 * 콜롬비아는 InvoiceNo 로 '수국'(국가레벨 직접) vs 나머지4품목(반차수별 무게배분용 total)을 나눈다.
 * 반환: { direct: {카테고리: USD합}, colombiaRest: {반차수: USD합} } */
export async function autoForwardingByCountry(major, orderYear) {
  const r = await query(
    `WITH freight AS (
       SELECT wd.WarehouseKey, wd.TPrice, wm.OrderWeek, wm.FarmName, wm.InvoiceNo
         FROM WarehouseDetail wd
         JOIN WarehouseMaster wm ON wd.WarehouseKey=wm.WarehouseKey
         JOIN Product p ON wd.ProdKey=p.ProdKey
        WHERE (p.ProdName LIKE N'%운송료%' OR p.ProdName=N'SERVICE FEE') AND ISNULL(wm.isDeleted,0)=0
          AND wm.OrderWeek LIKE @pfx AND ISNULL(wm.OrderYear,'')=@yr
     ),
     billCoun AS (
       SELECT wd.WarehouseKey, MAX(p.CounName) AS RealCoun
         FROM WarehouseDetail wd JOIN Product p ON wd.ProdKey=p.ProdKey
        WHERE ISNULL(p.CounName,N'')<>N'국내' AND ISNULL(p.CounName,N'')<>''
        GROUP BY wd.WarehouseKey
     )
     SELECT f.OrderWeek, f.InvoiceNo, f.TPrice,
       CASE
         WHEN bc.RealCoun IS NOT NULL THEN bc.RealCoun
         WHEN UPPER(REPLACE(ISNULL(f.FarmName,N''),N' ',N'')) LIKE N'%FREIGHTWISEECUADOR%' OR f.FarmName LIKE N'%에콰도르%' THEN N'에콰도르'
         WHEN UPPER(REPLACE(ISNULL(f.FarmName,N''),N' ',N'')) LIKE N'%FREIGHTWISE%' OR f.InvoiceNo LIKE N'%콜수국%' OR f.InvoiceNo LIKE N'%콜카장%' THEN N'콜롬비아'
         WHEN f.FarmName LIKE N'%EXCEL%' OR f.FarmName LIKE N'%태국%' THEN N'태국'
         ELSE NULL
       END AS InferredCoun
     FROM freight f LEFT JOIN billCoun bc ON f.WarehouseKey=bc.WarehouseKey`,
    { pfx: { type: sql.NVarChar, value: `${major}-%` }, yr: { type: sql.NVarChar, value: String(orderYear) } }
  );
  const direct = {}, colombiaRest = {};
  for (const row of r.recordset) {
    if (!row.InferredCoun) continue; // 패턴에 없는 새 농장 — 수기입력으로 커버(그외통관비 화면 하단 안내)
    const amt = Number(row.TPrice || 0);
    if (row.InferredCoun === '콜롬비아') {
      if (String(row.InvoiceNo || '').includes('수국')) direct['콜롬비아 수국'] = (direct['콜롬비아 수국'] || 0) + amt;
      else colombiaRest[row.OrderWeek] = (colombiaRest[row.OrderWeek] || 0) + amt;
    } else {
      direct[row.InferredCoun] = (direct[row.InferredCoun] || 0) + amt;
    }
  }
  return { direct, colombiaRest };
}

// ── 국가별(수국 포함) 그외통관비 저장값 로드/저장
export async function loadCustomsWeekly(major, orderYear) {
  await ensureCustomsTables();
  const r = await query(
    `SELECT * FROM WebCustomsWeekly WHERE OrderYear=@yr AND MajorWeek=@mw`,
    { yr: { type: sql.NVarChar, value: String(orderYear) }, mw: { type: sql.NVarChar, value: major } }
  );
  return Object.fromEntries(r.recordset.map((x) => [x.Category, hydrateCountrySplitColumns(x)]));
}

// 구형 저장값은 합계 컬럼만 있으므로 1차 첫 번째 칸으로 표시해 사용자가 기존 금액을 잃지 않게 한다.
export function hydrateCountrySplitColumns(row) {
  const out = { ...(row || {}) };
  for (const group of COUNTRY_SPLIT_GROUPS) {
    const hasPart = group.parts.some((field) => out[field] != null && out[field] !== '');
    if (!hasPart && out[group.total] != null && out[group.total] !== '') out[group.parts[0]] = out[group.total];
  }
  return out;
}

// 분할 입력값이 하나라도 전달되면 합계 컬럼을 서버에서 다시 계산한다.
// 따라서 화면/외부 호출자가 합계값을 임의로 보내도 저장 원칙이 흔들리지 않는다.
export function normalizeCountryInput(row) {
  const out = { ...(row || {}) };
  for (const group of COUNTRY_SPLIT_GROUPS) {
    const hasPart = group.parts.some((field) => Object.prototype.hasOwnProperty.call(out, field));
    if (hasPart) out[group.total] = group.parts.reduce((sum, field) => sum + n0(out[field]), 0);
  }
  return out;
}

export async function saveCustomsWeekly(major, orderYear, category, row, actor) {
  return saveCustomsWeeklyBatch(major, orderYear, [{ category, row }], actor);
}

export async function saveCustomsWeeklyBatch(major, orderYear, entries, actor) {
  await ensureCustomsTables();
  const deduped = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const category = String(entry?.category || '').trim();
    if (category) deduped.set(category, { category, row: entry?.row || {} });
  }
  if (!deduped.size) return;
  const existingRows = await loadCustomsWeekly(major, orderYear);
  await withTransaction(async (tQ) => {
    for (const { category, row: input } of deduped.values()) {
      const row = normalizeCountryInput(input);
      const existing = existingRows[category] || {};
      const scopeKey = `${major}|${category}`;
      const params = {
        yr: { type: sql.NVarChar, value: String(orderYear) }, mw: { type: sql.NVarChar, value: major },
        cat: { type: sql.NVarChar, value: category }, actor: { type: sql.NVarChar, value: actor || 'user' },
      };
      const setSql = [], insCol = [], insVal = [];
      for (const c of COUNTRY_STORAGE_FIELDS) {
        // 화면이 GW 기반 자동 월드 운송료를 표시하더라도, 명시적 입력이 없으면
        // 그 자동값을 수기 저장값으로 굳히지 않는다. 각 컬럼 부분 업데이트를 허용해
        // 다음 입고 GW/단가 변경 시 자동 재계산될 수 있게 한다.
        if (!Object.prototype.hasOwnProperty.call(row, c)) continue;
        const v = row[c];
        const isManualFlag = c === 'WorldFreight1Manual' || c === 'WorldFreight2Manual';
        params[c] = {
          type: isManualFlag ? sql.Bit : sql.Float,
          value: v == null || v === '' ? null : Number(v),
        };
        setSql.push(`[${c}]=@${c}`); insCol.push(`[${c}]`); insVal.push(`@${c}`);
        await logHistory(tQ, orderYear, 'Country', scopeKey, c, existing[c], v, actor);
      }
      if (!setSql.length) continue;
      await tQ(
        `MERGE WebCustomsWeekly AS t
         USING (SELECT @yr AS OrderYear, @mw AS MajorWeek, @cat AS Category) AS s
            ON t.OrderYear=s.OrderYear AND t.MajorWeek=s.MajorWeek AND t.Category=s.Category
         WHEN MATCHED THEN UPDATE SET ${setSql.join(',')}, UpdatedBy=@actor, UpdatedAt=GETDATE()
         WHEN NOT MATCHED THEN INSERT (OrderYear, MajorWeek, Category, ${insCol.join(',')}, UpdatedBy)
              VALUES (@yr, @mw, @cat, ${insVal.join(',')}, @actor);`,
        params
      );
    }
  });
}

// ── 콜롬비아 반차수 공유값(그외통관비+포워딩) 로드/저장
export async function loadColombiaWeekly(orderWeek, orderYear) {
  await ensureCustomsTables();
  const r = await query(
    `SELECT * FROM WebColombiaWeekly WHERE OrderYear=@yr AND OrderWeek=@wk`,
    { yr: { type: sql.NVarChar, value: String(orderYear) }, wk: { type: sql.NVarChar, value: orderWeek } }
  );
  return r.recordset[0] || null;
}
export async function saveColombiaWeekly(orderWeek, orderYear, row, actor) {
  await ensureCustomsTables();
  const cols = ['GW', 'CW', 'HandlingFee', 'ItemCount', 'Truck1t', 'Truck2_5t', 'Truck5t', 'CustomsFee', 'DisinfectFee', 'QuarantineDeductFee', 'AirRateUSD'];
  const existing = (await loadColombiaWeekly(orderWeek, orderYear)) || {};
  const params = {
    yr: { type: sql.NVarChar, value: String(orderYear) }, wk: { type: sql.NVarChar, value: orderWeek },
    actor: { type: sql.NVarChar, value: actor || 'user' },
  };
  const setSql = [], insCol = [], insVal = [];
  for (const c of cols) {
    if (!(c in row)) continue; // 부분 업데이트 허용(그외통관비 화면/포워딩 화면이 각자 자기 컬럼만 보냄)
    const v = row[c];
    params[c] = { type: sql.Float, value: v == null || v === '' ? null : Number(v) };
    setSql.push(`${c}=@${c}`); insCol.push(c); insVal.push(`@${c}`);
  }
  if (!setSql.length) return;
  await withTransaction(async (tQ) => {
    for (const c of cols) { if (c in row) await logHistory(tQ, orderYear, 'Colombia', orderWeek, c, existing[c], row[c], actor); }
    await tQ(
      `MERGE WebColombiaWeekly AS t
       USING (SELECT @yr AS OrderYear, @wk AS OrderWeek) AS s
          ON t.OrderYear=s.OrderYear AND t.OrderWeek=s.OrderWeek
       WHEN MATCHED THEN UPDATE SET ${setSql.join(',')}, UpdatedBy=@actor, UpdatedAt=GETDATE()
       WHEN NOT MATCHED THEN INSERT (OrderYear, OrderWeek, ${insCol.join(',')}, UpdatedBy)
            VALUES (@yr, @wk, ${insVal.join(',')}, @actor);`,
      params
    );
  });
}

// ── 국가별 포워딩(USD) 직접입력 로드/저장
export async function loadForwardingWeekly(major, orderYear) {
  await ensureCustomsTables();
  const r = await query(
    `SELECT Category, AmountUSD FROM WebForwardingWeekly WHERE OrderYear=@yr AND MajorWeek=@mw`,
    { yr: { type: sql.NVarChar, value: String(orderYear) }, mw: { type: sql.NVarChar, value: major } }
  );
  return Object.fromEntries(r.recordset.map((x) => [x.Category, Number(x.AmountUSD)]));
}
export async function saveForwardingWeekly(major, orderYear, category, amountUSD, actor) {
  await ensureCustomsTables();
  const scopeKey = `${major}|${category}`;
  const existing = await loadForwardingWeekly(major, orderYear);
  await withTransaction(async (tQ) => {
    await logHistory(tQ, orderYear, 'Forwarding', scopeKey, 'AmountUSD', existing[category], amountUSD, actor);
    await tQ(
      `MERGE WebForwardingWeekly AS t
       USING (SELECT @yr AS OrderYear, @mw AS MajorWeek, @cat AS Category) AS s
          ON t.OrderYear=s.OrderYear AND t.MajorWeek=s.MajorWeek AND t.Category=s.Category
       WHEN MATCHED THEN UPDATE SET AmountUSD=@v, UpdatedBy=@actor, UpdatedAt=GETDATE()
       WHEN NOT MATCHED THEN INSERT (OrderYear, MajorWeek, Category, AmountUSD, UpdatedBy)
            VALUES (@yr, @mw, @cat, @v, @actor);`,
      {
        yr: { type: sql.NVarChar, value: String(orderYear) }, mw: { type: sql.NVarChar, value: major }, cat: { type: sql.NVarChar, value: category },
        v: { type: sql.Float, value: amountUSD == null || amountUSD === '' ? null : Number(amountUSD) },
        actor: { type: sql.NVarChar, value: actor || 'user' },
      }
    );
  });
}

// ── 순수 계산 함수 (DB 의존 없음, 화면 미리보기·API 공용)
const n0 = (v) => (v == null || Number.isNaN(Number(v)) ? 0 : Number(v));

/**
 * 입고 Gross Weight를 매출원가 양식의 월드 운송료 등급/금액으로 변환한다.
 * 콜롬비아 반차수에서 검증된 1t/2.5t/5t 경계값을 국가별 1·2차에도 동일하게 적용한다.
 * 저장된 WorldFreight 값이 없을 때만 이 자동값을 사용하며, 자동값 자체는 DB에 수기값으로 저장하지 않는다.
 */
export function deriveWorldFreight(grossWeight, rates = RATE_DEFAULTS) {
  const allocation = deriveColombiaTruckAllocation(grossWeight);
  const amount = allocation.Truck1t * n0(rates?.Truck1t)
    + allocation.Truck2_5t * n0(rates?.Truck2_5t)
    + allocation.Truck5t * n0(rates?.Truck5t);
  return {
    ...allocation,
    amount: Math.round(amount),
    source: allocation.source === 'missing' ? 'missing' : 'warehouse_gw_auto',
  };
}

function hasExplicitValue(row, field) {
  return Object.prototype.hasOwnProperty.call(row || {}, field)
    && row[field] != null && row[field] !== '';
}

/** 현재 국가행의 GW와 월드 운송료를 계산에 사용할 형태로 만든다. */
export function effectiveCountryWorldFreight(row, gwDef, rates = RATE_DEFAULTS) {
  const effective = mergeCountryGw(row, gwDef);
  const first = deriveWorldFreight(effective.GW1, rates);
  const second = deriveWorldFreight(effective.GW2, rates);
  const auto = { WorldFreight1: first.amount, WorldFreight2: second.amount };
  const out = { ...effective };
  const manual1 = Number(row?.WorldFreight1Manual) === 1;
  const manual2 = Number(row?.WorldFreight2Manual) === 1;
  if (!manual1 && first.amount > 0) out.WorldFreight1 = first.amount;
  if (!manual2 && second.amount > 0) out.WorldFreight2 = second.amount;
  return {
    row: out,
    auto,
    source: {
      WorldFreight1: manual1 ? 'manual_override' : (first.amount > 0 ? first.source : (hasExplicitValue(row, 'WorldFreight1') ? 'legacy_saved' : 'missing')),
      WorldFreight2: manual2 ? 'manual_override' : (second.amount > 0 ? second.source : (hasExplicitValue(row, 'WorldFreight2') ? 'legacy_saved' : 'missing')),
    },
  };
}

/** 국가별(수국 포함) 그외통관비 총액 — 엑셀 그외통관비!I35~I45 그대로.
 * 백상창고료·관세는 그대로 더하고, 선율·월드운송료·한국방역(전부 리터럴 1차+2차)은 ÷1.1(공급가) 후 더한다.
 * 베트남 선율만 완성본 22/24/26차와 수식 포함 26차 파일에서 공급가 리터럴로 더하므로 VAT를 재차 제거하지 않는다. */
export function computeCountryCustomsTotal(row, rates, category = '') {
  if (!row) return 0;
  const bakSang = (n0(row.GW1) + n0(row.GW2)) * n0(rates.BakSangRate);       // 그대로(부가세 미분리)
  const splitAmount = (total, parts) => {
    const hasPart = parts.some((field) => Object.prototype.hasOwnProperty.call(row, field));
    return hasPart ? parts.reduce((sum, field) => sum + n0(row[field]), 0) : n0(row[total]);
  };
  const customs = splitAmount('Customs1', COUNTRY_SPLIT_GROUPS[0].parts)
    + splitAmount('Customs2', COUNTRY_SPLIT_GROUPS[1].parts);                // 분할 합계 그대로
  const sunYulGross = splitAmount('SunYul1', COUNTRY_SPLIT_GROUPS[2].parts)
    + splitAmount('SunYul2', COUNTRY_SPLIT_GROUPS[3].parts);
  const sunYul = category === '베트남' ? sunYulGross : sunYulGross / 1.1;
  const worldFreight = (n0(row.WorldFreight1) + n0(row.WorldFreight2)) / 1.1;
  const domesticQuarantine = (n0(row.Quarantine1) + n0(row.Quarantine2)) / 1.1;
  return bakSang + customs + sunYul + worldFreight + domesticQuarantine;
}

/** 콜롬비아 4품목 반차수 TOTAL 그외통관비(=C17, 부가세 무관 합산 — 엑셀은 이 TOTAL을 그대로 무게비율 배분) */
export function computeColombiaCustomsTotal(row, rates) {
  if (!row) return 0;
  const bakSang = n0(row.GW) * n0(rates.BakSangRate);
  const truck = n0(row.Truck1t) * n0(rates.Truck1t) + n0(row.Truck2_5t) * n0(rates.Truck2_5t) + n0(row.Truck5t) * n0(rates.Truck5t);
  return bakSang + n0(row.HandlingFee) + n0(row.ItemCount) * n0(rates.QuarantinePerItemRate) + truck
    + n0(row.CustomsFee) + n0(row.DisinfectFee) + n0(row.QuarantineDeductFee);
}

/** 콜롬비아 4품목 카테고리별 배분비율 — 무게비율(항상, 그외통관비용)과 CBM비율(포워딩 GW≠CW일 때용) 둘 다 반환.
 * boxQty = { '콜롬비아 장미': qty, ... } (WarehouseDetail 자동집계 또는 수기 override) */
const RATE_KEY_SUFFIX = { '콜롬비아 장미': '콜롬비아장미', '콜롬비아 카네이션': '콜롬비아카네이션', '콜롬비아 알스트로': '콜롬비아알스트로', '콜롬비아 루스커스': '콜롬비아루스커스' };
export function computeColombiaRatios(boxQty, rates) {
  const weights = COLOMBIA_ALLOC_CATEGORIES.map((cat) => n0(boxQty[cat]) * n0(rates[`BoxWeight_${RATE_KEY_SUFFIX[cat]}`]));
  const cbms = COLOMBIA_ALLOC_CATEGORIES.map((cat) => n0(boxQty[cat]) * n0(rates[`BoxCBM_${RATE_KEY_SUFFIX[cat]}`]));
  const wSum = weights.reduce((a, b) => a + b, 0);
  const cSum = cbms.reduce((a, b) => a + b, 0);
  const weightRatio = {}, cbmRatio = {};
  COLOMBIA_ALLOC_CATEGORIES.forEach((cat, i) => {
    weightRatio[cat] = wSum > 0 ? weights[i] / wSum : 0;
    cbmRatio[cat] = cSum > 0 ? cbms[i] / cSum : 0;
  });
  return { weightRatio, cbmRatio };
}

/** 콜롬비아 4품목 카테고리별 {H그외통관비, S포워딩USD} — 반차수 1건 기준(1차 또는 2차 각각 호출 후 합산). */
export function computeColombiaAllocation(colWeeklyRow, boxQty, rates) {
  const total = computeColombiaCustomsTotal(colWeeklyRow, rates);
  const { weightRatio, cbmRatio } = computeColombiaRatios(boxQty, rates);
  const gw = n0(colWeeklyRow?.GW), cw = n0(colWeeklyRow?.CW);
  const useWeight = gw === 0 || cw === 0 || Math.abs(gw - cw) < 0.01; // GW≈CW → 무게기준, 엑셀 IF(L29=L30,...)
  const airTotal = n0(colWeeklyRow?.AirRateUSD);
  const out = {};
  for (const cat of COLOMBIA_ALLOC_CATEGORIES) {
    out[cat] = {
      H: total * weightRatio[cat],                                          // 그외통관비 — 항상 무게비율
      S: airTotal * (useWeight ? weightRatio[cat] : cbmRatio[cat]),         // 포워딩 총액(USD) — GW=CW 여부로 전환
    };
  }
  return out;
}

/** 대차수(major) 전체 카테고리의 H(그외통관비)/S(포워딩) — profit-report API 에서 호출하는 최상위 함수.
 * S(포워딩)는 autoForwardingByCountry(입고관리 자동감지)가 1순위, WebForwardingWeekly/WebColombiaWeekly
 * 수기 저장값은 자동감지가 놓친 경우(새 농장명 패턴 미매칭 등)를 덮어쓰는 override 로만 쓰인다. */
export async function computeCustomsAndForwarding(major, orderYear) {
  await ensureCustomsTables();
  const [rates, countryRows, fwdRows, subWeeks, autoFwd, autoGw] = await Promise.all([
    getRateConfig(),
    loadCustomsWeekly(major, orderYear),
    loadForwardingWeekly(major, orderYear),
    weeksForMajor(major, orderYear),
    autoForwardingByCountry(major, orderYear),
    loadWarehouseGw(major, orderYear), // 입고 GW = 무게 기준값 (수기 없으면 자동 사용)
  ]);

  const H = {}, S = {}, HSource = {}, SSource = {};
  for (const cat of COUNTRY_CATEGORIES) {
    const saved = countryRows[cat] != null;
    const gwDef = autoGw.countries?.[cat];
    const world = effectiveCountryWorldFreight(countryRows[cat], gwDef, rates);
    const eff = world.row;
    const hasGwAuto = Number(gwDef?.GW1) > 0 || Number(gwDef?.GW2) > 0;
    H[cat] = computeCountryCustomsTotal(saved || hasGwAuto ? eff : null, rates, cat);
    HSource[cat] = saved ? 'saved' : hasGwAuto ? 'gw_auto' : 'missing';
  }
  for (const cat of FORWARDING_DIRECT_CATEGORIES) {
    const overridden = fwdRows[cat] != null;
    const detected = Object.prototype.hasOwnProperty.call(autoFwd.direct, cat);
    S[cat] = overridden ? Number(fwdRows[cat]) : (autoFwd.direct[cat] || 0); // 수기 override > 자동감지
    SSource[cat] = overridden ? 'manual_override' : detected ? 'auto' : 'missing';
  }

  for (const cat of COLOMBIA_ALLOC_CATEGORIES) { H[cat] = 0; S[cat] = 0; }
  let colombiaSavedCount = 0;
  let colombiaGwAutoCount = 0;
  let colombiaHAvailableCount = 0;
  let colombiaForwardingCount = 0;
  let colombiaOverrideCount = 0;
  for (const wk of subWeeks) {
    const [colRow, boxQty] = await Promise.all([loadColombiaWeekly(wk, orderYear), colombiaBoxQtyByCategory(wk, orderYear)]);
    if (colRow) colombiaSavedCount += 1;
    const gwDef = autoGw.colombia?.[wk];
    if (!colRow && Number(gwDef?.GW) > 0) colombiaGwAutoCount += 1;
    const autoDetected = Object.prototype.hasOwnProperty.call(autoFwd.colombiaRest, wk);
    if (autoDetected || colRow?.AirRateUSD != null) colombiaForwardingCount += 1;
    if (colRow?.AirRateUSD != null) colombiaOverrideCount += 1;
    const autoAirTotal = autoFwd.colombiaRest[wk] || 0;
    const effectiveAirTotal = colRow?.AirRateUSD != null ? Number(colRow.AirRateUSD) : autoAirTotal; // 수기 override > 자동감지
    const effectiveRow = mergeColombiaTruck(mergeColombiaGw(colRow, gwDef), gwDef);
    if (Number(effectiveRow.GW) > 0) colombiaHAvailableCount += 1;
    const alloc = computeColombiaAllocation({ ...effectiveRow, AirRateUSD: effectiveAirTotal }, boxQty, rates);
    for (const cat of COLOMBIA_ALLOC_CATEGORIES) { H[cat] += alloc[cat].H; S[cat] += alloc[cat].S; }
  }
  const hColombiaSource = colombiaHAvailableCount === subWeeks.length
    ? (colombiaSavedCount === subWeeks.length ? 'saved' : 'gw_auto')
    : colombiaHAvailableCount > 0 ? 'partial'
    : colombiaGwAutoCount > 0 ? 'gw_auto' : 'missing';
  const sColombiaSource = colombiaForwardingCount === 0 ? 'missing' : colombiaForwardingCount === subWeeks.length
    ? (colombiaOverrideCount === subWeeks.length ? 'manual_override' : 'auto')
    : 'partial';
  for (const cat of COLOMBIA_ALLOC_CATEGORIES) {
    HSource[cat] = hColombiaSource;
    SSource[cat] = sColombiaSource;
  }
  return {
    H, S, rates,
    sources: {
      H: HSource,
      S: SSource,
      colombia: { expectedWeeks: subWeeks.length, customsSavedWeeks: colombiaSavedCount, forwardingDetectedWeeks: colombiaForwardingCount },
    },
  };
}
