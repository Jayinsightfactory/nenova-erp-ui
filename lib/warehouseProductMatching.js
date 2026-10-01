// Exact native usp_CreateWarehouse eligibility. UI, preflight and final transaction share this SQL.
export const WAREHOUSE_PRODUCT_NAME_SQL = "LOWER(REPLACE(LTRIM(RTRIM(ProdName)),NCHAR(160),N' '))";
export const WAREHOUSE_NUMERIC_FIELDS = ['boxQty', 'bunchQty', 'steamQty', 'steamOf1Box', 'steamOf1Bunch', 'unitPrice', 'totalPrice'];

export function warehouseCatalogSql(lock = false) {
  return `SELECT ProdKey, ProdName, CountryFlower, CounName, FlowerName, OutUnit, EstUnit,
    ${WAREHOUSE_PRODUCT_NAME_SQL} AS NormalName,
    COUNT(*) OVER (PARTITION BY ${WAREHOUSE_PRODUCT_NAME_SQL}) AS NameCount
    FROM Product ${lock ? 'WITH (HOLDLOCK)' : ''} WHERE isDeleted=0`;
}

export function validateWarehouseUploadInput(body = {}) {
  const errors = [];
  const add = (error, index = null, item = null) => errors.push({ index, row: item?.sourceRow ?? (index == null ? null : index + 6), error });
  if (!/^\d{4}$/.test(String(body.orderYear ?? '')) || Number(body.orderYear) <= 2025 || !/^\d{2}-\d{2}$/.test(String(body.orderWeek ?? ''))) add('2026년 이후의 명시 연도와 세부차수(예: 40-01)가 필요합니다.');
  const dt = String(body.inputDate ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dt) || !Number.isFinite(Date.parse(`${dt}T00:00:00Z`)) || new Date(`${dt}T00:00:00Z`).toISOString().slice(0, 10) !== dt) add('유효한 실제 입고·신고일자를 입력하세요.');
  for (const [field, max, label] of [['farmName',100,'농장명'],['fileName',500,'파일명'],['invoiceNo',50,'인보이스'],['awb',50,'AWB']]) {
    const value = String(body[field] ?? '');
    if ((['farmName','fileName'].includes(field) && !value.trim()) || value.length > max) add(`${label}을 확인하세요. (최대 ${max}자)`);
  }
  for (const field of ['gw','cw','rate','docFee']) if (body[field] != null && body[field] !== '' && (!Number.isFinite(Number(body[field])) || Number(body[field]) < 0)) add(`${field} 값은 0 이상의 숫자여야 합니다.`);
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 2000) {
    add('업로드 품목은 1~2,000행이어야 합니다.');
    return errors;
  }
  body.items.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { add('품목 행 형식이 올바르지 않습니다.', index); return; }
    if (!String(item.prodName ?? '').trim() || String(item.prodName).length > 250) add('원본 품목명은 1~250자여야 합니다.', index, item);
    if (String(item.orderCode ?? '').length > 20) add('주문코드는 최대 20자입니다.', index, item);
    if (item.selectedProdKey != null && (!Number.isInteger(Number(item.selectedProdKey)) || Number(item.selectedProdKey) <= 0)) add('다시 선택한 품목 키가 올바르지 않습니다.', index, item);
    for (const field of WAREHOUSE_NUMERIC_FIELDS) {
      if (item[field] != null && item[field] !== '' && (!Number.isFinite(Number(item[field])) || Number(item[field]) < 0)) add(`${field} 값은 0 이상의 숫자여야 합니다.`, index, item);
    }
  });
  return errors;
}

export function buildWarehouseMatchResult(items, matches) {
  const byIndex = new Map();
  for (const match of matches) {
    const index = Number(match.RowIndex);
    if (!byIndex.has(index)) byIndex.set(index, []);
    byIndex.get(index).push(match);
  }
  const rows = items.map((item, index) => {
    const candidates = byIndex.get(index) || [];
    const p = candidates[0];
    const manual = item.selectedProdKey != null;
    let error = '';
    if (!candidates.length) error = manual ? '선택 품목이 삭제되었거나 존재하지 않습니다. 다시 선택하세요.' : '전산에 정확히 일치하는 품목이 없습니다. 품목을 선택하세요.';
    else if (candidates.length !== 1 || Number(p.NameCount) !== 1) error = '활성 전산 품목명이 중복되어 EXE 저장 품목을 확정할 수 없습니다. 중복되지 않은 품목을 선택하거나 품목 마스터를 확인하세요.';
    return { index, sourceRow: item.sourceRow ?? index + 6, originalName: item.prodName,
      prodKey: error ? null : p.ProdKey, prodName: error ? '' : p.ProdName,
      countryFlower: error ? '' : p.CountryFlower, outUnit: error ? '' : p.OutUnit,
      estUnit: error ? '' : p.EstUnit, status: error ? 'error' : manual ? 'manual' : 'exact', error };
  });
  const errors = rows.filter(row => row.error).map(row => ({ index: row.index, row: row.sourceRow, prodName: row.originalName, error: row.error }));
  return { valid: errors.length === 0, rows, errors,
    items: errors.length ? [] : rows.map((row, index) => ({ ...items[index], originalName: items[index].prodName,
      prodName: row.prodName, prodKey: row.prodKey, countryFlower: row.countryFlower, outUnit: row.outUnit, estUnit: row.estUnit })) };
}

export async function resolveWarehouseProducts(db, sql, items, { lock = false } = {}) {
  const names = items.map((item, index) => ({ index, name: String(item.prodName ?? ''), key: item.selectedProdKey == null ? null : Number(item.selectedProdKey) }));
  const result = await db(`WITH Catalog AS (${warehouseCatalogSql(lock)})
    SELECT r.RowIndex, p.* FROM OPENJSON(@rows) WITH (RowIndex int '$.index', OriginalName nvarchar(250) '$.name', SelectedKey int '$.key') r
    JOIN Catalog p ON (r.SelectedKey IS NOT NULL AND p.ProdKey=r.SelectedKey)
      OR (r.SelectedKey IS NULL AND p.NormalName=LOWER(REPLACE(LTRIM(RTRIM(r.OriginalName)),NCHAR(160),N' ')))`,
    { rows: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(names) } });
  return buildWarehouseMatchResult(items, result.recordset);
}

export function warehouseExpectedQuantity(item, unit) {
  // SQL character comparison ignores trailing ordinary spaces, but not leading spaces.
  const nativeUnit = String(unit ?? '').replace(/ +$/, '');
  return Number((nativeUnit === '박스' ? item.boxQty : nativeUnit === '단' ? item.bunchQty : item.steamQty) || 0);
}

export async function warehouseDuplicateUploads(db, sql, body, lock = false) {
  return (await db(`SELECT WarehouseKey FROM WarehouseMaster ${lock ? 'WITH (UPDLOCK,HOLDLOCK)' : ''}
    WHERE OrderYear=@year AND OrderWeek=@week AND FarmName=@farm AND FileName=@fn
      AND ISNULL(InvoiceNo,N'')=@inv AND ISNULL(OrderNo,N'')=@awb AND isDeleted=0`, {
    year: { type: sql.NVarChar, value: String(body.orderYear) }, week: { type: sql.NVarChar, value: String(body.orderWeek) },
    farm: { type: sql.NVarChar, value: body.farmName }, fn: { type: sql.NVarChar, value: body.fileName },
    inv: { type: sql.NVarChar, value: body.invoiceNo || '' }, awb: { type: sql.NVarChar, value: body.awb || '' },
  })).recordset;
}

export async function warehouseFixedCategories(db, sql, orderYear, orderWeek, categories = null, { lock = false, neighbors = false } = {}) {
  // CommonLogic.CheckFixSave: current fixed, prior unfinished, next fixed (StockMaster adjacency).
  const hint = lock ? ' WITH (HOLDLOCK)' : '';
  return (await db(`WITH Bounds AS (
    SELECT (SELECT TOP 1 OrderYearWeek FROM StockMaster${hint} WHERE OrderYearWeek<@year+REPLACE(@week,'-','') ORDER BY OrderYearWeek DESC,OrderWeek DESC) AS Prev,
           (SELECT TOP 1 OrderYearWeek FROM StockMaster${hint} WHERE OrderYearWeek>@year+REPLACE(@week,'-','') ORDER BY OrderYearWeek,OrderWeek) AS Next
  ), Scopes AS (
    SELECT @year AS OrderYear,@week AS OrderWeek,1 AS IsFix,N'현재 차수 확정' AS Reason
    UNION ALL SELECT LEFT(Prev,4),SUBSTRING(Prev,5,2)+'-'+SUBSTRING(Prev,7,2),0,N'이전 차수 미확정' FROM Bounds WHERE @neighbors=1 AND Prev IS NOT NULL
    UNION ALL SELECT LEFT(Next,4),SUBSTRING(Next,5,2)+'-'+SUBSTRING(Next,7,2),1,N'다음 차수 확정' FROM Bounds WHERE @neighbors=1 AND Next IS NOT NULL
  ) SELECT DISTINCT vs.CountryFlower,s.Reason,s.OrderYear,s.OrderWeek FROM ViewShipment vs${hint}
    JOIN Scopes s ON vs.OrderYear=s.OrderYear AND vs.OrderWeek=s.OrderWeek AND ISNULL(vs.DetailFix,0)=s.IsFix
    WHERE (@allCategories=1 OR vs.CountryFlower IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@categories,N'|')))`, {
    year: { type: sql.NVarChar, value: String(orderYear) }, week: { type: sql.NVarChar, value: String(orderWeek) },
    allCategories: { type: sql.Bit, value: categories == null ? 1 : 0 },
    neighbors: { type: sql.Bit, value: neighbors ? 1 : 0 },
    categories: { type: sql.NVarChar, value: [...new Set(categories || [])].join('|') },
  })).recordset;
}

// Native EXE leaves completed staging rows behind. A pending EXE file must never be discarded.
// Compare complete row multisets, including duplicates and native derived quantities.
export const WAREHOUSE_STAGE_GUARD_SQL = `
  SELECT COUNT_BIG(*) AS stageCount FROM TempWarehouseDetail WITH (TABLOCKX, HOLDLOCK);
  IF EXISTS (
    SELECT WarehouseKey, ProdKey, BoxQuantity, BunchQuantity, SteamQuantity,
      OutQuantity, EstQuantity, SteamOf1Box, SteamOf1Bunch, UPrice, TPrice, OrderCode, COUNT_BIG(*) AS n
    FROM TempWarehouseDetail GROUP BY WarehouseKey, ProdKey, BoxQuantity, BunchQuantity, SteamQuantity,
      OutQuantity, EstQuantity, SteamOf1Box, SteamOf1Bunch, UPrice, TPrice, OrderCode
    EXCEPT
    SELECT wd.WarehouseKey, wd.ProdKey, wd.BoxQuantity, wd.BunchQuantity, wd.SteamQuantity,
      wd.OutQuantity, wd.EstQuantity, wd.SteamOf1Box, wd.SteamOf1Bunch, wd.UPrice, wd.TPrice, wd.OrderCode, COUNT_BIG(*)
    FROM WarehouseDetail wd
    WHERE wd.WarehouseKey IN (SELECT WarehouseKey FROM TempWarehouseDetail)
    GROUP BY wd.WarehouseKey, wd.ProdKey, wd.BoxQuantity, wd.BunchQuantity, wd.SteamQuantity,
      wd.OutQuantity, wd.EstQuantity, wd.SteamOf1Box, wd.SteamOf1Bunch, wd.UPrice, wd.TPrice, wd.OrderCode
  ) THROW 51003, N'EXE에서 처리 중이거나 확인이 필요한 입고 임시자료가 있습니다. EXE 업로드를 완료한 후 다시 검증하세요. 기존 자료는 삭제하지 않았습니다.', 1;`;
