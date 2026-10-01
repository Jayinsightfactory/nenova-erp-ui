import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { isAdminUser } from '../../../lib/userAccess.js';
import { resolveWarehouseProducts, validateWarehouseUploadInput, warehouseCatalogSql, warehouseFixedCategories, warehouseDuplicateUploads, WAREHOUSE_STAGE_GUARD_SQL } from '../../../lib/warehouseProductMatching.js';

export default withAuth(async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).end();
  if (!isAdminUser(req.user) && !/수입/.test(String(req.user?.deptName ?? req.user?.DeptName ?? ''))) return res.status(403).json({ success: false, error: '입고 검증은 관리자 또는 수입부 계정만 가능합니다.' });
  const body = req.body || {};
  const errors = validateWarehouseUploadInput(body);
  const products = (await query(warehouseCatalogSql(), {})).recordset;
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 2000 || body.items.some(item => !item || typeof item !== 'object')) return res.status(400).json({ success: false, valid: false, errors, products, error: '업로드 데이터 형식을 확인하세요.' });
  const result = await resolveWarehouseProducts(query, sql, body.items);
  if (!errors.length && result.valid) {
    const duplicates = await warehouseDuplicateUploads(query, sql, body);
    if (duplicates.length) errors.push({ error: `같은 파일의 활성 입고 원장(${duplicates.map(row => row.WarehouseKey).join(', ')})이 있습니다. 중복 등록하지 않습니다. 기존 원장을 확인하세요.` });
    try { await query(WAREHOUSE_STAGE_GUARD_SQL.replace('WITH (TABLOCKX, HOLDLOCK)', ''), {}); }
    catch (error) { if (error.number !== 51003) throw error; errors.push({ error: error.message }); }
    const fixed = await warehouseFixedCategories(query, sql, body.orderYear, body.orderWeek, result.items.map(item => item.countryFlower), { neighbors: true });
    if (fixed.length) errors.push({ error: `EXE 확정 순서 확인이 필요합니다: ${fixed.map(row => `${row.OrderYear}/${row.OrderWeek} ${row.CountryFlower} ${row.Reason}`).join(', ')}. 확정 상태 정리 후 재검증하세요.` });
  }
  return res.status(200).json({ success: true, valid: !errors.length && result.valid, rows: result.rows, errors: [...errors, ...result.errors], products });
});
