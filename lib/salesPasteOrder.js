import { buildForwardOrderWeeks } from './myCustomerOrderEntry.js';

export function buildSalesPasteWeekChoices(now = new Date()) {
  // 영업 발주는 달력 차수보다 한 차수 앞서 입력한다. +2를 기준으로 삼으면
  // 2026-08-31 업무차수 36차가 빠지고 37차부터 노출된다.
  const all = buildForwardOrderWeeks(now, 1, 4, 0);
  const defaultChoice = all.find(choice => choice.default) || all[0];
  if (!defaultChoice) return [];
  const start = all.findIndex(choice => choice.year === defaultChoice.year && choice.week === defaultChoice.week);
  const baseMajor = Number(defaultChoice.week.split('-')[0]);
  const baseYear = Number(defaultChoice.year);
  const result = [];
  for (let index = Math.max(0, start); index < all.length && result.length < 8; index += 1) {
    const choice = all[index];
    const major = Number(choice.week.split('-')[0]);
    let offset = (Number(choice.year) - baseYear) * 52 + major - baseMajor;
    if (offset < 0 || offset > 3) continue;
    result.push({ ...choice, offset, groupLabel: offset === 0 ? '베이스' : `+${offset}` });
  }
  return result;
}

export function normalizeDetectedSalesPasteWeek(value = '') {
  const match = String(value || '').match(/(?:^|\s)(\d{1,2})\s*-\s*(\d{1,2})(?:\s*차)?(?:\s|$)/);
  if (!match) return '';
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isInteger(major) || major < 1 || major > 52 || ![1, 2].includes(minor)) return '';
  return `${String(major).padStart(2, '0')}-${String(minor).padStart(2, '0')}`;
}

export function resolveDetectedSalesPasteScope(detectedWeek, choices = []) {
  const week = normalizeDetectedSalesPasteWeek(detectedWeek);
  if (!week) return null;
  const match = choices.find(choice => choice.week === week);
  return match ? { year: match.year, week: match.week } : null;
}

export function salesPasteCountryContext(line = '', previous = '') {
  const text = ` ${String(line || '').trim().replace(/\s+/g, ' ')} `;
  if (/콜롬비아|colombia|(?:^|\s)콜(?:\s|$)/i.test(text)) return '콜롬비아';
  if (/중국|china/i.test(text)) return '중국';
  if (/네덜란드|netherlands|holland/i.test(text)) return '네덜란드';
  if (/에콰도르|ecuador/i.test(text)) return '에콰도르';
  return previous;
}

export function buildSalesPasteMatchName(inputName = '', flowerContext = '', countryContext = '') {
  let result = String(inputName || '').trim();
  const flower = String(flowerContext || '').trim();
  const country = String(countryContext || '').trim();
  if (flower && !result.includes(flower)) result = `${flower} ${result}`.trim();
  if (country && !result.includes(country)) result = `${country} ${result}`.trim();
  return result;
}

export function salesManagerOptions(customers = [], currentUser = {}) {
  const names = new Set(customers.map(row => String(row.ManagerName || '').trim()).filter(Boolean));
  if (currentUser?.userName) names.add(String(currentUser.userName).trim());
  return [...names].sort((a, b) => a.localeCompare(b, 'ko'));
}

export function salesManagerCustomers(customers = [], manager = '') {
  const target = String(manager || '').trim();
  return customers.filter(row => !target || String(row.ManagerName || '').trim() === target);
}

export function buildSalesPasteText({ year, week, customerName, text }) {
  return `${year}년 ${week}차\n${String(customerName || '').trim()}\n${normalizeSalesPasteInputText(text)}`;
}

export function normalizeSalesPasteInputText(text = '') {
  return String(text || '')
    .split(/\r?\n/)
    // 카카오톡/문서에서 줄 끝 구분자로 붙는 역슬래시는 품목명의 일부가 아니다.
    // 수량 단위 뒤에 남으면 자연어 수량행 정규식이 해당 행 전체를 누락한다.
    .map((line) => line.replace(/\s*[\\＼]+\s*$/, '').trimEnd())
    .join('\n')
    .trim();
}

export function countSalesPasteQuantityLines(text = '') {
  return normalizeSalesPasteInputText(text)
    .split('\n')
    .filter((line) => /-?\d+(?:\.\d+)?\s*(?:박\s*스|boxes?|box|bx|단|bunch(?:es)?|bun|송\s*이|개|스\s*팀|스\s*템|stems?|steam)\s*(?:추가|취소)?\s*$/i.test(line.trim()))
    .length;
}

function parsedItemCount(parsed = {}) {
  return (parsed.orders || []).reduce((sum, order) => sum + (order.items || []).filter((item) => Number(item.qty) > 0 && item.inputName).length, 0);
}

export function chooseSalesPasteParsedOrders({ text = '', llmParsed = {}, naturalParsed = {} } = {}) {
  const expected = countSalesPasteQuantityLines(text);
  const candidates = [
    { source: 'llm', parsed: llmParsed, count: parsedItemCount(llmParsed), priority: 1 },
    { source: 'rules', parsed: naturalParsed, count: parsedItemCount(naturalParsed), priority: 0 },
  ].filter((candidate) => candidate.count > 0);
  if (!candidates.length) return { source: 'none', orders: [], itemCount: 0, expectedCount: expected };
  candidates.sort((a, b) => {
    const aGap = expected > 0 ? Math.abs(a.count - expected) : 0;
    const bGap = expected > 0 ? Math.abs(b.count - expected) : 0;
    return aGap - bGap || b.priority - a.priority || b.count - a.count;
  });
  return {
    source: candidates[0].source,
    orders: candidates[0].parsed.orders || [],
    itemCount: candidates[0].count,
    expectedCount: expected,
  };
}

export function buildSalesPasteAiPreview(parsed = {}) {
  return (parsed.orders || []).flatMap((order) => (order.items || []).map((item, index) => ({
    id: `${order.custMatch?.CustKey || order.custName || 'customer'}-${index}`,
    customerName: order.custMatch?.CustName || order.custName || '',
    inputName: item.inputName || '',
    qty: Number(item.qty || 0),
    unit: item.unit || '',
    action: item.action || '추가',
    prodKey: item.prodKey || null,
    matchedName: item.displayName || item.prodName || '',
    flowerName: item.flowerName || '',
    counName: item.counName || '',
  })));
}

export function buildSalesPasteOrderChanges(rows = []) {
  return rows
    .filter((row) => row.prodKey && !row.unitConflict && Number.isFinite(Number(row.finalQty)))
    .map((row) => {
      const beforeQty = Number(row.currentQty || 0);
      const afterQty = Number(row.finalQty || 0);
      return {
        prodKey: Number(row.prodKey),
        label: row.displayName || row.prodName || row.inputName || '-',
        flowerName: row.flowerName || row.counName || '',
        unit: row.outUnit || row.unit || '',
        beforeQty,
        afterQty,
        deltaQty: afterQty - beforeQty,
      };
    })
    .filter((row) => row.deltaQty !== 0);
}

const SALES_PASTE_UNITS = ['박스', '단', '송이'];

function salesPasteProductMeta(product = {}) {
  return {
    outUnit: product.outUnit || product.OutUnit || product.unit || '',
    bunchOf1Box: Number(product.bunchOf1Box ?? product.BunchOf1Box ?? 0),
    steamOf1Bunch: Number(product.steamOf1Bunch ?? product.SteamOf1Bunch ?? 0),
    steamOf1Box: Number(product.steamOf1Box ?? product.SteamOf1Box ?? 0),
  };
}

// pages/api/orders/index.js의 myCustomerOrderAllUnits와 같은 환산 규칙이다.
// 화면 예상값과 등록 트랜잭션이 다른 단위를 계산하지 않도록 유지한다.
export function convertSalesPasteQtyToOutUnit(qty, unit, product = {}) {
  const amount = Number(qty);
  const meta = salesPasteProductMeta(product);
  const inputUnit = SALES_PASTE_UNITS.includes(String(unit)) ? String(unit) : meta.outUnit;
  const outUnit = SALES_PASTE_UNITS.includes(String(meta.outUnit)) ? String(meta.outUnit) : inputUnit;
  if (!Number.isFinite(amount) || !inputUnit || !outUnit) return null;
  if (inputUnit === outUnit) return amount;

  let box = 0;
  let bunch = 0;
  let steam = 0;
  if (inputUnit === '박스') {
    box = amount;
    if (meta.bunchOf1Box > 0) bunch = amount * meta.bunchOf1Box;
    if (meta.steamOf1Box > 0) steam = amount * meta.steamOf1Box;
    else if (meta.bunchOf1Box > 0 && meta.steamOf1Bunch > 0) steam = amount * meta.bunchOf1Box * meta.steamOf1Bunch;
  } else if (inputUnit === '단') {
    bunch = amount;
    if (meta.bunchOf1Box > 0) box = amount / meta.bunchOf1Box;
    if (meta.steamOf1Bunch > 0) steam = amount * meta.steamOf1Bunch;
    else if (meta.steamOf1Box > 0 && meta.bunchOf1Box > 0) steam = (amount / meta.bunchOf1Box) * meta.steamOf1Box;
  } else {
    steam = amount;
    if (meta.steamOf1Box > 0) box = amount / meta.steamOf1Box;
    else if (meta.steamOf1Bunch > 0 && meta.bunchOf1Box > 0) box = amount / (meta.steamOf1Bunch * meta.bunchOf1Box);
    if (meta.steamOf1Bunch > 0) bunch = amount / meta.steamOf1Bunch;
    else if (meta.steamOf1Box > 0 && meta.bunchOf1Box > 0) bunch = (amount / meta.steamOf1Box) * meta.bunchOf1Box;
  }
  const converted = outUnit === '박스' ? box : outUnit === '단' ? bunch : steam;
  return Number.isFinite(converted) && (amount === 0 || converted > 0) ? converted : null;
}

export function salesPasteUnitOptions(row = {}) {
  const defaults = SALES_PASTE_UNITS.filter((unit) => convertSalesPasteQtyToOutUnit(1, unit, row) !== null);
  const current = String(row.unit || '');
  return current && !defaults.includes(current) ? [current, ...defaults] : defaults;
}

export function buildSalesPasteRows(parsedOrders = [], currentProducts = []) {
  const current = new Map(currentProducts.map(row => [Number(row.ProdKey), row]));
  const rows = [];
  const matched = new Map();
  const unitsByProduct = new Map();
  parsedOrders.forEach(order => (order.items || []).forEach(item => {
    if (!item.prodKey) {
      rows.push({ ...item, customerInput: order.custName || '', currentQty: 0, finalQty: null });
      return;
    }
    const key = `${Number(item.prodKey)}|${String(item.unit || '')}`;
    if (!unitsByProduct.has(Number(item.prodKey))) unitsByProduct.set(Number(item.prodKey), new Set());
    unitsByProduct.get(Number(item.prodKey)).add(String(item.unit || ''));
    const previous = matched.get(key);
    if (previous) previous.qty += Number(item.qty || 0);
    else matched.set(key, { ...item, qty: Number(item.qty || 0), customerInput: order.custName || '' });
  }));
  matched.forEach(item => {
    const currentProduct = current.get(Number(item.prodKey)) || {};
    const currentMeta = salesPasteProductMeta(currentProduct);
    const itemMeta = salesPasteProductMeta(item);
    const meta = {
      outUnit: itemMeta.outUnit || currentMeta.outUnit || item.unit || '',
      bunchOf1Box: itemMeta.bunchOf1Box > 0 ? itemMeta.bunchOf1Box : currentMeta.bunchOf1Box,
      steamOf1Bunch: itemMeta.steamOf1Bunch > 0 ? itemMeta.steamOf1Bunch : currentMeta.steamOf1Bunch,
      steamOf1Box: itemMeta.steamOf1Box > 0 ? itemMeta.steamOf1Box : currentMeta.steamOf1Box,
    };
    const currentQty = Number(currentProduct.CurrentQty || 0);
    const unitConflict = (unitsByProduct.get(Number(item.prodKey))?.size || 0) > 1;
    const deltaOutQty = convertSalesPasteQtyToOutUnit(item.qty, item.unit, meta);
    const unitConversionInvalid = deltaOutQty === null;
    rows.push({
      ...item,
      ...meta,
      defaultUnit: item.defaultUnit || item.unit,
      unitConflict,
      unitConversionInvalid,
      deltaOutQty,
      currentQty,
      finalQty: unitConflict || unitConversionInvalid ? null : currentQty + deltaOutQty,
    });
  });
  return rows;
}

export function replaceSalesPasteProduct(rows = [], rowIndex, product = {}, currentProducts = []) {
  if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= rows.length || !product?.ProdKey)
    return rows;
  const items = rows.map((row, index) => index === rowIndex ? {
    ...row,
    prodKey: Number(product.ProdKey),
    prodName: product.ProdName || '',
    displayName: product.DisplayName || product.ProdName || '',
    flowerName: product.FlowerName || '',
    counName: product.CounName || '',
    outUnit: product.OutUnit || '',
    bunchOf1Box: Number(product.BunchOf1Box || 0),
    steamOf1Bunch: Number(product.SteamOf1Bunch || 0),
    steamOf1Box: Number(product.SteamOf1Box || 0),
    mappingMatchType: 'direct-select',
    fromMapping: true,
    confidence: 1,
    confidenceLabel: 'high',
    unitConflict: false,
  } : row);
  return buildSalesPasteRows([{ items }], currentProducts);
}

export function replaceSalesPasteUnit(rows = [], rowIndex, unit, currentProducts = []) {
  if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= rows.length || !SALES_PASTE_UNITS.includes(String(unit)))
    return rows;
  const items = rows.map((row, index) => index === rowIndex ? { ...row, unit: String(unit), unitConflict: false } : row);
  return buildSalesPasteRows([{ items }], currentProducts);
}
