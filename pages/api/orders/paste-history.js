import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { normalizeOrderHistorySearch } from '../../../lib/orderHistorySearch';
import { parsePasteOperation, matchesPasteOperation } from '../../../lib/pasteOperationHistory';

export default withAuth(async function handler(req, res) {
  res.setHeader?.('Cache-Control', 'private, no-store, max-age=0');
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET only' });
  try {
    const scope = normalizeOrderHistorySearch(req.query);
    const who = req.query.who ?? 'mine';
    if (!['mine', 'all'].includes(who)) throw Object.assign(new Error('담당자 검색 범위를 확인하세요.'), { statusCode: 400 });
    const cursor = req.query.cursor === undefined ? 2147483647 : Number(req.query.cursor);
    if (!Number.isInteger(cursor) || cursor <= 0 || cursor > 2147483647) throw Object.assign(new Error('조회 위치가 올바르지 않습니다.'), { statusCode: 400 });
    const params = { cursor: { type: sql.Int, value: cursor }, actor: { type: sql.NVarChar, value: req.user?.userId || '' }, actorName: { type: sql.NVarChar, value: req.user?.userName || req.user?.userId || '' } };
    const found = await query(`SELECT TOP 201 LogKey, CONVERT(NVARCHAR(19), ActionDtm, 120) AS ActionDtm,
      Actor, ActionType, Payload, Result, ResultDesc
      FROM SystemActionLog WHERE ActionType IN ('SHIPMENT_ADJUST_BATCH','SHIPMENT_ADJUST_BATCH_UNDO')
      AND LogKey < @cursor ${who === 'mine' ? 'AND (Actor=@actor OR Actor=@actorName)' : ''}
      ORDER BY LogKey DESC`, params);
    const scanned = (found.recordset || []).slice(0, 200);
    const parsed = scanned.map(parsePasteOperation).filter(Boolean);
    const operations = parsed.filter(operation => operation.status !== 'preview' && matchesPasteOperation(operation, { ...scope, custName: '', prodName: '' }));
    const hydrate = async (field, table, key, columns) => {
      const ids = [...new Set(operations.flatMap(op => op.entries.map(entry => entry[field])).filter(id => Number.isInteger(id) && id > 0))];
      const map = new Map();
      for (let offset = 0; offset < ids.length; offset += 500) {
        const chunk = ids.slice(offset, offset + 500);
        const bindings = Object.fromEntries(chunk.map((id, index) => [`id${index}`, { type: sql.Int, value: id }]));
        const result = await query(`SELECT ${key}, ${columns} FROM ${table} WHERE ${key} IN (${chunk.map((_, index) => '@id' + index).join(',')})`, bindings);
        (result.recordset || []).forEach(row => map.set(Number(row[key]), row));
      }
      return map;
    };
    const customers = await hydrate('custKey', 'Customer', 'CustKey', 'CustName');
    const products = await hydrate('prodKey', 'Product', 'ProdKey', 'ProdName, FlowerName, CounName');
    operations.forEach(op => op.entries.forEach(entry => {
      const product = products.get(entry.prodKey);
      entry.custName ||= customers.get(entry.custKey)?.CustName || `업체 #${entry.custKey ?? '?'}`;
      entry.prodName ||= product?.ProdName || `품목 #${entry.prodKey ?? '?'}`;
      entry.flowerName = product?.FlowerName || ''; entry.counName = product?.CounName || '';
    }));
    return res.json({ success: true, operations: operations.filter(op => op.status !== 'preview' && matchesPasteOperation(op, scope)),
      hasMore: (found.recordset || []).length > 200, nextCursor: scanned.at(-1)?.LogKey || null,
      scannedCount: scanned.length, excludedScopeCount: scanned.length - parsed.length,
      notice: '요청 1회가 작업 1건입니다. 최대 200개 기록씩 검색합니다. 과거 잘린 상세와 연도 미확인 기록은 완전 복원할 수 없으며, 사전검증은 제외합니다.' });
  } catch (error) { return res.status(error.statusCode || 500).json({ success: false, error: error.message }); }
});
