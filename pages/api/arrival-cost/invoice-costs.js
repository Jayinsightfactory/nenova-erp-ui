import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { readInvoiceCosts } from '../../../lib/invoiceReceiptCost';
import { PACKING_COUNTRIES } from '../../../lib/importPackingErpMatches';

function invalid(message) { throw Object.assign(new Error(message), { statusCode: 400 }); }
export function normalizeInvoiceArrivalFilters(input = {}) {
  const scalar = key => { if (Array.isArray(input[key])) invalid('중복 필터는 허용하지 않습니다.'); return String(input[key] ?? '').trim(); };
  const orderYear = scalar('orderYear');
  if (!/^\d{4}$/.test(orderYear)) invalid('조회 연도(YYYY)를 지정하세요.');
  let orderWeek = scalar('orderWeek');
  if (orderWeek) {
    const match = /^(\d{1,2})-(\d{1,2})$/.exec(orderWeek);
    if (!match || +match[1] < 1 || +match[1] > 53 || +match[2] < 1 || +match[2] > 99) invalid('차수는 01-01~53-99 범위입니다.');
    orderWeek = `${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  }
  const rawCountry = scalar('country');
  const country = rawCountry ? Object.keys(PACKING_COUNTRIES).find(code => code === rawCountry.toUpperCase() || PACKING_COUNTRIES[code] === rawCountry) : '';
  if (rawCountry && !country) invalid('지원 국가를 선택하세요.');
  const cursor = scalar('beforeWarehouseKey');
  if (cursor && (!/^\d+$/.test(cursor) || !Number.isSafeInteger(+cursor) || +cursor < 1 || +cursor > 2147483647)) invalid('입고번호 커서가 올바르지 않습니다.');
  const rawLimit = scalar('limit');
  if (rawLimit && (!/^\d+$/.test(rawLimit) || !Number.isSafeInteger(+rawLimit) || +rawLimit < 1)) invalid('조회 개수가 올바르지 않습니다.');
  return { orderYear, orderWeek, country: country || '', beforeWarehouseKey: cursor ? +cursor : null, limit: Math.min(20, rawLimit ? +rawLimit : 20) };
}

function projectRevision(revision, includeLines) {
  if (!revision) return null;
  const result = {};
  for (const key of ['formulaId', 'currency', 'totalCostKRW', 'approvedBy', 'approvedAt', 'status', 'revisionNo']) result[key] = revision[key] ?? null;
  if (includeLines) result.lines = (revision.lines || []).map(line => Object.fromEntries(
    ['unit', 'quantity', 'costPerUnitKRW', 'totalCostKRW', 'wdetailKey', 'prodKey', 'productName'].map(key => [key, line[key] ?? null])));
  return result;
}

export function createInvoiceArrivalCostHandler({ queryFn = query, types = sql, readCosts = readInvoiceCosts } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.user?.accountActive === false) return res.status(403).json({ success: false, error: '비활성 계정입니다.' });
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ success: false, error: '조회만 가능합니다.' }); }
    try {
      const filters = normalizeInvoiceArrivalFilters(req.query);
      const tables = await queryFn(`SELECT CASE WHEN OBJECT_ID(N'dbo.WebInvoiceOperation', N'U') IS NOT NULL
        AND OBJECT_ID(N'dbo.WebInvoiceDocument', N'U') IS NOT NULL
        AND OBJECT_ID(N'dbo.WebInvoiceCostRevision', N'U') IS NOT NULL
        AND OBJECT_ID(N'dbo.WebInvoiceCostLine', N'U') IS NOT NULL THEN 1 ELSE 0 END AS Available`);
      if (!tables.recordset?.[0]?.Available) return res.status(200).json({ success: true, available: false, message: '인보이스 원가 조회 저장소가 준비되지 않았습니다.', rows: [], filters, hasMore: false, nextCursor: null });
      const params = { orderYear: { type: types.Char(4), value: filters.orderYear } };
      const predicates = ['d.OrderYear=@orderYear'];
      if (filters.orderWeek) { params.orderWeek = { type: types.Char(5), value: filters.orderWeek }; predicates.push('d.OrderWeek=@orderWeek'); }
      if (filters.country) {
        params.country = { type: types.NVarChar(20), value: filters.country };
        params.countryName = { type: types.NVarChar(20), value: PACKING_COUNTRIES[filters.country] };
        predicates.push("JSON_VALUE(d.ReviewedMetadataJson,'$.country') IN (@country,@countryName)");
      }
      if (filters.beforeWarehouseKey !== null) { params.beforeWarehouseKey = { type: types.Int, value: filters.beforeWarehouseKey }; predicates.push('o.WarehouseKey<@beforeWarehouseKey'); }
      const candidates = await queryFn(`SELECT DISTINCT TOP (21) o.WarehouseKey
        FROM dbo.WebInvoiceOperation o JOIN dbo.WebInvoiceDocument d ON d.DocumentId=o.DocumentId
        WHERE o.Status=N'COMMITTED' AND ${predicates.join(' AND ')}
        AND EXISTS (SELECT 1 FROM dbo.WebInvoiceCostRevision r WHERE r.WarehouseKey=o.WarehouseKey AND r.Basis=N'ACTUAL')
        ORDER BY o.WarehouseKey DESC`, params);
      const keys = (candidates.recordset || []).slice(0, filters.limit);
      const rows = new Array(keys.length);
      let index = 0;
      async function worker() {
        while (index < keys.length) {
          const position = index++;
          const costs = await readCosts({ queryFn, types, warehouseKey: Number(keys[position].WarehouseKey) });
          const actual = costs.currentActual;
          const stale = !actual ? (costs.revisions || []).filter(r => r.basis === 'ACTUAL' && r.status === 'STALE').sort((a, b) => b.revisionNo - a.revisionNo)[0] : null;
          const identity = actual || stale || (costs.revisions || []).find(r => r.basis === 'ACTUAL');
          if (!identity || String(identity.orderYear) !== filters.orderYear || (filters.orderWeek && identity.orderWeek !== filters.orderWeek)) throw new Error('Invoice scope changed');
          rows[position] = { warehouseKey: costs.warehouseKey, documentId: costs.documentId, orderYear: identity.orderYear,
            orderWeek: identity.orderWeek, invoiceNo: identity.invoiceNo ?? null, status: costs.status,
            currentActual: projectRevision(actual, true), latestStale: projectRevision(stale, false) };
        }
      }
      await Promise.all([worker(), worker()]);
      const lines = rows.flatMap(row => row.currentActual?.lines || []);
      const productKeys = [...new Set(lines.filter(line => !String(line.productName ?? '').trim())
        .map(line => line.prodKey).filter(key => Number.isInteger(key) && key > 0 && key <= 2147483647))];
      if (productKeys.length) {
        // One round trip per page, with <=1000 keys in each JSON chunk and one SQL parameter.
        const chunks = [];
        for (let offset = 0; offset < productKeys.length; offset += 1000) chunks.push(productKeys.slice(offset, offset + 1000));
        const products = await queryFn(`/* invoice-arrival:product-names */ SELECT requested.ProdKey,
          COALESCE(NULLIF(LTRIM(RTRIM(p.DisplayName)),N''),NULLIF(LTRIM(RTRIM(p.ProdName)),N'')) AS ProductName
          FROM (SELECT DISTINCT CONVERT(int, item.value) AS ProdKey
            FROM OPENJSON(@productKeyChunks) chunk CROSS APPLY OPENJSON(chunk.value) item) requested
          LEFT JOIN dbo.Product p ON p.ProdKey=requested.ProdKey`, {
          productKeyChunks: { type: types.NVarChar(types.MAX), value: JSON.stringify(chunks) },
        });
        const names = new Map((products.recordset || []).map(product => [Number(product.ProdKey), product.ProductName ?? null]));
        for (const line of lines) if (!String(line.productName ?? '').trim()) line.productName = names.get(line.prodKey) ?? null;
      }
      const hasMore = (candidates.recordset || []).length > filters.limit;
      return res.status(200).json({ success: true, available: true, rows, filters, hasMore, nextCursor: hasMore ? rows.at(-1).warehouseKey : null });
    } catch (error) {
      return res.status(error.statusCode === 400 ? 400 : 503).json({ success: false, error: error.statusCode === 400 ? error.message : '인보이스 입고 원가 조회에 실패했습니다. 다시 조회하세요.' });
    }
  };
}

export default withAuth(createInvoiceArrivalCostHandler());
