import { query, sql } from '../../../lib/db';
import { verifyReqUser } from '../../../lib/auth';
import { isAdminUser } from '../../../lib/userAccess';
import { buildExecutiveVolumeRows, findPreviousCycle, parseReportCycle, summarizeExecutiveVolume } from '../../../lib/executiveVolumeReport';
import { normalizeOrderUnit } from '../../../lib/orderUtils';

async function getCycles() {
  const result = await query(`
    SELECT DISTINCT OrderYear AS [year], OrderWeek AS [week]
    FROM (
      SELECT OrderYear, OrderWeek FROM ViewOrder
      UNION ALL SELECT OrderYear, OrderWeek FROM ViewWarehouse
      UNION ALL SELECT OrderYear, OrderWeek FROM ViewShipment
    ) cycles
    WHERE TRY_CONVERT(int, OrderYear) BETWEEN 2000 AND 2100
      AND OrderWeek LIKE '[0-9][0-9]-[0-9][0-9]'
    ORDER BY OrderYear, OrderWeek`);
  return result.recordset.map(row => parseReportCycle(row.year, row.week)).filter(Boolean);
}

async function readPeriod(year, week) {
  if (!year || !week) return { rows: [], available: false };
  const params = { year: { type: sql.NVarChar, value: String(year) }, week: { type: sql.NVarChar, value: week } };
  const [orderResult, inboundResult, outboundResult] = await Promise.all([
    query(`SELECT p.CounName AS country, p.FlowerName AS flower, p.OutUnit,
       SUM(CASE WHEN p.OutUnit IN (N'박스','BOX','Box') THEN ISNULL(vo.BoxQuantity,0)
                WHEN p.OutUnit IN (N'단','BUNCH','Bunch') THEN ISNULL(vo.BunchQuantity,0)
                WHEN p.OutUnit IN (N'송이','STEAM','STEM') THEN ISNULL(vo.SteamQuantity,0)
                ELSE ISNULL(vo.BoxQuantity,0) END) AS qty
      FROM ViewOrder vo JOIN Product p ON p.ProdKey=vo.ProdKey AND ISNULL(p.isDeleted,0)=0
      WHERE vo.OrderYear=@year AND vo.OrderWeek=@week
      GROUP BY p.CounName,p.FlowerName,p.OutUnit`, params),
    query(`SELECT p.CounName AS country, p.FlowerName AS flower, p.OutUnit,
       SUM(CASE WHEN p.OutUnit IN (N'박스','BOX','Box') THEN ISNULL(vw.BoxQuantity,0)
                WHEN p.OutUnit IN (N'단','BUNCH','Bunch') THEN ISNULL(vw.BunchQuantity,0)
                WHEN p.OutUnit IN (N'송이','STEAM','STEM') THEN ISNULL(vw.SteamQuantity,0)
                ELSE ISNULL(vw.BoxQuantity,0) END) AS qty
      FROM ViewWarehouse vw JOIN Product p ON p.ProdKey=vw.ProdKey
      WHERE vw.OrderYear=@year AND vw.OrderWeek=@week
      GROUP BY p.CounName,p.FlowerName,p.OutUnit`, params),
    query(`SELECT p.CounName AS country, p.FlowerName AS flower, p.OutUnit, SUM(ISNULL(vs.OutQuantity,0)) AS qty
      FROM ViewShipment vs JOIN Product p ON p.ProdKey=vs.ProdKey AND ISNULL(p.isDeleted,0)=0
      WHERE vs.OrderYear=@year AND vs.OrderWeek=@week
        AND ISNULL(vs.MasterFix,0)=1 AND ISNULL(vs.DetailFix,0)=1 AND ISNULL(vs.OutQuantity,0)<>0
      GROUP BY p.CounName,p.FlowerName,p.OutUnit`, params),
  ]);
  const normalize = rows => rows.map(row => ({ country: row.country, flower: row.flower, unit: normalizeOrderUnit(row.OutUnit), qty: Number(row.qty) || 0 }));
  const grouped = new Map();
  const add = (items, field) => items.forEach(item => {
    const key = [item.country || '미분류', item.flower || '미분류', item.unit].join('|');
    if (!grouped.has(key)) grouped.set(key, { country: item.country, flower: item.flower, unit: item.unit, ordered: 0, inbound: 0, outbound: 0 });
    grouped.get(key)[field] += item.qty;
  });
  add(normalize(orderResult.recordset), 'ordered');
  add(normalize(inboundResult.recordset), 'inbound');
  add(normalize(outboundResult.recordset), 'outbound');
  return { rows: [...grouped.values()], available: true };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET만 지원합니다.' });
  const user = verifyReqUser(req);
  if (!user) return res.status(401).json({ success: false, error: '로그인이 필요합니다.' });
  if (!isAdminUser(user)) return res.status(403).json({ success: false, error: '대표 보고서 조회 권한이 없습니다.' });
  try {
    const cycles = await getCycles();
    const selected = req.query.year || req.query.week
      ? parseReportCycle(req.query.year, req.query.week)
      : cycles.at(-1) || null;
    if (!selected) return res.status(400).json({ success: false, error: '연도와 세부차수를 확인해 주세요.' });
    if (!cycles.some(cycle => cycle.year === selected.year && cycle.week === selected.week)) {
      return res.status(404).json({ success: false, error: '선택한 차수의 데이터가 없습니다.' });
    }
    const previousCycle = findPreviousCycle(cycles, selected);
    const previousYearCycle = cycles.find(cycle => cycle.year === selected.year - 1 && cycle.week === selected.week) || null;
    const [current, previous, previousYear] = await Promise.all([
      readPeriod(selected.year, selected.week),
      previousCycle ? readPeriod(previousCycle.year, previousCycle.week) : Promise.resolve({ rows: [], available: false }),
      previousYearCycle ? readPeriod(previousYearCycle.year, previousYearCycle.week) : Promise.resolve({ rows: [], available: false }),
    ]);
    const rows = buildExecutiveVolumeRows({ orders: current.rows.map(row=>({...row,qty:row.ordered})), arrivals: current.rows.map(row=>({...row,qty:row.inbound})), shipments: current.rows.map(row=>({...row,qty:row.outbound})), previous, previousYear });
    return res.status(200).json({ success: true, readOnly: true, cycles, selected, previousCycle, previousYearCycle, rows, unitTotals: summarizeExecutiveVolume(rows), generatedAt: new Date().toISOString(), basis: { order: 'ViewOrder · Product.OutUnit 기준', inbound: 'ViewWarehouse · Product.OutUnit 기준', outbound: 'ViewShipment · ShipmentMaster.isFix=1 + ShipmentDetail.isFix=1' } });
  } catch (error) {
    console.error('[executive-volume] read failed', error?.message);
    return res.status(500).json({ success: false, error: '보고서 자료를 불러오지 못했습니다.' });
  }
}
