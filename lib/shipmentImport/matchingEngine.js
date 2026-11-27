import { customerExportName } from '../customerExportName.js';
import { normalizeOrderWeek } from '../orderUtils.js';
import { cleanPivotProdName } from '../pivotProdName.js';
import { volumeProdLabel } from '../pivotVolumeProductLabel.js';
import { matchDutchCustomer } from '../dutchVolumeCustomerMatch.js';
import {
  isAlstroImportRow,
  importProductOverrideKey,
  isImportSkipProductValue,
  classifyImportUnmatchedReason,
  buildReplacementProductKeys,
  resolveImportCustomerOverrideKey,
  isImportIgnoreCustomerValue,
  isRowFromIgnoredCustomer,
} from '../shipmentImportQty.js';
import { normalizeImportInput } from '../shipmentImportMode.js';

export const IMPORT_CUSTOMER_ALIASES = {
  // 물량표에서 출고요일/표기 분리로 생기는 보조 컬럼. 실제 출고분배는 주광농원으로 합산한다.
  '윌슨': '주광',
  // 2026-07-15 29차 물량표: '윌슨' 열이 '주광윌슨'으로 개명돼 별칭이 안 먹어 9박스 누락 신고
  '주광윌슨': '주광',
  // 라움(트라움에스앤씨, 680) 선출고 열 — Descr 별칭 '라움'으로 매칭 (수연선출고 패턴과 동일)
  '라움선출고': '라움',
  '라움선출고완료': '라움',
  '태림농장': '태림CH농장',
  '영림선출고': '영림원예',
  '중앙 선출고': '중앙GR농장',
  '중앙선출고': '중앙GR농장',
  '수연선출고': '수연원예',
  '영남소재': '영남',
  '남대문-중앙': 'CL75',
  '남대문중앙': 'CL75',
};

export function inferImportProductFamily(...values) {
  for (const value of values) {
    const text = String(value || '').toLowerCase();
    if (!text) continue;
    if (/루스커스|ruscus/.test(text)) return 'ruscus';
    if (/미니\s*카네이션|mini\s*carnation|minicarnation/.test(text)) return 'minicarnation';
    if (/카네이션|carnation/.test(text)) return 'carnation';
    if (/장미|\brose\b/.test(text)) return 'rose';
    if (/수국|hydrangea/.test(text)) return 'hydrangea';
    if (/알스트로|alstroemeria|alstromeria/.test(text)) return 'alstroemeria';
  }
  return '';
}

export function normText(value) {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .replace(/[()（）\[\]{}]/g, '')
    .replace(/[△☆★※＋+]/g, '')
    .toLowerCase();
}

export function productFamily(product) {
  if (String(product?.FlowerName || '').trim()) {
    return inferImportProductFamily(product.FlowerName) || `flower:${normText(product.FlowerName)}`;
  }
  return inferImportProductFamily(product?.CountryFlower, product?.ProdName, product?.DisplayName, product?.CounName);
}

// Source evidence is checked before matching and never replaced by the chosen catalog family.
// An exact alias such as WHITE is not permission to cross a sheet's species boundary.
export function indexSourceHeadings(catalog) {
  const index = new Map();
  const add = (heading, field, value) => {
    if (!heading || !value) return;
    const key = normText(heading);
    if (!index.has(key)) index.set(key, { countries: new Set(), families: new Set() });
    index.get(key)[field].add(value);
  };
  for (const p of catalog) {
    add(p.CounName, 'countries', normText(p.CounName));
    add(p.CountryFlower, 'countries', normText(p.CounName));
    add(p.FlowerName, 'families', productFamily(p));
    add(p.CountryFlower, 'families', productFamily(p));
  }
  return index;
}

export function buildSourceProductScope(row, headingIndex) {
  const canonical = family => family === 'minicarnation' ? 'carnation' : family;
  const label = row.rawProductLabel || row.productLabel || '';
  const headings = [...(row.productHeadings || []), row.sheetName].filter(Boolean);
  const headingKeys = new Set(headings.flatMap(h => [normText(h), normText(String(h).replace(/\b20\d{2}\b/g, ''))]));
  const exactHeading = value => !!value && headingKeys.has(normText(value));
  const countries = new Set();
  const headedFamilies = new Set();
  for (const key of headingKeys) {
    for (const country of headingIndex.get(key)?.countries || []) countries.add(country);
    for (const family of headingIndex.get(key)?.families || []) headedFamilies.add(canonical(family));
  }
  const sourceFamily = canonical(inferImportProductFamily(label)) || (headedFamilies.size === 1
    ? [...headedFamilies][0] : canonical(inferImportProductFamily(...headings) || row.productFamily));
  return {
    hasSpeciesEvidence: !!sourceFamily,
    allows(product) {
      if (countries.size === 1 && !countries.has(normText(product.CounName))) return false;
      // Exact original name AND catalog species heading resolve names classified differently in DB.
      if ([product.ProdName, product.DisplayName].some(n => normText(n) === normText(label)) && exactHeading(product.FlowerName)) return true;
      return !sourceFamily || sourceFamily === canonical(productFamily(product));
    },
  };
}

// Established Ruscus Green shorthand, preserving the size instead of merging 40cm.
export function ruscusAliases(product) {
  if (productFamily(product) !== 'ruscus') return [];
  const match = String(product.ProdName || '').trim().match(/^ruscus\s+green(?:\s+(\d+)\s*cm)?$/i);
  return match ? [`루스커스${match[1] ? ` ${match[1]}cm` : ''}`, `Ruscus${match[1] ? ` ${match[1]}cm` : ''}`] : [];
}

export function normalizeImportWeek(week) {
  try {
    return normalizeOrderWeek(week);
  } catch {
    const raw = String(week || '').trim();
    const m = raw.match(/^(\d{1,2})-(\d{1,2})$/);
    if (m) return `${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    const ym = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (ym) return `${ym[2].padStart(2, '0')}-${ym[3].padStart(2, '0')}`;
    throw new Error(`Invalid order week: ${raw}`);
  }
}

// Dutch Pivot has the flower/species in productLabel and the actual ERP item
// in productColor. Match only a unique exact item name within that species;
// a species-only fallback could silently SET the wrong shipment to zero.
export function matchDutchProductByColor(products, row) {
  const species = normText(row?.productLabel);
  const color = normText(row?.productColor);
  if (!species || !color) return null;
  const matched = new Map();
  for (const product of products || []) {
    if (normText(product.FlowerName) !== species) continue;
    const aliases = [product.ProdName, product.DisplayName,
      cleanPivotProdName(product.ProdName, product.FlowerName),
      volumeProdLabel({ prodName: product.ProdName, flower: product.FlowerName }),
      volumeProdLabel({ prodName: cleanPivotProdName(product.ProdName, product.FlowerName), flower: product.FlowerName })];
    if (product.DisplayName) {
      aliases.push(cleanPivotProdName(product.DisplayName, product.FlowerName));
      aliases.push(volumeProdLabel({ prodName: product.DisplayName, flower: product.FlowerName }));
      aliases.push(volumeProdLabel({ prodName: cleanPivotProdName(product.DisplayName, product.FlowerName), flower: product.FlowerName }));
    }
    // The upload may omit only the terminal Netherlands country marker.
    // Keep cultivar, grade, length and color intact; collisions still fail closed.
    if (normText(product.CounName) === normText('네덜란드')) {
      for (const name of [...aliases]) {
        if (/\s*\(NL\)\s*$/i.test(String(name || ''))) aliases.push(String(name).replace(/\s*\(NL\)\s*$/i, '').trim());
      }
    }
    for (const name of aliases) {
      if (normText(name) === color) {
        matched.set(Number(product.ProdKey), product);
        break;
      }
    }
  }
  return matched.size === 1 ? [...matched.values()][0] : null;
}

export function customerAliases(customer) {
  return [customer.CustName, customer.OrderCode, customerExportName(customer)].filter(Boolean);
}

export function normalizeCustomerLabel(label) {
  const raw = String(label || '').trim();
  return IMPORT_CUSTOMER_ALIASES[raw] || raw;
}

export function asImportNumber(value) {
  if (value == null || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

export function sameQty(a, b) {
  return Math.abs(asImportNumber(a) - asImportNumber(b)) < 0.0001;
}

export function isNetherlandsProduct(product = {}) {
  return /네덜란드|netherlands|holland|dutch/i.test(String(product.CounName || ''));
}

export function extractMoqText(product = {}) {
  if (!isNetherlandsProduct(product)) return '';
  const descr = String(product.ProdDescr || product.Descr || '').trim();
  if (!descr) return '';
  const line = descr.split(/\r?\n/).find(v => /moq|엠오큐|최소/i.test(v)) || '';
  const m = line.match(/(?:moq|엠오큐|최소)\s*[:：=]?\s*([^,;/\n]+)/i);
  return (m ? `MOQ ${m[1].trim()}` : line.trim()).trim();
}

export function resolvePreviewOverrideMaps({ customerOverrides, productOverrides, parsedRows, fileBasedScope }) {
  const overrideMap = new Map();
  const ignoredCustomerLabels = new Set();
  for (const [rawLabel, ck] of Object.entries(customerOverrides || {})) {
    if (isImportIgnoreCustomerValue(ck)) {
      ignoredCustomerLabels.add(normText(rawLabel));
      continue;
    }
    const k = normText(rawLabel);
    const num = Number(ck);
    if (k && num) overrideMap.set(k, num);
  }
  const productOverrideMap = new Map();
  const skippedProductLabels = new Set();
  for (const [rawKey, pk] of Object.entries(productOverrides || {})) {
    if (isImportSkipProductValue(pk)) { skippedProductLabels.add(String(rawKey)); continue; }
    const num = typeof pk === 'number' || typeof pk === 'string' ? Number(pk) : NaN;
    if (rawKey && pk !== '' && pk != null) productOverrideMap.set(String(rawKey), num);
  }
  const ambiguousProductChoices = new Set();
  if (fileBasedScope) {
    const identity = key => key.slice(0, key.lastIndexOf('|'));
    const sourceKeys = new Map();
    const currentKeys = new Set();
    for (const row of parsedRows) {
      const key = importProductOverrideKey(row);
      currentKeys.add(key);
      const legacyKey = importProductOverrideKey({ ...row, rawProductLabel: '' });
      for (const id of new Set([identity(key), identity(legacyKey)])) {
        if (!sourceKeys.has(id)) sourceKeys.set(id, new Set());
        sourceKeys.get(id).add(key);
      }
    }
    const savedForSource = new Map();
    for (const key of [...productOverrideMap.keys(), ...skippedProductLabels]) {
      const sources = sourceKeys.get(identity(key));
      for (const source of sources || []) {
        if (!savedForSource.has(source)) savedForSource.set(source, []);
        savedForSource.get(source).push({ key, ambiguous: sources.size !== 1 });
      }
    }
    for (const key of currentKeys) {
      if (productOverrideMap.has(key) || skippedProductLabels.has(key)) continue;
      const saved = savedForSource.get(key);
      if (!saved) continue;
      if (saved.length !== 1 || saved[0].ambiguous) {
        ambiguousProductChoices.add(key);
        continue;
      }
      const oldKey = saved[0].key;
      if (skippedProductLabels.has(oldKey)) skippedProductLabels.add(key);
      else productOverrideMap.set(key, productOverrideMap.get(oldKey));
    }
  }
  return { overrideMap, ignoredCustomerLabels, productOverrideMap, skippedProductLabels, ambiguousProductChoices };
}

export function matchAndMergePreviewRows({
  parsedRows,
  week,
  products,
  customers,
  dbRows,
  strictMatching,
  fileBasedScope,
  importMode,
  cleanProductName,
  overrideMap,
  ignoredCustomerLabels,
  productOverrideMap,
  skippedProductLabels,
  ambiguousProductChoices,
}) {
  const productByKey = new Map(products.map(p => [Number(p.ProdKey), p]));
  const customerByKey = new Map(customers.map(c => [Number(c.CustKey), c]));

  const prodIndex = new Map();
  const fullNameIndex = new Map();
  const volumeLabelIndex = new Map();
  const addProdKey = (key, product) => {
    if (!key) return;
    if (!prodIndex.has(key)) prodIndex.set(key, []);
    const list = prodIndex.get(key);
    if (!list.some(p => p.ProdKey === product.ProdKey)) list.push(product);
  };
  for (const p of products) {
    for (const name of [p.ProdName, p.DisplayName].filter(Boolean)) {
      const key = normText(volumeProdLabel({ prodName: name, flower: p.FlowerName }));
      if (!key) continue;
      if (!volumeLabelIndex.has(key)) volumeLabelIndex.set(key, []);
      const list = volumeLabelIndex.get(key);
      if (!list.some(other => other.ProdKey === p.ProdKey)) list.push(p);
    }
    for (const label of [p.ProdName, p.DisplayName, ...ruscusAliases(p)].filter(Boolean)) {
      const key = normText(label);
      if (!fullNameIndex.has(key)) fullNameIndex.set(key, []);
      if (!fullNameIndex.get(key).some(other => other.ProdKey === p.ProdKey)) fullNameIndex.get(key).push(p);
    }
    const keys = [p.ProdName, p.DisplayName, cleanProductName(p.ProdName), cleanProductName(p.DisplayName), ...ruscusAliases(p)]
      .filter(Boolean)
      .map(normText);
    for (const key of keys) addProdKey(key, p);
  }

  const custMap = new Map();
  const duplicateCustKeys = new Set();
  for (const c of customers) {
    const keys = customerAliases(c).map(normText);
    for (const key of keys) {
      if (!key) continue;
      if (custMap.has(key) && custMap.get(key).CustKey !== c.CustKey) {
        duplicateCustKeys.add(key);
        continue;
      }
      if (!duplicateCustKeys.has(key)) custMap.set(key, c);
    }
  }
  for (const key of duplicateCustKeys) custMap.delete(key);

  const dbMap = new Map();
  const weekCustomerKeys = new Set();
  for (const row of dbRows) {
    dbMap.set(`${row.CustKey}|${row.ProdKey}`, row);
    weekCustomerKeys.add(row.CustKey);
  }
  const weekCustomers = customers.filter(c => weekCustomerKeys.has(c.CustKey));

  const uniqueFuzzy = (list, label, fields) => {
    const key = normText(label);
    if (!key) return null;
    const matches = list.filter(item => fields.some(field => {
      const v = normText(item[field]);
      return v && (v === key || v.startsWith(key) || v.includes(key) || key.includes(v));
    }));
    return matches.length === 1 ? matches[0] : null;
  };

  const scoreProduct = (product, row, exactKeys, customer) => {
    let score = 0;
    if (customer && dbMap.has(`${customer.CustKey}|${product.ProdKey}`)) score += 200;
    const family = productFamily(product);
    if (row.productFamily && family === row.productFamily) score += 100;
    else if (row.productFamily && family) score -= 30;
    const productKeys = [product.ProdName, product.DisplayName, cleanProductName(product.ProdName), cleanProductName(product.DisplayName)]
      .filter(Boolean)
      .map(normText);
    if (productKeys.some(k => exactKeys.has(k))) score += 50;
    score -= normText(product.ProdName).length / 1000;
    return score;
  };

  const suggestCustomerCandidates = (label, limit = 5) => {
    const key = normText(label);
    if (!key) return [];
    const weekSet = new Set(weekCustomers.map(c => c.CustKey));
    const scoreCustomer = (c) => {
      let score = 0;
      for (const field of customerAliases(c).map(normText)) {
        if (!field) continue;
        if (field === key) score += 100;
        else if (field.startsWith(key) || key.startsWith(field)) score += 65;
        else if (field.includes(key) || key.includes(field)) score += 35;
      }
      if (weekSet.has(c.CustKey)) score += 25;
      return score;
    };
    return customers
      .map(c => ({
        custKey: c.CustKey,
        custName: c.CustName,
        orderCode: c.OrderCode || '',
        area: c.CustArea || '',
        score: scoreCustomer(c),
      }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  };

  const headingIndex = indexSourceHeadings(products);
  const sourceScopes = new WeakMap();
  const sourceScope = row => {
    if (!sourceScopes.has(row)) sourceScopes.set(row, buildSourceProductScope(row, headingIndex));
    return sourceScopes.get(row);
  };
  const compatible = (row, product) => !fileBasedScope || sourceScope(row).allows(product);
  const fullProductCandidates = row => row.sourceType === 'dutch-volume' ? []
    : (fullNameIndex.get(normText(row.rawProductLabel || row.productLabel)) || []).filter(p => compatible(row, p));

  const suggestProductCandidates = (row, customer, limit = 5) => {
    const exactKeys = new Set([normText(row.productLabel), normText(cleanProductName(row.productLabel))].filter(Boolean));
    const originals = fullProductCandidates(row);
    const pool = (originals.length > 1 ? originals : products).filter(p => compatible(row, p));
    return pool
      .map(p => ({
        prodKey: p.ProdKey,
        prodName: p.ProdName,
        displayName: p.DisplayName || '',
        countryName: p.CounName || '', flowerName: p.FlowerName || '',
        hasCurrentOrder: customer ? Number(dbMap.get(`${customer.CustKey}|${p.ProdKey}`)?.orderQty || 0) > 0 : undefined,
        outUnit: p.OutUnit || '박스',
        score: scoreProduct(p, row, exactKeys, customer),
      }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  };

  const uniqueProductInContext = (candidates, row, customer) => {
    if (candidates.length === 1) return candidates[0];
    if (!candidates.length) return null;
    const hints = new Set([...(row.productHeadings || []), row.sheetName].filter(Boolean).map(normText));
    const country = candidates.filter(p => p.CountryFlower && hints.has(normText(p.CountryFlower)));
    const headed = country.length ? country : candidates.filter(p => p.FlowerName && hints.has(normText(p.FlowerName)));
    if (headed.length === 1) return headed[0];
    const sameFamily = row.productFamily ? candidates.filter(p => productFamily(p) === row.productFamily) : [];
    const scoped = headed.length ? headed : sameFamily.length ? sameFamily : candidates;
    if (scoped.length === 1) return scoped[0];
    const ordered = customer ? scoped.filter(p => Number(dbMap.get(`${customer.CustKey}|${p.ProdKey}`)?.orderQty || 0) > 0) : [];
    return ordered.length === 1 ? ordered[0] : null;
  };

  const productFuzzy = (pool, label) => {
    if (!fileBasedScope) return uniqueFuzzy(pool, label, ['ProdName', 'DisplayName']);
    const key = normText(label);
    if (!key) return null;
    const matches = pool.filter(p => {
      const generic = new Set([normText(p.FlowerName), 'rose', '장미', 'carnation', '카네이션', 'minicarnation', '미니카네이션', 'hydrangea', '수국', 'alstromeria', 'alstroemeria', '알스트로', 'ruscus', '루스커스']);
      return [p.ProdName, p.DisplayName].some(name => {
        const value = normText(name);
        return value && (value === key || (!generic.has(value) && (value.startsWith(key) || value.includes(key) || key.includes(value))));
      });
    });
    return matches.length === 1 ? matches[0] : null;
  };

  const chooseProduct = (row, customer) => {
    const fullMatches = fullProductCandidates(row);
    if (fileBasedScope && fullMatches.length) return uniqueProductInContext(fullMatches, row, customer);
    if (fileBasedScope && row.sourceType !== 'dutch-volume') {
      const exported = (volumeLabelIndex.get(normText(row.rawProductLabel || row.productLabel)) || [])
        .filter(p => compatible(row, p));
      if (exported.length) return uniqueProductInContext(exported, row, customer);
    }
    if (strictMatching) {
      if (row.sourceType === 'dutch-volume' && String(row.productColor || '').trim()) {
        return matchDutchProductByColor(products, row);
      }
      const labels = [
        [row.productLabel, row.productColor].filter(Boolean).join(' '),
        row.productLabel,
      ];
      for (const label of labels) {
        const exact = new Map();
        for (const key of [normText(label), normText(cleanProductName(label))].filter(Boolean)) {
          for (const product of prodIndex.get(key) || []) exact.set(Number(product.ProdKey), product);
        }
        if (exact.size === 1) return [...exact.values()][0];
        if (exact.size > 1) return null;
      }
      return productFuzzy(products, row.productLabel);
    }
    const exactKeys = new Set([normText(row.productLabel), normText(cleanProductName(row.productLabel))].filter(Boolean));
    const exactCandidates = [];
    for (const key of exactKeys) {
      for (const p of prodIndex.get(key) || []) {
        if (compatible(row, p) && !exactCandidates.some(x => x.ProdKey === p.ProdKey)) exactCandidates.push(p);
      }
    }
    if (fileBasedScope && row.productFamilySource === 'heading' && exactCandidates.length === 1) return exactCandidates[0];
    const familyCandidates = row.productFamily
      ? exactCandidates.filter(p => productFamily(p) === row.productFamily)
      : exactCandidates;
    const candidates = fileBasedScope && row.productFamily ? familyCandidates : (familyCandidates.length ? familyCandidates : exactCandidates);
    if (candidates.length) {
      if (fileBasedScope) return uniqueProductInContext(candidates, row, customer);
      if (strictMatching && candidates.length !== 1) return null;
      return candidates
        .map(p => ({ product: p, score: scoreProduct(p, row, exactKeys, customer) }))
        .sort((a, b) => b.score - a.score)[0].product;
    }

    const fuzzy = productFuzzy(
      row.productFamily ? products.filter(p => productFamily(p) === row.productFamily) : products,
      cleanProductName(row.productLabel)
    );
    return fuzzy || (fileBasedScope && row.productFamily ? null : productFuzzy(products, cleanProductName(row.productLabel)));
  };

  const merged = new Map();
  const custOrderByKey = new Map();
  const unmatched = [];
  const duplicateProductReviews = new Map();
  const aliasHits = {};
  const uploadedProductKeys = new Set();
  const replacementCategories = new Set();
  const evidencedProductKeys = new Set();
  let skippedOtherWeek = 0;
  let skippedIgnoredCustomerCount = 0;
  const skippedProducts = new Map();
  const skippedKnownKeys = new Set();

  for (let row of parsedRows) {
    if (row.week) {
      let rowWeek = '';
      try { rowWeek = normalizeImportWeek(row.week); } catch {}
      if (rowWeek && rowWeek !== week) {
        skippedOtherWeek += 1;
        continue;
      }
    }
    if (isRowFromIgnoredCustomer(row.customerLabel, normalizeCustomerLabel(row.customerLabel), ignoredCustomerLabels)) {
      skippedIgnoredCustomerCount += 1;
      continue;
    }
    const choiceKey = importProductOverrideKey(row);
    if (ambiguousProductChoices.has(choiceKey)) {
      unmatched.push({ ...row, reason: '이전 품목 선택을 구분할 수 없습니다. 품목 연결 또는 건너뛰기를 다시 선택하세요.', matchKind: 'product', productOverrideKey: choiceKey });
      continue;
    }
    if (skippedProductLabels.has(choiceKey)) {
      const prev = skippedProducts.get(choiceKey);
      skippedProducts.set(choiceKey, { key: choiceKey, sheetName: row.sheetName || '', productLabel: row.productLabel || '', count: (prev?.count || 0) + 1 });
      if (Number(row.prodKey) > 0) skippedKnownKeys.add(Number(row.prodKey));
      const original = fullProductCandidates(row);
      if (original.length) for (const p of original) skippedKnownKeys.add(Number(p.ProdKey));
      else {
        const label = normText(cleanProductName(row.productLabel));
        for (const p of products) if (label && [p.ProdName, p.DisplayName].some(n => normText(cleanProductName(n)) === label)) skippedKnownKeys.add(Number(p.ProdKey));
      }
      continue;
    }
    const customerLabel = normalizeCustomerLabel(row.customerLabel);
    const excelQty = asImportNumber(row.uploadQty);
    const excelUnit = String(row.outUnit || '').trim();
    const excelOrderQtyRaw = asImportNumber(row.orderQty);
    if (customerLabel !== row.customerLabel && excelQty !== 0) {
      const aliasKey = `${row.customerLabel}→${customerLabel}`;
      if (!aliasHits[aliasKey]) aliasHits[aliasKey] = { count: 0, qty: 0 };
      aliasHits[aliasKey].count += 1;
      aliasHits[aliasKey].qty += excelQty;
    }
    const explicitCustKey = Number(row.custKey || 0);
    const explicitProdKey = Number(row.prodKey || 0);
    if (strictMatching && ((row.custKey != null && row.custKey !== '' && (!Number.isSafeInteger(explicitCustKey) || explicitCustKey <= 0 || !customerByKey.has(explicitCustKey))) ||
      (!productOverrideMap.has(choiceKey) && row.prodKey != null && row.prodKey !== '' && (!Number.isSafeInteger(explicitProdKey) || explicitProdKey <= 0 || !productByKey.has(explicitProdKey))))) {
      unmatched.push({ ...row, reason: '명시 선택한 업체/품목 키가 유효하지 않음', matchKind: 'invalid_explicit_key' });
      continue;
    }
    const overrideCustKey = resolveImportCustomerOverrideKey(row.customerLabel, customerLabel, overrideMap);
    const sourceMajor = String(row.customerLabel ?? '').match(/(?:^|\D)(\d{1,2})\s*차/)?.[1];
    if (row.shipmentDateHeader && sourceMajor && Number(sourceMajor) !== Number(week.slice(0, 2))
      && !overrideMap.has(normText(row.customerLabel))) {
      if (excelQty > 0) unmatched.push({
        ...row, reason: `원문 열은 ${sourceMajor}차이고 선택한 차수는 ${week}입니다. 이 열의 업체를 선택하거나 제외하세요.`,
        matchKind: 'customer', suggestedCustomers: suggestCustomerCandidates(customerLabel),
      });
      continue;
    }
    const customer = (explicitCustKey ? customerByKey.get(explicitCustKey) : null) ||
      (overrideCustKey
        ? customerByKey.get(Number(overrideCustKey)) || null
        : strictMatching && row.sourceType === 'dutch-volume'
        ? matchDutchCustomer(customers, row.customerLabel)
        : custMap.get(normText(customerLabel)) ||
          uniqueFuzzy(weekCustomers, customerLabel, ['CustName', 'OrderCode', 'Descr']) ||
          uniqueFuzzy(customers, customerLabel, ['CustName', 'OrderCode', 'Descr']));
    const overrideProdKey = productOverrideMap.get(importProductOverrideKey(row));
    const manualChoice = productOverrideMap.has(choiceKey);
    const product = manualChoice
      ? (Number.isSafeInteger(overrideProdKey) && overrideProdKey > 0 ? productByKey.get(overrideProdKey) : null)
      : (explicitProdKey ? productByKey.get(explicitProdKey) : null) || chooseProduct(row, customer);
    const originalCandidates = fileBasedScope ? fullProductCandidates(row) : [];
    if (originalCandidates.length > 1) {
      const reviewKey = importProductOverrideKey(row);
      if (!duplicateProductReviews.has(reviewKey)) duplicateProductReviews.set(reviewKey, {
        key: reviewKey, productLabel: row.rawProductLabel || row.productLabel,
        sheetName: row.sheetName, selectedProdKeys: [], candidates: originalCandidates.map(p => ({
          prodKey: p.ProdKey, prodName: p.ProdName, displayName: p.DisplayName,
          countryName: p.CounName, flowerName: p.FlowerName, outUnit: p.OutUnit,
          hasCurrentOrder: false,
        })),
      });
      const review = duplicateProductReviews.get(reviewKey);
      if (product && !review.selectedProdKeys.includes(product.ProdKey)) review.selectedProdKeys.push(product.ProdKey);
      for (const candidate of review.candidates) {
        if (customer && Number(dbMap.get(`${customer.CustKey}|${candidate.prodKey}`)?.orderQty || 0) > 0) candidate.hasCurrentOrder = true;
      }
    }
    const conflictingWorkbookKey = product && !manualChoice && (
      (originalCandidates.length && !originalCandidates.some(p => p.ProdKey === product.ProdKey)) ||
      (row.productFamily && productFamily(product) !== row.productFamily && chooseProduct(row, customer)?.ProdKey !== product.ProdKey));
    if (fileBasedScope && product && (!compatible(row, product) || conflictingWorkbookKey)) {
      unmatched.push({ ...row, reason: '원본 국가·품종과 연결 품목이 다릅니다. 원본 품목을 확인하세요.', matchKind: 'product', productOverrideKey: importProductOverrideKey(row), suggestedProducts: suggestProductCandidates(row, customer) });
      continue;
    }
    if (!product || !customer) {
      if (excelQty !== 0 || row.hasFinalDistributionDirective) {
        const { reason, matchKind } = classifyImportUnmatchedReason(!!customer, !!product);
        unmatched.push({
          ...row,
          reason: !product && customer && originalCandidates.length > 1 ? '동일한 이름의 DB 품목이 여러 개입니다. 국가·품종·품목코드를 확인해 연결해 주세요.' : reason,
          matchKind,
          productOverrideKey: importProductOverrideKey(row),
          suggestedCustomers: customer ? [] : suggestCustomerCandidates(customerLabel),
          suggestedProducts: product ? [] : suggestProductCandidates(row, customer),
        });
      }
      continue;
    }
    if (fileBasedScope && sourceScope(row).hasSpeciesEvidence) {
      evidencedProductKeys.add(Number(product.ProdKey));
    }
    if (fileBasedScope) row = { ...row, productFamily: productFamily(product) || row.productFamily };
    const quantityMultiplier = isAlstroImportRow(row) && row.alstroErpQuantity !== true ? 16 : 1;
    const dbEarly = dbMap.get(`${customer.CustKey}|${product.ProdKey}`) || {};
    const uploadQty = normalizeImportInput(
      {
        ...row,
        excelQty,
        excelUnit,
        uploadQty: excelQty,
        orderQty: Number(dbEarly.orderQty || 0),
        currentOutQty: Number(dbEarly.currentOutQty || 0),
      },
      product, importMode
    );
    uploadedProductKeys.add(Number(product.ProdKey));
    if (String(product.CountryFlower || '').trim()) replacementCategories.add(String(product.CountryFlower).trim());
    const rowCustOrder = Number.isFinite(Number(row.custOrder)) ? Number(row.custOrder) : Infinity;
    const rowSortRow = Number.isFinite(Number(row.rowNo)) ? Number(row.rowNo) : Infinity;
    const key = `${customer.CustKey}|${product.ProdKey}`;
    const shipmentDateSource = uploadQty > 0 && { header: row.shipmentDateHeader || '', quantity: uploadQty };
    const prior = merged.get(key);
    if (prior) {
      if (isAlstroImportRow(row) && prior.alstroErpQuantity !== (row.alstroErpQuantity === true)) {
        throw new Error('같은 알스트로 품목에 기존 박스수량 형식과 ERP 수량 형식이 섞여 있습니다. 수량 기준을 동일하게 맞춘 전체 물량표로 다시 검증하세요.');
      }
      prior.uploadQty += uploadQty;
      if (shipmentDateSource) prior.shipmentDateSources.push(shipmentDateSource);
      prior.excelQty += excelQty;
      prior.excelOrderQtyRaw = (prior.excelOrderQtyRaw || 0) + excelOrderQtyRaw;
      if (prior.excelOrderQty == null) prior.excelOrderQty = Number(row.orderQty || 0);
      if (prior.excelIncomingQty == null) prior.excelIncomingQty = Number(row.incomingQty || 0);
      if (prior.excelStockQty == null) prior.excelStockQty = Number(row.stockQty || 0);
      if (prior.excelRemainingQty == null) prior.excelRemainingQty = Number(row.remainingQty || 0);
      if (excelUnit && !prior.excelUnit) prior.excelUnit = excelUnit;
      if (row.sourceType === 'weekPivot') prior.sourceType = 'weekPivot';
      if (row.productFamily && !prior.productFamily) prior.productFamily = row.productFamily;
      if (row.sheetName && !prior.sheetName) prior.sheetName = row.sheetName;
      if (row.productLabel && !prior.productLabel) prior.productLabel = row.productLabel;
      prior.quantityMultiplier = Math.max(prior.quantityMultiplier || 1, quantityMultiplier);
      prior.cells.push(`${row.sheetName}!R${row.rowNo}C${row.colNo}`);
      prior.sourceCustomerLabels = [...new Set([...(prior.sourceCustomerLabels || []), row.customerLabel])];
      if (row.entryId != null) prior.entryIds.push(String(row.entryId));
      prior.sortCust = Math.min(prior.sortCust, rowCustOrder);
      prior.sortRow = Math.min(prior.sortRow, rowSortRow);
    } else {
      const db = dbMap.get(key) || {};
      merged.set(key, {
        key,
        week,
        custKey: customer.CustKey,
        custName: customer.CustName,
        orderCode: customer.OrderCode || '',
        prodKey: product.ProdKey,
        prodName: product.ProdName,
        displayName: product.DisplayName || '',
        outUnit: product.OutUnit || '박스',
        bunchOf1Box: Number(product.BunchOf1Box || 0),
        steamOf1Bunch: Number(product.SteamOf1Bunch || 0),
        steamOf1Box: Number(product.SteamOf1Box || 0),
        orderQty: Number(db.orderQty || 0),
        currentOutQty: Number(db.currentOutQty || 0),
        shipmentDateIssueCount: Number(db.shipmentDateIssueCount || 0),
        shipmentDateSources: shipmentDateSource ? [shipmentDateSource] : [],
        uploadQty,
        excelQty,
        excelUnit,
        alstroErpQuantity: row.alstroErpQuantity === true,
        excelOrderQtyRaw,
        excelOrderQty: Number(row.orderQty || 0),
        excelIncomingQty: Number(row.incomingQty || 0),
        excelStockQty: Number(row.stockQty || 0),
        excelRemainingQty: Number(row.remainingQty || 0),
        sourceType: row.sourceType || '',
        productFamily: row.productFamily || inferImportProductFamily(product.ProdName, product.DisplayName, product.FlowerName),
        sheetName: row.sheetName || '',
        productLabel: row.productLabel || '',
        quantityMultiplier,
        sortCust: rowCustOrder,
        sortRow: rowSortRow,
        cells: [`${row.sheetName}!R${row.rowNo}C${row.colNo}`],
        sourceCustomerLabels: [...new Set([row.customerLabel, customerExportName(customer)])],
        entryIds: row.entryId == null ? [] : [String(row.entryId)],
      });
    }
    const prevOrder = custOrderByKey.get(Number(customer.CustKey));
    if (prevOrder == null || rowCustOrder < prevOrder) custOrderByKey.set(Number(customer.CustKey), rowCustOrder);
  }

  let missingFromExcelCount = 0;
  if ([...uploadedProductKeys].some(key => skippedKnownKeys.has(key))) {
    throw Object.assign(new Error('같은 DB 품목이 적용과 건너뛰기에 함께 선택되었습니다. 품목 연결을 확인하세요.'), { statusCode: 409 });
  }
  const replacementProductKeys = importMode !== 'REPLACE' || skippedProducts.size
    ? new Set(uploadedProductKeys)
    : buildReplacementProductKeys(products, uploadedProductKeys, fileBasedScope ? evidencedProductKeys : uploadedProductKeys);
  for (const db of dbRows) {
    if (importMode !== 'REPLACE') break;
    const key = `${db.CustKey}|${db.ProdKey}`;
    if (merged.has(key)) continue;
    if (!replacementProductKeys.has(Number(db.ProdKey))) continue;
    const customer = customerByKey.get(Number(db.CustKey));
    const product = productByKey.get(Number(db.ProdKey));
    if (!customer || !product) continue;
    missingFromExcelCount += 1;
    merged.set(key, {
      key,
      week,
      custKey: customer.CustKey,
      custName: customer.CustName,
      orderCode: customer.OrderCode || '',
      prodKey: product.ProdKey,
      prodName: product.ProdName,
      displayName: product.DisplayName || '',
      outUnit: product.OutUnit || '박스',
      orderQty: Number(db.orderQty || 0),
      currentOutQty: Number(db.currentOutQty || 0),
      shipmentDateIssueCount: Number(db.shipmentDateIssueCount || 0),
      uploadQty: 0,
      excelQty: 0,
      quantityMultiplier: 1,
      missingFromExcel: true,
      sortCust: custOrderByKey.get(Number(db.CustKey)) ?? Infinity,
      sortRow: Infinity,
      cells: ['엑셀누락'],
    });
  }

  return {
    productByKey,
    dbMap,
    merged,
    unmatched,
    duplicateProductReviews,
    aliasHits,
    replacementCategories,
    replacementProductKeys,
    skippedOtherWeek,
    skippedIgnoredCustomerCount,
    skippedProducts,
    missingFromExcelCount,
  };
}
