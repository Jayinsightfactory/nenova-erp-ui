/**
 * lib/shipmentEstimateGuard.js — 출고(분배) → 견적서/매출 누락 방지 보호장치 (2026-10-15)
 *
 * 배경: 2026년 1~41차 이카운트 매출 ↔ exe 매출/불량 분석 차이 전수 조사에서 확인된
 * "분배는 있는데 견적서·매출에 안 나가는 4가지 경로"를 웹 쓰기 시점에 차단한다.
 *   ① 주문 없는 출고 — 견적서/매출/이카운트 산식이 ViewShipment ⋈ ViewOrder(OrderYearWeek2+CustKey+ProdKey)
 *      조인이라 주문서에 없는 품목의 출고는 어디에도 집계되지 않는다(청구 누락).
 *   ② ShipmentDetail 금액 ≠ ShipmentDate(출고일별 견적) 합 — 견적서·이카운트는 ShipmentDate,
 *      exe 매출/불량 분석은 ShipmentDetail 을 읽어 서로 다른 숫자가 보인다.
 *   ③ 거래처/품목 삭제(isDeleted=1) — ViewShipment·ViewOrder 가 c.isDeleted=0, p.isDeleted=0 조건이라
 *      확정 출고가 매출에서 사라진다.
 *   ④ OrderYearWeek ≠ OrderYear+대차수 / 출고일이 차수(PeriodDay) 범위 밖 — 연말→연초(52→01) 연도 계산
 *      버그로 2026년 1·2차 출고가 202501/202502 로 저장된 사례.
 *
 * 원칙: 기존 산식(lib/exeEstimateViewSql.js)·기존 데이터는 바꾸지 않는다. 쓰기 시점 검증 + 읽기 전용 진단만.
 * 모든 함수는 호출자의 트랜잭션 tQ(query, params) 를 그대로 사용한다.
 *
 * ⚠️ EstQuantity 동기화는 기본 OFF. 2026년 확정 라인 45,176줄 중 ShipmentDetail.EstQuantity 가
 *    ShipmentDate 합과 다른 줄이 12,203줄(박스 수량 그대로 저장)로 "원래부터 단위가 다른" 구조라
 *    강제 동기화는 기존 데이터 의미를 바꾼다. 금액(Amount/Vat)·단가(Cost)만 동기화한다.
 */

export const GUARD_CODES = Object.freeze({
  SHIPMENT_WITHOUT_ORDER: 'SHIPMENT_WITHOUT_ORDER',
  SHIPMENT_WEEK_KEY_MISMATCH: 'SHIPMENT_WEEK_KEY_MISMATCH',
  SHIPMENT_DATE_OUT_OF_WEEK: 'SHIPMENT_DATE_OUT_OF_WEEK',
  MASTER_HAS_FIXED_SHIPMENT: 'MASTER_HAS_FIXED_SHIPMENT',
});

/** 출고일이 차수 PeriodDay 범위를 벗어나도 허용하는 일수(조기 출고·차수 경계 보정분). 실데이터 확정 라인은 0~+6일만 존재. */
export const SHIPMENT_DATE_WEEK_TOLERANCE_DAYS = 7;

function guardError(code, message, extra = {}) {
  const e = new Error(message);
  e.code = code;
  e.statusCode = 409;
  Object.assign(e, extra);
  return e;
}

const EPS = 0.001;
const MONEY_EPS = 1; // 출고일 2건 이상 분할 시 원 단위 반올림(±1원) 차이는 불일치로 보지 않음 (2026년 확정 135줄이 이 유형)

/* ───────────────────────── 차수 키 ───────────────────────── */

/** 'NN-NN' → { parentWeek:'NN', orderYearWeek:'YYYYNN', orderYearWeek2:'YYYYNNNN' } */
export function shipmentWeekKeys(orderYear, orderWeek) {
  const yr = String(orderYear || '').trim();
  const wk = String(orderWeek || '').trim();
  const parentWeek = wk.split('-')[0];
  return {
    orderYear: yr,
    orderWeek: wk,
    parentWeek,
    orderYearWeek: yr + parentWeek,            // ShipmentMaster.OrderYearWeek = 연도+대차수 (세부차수 제외)
    orderYearWeek2: yr + wk.replace(/-/g, ''), // ViewOrder/ViewShipment.OrderYearWeek2 = 연도+세부차수
  };
}

function toYmd(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getFullYear(), m = String(value.getMonth() + 1).padStart(2, '0'), d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function ymdToDays(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/**
 * 순수 검증 (DB 없음). 테스트 가능.
 * @param {object} p
 * @param {string} p.orderYear       '2026'
 * @param {string} p.orderWeek       '01-01'
 * @param {string} [p.orderYearWeek] 저장하려는 ShipmentMaster.OrderYearWeek (없으면 키 비교 생략)
 * @param {Date|string} [p.shipmentDtm]  출고일
 * @param {{weekStartYmd:string, weekEndYmd:string}|null} [p.weekRange] PeriodDay 에서 읽은 차수 범위
 * @param {number} [p.toleranceDays]
 * @returns {{ok:boolean, code?:string, message?:string, expectedOrderYearWeek:string}}
 */
export function validateShipmentWeek({ orderYear, orderWeek, orderYearWeek, shipmentDtm, weekRange, toleranceDays = SHIPMENT_DATE_WEEK_TOLERANCE_DAYS }) {
  const keys = shipmentWeekKeys(orderYear, orderWeek);
  if (!/^\d{4}$/.test(keys.orderYear) || !/^\d{2}(-\d{2})?$/.test(keys.orderWeek)) {
    return { ok: false, code: GUARD_CODES.SHIPMENT_WEEK_KEY_MISMATCH, expectedOrderYearWeek: keys.orderYearWeek,
      message: `차수 형식 오류: OrderYear='${orderYear}', OrderWeek='${orderWeek}'` };
  }
  if (orderYearWeek != null && String(orderYearWeek).trim() !== keys.orderYearWeek) {
    return { ok: false, code: GUARD_CODES.SHIPMENT_WEEK_KEY_MISMATCH, expectedOrderYearWeek: keys.orderYearWeek,
      message: `OrderYearWeek 불일치: 저장값 '${orderYearWeek}' ≠ 연도+대차수 '${keys.orderYearWeek}' (${keys.orderYear}년 ${keys.orderWeek}차). 연말→연초 차수 연도 계산을 확인하세요.` };
  }
  const ship = toYmd(shipmentDtm);
  if (ship && weekRange?.weekStartYmd && weekRange?.weekEndYmd) {
    const s = ymdToDays(weekRange.weekStartYmd), e = ymdToDays(weekRange.weekEndYmd), d = ymdToDays(ship);
    if (d < s - toleranceDays || d > e + toleranceDays) {
      return { ok: false, code: GUARD_CODES.SHIPMENT_DATE_OUT_OF_WEEK, expectedOrderYearWeek: keys.orderYearWeek,
        message: `출고일 ${ship} 이 ${keys.orderYear}년 ${keys.parentWeek}차 범위(${weekRange.weekStartYmd}~${weekRange.weekEndYmd}, ±${toleranceDays}일) 밖입니다. 차수 연도(OrderYear) 또는 출고일을 확인하세요.` };
    }
  }
  return { ok: true, expectedOrderYearWeek: keys.orderYearWeek };
}

/** PeriodDay 에서 차수 범위 읽기 (없으면 null — 범위 검증 생략) */
export async function loadWeekRange(tQ, sql, orderYearWeek) {
  const r = await tQ(
    `SELECT MIN(WeekStartYmd) AS weekStartYmd, MAX(WeekEndYmd) AS weekEndYmd
       FROM PeriodDay WHERE OrderYearWeek = @ywk`,
    { ywk: { type: sql.NVarChar, value: String(orderYearWeek) } },
  );
  const row = r.recordset?.[0];
  if (!row || !row.weekStartYmd || !row.weekEndYmd) return null;
  return { weekStartYmd: toYmd(row.weekStartYmd), weekEndYmd: toYmd(row.weekEndYmd) };
}

/**
 * ④ 출고 마스터/상세 저장 전 차수 검증. 불일치면 throw (statusCode 409).
 * orderYearWeek 를 넘기면 키 일치, shipmentDtm 을 넘기면 PeriodDay 범위를 함께 검사한다.
 */
export async function assertShipmentWeekConsistent(tQ, sql, { orderYear, orderWeek, orderYearWeek, shipmentDtm }) {
  const keys = shipmentWeekKeys(orderYear, orderWeek);
  const weekRange = shipmentDtm ? await loadWeekRange(tQ, sql, keys.orderYearWeek) : null;
  const v = validateShipmentWeek({ orderYear, orderWeek, orderYearWeek, shipmentDtm, weekRange });
  if (!v.ok) throw guardError(v.code, v.message, { orderYear: keys.orderYear, orderWeek: keys.orderWeek, expectedOrderYearWeek: v.expectedOrderYearWeek });
  return v;
}

/* ───────────────────────── ① 주문 없는 출고 ───────────────────────── */

/**
 * (OrderYearWeek2, CustKey, ProdKey) 가 ViewOrder 에 없으면 throw.
 * ViewOrder 는 exe 와 같은 공유 뷰(OrderMaster⋈OrderDetail⋈Customer(isDeleted=0)⋈Product(isDeleted=0)⋈UserInfo(Manager)).
 * 즉 주문 자체가 없거나, 거래처/품목이 삭제됐거나, 주문 담당자(Manager)가 UserInfo 에 없으면 모두 "주문 없음"이다.
 */
export async function assertShipmentLineHasOrder(tQ, sql, { orderYear, orderWeek, custKey, prodKey }) {
  const keys = shipmentWeekKeys(orderYear, orderWeek);
  const r = await tQ(
    `SELECT
       (SELECT COUNT(*) FROM ViewOrder vo
         WHERE vo.OrderYearWeek2 = @yw2 AND vo.CustKey = @ck AND vo.ProdKey = @pk) AS orderCount,
       (SELECT TOP 1 CustName FROM Customer WHERE CustKey = @ck) AS custName,
       (SELECT TOP 1 ISNULL(isDeleted,0) FROM Customer WHERE CustKey = @ck) AS custDeleted,
       (SELECT TOP 1 ProdName FROM Product WHERE ProdKey = @pk) AS prodName,
       (SELECT TOP 1 ISNULL(isDeleted,0) FROM Product WHERE ProdKey = @pk) AS prodDeleted,
       (SELECT COUNT(*) FROM OrderMaster om JOIN OrderDetail od ON od.OrderMasterKey = om.OrderMasterKey
         WHERE om.OrderYear = @yr AND om.OrderWeek = @wk AND om.CustKey = @ck AND od.ProdKey = @pk
           AND ISNULL(om.isDeleted,0) = 0 AND ISNULL(od.isDeleted,0) = 0) AS rawOrderCount`,
    {
      yw2: { type: sql.NVarChar, value: keys.orderYearWeek2 },
      yr: { type: sql.NVarChar, value: keys.orderYear },
      wk: { type: sql.NVarChar, value: keys.orderWeek },
      ck: { type: sql.Int, value: Number(custKey) },
      pk: { type: sql.Int, value: Number(prodKey) },
    },
  );
  const row = r.recordset?.[0] || {};
  if (Number(row.orderCount) > 0) return { ok: true, orderCount: Number(row.orderCount) };

  const cust = row.custName || `거래처 ${custKey}`;
  const prod = row.prodName || `품목 ${prodKey}`;
  let why;
  if (Number(row.custDeleted) === 1) why = `거래처 '${cust}' 가 삭제(isDeleted=1) 상태라 ViewOrder 에 나오지 않습니다.`;
  else if (Number(row.prodDeleted) === 1) why = `품목 '${prod}' 이 삭제(isDeleted=1) 상태라 ViewOrder 에 나오지 않습니다.`;
  else if (Number(row.rawOrderCount) > 0) why = `주문은 있으나 주문 담당자(OrderMaster.Manager)가 UserInfo 에 없어 ViewOrder 에서 빠집니다. 주문 담당자를 확인하세요.`;
  else why = `${keys.orderYear}년 ${keys.orderWeek}차 '${cust}' 주문서에 '${prod}' 품목이 없습니다. 주문서에 품목을 먼저 추가한 뒤 분배하세요.`;
  throw guardError(
    GUARD_CODES.SHIPMENT_WITHOUT_ORDER,
    `주문 없는 출고는 견적서·매출·이카운트 어디에도 집계되지 않아 저장을 막았습니다. ${why}`,
    { orderYear: keys.orderYear, orderWeek: keys.orderWeek, custKey: Number(custKey), prodKey: Number(prodKey), custName: row.custName || null, prodName: row.prodName || null },
  );
}

/**
 * 확정(usp_ShipmentFix) 직전 — 범위 내 미확정 출고 중 ViewOrder 에 없는 라인 목록. 있으면 throw.
 * custKey 생략 시 차수 전체. countryFlower 를 넘기면 해당 품종만.
 */
export async function assertNoOrderlessLinesBeforeFix(tQ, sql, { orderYear, orderWeek, custKey = null, countryFlower = null }) {
  const keys = shipmentWeekKeys(orderYear, orderWeek);
  const params = {
    yr: { type: sql.NVarChar, value: keys.orderYear },
    wk: { type: sql.NVarChar, value: keys.orderWeek },
    yw2: { type: sql.NVarChar, value: keys.orderYearWeek2 },
  };
  let extra = '';
  if (custKey != null && Number(custKey) > 0) { extra += ' AND sm.CustKey = @ck'; params.ck = { type: sql.Int, value: Number(custKey) }; }
  if (countryFlower) { extra += ' AND p.CountryFlower = @cf'; params.cf = { type: sql.NVarChar, value: String(countryFlower) }; }
  const r = await tQ(
    `SELECT TOP 50 sd.SdetailKey, sm.CustKey, c.CustName, sd.ProdKey, p.ProdName, sd.OutQuantity
       FROM ShipmentDetail sd
       JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
       LEFT JOIN Customer c ON c.CustKey = sm.CustKey
       LEFT JOIN Product p ON p.ProdKey = sd.ProdKey
      WHERE sm.OrderYear = @yr AND sm.OrderWeek = @wk AND ISNULL(sm.isDeleted,0) = 0
        AND ISNULL(sd.isFix,0) = 0 AND ISNULL(sd.OutQuantity,0) <> 0 ${extra}
        AND NOT EXISTS (SELECT 1 FROM ViewOrder vo
                         WHERE vo.OrderYearWeek2 = @yw2 AND vo.CustKey = sm.CustKey AND vo.ProdKey = sd.ProdKey)
      ORDER BY c.CustName, p.ProdName`,
    params,
  );
  const rows = r.recordset || [];
  if (!rows.length) return { ok: true, lines: [] };
  const sample = rows.slice(0, 5).map((x) => `${x.CustName || x.CustKey}/${x.ProdName || x.ProdKey}(${x.OutQuantity})`).join(', ');
  throw guardError(
    GUARD_CODES.SHIPMENT_WITHOUT_ORDER,
    `${keys.orderYear}년 ${keys.orderWeek}차 확정 대상에 주문서에 없는 출고 ${rows.length}건이 있어 확정을 막았습니다. 해당 거래처 주문서에 품목을 추가하거나 분배를 삭제한 뒤 확정하세요. 예: ${sample}`,
    { orderYear: keys.orderYear, orderWeek: keys.orderWeek, lines: rows },
  );
}

/* ───────────────────────── ② 금액 동기화 ───────────────────────── */

/**
 * ShipmentDate(출고일별 견적) 저장 직후 같은 SdetailKey 의 ShipmentDetail.Amount/Vat(/Cost) 를 ShipmentDate 합으로 맞춘다.
 * - ShipmentDate 행이 없으면 아무것도 하지 않는다(Detail 을 0 으로 밀지 않음).
 * - Cost 는 모든 출고일 단가가 같을 때만 복사한다(혼합 단가는 Detail 유지).
 * - EstQuantity 는 opts.alignEstQuantity=true 일 때만(기본 OFF — 파일 상단 주석 참조).
 * @returns {{changed:boolean, reason?:string, before?:object, after?:object}}
 */
export async function alignShipmentDetailMoneyToDates(tQ, sql, sdetailKey, opts = {}) {
  const dk = { type: sql.Int, value: Number(sdetailKey) };
  const r = await tQ(
    `SELECT sd.SdetailKey,
            sd.EstQuantity AS detailEst, sd.Cost AS detailCost,
            ISNULL(sd.Amount,0) AS detailAmount, ISNULL(sd.Vat,0) AS detailVat,
            x.n, x.priced, ISNULL(x.estSum,0) AS estSum, ISNULL(x.amountSum,0) AS amountSum, ISNULL(x.vatSum,0) AS vatSum,
            x.minCost, x.maxCost
       FROM ShipmentDetail sd
       OUTER APPLY (SELECT COUNT(*) AS n, SUM(CASE WHEN d.Amount IS NULL THEN 0 ELSE 1 END) AS priced,
                           SUM(ISNULL(d.EstQuantity,0)) AS estSum, SUM(ISNULL(d.Amount,0)) AS amountSum,
                           SUM(ISNULL(d.Vat,0)) AS vatSum, MIN(d.Cost) AS minCost, MAX(d.Cost) AS maxCost
                      FROM ShipmentDate d WHERE d.SdetailKey = sd.SdetailKey) x
      WHERE sd.SdetailKey = @dk`,
    { dk },
  );
  const row = r.recordset?.[0];
  if (!row) return { changed: false, reason: 'no-detail' };
  if (!(Number(row.n) > 0)) return { changed: false, reason: 'no-dates' };
  // 출고일 행은 있지만 금액이 한 번도 기재되지 않은(Amount NULL) 경우 — exe 견적 미작성 상태. Detail 금액을 0 으로 밀지 않는다.
  if (!(Number(row.priced) > 0)) return { changed: false, reason: 'dates-unpriced' };

  const uniformCost = row.minCost != null && row.maxCost != null && Math.abs(Number(row.minCost) - Number(row.maxCost)) < EPS;
  const after = {
    amount: Number(row.amountSum),
    vat: Number(row.vatSum),
    cost: uniformCost ? Number(row.minCost) : row.detailCost,
    est: opts.alignEstQuantity === true ? Number(row.estSum) : row.detailEst,
  };
  const before = { amount: Number(row.detailAmount), vat: Number(row.detailVat), cost: row.detailCost, est: row.detailEst };
  const changed = Math.abs(before.amount - after.amount) > MONEY_EPS
    || Math.abs(before.vat - after.vat) > MONEY_EPS
    || (uniformCost && (before.cost == null || Math.abs(before.cost - after.cost) > EPS))
    || (opts.alignEstQuantity === true && (before.est == null || Math.abs(before.est - after.est) > EPS));
  if (!changed) return { changed: false, reason: 'already-synced', before, after };

  const params = {
      dk,
      amount: { type: sql.Float, value: after.amount },
      vat: { type: sql.Float, value: after.vat },
  };
  let assignments = 'Amount=@amount, Vat=@vat';
  if (uniformCost) {
    assignments += ', Cost=@cost';
    params.cost = { type: sql.Float, value: after.cost };
  }
  if (opts.alignEstQuantity === true) {
    assignments += ', EstQuantity=@est';
    params.est = { type: sql.Float, value: after.est };
  }
  await tQ(`UPDATE ShipmentDetail SET ${assignments} WHERE SdetailKey=@dk`, params);
  return { changed: true, before, after };
}

/** 여러 SdetailKey 일괄 (중복 제거) */
export async function alignShipmentDetailMoneyToDatesMany(tQ, sql, sdetailKeys, opts = {}) {
  const out = [];
  for (const k of new Set((sdetailKeys || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))) {
    out.push({ sdetailKey: k, ...(await alignShipmentDetailMoneyToDates(tQ, sql, k, opts)) });
  }
  return out;
}

/* ───────────────────────── ③ 삭제 보호 ───────────────────────── */

/**
 * 거래처/품목 soft delete(isDeleted=1) 전 — 확정 출고(ShipmentDetail.isFix=1)가 있으면 throw(건수·차수 포함).
 * @param {'customer'|'product'} entity
 */
export async function assertMasterDeletable(tQ, sql, { entity, key }) {
  const col = entity === 'customer' ? 'sm.CustKey' : entity === 'product' ? 'sd.ProdKey' : null;
  if (!col) throw new Error(`assertMasterDeletable: unknown entity '${entity}'`);
  const r = await tQ(
    `SELECT sm.OrderYear, sm.OrderWeek, COUNT(*) AS cnt, SUM(ISNULL(sd.Amount,0)+ISNULL(sd.Vat,0)) AS amount
       FROM ShipmentDetail sd JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
      WHERE ${col} = @key AND ISNULL(sm.isDeleted,0) = 0 AND ISNULL(sd.isFix,0) = 1
      GROUP BY sm.OrderYear, sm.OrderWeek ORDER BY sm.OrderYear, sm.OrderWeek`,
    { key: { type: sql.Int, value: Number(key) } },
  );
  const weeks = r.recordset || [];
  if (!weeks.length) return { ok: true, fixedCount: 0, weeks: [] };
  const fixedCount = weeks.reduce((s, w) => s + Number(w.cnt), 0);
  const label = entity === 'customer' ? '거래처' : '품목';
  const weekList = weeks.map((w) => `${w.OrderYear}-${w.OrderWeek}(${w.cnt})`).join(', ');
  throw guardError(
    GUARD_CODES.MASTER_HAS_FIXED_SHIPMENT,
    `${label} 삭제 불가: 확정 출고 ${fixedCount}건이 있습니다. 삭제하면 ViewShipment/ViewOrder(isDeleted=0 조건)에서 빠져 해당 차수 매출이 사라집니다. 차수: ${weekList}`,
    { entity, key: Number(key), fixedCount, weeks },
  );
}

/* ───────────────────────── 읽기 전용 진단 SQL (관리자 API·무결성 스캐너 공용) ───────────────────────── */

/** 공통 WHERE 조각: 대차수 하한 (sm 별칭 필요) */
const WEEK_NUM = `TRY_CONVERT(int, LEFT(sm.OrderWeek, CHARINDEX('-', sm.OrderWeek + '-') - 1))`;

/** ① 주문 없는 확정 출고 (거래처·품목 모두 살아있는데 ViewOrder 에 없는 라인) */
export function sqlOrderlessFixedShipments({ orderYear = null, weekMin = 1 } = {}) {
  return `
SELECT sd.SdetailKey, sm.ShipmentKey, sm.OrderYear, sm.OrderWeek, sm.OrderYearWeek,
       sm.CustKey, c.CustName, sd.ProdKey, p.ProdName,
       sd.OutQuantity, sd.EstQuantity, sd.Cost, sd.Amount, sd.Vat, sd.ShipmentDtm, sd.isFix
  FROM ShipmentDetail sd
  JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
  JOIN Customer c ON c.CustKey = sm.CustKey AND ISNULL(c.isDeleted,0) = 0
  JOIN Product p ON p.ProdKey = sd.ProdKey AND ISNULL(p.isDeleted,0) = 0
 WHERE ISNULL(sm.isDeleted,0) = 0 AND ISNULL(sd.isFix,0) = 1 AND ISNULL(sd.OutQuantity,0) <> 0
   ${orderYear ? 'AND sm.OrderYear = @orderYear' : ''}
   AND ${WEEK_NUM} >= ${Number(weekMin) || 1}
   AND NOT EXISTS (SELECT 1 FROM ViewOrder vo
                    WHERE vo.OrderYearWeek2 = sm.OrderYear + REPLACE(sm.OrderWeek,'-','')
                      AND vo.CustKey = sm.CustKey AND vo.ProdKey = sd.ProdKey)
 ORDER BY sm.OrderYear, sm.OrderWeek, c.CustName, p.ProdName`;
}

/** ② 확정 라인 ShipmentDetail.Amount/Vat ≠ ShipmentDate 합 (EstQuantity 는 참고 컬럼으로만) */
export function sqlDetailDateMoneyMismatch({ orderYear = null, weekMin = 1, fixedOnly = true } = {}) {
  return `
SELECT sd.SdetailKey, sm.OrderYear, sm.OrderWeek, sm.CustKey, c.CustName, sd.ProdKey, p.ProdName,
       sd.OutQuantity, sd.EstQuantity, x.estSum AS dateEstSum,
       sd.Cost, x.minCost AS dateMinCost, x.maxCost AS dateMaxCost,
       sd.Amount, x.amountSum AS dateAmountSum, sd.Amount - x.amountSum AS amountDiff,
       sd.Vat, x.vatSum AS dateVatSum, x.n AS dateRows, x.priced AS dateRowsPriced, sd.isFix
  FROM ShipmentDetail sd
  JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
  LEFT JOIN Customer c ON c.CustKey = sm.CustKey
  LEFT JOIN Product p ON p.ProdKey = sd.ProdKey
 CROSS APPLY (SELECT COUNT(*) AS n, SUM(CASE WHEN d.Amount IS NULL THEN 0 ELSE 1 END) AS priced,
                     SUM(ISNULL(d.EstQuantity,0)) AS estSum, SUM(ISNULL(d.Amount,0)) AS amountSum,
                     SUM(ISNULL(d.Vat,0)) AS vatSum, MIN(d.Cost) AS minCost, MAX(d.Cost) AS maxCost
                FROM ShipmentDate d WHERE d.SdetailKey = sd.SdetailKey) x
 WHERE ISNULL(sm.isDeleted,0) = 0 ${fixedOnly ? 'AND ISNULL(sd.isFix,0) = 1' : ''}
   ${orderYear ? 'AND sm.OrderYear = @orderYear' : ''}
   AND ${WEEK_NUM} >= ${Number(weekMin) || 1}
   AND x.n > 0 AND x.priced > 0
   AND (ABS(ISNULL(sd.Amount,0) - x.amountSum) > ${MONEY_EPS} OR ABS(ISNULL(sd.Vat,0) - x.vatSum) > ${MONEY_EPS})
 ORDER BY ABS(ISNULL(sd.Amount,0) - x.amountSum) DESC`;
}

/** ②-b 확정 라인인데 출고일(ShipmentDate) 금액이 전부 NULL(exe 견적 미작성) — 견적서 GetData 의 sdd.EstQuantity>0 조건에 걸려 견적서·이카운트에 안 나감 */
export function sqlDetailWithUnpricedDates({ orderYear = null, weekMin = 1 } = {}) {
  return `
SELECT sd.SdetailKey, sm.OrderYear, sm.OrderWeek, sm.OrderYearWeek, sm.CustKey, c.CustName, sd.ProdKey, p.ProdName,
       sd.OutQuantity, sd.EstQuantity, sd.Cost, sd.Amount, sd.Vat, x.n AS dateRows, x.estSum AS dateEstSum, sd.isFix
  FROM ShipmentDetail sd
  JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
  LEFT JOIN Customer c ON c.CustKey = sm.CustKey
  LEFT JOIN Product p ON p.ProdKey = sd.ProdKey
 CROSS APPLY (SELECT COUNT(*) AS n, SUM(CASE WHEN d.Amount IS NULL THEN 0 ELSE 1 END) AS priced,
                     SUM(ISNULL(d.EstQuantity,0)) AS estSum
                FROM ShipmentDate d WHERE d.SdetailKey = sd.SdetailKey) x
 WHERE ISNULL(sm.isDeleted,0) = 0 AND ISNULL(sd.isFix,0) = 1 AND ISNULL(sd.OutQuantity,0) <> 0
   ${orderYear ? 'AND sm.OrderYear = @orderYear' : ''}
   AND ${WEEK_NUM} >= ${Number(weekMin) || 1}
   AND x.n > 0 AND x.priced = 0
 ORDER BY sm.OrderYear, sm.OrderWeek, c.CustName, p.ProdName`;
}

/** ③ 삭제된 거래처/품목에 걸린 확정 출고 (ViewShipment 에서 사라진 매출) */
export function sqlDeletedMasterFixedShipments({ orderYear = null, weekMin = 1 } = {}) {
  return `
SELECT sd.SdetailKey, sm.OrderYear, sm.OrderWeek, sm.CustKey, c.CustName, ISNULL(c.isDeleted,0) AS custDeleted,
       sd.ProdKey, p.ProdName, ISNULL(p.isDeleted,0) AS prodDeleted,
       sd.OutQuantity, sd.Amount, sd.Vat
  FROM ShipmentDetail sd
  JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
  LEFT JOIN Customer c ON c.CustKey = sm.CustKey
  LEFT JOIN Product p ON p.ProdKey = sd.ProdKey
 WHERE ISNULL(sm.isDeleted,0) = 0 AND ISNULL(sd.isFix,0) = 1
   ${orderYear ? 'AND sm.OrderYear = @orderYear' : ''}
   AND ${WEEK_NUM} >= ${Number(weekMin) || 1}
   AND (ISNULL(c.isDeleted,0) = 1 OR ISNULL(p.isDeleted,0) = 1 OR c.CustKey IS NULL OR p.ProdKey IS NULL)
 ORDER BY sm.OrderYear, sm.OrderWeek, c.CustName, p.ProdName`;
}

/** ④-a 마스터 OrderYearWeek ≠ OrderYear+대차수 */
export function sqlWeekKeyMismatchMasters({ orderYear = null } = {}) {
  return `
SELECT sm.ShipmentKey, sm.OrderYear, sm.OrderWeek, sm.OrderYearWeek,
       sm.OrderYear + LEFT(sm.OrderWeek, CHARINDEX('-', sm.OrderWeek + '-') - 1) AS expectedOrderYearWeek,
       sm.CustKey, c.CustName, sm.isFix, sm.CreateID, sm.CreateDtm,
       (SELECT COUNT(*) FROM ShipmentDetail sd WHERE sd.ShipmentKey = sm.ShipmentKey) AS detailCount
  FROM ShipmentMaster sm
  LEFT JOIN Customer c ON c.CustKey = sm.CustKey
 WHERE ISNULL(sm.isDeleted,0) = 0
   ${orderYear ? 'AND sm.OrderYear = @orderYear' : ''}
   AND ISNULL(sm.OrderYearWeek,'') <> sm.OrderYear + LEFT(sm.OrderWeek, CHARINDEX('-', sm.OrderWeek + '-') - 1)
 ORDER BY sm.OrderYear, sm.OrderWeek, sm.ShipmentKey`;
}

/** ④-b 상세 출고일이 마스터 차수(PeriodDay) 범위 ±tolerance 밖 */
export function sqlShipmentDateOutOfWeek({ orderYear = null, weekMin = 1, toleranceDays = SHIPMENT_DATE_WEEK_TOLERANCE_DAYS } = {}) {
  const t = Number(toleranceDays) || 0;
  return `
SELECT sd.SdetailKey, sm.ShipmentKey, sm.OrderYear, sm.OrderWeek, sm.OrderYearWeek, sm.CustKey, c.CustName,
       sd.ProdKey, p.ProdName, CONVERT(date, sd.ShipmentDtm) AS shipmentDate,
       pd.weekStartYmd, pd.weekEndYmd, sd.isFix, sd.OutQuantity
  FROM ShipmentDetail sd
  JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
  JOIN (SELECT OrderYearWeek, MIN(WeekStartYmd) AS weekStartYmd, MAX(WeekEndYmd) AS weekEndYmd
          FROM PeriodDay GROUP BY OrderYearWeek) pd
    ON pd.OrderYearWeek = sm.OrderYear + LEFT(sm.OrderWeek, CHARINDEX('-', sm.OrderWeek + '-') - 1)
  LEFT JOIN Customer c ON c.CustKey = sm.CustKey
  LEFT JOIN Product p ON p.ProdKey = sd.ProdKey
 WHERE ISNULL(sm.isDeleted,0) = 0 AND sd.ShipmentDtm IS NOT NULL
   ${orderYear ? 'AND sm.OrderYear = @orderYear' : ''}
   AND ${WEEK_NUM} >= ${Number(weekMin) || 1}
   AND (CONVERT(date, sd.ShipmentDtm) < DATEADD(day, -${t}, CONVERT(date, pd.weekStartYmd))
     OR CONVERT(date, sd.ShipmentDtm) > DATEADD(day, ${t}, CONVERT(date, pd.weekEndYmd)))
 ORDER BY sm.OrderYear, sm.OrderWeek, sd.SdetailKey`;
}

export const GUARD_DIAGNOSTIC_VIEWS = Object.freeze({
  orderlessFixed: { label: '① 주문 없는 확정 출고 (견적서·매출·이카운트 누락)', sql: sqlOrderlessFixedShipments },
  detailDateMoneyMismatch: { label: '② 확정 라인 ShipmentDetail 금액 ≠ ShipmentDate 합 (±1원 초과)', sql: sqlDetailDateMoneyMismatch },
  detailWithUnpricedDates: { label: '②-b 확정 라인인데 출고일 금액 전부 NULL (exe 견적 미작성 → 견적서·이카운트 누락)', sql: sqlDetailWithUnpricedDates },
  deletedMasterFixed: { label: '③ 삭제 거래처·품목의 확정 출고 (ViewShipment 누락)', sql: sqlDeletedMasterFixedShipments },
  weekKeyMismatch: { label: '④-a OrderYearWeek ≠ OrderYear+대차수', sql: sqlWeekKeyMismatchMasters },
  shipmentDateOutOfWeek: { label: `④-b 출고일이 차수 범위 ±${SHIPMENT_DATE_WEEK_TOLERANCE_DAYS}일 밖`, sql: sqlShipmentDateOutOfWeek },
});
