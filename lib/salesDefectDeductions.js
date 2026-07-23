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

import { query, sql, withTransaction } from './db.js';
import { buildProductMappingStats, buildProductSuggestions } from './orderImportMatch.js';
import { resolveImportCustomer } from './orderImportCustomerMatch.js';
import { loadMappings } from './parseMappings.js';
import {
  normalizeDeductionRow,
  deductionManagerIdentity,
  normalizeParentWeek,
  normalizeUnit,
  normalizeYear,
  previousParentScope,
} from './salesDefectDeductionCore.js';

let ensurePromise = null;
let lookupUsagePromise = null;
let lookupUsageCache = null;

const DEFAULT_MANAGER_OPTIONS = ['김원영', '박성수', '정재훈', '조현욱'];

function normalizeManagerName(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '').trim();
}

function managerPriority(item) {
  const defaultIndex = DEFAULT_MANAGER_OPTIONS.indexOf(item.managerName);
  return [
    defaultIndex < 0 ? 100 : defaultIndex,
    item.managerKey == null ? 1 : 0,
    Number(item.managerKey || Number.MAX_SAFE_INTEGER),
    String(item.managerId || ''),
  ];
}

function compareManagerPriority(a, b) {
  const ap = managerPriority(a);
  const bp = managerPriority(b);
  for (let i = 0; i < ap.length; i += 1) {
    if (ap[i] < bp[i]) return -1;
    if (ap[i] > bp[i]) return 1;
  }
  return 0;
}

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
        ImportConfirmed BIT NOT NULL DEFAULT 0,
        ImportConfirmedBy NVARCHAR(100) NOT NULL DEFAULT N'',
        ImportConfirmedByName NVARCHAR(100) NOT NULL DEFAULT N'',
        ImportConfirmedAt DATETIME NULL,
        ImportReviewRequired BIT NOT NULL DEFAULT 0,
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
    IF COL_LENGTH(N'dbo.WebSalesDefectDeduction', N'ImportConfirmed') IS NULL
      ALTER TABLE dbo.WebSalesDefectDeduction ADD ImportConfirmed BIT NOT NULL CONSTRAINT DF_WebSalesDefectDeduction_ImportConfirmed DEFAULT 0;
    IF COL_LENGTH(N'dbo.WebSalesDefectDeduction', N'ImportConfirmedBy') IS NULL
      ALTER TABLE dbo.WebSalesDefectDeduction ADD ImportConfirmedBy NVARCHAR(100) NOT NULL CONSTRAINT DF_WebSalesDefectDeduction_ImportConfirmedBy DEFAULT N'';
    IF COL_LENGTH(N'dbo.WebSalesDefectDeduction', N'ImportConfirmedByName') IS NULL
      ALTER TABLE dbo.WebSalesDefectDeduction ADD ImportConfirmedByName NVARCHAR(100) NOT NULL CONSTRAINT DF_WebSalesDefectDeduction_ImportConfirmedByName DEFAULT N'';
    IF COL_LENGTH(N'dbo.WebSalesDefectDeduction', N'ImportConfirmedAt') IS NULL
      ALTER TABLE dbo.WebSalesDefectDeduction ADD ImportConfirmedAt DATETIME NULL;
    IF COL_LENGTH(N'dbo.WebSalesDefectDeduction', N'ImportReviewRequired') IS NULL
      ALTER TABLE dbo.WebSalesDefectDeduction ADD ImportReviewRequired BIT NOT NULL CONSTRAINT DF_WebSalesDefectDeduction_ImportReviewRequired DEFAULT 0;
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
    IF OBJECT_ID(N'dbo.WebSalesDefectManager', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.WebSalesDefectManager (
        ManagerKey INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        ManagerId NVARCHAR(100) NOT NULL,
        ManagerName NVARCHAR(100) NOT NULL,
        SortOrder INT NOT NULL DEFAULT 0,
        IsDeleted BIT NOT NULL DEFAULT 0,
        CreatedBy NVARCHAR(100) NOT NULL DEFAULT N'',
        UpdatedBy NVARCHAR(100) NOT NULL DEFAULT N'',
        CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedAt DATETIME NOT NULL DEFAULT GETDATE()
      );
      CREATE UNIQUE INDEX UX_WebSalesDefectManager_ActiveId
        ON dbo.WebSalesDefectManager(ManagerId) WHERE IsDeleted=0;
    END;
    INSERT INTO dbo.WebSalesDefectManager (ManagerId, ManagerName, SortOrder)
    SELECT N'김원영', N'김원영', 10
    WHERE NOT EXISTS (SELECT 1 FROM dbo.WebSalesDefectManager WHERE ManagerId=N'김원영' AND IsDeleted=0);
    INSERT INTO dbo.WebSalesDefectManager (ManagerId, ManagerName, SortOrder)
    SELECT N'박성수', N'박성수', 20
    WHERE NOT EXISTS (SELECT 1 FROM dbo.WebSalesDefectManager WHERE ManagerId=N'박성수' AND IsDeleted=0);
    INSERT INTO dbo.WebSalesDefectManager (ManagerId, ManagerName, SortOrder)
    SELECT N'정재훈', N'정재훈', 30
    WHERE NOT EXISTS (SELECT 1 FROM dbo.WebSalesDefectManager WHERE ManagerId=N'정재훈' AND IsDeleted=0);
    INSERT INTO dbo.WebSalesDefectManager (ManagerId, ManagerName, SortOrder)
    SELECT N'조현욱', N'조현욱', 40
    WHERE NOT EXISTS (SELECT 1 FROM dbo.WebSalesDefectManager WHERE ManagerId=N'조현욱' AND IsDeleted=0);
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

function scoreCustomerLookup(input, customer) {
  const wanted = normalizeSearch(input);
  if (!wanted) return 0;
  const name = normalizeSearch(customer.CustName);
  const fields = [customer.CustName, customer.CustCode, customer.OrderCode, customer.CustArea]
    .map(normalizeSearch).filter(Boolean);
  if (name === wanted) return 100;
  if (name.startsWith(wanted)) return 96;
  if (fields.some((field) => field === wanted)) return 94;
  if (name.includes(wanted)) return 88;
  if (fields.some((field) => field.includes(wanted) || wanted.includes(field))) return 82;
  const chunks = [...wanted].reduce((out, _, index, chars) => {
    if (index % 2 === 0 && chars[index + 1]) out.push(chars.slice(index, index + 2).join(''));
    return out;
  }, []);
  if (!chunks.length) return 0;
  const matched = chunks.filter((chunk) => fields.some((field) => field.includes(chunk))).length;
  return matched ? Math.round((matched / chunks.length) * 70) : 0;
}

function usageStats(recordset = []) {
  return new Map((recordset || []).map((row) => [
    Number(row.UsageKey),
    {
      usageCount: Number(row.UsageCount || 0),
      recentUsageCount: Number(row.RecentUsageCount || 0),
    },
  ]).filter(([key]) => key > 0));
}

function usageRank(usageByKey, key) {
  const value = usageByKey?.get(Number(key));
  if (!value) return 0;
  return Number(value.usageCount || 0) + Number(value.recentUsageCount || 0) * 2;
}

function loadProductMappingStats() {
  return buildProductMappingStats(loadMappings());
}

async function loadLookupUsageStats() {
  if (lookupUsageCache && lookupUsageCache.expiresAt > Date.now()) return lookupUsageCache;
  if (lookupUsagePromise) return lookupUsagePromise;
  lookupUsagePromise = Promise.all([
    query(
      `SELECT CustKey AS UsageKey,
              COUNT_BIG(*) AS UsageCount,
              SUM(CASE WHEN OrderDtm >= DATEADD(year,-2,GETDATE()) THEN 1 ELSE 0 END) AS RecentUsageCount
         FROM OrderMaster
        WHERE ISNULL(isDeleted,0)=0 AND CustKey IS NOT NULL
        GROUP BY CustKey`,
      {},
    ),
    query(
      `SELECT od.ProdKey AS UsageKey,
              COUNT_BIG(*) AS UsageCount,
              SUM(CASE WHEN om.OrderDtm >= DATEADD(year,-2,GETDATE()) THEN 1 ELSE 0 END) AS RecentUsageCount
         FROM OrderDetail od
         LEFT JOIN OrderMaster om ON om.OrderMasterKey=od.OrderMasterKey
        WHERE ISNULL(od.isDeleted,0)=0 AND od.ProdKey IS NOT NULL
        GROUP BY od.ProdKey`,
      {},
    ),
  ]).then(([customers, products]) => {
    lookupUsageCache = {
      expiresAt: Date.now() + 60_000,
      customerUsage: usageStats(customers.recordset),
      productUsage: usageStats(products.recordset),
    };
    lookupUsagePromise = null;
    return lookupUsageCache;
  }).catch((error) => {
    lookupUsagePromise = null;
    throw error;
  });
  return lookupUsagePromise;
}

function rankCustomerLookup(input, customers, limit = 20, usageByCustKey = null) {
  return (customers || [])
    .map((customer) => ({
      customer,
      score: scoreCustomerLookup(input, customer),
      usageRank: usageRank(usageByCustKey, customer.CustKey),
      usageCount: Number(usageByCustKey?.get(Number(customer.CustKey))?.usageCount || 0),
      recentUsageCount: Number(usageByCustKey?.get(Number(customer.CustKey))?.recentUsageCount || 0),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score
      || b.usageRank - a.usageRank
      || b.usageCount - a.usageCount
      || String(a.customer.CustName).localeCompare(String(b.customer.CustName), 'ko'))
    .slice(0, limit)
    .map(({ customer, score, usageCount, recentUsageCount }) => ({
      ...customer,
      MatchScore: score,
      UsageCount: usageCount,
      RecentUsageCount: recentUsageCount,
    }));
}

function splitLookupTerms(value) {
  return [...new Set(String(value || '').trim().split(/\s+/).map((item) => item.trim()).filter(Boolean))].slice(0, 8);
}

function productLookupWhere(keyword) {
  const fields = ['p.ProdName', 'p.DisplayName', 'p.FlowerName', 'p.CounName', 'p.CountryFlower', 'p.ProdCode'];
  const terms = splitLookupTerms(keyword);
  if (!terms.length) return { where: '@q=N\'\'', params: { q: { type: sql.NVarChar, value: '' } } };
  const params = {};
  const clauses = terms.map((term, index) => {
    const name = `like${index}`;
    params[name] = { type: sql.NVarChar, value: `%${term}%` };
    return `(${fields.map((field) => `${field} LIKE @${name}`).join(' OR ')})`;
  });
  params.q = { type: sql.NVarChar, value: String(keyword || '').trim() };
  return { where: clauses.join(' AND '), params };
}

/**
 * 거래처는 붙여넣기 주문등록에서 사용자가 명시적으로 저장한 Customer 매핑과
 * DB 자연어 점수순을 사용한다. 품목은 같은 후보 엔진으로 한글/영문/자모/오타
 * 후보를 정렬하되, 잘못된 자동 확정을 막기 위해 사용자가 Product DB 후보를
 * 선택한 경우에만 ProdKey를 부여한다. 기존 선택값(ProdKey)은 저장된 원장
 * 재편집/재매칭 시 보존한다.
 */
export function matchSalesDefectRows(rows, {
  customers = [],
  products = [],
  farms = [],
  allProducts = products,
  productByKey = new Map((allProducts || []).map((item) => [Number(item.ProdKey), item])),
  customerUsage = null,
  productUsage = null,
  mappingByProdKey = null,
} = {}) {
  return (rows || []).map((raw, index) => {
    const row = normalizeDeductionRow({ ...raw, sourceUnit: raw.sourceUnit || raw.unit });
    const customer = resolveImportCustomer(row.customerName, customers, {
      inputCustKey: row.custKey,
      usageByCustKey: customerUsage,
    });
    const farm = farms.find((f) => normalizeSearch(f.FarmName) === normalizeSearch(row.farmName));
    const selectedProduct = row.prodKey ? productByKey.get(Number(row.prodKey)) || null : null;
    const resolvedProdKey = selectedProduct ? Number(selectedProduct.ProdKey) : null;
    const productSuggestions = resolvedProdKey ? [] : buildProductSuggestions(
      `${row.productName || ''} ${row.colorName || ''}`.trim(),
      allProducts,
      { limit: 6, minScore: 35, usageByProdKey: productUsage, mappingByProdKey },
    );
    return {
      ...row,
      rowNo: raw.sourceRowNo || raw.rowNo || index + 1,
      custKey: row.custKey || customer.custKey,
      customerName: row.customerName || customer.customerName,
      matchedCustomerName: customer.custKey ? customer.customerName : '',
      prodKey: resolvedProdKey,
      productName: row.productName,
      matchedProductName: resolvedProdKey ? (selectedProduct.DisplayName || selectedProduct.ProdName || '') : '',
      matchedProductDbName: resolvedProdKey ? (selectedProduct.ProdName || '') : '',
      countryName: resolvedProdKey ? (selectedProduct.CounName || '') : (row.countryName || raw.countryName || ''),
      matchedFlowerName: resolvedProdKey ? (selectedProduct.FlowerName || '') : (row.matchedFlowerName || ''),
      unit: resolvedProdKey ? (selectedProduct.EstUnit || selectedProduct.OutUnit || row.sourceUnit || '') : (row.sourceUnit || ''),
      farmKey: row.farmKey || (farm ? Number(farm.FarmKey) || null : null),
      farmName: row.farmName || (farm?.FarmName || ''),
      customerConfidence: customer.confidence,
      customerConfidenceLabel: customer.confidenceLabel,
      productConfidence: resolvedProdKey ? 1 : 0,
      productConfidenceLabel: resolvedProdKey ? 'manual' : 'none',
      customerFromMapping: customer.fromMapping,
      customerMappingKey: customer.mappingKey,
      customerSuggestions: customer.suggestions,
      productSuggestions,
      unitSource: resolvedProdKey ? 'manual-db-selection' : '',
      unitMatchType: resolvedProdKey ? 'manual' : '',
      mappingMatchType: null,
      mappingMatchKey: null,
      fromMapping: false,
      fallbackSuspect: false,
      ambiguityReason: null,
      needsReview: !customer.custKey || !resolvedProdKey || !row.quantity,
    };
  });
}

export async function loadLookupData({ q = '', kind = '' } = {}) {
  const keyword = text(q, 100);
  const like = `%${keyword}%`;
  const usage = (kind === 'customer' || kind === 'product')
    ? await loadLookupUsageStats()
    : { customerUsage: new Map(), productUsage: new Map() };
  if (kind === 'customer') {
    const r = await query(
      `SELECT TOP 500 CustKey, CustCode, CustName, CustArea, OrderCode, Manager
         FROM Customer
        WHERE ISNULL(isDeleted,0)=0
          AND (@q='' OR CustName LIKE @like OR CustCode LIKE @like OR OrderCode LIKE @like)
        ORDER BY CustName`,
      { q: { type: sql.NVarChar, value: keyword }, like: { type: sql.NVarChar, value: like } },
    );
    if (r.recordset.length > 0 || !keyword) {
      return { customers: keyword ? rankCustomerLookup(keyword, r.recordset, 80, usage.customerUsage) : r.recordset };
    }
    const all = await query(
      `SELECT TOP 1000 CustKey, CustCode, CustName, CustArea, OrderCode, Manager
         FROM Customer
        WHERE ISNULL(isDeleted,0)=0
        ORDER BY CustName`,
      {},
    );
    return { customers: rankCustomerLookup(keyword, all.recordset, 80, usage.customerUsage) };
  }
  if (kind === 'product') {
    const lookup = productLookupWhere(keyword);
    const r = await query(
      `SELECT TOP 500 p.ProdKey, p.ProdCode, p.ProdName, p.DisplayName,
              p.FlowerName, p.CounName, p.CountryFlower, p.OutUnit, p.EstUnit
         FROM Product p
        WHERE ISNULL(p.isDeleted,0)=0
          AND (${lookup.where})
        ORDER BY p.CounName, p.FlowerName, p.ProdName`,
      lookup.params,
    );
    // 한글 별칭은 Product.ProdName에 저장되지 않은 경우가 많다.
    // 예: DB의 "CARNATION Moon Light"를 "문라이트"로 검색하면 SQL 원문
    // 후보(중국 문라이트)만 남기지 말고 전체 Product를 번역/사용량 기준으로
    // 재평가해야 실제 빈출 콜롬비아 품목이 검색된다.
    const needsGeneratedAliasSearch = /[\uac00-\ud7a3ㄱ-ㅎ]/.test(keyword);
    if ((r.recordset.length > 0 || !keyword) && !needsGeneratedAliasSearch) {
      if (!keyword) return { products: r.recordset };
      const suggestions = buildProductSuggestions(keyword, r.recordset, {
        limit: 40,
        minScore: 20,
        usageByProdKey: usage.productUsage,
        mappingByProdKey: loadProductMappingStats(),
      });
      const byKey = new Map(r.recordset.map((item) => [Number(item.ProdKey), item]));
      const ranked = suggestions.map((suggestion) => ({
        ...byKey.get(Number(suggestion.prodKey)),
        MatchScore: suggestion.score,
        UsageCount: suggestion.usageCount,
        RecentUsageCount: suggestion.recentUsageCount,
        MappingCount: suggestion.mappingCount,
        SuggestedDisplayName: suggestion.suggestedDisplayName,
      })).filter((item) => item.ProdKey);
      return { products: ranked.length ? ranked : r.recordset };
    }
    const all = await query(
      `SELECT p.ProdKey, p.ProdCode, p.ProdName, p.DisplayName,
              p.FlowerName, p.CounName, p.CountryFlower, p.OutUnit, p.EstUnit
         FROM Product p
        WHERE ISNULL(p.isDeleted,0)=0
        ORDER BY p.CounName, p.FlowerName, p.ProdName`,
      {},
    );
    const byKey = new Map(all.recordset.map((item) => [Number(item.ProdKey), item]));
    const suggestions = buildProductSuggestions(keyword, all.recordset, {
      limit: 20,
      minScore: 35,
      usageByProdKey: usage.productUsage,
      mappingByProdKey: loadProductMappingStats(),
    });
    return {
      products: suggestions.map((suggestion) => ({
        ...byKey.get(Number(suggestion.prodKey)),
        MatchScore: suggestion.score,
        UsageCount: suggestion.usageCount,
        RecentUsageCount: suggestion.recentUsageCount,
        MappingCount: suggestion.mappingCount,
        SuggestedDisplayName: suggestion.suggestedDisplayName,
      })).filter((item) => item.ProdKey),
    };
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
  const [customerResult, productResult, farmResult, usage] = await Promise.all([
    query(`SELECT CustKey, CustCode, CustName, CustArea, OrderCode FROM Customer WHERE ISNULL(isDeleted,0)=0 ORDER BY CustName`, {}),
    query(`SELECT ProdKey, ProdCode, ProdName, DisplayName, FlowerName, CounName, CountryFlower, OutUnit, EstUnit
             FROM Product WHERE ISNULL(isDeleted,0)=0 ORDER BY CounName, FlowerName, ProdName`, {}),
    query(`SELECT TOP 500 ISNULL(f.FarmKey,0) AS FarmKey, v.FarmName
             FROM (SELECT DISTINCT FarmName FROM ViewWarehouse WHERE NULLIF(FarmName,N'') IS NOT NULL) v
             LEFT JOIN Farm f ON f.FarmName=v.FarmName AND ISNULL(f.isDeleted,0)=0
            ORDER BY v.FarmName`, {}),
    loadLookupUsageStats(),
  ]);
  const products = productResult.recordset || [];
  return {
    customers: customerResult.recordset || [],
    products,
    allProducts: products,
    productByKey: new Map(products.map((item) => [Number(item.ProdKey), item])),
    mappingByProdKey: loadProductMappingStats(),
    farms: farmResult.recordset || [],
    customerUsage: usage.customerUsage,
    productUsage: usage.productUsage,
  };
}

export async function resolveEstimateContext({ year, week, custKey, prodKey }, q = query) {
  const scope = previousParentScope(year, week);
  const target = await q(
    `SELECT TOP 1 sm.ShipmentKey, sm.OrderWeek, sd.ShipmentDtm, ISNULL(sm.isFix,0) AS isFix
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd
         ON sd.ShipmentKey=sm.ShipmentKey
        AND sd.CustKey=sm.CustKey
        AND sd.ProdKey=@pk
      WHERE sm.OrderYear=@yr AND sm.CustKey=@ck
        AND sm.OrderWeek LIKE @prefix AND ISNULL(sm.isDeleted,0)=0
      ORDER BY TRY_CONVERT(INT, RIGHT(sm.OrderWeek,2)), sm.ShipmentKey, sd.SdetailKey`,
    {
      yr: { type: sql.Int, value: Number(year) },
      ck: { type: sql.Int, value: Number(custKey) },
      pk: { type: sql.Int, value: Number(prodKey) },
      prefix: { type: sql.NVarChar, value: `${String(week).padStart(2, '0')}-%` },
    },
  );
  // 같은 연도 이전 차수의 값이 없거나 0이면, 이전 연도까지 포함한 가장 최근 유효 단가를 사용한다.
  // 단, 현재 대상의 직전 부모 차수(예: 29차 → 28차)를 먼저 선택하고,
  // 그 차수에 값이 없을 때만 27차·26차 등의 과거 차수로 내려간다.
  const previous = await q(
    `SELECT TOP 1
            COALESCE(NULLIF(sdd.Cost,0), NULLIF(sd.Cost,0), 0) AS Cost,
            CASE WHEN NULLIF(sdd.Cost,0) IS NOT NULL THEN N'ShipmentDate.Cost'
                 WHEN NULLIF(sd.Cost,0) IS NOT NULL THEN N'ShipmentDetail.Cost'
                 ELSE N'' END AS CostSource,
            sm.OrderYear AS SourceOrderYear,
            sm.OrderWeek AS SourceOrderWeek, sm.ShipmentKey AS SourceShipmentKey
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey AND sd.ProdKey=@pk
       LEFT JOIN ShipmentDate sdd ON sdd.SdetailKey=sd.SdetailKey
      WHERE sm.CustKey=@ck AND ISNULL(sm.isDeleted,0)=0
        AND (
          sm.OrderYear < @scopeYear
          OR (
            sm.OrderYear = @scopeYear
            AND TRY_CONVERT(INT, LEFT(sm.OrderWeek, CHARINDEX(N'-', sm.OrderWeek + N'-') - 1)) <= @scopeWeek
          )
        )
        AND COALESCE(NULLIF(sdd.Cost,0), NULLIF(sd.Cost,0), 0) > 0
      ORDER BY
        CASE WHEN sm.OrderYear=@scopeYear
                  AND TRY_CONVERT(INT, LEFT(sm.OrderWeek, CHARINDEX(N'-', sm.OrderWeek + N'-') - 1))=@scopeWeek
             THEN 0 ELSE 1 END,
        sm.OrderYear DESC,
        TRY_CONVERT(INT, LEFT(sm.OrderWeek, CHARINDEX(N'-', sm.OrderWeek + N'-') - 1)) DESC,
        CASE WHEN NULLIF(sdd.Cost,0) IS NULL THEN 1 ELSE 0 END,
        ISNULL(sdd.SdateKey,0) DESC, sd.SdetailKey DESC`,
    {
      ck: { type: sql.Int, value: Number(custKey) },
      pk: { type: sql.Int, value: Number(prodKey) },
      scopeYear: { type: sql.Int, value: scope.year },
      scopeWeek: { type: sql.Int, value: scope.week },
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
  const manager = deductionManagerIdentity(row);
  return {
    deductionKey: Number(row.DeductionKey || row.deductionKey || 0),
    orderYear: Number(row.OrderYear || row.orderYear || 0),
    orderWeek: String(row.OrderWeek || row.orderWeek || ''),
    custKey: row.CustKey == null ? null : Number(row.CustKey),
    customerName: row.CurrentCustName ?? row.CustName ?? row.customerName ?? '',
    customerAlias: row.CurrentCustomerDescr ?? row.CustomerAlias ?? row.customerAlias ?? '',
    matchedCustomerName: row.MatchedCustomerName ?? row.CurrentCustName ?? row.CustName ?? '',
    prodKey: row.ProdKey == null ? null : Number(row.ProdKey),
    productName: row.CurrentFlowerName ?? row.ProdName ?? row.productName ?? '',
    matchedProductName: row.MatchedProductName ?? row.CurrentDisplayName ?? row.CurrentProdName ?? row.ProdName ?? '',
    matchedProductDbName: row.MatchedProductDbName ?? row.CurrentProdName ?? row.ProdName ?? '',
    // 국가 표시는 반드시 Product.CounName을 사용한다. CountryFlower는
    // "콜롬비아카네이션"처럼 국가+품종 합성값이어서 국가 칸에 그대로 쓰면
    // 중국/콜롬비아 품목을 잘못 묶을 수 있다.
    countryName: row.CountryName ?? row.CurrentCounName ?? row.CounName ?? '',
    matchedFlowerName: row.MatchedFlowerName ?? row.CurrentFlowerName ?? row.FlowerName ?? '',
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
    importConfirmed: Boolean(row.ImportConfirmed ?? row.importConfirmed),
    importConfirmedBy: row.ImportConfirmedBy ?? row.importConfirmedBy ?? '',
    importConfirmedByName: row.ImportConfirmedByName ?? row.importConfirmedByName ?? '',
    importConfirmedAt: row.ImportConfirmedAt || row.importConfirmedAt || null,
    importReviewRequired: Boolean(row.ImportReviewRequired ?? row.importReviewRequired),
    managerId: manager.id,
    managerName: manager.name,
    needsReview: !(Number(row.CustKey || row.custKey) > 0)
      || !(Number(row.ProdKey || row.prodKey) > 0)
      || !(Number(row.Quantity || row.quantity) > 0),
    isDeleted: Boolean(row.IsDeleted ?? row.isDeleted),
  };
}

async function loadManagerOptions() {
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
  // 기존에는 ManagerId만 키로 사용해 같은 이름이 다른 ID로 중복 노출됐다.
  // 화면의 담당자 선택은 표시명 단위이므로 동일 정규화 이름은 하나로 합친다.
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

function changeSummary(before, after, action) {
  const productMatchLabel = (row) => [
    row?.countryName,
    row?.matchedFlowerName || row?.productName,
    row?.matchedProductDbName || row?.matchedProductName,
  ].filter(Boolean).join(' ') || '-';
  if (!before) {
    const created = [`${action}: 신규 행 ${after.customerName || '(거래처 미매칭)'} / ${after.productName || '(품목 미매칭)'} ${after.quantity || 0}${after.sourceUnit || ''}`];
    if (after.custKey) created.push(`거래처 매칭 ${after.customerName || '-'} (#${after.custKey})`);
    if (after.prodKey) {
      created.push(`품목 매칭 ${productMatchLabel(after)} (#${after.prodKey})`);
      if (after.matchedProductDbName) created.push(`전산 품명 ${after.matchedProductDbName}`);
    }
    return created.join(', ');
  }
  const changes = [];
  if (before.customerName !== after.customerName || Number(before.custKey || 0) !== Number(after.custKey || 0)) {
    changes.push(`거래처 매칭 ${before.customerName || '-'} (#${before.custKey || '-'} ) → ${after.customerName || '-'} (#${after.custKey || '-'} )`);
  }
  if (before.productName !== after.productName || Number(before.prodKey || 0) !== Number(after.prodKey || 0)) {
    changes.push(`품목 매칭 ${productMatchLabel(before)} (#${before.prodKey || '-'} ) → ${productMatchLabel(after)} (#${after.prodKey || '-'} )`);
  }
  if (before.colorName !== after.colorName) changes.push(`품명 ${before.colorName || '-'} → ${after.colorName || '-'}`);
  if (Number(before.quantity || 0) !== Number(after.quantity || 0)) changes.push(`수량 ${before.quantity || 0} → ${after.quantity || 0}`);
  if (before.creditApplied !== after.creditApplied) changes.push(`크레딧 ${before.creditApplied ? '체크' : '미체크'} → ${after.creditApplied ? '체크' : '미체크'}`);
  if (before.farmName !== after.farmName) changes.push(`농장 ${before.farmName || '-'} → ${after.farmName || '-'}`);
  if (before.note !== after.note) changes.push('비고 변경');
  if (before.importReviewRequired !== after.importReviewRequired) changes.push(`보완 필요 ${after.importReviewRequired ? '체크' : '해제'}`);
  if (before.importConfirmed !== after.importConfirmed) changes.push(`수입부 확정 ${after.importConfirmed ? '확정' : '재확인 필요'}`);
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

/** 저장 직후에도 입력 원문이 아니라 현재 Customer/Product/Farm 기준명을 반환한다. */
async function getStoredSnapshot(q, key, { lock = false } = {}) {
  const result = await q(
    `SELECT d.*,
            c.CustName AS CurrentCustName,
            c.Descr AS CurrentCustomerDescr,
            p.ProdName AS CurrentProdName,
            p.DisplayName AS CurrentDisplayName,
            p.FlowerName AS CurrentFlowerName,
            p.CounName AS CurrentCounName,
            p.CountryFlower AS CurrentCountryFlower,
            p.EstUnit AS CurrentEstUnit,
            f.FarmName AS CurrentFarmName
       FROM WebSalesDefectDeduction d ${lock ? 'WITH (UPDLOCK,HOLDLOCK)' : ''}
       LEFT JOIN Customer c ON c.CustKey=d.CustKey
       LEFT JOIN Product p ON p.ProdKey=d.ProdKey
       LEFT JOIN Farm f ON f.FarmKey=d.FarmKey
      WHERE d.DeductionKey=@key`,
    { key: { type: sql.Int, value: Number(key) } },
  );
  return result.recordset[0] ? snapshot(result.recordset[0]) : null;
}

function hasMatchingChange(before, after) {
  if (!before || !after) return false;
  return Number(before.custKey || 0) !== Number(after.custKey || 0)
    || Number(before.prodKey || 0) !== Number(after.prodKey || 0);
}

function rowParams(row, { year, week, user, owner = null, sourceFileName = '' } = {}) {
  const item = normalizeDeductionRow(row);
  const ownerId = text(owner?.id || user?.userId || user?.userName, 100);
  const ownerName = text(owner?.name || user?.userName || ownerId, 100);
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
    reviewRequired: { type: sql.Bit, value: item.importReviewRequired },
    dtype: { type: sql.NVarChar, value: item.deductionType || '불량차감' },
    file: { type: sql.NVarChar, value: text(sourceFileName || item.sourceFileName, 300) },
    owner: { type: sql.NVarChar, value: ownerId },
    ownerName: { type: sql.NVarChar, value: ownerName },
    by: { type: sql.NVarChar, value: text(user?.userId, 100) },
    byName: { type: sql.NVarChar, value: text(user?.userName, 100) },
  };
}

export async function listDeductions({ year, week, manager = '', includeDeleted = false, history = false } = {}) {
  await ensureSalesDefectTables();
  const managerFilter = text(manager, 100);
  const params = {
    year: { type: sql.Int, value: Number(year) },
    week: { type: sql.NVarChar, value: String(Number(week)) },
    manager: { type: sql.NVarChar, value: managerFilter },
  };
  const where = `d.OrderYear=@year AND d.OrderWeek=@week
                ${includeDeleted ? '' : 'AND d.IsDeleted=0'}
                AND (@manager=N'' OR d.CreatedBy=@manager OR d.CreatedByName=@manager
                     OR d.UpdatedBy=@manager OR d.UpdatedByName=@manager)`;
  const rows = await query(
    `SELECT d.*,
            c.CustName AS CurrentCustName,
            c.Descr AS CurrentCustomerDescr,
            p.ProdName AS CurrentProdName,
            p.DisplayName AS CurrentDisplayName,
            p.FlowerName AS CurrentFlowerName,
            p.CounName AS CurrentCounName,
            p.CountryFlower AS CurrentCountryFlower,
            p.EstUnit AS CurrentEstUnit,
            f.FarmName AS CurrentFarmName
       FROM WebSalesDefectDeduction d
       LEFT JOIN Customer c ON c.CustKey=d.CustKey
       LEFT JOIN Product p ON p.ProdKey=d.ProdKey
       LEFT JOIN Farm f ON f.FarmKey=d.FarmKey
      WHERE ${where}
      ORDER BY d.DeductionKey`, params,
  );
  const managerOptions = await loadManagerOptions();
  const result = {
    rows: rows.recordset.map(snapshot),
    managerOptions,
  };
  if (history) {
    const hr = await query(
      `SELECT TOP 1000 h.*, d.OrderYear, d.OrderWeek
         FROM WebSalesDefectDeductionHistory h
         LEFT JOIN WebSalesDefectDeduction d ON d.DeductionKey=h.DeductionKey
        WHERE d.OrderYear=@year AND d.OrderWeek=@week
           AND (@manager=N'' OR d.CreatedBy=@manager OR d.CreatedByName=@manager
                OR d.UpdatedBy=@manager OR d.UpdatedByName=@manager)
        ORDER BY h.ChangedAt DESC, h.HistoryKey DESC`, params,
    );
    result.history = hr.recordset;
  }
  return result;
}

export async function saveDraftRows({ year, week, rows, user, managerId = '', managerName = '', sourceFileName = '' } = {}) {
  await ensureSalesDefectTables();
  const y = normalizeYear(year);
  const w = normalizeParentWeek(week);
  if (!y || !w) throw new Error('연도와 차수를 확인하세요.');
  if (!Array.isArray(rows) || rows.length > 500) throw new Error('저장 행은 1~500건까지 가능합니다.');
  const owner = {
    id: text(managerId, 100) || text(user?.userId || user?.userName, 100),
    name: text(managerName, 100) || text(user?.userName || managerId || user?.userId, 100),
  };
  const saved = [];
  await withTransaction(async (tQuery) => {
    for (const raw of rows) {
      const item = normalizeDeductionRow(raw);
      if (!item.customerName && !item.productName && !item.quantity) continue;
      if (item.quantity <= 0) throw new Error(`${item.customerName || '(거래처 미입력)'} 행의 차감수량을 입력하세요.`);
      const params = rowParams(item, { year: y, week: w, user, owner, sourceFileName });
      let before = null;
      let key = item.deductionKey;
      if (key) {
        const old = await tQuery(`SELECT * FROM WebSalesDefectDeduction WITH (UPDLOCK,HOLDLOCK) WHERE DeductionKey=@key`, { key: { type: sql.Int, value: key } });
        if (!old.recordset[0] || Number(old.recordset[0].IsDeleted) === 1) throw new Error(`차감 행 ${key}를 찾을 수 없습니다.`);
        if (Number(old.recordset[0].OrderYear) !== y || String(old.recordset[0].OrderWeek) !== String(w)) {
          throw new Error(`차감 행 ${key}는 선택한 ${y}년 ${w}차 원장이 아닙니다.`);
        }
        before = await getStoredSnapshot(tQuery, key, { lock: true });
        const importReset = before && (
          before.creditApplied !== item.creditApplied
          || before.farmName !== item.farmName
          || before.note !== item.note
        );
        await tQuery(
          `UPDATE WebSalesDefectDeduction
              SET OrderYear=@year, OrderWeek=@week, CustKey=@ck, CustName=@cn,
                  ProdKey=@pk, ProdName=@pn, ColorName=@color, Quantity=@qty,
                  SourceUnit=@unit, CreditApplied=@credit, FarmKey=@fk, FarmName=@fn,
                  Note=@note, ImportReviewRequired=CASE WHEN ImportReviewRequired=1 THEN 1 ELSE @reviewRequired END,
                  DeductionType=@dtype, SourceFileName=@file,
                  ImportConfirmed=CASE WHEN @importReset=1 THEN 0 ELSE ImportConfirmed END,
                  ImportConfirmedBy=CASE WHEN @importReset=1 THEN N'' ELSE ImportConfirmedBy END,
                  ImportConfirmedByName=CASE WHEN @importReset=1 THEN N'' ELSE ImportConfirmedByName END,
                  ImportConfirmedAt=CASE WHEN @importReset=1 THEN NULL ELSE ImportConfirmedAt END,
                  UpdatedBy=@by, UpdatedByName=@byName, UpdatedAt=GETDATE(),
                  RowVersionNo=RowVersionNo+1
            WHERE DeductionKey=@key`, {
            ...params,
            importReset: { type: sql.Bit, value: Boolean(importReset) },
            key: { type: sql.Int, value: key },
          },
        );
      } else {
        const inserted = await tQuery(
          `INSERT INTO WebSalesDefectDeduction
             (OrderYear,OrderWeek,CustKey,CustName,ProdKey,ProdName,ColorName,Quantity,SourceUnit,
              CreditApplied,FarmKey,FarmName,Note,DeductionType,SourceFileName,CreatedBy,CreatedByName,
              UpdatedBy,UpdatedByName)
           OUTPUT INSERTED.DeductionKey
           VALUES (@year,@week,@ck,@cn,@pk,@pn,@color,@qty,@unit,@credit,@fk,@fn,@note,@dtype,@file,@owner,@ownerName,@by,@byName)`, params,
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
      const after = await getStoredSnapshot(tQuery, key);
      if (!after) throw new Error(`저장된 차감 행 ${key}를 다시 읽을 수 없습니다.`);
      const action = before ? (hasMatchingChange(before, after) ? 'MATCH' : 'UPDATE') : 'CREATE';
      await writeHistory(tQuery, { key, action, user, before, after });
      saved.push(after);
    }
  });
  return saved;
}

/**
 * 수입부 확인은 영업 원장의 농장/크레딧 상태만 확정한다.
 * 견적서(Estimate), 주문·출고·재고 테이블은 절대 갱신하지 않는다.
 */
export async function confirmIncomingDeductions({ year, week, rows, user } = {}) {
  await ensureSalesDefectTables();
  const y = normalizeYear(year);
  const w = normalizeParentWeek(week);
  if (!y || !w) throw new Error('연도와 차수를 확인하세요.');
  if (!Array.isArray(rows) || rows.length > 500) throw new Error('수입부 확인 행은 1~500건까지 가능합니다.');
  const keys = [...new Set(rows.map((row) => Number(row?.deductionKey)).filter((key) => key > 0))];
  if (!keys.length) throw new Error('수입부 확인 대상 저장행이 없습니다. 영업부 저장을 먼저 확인하세요.');
  const confirmed = [];
  await withTransaction(async (tQuery) => {
    for (const key of keys) {
      const old = await tQuery(
        `SELECT * FROM WebSalesDefectDeduction WITH (UPDLOCK,HOLDLOCK) WHERE DeductionKey=@key`,
        { key: { type: sql.Int, value: key } },
      );
      const dbRow = old.recordset[0];
      if (!dbRow || Number(dbRow.IsDeleted) === 1) throw new Error(`차감 행 ${key}를 찾을 수 없습니다.`);
      if (Number(dbRow.OrderYear) !== y || String(dbRow.OrderWeek) !== String(w)) {
        throw new Error(`차감 행 ${key}는 선택한 ${y}년 ${w}차 원장이 아닙니다.`);
      }
      const input = rows.find((row) => Number(row?.deductionKey) === key) || {};
      const farmKey = Number(input.farmKey || 0);
      if (!(farmKey > 0)) {
        throw new Error(`${dbRow.CustName || '거래처'} / ${dbRow.ColorName || dbRow.ProdName || '품목'} 행의 농장을 선택하세요.`);
      }
      let farm = farmKey > 0 ? await tQuery(
        `SELECT TOP 1 FarmKey, FarmName
           FROM Farm
          WHERE FarmKey=@farmKey AND ISNULL(isDeleted,0)=0`,
        { farmKey: { type: sql.Int, value: farmKey } },
      ) : { recordset: [] };
      // ViewWarehouse에만 등록되고 Farm 마스터 키가 없는 입고농장도
      // 기존 원장에서는 FarmName으로 선택할 수 있으므로 이름을 검증해 허용한다.
      if (!farm.recordset[0]) {
        farm = await tQuery(
          `SELECT TOP 1 NULL AS FarmKey, FarmName
             FROM ViewWarehouse
            WHERE NULLIF(FarmName,N'') IS NOT NULL AND FarmName=@farmName`,
          { farmName: { type: sql.NVarChar, value: text(input.farmName, 200) } },
        );
      }
      if (!farm.recordset[0]) throw new Error(`선택한 농장(${input.farmName || farmKey})을 입고농장 목록에서 찾을 수 없습니다.`);
      const before = await getStoredSnapshot(tQuery, key, { lock: true });
      await tQuery(
        `UPDATE WebSalesDefectDeduction
            SET CreditApplied=@credit, FarmKey=@farmKey, FarmName=@farmName,
                Note=@note, ImportReviewRequired=@reviewRequired,
                ImportConfirmed=1, ImportConfirmedBy=@by, ImportConfirmedByName=@byName,
                ImportConfirmedAt=GETDATE(), UpdatedBy=@by, UpdatedByName=@byName,
                UpdatedAt=GETDATE(), RowVersionNo=RowVersionNo+1
          WHERE DeductionKey=@key`,
        {
          credit: { type: sql.Bit, value: Boolean(input.creditApplied) },
          farmKey: { type: sql.Int, value: farm.recordset[0].FarmKey ? Number(farm.recordset[0].FarmKey) : null },
          farmName: { type: sql.NVarChar, value: text(farm.recordset[0].FarmName, 200) },
          note: { type: sql.NVarChar, value: text(input.note == null ? dbRow.Note : input.note, 1000) },
          // 구버전 화면·오래 열린 화면이 필드를 보내지 않아도 기존 보완 상태를 유지한다.
          reviewRequired: { type: sql.Bit, value: input.importReviewRequired == null ? Boolean(dbRow.ImportReviewRequired) : Boolean(input.importReviewRequired) },
          by: { type: sql.NVarChar, value: text(user?.userId || user?.userName, 100) },
          byName: { type: sql.NVarChar, value: text(user?.userName || user?.userId, 100) },
          key: { type: sql.Int, value: key },
        },
      );
      const after = await getStoredSnapshot(tQuery, key);
      await writeHistory(tQuery, { key, action: 'INCOMING_CONFIRM', user, before, after });
      confirmed.push(after);
    }
  });
  return confirmed;
}

/**
 * 수입부가 표시한 보완 필요 상태를 영업담당자가 해결 완료 처리한다.
 * 보완 상태와 감사 이력만 변경하며, 수입부 확정·견적·주문·출고·재고 원장은 보존한다.
 */
export async function resolveIncomingReview({ year, week, deductionKey, user } = {}) {
  await ensureSalesDefectTables();
  const y = normalizeYear(year);
  const w = normalizeParentWeek(week);
  const key = Number(deductionKey);
  if (!y || !w) throw new Error('연도와 차수를 확인하세요.');
  if (!(key > 0)) throw new Error('보완 완료 처리할 저장 행이 없습니다.');
  let resolved = null;
  await withTransaction(async (tQuery) => {
    const old = await tQuery(
      `SELECT * FROM WebSalesDefectDeduction WITH (UPDLOCK,HOLDLOCK) WHERE DeductionKey=@key`,
      { key: { type: sql.Int, value: key } },
    );
    const dbRow = old.recordset[0];
    if (!dbRow || Number(dbRow.IsDeleted) === 1) throw new Error(`차감 행 ${key}를 찾을 수 없습니다.`);
    if (Number(dbRow.OrderYear) !== y || String(dbRow.OrderWeek) !== String(w)) {
      throw new Error(`차감 행 ${key}는 선택한 ${y}년 ${w}차 원장이 아닙니다.`);
    }
    const before = await getStoredSnapshot(tQuery, key, { lock: true });
    if (!before?.importReviewRequired) {
      resolved = before;
      return;
    }
    await tQuery(
      `UPDATE WebSalesDefectDeduction
          SET ImportReviewRequired=0,
              UpdatedBy=@by, UpdatedByName=@byName, UpdatedAt=GETDATE(),
              RowVersionNo=RowVersionNo+1
        WHERE DeductionKey=@key`,
      {
        by: { type: sql.NVarChar, value: text(user?.userId || user?.userName, 100) },
        byName: { type: sql.NVarChar, value: text(user?.userName || user?.userId, 100) },
        key: { type: sql.Int, value: key },
      },
    );
    resolved = await getStoredSnapshot(tQuery, key);
    await writeHistory(tQuery, { key, action: 'INCOMING_REVIEW_RESOLVE', user, before, after: resolved });
  });
  return resolved;
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

async function loadEstimatePreview(q, estimateKey) {
  if (!estimateKey) return null;
  const result = await q(
    `SELECT TOP 1 e.EstimateKey, e.EstimateType, e.EstimateDtm, e.ProdKey,
            e.Unit, e.Quantity, e.Cost, e.Amount, e.Vat, e.Descr, e.ShipmentKey,
            p.ProdName, p.DisplayName, p.FlowerName
       FROM Estimate e
       LEFT JOIN Product p ON p.ProdKey=e.ProdKey
      WHERE e.EstimateKey=@ek`,
    { ek: { type: sql.Int, value: Number(estimateKey) } },
  );
  return result.recordset[0] || null;
}

export async function registrationPreview({ year, week, ids, deductionType = '불량차감' } = {}) {
  const y = normalizeYear(year);
  const w = normalizeParentWeek(week);
  if (!y || !w) throw new Error('연도와 차수를 확인하세요.');
  const keys = [...new Set((ids || []).map((x) => Number(x)).filter((x) => x > 0))];
  if (!keys.length || keys.length > 500) throw new Error('검토할 행을 선택하세요.');
  const typeCode = await resolveEstimateTypeCode(deductionType);
  const output = [];
  for (const key of keys) {
    const dbRow = await getStoredRow(query, key);
    if (!dbRow || Number(dbRow.IsDeleted) === 1) {
      output.push({ deductionKey: key, error: `차감 행 ${key}를 찾을 수 없습니다.` });
      continue;
    }
    const item = normalizeDeductionRow(dbRow);
    const before = await loadEstimatePreview(query, dbRow.EstimateKey);
    const result = {
      deductionKey: key,
      customerName: item.customerName,
      productName: item.productName,
      colorName: item.colorName,
      quantity: Number(item.quantity || 0),
      sourceUnit: item.sourceUnit || item.unit || '',
      note: item.note || '',
      estimateKey: Number(dbRow.EstimateKey || 0) || null,
      before,
      after: null,
      error: '',
    };
    try {
      assertRegisterable(dbRow);
      const ctx = await resolveEstimateContext({ year: y, week: w, custKey: dbRow.CustKey, prodKey: dbRow.ProdKey });
      if (!ctx.shipmentKey) throw new Error(`${item.customerName || '거래처'} ${w}차 출고가 없어 견적서 등록 대상을 찾을 수 없습니다.`);
      if (!(ctx.cost > 0)) throw new Error(`${item.customerName || '거래처'} / ${item.productName || '품종'}의 ${previousParentScope(y, w).week}차 분배 단가가 없습니다.`);
      const quantity = -Math.abs(Number(item.quantity) || 0);
      const cost = Number(ctx.cost) || 0;
      const amount = Math.round(quantity * cost / 1.1);
      const vat = quantity * cost - amount;
      result.after = {
        EstimateKey: result.estimateKey,
        EstimateType: typeCode,
        EstimateDtm: ctx.estimateDate || null,
        ProdKey: Number(dbRow.ProdKey),
        ProdName: item.productName,
        DisplayName: item.matchedProductName || '',
        FlowerName: item.productName,
        Unit: ctx.unit || item.sourceUnit || '단',
        Quantity: quantity,
        Cost: cost,
        Amount: amount,
        Vat: vat,
        Descr: item.note || '',
        ShipmentKey: Number(ctx.shipmentKey),
        CostSource: ctx.costSource,
        CostOrderWeek: ctx.costOrderWeek,
      };
    } catch (error) {
      result.error = error.message;
    }
    output.push(result);
  }
  return output;
}

export async function registerDeductions({ year, week, ids, deductionType = '불량차감', user, overrides = {} } = {}) {
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
      let dbRow = await getStoredRow(tQuery, key, true);
      if (!dbRow || Number(dbRow.IsDeleted) === 1) throw new Error(`차감 행 ${key}를 찾을 수 없습니다.`);
      if (Number(dbRow.OrderYear) !== y || String(dbRow.OrderWeek) !== String(w)) {
        throw new Error(`차감 행 ${key}는 선택한 ${y}년 ${w}차 원장이 아닙니다.`);
      }
      const override = overrides?.[String(key)] || overrides?.[key] || null;
      if (override && (override.quantity != null || override.note != null || override.sourceUnit != null)) {
        const quantity = Number(override.quantity ?? dbRow.Quantity);
        if (!(quantity > 0)) throw new Error(`차감 행 ${key}의 수량은 0보다 커야 합니다.`);
        const beforeReview = snapshot(dbRow);
        await tQuery(
          `UPDATE WebSalesDefectDeduction
              SET Quantity=@qty, Note=@note, SourceUnit=@unit,
                  UpdatedBy=@by, UpdatedByName=@name, UpdatedAt=GETDATE(), RowVersionNo=RowVersionNo+1
            WHERE DeductionKey=@key`,
          {
            qty: { type: sql.Decimal(18, 4), value: quantity },
            note: { type: sql.NVarChar, value: text(override.note ?? dbRow.Note, 1000) },
            unit: { type: sql.NVarChar, value: normalizeUnit(override.sourceUnit ?? dbRow.SourceUnit) },
            by: { type: sql.NVarChar, value: text(user?.userId, 100) },
            name: { type: sql.NVarChar, value: text(user?.userName, 100) },
            key: { type: sql.Int, value: key },
          },
        );
        dbRow = await getStoredRow(tQuery, key, true);
        await writeHistory(tQuery, { key, action: 'REVIEW_UPDATE', user, before: beforeReview, after: snapshot(dbRow) });
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
