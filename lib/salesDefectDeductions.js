// 영업수입 불량차감 웹 원장.
//
// 원본 nenova.exe 입력 계약:
// - FormEstimateAdd는 EstimateType/EstimateDtm/ProdKey/Unit/Quantity/Cost/Amount/Vat/
//   Descr/ShipmentKey를 Estimate에 INSERT한다.
// - 차감 수량은 음수, 단가는 양수, Amount/Vat는 음수로 저장한다.
// - Estimate에는 별도 isFix 컬럼/확정 처리 단계가 없고, 견적서 조회는 Estimate를
//   ShipmentMaster.OrderYearWeek와 EstimateDtm으로 읽는다.
// 따라서 웹 원장은 편집 이력을 별도 보존하고, 사용자가 명시한 등록 동작에서만
// Estimate를 같은 컬럼/계산 규칙으로 만든다.

import { query, sql, withTransaction } from './db';
import { scoreMatch, getDisplayName } from './displayName.js';
import { buildProductSuggestions } from './orderImportMatch.js';
import {
  normalizeDeductionRow,
  normalizeParentWeek,
  normalizeUnit,
  normalizeYear,
  previousParentScope,
} from './salesDefectDeductionCore.js';

let ensurePromise = null;

export async function ensureSalesDefectTables() {
  if (ensurePromise) return ensurePromise;
  ensurePromise = query(`
    IF OBJECT_ID(N'dbo.WebSalesDefectDeduction', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.WebSalesDefectDeduction (
        DeductionKey INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        OrderYear INT NOT NULL,
        OrderWeek NVARCHAR(10) NOT NULL,
        CustKey INT NULL,
        CustName NVARCHAR(200) NOT NULL DEFAULT N'',
        ProdKey INT NULL,
        ProdName NVARCHAR(300) NOT NULL DEFAULT N'',
        ColorName NVARCHAR(200) NOT NULL DEFAULT N'',
        Quantity DECIMAL(18,4) NOT NULL DEFAULT 0,
        SourceUnit NVARCHAR(30) NOT NULL DEFAULT N'',
        CreditApplied BIT NOT NULL DEFAULT 0,
        FarmKey INT NULL,
        FarmName NVARCHAR(200) NOT NULL DEFAULT N'',
        Note NVARCHAR(1000) NOT NULL DEFAULT N'',
        DeductionType NVARCHAR(50) NOT NULL DEFAULT N'불량차감',
        EstimateKey INT NULL,
        EstimateCost DECIMAL(18,4) NULL,
        EstimateDtm DATETIME NULL,
        Status NVARCHAR(20) NOT NULL DEFAULT N'DRAFT',
        SourceFileName NVARCHAR(300) NOT NULL DEFAULT N'',
        CreatedBy NVARCHAR(100) NOT NULL DEFAULT N'',
        CreatedByName NVARCHAR(100) NOT NULL DEFAULT N'',
        CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedBy NVARCHAR(100) NOT NULL DEFAULT N'',
        UpdatedByName NVARCHAR(100) NOT NULL DEFAULT N'',
        UpdatedAt DATETIME NOT NULL DEFAULT GETDATE(),
        IsDeleted BIT NOT NULL DEFAULT 0,
        DeletedBy NVARCHAR(100) NULL,
        DeletedAt DATETIME NULL,
        RowVersionNo INT NOT NULL DEFAULT 1
      );
      CREATE INDEX IX_WebSalesDefectDeduction_Week
        ON dbo.WebSalesDefectDeduction(OrderYear, OrderWeek, IsDeleted, CustKey);
      CREATE INDEX IX_WebSalesDefectDeduction_Estimate
        ON dbo.WebSalesDefectDeduction(EstimateKey) WHERE EstimateKey IS NOT NULL;
    END;
    IF OBJECT_ID(N'dbo.WebSalesDefectDeductionHistory', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.WebSalesDefectDeductionHistory (
        HistoryKey BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        DeductionKey INT NOT NULL,
        ActionType NVARCHAR(30) NOT NULL,
        ChangedBy NVARCHAR(100) NOT NULL DEFAULT N'',
        ChangedByName NVARCHAR(100) NOT NULL DEFAULT N'',
        ChangedAt DATETIME NOT NULL DEFAULT GETDATE(),
        ChangeSummary NVARCHAR(1000) NOT NULL DEFAULT N'',
        BeforeJson NVARCHAR(MAX) NULL,
        AfterJson NVARCHAR(MAX) NULL
      );
      CREATE INDEX IX_WebSalesDefectDeductionHistory_Row
        ON dbo.WebSalesDefectDeductionHistory(DeductionKey, ChangedAt DESC);
    END;
  `, {}).catch((error) => {
    ensurePromise = null;
    throw error;
  });
  return ensurePromise;
}

function text(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

function numberValue(value) {
  const n = Number(String(value ?? '').replace(/,/g, '').replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function normalizeSearch(value) {
  return String(value || '').toLowerCase().replace(/[\s()\[\]{}\-_/.]/g, '');
}

function simpleNameScore(input, fields) {
  const q = normalizeSearch(input);
  if (!q) return 0;
  const values = fields.map(normalizeSearch).filter(Boolean);
  if (values.some((v) => v === q)) return 100;
  if (values.some((v) => v.includes(q) || q.includes(v))) return 78;
  return 0;
}

function matchCustomer(name, customers) {
  const scored = customers
    .map((item) => ({ item, score: simpleNameScore(name, [item.CustName, item.CustCode, item.OrderCode]) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || String(a.item.CustName).localeCompare(String(b.item.CustName)));
  const top = scored[0];
  const second = scored[1];
  const matched = top && (top.score === 100 || (top.score >= 78 && (!second || second.score < top.score)));
  return {
    custKey: matched ? Number(top.item.CustKey) : null,
    customerName: matched ? top.item.CustName : name,
    confidence: matched ? top.score : 0,
    suggestions: scored.slice(0, 8).map((x) => ({
      custKey: Number(x.item.CustKey), custName: x.item.CustName, score: x.score,
    })),
  };
}

function matchProduct(row, products) {
  const input = [row.productName, row.colorName].filter(Boolean).join(' ').trim();
  const scored = products
    .map((item) => ({ item, score: scoreMatch(input, item, row.colorName || '') }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || String(a.item.ProdName).localeCompare(String(b.item.ProdName)));
  const top = scored[0];
  const second = scored[1];
  const matched = top && top.score >= 60 && (!second || top.score - second.score >= 5 || top.score >= 85);
  return {
    prodKey: matched ? Number(top.item.ProdKey) : null,
    productName: matched ? (top.item.DisplayName || top.item.ProdName) : row.productName,
    unit: matched ? (top.item.EstUnit || top.item.OutUnit || row.sourceUnit || '') : (row.sourceUnit || ''),
    confidence: matched ? top.score : 0,
    suggestions: buildProductSuggestions(input, products, { limit: 8, minScore: 35 }),
  };
}

export function matchSalesDefectRows(rows, { customers = [], products = [], farms = [] } = {}) {
  return (rows || []).map((raw, index) => {
    const row = normalizeDeductionRow({ ...raw, sourceUnit: raw.sourceUnit || raw.unit });
    const customer = matchCustomer(row.customerName, customers);
    const product = matchProduct(row, products);
    const farm = farms.find((f) => normalizeSearch(f.FarmName) === normalizeSearch(row.farmName));
    return {
      ...row,
      rowNo: raw.sourceRowNo || raw.rowNo || index + 1,
      custKey: row.custKey || customer.custKey,
      customerName: customer.customerName || row.customerName,
      prodKey: row.prodKey || product.prodKey,
      productName: product.productName || row.productName,
      unit: product.unit || row.sourceUnit || '',
      farmKey: row.farmKey || (farm ? Number(farm.FarmKey) || null : null),
      farmName: row.farmName || (farm?.FarmName || ''),
      customerConfidence: customer.confidence,
      productConfidence: product.confidence,
      customerSuggestions: customer.suggestions,
      productSuggestions: product.suggestions,
      needsReview: !customer.custKey || !product.prodKey || !row.quantity,
    };
  });
}

export async function loadLookupData({ q = '', kind = '' } = {}) {
  const keyword = text(q, 100);
  const like = `%${keyword}%`;
  if (kind === 'customer') {
    const r = await query(
      `SELECT TOP 80 CustKey, CustCode, CustName, OrderCode, Manager
         FROM Customer
        WHERE ISNULL(isDeleted,0)=0
          AND (@q='' OR CustName LIKE @like OR CustCode LIKE @like OR OrderCode LIKE @like)
        ORDER BY CustName`,
      { q: { type: sql.NVarChar, value: keyword }, like: { type: sql.NVarChar, value: like } },
    );
    return { customers: r.recordset };
  }
  if (kind === 'product') {
    const r = await query(
      `SELECT TOP 100 p.ProdKey, p.ProdCode, p.ProdName, p.DisplayName,
              p.FlowerName, p.CounName, p.OutUnit, p.EstUnit
         FROM Product p
        WHERE ISNULL(p.isDeleted,0)=0
          AND (@q='' OR p.ProdName LIKE @like OR p.DisplayName LIKE @like
                    OR p.FlowerName LIKE @like OR p.CounName LIKE @like OR p.ProdCode LIKE @like)
        ORDER BY p.CounName, p.FlowerName, p.ProdName`,
      { q: { type: sql.NVarChar, value: keyword }, like: { type: sql.NVarChar, value: like } },
    );
    return { products: r.recordset };
  }
  const r = await query(
    `SELECT TOP 150 ISNULL(f.FarmKey,0) AS FarmKey, v.FarmName
       FROM (SELECT DISTINCT FarmName FROM ViewWarehouse WHERE NULLIF(FarmName,N'') IS NOT NULL) v
       LEFT JOIN Farm f ON f.FarmName=v.FarmName AND ISNULL(f.isDeleted,0)=0
      WHERE @q='' OR v.FarmName LIKE @like
      ORDER BY v.FarmName`,
    { q: { type: sql.NVarChar, value: keyword }, like: { type: sql.NVarChar, value: like } },
  );
  return { farms: r.recordset };
}

export async function loadMatchContext() {
  const [customerResult, productResult, farmResult] = await Promise.all([
    query(`SELECT CustKey, CustCode, CustName, OrderCode FROM Customer WHERE ISNULL(isDeleted,0)=0 ORDER BY CustName`, {}),
    query(`SELECT ProdKey, ProdCode, ProdName, DisplayName, FlowerName, CounName, OutUnit, EstUnit FROM Product WHERE ISNULL(isDeleted,0)=0 ORDER BY CounName, FlowerName, ProdName`, {}),
    query(`SELECT TOP 500 ISNULL(f.FarmKey,0) AS FarmKey, v.FarmName
             FROM (SELECT DISTINCT FarmName FROM ViewWarehouse WHERE NULLIF(FarmName,N'') IS NOT NULL) v
             LEFT JOIN Farm f ON f.FarmName=v.FarmName AND ISNULL(f.isDeleted,0)=0
            ORDER BY v.FarmName`, {}),
  ]);
  return {
    customers: customerResult.recordset || [],
    products: productResult.recordset || [],
    farms: farmResult.recordset || [],
  };
}

export async function resolveEstimateContext({ year, week, custKey, prodKey }, q = query) {
  const scope = previousParentScope(year, week);
  const target = await q(
    `SELECT TOP 1 sm.ShipmentKey, sm.OrderWeek, sm.ShipmentDtm, ISNULL(sm.isFix,0) AS isFix
       FROM ShipmentMaster sm
      WHERE sm.OrderYear=@yr AND sm.CustKey=@ck
        AND sm.OrderWeek LIKE @prefix AND ISNULL(sm.isDeleted,0)=0
      ORDER BY TRY_CONVERT(INT, RIGHT(sm.OrderWeek,2)), sm.ShipmentKey`,
    {
      yr: { type: sql.Int, value: Number(year) },
      ck: { type: sql.Int, value: Number(custKey) },
      prefix: { type: sql.NVarChar, value: `${String(week).padStart(2, '0')}-%` },
    },
  );
  const previous = await q(
    `SELECT TOP 1
            COALESCE(NULLIF(sdd.Cost,0), NULLIF(sd.Cost,0), 0) AS Cost,
            CASE WHEN NULLIF(sdd.Cost,0) IS NOT NULL THEN N'ShipmentDate.Cost'
                 WHEN NULLIF(sd.Cost,0) IS NOT NULL THEN N'ShipmentDetail.Cost'
                 ELSE N'' END AS CostSource,
            sm.OrderWeek AS SourceOrderWeek, sm.ShipmentKey AS SourceShipmentKey
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey AND sd.ProdKey=@pk
       LEFT JOIN ShipmentDate sdd ON sdd.SdetailKey=sd.SdetailKey
      WHERE sm.OrderYear=@yr AND sm.CustKey=@ck
        AND sm.OrderWeek LIKE @prefix AND ISNULL(sm.isDeleted,0)=0
      ORDER BY CASE WHEN NULLIF(sdd.Cost,0) IS NULL THEN 1 ELSE 0 END,
               TRY_CONVERT(INT, RIGHT(sm.OrderWeek,2)) DESC,
               ISNULL(sdd.SdateKey,0) DESC, sd.SdetailKey DESC`,
    {
      yr: { type: sql.Int, value: scope.year },
      ck: { type: sql.Int, value: Number(custKey) },
      pk: { type: sql.Int, value: Number(prodKey) },
      prefix: { type: sql.NVarChar, value: `${String(scope.week).padStart(2, '0')}-%` },
    },
  );
  const product = await q(
    `SELECT TOP 1 EstUnit, OutUnit FROM Product WHERE ProdKey=@pk AND ISNULL(isDeleted,0)=0`,
    { pk: { type: sql.Int, value: Number(prodKey) } },
  );
  const targetRow = target.recordset[0] || null;
  const previousRow = previous.recordset[0] || null;
  return {
    shipmentKey: targetRow?.ShipmentKey ? Number(targetRow.ShipmentKey) : null,
    shipmentOrderWeek: targetRow?.OrderWeek || '',
    estimateDate: targetRow?.ShipmentDtm || null,
    targetIsFix: Number(targetRow?.isFix || 0) === 1,
    cost: Number(previousRow?.Cost || 0),
    costSource: previousRow?.CostSource || '',
    costOrderWeek: previousRow?.SourceOrderWeek || `${scope.week}차`,
    costShipmentKey: previousRow?.SourceShipmentKey ? Number(previousRow.SourceShipmentKey) : null,
    unit: product.recordset[0]?.EstUnit || product.recordset[0]?.OutUnit || '',
  };
}

async function resolveEstimateTypeCode(typeText, q = query) {
  const result = await q(
    `SELECT TOP 1 DetailCode
       FROM CodeInfo
      WHERE Category=N'EstimateType'
        AND (DetailCode=@type OR Descr2=@type OR Descr=@type)
      ORDER BY CASE WHEN DetailCode=@type THEN 0 ELSE 1 END`,
    { type: { type: sql.NVarChar, value: text(typeText, 50) || '불량차감' } },
  );
  return result.recordset[0]?.DetailCode || text(typeText, 50) || '불량차감';
}

function snapshot(row) {
  return {
    deductionKey: Number(row.DeductionKey || row.deductionKey || 0),
    orderYear: Number(row.OrderYear || row.orderYear || 0),
    orderWeek: String(row.OrderWeek || row.orderWeek || ''),
    custKey: row.CustKey == null ? null : Number(row.CustKey),
    customerName: row.CustName ?? row.customerName ?? '',
    prodKey: row.ProdKey == null ? null : Number(row.ProdKey),
    productName: row.ProdName ?? row.productName ?? '',
    colorName: row.ColorName ?? row.colorName ?? '',
    quantity: Number(row.Quantity || row.quantity || 0),
    sourceUnit: row.SourceUnit ?? row.sourceUnit ?? '',
    creditApplied: Boolean(row.CreditApplied ?? row.creditApplied),
    farmKey: row.FarmKey == null ? null : Number(row.FarmKey),
    farmName: row.FarmName ?? row.farmName ?? '',
    note: row.Note ?? row.note ?? '',
    deductionType: row.DeductionType ?? row.deductionType ?? '불량차감',
    estimateKey: row.EstimateKey == null ? null : Number(row.EstimateKey),
    estimateCost: row.EstimateCost == null ? null : Number(row.EstimateCost),
    estimateDtm: row.EstimateDtm || null,
    status: row.Status ?? row.status ?? 'DRAFT',
    isDeleted: Boolean(row.IsDeleted ?? row.isDeleted),
  };
}

function changeSummary(before, after, action) {
  if (!before) return `${action}: 신규 행 ${after.customerName || '(거래처 미매칭)'} / ${after.productName || '(품목 미매칭)'} ${after.quantity || 0}${after.sourceUnit || ''}`;
  const changes = [];
  if (before.customerName !== after.customerName || Number(before.custKey || 0) !== Number(after.custKey || 0)) changes.push(`거래처 ${before.customerName || '-'} → ${after.customerName || '-'}`);
  if (before.productName !== after.productName || Number(before.prodKey || 0) !== Number(after.prodKey || 0)) changes.push(`품명 ${before.productName || '-'} → ${after.productName || '-'}`);
  if (before.colorName !== after.colorName) changes.push(`색상 ${before.colorName || '-'} → ${after.colorName || '-'}`);
  if (Number(before.quantity || 0) !== Number(after.quantity || 0)) changes.push(`수량 ${before.quantity || 0} → ${after.quantity || 0}`);
  if (before.creditApplied !== after.creditApplied) changes.push(`크레딧 ${before.creditApplied ? '체크' : '미체크'} → ${after.creditApplied ? '체크' : '미체크'}`);
  if (before.farmName !== after.farmName) changes.push(`농장 ${before.farmName || '-'} → ${after.farmName || '-'}`);
  if (before.note !== after.note) changes.push('비고 변경');
  if (before.status !== after.status) changes.push(`상태 ${before.status} → ${after.status}`);
  return changes.length ? `${action}: ${changes.join(', ')}` : `${action}: 변경 없음`;
}

async function writeHistory(tQuery, { key, action, user, before, after }) {
  await tQuery(
    `INSERT INTO WebSalesDefectDeductionHistory
       (DeductionKey, ActionType, ChangedBy, ChangedByName, ChangeSummary, BeforeJson, AfterJson)
     VALUES (@key,@action,@by,@name,@summary,@before,@after)`,
    {
      key: { type: sql.Int, value: Number(key) },
      action: { type: sql.NVarChar, value: text(action, 30) },
      by: { type: sql.NVarChar, value: text(user?.userId, 100) },
      name: { type: sql.NVarChar, value: text(user?.userName, 100) },
      summary: { type: sql.NVarChar, value: changeSummary(before, after, action) },
      before: { type: sql.NVarChar, value: before ? JSON.stringify(before) : '' },
      after: { type: sql.NVarChar, value: after ? JSON.stringify(after) : '' },
    },
  );
}

function rowParams(row, { year, week, user, sourceFileName = '' } = {}) {
  const item = normalizeDeductionRow(row);
  return {
    year: { type: sql.Int, value: Number(year) },
    week: { type: sql.NVarChar, value: String(Number(week)) },
    ck: { type: sql.Int, value: item.custKey },
    cn: { type: sql.NVarChar, value: item.customerName },
    pk: { type: sql.Int, value: item.prodKey },
    pn: { type: sql.NVarChar, value: item.productName },
    color: { type: sql.NVarChar, value: item.colorName },
    qty: { type: sql.Decimal(18, 4), value: item.quantity },
    unit: { type: sql.NVarChar, value: normalizeUnit(item.sourceUnit || item.unit || '') },
    credit: { type: sql.Bit, value: item.creditApplied },
    fk: { type: sql.Int, value: item.farmKey },
    fn: { type: sql.NVarChar, value: item.farmName },
    note: { type: sql.NVarChar, value: item.note },
    dtype: { type: sql.NVarChar, value: item.deductionType || '불량차감' },
    file: { type: sql.NVarChar, value: text(sourceFileName || item.sourceFileName, 300) },
    by: { type: sql.NVarChar, value: text(user?.userId, 100) },
    byName: { type: sql.NVarChar, value: text(user?.userName, 100) },
  };
}

export async function listDeductions({ year, week, includeDeleted = false, history = false } = {}) {
  await ensureSalesDefectTables();
  const params = {
    year: { type: sql.Int, value: Number(year) },
    week: { type: sql.NVarChar, value: String(Number(week)) },
  };
  const where = `d.OrderYear=@year AND d.OrderWeek=@week ${includeDeleted ? '' : 'AND d.IsDeleted=0'}`;
  const rows = await query(
    `SELECT d.*,
            c.CustName AS CurrentCustName,
            p.ProdName AS CurrentProdName,
            p.DisplayName AS CurrentDisplayName,
            p.EstUnit AS CurrentEstUnit,
            f.FarmName AS CurrentFarmName
       FROM WebSalesDefectDeduction d
       LEFT JOIN Customer c ON c.CustKey=d.CustKey
       LEFT JOIN Product p ON p.ProdKey=d.ProdKey
       LEFT JOIN Farm f ON f.FarmKey=d.FarmKey
      WHERE ${where}
      ORDER BY d.DeductionKey`, params,
  );
  const result = { rows: rows.recordset.map(snapshot) };
  if (history) {
    const hr = await query(
      `SELECT TOP 1000 h.*, d.OrderYear, d.OrderWeek
         FROM WebSalesDefectDeductionHistory h
         LEFT JOIN WebSalesDefectDeduction d ON d.DeductionKey=h.DeductionKey
        WHERE d.OrderYear=@year AND d.OrderWeek=@week
        ORDER BY h.ChangedAt DESC, h.HistoryKey DESC`, params,
    );
    result.history = hr.recordset;
  }
  return result;
}

export async function saveDraftRows({ year, week, rows, user, sourceFileName = '' } = {}) {
  await ensureSalesDefectTables();
  const y = normalizeYear(year);
  const w = normalizeParentWeek(week);
  if (!y || !w) throw new Error('연도와 차수를 확인하세요.');
  if (!Array.isArray(rows) || rows.length > 500) throw new Error('저장 행은 1~500건까지 가능합니다.');
  const saved = [];
  await withTransaction(async (tQuery) => {
    for (const raw of rows) {
      const item = normalizeDeductionRow(raw);
      if (!item.customerName && !item.productName && !item.quantity) continue;
      if (item.quantity <= 0) throw new Error(`${item.customerName || '(거래처 미입력)'} 행의 차감수량을 입력하세요.`);
      const params = rowParams(item, { year: y, week: w, user, sourceFileName });
      let before = null;
      let key = item.deductionKey;
      if (key) {
        const old = await tQuery(`SELECT * FROM WebSalesDefectDeduction WITH (UPDLOCK,HOLDLOCK) WHERE DeductionKey=@key`, { key: { type: sql.Int, value: key } });
        if (!old.recordset[0] || Number(old.recordset[0].IsDeleted) === 1) throw new Error(`차감 행 ${key}를 찾을 수 없습니다.`);
        if (Number(old.recordset[0].OrderYear) !== y || String(old.recordset[0].OrderWeek) !== String(w)) {
          throw new Error(`차감 행 ${key}는 선택한 ${y}년 ${w}차 원장이 아닙니다.`);
        }
        before = snapshot(old.recordset[0]);
        await tQuery(
          `UPDATE WebSalesDefectDeduction
              SET OrderYear=@year, OrderWeek=@week, CustKey=@ck, CustName=@cn,
                  ProdKey=@pk, ProdName=@pn, ColorName=@color, Quantity=@qty,
                  SourceUnit=@unit, CreditApplied=@credit, FarmKey=@fk, FarmName=@fn,
                  Note=@note, DeductionType=@dtype, SourceFileName=@file,
                  UpdatedBy=@by, UpdatedByName=@byName, UpdatedAt=GETDATE(),
                  RowVersionNo=RowVersionNo+1
            WHERE DeductionKey=@key`, { ...params, key: { type: sql.Int, value: key } },
        );
      } else {
        const inserted = await tQuery(
          `INSERT INTO WebSalesDefectDeduction
             (OrderYear,OrderWeek,CustKey,CustName,ProdKey,ProdName,ColorName,Quantity,SourceUnit,
              CreditApplied,FarmKey,FarmName,Note,DeductionType,SourceFileName,CreatedBy,CreatedByName,
              UpdatedBy,UpdatedByName)
           OUTPUT INSERTED.DeductionKey
           VALUES (@year,@week,@ck,@cn,@pk,@pn,@color,@qty,@unit,@credit,@fk,@fn,@note,@dtype,@file,@by,@byName,@by,@byName)`, params,
        );
        key = Number(inserted.recordset[0].DeductionKey);
      }
      if (before?.estimateKey) {
        const linked = await syncLinkedEstimate(tQuery, { year: y, week: w, item, estimateKey: before.estimateKey });
        await tQuery(
          `UPDATE WebSalesDefectDeduction
              SET EstimateCost=@cost, EstimateDtm=@dt, Status=N'REGISTERED'
            WHERE DeductionKey=@key`,
          {
            cost: { type: sql.Decimal(18, 4), value: linked.cost },
            dt: { type: sql.DateTime, value: linked.estimateDate },
            key: { type: sql.Int, value: key },
          },
        );
      }
      const current = await tQuery(`SELECT * FROM WebSalesDefectDeduction WHERE DeductionKey=@key`, { key: { type: sql.Int, value: key } });
      const after = snapshot(current.recordset[0]);
      await writeHistory(tQuery, { key, action: before ? 'UPDATE' : 'CREATE', user, before, after });
      saved.push(after);
    }
  });
  return saved;
}

async function getStoredRow(tQuery, key, lock = false) {
  const result = await tQuery(`SELECT * FROM WebSalesDefectDeduction ${lock ? 'WITH (UPDLOCK,HOLDLOCK)' : ''} WHERE DeductionKey=@key`, { key: { type: sql.Int, value: Number(key) } });
  return result.recordset[0] || null;
}

function assertRegisterable(row) {
  if (!row.CustKey) throw new Error('거래처 매칭이 필요합니다.');
  if (!row.ProdKey) throw new Error('품목 매칭이 필요합니다.');
  if (!(Number(row.Quantity) > 0)) throw new Error('차감수량이 필요합니다.');
}

async function syncLinkedEstimate(tQuery, { year, week, item, estimateKey }) {
  assertRegisterable({ CustKey: item.custKey, ProdKey: item.prodKey, Quantity: item.quantity });
  const ctx = await resolveEstimateContext({ year, week, custKey: item.custKey, prodKey: item.prodKey }, tQuery);
  if (!ctx.shipmentKey) throw new Error(`${item.customerName || '거래처'} ${week}차 출고가 없어 연결 견적을 갱신할 수 없습니다.`);
  if (!(ctx.cost > 0)) throw new Error(`${item.customerName || '거래처'} / ${item.productName || '품목'}의 이전 차수 분배 단가가 없습니다.`);
  const typeCode = await resolveEstimateTypeCode(item.deductionType, tQuery);
  const qty = -Math.abs(Number(item.quantity) || 0);
  const cost = Number(ctx.cost) || 0;
  const amount = Math.round(qty * cost / 1.1);
  const vat = qty * cost - amount;
  await tQuery(
    `UPDATE Estimate
        SET EstimateType=@type, EstimateDtm=@dt, ProdKey=@pk, Unit=@unit,
            Quantity=@qty, Cost=@cost, Amount=@amount, Vat=@vat, Descr=@descr,
            ShipmentKey=@sk
      WHERE EstimateKey=@ek`,
    {
      type: { type: sql.NVarChar, value: typeCode },
      dt: { type: sql.DateTime, value: ctx.estimateDate || new Date() },
      pk: { type: sql.Int, value: Number(item.prodKey) },
      unit: { type: sql.NVarChar, value: ctx.unit || normalizeUnit(item.sourceUnit) || '단' },
      qty: { type: sql.Float, value: qty },
      cost: { type: sql.Float, value: cost },
      amount: { type: sql.Float, value: amount },
      vat: { type: sql.Float, value: vat },
      descr: { type: sql.NVarChar, value: item.note || '' },
      sk: { type: sql.Int, value: Number(ctx.shipmentKey) },
      ek: { type: sql.Int, value: Number(estimateKey) },
    },
  );
  return { cost, estimateDate: ctx.estimateDate || new Date() };
}

export async function preflightRegistration({ year, week, rows } = {}) {
  const y = normalizeYear(year);
  const w = normalizeParentWeek(week);
  if (!y || !w) throw new Error('연도와 차수를 확인하세요.');
  const output = [];
  for (let i = 0; i < (rows || []).length; i += 1) {
    const item = normalizeDeductionRow(rows[i]);
    const result = { index: i, deductionKey: item.deductionKey, cost: 0, costSource: '', shipmentKey: null, estimateDate: null, error: '' };
    try {
      assertRegisterable({ CustKey: item.custKey, ProdKey: item.prodKey, Quantity: item.quantity });
      const ctx = await resolveEstimateContext({ year: y, week: w, custKey: item.custKey, prodKey: item.prodKey });
      Object.assign(result, ctx);
      if (!ctx.shipmentKey) result.error = `${item.customerName || '거래처'} ${w}차 출고가 없어 견적서 등록 대상을 찾을 수 없습니다.`;
      else if (!(ctx.cost > 0)) result.error = `${item.customerName || '거래처'} / ${item.productName || '품목'}의 ${previousParentScope(y, w).week}차 분배 단가가 없습니다.`;
    } catch (error) {
      result.error = error.message;
    }
    output.push(result);
  }
  return output;
}

export async function registerDeductions({ year, week, ids, deductionType = '불량차감', user } = {}) {
  await ensureSalesDefectTables();
  const y = normalizeYear(year);
  const w = normalizeParentWeek(week);
  if (!y || !w) throw new Error('연도와 차수를 확인하세요.');
  const keys = [...new Set((ids || []).map((x) => Number(x)).filter((x) => x > 0))];
  if (!keys.length || keys.length > 500) throw new Error('등록할 행을 선택하세요.');
  const registered = [];
  const preflight = [];

  await withTransaction(async (tQuery) => {
    const typeCode = await resolveEstimateTypeCode(deductionType, tQuery);
    for (const key of keys) {
      const dbRow = await getStoredRow(tQuery, key, true);
      if (!dbRow || Number(dbRow.IsDeleted) === 1) throw new Error(`차감 행 ${key}를 찾을 수 없습니다.`);
      if (Number(dbRow.OrderYear) !== y || String(dbRow.OrderWeek) !== String(w)) {
        throw new Error(`차감 행 ${key}는 선택한 ${y}년 ${w}차 원장이 아닙니다.`);
      }
      assertRegisterable(dbRow);
      const ctx = await resolveEstimateContext({ year: y, week: w, custKey: dbRow.CustKey, prodKey: dbRow.ProdKey }, tQuery);
      if (!ctx.shipmentKey) throw new Error(`${dbRow.CustName || '거래처'} ${w}차 출고가 없어 등록할 수 없습니다.`);
      if (!(ctx.cost > 0)) throw new Error(`${dbRow.CustName || '거래처'} / ${dbRow.ProdName || '품목'}의 이전 차수 분배 단가가 없습니다.`);
      preflight.push({ key, dbRow, ctx, typeCode });
    }

    for (const { key, dbRow, ctx, typeCode } of preflight) {
      const qty = -Math.abs(Number(dbRow.Quantity) || 0);
      const cost = Number(ctx.cost) || 0;
      const amount = Math.round(qty * cost / 1.1);
      const vat = qty * cost - amount;
      let estimateKey = Number(dbRow.EstimateKey || 0);
      if (estimateKey) {
        await tQuery(
          `UPDATE Estimate
              SET EstimateType=@type, EstimateDtm=@dt, ProdKey=@pk, Unit=@unit,
                  Quantity=@qty, Cost=@cost, Amount=@amount, Vat=@vat, Descr=@descr,
                  ShipmentKey=@sk
            WHERE EstimateKey=@ek`,
          {
            type: { type: sql.NVarChar, value: typeCode },
            dt: { type: sql.DateTime, value: ctx.estimateDate || new Date() },
            pk: { type: sql.Int, value: Number(dbRow.ProdKey) },
            unit: { type: sql.NVarChar, value: ctx.unit || normalizeUnit(dbRow.SourceUnit) || '단' },
            qty: { type: sql.Float, value: qty },
            cost: { type: sql.Float, value: cost },
            amount: { type: sql.Float, value: amount },
            vat: { type: sql.Float, value: vat },
            descr: { type: sql.NVarChar, value: dbRow.Note || '' },
            sk: { type: sql.Int, value: Number(ctx.shipmentKey) },
            ek: { type: sql.Int, value: estimateKey },
          },
        );
      } else {
        const inserted = await tQuery(
          `INSERT INTO Estimate
             (EstimateType,EstimateDtm,ProdKey,Unit,Quantity,Cost,Amount,Vat,Descr,ShipmentKey)
           OUTPUT INSERTED.EstimateKey
           VALUES (@type,@dt,@pk,@unit,@qty,@cost,@amount,@vat,@descr,@sk)`,
          {
            type: { type: sql.NVarChar, value: typeCode },
            dt: { type: sql.DateTime, value: ctx.estimateDate || new Date() },
            pk: { type: sql.Int, value: Number(dbRow.ProdKey) },
            unit: { type: sql.NVarChar, value: ctx.unit || normalizeUnit(dbRow.SourceUnit) || '단' },
            qty: { type: sql.Float, value: qty },
            cost: { type: sql.Float, value: cost },
            amount: { type: sql.Float, value: amount },
            vat: { type: sql.Float, value: vat },
            descr: { type: sql.NVarChar, value: dbRow.Note || '' },
            sk: { type: sql.Int, value: Number(ctx.shipmentKey) },
          },
        );
        estimateKey = Number(inserted.recordset[0].EstimateKey);
      }
      const before = snapshot(dbRow);
      await tQuery(
        `UPDATE WebSalesDefectDeduction
            SET DeductionType=@type, EstimateKey=@ek, EstimateCost=@cost, EstimateDtm=@dt,
                Status=N'REGISTERED', UpdatedBy=@by, UpdatedByName=@name,
                UpdatedAt=GETDATE(), RowVersionNo=RowVersionNo+1
          WHERE DeductionKey=@key`,
        {
          type: { type: sql.NVarChar, value: text(deductionType, 50) || '불량차감' },
          ek: { type: sql.Int, value: estimateKey },
          cost: { type: sql.Decimal(18, 4), value: cost },
          dt: { type: sql.DateTime, value: ctx.estimateDate || new Date() },
          by: { type: sql.NVarChar, value: text(user?.userId, 100) },
          name: { type: sql.NVarChar, value: text(user?.userName, 100) },
          key: { type: sql.Int, value: key },
        },
      );
      const current = await getStoredRow(tQuery, key);
      const after = snapshot(current);
      await writeHistory(tQuery, { key, action: 'REGISTER_ESTIMATE', user, before, after });
      registered.push({ deductionKey: key, estimateKey, cost, costSource: ctx.costSource, targetShipmentKey: ctx.shipmentKey });
    }
  });
  return registered;
}

export async function deleteDeductions({ year, week, ids, user } = {}) {
  await ensureSalesDefectTables();
  const scopedYear = year == null ? null : normalizeYear(year);
  const scopedWeek = week == null ? null : normalizeParentWeek(week);
  if ((year != null || week != null) && (!scopedYear || !scopedWeek)) throw new Error('삭제 연도와 차수를 확인하세요.');
  const keys = [...new Set((ids || []).map((x) => Number(x)).filter((x) => x > 0))];
  if (!keys.length) throw new Error('삭제할 행을 선택하세요.');
  await withTransaction(async (tQuery) => {
    for (const key of keys) {
      const row = await getStoredRow(tQuery, key, true);
      if (!row || Number(row.IsDeleted) === 1) continue;
      if (scopedYear != null && (Number(row.OrderYear) !== scopedYear || String(row.OrderWeek) !== String(scopedWeek))) {
        throw new Error(`차감 행 ${key}는 선택한 ${scopedYear}년 ${scopedWeek}차 원장이 아닙니다.`);
      }
      const before = snapshot(row);
      if (row.EstimateKey) {
        // nenova.exe ClassEstimate.Delete()와 동일하게 Estimate 자체를 삭제하되,
        // 웹 원장과 이력은 soft-delete로 남긴다.
        await tQuery(`DELETE FROM Estimate WHERE EstimateKey=@ek`, { ek: { type: sql.Int, value: Number(row.EstimateKey) } });
      }
      await tQuery(
        `UPDATE WebSalesDefectDeduction
            SET IsDeleted=1, Status=N'DELETED', DeletedBy=@by, DeletedAt=GETDATE(),
                UpdatedBy=@by, UpdatedByName=@name, UpdatedAt=GETDATE(), RowVersionNo=RowVersionNo+1
          WHERE DeductionKey=@key`,
        {
          by: { type: sql.NVarChar, value: text(user?.userId, 100) },
          name: { type: sql.NVarChar, value: text(user?.userName, 100) },
          key: { type: sql.Int, value: key },
        },
      );
      const current = await getStoredRow(tQuery, key);
      await writeHistory(tQuery, { key, action: 'DELETE', user, before, after: snapshot(current) });
    }
  });
}
