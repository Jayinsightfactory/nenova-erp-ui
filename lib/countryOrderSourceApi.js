import { COUNTRY_ORDER_COUNTRIES, CountryOrderSourceError, compareCountryOrderSubweeks } from './countryOrderSource.js';

export const COUNTRY_ORDER_CALENDAR_SQL = `SELECT TOP (7) OrderYearWeek,WeekDay,
 CONVERT(nvarchar(10),CONVERT(date,BaseYmd),23) AS BaseYmd
 FROM PeriodDay WHERE WeekDay=5 AND CONVERT(date,BaseYmd) >=
 (SELECT MIN(CONVERT(date,BaseYmd)) FROM PeriodDay WHERE WeekDay=5
 AND CONVERT(date,@today) BETWEEN CONVERT(date,BaseYmd) AND DATEADD(day,6,CONVERT(date,BaseYmd)))
 ORDER BY BaseYmd`;
export const COUNTRY_ORDER_ROWS_SQL = `SELECT TOP (100001) v.OrderYear,v.OrderWeek,v.CustKey,v.CustName,c.OrderCode AS CustOrderCode,
 v.ProdKey,p.ProdName,p.FlowerName,p.CounName,p.OutUnit,
 SUM(v.OutQuantity) AS OutQuantity,SUM(v.BoxQuantity) AS BoxQuantity,
 SUM(v.BunchQuantity) AS BunchQuantity,SUM(v.SteamQuantity) AS SteamQuantity,COUNT_BIG(*) AS SourceRowCount
 FROM ViewOrder v JOIN Product p ON p.ProdKey=v.ProdKey AND p.isDeleted=0
 JOIN Customer c ON c.CustKey=v.CustKey AND c.isDeleted=0
 WHERE v.OrderYear=@orderYear AND v.OrderWeek LIKE @majorWeek + N'-%'
 AND v.CounName=@counName AND p.CounName=@counName
 GROUP BY v.OrderYear,v.OrderWeek,v.CustKey,v.CustName,c.OrderCode,v.ProdKey,p.ProdName,p.FlowerName,p.CounName,p.OutUnit
 ORDER BY v.OrderWeek,v.ProdKey,v.CustKey`;
export const COUNTRY_ORDER_HIDDEN_SQL = `SELECT COUNT_BIG(*) AS HiddenCount FROM OrderMaster om
 JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey AND od.isDeleted=0
 JOIN Product p ON p.ProdKey=od.ProdKey AND p.isDeleted=0
 WHERE om.isDeleted=0 AND om.OrderYear=@orderYear AND om.OrderWeek LIKE @majorWeek + N'-%'
 AND p.CounName=@counName
 AND NOT EXISTS (SELECT 1 FROM ViewOrder v WHERE v.OrderDetailKey=od.OrderDetailKey)`;
const error = (code, message, status = 409) => { throw new CountryOrderSourceError(code, message, status); };
const dateAdd = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export function countryOrderTodayKst(now) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function buildCountryOrderCycles(calendar, today) {
  if (!Array.isArray(calendar) || !calendar.length) error('ERP_CALENDAR_NOT_FOUND', '오늘에 해당하는 전산 달력이 없습니다.');
  const dates = new Set(), keys = new Set();
  const catalog = calendar.map(raw => {
    const key = String(raw.OrderYearWeek ?? ''), start = raw.BaseYmd instanceof Date ? raw.BaseYmd.toISOString().slice(0, 10) : String(raw.BaseYmd ?? '');
    if (!/^\d{4}(?:0[1-9]|[1-4]\d|5[0-3])$/.test(key) || Number(raw.WeekDay) !== 5 || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(Date.parse(start)) || dateAdd(start, 0) !== start || dates.has(start) || keys.has(key)) error('ERP_CALENDAR_GAP', '전산 달력 키·날짜 중복 또는 형식 오류를 확인하세요.');
    if (new Date(`${start}T00:00:00Z`).getUTCDay() !== 4) error('ERP_CALENDAR_GAP', '전산 차수 시작일이 목요일이 아닙니다. 달력을 확인하세요.');
    dates.add(start); keys.add(key);
    return { key: `${key.slice(0, 4)}/${key.slice(4)}`, year: Number(key.slice(0, 4)), majorWeek: key.slice(4), startDate: start, endDate: dateAdd(start, 6) };
  }).sort((a, b) => a.startDate < b.startDate ? -1 : 1);
  const current = catalog.findIndex(cycle => cycle.startDate <= today && today <= cycle.endDate);
  if (current < 0) error('ERP_CALENDAR_NOT_FOUND', '오늘에 해당하는 전산 달력이 없습니다.');
  const cycles = catalog.slice(current, current + 6);
  if (cycles.length !== 6 || cycles.some((cycle, i) => i > 0 && cycle.startDate !== dateAdd(cycles[i - 1].startDate, 7))) error('ERP_CALENDAR_GAP', '현재부터 다음 5개 전산 차수의 연속 달력이 필요합니다.');
  return cycles.map((cycle, offset) => ({ ...cycle, offset }));
}
export function normalizeCountryOrderQuery(query = {}) {
  if (Object.keys(query).some(key => !['country', 'year', 'majorWeek'].includes(key)) || Object.values(query).some(value => Array.isArray(value))) error('INVALID_QUERY', '국가·연도·대차수 조회 조건을 확인하세요.', 400);
  const has = name => Object.hasOwn(query, name);
  if (has('year') !== has('majorWeek') || (!has('country') && (has('year') || has('majorWeek')))) error('INVALID_QUERY', '국가와 연도·대차수를 함께 선택하세요.', 400);
  if (has('country') && !Object.hasOwn(COUNTRY_ORDER_COUNTRIES, query.country)) error('INVALID_COUNTRY', '지원하는 국가를 선택하세요.', 400);
  if (has('year') && (!/^\d{4}$/.test(String(query.year)) || !/^(?:[1-9]|0[1-9]|[1-4]\d|5[0-3])$/.test(String(query.majorWeek)))) error('INVALID_QUERY', '연도·대차수 형식을 확인하세요.', 400);
  return { country: query.country ?? null, year: has('year') ? Number(query.year) : null, majorWeek: has('majorWeek') ? String(query.majorWeek).padStart(2, '0') : null };
}
export function createCountryOrderSourceHandler({ queryFn, types, now = () => new Date() }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ success: false, error: '조회만 가능한 기능입니다.' }); }
    if (req.user?.accountActive === false) return res.status(403).json({ success: false, error: '비활성 계정은 조회할 수 없습니다.' });
    try {
      const request = normalizeCountryOrderQuery(req.query), current = now(), todayKst = countryOrderTodayKst(current);
      const calendar = await queryFn(COUNTRY_ORDER_CALENDAR_SQL, { today: { type: types.NVarChar(10), value: todayKst } });
      const cycles = buildCountryOrderCycles(calendar.recordset, todayKst);
      const body = { success: true, readOnly: true, todayKst, currentCycleKey: cycles[0].key, cycles, scope: null, subweeks: [], rows: [], warnings: [], queriedAt: current.toISOString() };
      if (!request.country) return res.status(200).json(body);
      const cycle = request.year == null ? cycles[0] : cycles.find(item => item.year === request.year && item.majorWeek === request.majorWeek);
      if (!cycle) error('SCOPE_OUTSIDE_SIX_CYCLES', '오늘부터 다음 5개 차수 안에서 선택하세요.', 400);
      body.scope = { country: request.country, counName: COUNTRY_ORDER_COUNTRIES[request.country], year: cycle.year, majorWeek: cycle.majorWeek, scopeKey: `${request.country}/${cycle.year}/${cycle.majorWeek}` };
      const params = { orderYear: { type: types.NVarChar(4), value: String(cycle.year) }, majorWeek: { type: types.NVarChar(2), value: cycle.majorWeek }, counName: { type: types.NVarChar(20), value: body.scope.counName } };
      const result = await queryFn(COUNTRY_ORDER_ROWS_SQL, params);
      if (!Array.isArray(result.recordset) || result.recordset.length > 100000) error('SOURCE_LIMIT_EXCEEDED', '조회 자료가 너무 많습니다. 전체 결과를 제공할 수 없습니다.');
      body.rows = result.recordset.map(raw => {
        if (Number(raw.OrderYear) !== cycle.year || raw.CounName !== body.scope.counName || !new RegExp(`^${cycle.majorWeek}-\\d+[^\\s]*$`, 'u').test(raw.OrderWeek)) error('INVALID_SUBWEEK', '응답 국가·연도·세부차수가 선택 범위와 다릅니다.');
        const row = { ...raw, OrderYear: Number(raw.OrderYear), CustOrderCode: String(raw.CustOrderCode ?? '').trim() };
        for (const field of ['OutQuantity', 'BoxQuantity', 'BunchQuantity', 'SteamQuantity', 'SourceRowCount']) {
          if (raw[field] == null) { row[field] = null; continue; }
          if (raw[field] === '' || typeof raw[field] === 'boolean' || !Number.isFinite(Number(raw[field]))) error('REQUIRED_QUANTITY_UNAVAILABLE', '저장 수량을 확인한 뒤 다시 조회하세요.');
          row[field] = Number(raw[field]);
        }
        return row;
      });
      body.subweeks = [...new Set(body.rows.map(row => row.OrderWeek))].sort(compareCountryOrderSubweeks).map(orderWeek => ({ key: `${cycle.year}/${orderWeek}`, orderWeek }));
      const hidden = await queryFn(COUNTRY_ORDER_HIDDEN_SQL, params), hiddenCount = Number(hidden.recordset?.[0]?.HiddenCount ?? 0);
      if (!Number.isFinite(hiddenCount) || hiddenCount < 0) error('INVALID_SOURCE_RESPONSE', '원천 주문 진단을 완료하지 못했습니다.');
      body.diagnostics = { sourceRowCount: body.rows.reduce((sum, row) => sum + (row.SourceRowCount ?? 0), 0), hiddenOrderCount: hiddenCount };
      if (hiddenCount) body.warnings.push(`HIDDEN_NATIVE_ORDERS: 전산 ViewOrder에 연결되지 않은 활성 주문 ${hiddenCount}행은 수량에서 제외했습니다. 관리자 확인이 필요합니다.`);
      return res.status(200).json(body);
    } catch (cause) {
      const known = cause instanceof CountryOrderSourceError;
      return res.status(known ? cause.statusCode : 500).json({ success: false, code: known ? cause.code : 'COUNTRY_ORDER_READ_FAILED', error: known ? cause.message : '전산 주문 조회에 실패했습니다. 잠시 후 다시 조회하세요.' });
    }
  };
}
