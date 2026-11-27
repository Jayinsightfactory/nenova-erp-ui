import { query, sql } from '../db.js';
import { buildProductMappingStats, buildProductSuggestions } from '../orderImportMatch.js';
import { resolveImportCustomer } from '../orderImportCustomerMatch.js';
import { loadMappings } from '../parseMappings.js';
import { loadCustomerMappings } from '../customerMappings.js';
import { scoreNaturalLanguageProducts } from '../naturalLanguageProductMatching.js';
import { normalizeDeductionRow, normalizeDefectUnit } from '../salesDefectDeductionCore.js';

let lookupUsagePromise = null;
let lookupUsageCache = null;

export function text(value, max = 1000) {
  return String(value ?? '').trim().slice(0, max);
}

export function numberValue(value) {
  const n = Number(String(value ?? '').replace(/,/g, '').replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function normalizeSearch(value) {
  return String(value || '').toLowerCase().replace(/[\s()\[\]{}\-_/.]/g, '');
}

export function scoreCustomerLookup(input, customer) {
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

async function loadProductMappingStats() {
  return buildProductMappingStats(await loadMappings());
}

export async function loadLookupUsageStats() {
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

export function rankCustomerLookup(input, customers, limit = 20, usageByCustKey = null) {
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

export function matchSalesDefectRows(rows, {
  customers = [],
  products = [],
  farms = [],
  allProducts = products,
  productByKey = new Map((allProducts || []).map((item) => [Number(item.ProdKey), item])),
  customerUsage = null,
  productUsage = null,
  mappingByProdKey = null,
  savedMappings,
} = {}) {
  return (rows || []).map((raw, index) => {
    const row = normalizeDeductionRow({ ...raw, sourceUnit: raw.sourceUnit || raw.unit });
    const customer = resolveImportCustomer(row.customerName, customers, {
      inputCustKey: row.custKey,
      usageByCustKey: customerUsage,
      savedMappings,
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
    const needsGeneratedAliasSearch = /[\uac00-\ud7a3ㄱ-ㅎ]/.test(keyword);
    if ((r.recordset.length > 0 || !keyword) && !needsGeneratedAliasSearch) {
      if (!keyword) return { products: r.recordset };
      const suggestions = buildProductSuggestions(keyword, r.recordset, {
        limit: 40,
        minScore: 20,
        usageByProdKey: usage.productUsage,
        mappingByProdKey: await loadProductMappingStats(),
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
    const mappingStats = await loadProductMappingStats();
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
    mappingByProdKey: await loadProductMappingStats(),
    savedMappings: await loadCustomerMappings(),
    farms: farmResult.recordset || [],
    customerUsage: usage.customerUsage,
    productUsage: usage.productUsage,
  };
}
