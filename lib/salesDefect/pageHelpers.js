// 영업수입불량차감 화면(`pages/sales/defect-deductions.js`) 순수 포맷터·집계·초기화 도우미
import { getCurrentWeek } from '../useWeekInput.js';
import { suggestDisplayName } from '../displayName.js';
import { isNoopDeductionHistory } from '../salesDefectDeductionCore.js';

export const fmt = (n) => Number(n || 0).toLocaleString();

export const buildExistingEstimateLabel = (record = {}) => {
  const estimateKey = Number(record.estimateKey ?? record.EstimateKey ?? 0);
  const type = record.estimateTypeLabel || record.estimateType || record.EstimateType || '불량차감';
  const product = record.productName || record.prodName || record.ProdName || '품목 미확인';
  const quantity = Number(record.quantity ?? record.Quantity ?? 0);
  const unit = record.unit || record.Unit || '';
  const week = record.orderWeek || record.OrderWeek || '';
  const cost = Number(record.cost ?? record.Cost ?? 0);
  const amount = Number(record.amount ?? record.Amount ?? 0);
  const date = String(record.estimateDtm || record.EstimateDtm || '').slice(0, 10);
  const descr = record.descr || record.Descr || '';
  return `${estimateKey > 0 ? `#${estimateKey} · ` : ''}${type} · ${product} · ${fmt(Math.abs(quantity))}${unit}${cost ? ` · 단가 ${fmt(cost)}원` : ''}${amount ? ` · 금액 ${fmt(amount)}원` : ''}${week ? ` · ${week}차` : ''}${date ? ` · ${date}` : ''}${descr ? ` · ${descr}` : ''}`;
};

export const usageLabel = (item) => {
  const count = Number(item?.UsageCount ?? item?.usageCount ?? 0);
  const mappingCount = Number(item?.MappingCount ?? item?.mappingCount ?? 0);
  const labels = [];
  if (count > 0) labels.push(`사용 ${fmt(count)}회`);
  if (mappingCount > 0) labels.push(`붙여넣기 매칭 ${fmt(mappingCount)}건`);
  return labels.length ? ` · ${labels.join(' · ')}` : '';
};

export const productSearchLabel = (item) => {
  const dbName = item?.ProdName || item?.prodName || '';
  const displayName = item?.DisplayName || item?.displayName || '';
  const suggested = item?.SuggestedDisplayName || item?.suggestedDisplayName || suggestDisplayName(dbName);
  const countryFlower = [item?.CounName || item?.counName, item?.FlowerName || item?.flowerName].filter(Boolean).join(' ');
  const names = [dbName, displayName, suggested].filter((name, index, all) => name && all.indexOf(name) === index);
  return [countryFlower, ...names].filter(Boolean).join(' · ');
};

export const historyJson = (value) => {
  try { return value ? JSON.parse(value) : null; } catch { return null; }
};

export const isMatchingHistory = (item) => {
  if (isNoopDeductionHistory(item)) return false;
  if (/매칭|MATCH/i.test(String(item?.ChangeSummary || ''))) return true;
  const before = historyJson(item?.BeforeJson);
  const after = historyJson(item?.AfterJson);
  if (!after) return false;
  if (!before) return Boolean(after.custKey || after.prodKey);
  return Number(before.custKey || 0) !== Number(after.custKey || 0)
    || Number(before.prodKey || 0) !== Number(after.prodKey || 0);
};

export const matchingHistoryText = (item) => {
  const summary = String(item?.ChangeSummary || '');
  if (/매칭|MATCH/i.test(summary)) return summary;
  const after = historyJson(item?.AfterJson);
  if (!after?.prodKey && !after?.custKey) return summary;
  const product = [after.countryName, after.matchedFlowerName || after.productName, after.matchedProductDbName || after.matchedProductName]
    .filter(Boolean).join(' ');
  const customer = after.customerName ? `거래처 ${after.customerName} (#${after.custKey || '-'})` : '';
  return `${summary}${customer || product ? ` · ${customer}${customer && product ? ' · ' : ''}${product ? `품목 ${product} (#${after.prodKey || '-'})` : ''}` : ''}`;
};

export const UNIT_OPTIONS = [
  { value: '단', label: '단' },
  { value: '박스', label: '박스' },
  { value: '스팀(대)', label: '스팀' },
];

export const unitPosition = (row) => {
  const value = String(row?.sourceUnit || row?.unit || '단');
  const position = UNIT_OPTIONS.findIndex((item) => item.value === value);
  return position >= 0 ? position : 0;
};

export const createEmptyDefectRow = (overrides = {}) => ({
  deductionKey: null,
  sourceFileName: '',
  customerName: '',
  custKey: null,
  productName: '',
  prodKey: null,
  colorName: '',
  quantity: '',
  sourceUnit: '단',
  unit: '단',
  matchedProductName: '',
  matchedProductDbName: '',
  countryName: '',
  matchedFlowerName: '',
  creditApplied: false,
  farmName: '',
  farmKey: null,
  note: '',
  status: 'DRAFT',
  estimateKey: null,
  estimateCost: null,
  customerSuggestions: [],
  productSuggestions: [],
  ...overrides,
});

export const hasSalesDefectRowInput = (row = {}) => Boolean(
  String(row.customerName || '').trim()
  || String(row.productName || '').trim()
  || String(row.colorName || '').trim()
  || String(row.quantity ?? '').trim()
  || String(row.estimateQuantity ?? '').trim()
  || String(row.note || '').trim()
  || row.custKey
  || row.prodKey
);

export function initialScope() {
  const parts = String(getCurrentWeek() || '').split('-');
  return {
    year: parts.length === 3 ? parts[0] : String(new Date().getFullYear()),
    week: parts.length === 3 ? String(Number(parts[1])) : String(Number(parts[0]) || 1),
  };
}

export function valueOf(row, key) {
  return row[key] == null ? '' : row[key];
}

export const printQuantity = (row) => {
  if (!row || row.quantity == null || row.quantity === '') return '';
  const quantity = Number(row.quantity);
  const value = Number.isFinite(quantity) && Number.isInteger(quantity) ? fmt(quantity) : String(row.quantity);
  return `${value}${row.sourceUnit || row.unit || ''}`;
};

export function deriveVisibleManagerOptions(managerOptions, currentUser) {
  const normalizeName = (value) => String(value || '').toLowerCase().replace(/\s+/g, '').trim();
  const map = new Map();
  const names = new Set();
  (managerOptions || []).forEach((item) => {
    const nameKey = normalizeName(item.managerName || item.managerId);
    if (!nameKey || names.has(nameKey)) return;
    names.add(nameKey);
    map.set(String(item.managerId), item);
  });
  const userId = String(currentUser?.userId || '').trim();
  const userName = String(currentUser?.userName || userId).trim();
  const userNameKey = normalizeName(userName);
  if (userId && !map.has(userId) && !names.has(userNameKey)) {
    map.set(userId, { managerId: userId, managerName: userName });
  }
  return [...map.values()];
}

export function deriveManagerQuickOptions(visibleManagerOptions) {
  const defaults = [
    { managerId: '', managerName: '전체' },
    { managerId: '김원영', managerName: '김원영' },
    { managerId: '박성수', managerName: '박성수' },
    { managerId: '정재훈', managerName: '정재훈' },
    { managerId: '조현욱', managerName: '조현욱' },
  ];
  const result = [...defaults];
  const names = new Set(defaults.map((item) => String(item.managerName).replace(/\s+/g, '').toLowerCase()));
  (visibleManagerOptions || []).forEach((item) => {
    const name = String(item.managerName || item.managerId || '').trim();
    const key = name.replace(/\s+/g, '').toLowerCase();
    if (!key || names.has(key)) return;
    names.add(key);
    result.push({ managerId: String(item.managerId || name), managerName: name });
  });
  return result;
}

export function deriveCarryoverCustomerGroups(supportRows) {
  return [...(supportRows || []).reduce((map, row) => {
    const key = Number(row.custKey || 0);
    if (!map.has(key)) map.set(key, { custKey: key, customerName: row.customerName || '-', rows: [], remaining: 0 });
    const group = map.get(key);
    group.rows.push(row);
    group.remaining += Number(row.remainingQuantity || 0);
    return map;
  }, new Map()).values()];
}

export function buildDefectPrintSections({ activeTab, rows, currentUserName, displayedIncomingRows }) {
  if (activeTab !== 'incoming') {
    const paddedRows = Array.from({ length: Math.max((rows || []).length, 39) }, (_, index) => rows[index] || null);
    return [{ manager: currentUserName || '', customerGroups: [paddedRows] }];
  }
  const groups = new Map();
  for (const { row } of displayedIncomingRows || []) {
    const manager = row.managerName?.trim() || '담당자 미지정';
    if (!groups.has(manager)) groups.set(manager, new Map());
    const customers = groups.get(manager);
    const customer = row.custKey || row.customerName;
    if (!customers.has(customer)) customers.set(customer, []);
    customers.get(customer).push(row);
  }
  return Array.from(groups, ([manager, customers]) => ({ manager, customerGroups: Array.from(customers.values()) }))
    .sort((a, b) => a.manager.localeCompare(b.manager, 'ko'));
}

export function buildRegistrationHistoryByKey(history) {
  const map = new Map();
  (history || []).filter((item) => String(item.ActionType || '') === 'REGISTER_ESTIMATE').forEach((item) => {
    const key = Number(item.DeductionKey || 0);
    if (key > 0 && !map.has(key)) map.set(key, item);
  });
  return map;
}

export function buildAddModeDefectRow(source = {}, mode = 'new-customer') {
  const next = createEmptyDefectRow();
  if (mode === 'same-customer' || mode === 'same-customer-product') {
    next.customerName = source.customerName || '';
    next.custKey = source.custKey || null;
    next.matchedCustomerName = source.matchedCustomerName || source.customerName || '';
    next.farmName = source.farmName || '';
    next.farmKey = source.farmKey || null;
  }
  if (mode === 'same-customer-product') {
    next.productName = source.productName || '';
    next.colorName = source.colorName || '';
    next.prodKey = source.prodKey || null;
    next.matchedProductName = source.matchedProductName || '';
    next.matchedProductDbName = source.matchedProductDbName || '';
    next.countryName = source.countryName || '';
    next.matchedFlowerName = source.matchedFlowerName || '';
    next.sourceUnit = source.sourceUnit || source.unit || '단';
    next.unit = source.unit || source.sourceUnit || '단';
  }
  return next;
}

export function buildRelatedDefectRow(source = {}, keepProduct = false) {
  return {
    ...createEmptyDefectRow(),
    customerName: source.customerName || '',
    custKey: source.custKey || null,
    matchedCustomerName: source.matchedCustomerName || source.customerName || '',
    farmName: source.farmName || '',
    farmKey: source.farmKey || null,
    ...(keepProduct ? {
      productName: source.productName || '',
      colorName: source.colorName || '',
      prodKey: source.prodKey || null,
      matchedProductName: source.matchedProductName || '',
      matchedProductDbName: source.matchedProductDbName || '',
      countryName: source.countryName || '',
      matchedFlowerName: source.matchedFlowerName || '',
      sourceUnit: source.sourceUnit || source.unit || '',
      unit: source.unit || source.sourceUnit || '',
    } : {}),
  };
}

export function computeSalesStatusSummary(rows = [], getSaveState) {
  const pendingSalesRows = new Set();
  const salesStatusCounts = rows.reduce((counts, row, index) => {
    const state = getSaveState(row);
    if (state === '미저장' || state === '저장 안 됨') {
      const key = Number(row.deductionKey);
      pendingSalesRows.add(key > 0 ? key : `draft-${index}`);
    }
    counts[state] = (counts[state] || 0) + 1;
    return counts;
  }, {});
  return { pendingSalesRows, salesStatusCounts };
}

export const buildManagementDescriptor = (row) => ({
  deductionKey: Number(row.deductionKey),
  sourceYear: Number(row.orderYear),
  sourceWeek: String(row.orderWeek),
  expectedRowVersionNo: Number(row.rowVersionNo),
});

export function buildProductSelectionTelemetry({ row, item, lookupQuery, year, week, lookup }) {
  return {
    eventType: row.prodKey && Number(row.prodKey) !== Number(item.ProdKey) ? 'SELECTION_REPLACED' : 'CANDIDATE_SELECTED',
    sourceChannel: 'sales-defect-deduction',
    query: lookupQuery,
    orderYear: Number(year),
    orderWeek: String(week),
    custKey: Number(row.custKey) || null,
    country: item.CounName || '',
    flower: item.FlowerName || '',
    color: item.DisplayName || item.ProdName || '',
    unit: item.EstUnit || item.OutUnit || '',
    candidateProdKeys: lookup.map((candidate) => candidate.ProdKey),
    candidateScores: lookup.map((candidate) => Number(candidate.MatchConfidence || candidate.MatchScore / 100 || 0)),
    selectedProdKey: Number(item.ProdKey),
    replacedProdKey: Number(row.prodKey) || null,
    modelVersion: item.MatchModelVersion,
    confirmedByUser: false,
    autoSelected: false,
  };
}

export function buildConfirmedSaveTelemetryPayloads({ submittedRows, year, week }) {
  return (submittedRows || []).filter((row) => row.prodKey).map((row) => ({
    eventType: 'SELECTION_CONFIRMED',
    sourceChannel: 'sales-defect-deduction',
    query: row.matchQuery || `${row.productName || ''} ${row.colorName || ''}`.trim(),
    orderYear: Number(year),
    orderWeek: String(week),
    custKey: Number(row.custKey) || null,
    country: row.countryName || '',
    flower: row.matchedFlowerName || row.productName || '',
    color: row.colorName || '',
    unit: row.unit || row.sourceUnit || '',
    selectedProdKey: Number(row.prodKey),
    candidateProdKeys: row.matchCandidateProdKeys || [Number(row.prodKey)],
    candidateScores: row.matchCandidateScores || [1],
    confirmedByUser: true,
    autoSelected: false,
  }));
}
