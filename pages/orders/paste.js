// pages/orders/paste.js — 붙여넣기 주문등록 (Claude AI 파싱, 다중거래처/변경사항, 미매칭 질문)
import { useState, useEffect } from 'react';
import Layout from '../../components/Layout';
import { apiDelete, apiGet, apiPost } from '../../lib/useApi';
import { filterProducts, jamoSimilarity, getDisplayName, scoreMatch } from '../../lib/displayName';
import { getCurrentWeek, formatWeekDisplay } from '../../lib/useWeekInput';
import { defaultUnit, normalizeOrderUnit } from '../../lib/orderUtils';
import { customerMatchesSearch } from '../../lib/customerSearch';

const MAPPING_KEY = 'nenova_paste_mappings';
const CUSTOMER_MAPPING_KEY = 'nenova_paste_customer_mappings';
const ORDER_TEMPLATE_PAGE = 'paste-order-template';

// 오늘 기준 2026 차수 (항상 신형식 YYYY-WW-SS)
function getDefaultWeek() {
  return getCurrentWeek(); // 2026-WW-01
}

// 현재 주차 기준 ±N 범위의 2026 차수 목록 (각 주마다 -01/-02/-03, 오름차순)
function getNearby2026Weeks(range = 4) {
  const now = new Date();
  const year = now.getFullYear();
  const start = new Date(year, 0, 1);
  const dayOfYear = Math.floor((now - start) / 86400000) + 1;
  const curWeek = Math.min(Math.ceil(dayOfYear / 7), 52);
  const weeks = [];
  for (let w = Math.max(1, curWeek - range); w <= curWeek + range; w++) {
    for (let s = 1; s <= 3; s++) {
      weeks.push(`${year}-${String(w).padStart(2,'0')}-${String(s).padStart(2,'0')}`);
    }
  }
  return weeks;
}

function loadCache() {
  try { return JSON.parse(localStorage.getItem(MAPPING_KEY) || '{}'); } catch { return {}; }
}
function saveCache(cache) {
  try { localStorage.setItem(MAPPING_KEY, JSON.stringify(cache)); } catch {}
}
function loadCustomerCache() {
  try { return JSON.parse(localStorage.getItem(CUSTOMER_MAPPING_KEY) || '{}'); } catch { return {}; }
}
function saveCustomerCache(cache) {
  try { localStorage.setItem(CUSTOMER_MAPPING_KEY, JSON.stringify(cache)); } catch {}
}
function customerCacheKey(inputName) {
  return (inputName || '')
    .toLowerCase()
    .replace(/[()[\]{}]/g, ' ')
    .replace(/(추가|취소|삭제|출고|입고|변경사항|변경|오늘|일요일|월요일|화요일|수요일|목요일|금요일|토요일)/g, ' ')
    .replace(/[|:：,\-→>]/g, ' ')
    .replace(/\s+/g, '')
    .trim();
}
function cacheKey(inputName) {
  return normalizePasteToken(inputName);
}
function normalizePasteToken(inputName) {
  return (inputName || '')
    .toLowerCase()
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\b(add|cancel|delete|box|bunch|stem|stems|cm|ea)\b/gi, ' ')
    .replace(/(추가|취소|삭제|출고|입고|변경사항|변경|오늘|일요일|월요일|화요일|수요일|목요일|금요일|토요일)/g, ' ')
    .replace(/\d+(\.\d+)?\s*(박스|단|송이|개|box|bunch|stem|stems|cm|ea)?/gi, ' ')
    .replace(/[|:：,\-→>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function tokenParts(s) {
  return normalizePasteToken(s).split(/\s+/).filter(t => t.length >= 2);
}
function findLocalMapping(inputName, cache) {
  const exact = cacheKey(inputName);
  if (cache[exact]) return cache[exact];
  const compactExact = exact.replace(/\s+/g, '');
  for (const [key, value] of Object.entries(cache || {})) {
    const compactKey = normalizePasteToken(key).replace(/\s+/g, '');
    if (compactKey && compactKey === compactExact) return value;
  }
  const inputTokens = tokenParts(inputName);
  if (inputTokens.length === 0) return null;
  const hits = [];
  Object.entries(cache || {}).forEach(([key, value]) => {
    const keyTokens = tokenParts(key);
    if (keyTokens.length === 0) return;
    const allIn = inputTokens.every(t => keyTokens.some(k =>
      t === k || (t.length >= 4 && k.length >= 4 && (t.includes(k) || k.includes(t)))
    ));
    if (allIn) hits.push({ key, value, score: inputTokens.length / Math.max(inputTokens.length, keyTokens.length) });
  });
  hits.sort((a, b) => b.score - a.score);
  return hits[0]?.value || null;
}

function isMixBoxName(prod) {
  const text = `${prod?.ProdName || ''} ${prod?.DisplayName || ''}`.toLowerCase();
  return /믹스\s*박스|mix\s*box|mixbox/.test(text);
}

function inputWantsMixBox(inputName) {
  return /믹스\s*박스|믹스|mix\s*box|mixbox|mixed/i.test(String(inputName || ''));
}

function isMixBoxMismatch(inputName, prod) {
  return isMixBoxName(prod) && !inputWantsMixBox(inputName);
}

function mappingProductName(itemOrProd) {
  if (!itemOrProd) return '';
  return itemOrProd.DisplayName || itemOrProd.displayName || itemOrProd.ProdName || itemOrProd.prodName || '';
}

function mappingProductMeta(itemOrProd) {
  const bits = [itemOrProd?.CounName || itemOrProd?.counName, itemOrProd?.FlowerName || itemOrProd?.flowerName].filter(Boolean);
  return bits.join(' / ');
}

function isNetherlandsProduct(prod) {
  return /네덜란드|netherlands|holland|dutch/i.test(String(prod?.CounName || prod?.counName || ''));
}

function extractMoqText(prod) {
  if (!isNetherlandsProduct(prod)) return '';
  const descr = String(prod?.Descr || prod?.descr || prod?.ProdDescr || '').trim();
  if (!descr) return '';
  const line = descr.split(/\r?\n/).find(v => /moq|엠오큐|최소/i.test(v)) || '';
  const m = line.match(/(?:moq|엠오큐|최소)\s*[:：=]?\s*([^,;/\n]+)/i);
  return (m ? `MOQ ${m[1].trim()}` : line.trim()).trim();
}

function favoriteItemFromOrderItem(it, allProducts = []) {
  const prod = allProducts.find(p => Number(p.ProdKey) === Number(it.prodKey)) || it;
  return {
    prodKey: Number(it.prodKey),
    prodName: it.prodName || prod?.ProdName || '',
    displayName: it.displayName || prod?.DisplayName || it.prodName || '',
    flowerName: it.flowerName || prod?.FlowerName || '',
    counName: it.counName || prod?.CounName || '',
    qty: Number(it.qty || 0),
    unit: normalizeOrderUnit(it.unit || prod?.OutUnit),
    descr: extractMoqText(prod),
  };
}

function stockNorm(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[()[\]{}]/g, ' ')
    .replace(/[|:：,ㆍ·]/g, ' ')
    .replace(/\s+/g, '')
    .trim();
}

function fmtStockQty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

function parseStockNumber(value) {
  const n = parseFloat(String(value || '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

function selectedYearFromWeek(selectedWeek) {
  const m = String(selectedWeek || '').match(/^(\d{4})-/);
  return m ? m[1] : String(new Date().getFullYear());
}

function fullWeekFromShort(shortWeek, selectedWeek) {
  const m = String(shortWeek || '').match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return selectedWeek || '';
  return `${selectedYearFromWeek(selectedWeek)}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

function shortWeekLabel(weekValue) {
  const m = String(weekValue || '').match(/^(?:\d{4}-)?(\d{1,2})-(\d{1,2})$/);
  if (!m) return weekValue || '';
  return `${Number(m[1])}-${Number(m[2])}`;
}

function parseWeekFromLine(line, selectedWeek) {
  const s = String(line || '');
  let m = s.match(/(?:^|\s)(\d{1,2})\s*-\s*(\d{1,2})(?:\s*차)?(?:\s|$)/);
  if (m) return fullWeekFromShort(`${m[1]}-${m[2]}`, selectedWeek);
  m = s.match(/(?:^|\s)(\d{1,2})\s*차(?:\s|$)/);
  return m ? fullWeekFromShort(`${m[1]}-01`, selectedWeek) : '';
}

function weekSortValue(weekValue) {
  const m = String(weekValue || '').match(/^(?:\d{4}-)?(\d{1,2})-(\d{1,2})$/);
  if (!m) return 0;
  return Number(m[1]) * 10 + Number(m[2]);
}

function isSeparatorLine(line) {
  return /^[\s\-_=ㅡ─]{4,}$/.test(String(line || '').trim());
}

function normalizeFlowerContext(line) {
  const s = String(line || '').trim().replace(/\s+/g, '');
  if (s === '카네') return '카네이션';
  if (s === '리시안') return '리시안셔스';
  return /^(수국|장미|카네이션|알스트로|루스커스|호주|레몬잎|호접|덴파레|리시안셔스|튤립)$/.test(s) ? s : '';
}

function applyFlowerContext(name, flowerContext) {
  const productName = String(name || '').trim();
  if (!productName || !flowerContext) return productName;
  return productName.includes(flowerContext) ? productName : `${flowerContext} ${productName}`;
}

function isNaturalCustomerLine(line) {
  const s = String(line || '').trim();
  if (!s) return false;
  if (/추가|취소|[()<>]/.test(s)) return false;
  if (/^\d{1,2}\s*(?:-\s*\d{1,2})?\s*차?\s*$/.test(s)) return false;
  if (/\d+\s*(박스|단|송이|개|ea|box|bunch|stem|stems)/i.test(s)) return false;
  return true;
}

function parseBaseStockText(text) {
  const rows = [];
  const byKey = {};
  String(text || '').split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim();
    if (!line || isSeparatorLine(line) || /^(잔량|잔량재고|기초재고|기존재고|시작재고|시작잔량|재고)$/i.test(line)) return;
    if (/^\d{1,2}\s*-\s*\d{1,2}(?:\s*차)?$/.test(line)) return;
    const cleaned = line.replace(/^[-*•]\s*/, '').trim();
    const m = cleaned.match(/^(.+?)[\s:：]*(-?\d+(?:\.\d+)?)\s*(박스|단|송이|개)?$/);
    if (!m) return;
    const name = m[1].trim();
    const qty = parseStockNumber(m[2]);
    if (!name || qty == null) return;
    const row = { name, qty, unit: m[3] || '', idx };
    rows.push(row);
    byKey[stockNorm(name)] = row;
  });
  return { rows, byKey };
}

function parseHeadNameRemain(line) {
  const beforeParen = String(line || '').split('(')[0] || '';
  const beforeAngle = beforeParen.split('<')[0].trim();
  if (!beforeAngle) return { name: '', reportedRemain: null };
  const m = beforeAngle.match(/^(.+?)[\s:：]*(-?\d+(?:\.\d+)?)\s*(박스|단|송이|개)?$/);
  if (!m) return { name: beforeAngle.trim(), reportedRemain: null };
  return {
    name: m[1].trim(),
    reportedRemain: parseStockNumber(m[2]),
    unit: m[3] || '',
  };
}

function isMemoParenToken(token) {
  const s = String(token || '').trim();
  if (!s) return true;
  return /미발주|사용예정|예정|시작|여분|메모|참고|입고|재고/.test(s) || /\d+\s*개/.test(s);
}

function parseChangeToken(token) {
  const s = String(token || '').replace(/\s+/g, '').trim();
  if (!s || isMemoParenToken(s)) return { note: token };

  let m = s.match(/^(.+?)(-?\d+(?:\.\d+)?)>(-?\d+(?:\.\d+)?)$/);
  if (m) {
    const before = parseStockNumber(m[2]);
    const after = parseStockNumber(m[3]);
    return {
      customer: m[1],
      before,
      after,
      delta: after - before,
      kind: 'arrow',
      raw: token,
    };
  }

  m = s.match(/^(.+?)취소(-?\d+(?:\.\d+)?)$/) || s.match(/^(.+?)(-?\d+(?:\.\d+)?)취소$/);
  if (m) {
    return {
      customer: m[1],
      before: null,
      after: null,
      delta: -Math.abs(parseStockNumber(m[2])),
      kind: 'cancel',
      raw: token,
    };
  }

  m = s.match(/^(.+?)(-?\d+(?:\.\d+)?)추가$/) || s.match(/^(.+?)추가(-?\d+(?:\.\d+)?)$/);
  if (m) {
    return {
      customer: m[1],
      before: null,
      after: null,
      delta: Math.abs(parseStockNumber(m[2])),
      kind: 'add',
      raw: token,
    };
  }

  m = s.match(/^(.+?)(-?\d+(?:\.\d+)?)$/);
  if (m && !/^\d/.test(m[1])) {
    return {
      customer: m[1],
      before: null,
      after: null,
      delta: Math.abs(parseStockNumber(m[2])),
      kind: 'bare',
      assumed: true,
      raw: token,
    };
  }

  return { note: token };
}

function parseInlinePrefixChanges(line) {
  const changes = [];
  const seen = new Set();
  const re = /([가-힣A-Za-z0-9]+)\s*\(\s*(-?\d+(?:\.\d+)?)\s*>\s*(-?\d+(?:\.\d+)?)\s*\)/g;
  let m;
  while ((m = re.exec(String(line || ''))) !== null) {
    const key = `${m[1]}:${m[2]}:${m[3]}:${m.index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const before = parseStockNumber(m[2]);
    const after = parseStockNumber(m[3]);
    changes.push({
      customer: m[1],
      before,
      after,
      delta: after - before,
      kind: 'arrow',
      raw: `${m[1]}${m[2]}>${m[3]}`,
    });
  }
  return changes;
}

function parseNaturalChangeLine(line, currentCustomer) {
  const s = String(line || '').trim();
  if (!currentCustomer || !/(추가|취소)/.test(s)) return null;
  const m = s.match(/^(.+?)\s*(-?\d+(?:\.\d+)?)\s*(박스|단|송이|개)?\s*(추가|취소)\s*$/);
  if (!m) return null;
  const qty = Math.abs(parseStockNumber(m[2]));
  const action = m[4];
  return {
    productName: m[1].trim(),
    reportedRemain: null,
    changes: [{
      customer: currentCustomer,
      before: null,
      after: null,
      delta: action === '취소' ? -qty : qty,
      kind: action === '취소' ? 'cancel' : 'add',
      raw: `${currentCustomer}${qty}${action}`,
    }],
    notes: [],
  };
}

function parseKakaoStockRecords(text, selectedWeek) {
  const records = [];
  const extraRows = [];
  const primaryWeek = { value: selectedWeek || '' };
  let currentWeek = selectedWeek || '';
  let currentCustomer = '';
  let currentFlower = '';
  let mode = 'regular';

  String(text || '').split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;
    if (isSeparatorLine(line)) {
      if (mode === 'extra') {
        mode = 'regular';
        currentWeek = primaryWeek.value || selectedWeek || currentWeek;
      }
      currentCustomer = '';
      return;
    }

    const lineWeek = parseWeekFromLine(line, selectedWeek);
    if (lineWeek) {
      const headerFlower = normalizeFlowerContext((line.match(/(수국|장미|카네이션|카네|알스트로|루스커스|호주|레몬잎|호접|덴파레|리시안셔스|리시안|튤립)/) || [])[1]);
      if (headerFlower) currentFlower = headerFlower;
      if (/여분\s*주문|여분주문/.test(line)) {
        mode = 'extra';
        currentWeek = lineWeek;
        return;
      }
      const lineWithoutWeek = line.replace(/(?:^|\s)\d{1,2}\s*(?:-\s*\d{1,2})?\s*차?/, ' ');
      if (headerFlower && /추가|취소/.test(line) && !/\d+\s*(박스|단|송이|개)/.test(lineWithoutWeek)) {
        mode = 'regular';
        currentWeek = lineWeek;
        primaryWeek.value = primaryWeek.value || lineWeek;
        currentCustomer = '';
        return;
      }
      if (/변경사항|차\s*$|^\d{1,2}\s*-\s*\d{1,2}\s*$/.test(line)) {
        mode = 'regular';
        currentWeek = lineWeek;
        primaryWeek.value = primaryWeek.value || lineWeek;
        currentCustomer = '';
        return;
      }
    }

    if (/^(잔량|히스토리|기초재고|확인필요)$/.test(line)) return;

    const flowerOnly = normalizeFlowerContext(line);
    if (flowerOnly) {
      currentFlower = flowerOnly;
      return;
    }

    if (isNaturalCustomerLine(line)) {
      currentCustomer = line;
      return;
    }

    const natural = parseNaturalChangeLine(line, currentCustomer);
    if (natural) {
      const productName = applyFlowerContext(natural.productName, currentFlower);
      records.push({
        id: `${idx}-natural`,
        lineNo: idx + 1,
        week: currentWeek || selectedWeek || '',
        weekLabel: shortWeekLabel(currentWeek || selectedWeek || ''),
        productName,
        reportedRemain: null,
        changes: natural.changes,
        notes: natural.notes,
        sourceLine: line,
        mode: 'regular',
      });
      return;
    }

    const { name, reportedRemain, unit } = parseHeadNameRemain(line);
    if (!name) return;
    const productName = applyFlowerContext(name, currentFlower);

    const inlineChanges = parseInlinePrefixChanges(line);
    const parenTokens = [...line.matchAll(/\(([^)]*)\)/g)].map(m => m[1].trim());
    const changes = [...inlineChanges];
    const notes = [];
    parenTokens.forEach(token => {
      const change = parseChangeToken(token);
      if (change.customer) changes.push(change);
      else if (change.note) notes.push(change.note);
    });

    if (mode === 'extra') {
      extraRows.push({
        id: `${idx}-extra`,
        lineNo: idx + 1,
        week: currentWeek || selectedWeek || '',
        weekLabel: shortWeekLabel(currentWeek || selectedWeek || ''),
        productName,
        qty: reportedRemain,
        unit: unit || '',
        notes,
        sourceLine: line,
      });
      return;
    }

    if (reportedRemain == null && changes.length === 0 && notes.length === 0) return;
    records.push({
      id: `${idx}-compact`,
      lineNo: idx + 1,
      week: currentWeek || selectedWeek || '',
      weekLabel: shortWeekLabel(currentWeek || selectedWeek || ''),
      productName,
      reportedRemain,
      unit: unit || '',
      changes,
      notes,
      sourceLine: line,
      mode: 'regular',
    });
  });

  return { records, extraRows };
}

function formatChange(change) {
  const sign = change.delta > 0 ? '+' : '';
  const delta = `${sign}${fmtStockQty(change.delta)}`;
  if (change.kind === 'arrow') {
    return `${change.customer} ${fmtStockQty(change.before)}>${fmtStockQty(change.after)}(${delta})`;
  }
  const label = change.kind === 'cancel' ? '취소' : change.kind === 'add' ? '추가' : '추정';
  return `${change.customer} ${delta}(${label})`;
}

function isManagedProduct(prod) {
  const text = `${prod?.CounName || ''} ${prod?.FlowerName || ''} ${prod?.ProdName || ''} ${prod?.DisplayName || ''}`;
  const countryOk = /(콜롬비아|colombia|col\b)/i.test(text);
  const flowerOk = /(수국|hydrangea|장미|rose|카네이션|carnation|알스트로|alstro)/i.test(text);
  return countryOk && flowerOk;
}

function productMatchSummary(productName, products) {
  if (!productName || !products?.length) return { status: 'unknown', names: [] };
  const scored = products
    .map(prod => ({ prod, score: scoreMatch(productName, prod, '') }))
    .filter(x => x.score >= 55)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  const managed = scored.filter(x => isManagedProduct(x.prod));
  if (managed.length === 1) return { status: 'matched', names: [getDisplayName(managed[0].prod)] };
  if (managed.length > 1) return { status: 'ambiguous', names: managed.slice(0, 3).map(x => getDisplayName(x.prod)) };
  if (scored.length > 0) return { status: 'outside', names: scored.slice(0, 3).map(x => getDisplayName(x.prod)) };
  return { status: 'unmatched', names: [] };
}

function buildKakaoStockDraft({ text, baseText, remainText = '', selectedWeek, products }) {
  const base = parseBaseStockText(baseText);
  const finalRemain = parseBaseStockText(remainText);
  const { records, extraRows } = parseKakaoStockRecords(text, selectedWeek);
  const confirmRows = [];
  const productWeekCounts = {};

  records.forEach(record => {
    const key = `${stockNorm(record.productName)}|${record.week}`;
    productWeekCounts[key] = (productWeekCounts[key] || 0) + 1;
  });

  const recordsByProduct = new Map();
  records.forEach((record, order) => {
    const key = stockNorm(record.productName) || `line-${record.lineNo}`;
    if (!recordsByProduct.has(key)) recordsByProduct.set(key, []);
    recordsByProduct.get(key).push({ ...record, order });
  });

  const remainRows = [];
  const historyRows = [];
  const usedFinalRemainKeys = new Set();

  recordsByProduct.forEach((group, productKey) => {
    const sorted = [...group].sort((a, b) => {
      const ws = weekSortValue(a.week) - weekSortValue(b.week);
      return ws || a.order - b.order;
    });
    const hasBase = base.byKey[productKey]?.qty != null;
    let running = hasBase ? base.byKey[productKey].qty : 0;
    sorted.forEach((record, sortedIdx) => {
      const deltaSum = record.changes.reduce((sum, change) => sum + (Number(change.delta) || 0), 0);
      const calcRemain = running - deltaSum;
      const finalRow = finalRemain.byKey[productKey];
      const finalInputRemain = finalRow && sortedIdx === sorted.length - 1 ? finalRow.qty : null;
      const reportedRemain = record.reportedRemain != null ? record.reportedRemain : finalInputRemain;
      if (finalInputRemain != null) usedFinalRemainKeys.add(productKey);
      const closeRemain = reportedRemain != null ? reportedRemain : calcRemain;
      const match = productMatchSummary(record.productName, products);
      const warnings = [];

      if (!hasBase && sortedIdx === 0) {
        warnings.push('기초재고 없음, 0으로 계산');
      }
      if (reportedRemain != null && calcRemain != null && Math.abs(reportedRemain - calcRemain) > 0.001) {
        warnings.push(`계산 ${fmtStockQty(calcRemain)}와 잔량재고 ${fmtStockQty(reportedRemain)} 불일치`);
      }
      if (record.changes.some(change => change.assumed)) {
        warnings.push('동작어 없는 괄호값은 추가로 추정');
      }
      if (productWeekCounts[`${stockNorm(record.productName)}|${record.week}`] > 1) {
        warnings.push('같은 차수에 같은 품목명이 중복됨');
      }
      if (match.status === 'ambiguous') {
        warnings.push(`품목 후보 여러 개: ${match.names.join(', ')}`);
      } else if (match.status === 'outside') {
        warnings.push(`담당범위 밖 후보: ${match.names.join(', ')}`);
      } else if (match.status === 'unmatched') {
        warnings.push('품목 매칭 후보 없음');
      }

      const row = {
        ...record,
        reportedRemain,
        reportedRemainSource: record.reportedRemain != null ? 'text' : (finalInputRemain != null ? 'remainInput' : null),
        start: running,
        deltaSum,
        calcRemain,
        closeRemain,
        warnings,
        match,
      };

      if (closeRemain != null || record.reportedRemain != null) remainRows.push(row);
      if (record.changes.length > 0) historyRows.push(row);
      warnings.forEach(warning => {
        confirmRows.push(`${record.weekLabel || '선택차수'} ${record.productName}: ${warning}`);
      });
      if (closeRemain != null) running = closeRemain;
    });
  });

  finalRemain.rows.forEach(row => {
    const productKey = stockNorm(row.name);
    if (!productKey || usedFinalRemainKeys.has(productKey) || recordsByProduct.has(productKey)) return;
    const match = productMatchSummary(row.name, products);
    const warnings = [];
    if (match.status === 'ambiguous') {
      warnings.push(`품목 후보 여러 개: ${match.names.join(', ')}`);
    } else if (match.status === 'outside') {
      warnings.push(`담당범위 밖 후보: ${match.names.join(', ')}`);
    } else if (match.status === 'unmatched') {
      warnings.push('품목 매칭 후보 없음');
    }
    const finalOnlyRow = {
      id: `final-${row.idx}`,
      lineNo: row.idx + 1,
      week: selectedWeek || '',
      weekLabel: shortWeekLabel(selectedWeek || ''),
      productName: row.name,
      reportedRemain: row.qty,
      reportedRemainSource: 'remainInput',
      unit: row.unit || '',
      changes: [],
      notes: [],
      sourceLine: `${row.name} ${fmtStockQty(row.qty)}`,
      mode: 'remain-only',
      start: base.byKey[productKey]?.qty ?? null,
      deltaSum: 0,
      calcRemain: base.byKey[productKey]?.qty ?? null,
      closeRemain: row.qty,
      warnings,
      match,
    };
    remainRows.push(finalOnlyRow);
    warnings.forEach(warning => {
      confirmRows.push(`${finalOnlyRow.weekLabel || '선택차수'} ${finalOnlyRow.productName}: ${warning}`);
    });
  });

  const shownRemainKeys = new Set(remainRows.map(row => stockNorm(row.productName)));
  base.rows.forEach(row => {
    const productKey = stockNorm(row.name);
    if (!productKey || shownRemainKeys.has(productKey)) return;
    const match = productMatchSummary(row.name, products);
    const warnings = [];
    if (match.status === 'ambiguous') {
      warnings.push(`품목 후보 여러 개: ${match.names.join(', ')}`);
    } else if (match.status === 'outside') {
      warnings.push(`담당범위 밖 후보: ${match.names.join(', ')}`);
    } else if (match.status === 'unmatched') {
      warnings.push('품목 매칭 후보 없음');
    }
    const baseOnlyRow = {
      id: `base-${row.idx}`,
      lineNo: row.idx + 1,
      week: selectedWeek || '',
      weekLabel: shortWeekLabel(selectedWeek || ''),
      productName: row.name,
      reportedRemain: row.qty,
      reportedRemainSource: 'baseInput',
      unit: row.unit || '',
      changes: [],
      notes: [],
      sourceLine: `${row.name} ${fmtStockQty(row.qty)}`,
      mode: 'base-only',
      start: row.qty,
      deltaSum: 0,
      calcRemain: row.qty,
      closeRemain: row.qty,
      warnings,
      match,
    };
    remainRows.push(baseOnlyRow);
    warnings.forEach(warning => {
      confirmRows.push(`${baseOnlyRow.weekLabel || '선택차수'} ${baseOnlyRow.productName}: ${warning}`);
    });
  });

  const remainByWeek = new Map();
  remainRows.forEach(row => {
    const key = row.weekLabel || '선택차수';
    if (!remainByWeek.has(key)) remainByWeek.set(key, []);
    remainByWeek.get(key).push(row);
  });

  const extraByWeek = new Map();
  extraRows.forEach(row => {
    const key = row.weekLabel || '차수미상';
    if (!extraByWeek.has(key)) extraByWeek.set(key, []);
    extraByWeek.get(key).push(row);
  });

  const copyLines = ['잔량'];
  if (remainRows.length === 0) {
    copyLines.push('(계산된 잔량 없음)');
  } else {
    [...remainByWeek.entries()].forEach(([weekLabel, rows]) => {
      copyLines.push(weekLabel);
      rows.forEach(row => {
        const remain = row.closeRemain ?? row.reportedRemain;
        const mismatch = row.reportedRemain != null && row.calcRemain != null && Math.abs(row.reportedRemain - row.calcRemain) > 0.001
          ? ` (계산 ${fmtStockQty(row.calcRemain)} 확인)`
          : '';
        copyLines.push(`${row.productName} ${fmtStockQty(remain)}${mismatch}`);
      });
    });
  }

  if (extraRows.length > 0) {
    copyLines.push('--------------');
    copyLines.push('여분주문');
    [...extraByWeek.entries()].forEach(([weekLabel, rows]) => {
      copyLines.push(weekLabel);
      rows.forEach(row => copyLines.push(`${row.productName}${row.qty != null ? ` ${fmtStockQty(row.qty)}` : ''}`));
    });
  }

  copyLines.push('--------------');
  copyLines.push('히스토리');
  if (historyRows.length === 0) {
    copyLines.push('(변경 히스토리 없음)');
  } else {
    historyRows.forEach(row => {
      const start = row.start != null ? `시작${fmtStockQty(row.start)} ` : '';
      const close = row.closeRemain != null ? ` => 잔량${fmtStockQty(row.closeRemain)}` : '';
      copyLines.push(`${row.weekLabel || '선택차수'} ${row.productName} ${start}${row.changes.map(formatChange).join(' ')}${close}`);
    });
  }

  if (confirmRows.length > 0) {
    copyLines.push('--------------');
    copyLines.push('확인필요');
    [...new Set(confirmRows)].forEach(line => copyLines.push(line));
  }

  return {
    baseRows: base.rows,
    records,
    extraRows,
    remainRows,
    historyRows,
    confirmRows: [...new Set(confirmRows)],
    copyText: copyLines.join('\n'),
  };
}

export default function PasteOrderPage() {
  const [allProducts, setAllProducts] = useState([]);
  const [allCustomers, setAllCustomers] = useState([]);
  const [weeks, setWeeks] = useState([]);
  const [week, setWeek] = useState('');
  const [weekPage, setWeekPage] = useState(0);
  const WEEK_PAGE_SIZE = 6;
  const [showOldWeeks, setShowOldWeeks] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [orders, setOrders] = useState([]);
  const [parseError, setParseError] = useState('');
  const [mappingCache, setMappingCache] = useState({});
  const [customerMappingCache, setCustomerMappingCache] = useState({});
  const [mappingNotice, setMappingNotice] = useState(null);
  const [mappingChangeLog, setMappingChangeLog] = useState([]);
  const [queueIdx, setQueueIdx] = useState(0);   // 현재 질문 중인 미매칭 항목 인덱스
  const [disambigSearch, setDisambigSearch] = useState('');
  const [disambigResults, setDisambigResults] = useState([]);
  const [registeredOrders, setRegisteredOrders] = useState({}); // orderId → DB 주문내역
  const [shipmentQtys, setShipmentQtys] = useState({}); // `${custKey}-${prodKey}-${week}` → ShipmentDetail.OutQuantity
  const [adjustModal, setAdjustModal] = useState(null); // { custKey, prodKey, week, type, currentQty, prodName, custName, unit }
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [prodUnitMap, setProdUnitMap] = useState({}); // { [ProdKey]: '박스'|'단'|'송이' }
  const [detectedWeek, setDetectedWeek] = useState(''); // Claude가 텍스트에서 감지한 차수
  const [baseStockText, setBaseStockText] = useState('');
  const [remainStockText, setRemainStockText] = useState('');
  const [stockDraft, setStockDraft] = useState(null);
  const [stockCopied, setStockCopied] = useState(false);
  const [orderTemplates, setOrderTemplates] = useState([]);
  const [templateDraft, setTemplateDraft] = useState(null);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [sourceOrdersForTemplate, setSourceOrdersForTemplate] = useState([]);
  const [sourceOrderLoading, setSourceOrderLoading] = useState(false);
  const [bulkUnitEdits, setBulkUnitEdits] = useState({});

  useEffect(() => {
    const localProductCache = loadCache();
    setMappingCache(localProductCache);
    setCustomerMappingCache(loadCustomerCache());
    fetch('/api/orders/mappings', { credentials: 'same-origin' })
      .then(r => r.json())
      .then(d => {
        if (!d.success) return;
        // 서버 공용 매핑을 후보 점수에도 반영한다. 브라우저에서 방금 바꾼 값은 우선한다.
        setMappingCache(prev => ({ ...(d.mappings || {}), ...prev, ...loadCache() }));
      })
      .catch(() => {});
    apiGet('/api/master', { entity: 'customers' }).then(d => setAllCustomers(d.data || []));
    apiGet('/api/master', { entity: 'products'  }).then(d => setAllProducts(d.data  || []));
    apiGet('/api/orders/prod-units').then(d => { if (d.success) setProdUnitMap(d.units || {}); });
    loadOrderTemplates();
    apiGet('/api/orders/weeks').then(d => {
      if (d.success) {
        const def = getDefaultWeek();
        const nearby = getNearby2026Weeks(4); // 2026 최근 ±4주
        const dbWeeks = (d.weeks || []).filter(w => !nearby.includes(w)); // 중복 제거
        // 2026 차수 먼저, 그 다음 DB 구형식(25년도) 차수
        const ws = [...nearby, ...dbWeeks];
        setWeeks(ws);
        setWeek(def);
        setWeekPage(0);
      }
    });
  }, []);

  const parseTemplateFavorite = (fav) => {
    try {
      return { ...fav, data: JSON.parse(fav.FilterData || '{}') };
    } catch {
      return { ...fav, data: null };
    }
  };

  const loadOrderTemplates = async () => {
    try {
      const d = await apiGet('/api/favorites', { page: ORDER_TEMPLATE_PAGE });
      setOrderTemplates((d.favorites || []).map(parseTemplateFavorite).filter(f => f.data?.items?.length));
    } catch {
      setOrderTemplates([]);
    }
  };

  // 캐시 적용: 이미 알고 있는 inputName은 자동 매칭
  const applyCache = (rawOrders, cache, prods) => rawOrders.map(o => ({
    ...o,
    items: o.items.map(it => {
      if (it.prodKey) return it;
      if (it.ambiguousCountry) return it;
      const hit = findLocalMapping(it.inputName, cache);
      if (!hit) return it;
      const prod = prods.find(p => Number(p.ProdKey) === Number(hit.prodKey));
      if (!prod) return it;
      if (isMixBoxMismatch(it.inputName, prod)) return it;
      return {
        ...it,
        prodKey: prod.ProdKey,
        prodName: prod.ProdName,
        displayName: prod.DisplayName || prod.ProdName,
        flowerName: prod.FlowerName,
        counName: prod.CounName,
        fromMapping: true,
        confidence: 0.95,
        confidenceLabel: 'high',
        unit: normalizeOrderUnit(defaultUnit(prod, it.unit, prodUnitMap)),
      };
    }),
  }));

  const refreshStockDraft = (nextText = pasteText, nextBase = baseStockText, nextWeek = week, nextRemain = remainStockText) => {
    const draft = buildKakaoStockDraft({
      text: nextText,
      baseText: nextBase,
      remainText: nextRemain,
      selectedWeek: nextWeek,
      products: allProducts,
    });
    setStockDraft(draft);
    setStockCopied(false);
    return draft;
  };

  const copyStockDraft = async () => {
    if (!stockDraft?.copyText) return;
    try {
      await navigator.clipboard.writeText(stockDraft.copyText);
      setStockCopied(true);
      setTimeout(() => setStockCopied(false), 1800);
    } catch {
      alert('클립보드 복사에 실패했습니다. 결과 박스에서 직접 선택해서 복사해주세요.');
    }
  };

  const handleParse = async () => {
    if (!pasteText.trim()) return;
    refreshStockDraft(pasteText, baseStockText, week, remainStockText);
    setParsing(true);
    setOrders([]);
    setParseError('');
    setQueueIdx(0);
    setDisambigSearch('');
    setDisambigResults([]);
    try {
      const res = await fetch('/api/orders/parse-paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ text: pasteText }),
      });
      const d = await res.json();
      if (!d.success) { setParseError(d.error || '파싱 실패'); return; }

      const cache = { ...mappingCache, ...loadCache() };
      setMappingCache(cache);
      setCustomerMappingCache(loadCustomerCache());

      // 감지된 차수 자동 적용 ("WW-SS" → 현재 연도 붙여서 "YYYY-WW-SS")
      let effectiveWeek = week;
      if (d.detectedWeek) {
        const year = new Date().getFullYear();
        const autoWeek = `${year}-${d.detectedWeek}`;
        setDetectedWeek(d.detectedWeek);
        setWeek(autoWeek);
        effectiveWeek = autoWeek;
        refreshStockDraft(pasteText, baseStockText, autoWeek, remainStockText);
      } else {
        setDetectedWeek('');
      }

      const raw = (d.orders || []).map((o, oi) => ({
        id: oi,
        custName: o.custName || '',
        custMatch: o.custMatch,
        custFromMapping: !!o.custFromMapping,
        custMappingKey: o.custMappingKey || null,
        saving: false,
        resultMsg: '',
        items: (o.items || []).map((it, idx) => {
          const prod = it.prodKey ? allProducts.find(p => Number(p.ProdKey) === Number(it.prodKey)) : null;
          return {
            ...it,
            idx,
            unit: normalizeOrderUnit(defaultUnit(prod, it.unit, prodUnitMap)),
            skip: false,
          };
        }),
      }));

      const applied = applyCache(raw, cache, allProducts);
      setOrders(applied);

      // 거래처 매칭된 업체의 저장내역 자동 로드 (감지된 차수 반영)
      if (effectiveWeek) {
        applied.forEach(async (o) => {
          if (!o.custMatch) return;
          try {
            const od = await apiGet('/api/orders', { custName: o.custMatch.CustName, week: effectiveWeek });
            if (od.success && od.orders?.length > 0) {
              const matched = od.orders.find(r => r.custName === o.custMatch.CustName) || od.orders[0];
              setRegisteredOrders(prev => ({ ...prev, [o.id]: matched }));
            }
          } catch { /* 조회 실패 무시 */ }
        });
      }
    } catch (e) {
      setParseError(e.message);
    } finally {
      setParsing(false);
    }
  };

  // 전체 미매칭 항목 (skip 제외, 이미 매칭된 것 제외)
  const unmatchedQueue = [];
  orders.forEach(o => {
    o.items.forEach((it, idx) => {
      if (!it.skip && !it.prodKey) {
        unmatchedQueue.push({ orderId: o.id, itemIdx: idx, inputName: it.inputName, action: it.action, ambiguityReason: it.ambiguityReason });
      }
    });
  });
  const currentQ = unmatchedQueue[queueIdx] || null;

  const updateItem = (oid, idx, patch) => {
    setOrders(prev => prev.map(o =>
      o.id === oid
        ? { ...o, items: o.items.map((it, i) => i === idx ? { ...it, ...patch } : it) }
        : o
    ));
  };

  // 거래처 매칭 시 자동으로 기존 주문/분배 미리보기 로드
  // (사용자가 수동 검색해서 거래처 선택한 경우도 포함)
  const learnCustomerMapping = (inputName, customer) => {
    if (!inputName || !customer?.CustKey) return;
    const key = customerCacheKey(inputName);
    if (!key) return;
    const value = {
      custKey: customer.CustKey,
      custName: customer.CustName,
      custArea: customer.CustArea || '',
    };
    const updated = { ...loadCustomerCache(), [key]: value };
    setCustomerMappingCache(updated);
    saveCustomerCache(updated);
    fetch('/api/orders/customer-mappings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        inputToken: inputName,
        custKey: customer.CustKey,
        custName: customer.CustName,
        custArea: customer.CustArea,
      }),
    }).catch(() => {});
  };

  const setCustMatch = (oid, customer) => {
    const order = orders.find(o => o.id === oid);
    const inputName = order?.custName || order?.custMatch?.CustName || customer?.CustName;
    updateOrder(oid, {
      custMatch: customer,
      custFromMapping: false,
      custMappingKey: inputName ? customerCacheKey(inputName) : null,
      pendingCustomerLearning: customer && inputName && customer.CustName !== inputName
        ? { inputName, customer }
        : null,
    });
    if (!customer || !week) return;
    // 비동기로 기존 주문 + 분배 fetch
    (async () => {
      try {
        const od = await apiGet('/api/orders', { custName: customer.CustName, week });
        if (od.success && od.orders?.length > 0) {
          const matched = od.orders.find(r => r.custName === customer.CustName) || od.orders[0];
          setRegisteredOrders(prev => ({ ...prev, [oid]: matched }));
          await fetchShipmentQtys(matched.custKey, week, (matched.items || []).map(i => i.prodKey));
        } else {
          // 기존 주문 없음 — empty 상태로 미리보기 표시 (분배 가능 안내)
          setRegisteredOrders(prev => ({ ...prev, [oid]: { custKey: customer.CustKey, custName: customer.CustName, week, items: [], prevSnapshot: {} } }));
        }
      } catch { /* 조회 실패 무시 */ }
    })();
  };

  const updateOrder = (oid, patch) => {
    setOrders(prev => prev.map(o => o.id === oid ? { ...o, ...patch } : o));
  };

  const handleProdSearch = (oid, idx, q) => {
    const results = q ? filterProducts(allProducts, q).slice(0, 10) : [];
    updateItem(oid, idx, { prodSearch: q, prodSearchResults: results });
  };

  const showMappingNotice = ({ inputName, previous, next, savedKey }) => {
    const notice = {
      id: Date.now(),
      inputName,
      previousName: mappingProductName(previous),
      previousMeta: mappingProductMeta(previous),
      nextName: mappingProductName(next),
      nextMeta: mappingProductMeta(next),
      savedKey,
    };
    setMappingNotice(notice);
    setMappingChangeLog(prev => [notice, ...prev.filter(x => x.inputName !== inputName)].slice(0, 5));
    setTimeout(() => {
      setMappingNotice(cur => cur?.id === notice.id ? null : cur);
    }, 7000);
  };

  const clearProductMatchForChange = (oid, idx) => {
    const order = orders.find(o => o.id === oid);
    const item = order?.items?.[idx];
    const previous = item?.prodKey ? {
      prodKey: item.prodKey,
      prodName: item.prodName,
      displayName: item.displayName,
      flowerName: item.flowerName,
      counName: item.counName,
    } : null;
    updateItem(oid, idx, {
      prodKey: null,
      prodName: null,
      displayName: null,
      flowerName: null,
      counName: null,
      confidence: 0,
      confidenceLabel: 'none',
      fromMapping: false,
      pendingMappingFrom: previous,
      mappingChanged: false,
      mappingSavedKey: null,
    });
  };

  const learnItemMapping = (item, prodOverride = null) => {
    const prod = prodOverride || allProducts.find(p => Number(p.ProdKey) === Number(item?.prodKey));
    if (!item?.inputName || !prod) return null;
    const key = cacheKey(item.inputName);
    if (!key) return null;
    const value = {
      prodKey: prod.ProdKey,
      prodName: prod.ProdName,
      displayName: prod.DisplayName,
      flowerName: prod.FlowerName,
      counName: prod.CounName,
    };
    const updated = { ...loadCache(), [key]: value };
    setMappingCache(updated);
    saveCache(updated);
    fetch('/api/orders/mappings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        inputToken: item.inputName,
        prodKey: prod.ProdKey,
        prodName: prod.ProdName,
        displayName: prod.DisplayName,
        flowerName: prod.FlowerName,
        counName: prod.CounName,
        force: true,
      }),
    }).catch(() => {});
    return { key, value };
  };

  // 미매칭 질문 패널: 사용자가 품목 선택
  const handleDisambigSelect = (prod, saveToCache = true) => {
    if (!currentQ) return;
    const { orderId, itemIdx, inputName } = currentQ;
    const currentOrder = orders.find(o => o.id === orderId);
    const currentItem = currentOrder?.items?.[itemIdx] || {};
    const previous = currentItem.pendingMappingFrom || null;
    const changed = !!previous && Number(previous.prodKey) !== Number(prod.ProdKey);
    updateItem(orderId, itemIdx, {
      prodKey:     prod.ProdKey,
      prodName:    prod.ProdName,
      displayName: prod.DisplayName || prod.ProdName,
      flowerName:  prod.FlowerName,
      counName:    prod.CounName,
      unit:        normalizeOrderUnit(defaultUnit(prod, null, prodUnitMap)),  // 장미/네덜란드 → 단, 나머지 → 박스
      fromMapping: false,
      mappingMatchType: 'direct-select',
      mappingMatchKey: null,
      confidence: 1,
      confidenceLabel: 'high',
      fallbackSuspect: false,
      fallbackCount: 0,
      ambiguousCountry: false,
      ambiguityReason: null,
      pendingMappingFrom: null,
      mappingChanged: changed,
      mappingSavedKey: null,
      mappingSavedAt: null,
      pendingLearning: saveToCache,
    });
    setDisambigSearch('');
    setDisambigResults([]);
    // queueIdx는 그대로 — 이 항목이 사라지면서 다음 항목이 자동으로 currentQ가 됨
  };

  const handleDisambigSkip = () => {
    if (!currentQ) return;
    updateItem(currentQ.orderId, currentQ.itemIdx, { skip: true });
    setDisambigSearch('');
    setDisambigResults([]);
  };

  const handleDisambigSkipAll = () => {
    unmatchedQueue.forEach(q => updateItem(q.orderId, q.itemIdx, { skip: true }));
    setDisambigSearch('');
    setDisambigResults([]);
  };

  // 품목 스코어링: lib/displayName.js의 scoreMatch 위임 (한글↔영문 역변환 + 토큰별 매칭 + 마지막 토큰 보너스)
  const scoreProduct = (inputName, prod, searchQuery = '') =>
    isMixBoxMismatch(inputName, prod) ? 0 : scoreMatch(inputName, prod, searchQuery);

  // 후보 목록: 최고점 근처 후보만 표시해 무관한 품목 노출을 줄인다.
  // - 자동 후보는 입력명 기준으로 매우 가까운 것만 표시
  // - 검색어 입력 시에도 낮은 점수 후보는 제외
  const buildCandidates = (inputName, searchQuery) => {
    const savedHit = findLocalMapping(inputName, mappingCache);
    const scored = allProducts
      .map(p => {
        const baseScore = scoreProduct(inputName, p, searchQuery);
        const savedScore = savedHit?.prodKey && Number(savedHit.prodKey) === Number(p.ProdKey) && !isMixBoxMismatch(inputName, p) ? 99 : 0;
        return { prod: p, score: Math.max(baseScore, savedScore) };
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const an = getDisplayName(a.prod) || a.prod.ProdName || '';
        const bn = getDisplayName(b.prod) || b.prod.ProdName || '';
        return an.localeCompare(bn, 'ko');
      });
    const topScore = scored[0]?.score || 0;
    const baseMin = searchQuery ? 50 : 55;
    if (topScore < baseMin) return [];
    const nearTop = topScore >= 70 ? topScore - 18 : topScore >= 55 ? topScore - 12 : topScore;
    const minScore = Math.max(baseMin, nearTop);
    const filtered = scored.filter(x => x.score >= minScore);
    const byCountry = [];
    const seenCountry = new Set();
    for (const x of filtered) {
      const country = String(x.prod.CounName || '').trim() || '기타';
      if (!seenCountry.has(country)) {
        seenCountry.add(country);
        byCountry.push(x);
      }
    }
    const merged = [...byCountry, ...filtered];
    const seenProd = new Set();
    return merged
      .filter(x => {
        const key = Number(x.prod.ProdKey);
        if (seenProd.has(key)) return false;
        seenProd.add(key);
        return true;
      })
      .slice(0, searchQuery ? 12 : 10);
  };

  const handleDisambigSearchChange = (q) => {
    setDisambigSearch(q);
    setDisambigResults(buildCandidates(currentQ?.inputName || '', q));
  };

  // currentQ 바뀌면 자동으로 후보 계산
  useEffect(() => {
    if (currentQ) {
      setDisambigSearch('');
      setDisambigResults(buildCandidates(currentQ.inputName, ''));
    } else {
      setDisambigResults([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQ?.orderId, currentQ?.itemIdx]);

  const flog = (step, detail) => fetch('/api/log', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
    body: JSON.stringify({ category: 'paste', step, detail: String(detail) }),
  }).catch(() => {});

  // 분배수량(ShipmentDetail.OutQuantity) 일괄 조회
  const fetchShipmentQtys = async (custKey, week, prodKeys) => {
    if (!custKey || !week || !prodKeys?.length) return;
    try {
      const r = await fetch(`/api/shipment/distribute?type=custItems&week=${encodeURIComponent(week)}&custKey=${custKey}`);
      const d = await r.json();
      if (d.success && d.items) {
        const updates = {};
        d.items.forEach(it => {
          updates[`${custKey}-${it.ProdKey}-${week}`] = it.출고수량 || 0;
        });
        setShipmentQtys(prev => ({ ...prev, ...updates }));
      }
    } catch { /* 조회 실패해도 무시 */ }
  };

  const buildBulkRegisteredFallback = (order, details, prev = null) => {
    const okDetails = (details || []).filter(x => x.ok);
    const prevItemsByKey = new Map((prev?.items || []).map(it => [Number(it.prodKey), it]));
    const touchedKeys = new Set(okDetails.map(x => Number(x.prodKey)).filter(Boolean));
    const allKeys = new Set([...prevItemsByKey.keys(), ...touchedKeys]);
    const prevSnapshot = {};
    const items = [...allKeys].map(pk => {
      const oldItem = prevItemsByKey.get(pk);
      const detail = okDetails.filter(x => Number(x.prodKey) === pk).slice(-1)[0];
      if (!oldItem && detail?.orderQtyBefore > 0) prevSnapshot[pk] = Number(detail.orderQtyBefore || 0);
      if (oldItem) prevSnapshot[pk] = Number(oldItem.qty || 0);
      const orderQty = Number.isFinite(Number(detail?.orderQtyAfter))
        ? Number(detail.orderQtyAfter)
        : Number(oldItem?.qty || detail?.qty || 0);
      return {
        prodKey: pk,
        prodName: oldItem?.prodName || detail?.prodName || '',
        displayName: oldItem?.displayName || detail?.displayName || detail?.prodName || '',
        counName: oldItem?.counName || detail?.counName || '',
        flowerName: oldItem?.flowerName || detail?.flowerName || '',
        qty: orderQty,
        unit: normalizeOrderUnit(oldItem?.unit || detail?.unit),
      };
    }).filter(it => it.prodKey && (it.qty !== 0 || touchedKeys.has(Number(it.prodKey))));
    return {
      ...(prev || {}),
      custKey: order.custMatch.CustKey,
      custName: order.custMatch.CustName,
      week,
      items,
      prevSnapshot,
      _fallback: true,
    };
  };

  const buildRegisterRegisteredFallback = (order, savedItems, prevSnapshot = {}, prevItems = [], prev = null) => {
    const itemsByKey = new Map();
    [...(prevItems || []), ...(prev?.items || [])].forEach(it => {
      const pk = Number(it.prodKey);
      if (!pk) return;
      itemsByKey.set(pk, {
        prodKey: pk,
        prodName: it.prodName || '',
        displayName: it.displayName || it.prodName || '',
        counName: it.counName || '',
        flowerName: it.flowerName || '',
        qty: Number(it.qty || 0),
        unit: normalizeOrderUnit(it.unit),
      });
    });

    const deltasByKey = new Map();
    (savedItems || []).forEach(it => {
      const pk = Number(it.prodKey);
      if (!pk) return;
      const prevDelta = deltasByKey.get(pk);
      const deltaQty = Number(it.qty || 0);
      if (prevDelta) {
        prevDelta.qty += deltaQty;
      } else {
        deltasByKey.set(pk, { ...it, prodKey: pk, qty: deltaQty });
      }
    });

    deltasByKey.forEach((it, pk) => {
      const oldItem = itemsByKey.get(pk);
      const baseQty = oldItem
        ? Number(oldItem.qty || 0)
        : Number(prevSnapshot?.[pk] || 0);
      itemsByKey.set(pk, {
        prodKey: pk,
        prodName: oldItem?.prodName || it.prodName || '',
        displayName: oldItem?.displayName || it.displayName || it.prodName || '',
        counName: oldItem?.counName || it.counName || '',
        flowerName: oldItem?.flowerName || it.flowerName || '',
        qty: baseQty + Number(it.qty || 0),
        unit: normalizeOrderUnit(oldItem?.unit || it.unit),
      });
    });

    return {
      ...(prev || {}),
      custKey: order.custMatch.CustKey,
      custName: order.custMatch.CustName,
      week,
      items: [...itemsByKey.values()].filter(it => it.prodKey),
      prevSnapshot,
      _fallback: true,
    };
  };

  const ensureWeekCanDistribute = async (targetWeek, prodKeys = []) => {
    if (!targetWeek) {
      alert('차수를 선택하세요.');
      return false;
    }
    try {
      const targetProdKeys = [...new Set((prodKeys || []).map(Number).filter(Boolean))];
      if (targetProdKeys.length > 0) {
        const d = await apiGet('/api/shipment/adjust', {
          type: 'fixCheck',
          week: targetWeek,
          prodKeys: targetProdKeys.join(','),
        });
        if (!d.success) throw new Error(d.error || '품목군 확정 상태 조회 실패');
        if (d.blocked) {
          const scopes = (d.blockedScopes || []).map(s => s.scopeName).filter(Boolean).join(', ') || '선택 품목군';
          alert(`${formatWeekDisplay(targetWeek)} ${scopes}은(는) 확정 상태입니다.\n확정된 품목군은 출고분배/분배조정을 할 수 없습니다.\n해당 품목군 확정취소 후 다시 진행하세요.`);
          return false;
        }
        return true;
      }

      const d = await apiGet('/api/shipment/fix-status', { fromWeek: targetWeek, toWeek: targetWeek });
      if (!d.success) throw new Error(d.error || '확정 상태 조회 실패');
      const targetShort = shortWeekLabel(targetWeek);
      const fixedInfo = (d.weeks || []).find(w => shortWeekLabel(`${w.OrderYear}-${w.OrderWeek}`) === targetShort) || (d.weeks || [])[0];
      const blocked = fixedInfo && (
        fixedInfo.status === 'FIXED' ||
        fixedInfo.status === 'PARTIAL' ||
        Number(fixedInfo.stockFixed || 0) > 0 ||
        Number(fixedInfo.fixedMasterCount || 0) > 0 ||
        Number(fixedInfo.fixedDetailCount || 0) > 0
      );
      if (blocked) {
        const statusText = fixedInfo.status === 'PARTIAL' ? '일부 확정' : '확정';
        alert(`${formatWeekDisplay(targetWeek)} 차수는 ${statusText} 상태입니다.\n확정된 차수는 출고분배/분배조정을 할 수 없습니다.\n먼저 차수 확정취소 후 다시 진행하세요.`);
        return false;
      }
      return true;
    } catch (e) {
      alert(`차수 확정 상태를 확인하지 못했습니다.\n출고분배를 진행하지 않습니다.\n\n${e.message}`);
      return false;
    }
  };

  // 일괄 등록+분배 — 입력 텍스트의 action(추가/취소) 그대로 ADD/CANCEL 호출
  // 사용 시점: 텍스트 파싱 후 [🚀 일괄 등록+분배] 버튼 클릭
  // 동작:
  //   - "5 추가" 입력 → adjust ADD qty=5 → OrderDetail+5 + ShipmentDetail+5
  //   - "1 박스 취소" 입력 → adjust CANCEL qty=1 → OrderDetail-1 + ShipmentDetail-1
  //     (붙여넣기가 0에서 만든 주문은 분배가 0으로 돌아가면 자동 삭제)
  // 주의: adjust API 의 ADD 가 이미 OrderDetail+ShipmentDetail 동시 처리하므로
  //       handleRegister 별도 호출 불필요.
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResult, setBulkResult] = useState(null); // { okCount, failCount, details }
  const handleBulkDistribute = async (oid) => {
    const order = orders.find(o => o.id === oid);
    if (!order || !order.custMatch || !week) { alert('거래처/차수 확인하세요.'); return; }

    const targets = (order.items || []).filter(it => !it.skip && it.prodKey).map(it => ({
      prodKey: it.prodKey, prodName: it.prodName, inputName: it.inputName,
      displayName: it.displayName,
      flowerName: it.flowerName,
      counName: it.counName,
      qty: parseFloat(it.qty) || 0,
      unit: normalizeOrderUnit(it.unit, '단'),
      action: it.action || '추가',  // 기본 추가
    })).filter(x => x.qty > 0);

    if (targets.length === 0) { alert('처리할 품목이 없습니다.'); return; }
    if (!(await ensureWeekCanDistribute(week, targets.map(t => t.prodKey)))) return;

    // 미리보기: ADD/CANCEL 자동 분기
    const previewLines = targets.map(x => {
      const isCancel = x.action === '취소';
      return `${x.prodName}: ${isCancel ? '−' : '+'}${x.qty}${x.unit} (${isCancel ? '취소' : '추가'})`;
    });

    if (!confirm(`${order.custMatch.CustName} / ${week}\n${targets.length}개 품목 일괄 등록+분배:\n\n${previewLines.join('\n')}\n\n진행하시겠습니까?\n(추가는 주문등록+분배 동시 +, 취소는 주문등록+분배 동시 − / 0이 되면 주문상세 삭제)`)) return;

    setBulkRunning(true); setBulkResult(null);
    const details = [];
    for (const t of targets) {
      const type = (t.action === '취소') ? 'CANCEL' : 'ADD';
      try {
        const r = await fetch('/api/shipment/adjust', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
          body: JSON.stringify({
            custKey: order.custMatch.CustKey, prodKey: t.prodKey, week,
            type, qty: t.qty, unit: t.unit,
            memo: `붙여넣기 일괄${type === 'ADD' ? '추가' : '취소'}: ${t.inputName || t.prodName} ${t.qty}${t.unit}`,
            force: true,
          }),
        });
        const j = await r.json();
        details.push({
          ...t,
          type,
          ok: !!j.success,
          error: j.error,
          qtyBefore: j.qtyBefore,
          qtyAfter: j.qtyAfter,
          orderQtyBefore: j.orderQtyBefore,
          orderQtyAfter: j.orderQtyAfter,
          outQtyBefore: j.outQtyBefore,
          outQtyAfter: j.outQtyAfter,
          remainBefore: j.remainBefore,
          remainAfter: j.remainAfter,
          totalIn: j.totalIn,
          totalOut: j.totalOut,
        });
      } catch (e) {
        details.push({ ...t, type, ok: false, error: e.message });
      }
    }
    const okCount = details.filter(x => x.ok).length;
    const failCount = details.filter(x => !x.ok).length;
    setBulkResult({ orderId: oid, okCount, failCount, details });

    if (okCount > 0) {
      setRegisteredOrders(prev => ({
        ...prev,
        [oid]: buildBulkRegisteredFallback(order, details, prev[oid]),
      }));

      const shipUpdates = {};
      details.filter(x => x.ok && (Number.isFinite(Number(x.outQtyAfter)) || Number.isFinite(Number(x.qtyAfter)))).forEach(x => {
        const shipQty = Number.isFinite(Number(x.outQtyAfter)) ? Number(x.outQtyAfter) : Number(x.qtyAfter || 0);
        shipUpdates[`${order.custMatch.CustKey}-${x.prodKey}-${week}`] = shipQty;
      });
      if (Object.keys(shipUpdates).length > 0) {
        setShipmentQtys(prev => ({ ...prev, ...shipUpdates }));
      }
    }

    details.filter(x => x.ok).forEach(x => learnItemMapping(x));
    if (okCount > 0 && order.pendingCustomerLearning) {
      learnCustomerMapping(order.pendingCustomerLearning.inputName, order.pendingCustomerLearning.customer);
      updateOrder(oid, { pendingCustomerLearning: null });
    }
    updateOrder(oid, {
      resultMsg: okCount > 0
        ? `일괄 등록+분배 완료: 성공 ${okCount}건${failCount ? ` / 실패 ${failCount}건` : ''}`
        : `일괄 등록+분배 실패: ${failCount}건`,
    });
    setBulkRunning(false);
    // 화면 갱신 — 등록 후 DB 주문내역 + 분배수량 함께 새로 로드
    try {
      const od = await apiGet('/api/orders', { custName: order.custMatch.CustName, week });
      if (od.success && od.orders?.length > 0) {
        const matched = od.orders.find(o => o.custName === order.custMatch.CustName) || od.orders[0];
        setRegisteredOrders(prev => ({
          ...prev,
          [oid]: { ...matched, prevSnapshot: prev[oid]?.prevSnapshot || {} },
        }));
        await fetchShipmentQtys(matched.custKey, week, (matched.items || []).map(i => i.prodKey));
      }
    } catch { /* 갱신 실패해도 결과는 표시 */ }
  };

  // 등록된 주문을 기준으로 분배만 다시 저장한다.
  // 등록 후 하단 "일괄 분배"에서 주문등록이 재가산되지 않도록 /api/shipment/distribute 만 호출.
  const handleDistributeOnly = async (oid) => {
    const ro = registeredOrders[oid];
    const targetWeek = ro?.week || week;
    if (!ro || !ro.custKey || !targetWeek) { alert('등록된 주문내역/차수를 확인하세요.'); return; }

    const targets = (ro.items || []).filter(it => it.prodKey && Number(it.qty || 0) > 0).map(it => ({
      prodKey: it.prodKey,
      prodName: it.prodName,
      displayName: it.displayName,
      flowerName: it.flowerName,
      counName: it.counName,
      qty: Number(it.qty || 0),
      unit: normalizeOrderUnit(it.unit),
    }));
    if (targets.length === 0) { alert('분배할 등록 품목이 없습니다.'); return; }
    if (!(await ensureWeekCanDistribute(targetWeek, targets.map(t => t.prodKey)))) return;

    const previewLines = targets.slice(0, 20).map(x => `${x.displayName || x.prodName}: ${x.qty}${x.unit}`);
    const moreText = targets.length > previewLines.length ? `\n... 외 ${targets.length - previewLines.length}건` : '';
    if (!confirm(`${ro.custName} / ${formatWeekDisplay(targetWeek)}\n등록된 주문수량으로 ${targets.length}개 품목을 출고분배로 다시 저장합니다.\n\n${previewLines.join('\n')}${moreText}\n\n진행하시겠습니까?`)) return;

    setBulkRunning(true); setBulkResult(null);
    const details = [];
    for (const t of targets) {
      const shipKey = `${ro.custKey}-${t.prodKey}-${targetWeek}`;
      const beforeQty = Number(shipmentQtys[shipKey] || 0);
      try {
        const r = await fetch('/api/shipment/distribute', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
          body: JSON.stringify({
            custKey: ro.custKey,
            prodKey: t.prodKey,
            week: targetWeek,
            outQty: t.qty,
          }),
        });
        const j = await r.json();
        details.push({
          ...t,
          type: 'DISTRIBUTE',
          ok: !!j.success,
          error: j.error,
          qtyBefore: beforeQty,
          qtyAfter: t.qty,
          outQtyBefore: beforeQty,
          outQtyAfter: t.qty,
        });
      } catch (e) {
        details.push({ ...t, type: 'DISTRIBUTE', ok: false, error: e.message });
      }
    }
    const okCount = details.filter(x => x.ok).length;
    const failCount = details.filter(x => !x.ok).length;
    setBulkResult({ orderId: oid, okCount, failCount, details });

    if (okCount > 0) {
      const shipUpdates = {};
      details.filter(x => x.ok).forEach(x => {
        shipUpdates[`${ro.custKey}-${x.prodKey}-${targetWeek}`] = Number(x.outQtyAfter || 0);
      });
      setShipmentQtys(prev => ({ ...prev, ...shipUpdates }));
      await fetchShipmentQtys(ro.custKey, targetWeek, targets.map(t => t.prodKey));
    }

    updateOrder(oid, {
      resultMsg: okCount > 0
        ? `일괄 분배 완료: 성공 ${okCount}건${failCount ? ` / 실패 ${failCount}건` : ''}`
        : `일괄 분배 실패: ${failCount}건`,
    });
    setBulkRunning(false);
  };

  // ADD/CANCEL 단일 액션
  const handleAdjust = async (force = false) => {
    if (!adjustModal) return;
    const delta = parseFloat(adjustQty);
    if (!(delta > 0)) { alert('수량은 0보다 커야 합니다.'); return; }
    if (!(await ensureWeekCanDistribute(adjustModal.week, [adjustModal.prodKey]))) return;
    setAdjustSaving(true);
    try {
      const r = await fetch('/api/shipment/adjust', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify({
          custKey: adjustModal.custKey, prodKey: adjustModal.prodKey, week: adjustModal.week,
          type: adjustModal.type, qty: delta, unit: adjustModal.unit,
          memo: '붙여넣기 등록 후 분배조정', force,
        }),
      });
      const d = await r.json();
      // 입고 미등록/초과 차단 → 강제 진행 옵션 안내
      if (!d.success && !force && d.error && (d.error.includes('입고 미등록') || d.error.includes('입고') && d.error.includes('초과'))) {
        const proceed = confirm(`${d.error}\n\n그래도 진행하시겠습니까?`);
        if (proceed) {
          setAdjustSaving(false);
          return handleAdjust(true);
        }
        setAdjustSaving(false);
        return;
      }
      if (d.success) {
        // 분배수량 갱신
        const key = `${adjustModal.custKey}-${adjustModal.prodKey}-${adjustModal.week}`;
        const shipQty = Number.isFinite(Number(d.outQtyAfter)) ? Number(d.outQtyAfter) : Number(d.qtyAfter || 0);
        setShipmentQtys(prev => ({ ...prev, [key]: shipQty }));
        // ADD/CANCEL 모두 OrderDetail 이 변경됨 → registeredOrders 도 다시 조회
        if (adjustModal.type === 'ADD' || adjustModal.type === 'CANCEL' || d.orderDeleted) {
          const od = await apiGet('/api/orders', { custName: adjustModal.custName, week: adjustModal.week });
          setRegisteredOrders(prev => {
            const oid = Object.keys(prev).find(k => prev[k]?.custKey === adjustModal.custKey && prev[k]?.week === adjustModal.week);
            if (!oid) return prev;
            if (od.success && od.orders?.length > 0) {
              const matched = od.orders.find(o => o.custName === adjustModal.custName) || od.orders[0];
              return { ...prev, [oid]: { ...matched, prevSnapshot: prev[oid].prevSnapshot } };
            }
            const next = { ...prev };
            delete next[oid];
            return next;
          });
        }
        setAdjustModal(null); setAdjustQty('');
      } else {
        alert(`${adjustModal.type} 실패: ${d.error}`);
      }
    } catch (e) {
      alert('네트워크 오류: ' + e.message);
    } finally {
      setAdjustSaving(false);
    }
  };

  const handleRegister = async (oid) => {
    const order = orders.find(o => o.id === oid);

    const allItems  = order?.items || [];
    const activeItems = allItems.filter(it => !it.skip);
    const matched   = activeItems.filter(it => it.prodKey);
    const unmatched = activeItems.filter(it => !it.prodKey);
    await flog('버튼클릭', `oid=${oid} custMatch=${order?.custMatch?.CustName||'없음'} week=${week} 전체=${allItems.length} 대상=${activeItems.length} 매칭=${matched.length} 미매칭=${unmatched.length} 미매칭품목=${unmatched.map(i=>i.inputName||'?').join(',')}`);

    if (!order?.custMatch) { alert('거래처를 확인하세요.'); return; }
    if (!week) { alert('차수를 선택하세요.'); return; }

    const registerItems = order.items
      .filter(it => !it.skip && it.prodKey)
      .map(it => {
        const prod = allProducts.find(p => Number(p.ProdKey) === Number(it.prodKey));
        const signedQty = it.action === '취소' ? -Math.abs(Number(it.qty || 0)) : Math.abs(Number(it.qty || 0));
        return {
          prodKey: it.prodKey,
          prodName: it.prodName,
          displayName: it.displayName,
          flowerName: it.flowerName,
          counName: it.counName,
          qty: signedQty,
          unit: normalizeOrderUnit(it.unit),
          descr: extractMoqText(prod),
        };
      });
    const items = registerItems.map(it => ({
      prodKey: it.prodKey,
      prodName: it.prodName,
      qty: it.qty,
      unit: it.unit,
      descr: it.descr,
    }));

    if (items.length === 0) { await flog('0건차단', `미매칭으로 API 미호출`); alert('등록할 품목이 없습니다.'); return; }

    const yearFromWeek = week.match(/^(\d{4})-/) ? week.match(/^(\d{4})-/)[1] : String(new Date().getFullYear());

    updateOrder(oid, { saving: true, resultMsg: '' });

    // 저장 직전 스냅샷 — 변경 셀 표시용 (prev qty per ProdKey)
    const prevSnapshot = {};
    let prevItems = [];
    try {
      const pre = await apiGet('/api/orders', { custName: order.custMatch.CustName, week });
      if (pre.success) {
        const preMatch = pre.orders?.find(o => o.custName === order.custMatch.CustName) || pre.orders?.[0];
        prevItems = preMatch?.items || [];
        prevItems.forEach(it => { prevSnapshot[it.prodKey] = it.qty; });
      }
    } catch { /* 스냅샷 실패해도 등록은 진행 */ }

    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ custKey: order.custMatch.CustKey, week, year: yearFromWeek, items, delta: true, source: 'paste' }),
      });
      const d = await res.json();
      if (d.success) {
        const okCount = d.results?.filter(r => r.status === 'OK' || r.status === 'UPDATED' || r.status === 'ADDED' || r.status === 'DELETED').length ?? items.length;
        updateOrder(oid, { saving: false, resultMsg: `✅ ${okCount}개 저장 완료 (${order.custMatch.CustName} / ${formatWeekDisplay(week)}) — OrderKey: ${d.orderMasterKey}${d.warning ? ` / ⚠️ ${d.warning}` : ''}` });
        const fallbackPreview = buildRegisterRegisteredFallback(order, registerItems, prevSnapshot, prevItems, registeredOrders[oid]);
        setRegisteredOrders(prev => ({
          ...prev,
          [oid]: buildRegisterRegisteredFallback(order, registerItems, prevSnapshot, prevItems, prev[oid]),
        }));
        await fetchShipmentQtys(order.custMatch.CustKey, week, fallbackPreview.items.map(i => i.prodKey));
        if (order.pendingCustomerLearning) {
          learnCustomerMapping(order.pendingCustomerLearning.inputName, order.pendingCustomerLearning.customer);
          updateOrder(oid, { pendingCustomerLearning: null });
        }
        try {
          const od = await apiGet('/api/orders', { custName: order.custMatch.CustName, week });
          if (od.success && od.orders?.length > 0) {
            const matched = od.orders.find(o => o.custName === order.custMatch.CustName) || od.orders[0];
            setRegisteredOrders(prev => ({ ...prev, [oid]: { ...matched, prevSnapshot } }));
            // 각 품목의 현재 분배(ShipmentDetail.OutQuantity) 가져오기
            await fetchShipmentQtys(matched.custKey, week, (matched.items || []).map(i => i.prodKey));
          }
        } catch { /* 조회 실패해도 저장은 완료 */ }
      } else {
        updateOrder(oid, { saving: false, resultMsg: `❌ ${d.error || '저장 실패'}` });
      }
    } catch (e) {
      updateOrder(oid, { saving: false, resultMsg: `❌ 네트워크 오류: ${e.message}` });
    }
  };

  const totalAdd    = orders.reduce((s, o) => s + o.items.filter(it => !it.skip && it.action !== '취소' && it.prodKey).length, 0);
  const totalCancel = orders.reduce((s, o) => s + o.items.filter(it => !it.skip && it.action === '취소').length, 0);
  const cachedEntries = Object.keys(mappingCache).length;
  const openWeekPivot = () => {
    const suffix = week ? `?weekFrom=${encodeURIComponent(week)}&weekTo=${encodeURIComponent(week)}` : '';
    const popup = window.open(
      `/shipment/week-pivot${suffix}`,
      'weekPivotPopup',
      'width=1600,height=920,left=20,top=20,resizable=yes,scrollbars=yes'
    );
    if (!popup) window.location.href = `/shipment/week-pivot${suffix}`;
  };

  const openMappingStatus = () => {
    const snapshot = {
      savedAt: new Date().toISOString(),
      week,
      detectedWeek,
      mappingCache: loadCache(),
      customerMappingCache,
      orders: orders.map(o => ({
        id: o.id,
        inputCustName: o.custName || '',
        custName: o.custMatch?.CustName || o.custName || '',
        custKey: o.custMatch?.CustKey || null,
        custFromMapping: !!o.custFromMapping,
        custMappingKey: o.custMappingKey || null,
        items: (o.items || []).map(it => ({
          inputName: it.inputName,
          prodKey: it.prodKey || null,
          prodName: it.prodName || '',
          displayName: it.displayName || '',
          flowerName: it.flowerName || '',
          counName: it.counName || '',
          qty: it.qty,
          unit: normalizeOrderUnit(it.unit),
          action: it.action,
          skip: !!it.skip,
          fromMapping: !!it.fromMapping,
          mappingMatchType: it.mappingMatchType || null,
          mappingMatchKey: it.mappingMatchKey || null,
          confidence: it.confidence ?? null,
          confidenceLabel: it.confidenceLabel || '',
          fallbackSuspect: !!it.fallbackSuspect,
        })),
      })),
    };
    try {
      sessionStorage.setItem('nenova_paste_mapping_status', JSON.stringify(snapshot));
    } catch {}
    const popup = window.open(
      '/orders/mapping-status?popup=1',
      'pasteMappingStatus',
      'width=1180,height=820,left=80,top=40,resizable=yes,scrollbars=yes'
    );
    if (!popup) window.location.href = '/orders/mapping-status?popup=1';
  };

  const saveTemplateFromRegistered = async (order, registeredOrder) => {
    if (!registeredOrder?.items?.length) { alert('저장할 주문내역이 없습니다.'); return; }
    const defaultName = `${registeredOrder.custName || order.custMatch?.CustName || '주문'} ${formatWeekDisplay(registeredOrder.week || week)}`;
    const name = prompt('즐겨찾기 이름을 입력하세요:', defaultName);
    if (!name) return;
    const data = {
      custKey: registeredOrder.custKey || order.custMatch?.CustKey,
      custName: registeredOrder.custName || order.custMatch?.CustName || '',
      sourceWeek: registeredOrder.week || week,
      items: (registeredOrder.items || [])
        .filter(it => it.prodKey && Number(it.qty || 0) !== 0)
        .map(it => favoriteItemFromOrderItem(it, allProducts)),
    };
    if (!data.custKey || data.items.length === 0) { alert('거래처와 품목수량을 확인하세요.'); return; }
    try {
      await apiPost('/api/favorites', {
        page: ORDER_TEMPLATE_PAGE,
        name,
        filterData: JSON.stringify(data),
      });
      await loadOrderTemplates();
      alert('주문 즐겨찾기에 저장했습니다.');
    } catch (e) {
      alert(`즐겨찾기 저장 실패: ${e.message}`);
    }
  };

  const loadTemplateDraft = (favKey) => {
    const fav = orderTemplates.find(f => Number(f.FavoriteKey) === Number(favKey));
    if (!fav?.data) { setTemplateDraft(null); return; }
    setTemplateDraft({
      favoriteKey: fav.FavoriteKey,
      name: fav.FavName,
      custKey: fav.data.custKey,
      custName: fav.data.custName,
      sourceWeek: fav.data.sourceWeek,
      items: (fav.data.items || []).map(it => ({ ...it, unit: normalizeOrderUnit(it.unit) })),
      resultMsg: '',
    });
  };

  const setTemplateDraftFromOrder = (order) => {
    if (!order) return;
    setTemplateDraft({
      favoriteKey: null,
      name: `${order.custName || '주문'} ${formatWeekDisplay(order.week || week)}`,
      custKey: order.custKey,
      custName: order.custName,
      sourceWeek: order.week || week,
      items: (order.items || [])
        .filter(it => it.prodKey && Number(it.qty || 0) !== 0)
        .map(it => favoriteItemFromOrderItem(it, allProducts)),
      resultMsg: '',
    });
  };

  const loadSourceOrdersForTemplate = async () => {
    if (!week) { alert('불러올 차수를 먼저 선택하세요.'); return; }
    setSourceOrderLoading(true);
    try {
      const d = await apiGet('/api/orders', { week });
      const list = d.orders || [];
      setSourceOrdersForTemplate(list);
      if (!list.length) alert(`${formatWeekDisplay(week)} 주문등록 내역이 없습니다.`);
    } catch (e) {
      alert(`기존 주문 불러오기 실패: ${e.message}`);
    } finally {
      setSourceOrderLoading(false);
    }
  };

  const updateTemplateItem = (idx, patch) => {
    setTemplateDraft(prev => prev ? ({
      ...prev,
      items: prev.items.map((it, i) => i === idx ? { ...it, ...patch } : it),
    }) : prev);
  };

  const saveTemplateDraft = async () => {
    if (!templateDraft?.items?.length) return;
    setTemplateSaving(true);
    try {
      if (templateDraft.favoriteKey) {
        await apiDelete('/api/favorites', { favoriteKey: templateDraft.favoriteKey });
      }
      const saved = await apiPost('/api/favorites', {
        page: ORDER_TEMPLATE_PAGE,
        name: templateDraft.name || templateDraft.custName || '주문 즐겨찾기',
        filterData: JSON.stringify({
          custKey: templateDraft.custKey,
          custName: templateDraft.custName,
          sourceWeek: templateDraft.sourceWeek,
          items: templateDraft.items
            .filter(it => it.prodKey && Number(it.qty || 0) !== 0)
            .map(it => {
              const base = favoriteItemFromOrderItem(it, allProducts);
              return { ...base, descr: it.descr || base.descr };
            }),
        }),
      });
      await loadOrderTemplates();
      setTemplateDraft(prev => prev ? ({ ...prev, favoriteKey: saved.favoriteKey || prev.favoriteKey, resultMsg: '저장 완료' }) : prev);
    } catch (e) {
      alert(`즐겨찾기 수정 저장 실패: ${e.message}`);
    } finally {
      setTemplateSaving(false);
    }
  };

  const registerTemplateDraft = async () => {
    if (!templateDraft?.custKey) { alert('즐겨찾기 거래처가 없습니다.'); return; }
    if (!week) { alert('차수를 선택하세요.'); return; }
    const items = (templateDraft.items || [])
      .filter(it => it.prodKey && Number(it.qty || 0) !== 0)
      .map(it => ({
        prodKey: it.prodKey,
        prodName: it.prodName,
        qty: Number(it.qty || 0),
        unit: normalizeOrderUnit(it.unit),
        descr: it.descr || extractMoqText(allProducts.find(p => Number(p.ProdKey) === Number(it.prodKey))),
      }));
    if (!items.length) { alert('등록할 품목수량이 없습니다.'); return; }
    if (!confirm(`${templateDraft.custName} / ${formatWeekDisplay(week)}\n즐겨찾기 ${items.length}개 품목을 주문등록하시겠습니까?`)) return;
    setTemplateSaving(true);
    try {
      const yearFromWeek = week.match(/^(\d{4})-/) ? week.match(/^(\d{4})-/)[1] : String(new Date().getFullYear());
      const d = await apiPost('/api/orders', {
        custKey: templateDraft.custKey,
        week,
        year: yearFromWeek,
        items,
        delta: true,
        source: 'paste-template',
      });
      if (!d.success) throw new Error(d.error || '주문등록 실패');
      setTemplateDraft(prev => prev ? ({ ...prev, resultMsg: `등록 완료 — OrderKey ${d.orderMasterKey}` }) : prev);
      const od = await apiGet('/api/orders', { custName: templateDraft.custName, week });
      if (od.success && od.orders?.length > 0) {
        const matched = od.orders.find(o => Number(o.custKey) === Number(templateDraft.custKey)) || od.orders[0];
        setRegisteredOrders(prev => ({ ...prev, [`template-${templateDraft.favoriteKey || 'new'}`]: matched }));
      }
    } catch (e) {
      setTemplateDraft(prev => prev ? ({ ...prev, resultMsg: `등록 실패: ${e.message}` }) : prev);
    } finally {
      setTemplateSaving(false);
    }
  };

  const setBulkUnitEdit = (oid, patch) => {
    setBulkUnitEdits(prev => ({ ...prev, [oid]: { ...(prev[oid] || {}), ...patch } }));
  };

  const applyBulkUnit = async (oid) => {
    const order = orders.find(o => o.id === oid);
    const edit = bulkUnitEdits[oid] || {};
    const flower = edit.flower || '';
    const unit = normalizeOrderUnit(edit.unit || '박스');
    if (!order || !flower) { alert('일괄 변경할 품종을 선택하세요.'); return; }
    const targets = (order.items || []).filter(it => !it.skip && it.prodKey && (it.flowerName || '기타') === flower);
    if (!targets.length) { alert('해당 품종의 매칭 품목이 없습니다.'); return; }
    setOrders(prev => prev.map(o => o.id === oid
      ? { ...o, items: o.items.map(it => (!it.skip && it.prodKey && (it.flowerName || '기타') === flower) ? { ...it, unit } : it) }
      : o
    ));
    await Promise.all(targets.map(it => fetch('/api/orders/prod-units', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ prodKey: it.prodKey, unit }),
    }).catch(() => null)));
    setProdUnitMap(prev => {
      const next = { ...prev };
      targets.forEach(it => { next[it.prodKey] = unit; });
      return next;
    });
  };

  return (
    <Layout title="붙여넣기 주문등록">
      <div style={{ padding: '16px 20px', maxWidth: 1180, margin: '0 auto', paddingBottom: currentQ ? 280 : 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1a237e', margin: 0 }}>
            📋 붙여넣기 주문등록
          </h2>
          <button
            onClick={openWeekPivot}
            style={{ padding: '6px 16px', background: '#1565c0', color: '#fff', border: 'none', borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            📊 차수피벗 이동
          </button>
          <button
            onClick={openMappingStatus}
            style={{ padding: '6px 16px', background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            매칭 적용 확인
          </button>
          {orders.length > 0 && (
            <button
              onClick={() => {
                setPasteText('');
                setOrders([]);
                setParseError('');
                setQueueIdx(0);
                setDisambigSearch('');
                setDisambigResults([]);
                setRegisteredOrders({});
                setStockDraft(null);
              }}
              style={{ padding: '6px 16px', background: '#1a237e', color: '#fff', border: 'none', borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              ✏️ 다른 주문하기
            </button>
          )}
          {cachedEntries > 0 && (
            <span style={{ fontSize: 11, color: '#888', background: '#f0f0f0', padding: '2px 8px', borderRadius: 10 }}>
              💾 저장된 매칭 {cachedEntries}개
              <button
                onClick={() => { saveCache({}); setMappingCache({}); }}
                style={{ marginLeft: 6, fontSize: 10, color: '#c62828', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >초기화</button>
            </span>
          )}
        </div>

        {/* 차수 선택 */}
        <div style={{ marginBottom: 12 }}>
          <label style={labelS}>차수</label>
          {/* 2026 차수 (신형식) */}
          {(() => {
            const newWeeks = weeks.filter(w => w.match(/^\d{4}-/));
            const oldWeeks = weeks.filter(w => !w.match(/^\d{4}-/));
            return (
              <div>
                {/* 2026 섹션 */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: '#1a237e', fontWeight: 700, background: '#e8eaf6', padding: '2px 8px', borderRadius: 10 }}>2026</span>
                  {newWeeks.map(w => (
                    <button key={w} onClick={() => setWeek(w)}
                      style={{
                        padding: '5px 22px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
                        border: week === w ? '2px solid #1a237e' : '1px solid #c5cae9',
                        background: week === w ? '#1a237e' : '#f3f4ff',
                        color: week === w ? '#fff' : '#1a237e',
                        fontWeight: week === w ? 700 : 500,
                      }}>
                      {formatWeekDisplay(w)}
                    </button>
                  ))}
                </div>

                {/* 이전 차수 (25년도) */}
                {oldWeeks.length > 0 && (
                  <div>
                    <button onClick={() => setShowOldWeeks(v => !v)}
                      style={{ fontSize: 11, color: '#888', background: 'none', border: '1px solid #ddd', borderRadius: 10, padding: '2px 10px', cursor: 'pointer', marginBottom: 4 }}>
                      {showOldWeeks ? '▲' : '▼'} 이전 차수 (25년도) {oldWeeks.length}개
                    </button>
                    {showOldWeeks && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {oldWeeks.map(w => (
                          <button key={w} onClick={() => setWeek(w)}
                            style={{
                              padding: '4px 11px', borderRadius: 20, fontSize: 12, cursor: 'pointer',
                              border: week === w ? '2px solid #888' : '1px solid #ddd',
                              background: week === w ? '#666' : '#f9f9f9',
                              color: week === w ? '#fff' : '#888',
                            }}>
                            {formatWeekDisplay(w)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {week && (
                  <div style={{ fontSize: 12, color: '#1a237e', fontWeight: 600, marginTop: 4 }}>
                    선택: {formatWeekDisplay(week)}
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14, marginBottom: 14 }}>
          <div style={{ border: '1px solid #c5cae9', borderRadius: 8, padding: 12, background: '#f7f8ff', minWidth: 0 }}>
            <label style={labelS}>
              텍스트 붙여넣기
              <span style={{ fontWeight: 400, color: '#667085', fontSize: 11, marginLeft: 6 }}>
                주문/변경사항
              </span>
            </label>
            <textarea
              style={{ width: '100%', height: 430, padding: '10px 12px', border: '1px solid #9fa8da', borderRadius: 6, fontSize: 13, lineHeight: 1.45, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box', background: '#fff' }}
              placeholder={'[변경사항형]\n21-1 수국 변경사항\n수경원예\n블루 1박스 취소\n\n[기본형]\n청화꽃집\nCaroline | 2'}
              value={pasteText}
              onChange={e => { setPasteText(e.target.value); setOrders([]); setParseError(''); setQueueIdx(0); setStockDraft(null); }}
            />
          </div>

          <div style={{ border: '1px solid #b8c7d9', borderRadius: 8, padding: 12, background: '#f8fbff', minWidth: 0 }}>
            <label style={labelS}>
              기존재고
              <span style={{ fontWeight: 400, color: '#667085', fontSize: 11, marginLeft: 6 }}>
                시작 기준
              </span>
            </label>
            <textarea
              style={{ width: '100%', height: 430, padding: '10px 12px', border: '1px solid #b8c7d9', borderRadius: 6, fontSize: 13, lineHeight: 1.45, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box', background: '#fff' }}
              placeholder={'기존재고\n블루 2\n라벤더 14\n화이트 1'}
              value={baseStockText}
              onChange={e => { setBaseStockText(e.target.value); setStockDraft(null); }}
            />
          </div>

          <div style={{ border: '1px solid #b2dfdb', borderRadius: 8, padding: 12, background: '#f3fffd', minWidth: 0 }}>
            <label style={labelS}>
              잔량재고
              <span style={{ fontWeight: 400, color: '#667085', fontSize: 11, marginLeft: 6 }}>
                최종 잔량
              </span>
            </label>
            <textarea
              style={{ width: '100%', height: 430, padding: '10px 12px', border: '1px solid #80cbc4', borderRadius: 6, fontSize: 13, lineHeight: 1.45, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box', background: '#fff' }}
              placeholder={'잔량재고\n21-1\n블루 2\n라벤더 14\n화이트 1'}
              value={remainStockText}
              onChange={e => { setRemainStockText(e.target.value); setStockDraft(null); }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          <button
            onClick={handleParse}
            disabled={parsing || !pasteText.trim()}
            style={{ padding: '9px 24px', background: '#1a237e', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: parsing ? 0.7 : 1 }}
          >
            {parsing ? '🤖 분석 중...' : '🤖 Claude로 분석'}
          </button>
          <button
            onClick={() => refreshStockDraft()}
            disabled={!pasteText.trim() && !baseStockText.trim() && !remainStockText.trim()}
            style={{ padding: '9px 18px', background: '#455a64', color: '#fff', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: (!pasteText.trim() && !baseStockText.trim() && !remainStockText.trim()) ? 0.5 : 1 }}
          >
            잔량/히스토리 계산
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'default', padding: '4px 10px', border: '1px solid #2e7d32', borderRadius: 6, background: '#e8f5e9', color: '#1b5e20', fontWeight: 700 }}>
            <input type="checkbox" checked readOnly disabled />
            ➕ 기존 수량에 항상 더하기
          </label>
          {parseError && <span style={{ color: '#c62828', fontSize: 13 }}>❌ {parseError}</span>}
          {orders.length > 0 && (
            <span style={{ fontSize: 13, color: '#555' }}>
              {detectedWeek && (
                <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: '#1565c0', padding: '3px 10px', borderRadius: 10, marginRight: 8 }}>
                  📅 적용 차수 {detectedWeek}
                </span>
              )}
              <b style={{ color: '#1a237e' }}>{orders.length}개 거래처</b>
              {totalAdd > 0 && <> / <b style={{ color: '#2e7d32' }}>추가 {totalAdd}건</b></>}
              {totalCancel > 0 && <> / <b style={{ color: '#c62828' }}>취소 {totalCancel}건</b></>}
              {unmatchedQueue.length > 0 && <> / <b style={{ color: '#e65100' }}>미매칭 {unmatchedQueue.length}개</b></>}
            </span>
          )}
        </div>

        <div style={{ border: '1px solid #d7ccc8', borderRadius: 8, background: '#fffdf8', padding: '10px 12px', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <strong style={{ color: '#4e342e', fontSize: 13 }}>주문 즐겨찾기</strong>
            <button
              onClick={loadSourceOrdersForTemplate}
              disabled={sourceOrderLoading || !week}
              style={{ padding: '5px 12px', border: '1px solid #8d6e63', borderRadius: 5, background: sourceOrderLoading ? '#d7ccc8' : '#6d4c41', color: '#fff', fontSize: 12, fontWeight: 700, cursor: sourceOrderLoading ? 'wait' : 'pointer' }}
            >
              {sourceOrderLoading ? '불러오는 중...' : '선택차수 주문 불러오기'}
            </button>
            {sourceOrdersForTemplate.length > 0 && (
              <select
                value=""
                onChange={e => {
                  const selected = sourceOrdersForTemplate.find(o => String(o.id) === e.target.value);
                  setTemplateDraftFromOrder(selected);
                }}
                style={{ minWidth: 220, padding: '5px 8px', border: '1px solid #bcaaa4', borderRadius: 5, fontSize: 12, background: '#fff' }}
              >
                <option value="">기존 주문 선택</option>
                {sourceOrdersForTemplate.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.custName} / {formatWeekDisplay(o.week)} / {o.items?.length || 0}품목
                  </option>
                ))}
              </select>
            )}
            <select
              value={templateDraft?.favoriteKey || ''}
              onChange={e => loadTemplateDraft(e.target.value)}
              style={{ minWidth: 220, padding: '5px 8px', border: '1px solid #bcaaa4', borderRadius: 5, fontSize: 12, background: '#fff' }}
            >
              <option value="">저장 즐겨찾기 선택</option>
              {orderTemplates.map(f => (
                <option key={f.FavoriteKey} value={f.FavoriteKey}>
                  {f.FavName} / {f.data?.custName || ''} / {f.data?.items?.length || 0}품목
                </option>
              ))}
            </select>
            <button
              onClick={loadOrderTemplates}
              style={{ padding: '5px 10px', border: '1px solid #bcaaa4', borderRadius: 5, background: '#fff', color: '#5d4037', fontSize: 12, cursor: 'pointer' }}
            >
              새로고침
            </button>
          </div>

          {templateDraft && (
            <div style={{ borderTop: '1px solid #efebe9', paddingTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <input
                  value={templateDraft.name || ''}
                  onChange={e => setTemplateDraft(prev => prev ? ({ ...prev, name: e.target.value }) : prev)}
                  placeholder="즐겨찾기 이름"
                  style={{ minWidth: 220, padding: '5px 8px', border: '1px solid #bcaaa4', borderRadius: 5, fontSize: 12 }}
                />
                <span style={{ fontSize: 12, color: '#5d4037', fontWeight: 700 }}>{templateDraft.custName}</span>
                {templateDraft.sourceWeek && (
                  <span style={{ fontSize: 11, color: '#795548', background: '#efebe9', borderRadius: 10, padding: '2px 8px' }}>
                    원본 {formatWeekDisplay(templateDraft.sourceWeek)}
                  </span>
                )}
                <span style={{ fontSize: 11, color: '#1a237e', background: '#e8eaf6', borderRadius: 10, padding: '2px 8px' }}>
                  등록대상 {formatWeekDisplay(week)}
                </span>
                {templateDraft.resultMsg && (
                  <span style={{ fontSize: 12, color: templateDraft.resultMsg.includes('실패') ? '#c62828' : '#2e7d32', fontWeight: 700 }}>
                    {templateDraft.resultMsg}
                  </span>
                )}
              </div>
              <div style={{ overflowX: 'auto', maxHeight: 260, border: '1px solid #efebe9' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#efebe9' }}>
                      <th style={{ padding: '5px 8px', textAlign: 'left' }}>품목</th>
                      <th style={{ padding: '5px 8px' }}>국가</th>
                      <th style={{ padding: '5px 8px' }}>꽃</th>
                      <th style={{ padding: '5px 8px' }}>수량</th>
                      <th style={{ padding: '5px 8px' }}>단위</th>
                      <th style={{ padding: '5px 8px', textAlign: 'left' }}>비고</th>
                      <th style={{ padding: '5px 8px' }}>삭제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(templateDraft.items || []).map((it, i) => (
                      <tr key={`${it.prodKey}-${i}`} style={{ borderBottom: '1px solid #f5eee9' }}>
                        <td style={{ padding: '4px 8px', fontWeight: 600 }}>{it.displayName || it.prodName}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'center', color: '#388e3c' }}>{it.counName || ''}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'center', color: '#7b1fa2' }}>{it.flowerName || ''}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                          <input
                            type="number"
                            step="0.5"
                            value={it.qty}
                            onChange={e => updateTemplateItem(i, { qty: parseFloat(e.target.value) || 0 })}
                            style={{ width: 72, padding: '2px 4px', border: '1px solid #bcaaa4', borderRadius: 4, textAlign: 'right' }}
                          />
                        </td>
                        <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                          <select
                            value={normalizeOrderUnit(it.unit)}
                            onChange={e => updateTemplateItem(i, { unit: e.target.value })}
                            style={{ padding: '2px 4px', border: '1px solid #bcaaa4', borderRadius: 4 }}
                          >
                            <option>박스</option><option>단</option><option>송이</option>
                          </select>
                        </td>
                        <td style={{ padding: '4px 8px', color: '#6d4c41' }}>{it.descr || ''}</td>
                        <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                          <button
                            onClick={() => setTemplateDraft(prev => prev ? ({ ...prev, items: prev.items.filter((_, idx) => idx !== i) }) : prev)}
                            style={{ padding: '1px 7px', border: '1px solid #d7ccc8', borderRadius: 4, background: '#fff', color: '#8d6e63', cursor: 'pointer' }}
                          >
                            삭제
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={saveTemplateDraft}
                  disabled={templateSaving || !(templateDraft.items || []).length}
                  style={{ padding: '7px 16px', background: templateSaving ? '#bbb' : '#795548', color: '#fff', border: 'none', borderRadius: 5, fontWeight: 700, cursor: templateSaving ? 'wait' : 'pointer' }}
                >
                  수정 저장
                </button>
                <button
                  onClick={registerTemplateDraft}
                  disabled={templateSaving || !week || !(templateDraft.items || []).length}
                  style={{ padding: '7px 16px', background: templateSaving ? '#bbb' : '#2e7d32', color: '#fff', border: 'none', borderRadius: 5, fontWeight: 700, cursor: templateSaving ? 'wait' : 'pointer' }}
                >
                  선택차수 주문등록하기
                </button>
              </div>
            </div>
          )}
        </div>

        {stockDraft && (
          <StockDraftPanel
            draft={stockDraft}
            copied={stockCopied}
            onCopy={copyStockDraft}
          />
        )}

        {mappingChangeLog.length > 0 && (
          <div style={{ border: '1px solid #90caf9', borderRadius: 8, background: '#e3f2fd', padding: '9px 12px', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <strong style={{ color: '#0d47a1', fontSize: 13 }}>매칭 변경사항</strong>
              <span style={{ color: '#1565c0', fontSize: 12 }}>다음 분석부터 저장매칭으로 적용됩니다.</span>
            </div>
            <div style={{ display: 'grid', gap: 4 }}>
              {mappingChangeLog.map(n => (
                <div key={n.id} style={{ fontSize: 12, color: '#263238', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700 }}>"{n.inputName}"</span>
                  {n.previousName && <span style={{ color: '#78909c' }}>{n.previousName} →</span>}
                  <span style={{ color: '#1b5e20', fontWeight: 700 }}>{n.nextName}</span>
                  {n.nextMeta && <span style={{ color: '#607d8b' }}>({n.nextMeta})</span>}
                  <span style={{ color: '#1565c0' }}>저장키: {n.savedKey}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 거래처별 주문 카드 */}
        {orders.map(order => {
          const activeItems = order.items.filter(it => !it.skip);
          const addItems    = activeItems.filter(it => it.action !== '취소');
          const cancelItems = activeItems.filter(it => it.action === '취소');
          const matchedItems = activeItems.filter(it => it.prodKey);
          const matchedAdd  = addItems.filter(it => it.prodKey);
          const unmatched   = activeItems.filter(it => !it.prodKey);
          const bulkFlowers = [...new Set(matchedItems.map(it => it.flowerName || '기타'))].sort();
          const bulkEdit = bulkUnitEdits[order.id] || {};

          return (
            <div key={order.id} style={{ border: '1px solid #c5cae9', borderRadius: 8, marginBottom: 16, overflow: 'hidden' }}>
              {/* 거래처 헤더 */}
              <div style={{
                background: order.custMatch ? '#1a237e' : '#e65100',
                color: '#fff', padding: '10px 16px',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                {order.custMatch ? (
                  <>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>✅ {order.custMatch.CustName}</span>
                    <span style={{ fontSize: 12, opacity: 0.8 }}>{order.custMatch.CustArea}</span>
                    {order.custName && order.custName !== order.custMatch.CustName && (
                      <span style={{ fontSize: 11, background: 'rgba(255,255,255,0.18)', border: '1px solid rgba(255,255,255,0.35)', borderRadius: 10, padding: '2px 8px' }}>
                        입력 {order.custName} → {order.custFromMapping ? '저장매칭' : '자동/수동'} 적용
                      </span>
                    )}
                    <button onClick={() => updateOrder(order.id, { custMatch: null })}
                      style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 8px', background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)', color: '#fff', borderRadius: 4, cursor: 'pointer' }}>
                      변경
                    </button>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>⚠️ 거래처 미확인</span>
                    <div style={{ flex: 1 }}>
                      <CustSelector customers={allCustomers}
                        onSelect={c => setCustMatch(order.id, c)} />
                    </div>
                  </>
                )}
              </div>

              {bulkFlowers.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 12px', background: '#fffde7', borderBottom: '1px solid #eee8c8', fontSize: 12 }}>
                  <strong style={{ color: '#5d4037' }}>품종 단위 일괄수정</strong>
                  <select
                    value={bulkEdit.flower || ''}
                    onChange={e => setBulkUnitEdit(order.id, { flower: e.target.value })}
                    style={{ padding: '3px 8px', border: '1px solid #d6c58a', borderRadius: 4, background: '#fff' }}
                  >
                    <option value="">품종 선택</option>
                    {bulkFlowers.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                  <select
                    value={bulkEdit.unit || '박스'}
                    onChange={e => setBulkUnitEdit(order.id, { unit: e.target.value })}
                    style={{ padding: '3px 8px', border: '1px solid #d6c58a', borderRadius: 4, background: '#fff' }}
                  >
                    <option>박스</option><option>단</option><option>송이</option>
                  </select>
                  <button
                    onClick={() => applyBulkUnit(order.id)}
                    disabled={!bulkEdit.flower}
                    style={{ padding: '4px 12px', border: 'none', borderRadius: 4, background: bulkEdit.flower ? '#795548' : '#bbb', color: '#fff', fontWeight: 700, cursor: bulkEdit.flower ? 'pointer' : 'not-allowed' }}
                  >
                    수정
                  </button>
                  <span style={{ color: '#8d6e63' }}>선택한 품종의 매칭 단위가 한 번에 바뀝니다.</span>
                </div>
              )}

              {/* 품목 테이블 */}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: '#e8eaf6' }}>
                      <th style={thS(30)}>#</th>
                      <th style={thS(46)}>동작</th>
                      <th style={thS(160, 'left')}>입력 품목명</th>
                      <th style={thS(60)}>수량</th>
                      <th style={thS(70)}>단위</th>
                      <th style={{ padding: '7px 8px', textAlign: 'left', fontWeight: 600, color: '#333' }}>매칭 결과</th>
                      <th style={thS(60)}>건너뛰기</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((it, idx) => {
                      const isCancel = it.action === '취소';
                      const isCurrentQ = currentQ?.orderId === order.id && currentQ?.itemIdx === idx;
                      return (
                        <tr key={idx} style={{
                          background: it.skip ? '#fafafa' :
                            isCurrentQ ? '#fff9c4' :
                            isCancel ? '#fff3e0' :
                            it.prodKey ? '#e8f5e9' : '#fff8e1',
                          opacity: it.skip ? 0.4 : 1,
                          borderBottom: '1px solid #eee',
                          outline: isCurrentQ ? '2px solid #f9a825' : 'none',
                        }}>
                          <td style={{ padding: '5px 8px', textAlign: 'center', color: '#aaa', fontSize: 11 }}>{idx + 1}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                            <span style={{
                              fontSize: 11, padding: '2px 7px', borderRadius: 10, fontWeight: 700,
                              background: isCancel ? '#ffcdd2' : '#c8e6c9',
                              color: isCancel ? '#c62828' : '#2e7d32',
                            }}>
                              {isCancel ? '취소' : '추가'}
                            </span>
                          </td>
                          <td style={{
                            padding: '5px 8px', fontFamily: 'monospace', fontSize: 12,
                            textDecoration: isCancel ? 'line-through' : 'none',
                            color: isCancel ? '#999' : isCurrentQ ? '#333' : '#333',
                            fontWeight: isCurrentQ ? 700 : 400,
                          }}>
                            {isCurrentQ && <span style={{ color: '#f9a825', marginRight: 4 }}>❓</span>}
                            {it.inputName}
                          </td>
                          <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                            <input type="number" min="0" step="0.5" value={it.qty}
                              onChange={e => updateItem(order.id, idx, { qty: parseFloat(e.target.value) || 0 })}
                              style={{ width: 56, padding: '2px 4px', border: '1px solid #ddd', borderRadius: 4, textAlign: 'right', fontSize: 13 }} />
                          </td>
                          <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                            <select value={normalizeOrderUnit(it.unit)} onChange={e => {
                              const newUnit = e.target.value;
                              updateItem(order.id, idx, { unit: newUnit });
                              if (it.prodKey) {
                                fetch('/api/orders/prod-units', {
                                  method: 'PUT',
                                  headers: { 'Content-Type': 'application/json' },
                                  credentials: 'same-origin',
                                  body: JSON.stringify({ prodKey: it.prodKey, unit: newUnit }),
                                });
                              }
                            }}
                              style={{ fontSize: 12, padding: '2px 4px', border: '1px solid #ddd', borderRadius: 4 }}>
                              <option>박스</option><option>단</option><option>송이</option>
                            </select>
                          </td>
                          <td style={{ padding: '4px 8px' }}>
                            {it.prodKey ? (() => {
                              const pd = allProducts.find(p => Number(p.ProdKey) === Number(it.prodKey));
                              const moqText = extractMoqText(pd);
                              // 매칭 신뢰도 시각화
                              const conf = it.confidenceLabel || (it.fromMapping ? 'medium' : 'medium');
                              const isLow = conf === 'low' || it.fallbackSuspect;
                              const icon = isLow ? '⚠️' : conf === 'high' ? '✅' : '✓';
                              const color = isLow ? '#c62828' : conf === 'high' ? '#1b5e20' : '#0d47a1';
                              const bgConf = isLow ? '#ffebee' : conf === 'high' ? '#e8f5e9' : '#e3f2fd';
                              return (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                  <span style={{ color, fontWeight: 600, fontSize: 12 }}>
                                    {icon} {it.displayName || it.prodName}
                                  </span>
                                  {it.mappingChanged && (
                                    <span title="방금 이 입력명의 저장매칭을 변경했습니다. 다음 Claude 분석부터 새 매칭이 자동 적용됩니다."
                                      style={{ fontSize: 10, background: '#e3f2fd', color: '#0d47a1', borderRadius: 8, padding: '1px 6px', fontWeight: 700 }}>
                                      방금 변경저장
                                    </span>
                                  )}
                                  {it.fromMapping && (
                                    <span title="저장된 매칭이 이번 분석에 자동 적용되었습니다."
                                      style={{ fontSize: 10, background: '#e8f5e9', color: '#1b5e20', borderRadius: 8, padding: '1px 6px', fontWeight: 700 }}>
                                      저장매칭 적용
                                    </span>
                                  )}
                                  {!it.fromMapping && it.mappingMatchType === 'direct-select' && !it.mappingChanged && (
                                    <span title="사용자가 직접 선택했고, 같은 입력명은 저장매칭으로 학습됩니다."
                                      style={{ fontSize: 10, background: '#fff8e1', color: '#e65100', borderRadius: 8, padding: '1px 6px', fontWeight: 700 }}>
                                      수동선택 저장
                                    </span>
                                  )}
                                  {it.fallbackSuspect && (
                                    <span title={`이 품목이 ${it.fallbackCount}개 입력에 매핑되어 있어 자동 추측일 가능성이 높음. 직접 확인 후 변경하세요.`}
                                      style={{ fontSize: 10, background: '#ffebee', color: '#c62828', borderRadius: 8, padding: '1px 6px', fontWeight: 700 }}>
                                      ⚠ fallback의심 ({it.fallbackCount})
                                    </span>
                                  )}
                                  {!it.fallbackSuspect && conf === 'low' && (
                                    <span style={{ fontSize: 10, background: bgConf, color, borderRadius: 8, padding: '1px 6px' }}>저신뢰</span>
                                  )}
                                  {pd?.CounName && <span style={{ fontSize: 10, background: '#e8f5e9', color: '#388e3c', borderRadius: 8, padding: '1px 6px' }}>{pd.CounName}</span>}
                                  {pd?.FlowerName && <span style={{ fontSize: 10, background: '#f3e5f5', color: '#7b1fa2', borderRadius: 8, padding: '1px 6px' }}>{pd.FlowerName}</span>}
                                  {moqText && <span style={{ fontSize: 10, background: '#fff3e0', color: '#ef6c00', borderRadius: 8, padding: '1px 6px', fontWeight: 700 }}>{moqText}</span>}
                                  <span style={{ color: '#aaa', fontSize: 10 }}>{it.prodName}</span>
                                  <button onClick={() => clearProductMatchForChange(order.id, idx)}
                                    style={{ fontSize: 10, padding: '1px 5px', background: 'none', border: '1px solid #ddd', borderRadius: 3, cursor: 'pointer', color: '#aaa', marginLeft: 'auto' }}>
                                    변경
                                  </button>
                                </div>
                              );
                            })() : it.skip ? null : (
                              <span style={{ fontSize: 11, color: isCurrentQ ? '#f57f17' : '#bbb' }}>
                                {isCurrentQ ? '↓ 아래에서 선택' : '대기 중…'}
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                            <input type="checkbox" checked={it.skip}
                              onChange={e => updateItem(order.id, idx, { skip: e.target.checked })} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* 카드 하단 액션 */}
              <div style={{ padding: '10px 16px', background: '#f5f5f5', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                {order.resultMsg && (
                  <span style={{ fontSize: 13, fontWeight: 600, color: order.resultMsg.startsWith('✅') ? '#1b5e20' : '#c62828' }}>
                    {order.resultMsg}
                  </span>
                )}
                {cancelItems.length > 0 && (
                  <span style={{ fontSize: 12, color: '#e65100' }}>취소 {cancelItems.length}건 (주문수량 음수 반영)</span>
                )}
                {unmatched.length > 0 && (
                  <span style={{ fontSize: 12, color: '#e65100' }}>❓ 미매칭 {unmatched.length}개</span>
                )}
                {matchedItems.length > 0 && (
                  <button
                    onClick={() => handleRegister(order.id)}
                    disabled={order.saving || !order.custMatch || !week}
                    title="OrderDetail 만 INSERT/UPDATE — 분배 (ShipmentDetail) 는 별도 작업"
                    style={{
                      marginLeft: 'auto',
                      padding: '8px 18px',
                      background: (order.custMatch && week) ? '#2e7d32' : '#bbb',
                      color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700,
                      cursor: (order.custMatch && week) ? 'pointer' : 'not-allowed',
                    }}
                  >
                    {order.saving ? '등록 중...' : `💾 등록만 (${matchedItems.length}건)`}
                  </button>
                )}
                <button
                  onClick={() => handleBulkDistribute(order.id)}
                  disabled={bulkRunning || matchedItems.length === 0 || !order.custMatch || !week}
                  title="추가 = 주문등록+분배 동시 +, 취소 = 주문등록+분배 동시 −"
                  style={{
                    marginLeft: matchedItems.length === 0 ? 'auto' : '0',
                    padding: '8px 18px',
                    background: matchedItems.length > 0 && order.custMatch && week ? '#1565c0' : '#bbb',
                    color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 700,
                    cursor: bulkRunning ? 'wait' : 'pointer',
                  }}
                >
                  {bulkRunning ? '⏳ 처리중...' : `🚀 일괄 등록+분배 (${matchedItems.length}건)`}
                </button>
              </div>

              {/* 등록 후 DB 주문내역 */}
              {registeredOrders[order.id] && (() => {
                const ro = registeredOrders[order.id];
                const hasSnapshot = Object.prototype.hasOwnProperty.call(ro, 'prevSnapshot');
                const prevSnap = hasSnapshot ? (ro.prevSnapshot || {}) : {};
                const items = ro.items || [];
                let newCount = 0, changedCount = 0, sameCount = 0;
                items.forEach(it => {
                  if (!hasSnapshot) {
                    sameCount++;
                    return;
                  }
                  const p = prevSnap[it.prodKey];
                  if (p == null) newCount++;
                  else if (Number(p) !== Number(it.qty)) changedCount++;
                  else sameCount++;
                });
                return (
                  <div style={{ borderTop: '2px solid #2e7d32', background: '#f1f8e9' }}>
                    <div style={{ padding: '8px 16px', fontWeight: 700, fontSize: 13, color: '#2e7d32', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      📋 DB 저장 내역 — {ro.custName} / {formatWeekDisplay(ro.week)}
                      {ro._fallback && (
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#fff8e1', color: '#8a5a00', border: '1px solid #ffca28' }}>
                          처리 직후 내역
                        </span>
                      )}
                      {newCount > 0 && (
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#e3f2fd', color: '#0d47a1', border: '1px solid #64b5f6' }}>
                          🆕 신규 {newCount}건
                        </span>
                      )}
                      {changedCount > 0 && (
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#ffe0b2', color: '#e65100', border: '1px solid #fb8c00' }}>
                          ✏️ 변경 {changedCount}건
                        </span>
                      )}
                      {sameCount > 0 && (
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#e0e0e0', color: '#666' }}>
                          유지 {sameCount}건
                        </span>
                      )}
                      <button
                        onClick={() => saveTemplateFromRegistered(order, ro)}
                        title="현재 DB 저장 내역을 주문 즐겨찾기로 저장합니다."
                        style={{
                          fontSize: 12, fontWeight: 700,
                          padding: '4px 12px', borderRadius: 6,
                          background: '#795548',
                          color: '#fff', border: 'none',
                          cursor: 'pointer',
                        }}>
                        즐겨찾기 저장
                      </button>
                      <button
                        onClick={() => handleDistributeOnly(order.id)}
                        disabled={bulkRunning}
                        title="등록한 주문수량 그대로 출고분배만 다시 저장합니다. 주문등록은 재가산하지 않습니다."
                        style={{
                          marginLeft: 'auto',
                          fontSize: 12, fontWeight: 700,
                          padding: '4px 14px', borderRadius: 6,
                          background: bulkRunning ? '#bbb' : '#1565c0',
                          color: '#fff', border: 'none',
                          cursor: bulkRunning ? 'wait' : 'pointer',
                        }}>
                        {bulkRunning ? '⏳ 분배 중...' : `🚀 일괄 분배 (${items.length}건)`}
                      </button>
                      <button onClick={() => setRegisteredOrders(p => { const n={...p}; delete n[order.id]; return n; })}
                        style={{ fontSize: 11, padding: '1px 8px', background: 'none', border: '1px solid #a5d6a7', borderRadius: 4, color: '#388e3c', cursor: 'pointer' }}>
                        닫기
                      </button>
                    </div>

                    {/* 일괄 분배 결과 표시 */}
                    {bulkResult?.orderId === order.id && (
                      <div style={{ padding: '6px 16px', borderTop: '1px solid #c8e6c9', background: bulkResult.failCount === 0 ? '#e8f5e9' : '#fff3e0', fontSize: 12 }}>
                        <strong>일괄 분배 결과:</strong>
                        {' '}✅ 성공 {bulkResult.okCount}건
                        {bulkResult.failCount > 0 && <> / ❌ 실패 {bulkResult.failCount}건</>}
                        {bulkResult.okCount > 0 && (
                          <button onClick={openWeekPivot} style={{ marginLeft: 8, fontSize: 11, padding: '0 8px', background: '#1565c0', color: '#fff', border: '1px solid #1565c0', borderRadius: 4, cursor: 'pointer' }}>
                            차수피벗/엑셀
                          </button>
                        )}
                        <button onClick={() => setBulkResult(null)} style={{ marginLeft: 8, fontSize: 11, padding: '0 6px', background: 'none', border: '1px solid #999', borderRadius: 4, cursor: 'pointer' }}>닫기</button>
                        {bulkResult.okCount > 0 && (
                          <div style={{ marginTop: 6, fontSize: 11, color: '#1b5e20', display: 'grid', gap: 2 }}>
                            {bulkResult.details.filter(x => x.ok).map((x, i) => (
                              <div key={i}>• {x.type === 'DISTRIBUTE' ? '분배' : x.type === 'CANCEL' ? '취소' : '추가'} {x.displayName || x.prodName}: {x.type === 'CANCEL' ? '−' : x.type === 'ADD' ? '+' : ''}{x.qty}{x.unit}</div>
                            ))}
                          </div>
                        )}
                        {bulkResult.failCount > 0 && (
                          <div style={{ marginTop: 4, fontSize: 11, color: '#e65100' }}>
                            {bulkResult.details.filter(x => !x.ok).map((x, i) => (
                              <div key={i}>• {x.type === 'DISTRIBUTE' ? '분배' : x.type === 'CANCEL' ? '취소' : '추가'} {x.displayName || x.prodName} {x.qty}{x.unit}: {x.error}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: '#c8e6c9' }}>
                            <th style={{ padding: '5px 8px', textAlign: 'left', fontWeight: 600 }}>품목명</th>
                            <th style={{ padding: '5px 8px', fontWeight: 600 }}>국가</th>
                            <th style={{ padding: '5px 8px', fontWeight: 600 }}>꽃</th>
                            <th style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600 }}>주문수량</th>
                            <th style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: '#1565c0' }}>분배수량</th>
                            <th style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600, color: '#7b1fa2' }}>잔량</th>
                            <th style={{ padding: '5px 8px', fontWeight: 600 }}>단위</th>
                            <th style={{ padding: '5px 8px', fontWeight: 600 }}>분배조정</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((it, i) => {
                            const prev = hasSnapshot ? prevSnap[it.prodKey] : null;
                            const isNew = hasSnapshot && prev == null;
                            const isChanged = hasSnapshot && !isNew && Number(prev) !== Number(it.qty);
                            const delta = isChanged ? Number(it.qty) - Number(prev) : 0;
                            const rowBg = isNew
                              ? '#e3f2fd'
                              : isChanged
                                ? '#ffe0b2'
                                : (i%2===0?'#f9fbe7':'#f1f8e9');
                            const leftBorder = isNew
                              ? '3px solid #1976d2'
                              : isChanged
                                ? '3px solid #fb8c00'
                                : '3px solid transparent';
                            const shipKey = `${ro.custKey}-${it.prodKey}-${ro.week}`;
                            const shipQty = shipmentQtys[shipKey] || 0;
                            const remain = (it.qty || 0) - shipQty;
                            return (
                              <tr key={i} style={{ borderBottom: '1px solid #dcedc8', background: rowBg, borderLeft: leftBorder }}>
                                <td style={{ padding: '4px 8px' }}>
                                  {isNew && <span style={{ marginRight: 4, fontSize: 10, padding: '1px 5px', borderRadius: 8, background: '#1976d2', color: '#fff', fontWeight: 700 }}>신규</span>}
                                  {isChanged && <span style={{ marginRight: 4, fontSize: 10, padding: '1px 5px', borderRadius: 8, background: '#fb8c00', color: '#fff', fontWeight: 700 }}>변경</span>}
                                  {it.displayName || it.prodName}
                                </td>
                                <td style={{ padding: '4px 8px', textAlign: 'center', color: '#388e3c', fontSize: 11 }}>{it.counName || '—'}</td>
                                <td style={{ padding: '4px 8px', textAlign: 'center', color: '#7b1fa2', fontSize: 11 }}>{it.flowerName || '—'}</td>
                                <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                                  {isNew ? (
                                    <span style={{ color: '#0d47a1' }}>+{it.qty}</span>
                                  ) : isChanged ? (
                                    <span>
                                      <span style={{ color: '#999', textDecoration: 'line-through', marginRight: 4 }}>{prev}</span>
                                      <span style={{ color: '#e65100' }}>→</span>
                                      <span style={{ color: '#e65100', marginLeft: 4, fontWeight: 700 }}>{it.qty}</span>
                                      <span style={{ marginLeft: 6, fontSize: 10, color: delta > 0 ? '#2e7d32' : '#c62828' }}>
                                        ({delta > 0 ? '+' : ''}{delta})
                                      </span>
                                    </span>
                                  ) : (
                                    it.qty
                                  )}
                                </td>
                                <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700, color: '#1565c0', fontVariantNumeric: 'tabular-nums' }}>
                                  {shipQty}
                                </td>
                                <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: remain === 0 ? '#388e3c' : (remain > 0 ? '#f57f17' : '#c62828') }}>
                                  {remain}
                                </td>
                                <td style={{ padding: '4px 8px', textAlign: 'center', color: '#666' }}>{normalizeOrderUnit(it.unit)}</td>
                                <td style={{ padding: '4px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                                  <button onClick={() => { setAdjustModal({ custKey: ro.custKey, prodKey: it.prodKey, week: ro.week, type: 'ADD', currentQty: shipQty, prodName: it.displayName || it.prodName, custName: ro.custName, unit: normalizeOrderUnit(it.unit) }); setAdjustQty(''); }}
                                    style={{ padding: '2px 8px', fontSize: 11, fontWeight: 700, background: '#2e7d32', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', marginRight: 4 }}>
                                    + 추가
                                  </button>
                                  <button onClick={() => { setAdjustModal({ custKey: ro.custKey, prodKey: it.prodKey, week: ro.week, type: 'CANCEL', currentQty: shipQty, prodName: it.displayName || it.prodName, custName: ro.custName, unit: normalizeOrderUnit(it.unit) }); setAdjustQty(''); }}
                                    style={{ padding: '2px 8px', fontSize: 11, fontWeight: 700, background: '#c62828', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                                    − 취소
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      {/* ── 분배조정(ADD/CANCEL) 모달 ── */}
      {adjustModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => e.target === e.currentTarget && !adjustSaving && setAdjustModal(null)}>
          <div style={{ background: '#fff', borderRadius: 10, padding: 24, minWidth: 340, boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: adjustModal.type === 'ADD' ? '#2e7d32' : '#c62828' }}>
              {adjustModal.type === 'ADD' ? '➕ 분배 추가' : '➖ 분배 취소'}
            </div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
              {adjustModal.custName} / {adjustModal.prodName}
              <br />
              <span style={{ fontSize: 11, color: '#999' }}>
                {adjustModal.type === 'ADD' ? '주문등록(OrderDetail)+분배(ShipmentDetail) 동시 +' : '주문등록(OrderDetail)+분배(ShipmentDetail) 동시 −'}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, padding: 12, background: '#f5f5f5', borderRadius: 6 }}>
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#888' }}>현재 분배</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#37474f' }}>{adjustModal.currentQty}</div>
              </div>
              <div style={{ fontSize: 18, color: '#aaa' }}>{adjustModal.type === 'ADD' ? '+' : '−'}</div>
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#888' }}>변경량</div>
                <input type="number" autoFocus value={adjustQty} onChange={e => setAdjustQty(e.target.value)} placeholder="0"
                  onKeyDown={e => e.key === 'Enter' && handleAdjust()}
                  style={{ width: '100%', textAlign: 'center', fontSize: 22, fontWeight: 700, color: '#1976d2', padding: '4px 8px', border: '2px solid #1976d2', borderRadius: 4 }} />
              </div>
              <div style={{ fontSize: 18, color: '#aaa' }}>=</div>
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#888' }}>결과</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: adjustModal.type === 'ADD' ? '#2e7d32' : '#c62828' }}>
                  {adjustModal.currentQty + (adjustModal.type === 'ADD' ? 1 : -1) * (parseFloat(adjustQty) || 0)}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => !adjustSaving && setAdjustModal(null)} disabled={adjustSaving}
                style={{ padding: '8px 18px', border: '1px solid #ccc', background: '#f5f5f5', borderRadius: 5, cursor: 'pointer', color: '#666' }}>
                취소
              </button>
              <button onClick={handleAdjust} disabled={adjustSaving || !(parseFloat(adjustQty) > 0)}
                style={{ padding: '8px 22px', background: adjustSaving ? '#aaa' : (adjustModal.type === 'ADD' ? '#2e7d32' : '#c62828'),
                  color: '#fff', border: 'none', borderRadius: 5, fontWeight: 700, cursor: adjustSaving ? 'wait' : 'pointer' }}>
                {adjustSaving ? '저장중...' : (adjustModal.type === 'ADD' ? '추가 확정' : '취소 확정')}
              </button>
            </div>
          </div>
        </div>
      )}

      {mappingNotice && (
        <div style={{
          position: 'fixed',
          right: 18,
          bottom: currentQ ? 246 : 18,
          width: 360,
          maxWidth: 'calc(100vw - 36px)',
          background: '#e8f5e9',
          border: '2px solid #43a047',
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
          padding: '10px 12px',
          zIndex: 650,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <strong style={{ color: '#1b5e20', fontSize: 13 }}>매칭 변경사항 저장</strong>
            <button
              onClick={() => setMappingNotice(null)}
              style={{
                marginLeft: 'auto',
                border: 'none',
                background: 'transparent',
                color: '#2e7d32',
                fontSize: 18,
                lineHeight: 1,
                cursor: 'pointer',
                padding: '0 2px',
              }}
              aria-label="매칭 변경 알림 닫기"
            >
              ×
            </button>
          </div>
          <div style={{ fontSize: 12, color: '#263238', lineHeight: 1.45 }}>
            <div><b>"{mappingNotice.inputName}"</b></div>
            {mappingNotice.previousName && (
              <div style={{ color: '#78909c' }}>
                이전: {mappingNotice.previousName}{mappingNotice.previousMeta ? ` (${mappingNotice.previousMeta})` : ''}
              </div>
            )}
            <div style={{ color: '#1b5e20', fontWeight: 700 }}>
              적용: {mappingNotice.nextName}{mappingNotice.nextMeta ? ` (${mappingNotice.nextMeta})` : ''}
            </div>
            {mappingNotice.savedKey && (
              <div style={{ color: '#1565c0', marginTop: 3 }}>
                다음 분석부터 저장매칭으로 적용됩니다. 저장키: {mappingNotice.savedKey}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 미매칭 질문 패널 (sticky bottom) ── */}
      {currentQ && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: '#fff', borderTop: '3px solid #f9a825',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.18)',
          padding: '14px 24px 16px',
          zIndex: 500,
        }}>
          <div style={{ maxWidth: 760, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#333' }}>
                ❓ &nbsp;
                <span style={{ color: '#1a237e' }}>'{currentQ.inputName}'</span>
                &nbsp;은(는) 어떤 품목인가요?
              </span>
              <span style={{
                fontSize: 11, padding: '2px 7px', borderRadius: 10, fontWeight: 700,
                background: currentQ.action === '취소' ? '#ffcdd2' : '#c8e6c9',
                color: currentQ.action === '취소' ? '#c62828' : '#2e7d32',
              }}>
                {currentQ.action}
              </span>
              {currentQ.ambiguityReason && (
                <span style={{ fontSize: 11, color: '#e65100', fontWeight: 700 }}>
                  {currentQ.ambiguityReason}
                </span>
              )}
              <span style={{ fontSize: 12, color: '#aaa', marginLeft: 'auto' }}>
                미매칭 {unmatchedQueue.length}개 남음
              </span>
            </div>

            {/* 후보 카드 목록 (항상 표시, 매칭률 순) */}
            {disambigResults.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {disambigResults.map(({ prod: p, score }) => {
                  const pctColor = score >= 70 ? '#2e7d32' : score >= 40 ? '#e65100' : '#999';
                  const pctBg    = score >= 70 ? '#e8f5e9' : score >= 40 ? '#fff3e0' : '#f5f5f5';
                  return (
                    <button key={p.ProdKey}
                      onMouseDown={() => handleDisambigSelect(p)}
                      style={{
                        display: 'flex', flexDirection: 'column', gap: 2,
                        padding: '6px 10px', border: `1px solid ${score >= 70 ? '#a5d6a7' : '#ddd'}`,
                        borderRadius: 8, background: '#fff', cursor: 'pointer',
                        textAlign: 'left', minWidth: 120, maxWidth: 180,
                      }}
                      onMouseEnter={e => e.currentTarget.style.background='#f0f4ff'}
                      onMouseLeave={e => e.currentTarget.style.background='#fff'}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 6,
                          background: pctBg, color: pctColor, whiteSpace: 'nowrap',
                        }}>{score}%</span>
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#1a237e', lineHeight: 1.3 }}>
                        {p.DisplayName || p.ProdName}
                      </div>
                      <div style={{ fontSize: 10, color: '#888' }}>{p.ProdName}</div>
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                        {p.CounName && <span style={{ fontSize: 9, background: '#e8f5e9', color: '#388e3c', borderRadius: 6, padding: '1px 4px' }}>{p.CounName}</span>}
                        {p.FlowerName && <span style={{ fontSize: 9, background: '#f3e5f5', color: '#7b1fa2', borderRadius: 6, padding: '1px 4px' }}>{p.FlowerName}</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                autoFocus
                type="text"
                placeholder="추가 검색으로 좁히기 (한글/영문)…"
                value={disambigSearch}
                onChange={e => handleDisambigSearchChange(e.target.value)}
                style={{ flex: 1, padding: '8px 12px', border: '2px solid #f9a825', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
              />
              <button
                onClick={handleDisambigSkip}
                style={{ padding: '8px 16px', border: '1px solid #bbb', background: '#f5f5f5', borderRadius: 6, fontSize: 13, cursor: 'pointer', color: '#666', whiteSpace: 'nowrap' }}
              >
                건너뛰기
              </button>
              <button
                onClick={handleDisambigSkipAll}
                style={{ padding: '9px 18px', border: '1px solid #ffcdd2', background: '#fff', borderRadius: 6, fontSize: 13, cursor: 'pointer', color: '#c62828', whiteSpace: 'nowrap' }}
              >
                전부 건너뛰기
              </button>
            </div>
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 6 }}>
              💾 선택 시 이 이름은 자동으로 저장됩니다 — 다음번에 같은 이름이 오면 자동 매칭
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}

function StockDraftPanel({ draft, copied, onCopy }) {
  const hasData = draft.remainRows.length > 0 || draft.historyRows.length > 0 || draft.extraRows.length > 0 || draft.confirmRows.length > 0;
  return (
    <div style={{ border: '1px solid #b0bec5', borderRadius: 8, marginBottom: 16, overflow: 'hidden', background: '#fff' }}>
      <div style={{ background: '#37474f', color: '#fff', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 14 }}>카톡 잔량/히스토리</strong>
        <span style={{ fontSize: 12, opacity: 0.9 }}>
          잔량 {draft.remainRows.length}개 / 히스토리 {draft.historyRows.length}개 / 확인 {draft.confirmRows.length}개
        </span>
        <button
          onClick={onCopy}
          disabled={!hasData}
          style={{ marginLeft: 'auto', padding: '6px 14px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.5)', background: copied ? '#2e7d32' : '#fff', color: copied ? '#fff' : '#263238', fontSize: 12, fontWeight: 700, cursor: hasData ? 'pointer' : 'default', opacity: hasData ? 1 : 0.5 }}
        >
          {copied ? '복사됨' : '결과 복사'}
        </button>
      </div>

      <div style={{ padding: 12, display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginBottom: 10 }}>
            <StockStat label="기초재고" value={draft.baseRows.length} />
            <StockStat label="잔량" value={draft.remainRows.length} />
            <StockStat label="히스토리" value={draft.historyRows.length} />
            <StockStat label="확인필요" value={draft.confirmRows.length} alert={draft.confirmRows.length > 0} />
          </div>

          {draft.historyRows.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: '#455a64', fontWeight: 700, marginBottom: 4 }}>히스토리 미리보기</div>
              <div style={{ border: '1px solid #eceff1', borderRadius: 6, overflow: 'hidden' }}>
                {draft.historyRows.slice(0, 8).map(row => (
                  <div key={row.id} style={{ padding: '7px 9px', borderBottom: '1px solid #eceff1', fontSize: 12, color: '#263238', background: row.warnings.length ? '#fff8e1' : '#fff' }}>
                    <strong>{row.weekLabel || '선택차수'} {row.productName}</strong>
                    <span style={{ marginLeft: 8, color: '#546e7a' }}>
                      {row.start != null && `시작 ${fmtStockQty(row.start)} / `}
                      {row.changes.map(formatChange).join(' ')}
                      {row.closeRemain != null && ` / 잔량 ${fmtStockQty(row.closeRemain)}`}
                    </span>
                  </div>
                ))}
                {draft.historyRows.length > 8 && (
                  <div style={{ padding: '6px 9px', fontSize: 11, color: '#78909c' }}>외 {draft.historyRows.length - 8}개는 복사 결과에 포함됩니다.</div>
                )}
              </div>
            </div>
          )}

          {draft.confirmRows.length > 0 && (
            <div style={{ border: '1px solid #ffcc80', borderRadius: 6, background: '#fff8e1', padding: 9 }}>
              <div style={{ fontSize: 12, color: '#e65100', fontWeight: 700, marginBottom: 5 }}>확인필요</div>
              {draft.confirmRows.slice(0, 6).map((line, idx) => (
                <div key={idx} style={{ fontSize: 12, color: '#5d4037', marginBottom: 3 }}>{line}</div>
              ))}
              {draft.confirmRows.length > 6 && (
                <div style={{ fontSize: 11, color: '#8d6e63' }}>외 {draft.confirmRows.length - 6}개는 복사 결과에 포함됩니다.</div>
              )}
            </div>
          )}

          {!hasData && (
            <div style={{ border: '1px dashed #cfd8dc', borderRadius: 6, padding: 12, color: '#78909c', fontSize: 13 }}>
              계산할 잔량이나 변경 히스토리를 찾지 못했습니다. 기초재고와 카톡 변경사항 형식을 확인해주세요.
            </div>
          )}
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: '#455a64', fontWeight: 700, marginBottom: 4 }}>복사 결과</div>
          <textarea
            readOnly
            value={draft.copyText}
            style={{ width: '100%', height: 430, padding: 10, border: '1px solid #cfd8dc', borderRadius: 6, fontFamily: 'monospace', fontSize: 12, lineHeight: 1.45, resize: 'vertical', boxSizing: 'border-box', background: '#fafafa', color: '#263238' }}
          />
        </div>
      </div>
    </div>
  );
}

function StockStat({ label, value, alert = false }) {
  return (
    <div style={{ border: `1px solid ${alert ? '#ffcc80' : '#d6dee8'}`, background: alert ? '#fff8e1' : '#f8fbff', borderRadius: 6, padding: '8px 9px' }}>
      <div style={{ fontSize: 11, color: alert ? '#e65100' : '#607d8b', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 18, color: alert ? '#e65100' : '#263238', fontWeight: 800 }}>{value}</div>
    </div>
  );
}

function CustSelector({ customers, onSelect }) {
  const [q, setQ] = useState('');
  const results = q ? customers.filter(c => customerMatchesSearch(c, q)).slice(0, 50) : customers.slice(0, 15);
  return (
    <div style={{ position: 'relative' }}>
      <input type="text" placeholder="거래처 검색..." value={q} onChange={e => setQ(e.target.value)}
        style={{ width: '100%', padding: '4px 8px', border: '1px solid rgba(255,255,255,0.5)', borderRadius: 4, fontSize: 13, background: 'rgba(255,255,255,0.9)' }} />
      {results.length > 0 && q && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#fff', border: '1px solid #ddd', borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.12)', zIndex: 200, maxHeight: 180, overflowY: 'auto' }}>
          {results.map(c => (
            <div key={c.CustKey}
              style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f5f5f5', color: '#111', background: '#fff' }}
              onMouseEnter={e => e.currentTarget.style.background='#f0f4ff'}
              onMouseLeave={e => e.currentTarget.style.background='#fff'}
              onMouseDown={() => { onSelect(c); setQ(''); }}>
              <strong style={{ color: '#1a237e' }}>{c.CustName}</strong>
              <span style={{ color: '#666', fontSize: 11, marginLeft: 6 }}>{c.CustArea}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const labelS = { display: 'block', fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 };
const thS = (w, align = 'center') => ({ width: w, minWidth: w, padding: '7px 8px', textAlign: align, fontWeight: 600, color: '#333' });
const navBtnS = { padding: '5px 10px', borderRadius: 6, border: '1px solid #bbb', background: '#f5f5f5', cursor: 'pointer', fontSize: 13, color: '#555' };
