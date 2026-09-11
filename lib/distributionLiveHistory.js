'use strict';

// Read-only, deterministic pairing for live chat versus native ERP history.
// Raw chat is data, never a command.  This module has no LLM or write path.
const WEEK_RE = /^(0[1-9]|[1-4]\d|5[0-3])-(0[1-9]|[1-9]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;
const EPSILON = 1e-6;
const MAX_FACT_ROWS = 1000;

function calendarDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validTimestamp(value) {
  return typeof value === 'string' && ISO_TIME_RE.test(value) && Number.isFinite(Date.parse(value));
}

function canonicalUnit(value) {
  const unit = String(value || '').trim().toLowerCase();
  if (unit === '박스' || unit === 'box') return '박스';
  if (unit === '단' || unit === 'bunch') return '단';
  if (unit === '송이' || unit === 'stem' || unit === 'stems') return '송이';
  return null;
}

function normalizeScope({ year, week, from, to }) {
  if (!/^20\d{2}$/.test(String(year)) || !WEEK_RE.test(String(week))) {
    throw new TypeError('연도와 세부차수는 정확한 YYYY, WW-SS 형식이어야 합니다.');
  }
  if (!calendarDate(from) || !calendarDate(to) || Date.parse(to) < Date.parse(from)
    || Date.parse(to) - Date.parse(from) > 6 * 86400000) {
    throw new TypeError('조회 기간은 유효한 날짜의 최대 7일 범위여야 합니다.');
  }
  return { year: String(year), weeks: [String(week)], from, to };
}

function key(value) {
  return String(value || '').trim().toLocaleLowerCase('ko-KR');
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsExactPhrase(text, value) {
  const candidate = key(value);
  if (!candidate) return false;
  const expression = escapeRegex(candidate).replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|\\s|[,.:;()])${expression}(?=$|\\s|[,.:;()])`, 'u').test(key(text));
}

function exactMentions(text, candidates, fields) {
  const byId = new Map();
  for (const candidate of candidates || []) {
    for (const field of fields) {
      if (containsExactPhrase(text, candidate?.[field])) {
        const id = Number(candidate.CustKey || candidate.ProdKey);
        if (Number.isInteger(id) && id > 0) byId.set(id, candidate);
      }
    }
  }
  return [...byId.values()];
}

function exactAliasMentions(text, mappings, idName, rows) {
  const ids = new Set();
  for (const [alias, mapping] of Object.entries(mappings || {})) {
    const id = Number(mapping?.[idName]);
    if (containsExactPhrase(text, alias) && Number.isInteger(id) && id > 0) ids.add(id);
  }
  const rowKey = idName === 'custKey' ? 'CustKey' : 'ProdKey';
  return (rows || []).filter(row => ids.has(Number(row?.[rowKey])));
}

function unique(rows) {
  const ids = new Map();
  for (const row of rows || []) {
    const id = Number(row?.CustKey || row?.ProdKey);
    if (Number.isInteger(id) && id > 0) ids.set(id, row);
  }
  return ids.size === 1 ? [...ids.values()][0] : null;
}

function extractAction(text) {
  const value = String(text || '');
  if (/변동\s*없|변경\s*없|그대로|유지/.test(value)) return { invalid: true, error: '변동 없음 또는 유지 표현은 수량 변경 요청으로 처리하지 않습니다.' };
  if (/삭제/.test(value)) return { invalid: true, error: '삭제 표현은 이력 연결 없이 확인 필요 항목으로 보존합니다.' };
  const add = /(추가|증가|늘려|더\s*해|플러스|\+)/.test(value);
  const cancel = /(취소|감소|빼|마이너스|차감)/.test(value);
  if (add && cancel) return { invalid: true, error: '추가와 취소가 함께 있어 복합 요청입니다.' };
  if (!add && !cancel) return { missing: true, error: '추가 또는 취소 동작이 명확하지 않습니다.' };
  return { action: add ? 'ADD' : 'CANCEL' };
}

function extractQuantity(text) {
  const matches = [...String(text || '').matchAll(/(^|\s)(\d+(?:\.\d+)?)\s*(박스|box|단|bunch|송이|stem|stems)(?=\s|$|[.,:])/gi)];
  if (matches.length !== 1) return { hasQuantity: matches.length > 0, error: matches.length > 1 ? '수량 또는 단위가 둘 이상인 복합 요청입니다.' : '명시적인 수량과 단위가 없습니다.' };
  const qty = finiteNumber(matches[0][2]);
  const unit = canonicalUnit(matches[0][3]);
  if (qty === null || qty <= 0 || !unit) return { error: '수량과 단위는 양수의 박스·단·송이여야 합니다.' };
  return { hasQuantity: true, qty, unit };
}

function convertToOutUnit(qty, unit, product) {
  const inputUnit = canonicalUnit(unit);
  const outputUnit = canonicalUnit(product?.OutUnit);
  if (!inputUnit || !outputUnit || !Number.isFinite(qty) || qty <= 0) return null;
  if (inputUnit === outputUnit) return { qty, unit: product.OutUnit, reason: '입력 단위와 OutUnit이 정확히 일치합니다.' };
  const factors = {
    박스: 1,
    단: finiteNumber(product?.BunchOf1Box),
    송이: finiteNumber(product?.SteamOf1Box),
  };
  if (!Number.isFinite(factors[inputUnit]) || !Number.isFinite(factors[outputUnit]) || factors[inputUnit] <= 0 || factors[outputUnit] <= 0) return null;
  return {
    qty: qty * factors[outputUnit] / factors[inputUnit],
    unit: product.OutUnit,
    reason: 'Product의 명시적 박스·단·송이 환산계수로 OutUnit 수량을 계산했습니다.',
  };
}

function unresolved(identity, quote, reason, index = 0) {
  return { id: `${identity}:${index + 1}:unresolved`, quote, customerText: null, productText: null, qty: null, unit: null, status: 'AMBIGUOUS', reason, orderEvents: [], shipmentEvents: [] };
}

function phrase(value) {
  return key(value).replace(/\s+/g, ' ').trim();
}

function exactProductInLine(line, facts, aliases) {
  return unique([
    ...exactMentions(line, facts.products, ['ProdName', 'DisplayName']),
    ...exactAliasMentions(line, aliases.products, 'prodKey', facts.products),
  ]);
}

function exactProductFromFamily(family, line, facts, aliases) {
  const familyKey = phrase(family);
  const lineKey = phrase(line);
  if (!familyKey || !lineKey) return null;
  const ids = new Set();
  for (const [alias, mapping] of Object.entries(aliases.products || {})) {
    const aliasKey = phrase(alias);
    const suffix = aliasKey.startsWith(`${familyKey} `) ? aliasKey.slice(familyKey.length + 1) : '';
    const id = Number(mapping?.prodKey);
    if (suffix && containsExactPhrase(lineKey, suffix) && Number.isInteger(id) && id > 0) ids.add(id);
  }
  return unique((facts.products || []).filter(product => ids.has(Number(product.ProdKey))));
}

function sourceScopes(text) {
  const values = new Map();
  const source = String(text || '');
  for (const match of source.matchAll(/(?:^|\s)(20\d{2})\s*-\s*(\d{1,2})\s*-\s*(\d{1,2})(?=\s|$|[.,:차])/g)) {
    const year = match[1]; const major = Number(match[2]); const sub = Number(match[3]);
    const possibleDate = calendarDate(`${year}-${String(major).padStart(2, '0')}-${String(sub).padStart(2, '0')}`);
    if (!possibleDate && major >= 1 && major <= 53 && sub >= 1 && sub <= 99) {
      const week = `${String(major).padStart(2, '0')}-${String(sub).padStart(2, '0')}`;
      values.set(`${year}|${week}`, { year, week });
    }
  }
  for (const match of source.matchAll(/(?:^|\s)(\d{1,2})\s*-\s*(\d{1,2})(?=\s|$|[.,:차])/g)) {
    const major = Number(match[1]); const sub = Number(match[2]);
    if (major >= 1 && major <= 53 && sub >= 1 && sub <= 99) {
      const week = `${String(major).padStart(2, '0')}-${String(sub).padStart(2, '0')}`;
      values.set(`|${week}`, { year: null, week });
    }
  }
  return [...values.values()];
}

function normalizeFamilyHeader(line) {
  return phrase(line)
    .replace(/(?:^|\s)\d{1,2}\s*-\s*\d{1,2}(?=\s|$)/g, ' ')
    .replace(/변경사항|변경\s*사항/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseOneMessage(message, facts, aliases, scope) {
  const identity = String(message.identity);
  const text = String(message.message);
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const mentionedScopes = sourceScopes(text);
  const sourceScopeError = mentionedScopes.length !== 1 || mentionedScopes[0].week !== scope.weeks[0] || (mentionedScopes[0].year && mentionedScopes[0].year !== scope.year)
    ? (mentionedScopes.length ? `원문 범위 ${mentionedScopes.map(item => item.year ? `${item.year}-${item.week}` : item.week).join(', ')}가 선택 범위 ${scope.year}-${scope.weeks[0]}와 정확히 일치하지 않습니다.` : null)
    : null;
  const requests = [];
  const inputLines = lines.length ? lines : [text];
  let currentCustomer = null;
  let customerAmbiguous = false;
  let currentAction = null;
  let currentFamily = null;
  for (let index = 0; index < inputLines.length; index += 1) {
    const line = inputLines[index];
    const action = extractAction(line);
    const quantity = extractQuantity(line);
    const customerCandidates = [
      ...exactMentions(line, facts.customers, ['CustName']),
      ...exactAliasMentions(line, aliases.customers, 'custKey', facts.customers),
    ];
    const lineCustomer = unique(customerCandidates);
    if (customerCandidates.length) {
      currentCustomer = lineCustomer;
      customerAmbiguous = !lineCustomer;
      // A customer header starts a new local action context. Product-family
      // headers remain message-scoped, but a specific product never carries.
      currentAction = null;
    }
    const lineProduct = exactProductInLine(line, facts, aliases);
    if (!quantity.hasQuantity) {
      if (action.action) currentAction = action.action;
      // A bare family header is only combined with a later exact alias suffix.
      if (!lineProduct && !lineCustomer && !action.action && !action.invalid && line.length <= 120) currentFamily = normalizeFamilyHeader(line);
      // Bare headers provide same-message context only; complex numeric lines do not.
      if (!quantity.hasQuantity) continue;
    }
    const product = lineProduct || exactProductFromFamily(currentFamily, line, facts, aliases);
    const effectiveAction = action.action || currentAction;
    if (sourceScopeError || customerAmbiguous || !currentCustomer || !product || action.invalid || (action.missing && !effectiveAction) || quantity.error || !effectiveAction) {
      const reason = sourceScopeError || (customerAmbiguous ? '현재 줄의 업체 별칭이 둘 이상의 전산 업체와 연결됩니다.' : null) || (action.invalid ? action.error : null) || (action.missing && !effectiveAction ? action.error : null) || quantity.error || (!product
        ? '현재 줄의 전산 품목명 또는 저장된 정확 별칭을 하나로 찾지 못했습니다.'
        : !currentCustomer ? '같은 원문 안에서 현재 업체를 하나로 확정할 수 없습니다.' : '추가 또는 취소 동작이 명확하지 않습니다.');
      requests.push(unresolved(identity, line, reason, index));
      continue;
    }
    const converted = convertToOutUnit(quantity.qty, quantity.unit, product);
    if (!converted) {
      requests.push(unresolved(identity, line, 'Product의 명시적인 단위 환산계수가 없어 OutUnit 비교를 하지 않습니다.', index));
      continue;
    }
    const sourceAt = typeof message.created_at === 'string' && validTimestamp(message.created_at) ? message.created_at : null;
    const approximate = message.timestamp_approximate === true;
    requests.push({
      id: `${identity}:${index + 1}`, quote: line, customerText: currentCustomer.CustName, productText: product.ProdName || product.DisplayName,
      custKey: Number(currentCustomer.CustKey), prodKey: Number(product.ProdKey), action: effectiveAction,
      inputQty: quantity.qty, inputUnit: quantity.unit, qty: converted.qty, unit: converted.unit, conversionReason: converted.reason,
      year: scope.year, week: scope.weeks[0], sourceAt, timestamp_approximate: approximate,
      status: sourceAt && !approximate ? 'PENDING' : 'AMBIGUOUS',
      reason: sourceAt ? (approximate ? '원문 시각이 근사값이어서 강한 이력 판정을 하지 않습니다.' : '') : '원문 작성 시각이 없어 날짜만으로 이력 연결하지 않습니다.',
      orderEvents: [], shipmentEvents: [],
    });
  }
  if (!requests.length) {
    const messageAction = extractAction(text);
    const dateOnly = /\b\d{4}-\d{2}-\d{2}\b/.test(text);
    requests.push(unresolved(identity, text, sourceScopeError || (dateOnly
      ? '출고일만 있고 수량·단위·동작이 없어 이력 연결하지 않습니다.'
      : messageAction.error || '명시적인 수량 요청을 찾지 못했습니다.'), 0));
  }
  return { sourceIdentity: identity, requests };
}

function parseMessages(messages, facts, aliases, scope) {
  return (messages || []).map(message => parseOneMessage(message, facts, aliases, scope));
}

function normalizeEvent(row, kind) {
  const before = finiteNumber(row?.before);
  const after = finiteNumber(row?.after);
  const changeAt = row?.changeAt || row?.changeLocal;
  const event = {
    eventId: String(row?.eventId ?? ''), before, after, unit: row?.unit || null,
    changeAt: typeof changeAt === 'string' && changeAt.endsWith('+09:00') ? changeAt : `${changeAt || ''}+09:00`,
    shipmentDate: row?.shipmentDate || null, week: row?.week || null,
    custName: row?.custName || row?.CustName || null, prodName: row?.prodName || row?.ProdName || null,
    year: String(row?.year || ''), custKey: Number(row?.custKey), prodKey: Number(row?.prodKey),
    ...(kind === 'shipment' && Number(row?.shipmentDateCount) > 1 ? { multiDate: true } : {}),
  };
  if (!event.eventId || before === null || after === null || Math.abs(after - before) <= EPSILON || !validTimestamp(event.changeAt)) return null;
  return event;
}

function toFacts({ customers = [], products = [], orderRows = [], shipmentRows = [] }) {
  return {
    customers: customers || [], products: products || [],
    orderEvents: (orderRows || []).map(row => normalizeEvent(row, 'order')).filter(Boolean),
    shipmentEvents: (shipmentRows || []).map(row => normalizeEvent(row, 'shipment')).filter(Boolean),
    queryTruncated: (orderRows || []).length > MAX_FACT_ROWS || (shipmentRows || []).length > MAX_FACT_ROWS,
  };
}

function eventMatches(event, request, scope, isShipment) {
  if (!event || event.year !== scope.year || event.week !== scope.weeks[0]
    || event.custKey !== request.custKey || event.prodKey !== request.prodKey || canonicalUnit(event.unit) !== canonicalUnit(request.unit)) return false;
  if (!validTimestamp(request.sourceAt) || !validTimestamp(event.changeAt) || Date.parse(event.changeAt) < Date.parse(request.sourceAt)) return false;
  if (isShipment && event.multiDate) return false;
  return true;
}

function exactDelta(event, request) {
  const expected = request.action === 'ADD' ? request.qty : -request.qty;
  return Number.isFinite(expected) && Math.abs((event.after - event.before) - expected) <= EPSILON;
}

function publicEvent(event) {
  return {
    eventId: event.eventId, before: event.before, after: event.after, unit: event.unit,
    changeAt: event.changeAt, shipmentDate: event.shipmentDate, week: event.week,
    custName: event.custName, prodName: event.prodName,
    ...(event.multiDate ? { multiDate: true } : {}),
  };
}

function pairRequests(items, facts, scope) {
  const claims = new Map();
  for (const item of items) {
    for (const request of item.requests) {
      if (request.status === 'AMBIGUOUS') continue;
      const orders = facts.orderEvents.filter(event => eventMatches(event, request, scope, false));
      const shipments = facts.shipmentEvents.filter(event => eventMatches(event, request, scope, true));
      request.orderEvents = orders;
      request.shipmentEvents = shipments;
      if (facts.queryTruncated) {
        request.status = 'AMBIGUOUS';
        request.reason = '조회 결과가 제한되어 강한 이력 증거 판정을 하지 않습니다.';
        continue;
      }
      const matchingOrders = orders.filter(event => exactDelta(event, request));
      const matchingShipments = shipments.filter(event => exactDelta(event, request));
      for (const event of [...matchingOrders, ...matchingShipments]) {
        const id = `${matchingOrders.includes(event) ? 'order' : 'shipment'}:${event.eventId}`;
        claims.set(id, [...(claims.get(id) || []), request]);
      }
      if (matchingOrders.length > 1 || matchingShipments.length > 1) {
        request.status = 'AMBIGUOUS'; request.reason = '같은 요청에 경쟁하는 이력 이벤트가 있어 하나를 선택하지 않습니다.';
      } else if (matchingOrders.length === 1 && matchingShipments.length === 1) {
        request.status = 'ORDER_AND_DISTRIBUTION'; request.reason = '동일 변화량의 주문·분배 이력이 각각 있으나 실제 적용을 뜻하지 않습니다.'; request.matchState = 'MATCHING_HISTORY';
      } else if (matchingOrders.length === 1) {
        request.status = 'ORDER_ONLY'; request.reason = '동일 변화량의 주문 이력만 있습니다. 실제 적용을 뜻하지 않습니다.'; request.matchState = 'MATCHING_HISTORY';
      } else if (matchingShipments.length === 1) {
        request.status = 'DISTRIBUTION_EVIDENCE'; request.reason = '동일 변화량의 분배 이력만 있습니다. 실제 적용을 뜻하지 않습니다.'; request.matchState = 'MATCHING_HISTORY';
      } else if (orders.length || shipments.length) {
        request.status = 'AMBIGUOUS'; request.reason = '동일 키 이력의 변화량이 요청과 정확히 일치하지 않습니다.';
      } else {
        request.status = 'NO_LIVE_EVIDENCE'; request.reason = '반환된 조회 범위에서 대응 이력을 찾지 못했습니다. 미처리나 삭제의 증거는 아닙니다.';
      }
    }
  }
  for (const [eventId, requests] of claims) {
    if (requests.length < 2) continue;
    for (const request of requests) {
      request.status = 'AMBIGUOUS'; request.reason = `이력 이벤트 ${eventId}가 둘 이상의 원문 요청과 경쟁합니다.`; delete request.matchState;
    }
  }
  for (const item of items) {
    const statuses = item.requests.map(request => request.status);
    item.status = !statuses.length || statuses.includes('AMBIGUOUS') || new Set(statuses).size > 1
      ? 'AMBIGUOUS' : statuses[0];
    item.reason = item.requests.map(request => request.reason).filter(Boolean).join(' ');
    for (const request of item.requests) {
      request.orderEvents = request.orderEvents.map(publicEvent);
      request.shipmentEvents = request.shipmentEvents.map(publicEvent);
    }
  }
  return items;
}

async function loadLiveHistoryFacts(query, sql, scope) {
  const params = {
    year: { type: sql.NVarChar, value: scope.year }, week: { type: sql.NVarChar, value: scope.weeks[0] },
    from: { type: sql.NVarChar, value: scope.from }, to: { type: sql.NVarChar, value: scope.to },
  };
  const [customers, products, orders, shipments] = await Promise.all([
    query('SELECT CustKey,CustName FROM Customer WHERE ISNULL(isDeleted,0)=0'),
    query('SELECT ProdKey,ProdName,DisplayName,OutUnit,BunchOf1Box,SteamOf1Box FROM Product WHERE ISNULL(isDeleted,0)=0'),
    query(`SELECT TOP 1001 h.OrderHistoryKey AS eventId,om.OrderYear AS year,om.OrderWeek AS week,om.CustKey AS custKey,od.ProdKey AS prodKey,c.CustName AS custName,p.ProdName AS prodName,p.OutUnit AS unit,numbers.beforeValue AS before,numbers.afterValue AS after,CONVERT(varchar(23),h.ChangeDtm,126) AS changeLocal
      FROM OrderHistory h JOIN OrderDetail od ON od.OrderDetailKey=h.OrderDetailKey JOIN OrderMaster om ON om.OrderMasterKey=od.OrderMasterKey JOIN Customer c ON c.CustKey=om.CustKey JOIN Product p ON p.ProdKey=od.ProdKey
      CROSS APPLY (SELECT TRY_CONVERT(decimal(28,6),NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(100),h.BeforeValue))),N'')) AS beforeValue,TRY_CONVERT(decimal(28,6),NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(100),h.AfterValue))),N'')) AS afterValue) numbers
      WHERE ISNULL(od.isDeleted,0)=0 AND ISNULL(om.isDeleted,0)=0 AND ISNULL(c.isDeleted,0)=0 AND ISNULL(p.isDeleted,0)=0 AND om.OrderYear=@year AND om.OrderWeek=@week AND h.ChangeDtm>=CONVERT(datetime,@from,126) AND h.ChangeDtm<DATEADD(day,1,CONVERT(datetime,@to,126)) AND h.ColumName=N'주문수량' AND numbers.beforeValue IS NOT NULL AND numbers.afterValue IS NOT NULL AND numbers.beforeValue<>numbers.afterValue AND (numbers.beforeValue<>0 OR numbers.afterValue<>0)
      ORDER BY h.ChangeDtm,h.OrderHistoryKey`, params),
    query(`SELECT TOP 1001 h.ShipHistoryKey AS eventId,sm.OrderYear AS year,sm.OrderWeek AS week,sm.CustKey AS custKey,sd.ProdKey AS prodKey,c.CustName AS custName,p.ProdName AS prodName,p.OutUnit AS unit,numbers.beforeValue AS before,numbers.afterValue AS after,CONVERT(varchar(23),h.ChangeDtm,126) AS changeLocal,CONVERT(varchar(10),h.ShipmentDtm,23) AS shipmentDate,dates.shipmentDateCount
      FROM ShipmentHistory h JOIN ShipmentDetail sd ON sd.SdetailKey=h.SdetailKey JOIN ShipmentMaster sm ON sm.ShipmentKey=sd.ShipmentKey JOIN Customer c ON c.CustKey=sm.CustKey JOIN Product p ON p.ProdKey=sd.ProdKey
      OUTER APPLY (SELECT COUNT(DISTINCT CONVERT(varchar(10),d.ShipmentDtm,23)) AS shipmentDateCount FROM ShipmentDate d WHERE d.SdetailKey=sd.SdetailKey) dates
      CROSS APPLY (SELECT TRY_CONVERT(decimal(28,6),NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(100),h.BeforeValue))),N'')) AS beforeValue,TRY_CONVERT(decimal(28,6),NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(100),h.AfterValue))),N'')) AS afterValue) numbers
      WHERE ISNULL(sm.isDeleted,0)=0 AND ISNULL(c.isDeleted,0)=0 AND ISNULL(p.isDeleted,0)=0 AND sm.OrderYear=@year AND sm.OrderWeek=@week AND h.ChangeDtm>=CONVERT(datetime,@from,126) AND h.ChangeDtm<DATEADD(day,1,CONVERT(datetime,@to,126)) AND numbers.beforeValue IS NOT NULL AND numbers.afterValue IS NOT NULL AND numbers.beforeValue<>numbers.afterValue
      ORDER BY h.ChangeDtm,h.ShipHistoryKey`, params),
  ]);
  return toFacts({ customers: customers.recordset, products: products.recordset, orderRows: orders.recordset, shipmentRows: shipments.recordset });
}

module.exports = { MAX_FACT_ROWS, normalizeScope, parseMessages, pairRequests, toFacts, loadLiveHistoryFacts, canonicalUnit, finiteNumber };
