import { query, sql, withTransaction } from '../db.js';
import { defectCostScope, defectRecentCostSql, costLookupKeyword, costProductMatchesSearch } from '../defectCostCandidates.js';
import { ensureSalesDefectTables } from '../salesDefectDeductions.js';
import { text, loadLookupData } from './lookupAndMatching.js';

export const DEFAULT_MANAGER_OPTIONS = ['김원영', '박성수', '정재훈', '조현욱'];

export function normalizeManagerName(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '').trim();
}

export function managerPriority(item) {
  const defaultIndex = DEFAULT_MANAGER_OPTIONS.indexOf(item.managerName);
  return [
    defaultIndex < 0 ? 100 : defaultIndex,
    item.managerKey == null ? 1 : 0,
    Number(item.managerKey || Number.MAX_SAFE_INTEGER),
    String(item.managerId || ''),
  ];
}

export function compareManagerPriority(a, b) {
  const ap = managerPriority(a);
  const bp = managerPriority(b);
  for (let i = 0; i < ap.length; i += 1) {
    if (ap[i] < bp[i]) return -1;
    if (ap[i] > bp[i]) return 1;
  }
  return 0;
}

export async function loadManagerOptions() {
  const [configured, used] = await Promise.all([
    query(
      `SELECT ManagerKey, ManagerId, ManagerName, SortOrder
         FROM WebSalesDefectManager
        WHERE IsDeleted=0
        ORDER BY SortOrder, ManagerName, ManagerId`,
      {},
    ),
    query(
      `SELECT DISTINCT
              COALESCE(NULLIF(CreatedBy,N''), NULLIF(UpdatedBy,N''), N'') AS ManagerId,
              COALESCE(NULLIF(CreatedByName,N''), NULLIF(UpdatedByName,N''),
                       COALESCE(NULLIF(CreatedBy,N''), NULLIF(UpdatedBy,N''), N'')) AS ManagerName
         FROM WebSalesDefectDeduction
        WHERE IsDeleted=0
          AND COALESCE(NULLIF(CreatedBy,N''), NULLIF(UpdatedBy,N''), N'')<>N''`,
      {},
    ),
  ]);
  const candidates = [];
  for (const row of configured.recordset || []) {
    const managerId = String(row.ManagerId || row.ManagerName || '').trim();
    if (!managerId) continue;
    candidates.push({
      managerKey: Number(row.ManagerKey),
      managerId,
      managerName: String(row.ManagerName || managerId),
    });
  }
  for (const row of used.recordset || []) {
    const managerId = String(row.ManagerId || row.ManagerName || '').trim();
    if (!managerId || candidates.some((item) => item.managerId === managerId)) continue;
    candidates.push({
      managerKey: null,
      managerId,
      managerName: String(row.ManagerName || managerId),
    });
  }
  const byName = new Map();
  for (const item of candidates) {
    const key = normalizeManagerName(item.managerName || item.managerId);
    if (!key) continue;
    const current = byName.get(key);
    if (!current || compareManagerPriority(item, current) < 0) byName.set(key, item);
  }
  return [...byName.values()].sort((a, b) => compareManagerPriority(a, b)
    || a.managerName.localeCompare(b.managerName, 'ko')
    || a.managerId.localeCompare(b.managerId));
}

export async function saveManagerOption({ managerId = '', managerName = '', user } = {}) {
  await ensureSalesDefectTables();
  const id = text(managerId, 100) || text(managerName, 100);
  const name = text(managerName, 100) || id;
  if (!id || !name) throw new Error('담당자 이름을 입력하세요.');
  await withTransaction(async (tQuery) => {
    const existing = await tQuery(
      `SELECT TOP 1 ManagerKey, ManagerId, ManagerName
         FROM WebSalesDefectManager
        WHERE IsDeleted=0
          AND (ManagerId=@id OR LOWER(REPLACE(ManagerName,N' ',N''))=LOWER(REPLACE(@name,N' ',N'')))
        ORDER BY CASE WHEN ManagerId=@id THEN 0 ELSE 1 END, ManagerKey`,
      {
        id: { type: sql.NVarChar, value: id },
        name: { type: sql.NVarChar, value: name },
      },
    );
    if (existing.recordset[0]?.ManagerKey) {
      await tQuery(
        `UPDATE WebSalesDefectManager
            SET ManagerName=@name, UpdatedBy=@by, UpdatedAt=GETDATE()
          WHERE ManagerKey=@key`,
        {
          name: { type: sql.NVarChar, value: name },
          by: { type: sql.NVarChar, value: text(user?.userId || user?.userName, 100) },
          key: { type: sql.Int, value: Number(existing.recordset[0].ManagerKey) },
        },
      );
      return;
    }
    await tQuery(
      `INSERT INTO WebSalesDefectManager
         (ManagerId, ManagerName, SortOrder, CreatedBy, UpdatedBy)
       VALUES (@id, @name, 100, @by, @by)`,
      {
        id: { type: sql.NVarChar, value: id },
        name: { type: sql.NVarChar, value: name },
        by: { type: sql.NVarChar, value: text(user?.userId || user?.userName, 100) },
      },
    );
  });
  return loadManagerOptions();
}

export async function loadDefectCostCandidates({ year, week, custKey, prodKey, search = '' }, q = query, lookup = loadLookupData) {
  const scope = defectCostScope(year, week);
  if (![custKey, prodKey].every(v => Number.isInteger(Number(v)) && Number(v) > 0)) throw new Error('업체·품목을 먼저 선택하세요.');
  const exact = await q('SELECT ProdKey, ProdName, DisplayName, CounName, FlowerName, EstUnit, OutUnit FROM Product WHERE ProdKey=@pk AND ISNULL(isDeleted,0)=0', { pk: { type: sql.Int, value: Number(prodKey) } });
  const current = exact.recordset[0];
  if (!current) throw new Error('현재 연결 품목을 찾을 수 없습니다. 품목 매칭을 확인하세요.');
  const keyword = String(search || costLookupKeyword(current.ProdName)).trim().slice(0, 100);
  const found = keyword ? (await lookup({ kind: 'product', q: keyword })).products || [] : [];
  const products = [...new Map([...found.filter(p => costProductMatchesSearch(p, keyword) && (search || !current.CounName || p.CounName === current.CounName)), current].map(p => [Number(p.ProdKey), p])).values()].sort((a, b) => Number(b.ProdKey === current.ProdKey) - Number(a.ProdKey === current.ProdKey)).slice(0, 16);
  const output = [];
  for (const product of products) {
    const result = await q(defectRecentCostSql(5), {
      pk: { type: sql.Int, value: Number(product.ProdKey) }, ck: { type: sql.Int, value: Number(custKey) },
      scopeYear: { type: sql.Int, value: scope.year }, minWeek: { type: sql.Int, value: scope.minWeek }, scopeWeek: { type: sql.Int, value: scope.maxWeek },
    });
    if (Number(product.ProdKey) === Number(prodKey) || result.recordset.length) output.push({
      prodKey: Number(product.ProdKey), productName: product.ProdName, country: product.CounName || '',
      unit: product.EstUnit || product.OutUnit || '', current: Number(product.ProdKey) === Number(prodKey),
      costs: result.recordset.map(r => ({ cost: Number(r.Cost), customerName: r.SourceCustName || '', custKey: Number(r.SourceCustKey),
        year: Number(r.SourceOrderYear), week: r.SourceOrderWeek, shipmentKey: Number(r.SourceShipmentKey) })),
    });
  }
  return { scope, keyword, products: output };
}
