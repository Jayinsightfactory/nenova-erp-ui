// 불량 차감 — 수입부 확인 탭의 "입고 농장 후보" (읽기 전용)
// 같은 연도·같은 대차수(없으면 직전 대차수)에 그 품목을 입고한 농장을 보여 준다.
// SELECT 만 한다. 농장 칸을 채우거나 저장하지 않는다(사람이 기존 검색·확정으로 저장).
// 근거·한계: docs/MENU_SUGGESTION_PILOT_2026-11-14.md 카드 1
//   과거 채워진 787줄 대조(2026-11-14): 후보 1곳 207줄 중 184줄 일치(89%) → 자동 저장 금지.
// 이 파일은 화면에서도 불러 쓰므로 DB 모듈을 직접 불러오지 않는다(조회 함수는 호출하는 쪽이 넘긴다).

const MAX_SHOWN = 4;
const clean = (value) => String(value ?? '').trim();
const nameKey = (value) => clean(value).toLowerCase().replace(/\s+/g, ' ');

export function farmCandidateScope(year, week) {
  const y = Number(year);
  const w = Number(week);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new Error('연도를 확인하세요.');
  if (!Number.isInteger(w) || w < 1 || w > 53) throw new Error('차수를 확인하세요.');
  // 직전 대차수는 같은 연도 안에서만 본다(1차는 직전 없음).
  return { year: y, week: w, prevWeek: w > 1 ? w - 1 : 0 };
}

export function farmCandidateSql() {
  // WarehouseDetail 에는 isDeleted 가 없다 — 삭제 필터는 WarehouseMaster 로만.
  return `SELECT d.DeductionKey, LTRIM(RTRIM(wm.FarmName)) AS FarmName,
       MAX(CASE WHEN TRY_CAST(LEFT(wm.OrderWeek, CHARINDEX('-', wm.OrderWeek + '-') - 1) AS int) = @week THEN 1 ELSE 0 END) AS SameWeek,
       COUNT(DISTINCT wm.WarehouseKey) AS ReceiptCount,
       MAX(wm.OrderWeek) AS LastOrderWeek
  FROM WebSalesDefectDeduction d
  JOIN WarehouseDetail wd ON wd.ProdKey = d.ProdKey
  JOIN WarehouseMaster wm ON wm.WarehouseKey = wd.WarehouseKey
   AND ISNULL(wm.isDeleted, 0) = 0
   AND TRY_CAST(wm.OrderYear AS int) = @year
   AND TRY_CAST(LEFT(wm.OrderWeek, CHARINDEX('-', wm.OrderWeek + '-') - 1) AS int) IN (@week, @prevWeek)
 WHERE d.IsDeleted = 0 AND d.OrderYear = @year
   AND TRY_CAST(d.OrderWeek AS int) = @week
   AND d.ProdKey IS NOT NULL
   AND LTRIM(RTRIM(ISNULL(wm.FarmName, N''))) <> N''
 GROUP BY d.DeductionKey, LTRIM(RTRIM(wm.FarmName))`;
}

/** 조회 줄 → { [deductionKey]: { total, farms:[{farmName,sameWeek,receiptCount,lastOrderWeek}], more } } */
export function groupFarmCandidates(recordset = []) {
  const byKey = new Map();
  for (const item of recordset) {
    const key = Number(item.DeductionKey);
    const farmName = clean(item.FarmName);
    if (!key || !farmName) continue;
    const list = byKey.get(key) || new Map();
    const id = nameKey(farmName);
    const prev = list.get(id);
    const next = {
      farmName: prev?.farmName || farmName,
      sameWeek: !!(prev?.sameWeek || Number(item.SameWeek) === 1),
      receiptCount: (prev?.receiptCount || 0) + (Number(item.ReceiptCount) || 0),
      lastOrderWeek: [prev?.lastOrderWeek, clean(item.LastOrderWeek)].filter(Boolean).sort().pop() || '',
    };
    list.set(id, next);
    byKey.set(key, list);
  }
  const result = {};
  for (const [key, list] of byKey) {
    const farms = [...list.values()].sort((a, b) => Number(b.sameWeek) - Number(a.sameWeek)
      || b.receiptCount - a.receiptCount
      || a.farmName.localeCompare(b.farmName));
    result[key] = { total: farms.length, farms: farms.slice(0, MAX_SHOWN), more: Math.max(0, farms.length - MAX_SHOWN) };
    if (farms.length > MAX_SHOWN) result[key].remainingFarms = farms.slice(MAX_SHOWN);
  }
  return result;
}

/** 화면에 한 줄로 보일 글. 후보가 없으면 빈 문자열(아무것도 안 보임). */
export function farmCandidateLabel(entry) {
  if (!entry || !entry.total) return '';
  const names = entry.farms.map((farm) => (farm.sameWeek ? farm.farmName : `${farm.farmName}(직전 차수)`)).join(', ');
  return entry.total === 1
    ? `입고 농장 후보 1곳: ${names}`
    : `입고 농장 후보 ${entry.total}곳: ${names}${entry.more ? ` 외 ${entry.more}곳` : ''}`;
}

export async function loadDefectFarmCandidates({ year, week, query, sql } = {}) {
  if (typeof query !== 'function' || !sql?.Int) throw new Error('조회 함수가 필요합니다.');
  const scope = farmCandidateScope(year, week);
  const result = await query(farmCandidateSql(), {
    year: { type: sql.Int, value: scope.year },
    week: { type: sql.Int, value: scope.week },
    prevWeek: { type: sql.Int, value: scope.prevWeek },
  });
  return { year: scope.year, week: scope.week, candidates: groupFarmCandidates(result.recordset || []) };
}
