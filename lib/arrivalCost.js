// 도착원가 전용 웹 원장.
// Product/Warehouse/Shipment/Estimate/Stock 원장은 읽기만 하고 절대 갱신하지 않는다.

import { query, withTransaction, sql } from './db.js';
import { calculateArrivalCost } from './arrivalCostExcel.js';

let ensurePromise = null;

export const ARRIVAL_BASIS = {
  SOURCE: 'SOURCE',
  WEIGHT: 'WEIGHT',
  VOLUME: 'VOLUME',
  VALUE: 'VALUE',
  EQUAL: 'EQUAL',
};

export async function ensureArrivalCostTables() {
  if (ensurePromise) return ensurePromise;
  ensurePromise = query(`
    IF OBJECT_ID(N'dbo.WebArrivalCostImport', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.WebArrivalCostImport (
        ImportKey INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        OrderYear NVARCHAR(4) NOT NULL,
        UploadFileName NVARCHAR(260) NOT NULL DEFAULT N'',
        RevisionNo INT NOT NULL DEFAULT 1,
        ScopeJson NVARCHAR(MAX) NULL,
        UploadedBy NVARCHAR(100) NOT NULL DEFAULT N'',
        UploadedByName NVARCHAR(100) NOT NULL DEFAULT N'',
        UploadedAt DATETIME NOT NULL DEFAULT GETDATE(),
        IsDeleted BIT NOT NULL DEFAULT 0
      );
      CREATE INDEX IX_WebArrivalCostImport_Year ON dbo.WebArrivalCostImport(OrderYear, UploadedAt DESC);
    END;
    IF OBJECT_ID(N'dbo.WebArrivalCostLine', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.WebArrivalCostLine (
        ArrivalLineKey INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ImportKey INT NOT NULL,
        OrderYear NVARCHAR(4) NOT NULL,
        OrderWeek NVARCHAR(10) NOT NULL DEFAULT N'',
        CountryName NVARCHAR(100) NOT NULL DEFAULT N'',
        FlowerNameRaw NVARCHAR(200) NOT NULL DEFAULT N'',
        ProductNameRaw NVARCHAR(300) NOT NULL DEFAULT N'',
        FarmNameRaw NVARCHAR(200) NOT NULL DEFAULT N'',
        ProdKey INT NULL,
        FarmKey INT NULL,
        Unit NVARCHAR(40) NOT NULL DEFAULT N'',
        Quantity DECIMAL(18,4) NOT NULL DEFAULT 0,
        FobUSD DECIMAL(18,6) NULL,
        FreightPerUnitUSD DECIMAL(18,6) NULL,
        CustomsPerUnitKRW DECIMAL(18,4) NULL,
        OtherPerUnitKRW DECIMAL(18,4) NULL,
        SourceArrivalCostKRW DECIMAL(18,4) NULL,
        SourceArrivalCostVatKRW DECIMAL(18,4) NULL,
        SelectedArrivalCostKRW DECIMAL(18,4) NULL,
        ExchangeRate DECIMAL(18,6) NULL,
        GrossWeight DECIMAL(18,4) NULL,
        ChargeableWeight DECIMAL(18,4) NULL,
        FreightUSD DECIMAL(18,6) NULL,
        InvoiceUSD DECIMAL(18,6) NULL,
        WeightMetricShare DECIMAL(18,8) NULL,
        VolumeMetricShare DECIMAL(18,8) NULL,
        ValueMetricShare DECIMAL(18,8) NULL,
        AllocationBasis NVARCHAR(20) NOT NULL DEFAULT N'SOURCE',
        MatchStatus NVARCHAR(30) NOT NULL DEFAULT N'PRODUCT_REQUIRED',
        SourceFileName NVARCHAR(260) NOT NULL DEFAULT N'',
        SheetName NVARCHAR(120) NOT NULL DEFAULT N'',
        SourceRow INT NULL,
        RawJson NVARCHAR(MAX) NULL,
        Notes NVARCHAR(1000) NOT NULL DEFAULT N'',
        IsCurrent BIT NOT NULL DEFAULT 1,
        CreatedBy NVARCHAR(100) NOT NULL DEFAULT N'',
        CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedBy NVARCHAR(100) NOT NULL DEFAULT N'',
        UpdatedAt DATETIME NOT NULL DEFAULT GETDATE()
      );
      CREATE INDEX IX_WebArrivalCostLine_Current ON dbo.WebArrivalCostLine(OrderYear, OrderWeek, CountryName, IsCurrent);
      CREATE INDEX IX_WebArrivalCostLine_Product ON dbo.WebArrivalCostLine(ProdKey, FarmKey, IsCurrent);
    END;
    IF COL_LENGTH(N'dbo.WebArrivalCostLine', N'WeightMetricShare') IS NULL
      ALTER TABLE dbo.WebArrivalCostLine ADD WeightMetricShare DECIMAL(18,8) NULL;
    IF COL_LENGTH(N'dbo.WebArrivalCostLine', N'VolumeMetricShare') IS NULL
      ALTER TABLE dbo.WebArrivalCostLine ADD VolumeMetricShare DECIMAL(18,8) NULL;
    IF COL_LENGTH(N'dbo.WebArrivalCostLine', N'ValueMetricShare') IS NULL
      ALTER TABLE dbo.WebArrivalCostLine ADD ValueMetricShare DECIMAL(18,8) NULL;
    IF OBJECT_ID(N'dbo.WebArrivalCostHistory', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.WebArrivalCostHistory (
        HistoryKey BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ArrivalLineKey INT NULL,
        ImportKey INT NULL,
        ActionType NVARCHAR(30) NOT NULL,
        BeforeJson NVARCHAR(MAX) NULL,
        AfterJson NVARCHAR(MAX) NULL,
        ChangedBy NVARCHAR(100) NOT NULL DEFAULT N'',
        ChangedByName NVARCHAR(100) NOT NULL DEFAULT N'',
        ChangedAt DATETIME NOT NULL DEFAULT GETDATE()
      );
      CREATE INDEX IX_WebArrivalCostHistory_Line ON dbo.WebArrivalCostHistory(ArrivalLineKey, ChangedAt DESC);
    END;
  `).catch((error) => {
    ensurePromise = null;
    throw error;
  });
  return ensurePromise;
}

function actor(user) {
  return {
    id: String(user?.userId || user?.userName || 'unknown').slice(0, 100),
    name: String(user?.userName || user?.userId || 'unknown').slice(0, 100),
  };
}

function n(value, fallback = null) {
  const v = Number(value);
  return Number.isFinite(v) ? v : fallback;
}

function nv(value, max = 4000) {
  return String(value ?? '').slice(0, max);
}

function sqlDecimal(value, precision = 18, scale = 4) {
  return { type: sql.Decimal, value: n(value), precision, scale };
}

function serializeLine(row) {
  return {
    arrivalLineKey: Number(row.ArrivalLineKey),
    importKey: Number(row.ImportKey),
    orderYear: String(row.OrderYear || ''),
    orderWeek: String(row.OrderWeek || ''),
    countryName: row.CountryName || '',
    flowerNameRaw: row.FlowerNameRaw || '',
    productNameRaw: row.ProductNameRaw || '',
    farmNameRaw: row.FarmNameRaw || '',
    prodKey: row.ProdKey == null ? null : Number(row.ProdKey),
    farmKey: row.FarmKey == null ? null : Number(row.FarmKey),
    prodName: row.ProdName || '',
    displayName: row.DisplayName || row.ProdName || '',
    dbFlowerName: row.DbFlowerName || '',
    dbCountryName: row.DbCountryName || '',
    farmName: row.FarmName || '',
    unit: row.Unit || '',
    quantity: n(row.Quantity, 0),
    fobUSD: n(row.FobUSD),
    freightPerUnitUSD: n(row.FreightPerUnitUSD),
    customsPerUnitKRW: n(row.CustomsPerUnitKRW),
    otherPerUnitKRW: n(row.OtherPerUnitKRW),
    sourceArrivalCostKRW: n(row.SourceArrivalCostKRW),
    sourceArrivalCostVatKRW: n(row.SourceArrivalCostVatKRW),
    selectedArrivalCostKRW: n(row.SelectedArrivalCostKRW),
    exchangeRate: n(row.ExchangeRate),
    grossWeight: n(row.GrossWeight),
    chargeableWeight: n(row.ChargeableWeight),
    freightUSD: n(row.FreightUSD),
    invoiceUSD: n(row.InvoiceUSD),
    weightMetricShare: n(row.WeightMetricShare),
    volumeMetricShare: n(row.VolumeMetricShare),
    valueMetricShare: n(row.ValueMetricShare),
    allocationBasis: row.AllocationBasis || ARRIVAL_BASIS.SOURCE,
    matchStatus: row.MatchStatus || '',
    sourceFileName: row.SourceFileName || '',
    sheetName: row.SheetName || '',
    sourceRow: row.SourceRow == null ? null : Number(row.SourceRow),
    notes: row.Notes || '',
    isCurrent: !!row.IsCurrent,
    createdAt: row.CreatedAt || null,
    updatedAt: row.UpdatedAt || null,
  };
}

const LINE_SELECT = `
  SELECT l.*, i.UploadFileName,
         p.ProdName, p.DisplayName, p.FlowerName AS DbFlowerName, p.CounName AS DbCountryName,
         f.FarmName
    FROM dbo.WebArrivalCostLine l
    LEFT JOIN dbo.WebArrivalCostImport i ON i.ImportKey=l.ImportKey
    LEFT JOIN dbo.Product p ON p.ProdKey=l.ProdKey
    LEFT JOIN dbo.Farm f ON f.FarmKey=l.FarmKey
`;

export async function listArrivalCost({
  orderYear,
  orderWeek,
  country,
  flower,
  product,
  farm,
  includeHistory = false,
} = {}) {
  await ensureArrivalCostTables();
  const where = ['l.OrderYear=@year'];
  const params = { year: { type: sql.NVarChar, value: String(orderYear || new Date().getFullYear()).slice(0, 4) } };
  if (!includeHistory) where.push('l.IsCurrent=1');
  if (orderWeek) { where.push('l.OrderWeek=@week'); params.week = { type: sql.NVarChar, value: nv(orderWeek, 10) }; }
  if (country) { where.push('(l.CountryName LIKE @country OR p.CounName LIKE @country)'); params.country = { type: sql.NVarChar, value: `%${nv(country, 100)}%` }; }
  if (flower) { where.push('(l.FlowerNameRaw LIKE @flower OR p.FlowerName LIKE @flower)'); params.flower = { type: sql.NVarChar, value: `%${nv(flower, 200)}%` }; }
  if (product) { where.push('(l.ProductNameRaw LIKE @product OR p.ProdName LIKE @product OR p.DisplayName LIKE @product)'); params.product = { type: sql.NVarChar, value: `%${nv(product, 300)}%` }; }
  if (farm) { where.push('(l.FarmNameRaw LIKE @farm OR f.FarmName LIKE @farm)'); params.farm = { type: sql.NVarChar, value: `%${nv(farm, 200)}%` }; }
  const [rowsRes, importsRes, productsRes, farmsRes] = await Promise.all([
    query(`${LINE_SELECT} WHERE ${where.join(' AND ')} ORDER BY l.OrderWeek DESC, l.CountryName, l.FlowerNameRaw, l.ProductNameRaw, l.ArrivalLineKey`, params),
    query(`SELECT TOP 100 ImportKey, OrderYear, UploadFileName, RevisionNo, UploadedByName, UploadedAt, IsDeleted
             FROM dbo.WebArrivalCostImport WHERE OrderYear=@year ORDER BY UploadedAt DESC, ImportKey DESC`, { year: params.year }),
    query(`SELECT ProdKey, ProdCode, ProdName, DisplayName, FlowerName, CounName, OutUnit, SteamOf1Box, BoxWeight, BoxCBM
             FROM dbo.Product WHERE isDeleted=0 ORDER BY CounName, FlowerName, ProdName`),
    query(`SELECT FarmKey, FarmName, CounKey FROM dbo.Farm WHERE isDeleted=0 ORDER BY FarmName`),
  ]);
  return {
    rows: rowsRes.recordset.map(serializeLine),
    imports: importsRes.recordset,
    products: productsRes.recordset,
    farms: farmsRes.recordset,
  };
}

export async function createArrivalCostImport({ parsed, fileName, user, orderYear }) {
  await ensureArrivalCostTables();
  const a = actor(user);
  if (!parsed?.rows?.length) throw new Error('엑셀에서 도착원가 행을 찾지 못했습니다.');
  const year = String(orderYear || parsed.rows[0]?.orderYear || new Date().getFullYear()).slice(0, 4);
  const scopes = [...new Set(parsed.rows.map((r) => `${r.orderWeek || ''}|${r.countryName || ''}`))];
  return withTransaction(async (tQuery) => {
    const revRes = await tQuery(
      `SELECT ISNULL(MAX(RevisionNo),0)+1 AS RevisionNo FROM dbo.WebArrivalCostImport WHERE OrderYear=@year`,
      { year: { type: sql.NVarChar, value: year } },
    );
    const revisionNo = Number(revRes.recordset[0]?.RevisionNo || 1);
    const importRes = await tQuery(
      `INSERT INTO dbo.WebArrivalCostImport
         (OrderYear, UploadFileName, RevisionNo, ScopeJson, UploadedBy, UploadedByName)
       OUTPUT INSERTED.ImportKey
       VALUES (@year,@file,@revision,@scope,@by,@name)`,
      {
        year: { type: sql.NVarChar, value: year }, file: { type: sql.NVarChar, value: nv(fileName, 260) },
        revision: { type: sql.Int, value: revisionNo }, scope: { type: sql.NVarChar, value: JSON.stringify(scopes) },
        by: { type: sql.NVarChar, value: a.id }, name: { type: sql.NVarChar, value: a.name },
      },
    );
    const importKey = Number(importRes.recordset[0].ImportKey);

    // 같은 연도·차수·국가의 이전 업로드만 비활성화한다. 다른 국가의 자료는 보존한다.
    for (const scope of scopes) {
      const [week, country] = scope.split('|');
      const old = await tQuery(
        `SELECT ArrivalLineKey FROM dbo.WebArrivalCostLine
          WHERE OrderYear=@year AND OrderWeek=@week AND CountryName=@country AND IsCurrent=1`,
        { year: { type: sql.NVarChar, value: year }, week: { type: sql.NVarChar, value: nv(week, 10) }, country: { type: sql.NVarChar, value: nv(country, 100) } },
      );
      await tQuery(
        `UPDATE dbo.WebArrivalCostLine SET IsCurrent=0, UpdatedBy=@by, UpdatedAt=GETDATE()
          WHERE OrderYear=@year AND OrderWeek=@week AND CountryName=@country AND IsCurrent=1`,
        { year: { type: sql.NVarChar, value: year }, week: { type: sql.NVarChar, value: nv(week, 10) }, country: { type: sql.NVarChar, value: nv(country, 100) }, by: { type: sql.NVarChar, value: a.id } },
      );
      for (const oldRow of old.recordset) {
        await tQuery(
          `INSERT INTO dbo.WebArrivalCostHistory (ArrivalLineKey,ImportKey,ActionType,BeforeJson,AfterJson,ChangedBy,ChangedByName)
           VALUES (@line,@newImport,N'SUPERSEDE',@before,@after,@by,@name)`,
          { line: { type: sql.Int, value: Number(oldRow.ArrivalLineKey) }, newImport: { type: sql.Int, value: importKey }, before: { type: sql.NVarChar, value: '' }, after: { type: sql.NVarChar, value: JSON.stringify({ importKey }) }, by: { type: sql.NVarChar, value: a.id }, name: { type: sql.NVarChar, value: a.name } },
        );
      }
    }

    for (const row of parsed.rows) {
      const values = {
        importKey: { type: sql.Int, value: importKey }, year: { type: sql.NVarChar, value: year },
        week: { type: sql.NVarChar, value: nv(row.orderWeek, 10) }, country: { type: sql.NVarChar, value: nv(row.countryName, 100) },
        flower: { type: sql.NVarChar, value: nv(row.flowerNameRaw, 200) }, product: { type: sql.NVarChar, value: nv(row.productNameRaw, 300) },
        farmRaw: { type: sql.NVarChar, value: nv(row.farmNameRaw, 200) }, prodKey: { type: sql.Int, value: n(row.prodKey) }, farmKey: { type: sql.Int, value: n(row.farmKey) },
        unit: { type: sql.NVarChar, value: nv(row.unit, 40) }, qty: sqlDecimal(row.quantity), fob: { type: sql.Decimal, value: n(row.fobUSD), precision: 18, scale: 6 },
        freightUnit: { type: sql.Decimal, value: n(row.freightPerUnitUSD), precision: 18, scale: 6 }, customs: sqlDecimal(row.customsPerUnitKRW), other: sqlDecimal(row.otherPerUnitKRW),
        sourceCost: sqlDecimal(row.sourceArrivalCostKRW), sourceVat: sqlDecimal(row.sourceArrivalCostVatKRW), selectedCost: sqlDecimal(row.selectedArrivalCostKRW),
        fx: { type: sql.Decimal, value: n(row.exchangeRate), precision: 18, scale: 6 }, gw: sqlDecimal(row.grossWeight), cw: sqlDecimal(row.chargeableWeight), freight: { type: sql.Decimal, value: n(row.freightUSD), precision: 18, scale: 6 }, invoice: { type: sql.Decimal, value: n(row.invoiceUSD), precision: 18, scale: 6 },
        weightShare: { type: sql.Decimal, value: n(row.weightMetricShare), precision: 18, scale: 8 }, volumeShare: { type: sql.Decimal, value: n(row.volumeMetricShare), precision: 18, scale: 8 }, valueShare: { type: sql.Decimal, value: n(row.valueMetricShare), precision: 18, scale: 8 },
        basis: { type: sql.NVarChar, value: 'SOURCE' }, status: { type: sql.NVarChar, value: nv(row.matchStatus, 30) }, file: { type: sql.NVarChar, value: nv(fileName, 260) }, sheet: { type: sql.NVarChar, value: nv(row.sheetName, 120) }, sourceRow: { type: sql.Int, value: n(row.sourceRow) }, raw: { type: sql.NVarChar, value: nv(row.rawJson, 200000) }, by: { type: sql.NVarChar, value: a.id },
      };
      const lineRes = await tQuery(
        `INSERT INTO dbo.WebArrivalCostLine
          (ImportKey,OrderYear,OrderWeek,CountryName,FlowerNameRaw,ProductNameRaw,FarmNameRaw,ProdKey,FarmKey,Unit,Quantity,FobUSD,FreightPerUnitUSD,CustomsPerUnitKRW,OtherPerUnitKRW,SourceArrivalCostKRW,SourceArrivalCostVatKRW,SelectedArrivalCostKRW,ExchangeRate,GrossWeight,ChargeableWeight,FreightUSD,InvoiceUSD,WeightMetricShare,VolumeMetricShare,ValueMetricShare,AllocationBasis,MatchStatus,SourceFileName,SheetName,SourceRow,RawJson,CreatedBy,UpdatedBy)
         OUTPUT INSERTED.ArrivalLineKey
         VALUES (@importKey,@year,@week,@country,@flower,@product,@farmRaw,@prodKey,@farmKey,@unit,@qty,@fob,@freightUnit,@customs,@other,@sourceCost,@sourceVat,@selectedCost,@fx,@gw,@cw,@freight,@invoice,@weightShare,@volumeShare,@valueShare,@basis,@status,@file,@sheet,@sourceRow,@raw,@by,@by)`, values,
      );
      await tQuery(
        `INSERT INTO dbo.WebArrivalCostHistory (ArrivalLineKey,ImportKey,ActionType,BeforeJson,AfterJson,ChangedBy,ChangedByName)
         VALUES (@line,@import,N'UPLOAD',NULL,@after,@by,@name)`,
        { line: { type: sql.Int, value: Number(lineRes.recordset[0].ArrivalLineKey) }, import: { type: sql.Int, value: importKey }, after: { type: sql.NVarChar, value: JSON.stringify(row) }, by: { type: sql.NVarChar, value: a.id }, name: { type: sql.NVarChar, value: a.name } },
      );
    }
    return { importKey, revisionNo, rowCount: parsed.rows.length, matchedCount: parsed.matchedCount, unmatchedCount: parsed.unmatchedCount, scopes };
  });
}

export async function updateArrivalCostLine({ lineId, prodKey, farmKey, allocationBasis, notes, user }) {
  await ensureArrivalCostTables();
  const id = Number(lineId);
  if (!(id > 0)) throw new Error('도착원가 행을 찾을 수 없습니다.');
  if (!Object.values(ARRIVAL_BASIS).includes(allocationBasis)) throw new Error('지원하지 않는 배분기준입니다.');
  const a = actor(user);
  return withTransaction(async (tQuery) => {
    const beforeRes = await tQuery(`${LINE_SELECT} WHERE l.ArrivalLineKey=@id`, { id: { type: sql.Int, value: id } });
    const before = beforeRes.recordset[0];
    if (!before) throw new Error('도착원가 행을 찾을 수 없습니다.');
    const productChanged = prodKey !== undefined;
    const farmChanged = farmKey !== undefined;
    const nextProdKey = productChanged ? n(prodKey) : before.ProdKey;
    const nextFarmKey = farmChanged ? n(farmKey) : before.FarmKey;
    const productRes = nextProdKey ? await tQuery(`SELECT TOP 1 ProdName,DisplayName,FlowerName,CounName,OutUnit,SteamOf1Box,BoxWeight,BoxCBM FROM dbo.Product WHERE ProdKey=@pk AND isDeleted=0`, { pk: { type: sql.Int, value: nextProdKey } }) : { recordset: [] };
    const product = productRes.recordset[0] || null;
    const farmRes = nextFarmKey ? await tQuery(`SELECT TOP 1 FarmName FROM dbo.Farm WHERE FarmKey=@fk AND isDeleted=0`, { fk: { type: sql.Int, value: nextFarmKey } }) : { recordset: [] };
    const farm = farmRes.recordset[0] || null;
    const matchStatus = product && farm ? 'MATCHED' : product ? 'FARM_REQUIRED' : 'PRODUCT_REQUIRED';
    const lineForCalc = {
      ...before,
      sourceArrivalCostKRW: before.SourceArrivalCostKRW,
      quantity: before.Quantity,
      fobUSD: before.FobUSD,
      freightUSD: before.FreightUSD,
      exchangeRate: before.ExchangeRate,
      customsPerUnitKRW: before.CustomsPerUnitKRW,
      otherPerUnitKRW: before.OtherPerUnitKRW,
      weightMetricShare: before.WeightMetricShare,
      volumeMetricShare: before.VolumeMetricShare,
      valueMetricShare: before.ValueMetricShare,
      allocationBasis,
    };
    const calc = calculateArrivalCost(lineForCalc, allocationBasis);
    await tQuery(
      `UPDATE dbo.WebArrivalCostLine SET ProdKey=@prodKey,FarmKey=@farmKey,AllocationBasis=@basis,SelectedArrivalCostKRW=@selected,MatchStatus=@status,Notes=@notes,UpdatedBy=@by,UpdatedAt=GETDATE()
        WHERE ArrivalLineKey=@id`,
      { id: { type: sql.Int, value: id }, prodKey: { type: sql.Int, value: nextProdKey }, farmKey: { type: sql.Int, value: nextFarmKey }, basis: { type: sql.NVarChar, value: allocationBasis }, selected: sqlDecimal(calc.cost), status: { type: sql.NVarChar, value: matchStatus }, notes: { type: sql.NVarChar, value: nv(notes, 1000) }, by: { type: sql.NVarChar, value: a.id } },
    );
    const afterRes = await tQuery(`${LINE_SELECT} WHERE l.ArrivalLineKey=@id`, { id: { type: sql.Int, value: id } });
    const after = afterRes.recordset[0];
    await tQuery(
      `INSERT INTO dbo.WebArrivalCostHistory (ArrivalLineKey,ImportKey,ActionType,BeforeJson,AfterJson,ChangedBy,ChangedByName)
       VALUES (@line,@import,@action,@before,@after,@by,@name)`,
      { line: { type: sql.Int, value: id }, import: { type: sql.Int, value: Number(before.ImportKey) }, action: { type: sql.NVarChar, value: productChanged || farmChanged ? 'MATCH' : 'BASIS_CHANGE' }, before: { type: sql.NVarChar, value: JSON.stringify(serializeLine(before)) }, after: { type: sql.NVarChar, value: JSON.stringify(serializeLine(after)) }, by: { type: sql.NVarChar, value: a.id }, name: { type: sql.NVarChar, value: a.name } },
    );
    return serializeLine(after);
  });
}

export async function listArrivalCostHistory(lineId) {
  await ensureArrivalCostTables();
  const r = await query(
    `SELECT HistoryKey,ArrivalLineKey,ImportKey,ActionType,BeforeJson,AfterJson,ChangedBy,ChangedByName,ChangedAt
       FROM dbo.WebArrivalCostHistory WHERE ArrivalLineKey=@id ORDER BY ChangedAt DESC, HistoryKey DESC`,
    { id: { type: sql.Int, value: Number(lineId) } },
  );
  return r.recordset;
}
