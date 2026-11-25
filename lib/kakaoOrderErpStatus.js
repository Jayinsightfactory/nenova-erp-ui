// lib/kakaoOrderErpStatus.js
// 수입방 카톡 발주 내역 ↔ ERP(OrderMaster/OrderDetail) 읽기 전용 대조 및
// /orders/sales-paste 반자동 주문등록 핸드오프 순수 유틸리티 (ERP 쓰기 0)

import { getDisplayName, scoreMatch } from './displayName.js';
import { orderUnitFamily, validItem } from './importKakaoAdditions.js';

export const KAKAO_ORDER_HANDOFF_KEY = 'nenova.kakao-order-handoff.v1';
export const KAKAO_ORDER_SYNC_CHANNEL = 'nenova-kakao-order-sync';
export const KAKAO_ORDER_SYNC_PING_KEY = 'nenova.kakao-order-sync-ping';

const MAX_SCOPES = 12;
const PRODUCT_MATCH_THRESHOLD = 65;

const cleanText = (value) => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');

const normalizeCompanyToken = (value) =>
  cleanText(value)
    .replace(/^\((?:주|유)\)|^(?:㈜|주식회사)\s*/gi, '')
    .replace(/\((?:주|유)\)|(?:㈜|주식회사)/gi, '')
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, '');

const stripCompanyGenericSuffix = (normToken) =>
  String(normToken || '').replace(/(?:꽃백화점|원예|플라워|화훼|농원|꽃집|상사|무역|유통|코리아)$/, '');

const NON_CUSTOMER_NORMALIZED_TOKENS = new Set([
  '장미',
  '수국',
  '카네이션',
  '알스트로',
  '알스트로메리아',
  '튤립',
  '백합',
  '거베라',
  '리시안',
  '리시안셔스',
  '국화',
  '안개',
  '안개꽃',
  '루스커스',
  '유칼립투스',
  '카라',
  '칼라',
  '작약',
  '피오니',
  '소재',
  '그린소재',
  '재고',
  '창고재고',
  '여분',
  '샘플',
  '크리스마스',
  '어버이날',
  '발렌타인',
  '화이트데이',
  '졸업시즌',
]);

export function normalizeClCode(value) {
  const raw = cleanText(value).toUpperCase().replace(/\s+/g, '');
  if (!raw) return '';
  const m = raw.match(/^([A-Z]*CL)0*(\d+)([A-Z0-9_-]*)$/i);
  if (m) {
    return `${m[1].toUpperCase()}${Number(m[2])}${m[3].toUpperCase()}`;
  }
  if (/^[A-Z]*CL[A-Z0-9_-]*$/i.test(raw)) {
    return raw.toUpperCase();
  }
  return '';
}

function extractClCodesFromText(text) {
  const out = new Set();
  const src = cleanText(text);
  if (!src) return out;
  const re = /(?:^|[^A-Za-z0-9])([A-Za-z]*CL(?:0*\d+[A-Za-z0-9_-]*|[A-Za-z0-9_-]+))(?![A-Za-z0-9])/gi;
  for (const m of src.matchAll(re)) {
    const code = normalizeClCode(m[1]);
    if (code) out.add(code);
  }
  return out;
}

export function parseKakaoScopeQuery(rawScopes) {
  if (rawScopes === undefined || rawScopes === null || rawScopes === '') {
    return { valid: true, scopes: [] };
  }
  const list = Array.isArray(rawScopes) ? rawScopes : [rawScopes];
  const tokens = list
    .flatMap((entry) => String(entry ?? '').split(','))
    .map((s) => s.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return { valid: true, scopes: [] };
  }

  const byKey = new Map();
  for (const token of tokens) {
    const m = token.match(/^(20\d{2}):(\d{1,2})$/);
    if (!m) {
      return { valid: false, error: '조회 연도·차수 범위 형식을 확인하세요. (예: 2026:48)' };
    }
    const year = m[1];
    const majorNum = Number(m[2]);
    if (!Number.isInteger(majorNum) || majorNum < 1 || majorNum > 53) {
      return { valid: false, error: '차수는 01~53 범위여야 합니다.' };
    }
    const majorWeek = String(majorNum).padStart(2, '0');
    const key = `${year}:${majorWeek}`;
    if (!byKey.has(key)) {
      byKey.set(key, { key, year, majorWeek });
    }
  }

  if (byKey.size > MAX_SCOPES) {
    return { valid: false, error: `한 번에 최대 ${MAX_SCOPES}개 차수 범위만 조회할 수 있습니다.` };
  }

  return { valid: true, scopes: [...byKey.values()] };
}

function extractUniqueSubweekFromText(text, majorNum) {
  const src = String(text || '');
  if (!src) return '';
  const escapedMajor = `0?${majorNum}`;
  const re = new RegExp(`(?:^|[^0-9-])${escapedMajor}\\s*-\\s*([123])(?:\\s*(?:차|치)?[AB]?)?(?![0-9])`, 'gi');
  const found = new Set();
  for (const m of src.matchAll(re)) {
    found.add(String(Number(m[1])).padStart(2, '0'));
  }
  return found.size === 1 ? [...found][0] : '';
}

export function resolveKakaoItemOrderScope(item = {}, { messageText = '', orderScope = null, defaultYear = '' } = {}) {
  const rawYear = cleanText(item?.year || orderScope?.year || defaultYear);
  if (!/^20\d{2}$/.test(rawYear)) {
    return { valid: false, year: '', majorWeek: '', orderWeek: '', majorWeekOnly: false, originalWeek: '' };
  }
  const rawWeek = cleanText(item?.week);
  if (!rawWeek) {
    return { valid: false, year: rawYear, majorWeek: '', orderWeek: '', majorWeekOnly: false, originalWeek: '' };
  }

  const subMatch = rawWeek.match(/^(\d{1,2})\s*-\s*(\d{1,2})[AB]?$/i);
  if (subMatch) {
    const majorNum = Number(subMatch[1]);
    const minorNum = Number(subMatch[2]);
    if (majorNum >= 1 && majorNum <= 53 && minorNum >= 1 && minorNum <= 9) {
      const majorWeek = String(majorNum).padStart(2, '0');
      const orderWeek = `${majorWeek}-${String(minorNum).padStart(2, '0')}`;
      return {
        valid: true,
        year: rawYear,
        majorWeek,
        orderWeek,
        majorWeekOnly: false,
        originalWeek: rawWeek,
      };
    }
  }

  const majorMatch = rawWeek.match(/^(\d{1,2})$/);
  if (majorMatch) {
    const majorNum = Number(majorMatch[1]);
    if (majorNum >= 1 && majorNum <= 53) {
      const majorWeek = String(majorNum).padStart(2, '0');
      const recoveredFromLine = extractUniqueSubweekFromText(item?.sourceLine, majorNum);
      const recoveredFromMsg = recoveredFromLine || extractUniqueSubweekFromText(messageText, majorNum);
      if (recoveredFromMsg) {
        return {
          valid: true,
          year: rawYear,
          majorWeek,
          orderWeek: `${majorWeek}-${recoveredFromMsg}`,
          majorWeekOnly: false,
          originalWeek: `${majorWeek}-${recoveredFromMsg}`,
        };
      }
      const scopeSubweek =
        orderScope?.orderWeek && String(orderScope.orderWeek).startsWith(`${majorWeek}-`)
          ? String(orderScope.orderWeek)
          : `${majorWeek}-01`;
      return {
        valid: true,
        year: rawYear,
        majorWeek,
        orderWeek: scopeSubweek,
        majorWeekOnly: true,
        originalWeek: `${majorNum}차`,
      };
    }
  }

  return { valid: false, year: rawYear, majorWeek: '', orderWeek: '', majorWeekOnly: false, originalWeek: rawWeek };
}

export function extractScopesFromKakaoEntries(entries = [], orderScope = null) {
  const byKey = new Map();
  if (orderScope?.year && orderScope?.majorWeek) {
    const yr = String(orderScope.year).trim();
    const maj = String(Number(orderScope.majorWeek)).padStart(2, '0');
    if (/^20\d{2}$/.test(yr) && Number(maj) >= 1 && Number(maj) <= 53) {
      byKey.set(`${yr}:${maj}`, `${yr}:${maj}`);
    }
  }
  for (const entry of entries) {
    const scope = resolveKakaoItemOrderScope(entry.row || entry.item || entry, {
      messageText: entry.messageText || '',
      orderScope,
      defaultYear: entry.defaultYear || '',
    });
    if (scope.valid && byKey.size < MAX_SCOPES) {
      const key = `${scope.year}:${scope.majorWeek}`;
      byKey.set(key, key);
    }
  }
  return [...byKey.values()];
}

export function resolveKakaoCustomerMatch(rawCustomer, customers = [], { messageText = '' } = {}) {
  const cleaned = cleanText(rawCustomer);
  if (!cleaned) {
    return { status: 'NONE', customer: null, candidates: [], rawCustomer: '' };
  }
  const cleanedNorm = normalizeCompanyToken(cleaned);
  if (NON_CUSTOMER_NORMALIZED_TOKENS.has(cleanedNorm)) {
    return { status: 'NONE', customer: null, candidates: [], rawCustomer: '' };
  }

  const activeCustomers = (customers || []).filter((c) => c && Number(c.CustKey) > 0);
  const explicitCodes = extractClCodesFromText(cleaned);

  // rawCustomer에 CL 코드가 없을 때만, 원문에서 해당 거래처명과 같은 줄에 단독 병기된 CL 코드를 보조 확인
  if (explicitCodes.size === 0 && messageText) {
    const rawNorm = normalizeCompanyToken(cleaned);
    if (rawNorm.length >= 2) {
      for (const rawLine of String(messageText).split(/\r?\n/)) {
        const lineCodes = extractClCodesFromText(rawLine);
        if (lineCodes.size !== 1) continue;
        const lineWithoutCode = rawLine.replace(/[A-Za-z]*CL[0-9A-Za-z_-]*/gi, ' ');
        const headPart = lineWithoutCode.split(/[:：\-]/)[0] || '';
        if (normalizeCompanyToken(headPart) === rawNorm) {
          for (const c of lineCodes) explicitCodes.add(c);
        }
      }
    }
  }

  const textWithoutCl = cleanText(cleaned.replace(/\b[A-Za-z]*CL[0-9A-Za-z_-]*\b/gi, ' '));
  const normNameOnly = normalizeCompanyToken(textWithoutCl);

  if (explicitCodes.size > 0) {
    const codeMatches = activeCustomers.filter((c) => {
      const oc = normalizeClCode(c.OrderCode);
      const cc = normalizeClCode(c.CustCode);
      return (oc && explicitCodes.has(oc)) || (cc && explicitCodes.has(cc));
    });
    if (codeMatches.length === 1) {
      return { status: 'MATCHED', customer: codeMatches[0], candidates: codeMatches, rawCustomer: cleaned };
    }
    if (codeMatches.length > 1) {
      if (normNameOnly) {
        const narrowed = codeMatches.filter((c) => {
          const cn = normalizeCompanyToken(c.CustName);
          return cn === normNameOnly || cn.includes(normNameOnly) || normNameOnly.includes(cn);
        });
        if (narrowed.length === 1) {
          return { status: 'MATCHED', customer: narrowed[0], candidates: narrowed, rawCustomer: cleaned };
        }
      }
      return { status: 'AMBIGUOUS', customer: null, candidates: codeMatches, rawCustomer: cleaned };
    }
    // CL 코드만 단독 기재되었으나 일치하는 코드가 없으면 부분 문자열('CL3' -> 'CL31') 오매칭 방지
    if (!normNameOnly) {
      return { status: 'UNRESOLVED', customer: null, candidates: [], rawCustomer: cleaned };
    }
  }

  if (!normNameOnly) {
    return { status: 'UNRESOLVED', customer: null, candidates: [], rawCustomer: cleaned };
  }

  // 1차: 정규화 정확 일치 (CustName, OrderCode, CustCode, Descr 별칭 토큰)
  const exactMatches = activeCustomers.filter((c) => {
    const tokens = [
      c.CustName,
      c.OrderCode,
      c.CustCode,
      ...String(c.Descr || '').split(/[\/,|]/),
    ]
      .map(normalizeCompanyToken)
      .filter(Boolean);
    return tokens.includes(normNameOnly);
  });
  if (exactMatches.length === 1) {
    return { status: 'MATCHED', customer: exactMatches[0], candidates: exactMatches, rawCustomer: cleaned };
  }
  if (exactMatches.length > 1) {
    return { status: 'AMBIGUOUS', customer: null, candidates: exactMatches, rawCustomer: cleaned };
  }

  // 2차: 일반 화훼 접미어 제거 후 어근 비교 ('주광' <-> '(주)주광꽃백화점', '일신' <-> '일신원예')
  const baseToken = stripCompanyGenericSuffix(normNameOnly);
  if (baseToken.length >= 2) {
    const exactBaseMatches = activeCustomers.filter(
      (c) => stripCompanyGenericSuffix(normalizeCompanyToken(c.CustName)) === baseToken,
    );
    if (exactBaseMatches.length === 1) {
      return { status: 'MATCHED', customer: exactBaseMatches[0], candidates: exactBaseMatches, rawCustomer: cleaned };
    }
    if (exactBaseMatches.length > 1) {
      return { status: 'AMBIGUOUS', customer: null, candidates: exactBaseMatches, rawCustomer: cleaned };
    }

    const partialMatches = activeCustomers.filter((c) => {
      const cn = normalizeCompanyToken(c.CustName);
      const descrTokens = String(c.Descr || '')
        .split(/[\/,|]/)
        .map(normalizeCompanyToken)
        .filter(Boolean);
      return cn.includes(baseToken) || descrTokens.some((d) => d === baseToken || d.includes(baseToken));
    });
    if (partialMatches.length === 1) {
      return { status: 'MATCHED', customer: partialMatches[0], candidates: partialMatches, rawCustomer: cleaned };
    }
    if (partialMatches.length > 1) {
      return { status: 'AMBIGUOUS', customer: null, candidates: partialMatches, rawCustomer: cleaned };
    }
  }

  return { status: 'UNRESOLVED', customer: null, candidates: [], rawCustomer: cleaned };
}

function countryMatchesProduct(kakaoCountry, erpCountry) {
  const kc = cleanText(kakaoCountry);
  const ec = cleanText(erpCountry);
  if (!kc || !ec) return true;
  return kc === ec || ec.includes(kc) || kc.includes(ec);
}

export function erpQuantityForUnitFamily(orderRow = {}, unitFamily = '') {
  if (unitFamily === '박스') {
    const box = Number(orderRow.BoxQuantity || 0);
    if (box > 0) return box;
    return cleanText(orderRow.OutUnit) === '박스' ? Number(orderRow.OutQuantity || 0) : 0;
  }
  if (unitFamily === '단') {
    const bunch = Number(orderRow.BunchQuantity || 0);
    if (bunch > 0) return bunch;
    return cleanText(orderRow.OutUnit) === '단' ? Number(orderRow.OutQuantity || 0) : 0;
  }
  if (unitFamily === '송이') {
    const steam = Number(orderRow.SteamQuantity || 0);
    if (steam > 0) return steam;
    return cleanText(orderRow.OutUnit) === '송이' ? Number(orderRow.OutQuantity || 0) : 0;
  }
  return Number(orderRow.OutQuantity || 0);
}

export function aggregateErpOrderRows(rawRows = []) {
  const byKey = new Map();
  for (const row of rawRows || []) {
    const year = cleanText(row.OrderYear);
    const week = cleanText(row.OrderWeek);
    const custKey = Number(row.CustKey || 0);
    const prodKey = Number(row.ProdKey || 0);
    if (!year || !week || !(custKey > 0) || !(prodKey > 0)) continue;
    const key = `${year}|${week}|${custKey}|${prodKey}`;
    const masterKey = Number(row.OrderMasterKey || 0);
    const prev = byKey.get(key);
    if (prev) {
      prev.BoxQuantity += Number(row.BoxQuantity || 0);
      prev.BunchQuantity += Number(row.BunchQuantity || 0);
      prev.SteamQuantity += Number(row.SteamQuantity || 0);
      prev.OutQuantity += Number(row.OutQuantity || 0);
      if (masterKey > 0 && !prev.OrderMasterKeys.includes(masterKey)) {
        prev.OrderMasterKeys.push(masterKey);
        if (masterKey > prev.OrderMasterKey) prev.OrderMasterKey = masterKey;
      }
    } else {
      const prodObj = {
        ProdKey: prodKey,
        ProdName: cleanText(row.ProdName),
        DisplayName: cleanText(row.DisplayName),
        FlowerName: cleanText(row.FlowerName),
        CounName: cleanText(row.CounName),
        OutUnit: cleanText(row.OutUnit),
      };
      prodObj.DisplayName = prodObj.DisplayName || getDisplayName(prodObj);
      byKey.set(key, {
        OrderMasterKey: masterKey,
        OrderMasterKeys: masterKey > 0 ? [masterKey] : [],
        OrderYear: year,
        OrderWeek: week,
        CustKey: custKey,
        ProdKey: prodKey,
        BoxQuantity: Number(row.BoxQuantity || 0),
        BunchQuantity: Number(row.BunchQuantity || 0),
        SteamQuantity: Number(row.SteamQuantity || 0),
        OutQuantity: Number(row.OutQuantity || 0),
        OutUnit: prodObj.OutUnit,
        ProdName: prodObj.ProdName,
        DisplayName: prodObj.DisplayName,
        FlowerName: prodObj.FlowerName,
        CounName: prodObj.CounName,
      });
    }
  }
  return [...byKey.values()];
}

function findBestErpProductMatch(item, candidateOrders, unitFamily, kakaoQty) {
  const flowerGroup = cleanText(item.group);
  const cleanGroup = flowerGroup && !/^(?:기타|미분류)$/.test(flowerGroup) ? flowerGroup : '';
  const queryWithContext = [cleanText(item.country), cleanGroup, cleanText(item.product)].filter(Boolean).join(' ');
  const productOnly = cleanText(item.product);
  const baseSearch = cleanText(item.baseName || item.product);

  let best = null;
  for (const orderRow of candidateOrders) {
    if (!countryMatchesProduct(item.country, orderRow.CounName)) continue;
    const score = Math.max(
      scoreMatch(queryWithContext, orderRow, baseSearch),
      scoreMatch(productOnly, orderRow, baseSearch),
    );
    if (score < PRODUCT_MATCH_THRESHOLD) continue;
    const erpQty = erpQuantityForUnitFamily(orderRow, unitFamily);
    if (!(erpQty > 0)) continue;
    const exactQty = Math.abs(erpQty - kakaoQty) < 0.01;
    if (
      !best ||
      score > best.score ||
      (score === best.score && exactQty && !best.exactQty) ||
      (score === best.score && exactQty === best.exactQty && orderRow.OrderMasterKey > best.order.OrderMasterKey)
    ) {
      best = { order: orderRow, score, erpQty, exactQty };
    }
  }
  return best;
}

export function classifyKakaoItemErpStatus(
  item = {},
  {
    messageType = '추가',
    messageKind = 'addition',
    messageText = '',
    orderScope = null,
    defaultYear = '',
    customers = [],
    erpOrders = [],
  } = {},
) {
  const qty = Number(item?.quantity);
  const isCancelled = messageType === '취소' || Boolean(item?.cancelled) || !(Number.isFinite(qty) && qty > 0);
  if (isCancelled) {
    return {
      status: 'CANCELLED',
      badgeLabel: '취소·제외',
      detailLabel: '취소 또는 0수량 항목은 주문등록 대상에서 제외됩니다.',
      eligible: false,
      autoSelectable: false,
    };
  }

  if (messageKind === 'review' && !item?.checked) {
    return {
      status: 'REVIEW_HOLD',
      badgeLabel: '검토 확인필요',
      detailLabel: '검토 필요 원문은 품목·수량 확인 체크 후 주문등록으로 넘길 수 있습니다.',
      eligible: false,
      autoSelectable: false,
    };
  }

  const unitFamily = orderUnitFamily(item?.unit);
  const scope = resolveKakaoItemOrderScope(item, { messageText, orderScope, defaultYear });
  if (!validItem(item) || !unitFamily || !scope.valid) {
    return {
      status: 'INCOMPLETE',
      badgeLabel: '차수·단위 확인',
      detailLabel: '연도, 차수, 품목, 양수 수량과 단위가 모두 확인되어야 합니다.',
      eligible: false,
      autoSelectable: false,
      scope,
    };
  }

  const customerMatch = resolveKakaoCustomerMatch(item?.customer, customers, { messageText });
  if (customerMatch.status === 'NONE') {
    return {
      status: 'NO_CUSTOMER',
      badgeLabel: '산지선발주 · 거래처지정필요',
      detailLabel: '수입방 재고/농장 선발주 건(국내 거래처 미기재)으로 농장 합계에만 반영됩니다.',
      eligible: false,
      autoSelectable: false,
      scope,
      unitFamily,
      customerMatch,
    };
  }

  const candidateCustKeys =
    customerMatch.status === 'MATCHED'
      ? [Number(customerMatch.customer.CustKey)]
      : customerMatch.status === 'AMBIGUOUS'
        ? customerMatch.candidates.map((c) => Number(c.CustKey))
        : [];

  if (candidateCustKeys.length > 0 && erpOrders.length > 0) {
    const scopedOrders = erpOrders.filter((o) => {
      if (String(o.OrderYear) !== scope.year) return false;
      if (!candidateCustKeys.includes(Number(o.CustKey))) return false;
      if (!scope.majorWeekOnly) {
        return String(o.OrderWeek) === scope.orderWeek;
      }
      const ow = String(o.OrderWeek);
      return ow === scope.majorWeek || ow.startsWith(`${scope.majorWeek}-`);
    });

    const bestMatch = findBestErpProductMatch(item, scopedOrders, unitFamily, qty);
    if (bestMatch) {
      const matchedCust =
        customerMatch.customer ||
        customers.find((c) => Number(c.CustKey) === Number(bestMatch.order.CustKey)) ||
        null;
      const orderNo = bestMatch.order.OrderMasterKey;
      const weekSuffix = scope.majorWeekOnly ? ` (${bestMatch.order.OrderWeek})` : '';
      if (bestMatch.exactQty) {
        return {
          status: 'REGISTERED',
          badgeLabel: `ERP 등록완료 #${orderNo}${weekSuffix}`,
          detailLabel: `전산 주문 #${orderNo} (${bestMatch.order.OrderYear}/${bestMatch.order.OrderWeek}) · ${bestMatch.order.DisplayName || bestMatch.order.ProdName} ${bestMatch.erpQty}${unitFamily}`,
          eligible: false,
          autoSelectable: false,
          scope: { ...scope, matchedOrderWeek: bestMatch.order.OrderWeek },
          unitFamily,
          customerMatch: matchedCust ? { ...customerMatch, status: 'MATCHED', customer: matchedCust } : customerMatch,
          erpOrder: bestMatch.order,
          erpQty: bestMatch.erpQty,
        };
      }
      return {
        status: 'DIFF_QTY',
        badgeLabel: `수량차이 #${orderNo} (ERP ${bestMatch.erpQty}${unitFamily} / 카톡 ${qty}${unitFamily})`,
        detailLabel: `전산 주문 #${orderNo}에 ${bestMatch.erpQty}${unitFamily} 등록됨 · 중복 가산 방지를 위해 자동선택에서 제외됩니다.`,
        eligible: false,
        autoSelectable: false,
        scope: { ...scope, matchedOrderWeek: bestMatch.order.OrderWeek },
        unitFamily,
        customerMatch: matchedCust ? { ...customerMatch, status: 'MATCHED', customer: matchedCust } : customerMatch,
        erpOrder: bestMatch.order,
        erpQty: bestMatch.erpQty,
      };
    }
  }

  if (customerMatch.status === 'MATCHED') {
    const cust = customerMatch.customer;
    return {
      status: 'UNREGISTERED',
      badgeLabel: '미등록 · 주문가능',
      detailLabel: `${scope.year}/${scope.orderWeek}${scope.majorWeekOnly ? '(기본 세부차수 확인)' : ''} · ${cust.CustName}${cust.OrderCode ? ` (${cust.OrderCode})` : ''} 전산 미등록`,
      eligible: true,
      autoSelectable: true,
      scope,
      unitFamily,
      customerMatch,
    };
  }

  const candidateHint =
    customerMatch.status === 'AMBIGUOUS'
      ? `후보 ${customerMatch.candidates.length}곳`
      : '전산 거래처 선택 필요';
  return {
    status: 'CUSTOMER_CHECK',
    badgeLabel: `거래처확인 · ${customerMatch.rawCustomer}`,
    detailLabel: `${customerMatch.rawCustomer} (${candidateHint}) — 주문등록 화면에서 거래처를 직접 지정해 등록할 수 있습니다.`,
    eligible: true,
    autoSelectable: false,
    scope,
    unitFamily,
    customerMatch,
  };
}

export function formatKakaoItemForSalesPaste(item = {}) {
  const unit = orderUnitFamily(item?.unit) || '박스';
  const qty = Number(item?.quantity || 0);
  const country = cleanText(item?.country);
  const rawGroup = cleanText(item?.group);
  const group = rawGroup && !/^(?:기타|미분류)$/.test(rawGroup) ? rawGroup : '';
  let productName = cleanText(item?.product);
  if (group && !productName.includes(group)) {
    productName = `${group} ${productName}`.trim();
  }
  if (country && !productName.includes(country)) {
    productName = `${country} ${productName}`.trim();
  }
  return `${productName} ${qty}${unit}`.trim();
}

export function buildKakaoOrderHandoffPayload(selectedEntries = [], { createdFrom = '/import/tools?tool=pedidos' } = {}) {
  const groupsByKey = new Map();

  for (const entry of selectedEntries || []) {
    const { row, evaluation, message } = entry;
    if (!row || !evaluation?.eligible || !evaluation?.scope?.valid) continue;

    const { scope, customerMatch, unitFamily } = evaluation;
    const cust = customerMatch?.status === 'MATCHED' ? customerMatch.customer : null;
    const custIdentity = cust ? `cust:${cust.CustKey}` : `raw:${normalizeCompanyToken(customerMatch?.rawCustomer || row.customer)}`;
    const groupKey = `${scope.year}|${scope.orderWeek}|${custIdentity}`;

    if (!groupsByKey.has(groupKey)) {
      groupsByKey.set(groupKey, {
        groupKey,
        year: scope.year,
        week: scope.orderWeek,
        majorWeek: scope.majorWeek,
        majorWeekOnly: Boolean(scope.majorWeekOnly),
        originalWeeks: new Set(),
        custKey: cust ? Number(cust.CustKey) : null,
        custName: cust ? String(cust.CustName || '') : '',
        orderCode: cust ? String(cust.OrderCode || '') : '',
        managerName: cust ? String(cust.ManagerName || '') : '',
        rawCustomer: String(customerMatch?.rawCustomer || row.customer || ''),
        customerCandidates: (customerMatch?.candidates || []).slice(0, 8).map((c) => ({
          custKey: Number(c.CustKey),
          custName: String(c.CustName || ''),
          orderCode: String(c.OrderCode || ''),
          managerName: String(c.ManagerName || ''),
        })),
        items: [],
        sourceMessagesMap: new Map(),
      });
    }

    const group = groupsByKey.get(groupKey);
    if (scope.majorWeekOnly) group.majorWeekOnly = true;
    if (scope.originalWeek) group.originalWeeks.add(scope.originalWeek);

    const pasteLine = formatKakaoItemForSalesPaste(row);
    group.items.push({
      itemKey: String(row.key || ''),
      country: cleanText(row.country),
      flowerGroup: cleanText(row.group),
      farm: cleanText(row.farm),
      product: cleanText(row.product),
      quantity: Number(row.quantity || 0),
      sourceUnit: cleanText(row.unit),
      salesUnit: unitFamily || '박스',
      pasteLine,
      sourceMessageId: String(message?.id || ''),
      sourceTime: cleanText(message?.time),
    });

    if (message?.id && !group.sourceMessagesMap.has(message.id)) {
      group.sourceMessagesMap.set(message.id, {
        id: String(message.id),
        room: '수입방',
        time: cleanText(message.time),
        text: String(message.text || '').slice(0, 1200),
      });
    }
  }

  const groups = [...groupsByKey.values()].map((g) => {
    const lines = [`${g.year}년 ${g.week}차`, ...g.items.map((it) => it.pasteLine)];
    return {
      groupKey: g.groupKey,
      year: g.year,
      week: g.week,
      majorWeek: g.majorWeek,
      majorWeekOnly: g.majorWeekOnly,
      originalWeekLabel: [...g.originalWeeks].join(', '),
      custKey: g.custKey,
      custName: g.custName,
      orderCode: g.orderCode,
      managerName: g.managerName,
      rawCustomer: g.rawCustomer,
      customerCandidates: g.customerCandidates,
      itemCount: g.items.length,
      items: g.items,
      pasteText: lines.join('\n'),
      sourceMessages: [...g.sourceMessagesMap.values()],
      completedOrderMasterKey: null,
      completedAt: null,
    };
  });

  return {
    version: 1,
    handoffId: `kakao-import-${Date.now()}`,
    createdAt: new Date().toISOString(),
    createdFrom,
    room: '수입방',
    activeGroupIndex: 0,
    groups,
  };
}

function defaultAllowImportUser(user = {}) {
  const userId = String(user?.userId ?? user?.UserID ?? '').trim();
  if (!userId || user?.accountActive === false || user?.isDeleted === true) return false;
  const dept = String(user?.deptName ?? user?.DeptName ?? user?.department ?? '').trim();
  if (dept === '수입부' || dept === '대표') return true;
  if (user?.role === 'admin' || user?.isAdmin === true) return true;
  return ['1', '4', '7', '9'].includes(String(user?.authority ?? user?.Authority ?? '').trim());
}

export function createKakaoOrderStatusHandler({
  queryFn,
  types,
  allowUser = defaultAllowImportUser,
} = {}) {
  return async function kakaoOrderStatusHandler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ error: 'GET 요청만 허용됩니다.' });
    }
    if (!allowUser(req.user)) {
      return res.status(403).json({ error: '수입부 또는 관리자만 카톡 주문 대조 현황을 조회할 수 있습니다.' });
    }

    const parsed = parseKakaoScopeQuery(req.query?.scopes);
    if (!parsed.valid) {
      return res.status(400).json({ error: parsed.error });
    }

    try {
      const customerPromise = queryFn(
        `SELECT c.CustKey, c.CustName,
                ISNULL(c.CustCode, '') AS CustCode,
                ISNULL(c.OrderCode, '') AS OrderCode,
                ISNULL(c.CustArea, '') AS CustArea,
                ISNULL(c.Descr, '') AS Descr,
                ISNULL(NULLIF(LTRIM(RTRIM(m.ManagerName)), ''), N'담당자 미지정') AS ManagerName
         FROM dbo.Customer c
         OUTER APPLY (
           SELECT TOP 1 ISNULL(NULLIF(ui.UserName, ''), c.Manager) AS ManagerName
           FROM dbo.UserInfo ui
           WHERE ui.UserID = c.Manager OR ui.UserName = c.Manager
           ORDER BY CASE WHEN ui.UserID = c.Manager THEN 0 ELSE 1 END
         ) m
         WHERE ISNULL(c.isDeleted, 0) = 0
         ORDER BY c.CustName`,
        {},
      );

      let orderPromise = Promise.resolve({ recordset: [] });
      if (parsed.scopes.length > 0) {
        const params = {};
        const clauses = parsed.scopes.map((scope, index) => {
          params[`yr${index}`] = { type: types.NVarChar, value: scope.year };
          params[`maj${index}`] = { type: types.NVarChar, value: scope.majorWeek };
          params[`pfx${index}`] = { type: types.NVarChar, value: `${scope.majorWeek}-%` };
          return `(om.OrderYear = @yr${index} AND (om.OrderWeek = @maj${index} OR om.OrderWeek LIKE @pfx${index}))`;
        });

        orderPromise = queryFn(
          `SELECT om.OrderMasterKey, om.OrderYear, om.OrderWeek, om.CustKey,
                  od.OrderDetailKey, od.ProdKey,
                  ISNULL(od.BoxQuantity, 0) AS BoxQuantity,
                  ISNULL(od.BunchQuantity, 0) AS BunchQuantity,
                  ISNULL(od.SteamQuantity, 0) AS SteamQuantity,
                  ISNULL(od.OutQuantity, 0) AS OutQuantity,
                  ISNULL(p.ProdName, '') AS ProdName,
                  ISNULL(p.DisplayName, '') AS DisplayName,
                  ISNULL(p.FlowerName, '') AS FlowerName,
                  ISNULL(p.CounName, '') AS CounName,
                  ISNULL(p.OutUnit, '') AS OutUnit
           FROM dbo.OrderMaster om
           JOIN dbo.OrderDetail od
             ON od.OrderMasterKey = om.OrderMasterKey
            AND ISNULL(od.isDeleted, 0) = 0
           LEFT JOIN dbo.Product p
             ON p.ProdKey = od.ProdKey
           WHERE ISNULL(om.isDeleted, 0) = 0
             AND (${clauses.join(' OR ')})
             AND (
               ISNULL(od.OutQuantity, 0) > 0
               OR ISNULL(od.BoxQuantity, 0) > 0
               OR ISNULL(od.BunchQuantity, 0) > 0
               OR ISNULL(od.SteamQuantity, 0) > 0
             )
           ORDER BY om.OrderMasterKey DESC, od.OrderDetailKey ASC`,
          params,
        );
      }

      const [customerResult, orderResult] = await Promise.all([customerPromise, orderPromise]);
      const customers = (customerResult?.recordset || []).map((row) => ({
        CustKey: Number(row.CustKey),
        CustName: String(row.CustName || ''),
        CustCode: String(row.CustCode || ''),
        OrderCode: String(row.OrderCode || ''),
        CustArea: String(row.CustArea || ''),
        Descr: String(row.Descr || ''),
        ManagerName: String(row.ManagerName || ''),
      }));

      const erpOrders = aggregateErpOrderRows(orderResult?.recordset || []);

      return res.status(200).json({
        scopes: parsed.scopes.map((s) => s.key),
        checkedAt: new Date().toISOString(),
        customers,
        erpOrders,
      });
    } catch {
      return res.status(502).json({
        error: 'ERP 주문 원장(OrderMaster/OrderDetail) 대조 정보를 조회하지 못했습니다.',
      });
    }
  };
}
