export function normalizeWarehouseBrowse(input = {}) {
  const orderYear = typeof input.orderYear === 'string' ? input.orderYear.trim() : '';
  const match = typeof input.orderWeek === 'string' && /^(\d{1,2})-(\d{1,2})$/.exec(input.orderWeek.trim());
  if (!/^20\d{2}$/.test(orderYear) || !match || +match[1] < 1 || +match[1] > 53 || +match[2] < 1 || +match[2] > 99) {
    throw Object.assign(new Error('조회 연도와 세부차수를 확인하세요. 예: 2026 / 44-01'), { statusCode: 400 });
  }
  return { orderYear, orderWeek: `${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}` };
}

export async function listCostWarehouse({ queryFn, types, input }) {
  const scope = normalizeWarehouseBrowse(input);
  const result = await queryFn(`/* invoice-cost:warehouse-browse */
    SELECT TOP (501) WarehouseKey,OrderYear,OrderWeek,FarmName,InvoiceNo,
      GrossWeight,ChargeableWeight,CONVERT(varchar(10),InputDate,23) AS InputDate
    FROM dbo.WarehouseMaster
    WHERE OrderYear=@orderYear AND OrderWeek=@orderWeek AND ISNULL(isDeleted,0)=0
    ORDER BY WarehouseKey DESC`, {
    orderYear: { type: types.NVarChar(4), value: scope.orderYear },
    orderWeek: { type: types.NVarChar(5), value: scope.orderWeek },
  });
  const rows = result.recordset || [];
  return { scope, rows: rows.slice(0, 500), hasMore: rows.length > 500 };
}
