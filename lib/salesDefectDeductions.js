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
import { scoreNaturalLanguageProducts } from './naturalLanguageProductMatching.js';
import {
  normalizeDeductionRow,
  deductionManagerIdentity,
  isEarlierOrSameScope,
  normalizeDefectUnit,
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
        AppliedOrderYear INT NULL,
        AppliedOrderWeek NVARCHAR(10) NULL,
        AppliedShipmentKey INT NULL,
        AppliedCostSourceYear INT NULL,
        AppliedCostSourceWeek NVARCHAR(10) NULL,
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
    IF COL_LENGTH(N'dbo.WebSalesDefectDeduction', N'AppliedOrderYear') IS NULL
      ALTER TABLE dbo.WebSalesDefectDeduction ADD AppliedOrderYear INT NULL;
    IF COL_LENGTH(N'dbo.WebSalesDefectDeduction', N'AppliedOrderWeek') IS NULL
      ALTER TABLE dbo.WebSalesDefectDeduction ADD AppliedOrderWeek NVARCHAR(10) NULL;
    IF COL_LENGTH(N'dbo.WebSalesDefectDeduction', N'AppliedShipmentKey') IS NULL
      ALTER TABLE dbo.WebSalesDefectDeduction ADD AppliedShipmentKey INT NULL;
    IF COL_LENGTH(N'dbo.WebSalesDefectDeduction', N'AppliedCostSourceYear') IS NULL
      ALTER TABLE dbo.WebSalesDefectDeduction ADD AppliedCostSourceYear INT NULL;
    IF COL_LENGTH(N'dbo.WebSalesDefectDeduction', N'AppliedCostSourceWeek') IS NULL
      ALTER TABLE dbo.WebSalesDefectDeduction ADD AppliedCostSourceWeek NVARCHAR(10) NULL;
    IF COL_LENGTH(N'dbo.WebSalesDefectDeduction', N'IsCarryoverLedger') IS NULL
      ALTER TABLE dbo.WebSalesDefectDeduction ADD IsCarryoverLedger BIT NOT NULL CONSTRAINT DF_WebSalesDefectDeduction_IsCarryoverLedger DEFAULT 0;
    IF COL_LENGTH(N'dbo.WebSalesDefectDeduction', N'OriginalQuantity') IS NULL
      ALTER TABLE dbo.WebSalesDefectDeduction ADD OriginalQuantity DECIMAL(18,4) NULL;
    IF COL_LENGTH(N'dbo.WebSalesDefectDeduction', N'RemainingQuantity') IS NULL
      ALTER TABLE dbo.WebSalesDefectDeduction ADD RemainingQuantity DECIMAL(18,4) NULL;
    IF OBJECT_ID(N'dbo.WebSalesCarryoverApplication', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.WebSalesCarryoverApplication (
        ApplicationKey BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        DeductionKey INT NOT NULL,
        EstimateKey INT NOT NULL,
        AppliedOrderYear INT NOT NULL,
        AppliedOrderWeek NVARCHAR(10) NOT NULL,
        AppliedShipmentKey INT NOT NULL,
        AppliedQuantity DECIMAL(18,4) NOT NULL,
        AppliedCost DECIMAL(18,4) NOT NULL,
        AppliedBy NVARCHAR(100) NOT NULL DEFAULT N'',
        AppliedByName NVARCHAR(100) NOT NULL DEFAULT N'',
        AppliedAt DATETIME NOT NULL DEFAULT GETDATE()
      );
      CREATE INDEX IX_WebSalesCarryoverApplication_Deduction
        ON dbo.WebSalesCarryoverApplication(DeductionKey, AppliedAt DESC);
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
      unit: resolvedProdKey ? (normalizeDefectUnit(selectedProduct.EstUnit || selectedProduct.OutUnit || row.sourceUnit) || row.sourceUnit || '') : (row.sourceUnit || ''),
      sourceUnit: normalizeDefectUnit(row.sourceUnit) || row.sourceUnit || '',
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
    const mappingStats = loadProductMappingStats();
    const enriched = all.recordset.map((item) => ({
      ...item,
      UsageCount: usage.productUsage.get(Number(item.ProdKey))?.usageCount || 0,
      RecentUsageCount: usage.productUsage.get(Number(item.ProdKey))?.recentUsageCount || 0,
      MappingCount: mappingStats.get(Number(item.ProdKey))?.count || 0,
    }));
    const result = scoreNaturalLanguageProducts(keyword, enriched, { limit: 40 });
    const toDto = (item, alternateCountry = false) => ({
      ...item.source, MatchScore: Math.round(item.score * 100), MatchConfidence: item.confidence,
      MatchConfidenceBand: item.band, MatchAutoSelectAllowed: item.autoSelect, MatchReasons: item.reasons,
      MatchConflicts: item.conflicts, MatchModelVersion: item.modelVersion, AlternateCountry: alternateCountry,
    });
    return {
      products: [...result.candidates.map((item) => toDto(item)), ...result.alternateCountry.map((item) => toDto(item, true))],
      productMatch: { emptyReason: result.emptyReason, normalized: result.query, modelVersion: result.modelVersion },
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
    `SELECT TOP 1
            vs.ShipmentKey, vs.OrderWeek, sdd.ShipmentDtm,
            ISNULL(vs.DetailFix,0) AS isFix, vs.SdetailKey
       FROM ViewShipment vs
       JOIN ViewOrder vo
         ON vs.OrderYearWeek2=vo.OrderYearWeek2
        AND vs.CustKey=vo.CustKey
        AND vs.ProdKey=vo.ProdKey
       JOIN ShipmentDate sdd ON vs.SdetailKey=sdd.SdetailKey
       JOIN PeriodDay pd ON sdd.ShipmentDtm=pd.BaseYmd
      WHERE vs.OrderYear=@yr AND vs.CustKey=@ck AND vs.ProdKey=@pk
        AND vs.OrderWeek LIKE @prefix
        AND ISNULL(vs.DetailFix,0)=1
        AND ISNULL(vs.EstQuantity,0)>0
        AND ISNULL(sdd.EstQuantity,0)>0
      ORDER BY TRY_CONVERT(INT, RIGHT(vs.OrderWeek,2)), vs.ShipmentKey, vs.SdetailKey`,
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
  const rawUnit = product.recordset[0]?.EstUnit || product.recordset[0]?.OutUnit || '';
  return {
    shipmentKey: targetRow?.ShipmentKey ? Number(targetRow.ShipmentKey) : null,
    shipmentOrderWeek: targetRow?.OrderWeek || '',
    estimateDate: targetRow?.ShipmentDtm || null,
    targetIsFix: Number(targetRow?.isFix || 0) === 1,
    cost: Number(previousRow?.Cost || 0),
    costSource: previousRow?.CostSource || '',
    costOrderWeek: previousRow?.SourceOrderWeek || `${scope.week}차`,
    costShipmentKey: previousRow?.SourceShipmentKey ? Number(previousRow.SourceShipmentKey) : null,
    unit: rawUnit,
    displayUnit: normalizeDefectUnit(rawUnit),
    costSourceYear: previousRow?.SourceOrderYear ? Number(previousRow.SourceOrderYear) : null,
    costSourceWeek: previousRow?.SourceOrderWeek || '',
  };
}

// 영업지원 전체 조회에서는 아직 Estimate가 생성되지 않은 행도 보인다.
// 이 경우에도 견적서 등록과 같은 EXE 호환 조회 경로로 분배단가를 미리 표시한다.
// 등록된 행은 실제 Estimate에 저장된 단가를 우선하여, 미리보기와 목록이 어긋나지 않게 한다.
async function enrichSupportDistributionCosts(rows, { year, week } = {}) {
  const pairs = [...new Map((rows || [])
    .filter((row) => Number(row.custKey || 0) > 0 && Number(row.prodKey || 0) > 0)
    .map((row) => {
      const custKey = Number(row.custKey);
      const prodKey = Number(row.prodKey);
      return [`${custKey}:${prodKey}`, { custKey, prodKey }];
    })).values()];
  if (!pairs.length) return rows;

  const contexts = new Map(await Promise.all(pairs.map(async (pair) => {
    try {
      return [`${pair.custKey}:${pair.prodKey}`, await resolveEstimateContext({ year, week, ...pair })];
    } catch {
      return [`${pair.custKey}:${pair.prodKey}`, null];
    }
  })));
  const customerKeys = [...new Set(pairs.map((pair) => pair.custKey))];
  const customerTargets = new Map(await Promise.all(customerKeys.map(async (custKey) => {
    const target = await query(
      `SELECT TOP 1 vs.CustKey
         FROM ViewShipment vs
         JOIN ViewOrder vo ON vs.OrderYearWeek2=vo.OrderYearWeek2 AND vs.CustKey=vo.CustKey AND vs.ProdKey=vo.ProdKey
         JOIN ShipmentDate sdd ON sdd.SdetailKey=vs.SdetailKey
        WHERE vs.OrderYear=@yr AND vs.OrderWeek LIKE @prefix AND vs.CustKey=@ck
          AND ISNULL(vs.DetailFix,0)=1 AND ISNULL(vs.EstQuantity,0)>0 AND ISNULL(sdd.EstQuantity,0)>0`,
      { yr: { type: sql.Int, value: Number(year) }, prefix: { type: sql.NVarChar, value: `${String(week).padStart(2, '0')}-%` }, ck: { type: sql.Int, value: custKey } },
    );
    return [custKey, Boolean(target.recordset[0])];
  })));

  return (rows || []).map((row) => {
    const storedCost = Number(row.estimateCost || 0);
    const context = contexts.get(`${Number(row.custKey || 0)}:${Number(row.prodKey || 0)}`);
    const cost = storedCost > 0 ? storedCost : Number(context?.cost || 0);
    return {
      ...row,
      distributionCost: cost > 0 ? cost : null,
      distributionCostSource: storedCost > 0 ? 'Estimate' : (context?.costSource || ''),
      distributionCostOrderWeek: row.appliedCostSourceWeek || context?.costOrderWeek || '',
      customerTargetRegistered: customerTargets.get(Number(row.custKey || 0)) === true,
      carryoverClassification: customerTargets.get(Number(row.custKey || 0)) === true ? 'REGISTERED_CUSTOMER' : 'SURPLUS',
    };
  });
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
    appliedOrderYear: row.AppliedOrderYear == null ? null : Number(row.AppliedOrderYear),
    appliedOrderWeek: row.AppliedOrderWeek == null ? '' : String(row.AppliedOrderWeek),
    appliedShipmentKey: row.AppliedShipmentKey == null ? null : Number(row.AppliedShipmentKey),
    appliedCostSourceYear: row.AppliedCostSourceYear == null ? null : Number(row.AppliedCostSourceYear),
    appliedCostSourceWeek: row.AppliedCostSourceWeek == null ? '' : String(row.AppliedCostSourceWeek),
    isCarryover: Boolean(
      row.AppliedOrderYear && row.AppliedOrderWeek
      && (Number(row.OrderYear) !== Number(row.AppliedOrderYear)
        || String(row.OrderWeek) !== String(row.AppliedOrderWeek)),
    ),
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
    isCarryoverLedger: Boolean(row.IsCarryoverLedger ?? row.isCarryoverLedger),
    originalQuantity: Number(row.OriginalQuantity ?? row.originalQuantity ?? row.Quantity ?? row.quantity ?? 0),
    remainingQuantity: Number(row.RemainingQuantity ?? row.remainingQuantity ?? row.Quantity ?? row.quantity ?? 0),
    sourceUnit: normalizeDefectUnit(row.SourceUnit ?? row.sourceUnit)
      || String(row.SourceUnit ?? row.sourceUnit ?? ''),
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
  const summary = changeSummary(before, after, action);
  // 같은 값을 다시 저장한 작업은 감사 이력을 오염시키지 않는다.
  if (/변경\s*없음$/.test(summary)) return false;
  await tQuery(
    `INSERT INTO WebSalesDefectDeductionHistory
       (DeductionKey, ActionType, ChangedBy, ChangedByName, ChangeSummary, BeforeJson, AfterJson)
     VALUES (@key,@action,@by,@name,@summary,@before,@after)`,
    {
      key: { type: sql.Int, value: Number(key) },
      action: { type: sql.NVarChar, value: text(action, 30) },
      by: { type: sql.NVarChar, value: text(user?.userId, 100) },
      name: { type: sql.NVarChar, value: text(user?.userName, 100) },
      summary: { type: sql.NVarChar, value: summary },
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
    unit: { type: sql.NVarChar, value: normalizeDefectUnit(item.sourceUnit || item.unit || '') || '단' },
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

export async function listDeductions({ year, week, manager = '', includeDeleted = false, history = false, includeCarryover = false, carryoverOnly = false } = {}) {
  const carryoverSchema = await query(
    `SELECT CASE WHEN COL_LENGTH(N'dbo.WebSalesDefectDeduction',N'IsCarryoverLedger') IS NOT NULL
                       AND COL_LENGTH(N'dbo.WebSalesDefectDeduction',N'RemainingQuantity') IS NOT NULL
                  THEN 1 ELSE 0 END AS IsReady`, {},
  );
  const carryoverReady = Number(carryoverSchema.recordset[0]?.IsReady || 0) === 1;
  const managerFilter = text(manager, 100);
  const params = {
    year: { type: sql.Int, value: Number(year) },
    week: { type: sql.NVarChar, value: String(Number(week)) },
    manager: { type: sql.NVarChar, value: managerFilter },
  };
  const scopeWhere = carryoverOnly && !carryoverReady
    ? '1=0'
    : carryoverOnly
    ? `(d.IsCarryoverLedger=1 AND ISNULL(d.RemainingQuantity,d.Quantity)>0)`
    : includeCarryover && carryoverReady
    ? `(d.OrderYear=@year AND d.OrderWeek=@week
        OR (d.IsCarryoverLedger=1 AND ISNULL(d.RemainingQuantity,d.Quantity)>0
            AND (d.OrderYear < @year OR (d.OrderYear=@year AND TRY_CONVERT(INT,d.OrderWeek)<=TRY_CONVERT(INT,@week))))
        OR (d.IsCarryoverLedger=0 AND d.EstimateKey IS NULL AND (d.OrderYear < @year
            OR (d.OrderYear=@year AND TRY_CONVERT(INT, d.OrderWeek) < TRY_CONVERT(INT, @week)))))`
    : includeCarryover
    ? `(d.OrderYear=@year AND d.OrderWeek=@week
        OR (d.EstimateKey IS NULL AND (d.OrderYear < @year
            OR (d.OrderYear=@year AND TRY_CONVERT(INT,d.OrderWeek)<TRY_CONVERT(INT,@week)))))`
    : `d.OrderYear=@year AND d.OrderWeek=@week`;
  const where = `${scopeWhere}
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
  const normalizedRows = rows.recordset.map((row) => {
      const item = snapshot(row);
      const sourceBeforeTarget = isEarlierOrSameScope(item.orderYear, item.orderWeek, year, week)
        && (Number(item.orderYear) !== Number(year) || String(item.orderWeek) !== String(week));
      return { ...item, isCarryover: item.isCarryover || sourceBeforeTarget };
    });
  const result = {
    rows: includeCarryover
      ? await enrichSupportDistributionCosts(normalizedRows, { year, week })
      : normalizedRows,
    managerOptions,
  };
  if (history) {
    const hr = await query(
      `SELECT TOP 1000 h.*, d.OrderYear, d.OrderWeek
         FROM WebSalesDefectDeductionHistory h
         LEFT JOIN WebSalesDefectDeduction d ON d.DeductionKey=h.DeductionKey
        WHERE ${scopeWhere}
           AND (@manager=N'' OR d.CreatedBy=@manager OR d.CreatedByName=@manager
                OR d.UpdatedBy=@manager OR d.UpdatedByName=@manager)
        ORDER BY h.ChangedAt DESC, h.HistoryKey DESC`, params,
    );
    result.history = hr.recordset;
  }
  return result;
}

export async function markCarryoverDeductions({ ids, user } = {}) {
  await ensureSalesDefectTables();
  const keys = [...new Set((ids || []).map(Number).filter((key) => key > 0))];
  if (!keys.length || keys.length > 500) throw new Error('이월업체로 등록할 행을 선택하세요.');
  const updated = [];
  await withTransaction(async (tQuery) => {
    for (const key of keys) {
      const before = await getStoredRow(tQuery, key, true);
      if (!before || Number(before.IsDeleted) === 1) throw new Error(`이월 원장 ${key}를 찾을 수 없습니다.`);
      if (!(Number(before.CustKey) > 0) || !(Number(before.ProdKey) > 0) || !(Number(before.Quantity) > 0)) {
        throw new Error(`${before.CustName || '해당 행'}의 업체·품목·수량을 먼저 저장하세요.`);
      }
      if (before.EstimateKey && !Number(before.IsCarryoverLedger)) throw new Error(`${before.CustName || '해당 행'}은 이미 견적서에 등록되었습니다.`);
      await tQuery(
        `UPDATE WebSalesDefectDeduction
            SET IsCarryoverLedger=1,
                OriginalQuantity=COALESCE(OriginalQuantity,Quantity),
                RemainingQuantity=COALESCE(RemainingQuantity,Quantity),
                Status=CASE WHEN ISNULL(RemainingQuantity,Quantity)>0 THEN N'CARRYOVER' ELSE N'COMPLETED' END,
                UpdatedBy=@by, UpdatedByName=@name, UpdatedAt=GETDATE(), RowVersionNo=RowVersionNo+1
          WHERE DeductionKey=@key`,
        { key: { type: sql.Int, value: key }, by: { type: sql.NVarChar, value: text(user?.userId, 100) }, name: { type: sql.NVarChar, value: text(user?.userName, 100) } },
      );
      const after = await getStoredRow(tQuery, key);
      await writeHistory(tQuery, { key, action: 'CARRYOVER_REGISTER', user, before: snapshot(before), after: snapshot(after) });
      updated.push(snapshot(after));
    }
  });
  return updated;
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
                  -- 수입부가 확정한 비고는 오래 열린 영업 화면의 빈 값으로 덮지 않는다.
                  -- 보완 필요도 해결 완료 전에는 일반 영업 저장에서 해제할 수 없다.
                  Note=CASE WHEN ImportConfirmed=1 AND NULLIF(@note,N'') IS NULL AND NULLIF(Note,N'') IS NOT NULL THEN Note ELSE @note END,
                  ImportReviewRequired=CASE WHEN ImportReviewRequired=1 THEN 1 ELSE @reviewRequired END,
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
        const linked = await syncLinkedEstimate(tQuery, {
          year: before.appliedOrderYear || y,
          week: before.appliedOrderWeek || w,
          item,
          estimateKey: before.estimateKey,
        });
        await tQuery(
          `UPDATE WebSalesDefectDeduction
              SET EstimateCost=@cost, EstimateDtm=@dt,
                  AppliedOrderYear=@appliedYear, AppliedOrderWeek=@appliedWeek,
                  AppliedShipmentKey=@appliedShipmentKey,
                  AppliedCostSourceYear=@costSourceYear, AppliedCostSourceWeek=@costSourceWeek,
                  Status=N'REGISTERED'
            WHERE DeductionKey=@key`,
          {
            cost: { type: sql.Decimal(18, 4), value: linked.cost },
            dt: { type: sql.DateTime, value: linked.estimateDate },
            appliedYear: { type: sql.Int, value: before.appliedOrderYear || y },
            appliedWeek: { type: sql.NVarChar, value: String(before.appliedOrderWeek || w) },
            appliedShipmentKey: { type: sql.Int, value: Number(linked.targetShipmentKey) },
            costSourceYear: { type: sql.Int, value: linked.costSourceYear },
            costSourceWeek: { type: sql.NVarChar, value: linked.costSourceWeek || '' },
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
      const inputNote = input.note == null ? text(dbRow.Note, 1000) : text(input.note, 1000);
      const reviewRequired = Boolean(dbRow.ImportReviewRequired) || input.importReviewRequired === true;
      const hasReviewDetails = reviewRequired || inputNote.trim() !== '';
      let farm = farmKey > 0 ? await tQuery(
        `SELECT TOP 1 FarmKey, FarmName
           FROM Farm
          WHERE FarmKey=@farmKey AND ISNULL(isDeleted,0)=0`,
        { farmKey: { type: sql.Int, value: farmKey } },
      ) : { recordset: [] };
      // ViewWarehouse에만 등록되고 Farm 마스터 키가 없는 입고농장도
      // 기존 원장에서는 FarmName으로 선택할 수 있으므로 이름을 검증해 허용한다.
      if (!farm.recordset[0] && text(input.farmName, 200)) {
        farm = await tQuery(
          `SELECT TOP 1 NULL AS FarmKey, FarmName
             FROM ViewWarehouse
            WHERE NULLIF(FarmName,N'') IS NOT NULL AND FarmName=@farmName`,
          { farmName: { type: sql.NVarChar, value: text(input.farmName, 200) } },
        );
      }
      if (!farm.recordset[0] && farmKey > 0) {
        throw new Error(`선택한 농장(${input.farmName || farmKey})을 입고농장 목록에서 찾을 수 없습니다.`);
      }
      if (!farm.recordset[0] && text(input.farmName, 200)) {
        throw new Error(`선택한 농장(${input.farmName})을 입고농장 목록에서 찾을 수 없습니다.`);
      }
      if (!farm.recordset[0] && !hasReviewDetails) {
        throw new Error(`${dbRow.CustName || '거래처'} / ${dbRow.ColorName || dbRow.ProdName || '품목'} 행의 농장을 선택하세요.`);
      }
      // 보완 필요 또는 비고를 먼저 확정하는 경우에는 농장이 아직 미정이어도
      // 입력부의 검토 상태를 잃지 않도록 기존 농장값을 유지하고 확정 이력을 남긴다.
      if (!farm.recordset[0]) {
        farm = { recordset: [{
          FarmKey: dbRow.FarmKey == null ? null : Number(dbRow.FarmKey),
          FarmName: text(dbRow.FarmName, 200),
        }] };
      }
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
          // 구버전 화면·오래 열린 화면이 필드를 보내지 않아도 기존 상태를 유지한다.
          // 한 번 체크된 보완 필요는 명시적인 해결 완료 전까지 절대 해제하지 않는다.
          note: { type: sql.NVarChar, value: inputNote },
          reviewRequired: {
            type: sql.Bit,
            value: reviewRequired,
          },
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
 * 수입부 확정 취소는 확정 플래그와 확정자 감사 정보만 되돌린다.
 * Farm/Credit/Note/Review와 Estimate, Order, Shipment, Stock은 보존한다.
 */
export async function cancelIncomingDeductions({ year, week, rows, user } = {}) {
  await ensureSalesDefectTables();
  const y = normalizeYear(year);
  const w = normalizeParentWeek(week);
  if (!y || !w) throw new Error('연도와 차수를 확인하세요.');
  if (!Array.isArray(rows) || rows.length > 500) throw new Error('확정 취소 행은 1~500건까지 가능합니다.');
  const keys = [...new Set(rows.map((row) => Number(row?.deductionKey)).filter((key) => key > 0))];
  if (!keys.length) throw new Error('확정 취소 대상 저장행이 없습니다.');
  const cancelled = [];
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
      const before = await getStoredSnapshot(tQuery, key, { lock: true });
      if (!before?.importConfirmed) {
        cancelled.push(before);
        continue;
      }
      await tQuery(
        `UPDATE WebSalesDefectDeduction
            SET ImportConfirmed=0, ImportConfirmedBy=N'', ImportConfirmedByName=N'',
                ImportConfirmedAt=NULL, UpdatedBy=@by, UpdatedByName=@byName,
                UpdatedAt=GETDATE(), RowVersionNo=RowVersionNo+1
          WHERE DeductionKey=@key`,
        {
          by: { type: sql.NVarChar, value: text(user?.userId || user?.userName, 100) },
          byName: { type: sql.NVarChar, value: text(user?.userName || user?.userId, 100) },
          key: { type: sql.Int, value: key },
        },
      );
      const after = await getStoredSnapshot(tQuery, key);
      await writeHistory(tQuery, { key, action: 'INCOMING_CONFIRM_CANCEL', user, before, after });
      cancelled.push(after);
    }
  });
  return cancelled;
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

function assertRegistrationScope(row, targetYear, targetWeek) {
  const sourceYear = Number(row.OrderYear ?? row.orderYear);
  const sourceWeek = String(row.OrderWeek ?? row.orderWeek ?? '');
  const estimateKey = Number(row.EstimateKey ?? row.estimateKey ?? 0);
  const appliedYear = Number(row.AppliedOrderYear ?? row.appliedOrderYear ?? 0);
  const appliedWeek = String(row.AppliedOrderWeek ?? row.appliedOrderWeek ?? '');
  if (estimateKey && appliedYear && appliedWeek
      && (appliedYear !== Number(targetYear) || appliedWeek !== String(targetWeek))) {
    throw new Error(`차감 행 ${row.DeductionKey || ''}은 이미 ${appliedYear}년 ${appliedWeek}차 견적서에 등록되어 있습니다.`);
  }
  if (estimateKey && (!appliedYear || !appliedWeek)
      && (sourceYear !== Number(targetYear) || sourceWeek !== String(targetWeek))) {
    throw new Error(`기존 견적서의 적용 차수 정보가 없어 ${sourceYear}년 ${sourceWeek}차에서만 수정할 수 있습니다.`);
  }
  if (!isEarlierOrSameScope(sourceYear, sourceWeek, targetYear, targetWeek)) {
    throw new Error(`원차수 ${sourceYear}년 ${sourceWeek}차는 적용 대상 ${targetYear}년 ${targetWeek}차보다 뒤라서 이월 등록할 수 없습니다.`);
  }
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
  return {
    cost,
    estimateDate: ctx.estimateDate || new Date(),
    targetShipmentKey: ctx.shipmentKey,
    costSourceYear: ctx.costSourceYear,
    costSourceWeek: ctx.costSourceWeek,
  };
}

export async function preflightRegistration({ year, week, rows } = {}) {
  const y = normalizeYear(year);
  const w = normalizeParentWeek(week);
  if (!y || !w) throw new Error('연도와 차수를 확인하세요.');
  const output = [];
  for (let i = 0; i < (rows || []).length; i += 1) {
    const item = normalizeDeductionRow(rows[i]);
    const result = {
      index: i, deductionKey: item.deductionKey, sourceOrderYear: item.orderYear,
      sourceOrderWeek: item.orderWeek, cost: 0, costSource: '', shipmentKey: null,
      estimateDate: null, error: '',
    };
    try {
      assertRegistrationScope({ ...item, OrderYear: item.orderYear, OrderWeek: item.orderWeek, EstimateKey: item.estimateKey }, y, w);
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

async function loadProductPreview(q, prodKey) {
  if (!prodKey) return null;
  const result = await q(
    `SELECT TOP 1 ProdKey, ProdName, DisplayName, FlowerName, CounName, EstUnit, OutUnit
       FROM Product
      WHERE ProdKey=@pk AND ISNULL(isDeleted,0)=0`,
    { pk: { type: sql.Int, value: Number(prodKey) } },
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
    // Web 원장의 ProdName은 원본 입력 품종 문자열일 수 있다. 신규 등록도
    // 견적서관리에서 보이는 실제 Product DB 품명을 미리 보여준다.
    const product = await loadProductPreview(query, dbRow.ProdKey);
    const result = {
      deductionKey: key,
      customerName: item.customerName,
      productName: item.productName,
      colorName: item.colorName,
      countryName: product?.CounName || '',
      flowerName: product?.FlowerName || item.productName,
      productDbName: product?.ProdName || '',
      productDisplayName: product?.DisplayName || '',
      estimateTypeLabel: deductionType,
      quantity: Number(dbRow.IsCarryoverLedger ? (dbRow.RemainingQuantity ?? dbRow.Quantity) : item.quantity || 0),
      isCarryoverLedger: Boolean(dbRow.IsCarryoverLedger),
      remainingQuantity: Number(dbRow.RemainingQuantity ?? dbRow.Quantity ?? 0),
      sourceUnit: item.sourceUnit || item.unit || '',
      displayUnit: normalizeDefectUnit(item.sourceUnit || item.unit || ''),
      sourceOrderYear: Number(dbRow.OrderYear || 0),
      sourceOrderWeek: String(dbRow.OrderWeek || ''),
      appliedOrderYear: dbRow.AppliedOrderYear == null ? null : Number(dbRow.AppliedOrderYear),
      appliedOrderWeek: dbRow.AppliedOrderWeek == null ? '' : String(dbRow.AppliedOrderWeek),
      note: item.note || '',
      estimateKey: Number(dbRow.EstimateKey || 0) || null,
      before,
      after: null,
      error: '',
    };
    try {
      assertRegistrationScope(dbRow, y, w);
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
        ProdName: product?.ProdName || item.productName,
        DisplayName: product?.DisplayName || item.matchedProductName || '',
        FlowerName: product?.FlowerName || item.productName,
        CountryName: product?.CounName || '',
        EstimateTypeLabel: deductionType,
        Unit: ctx.unit || item.sourceUnit || '단',
        DisplayUnit: ctx.displayUnit || normalizeDefectUnit(item.sourceUnit || item.unit || ''),
        Quantity: quantity,
        Cost: cost,
        Amount: amount,
        Vat: vat,
        Descr: item.note || '',
        ShipmentKey: Number(ctx.shipmentKey),
        CostSource: ctx.costSource,
        CostOrderWeek: ctx.costOrderWeek,
        CostSourceYear: ctx.costSourceYear,
        CostSourceWeek: ctx.costSourceWeek,
        AppliedOrderYear: y,
        AppliedOrderWeek: String(w),
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
  const skipped = [];
  const preflight = [];

  await withTransaction(async (tQuery) => {
    const typeCode = await resolveEstimateTypeCode(deductionType, tQuery);
    for (const key of keys) {
      try {
        let dbRow = await getStoredRow(tQuery, key, true);
        if (!dbRow || Number(dbRow.IsDeleted) === 1) throw new Error(`차감 행 ${key}를 찾을 수 없습니다.`);
        assertRegistrationScope(dbRow, y, w);
        const override = overrides?.[String(key)] || overrides?.[key] || null;
        let overridePayload = null;
        if (override && (override.quantity != null || override.note != null || override.sourceUnit != null)) {
          const availableQuantity = Number(dbRow.IsCarryoverLedger ? (dbRow.RemainingQuantity ?? dbRow.Quantity) : dbRow.Quantity);
          const quantity = Number(override.quantity ?? availableQuantity);
          if (!(quantity > 0)) throw new Error(`차감 행 ${key}의 수량은 0보다 커야 합니다.`);
          if (dbRow.IsCarryoverLedger && quantity > availableQuantity + 0.0001) throw new Error(`차감 행 ${key}의 처리수량이 잔여수량 ${availableQuantity}보다 큽니다.`);
          overridePayload = {
            quantity,
            note: text(override.note ?? dbRow.Note, 1000),
            sourceUnit: normalizeDefectUnit(override.sourceUnit ?? dbRow.SourceUnit)
              || normalizeDefectUnit(dbRow.SourceUnit) || '단',
          };
          // 실제 UPDATE는 대상 출고와 단가를 확인한 뒤 수행한다. 대상이 없어서
          // 이월 대기되는 행의 수량/적요를 등록 시도만으로 바꾸지 않는다.
          dbRow = {
            ...dbRow,
            Quantity: overridePayload.quantity,
            Note: overridePayload.note,
            SourceUnit: overridePayload.sourceUnit,
          };
        }
        assertRegisterable(dbRow);
        const ctx = await resolveEstimateContext({ year: y, week: w, custKey: dbRow.CustKey, prodKey: dbRow.ProdKey }, tQuery);
        if (!ctx.shipmentKey) throw new Error(`${dbRow.CustName || '거래처'} ${w}차에 EXE 판매 출고행이 없어 이월 대기합니다.`);
        if (!(ctx.cost > 0)) throw new Error(`${dbRow.CustName || '거래처'} / ${dbRow.ProdName || '품목'}의 이전 차수 분배 단가가 없습니다.`);
        preflight.push({ key, dbRow, ctx, typeCode, overridePayload });
      } catch (error) {
        skipped.push({ deductionKey: key, error: error.message });
      }
    }

    for (const { key, dbRow: plannedRow, ctx, typeCode, overridePayload } of preflight) {
      let dbRow = await getStoredRow(tQuery, key, true);
      if (overridePayload && !dbRow.IsCarryoverLedger) {
        const beforeReview = snapshot(dbRow);
        await tQuery(
          `UPDATE WebSalesDefectDeduction
              SET Quantity=@qty, Note=@note, SourceUnit=@unit,
                  UpdatedBy=@by, UpdatedByName=@name, UpdatedAt=GETDATE(), RowVersionNo=RowVersionNo+1
            WHERE DeductionKey=@key`,
          {
            qty: { type: sql.Decimal(18, 4), value: overridePayload.quantity },
            note: { type: sql.NVarChar, value: overridePayload.note },
            unit: { type: sql.NVarChar, value: overridePayload.sourceUnit },
            by: { type: sql.NVarChar, value: text(user?.userId, 100) },
            name: { type: sql.NVarChar, value: text(user?.userName, 100) },
            key: { type: sql.Int, value: key },
          },
        );
        dbRow = await getStoredRow(tQuery, key, true);
        await writeHistory(tQuery, { key, action: 'REVIEW_UPDATE', user, before: beforeReview, after: snapshot(dbRow) });
      }
      // preflight에서 검증한 행을 다시 읽어 동시 수정도 등록 시점에 확인한다.
      assertRegisterable(dbRow);
      const applyQuantity = Number(overridePayload?.quantity ?? (dbRow.IsCarryoverLedger ? (dbRow.RemainingQuantity ?? dbRow.Quantity) : dbRow.Quantity)) || 0;
      if (dbRow.IsCarryoverLedger && applyQuantity > Number(dbRow.RemainingQuantity ?? dbRow.Quantity) + 0.0001) {
        throw new Error(`차감 행 ${key}의 잔여수량이 다른 사용자에 의해 변경되었습니다.`);
      }
      const qty = -Math.abs(applyQuantity);
      const cost = Number(ctx.cost) || 0;
      const amount = Math.round(qty * cost / 1.1);
      const vat = qty * cost - amount;
      // 적요는 사용자가 수입부에서 직접 입력한 값만 전달한다. 빈 값·공백은
      // Estimate.Descr에 자동 문구로 대체하지 않고 빈 문자열로 저장한다.
      const estimateDescr = text(dbRow.Note, 1000);
      let estimateKey = dbRow.IsCarryoverLedger ? 0 : Number(dbRow.EstimateKey || 0);
      const estimateAction = estimateKey ? 'UPDATE' : 'INSERT';
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
            descr: { type: sql.NVarChar, value: estimateDescr },
            sk: { type: sql.Int, value: Number(ctx.shipmentKey) },
            ek: { type: sql.Int, value: estimateKey },
          },
        );
      } else {
        const inserted = await tQuery(
          `DECLARE @EstimateInserted TABLE (EstimateKey INT);
           INSERT INTO Estimate
             (EstimateType,EstimateDtm,ProdKey,Unit,Quantity,Cost,Amount,Vat,Descr,ShipmentKey)
           OUTPUT INSERTED.EstimateKey INTO @EstimateInserted(EstimateKey)
           VALUES (@type,@dt,@pk,@unit,@qty,@cost,@amount,@vat,@descr,@sk);
           SELECT TOP (1) EstimateKey FROM @EstimateInserted;`,
          {
            type: { type: sql.NVarChar, value: typeCode },
            dt: { type: sql.DateTime, value: ctx.estimateDate || new Date() },
            pk: { type: sql.Int, value: Number(dbRow.ProdKey) },
            unit: { type: sql.NVarChar, value: ctx.unit || normalizeUnit(dbRow.SourceUnit) || '단' },
            qty: { type: sql.Float, value: qty },
            cost: { type: sql.Float, value: cost },
            amount: { type: sql.Float, value: amount },
            vat: { type: sql.Float, value: vat },
            descr: { type: sql.NVarChar, value: estimateDescr },
            sk: { type: sql.Int, value: Number(ctx.shipmentKey) },
          },
        );
        estimateKey = Number(inserted.recordset[0].EstimateKey);
      }
      const before = snapshot(dbRow);
      if (dbRow.IsCarryoverLedger) {
        await tQuery(
          `INSERT INTO WebSalesCarryoverApplication
             (DeductionKey,EstimateKey,AppliedOrderYear,AppliedOrderWeek,AppliedShipmentKey,AppliedQuantity,AppliedCost,AppliedBy,AppliedByName)
           VALUES (@key,@ek,@year,@week,@shipment,@quantity,@cost,@by,@name)`,
          {
            key: { type: sql.Int, value: key }, ek: { type: sql.Int, value: estimateKey },
            year: { type: sql.Int, value: y }, week: { type: sql.NVarChar, value: String(w) },
            shipment: { type: sql.Int, value: Number(ctx.shipmentKey) }, quantity: { type: sql.Decimal(18, 4), value: applyQuantity },
            cost: { type: sql.Decimal(18, 4), value: cost }, by: { type: sql.NVarChar, value: text(user?.userId, 100) },
            name: { type: sql.NVarChar, value: text(user?.userName, 100) },
          },
        );
      }
      await tQuery(
        `UPDATE WebSalesDefectDeduction
            SET DeductionType=@type, EstimateKey=@ek, EstimateCost=@cost, EstimateDtm=@dt,
                AppliedOrderYear=@appliedYear, AppliedOrderWeek=@appliedWeek,
                AppliedShipmentKey=@appliedShipmentKey,
                AppliedCostSourceYear=@costSourceYear, AppliedCostSourceWeek=@costSourceWeek,
                RemainingQuantity=CASE WHEN IsCarryoverLedger=1 THEN
                  CASE WHEN ISNULL(RemainingQuantity,Quantity)-@applyQty < 0.0001 THEN 0 ELSE ISNULL(RemainingQuantity,Quantity)-@applyQty END
                  ELSE RemainingQuantity END,
                Status=CASE WHEN IsCarryoverLedger=1 AND ISNULL(RemainingQuantity,Quantity)-@applyQty >= 0.0001 THEN N'CARRYOVER'
                            WHEN IsCarryoverLedger=1 THEN N'COMPLETED' ELSE N'REGISTERED' END,
                UpdatedBy=@by, UpdatedByName=@name,
                UpdatedAt=GETDATE(), RowVersionNo=RowVersionNo+1
          WHERE DeductionKey=@key`,
        {
          type: { type: sql.NVarChar, value: text(deductionType, 50) || '불량차감' },
          ek: { type: sql.Int, value: estimateKey },
          cost: { type: sql.Decimal(18, 4), value: cost },
          dt: { type: sql.DateTime, value: ctx.estimateDate || new Date() },
          appliedYear: { type: sql.Int, value: y },
          appliedWeek: { type: sql.NVarChar, value: String(w) },
          appliedShipmentKey: { type: sql.Int, value: Number(ctx.shipmentKey) },
          applyQty: { type: sql.Decimal(18, 4), value: applyQuantity },
          costSourceYear: { type: sql.Int, value: ctx.costSourceYear },
          costSourceWeek: { type: sql.NVarChar, value: ctx.costSourceWeek || '' },
          by: { type: sql.NVarChar, value: text(user?.userId, 100) },
          name: { type: sql.NVarChar, value: text(user?.userName, 100) },
          key: { type: sql.Int, value: key },
        },
      );
      const current = await getStoredRow(tQuery, key);
      const after = snapshot(current);
      await writeHistory(tQuery, { key, action: 'REGISTER_ESTIMATE', user, before, after });
      registered.push({
        deductionKey: key, estimateKey, estimateAction, quantity: qty,
        unit: ctx.unit || normalizeUnit(dbRow.SourceUnit) || '단',
        displayUnit: ctx.displayUnit || normalizeDefectUnit(dbRow.SourceUnit) || '단',
        cost, amount, vat, costSource: ctx.costSource, targetShipmentKey: ctx.shipmentKey,
        sourceOrderYear: Number(dbRow.OrderYear), sourceOrderWeek: String(dbRow.OrderWeek || ''),
        appliedOrderYear: y, appliedOrderWeek: String(w),
      });
    }
  });
  return { registered, skipped };
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
