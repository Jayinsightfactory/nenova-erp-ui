import { parsePrintedDate } from './importAwbFields.js';

const DATE_ORDERS = new Set(['YMD', 'DMY', 'MDY']);
const DATE_KINDS = new Map([
  ['invoice', 'invoice'],
  ['invoice_date', 'invoice'],
  ['shipment', 'shipment'],
  ['shipment_date', 'shipment'],
  ['shipping', 'shipment'],
  ['arrival', 'arrival'],
  ['arrival_date', 'arrival'],
  ['flight', 'shipment'],
]);

export const PACKING_DATE_KIND_CONTRACT = Object.freeze({
  CO: 'invoice',
  NL: 'arrival',
  CN: 'invoice',
  EC: 'shipment',
  TH: 'shipment',
  AU: 'invoice',
  US: 'invoice',
  VN: 'invoice',
});

const issue = (code, field, message, details = {}) => ({
  code,
  field,
  severity: 'review_required',
  message,
  ...details,
});

const textOrNull = value => typeof value === 'string' && value.trim() ? value.trim() : null;

export function normalizeCurrency(value) {
  const candidate = typeof value === 'string'
    ? value
    : value && typeof value === 'object' && !Array.isArray(value)
      ? value.code
      : null;
  const text = textOrNull(candidate);
  return text && /^[A-Za-z]{3}$/.test(text) ? text.toUpperCase() : null;
}

export const normalizePackingCurrency = normalizeCurrency;

export function normalizeDateOrder(value) {
  const text = textOrNull(value)?.toUpperCase().replaceAll('-', '').replaceAll('/', '');
  return text && DATE_ORDERS.has(text) ? text : null;
}

export function normalizeDateKind(value) {
  const text = textOrNull(value)?.toLowerCase().replace(/[\s-]+/g, '_');
  return text ? DATE_KINDS.get(text) ?? null : null;
}

function validCalendarDate(year, month, day) {
  if (!Number.isInteger(year) || year < 1000 || year > 9999
    || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

const canonicalDate = (year, month, day) => `${String(year).padStart(4, '0')}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;

function sourceYearEvidence(metadata) {
  const quotes = [metadata?.date_year_evidence?.quote, metadata?.metadata_evidence?.date?.quote]
    .filter(value => typeof value === 'string');
  const candidates = [
    metadata?.date_year,
    metadata?.date_year_evidence,
    metadata?.date_year_evidence?.year,
    metadata?.metadata_evidence?.date?.year,
    metadata?.metadata_evidence?.date?.four_digit_year,
  ];
  for (const candidate of candidates) {
    const text = String(candidate ?? '').trim();
    if (/^\d{4}$/.test(text) && quotes.some(quote => new RegExp(`(^|[^0-9])${text}([^0-9]|$)`).test(quote))) {
      return Number(text);
    }
  }
  return null;
}

function parseNumericDate(rawDate, { dateOrder = null, fourDigitYear = null } = {}) {
  const raw = textOrNull(rawDate);
  if (!raw) return { value: null, reason: 'SOURCE_UNAVAILABLE' };
  const namedMonth = raw.match(/^(\d{1,2})([-\s])([A-Za-z]+)([-\s])(\d{2}|\d{4})$/);
  if (namedMonth) {
    if (namedMonth[5].length !== 4) return { value: null, reason: 'YEAR_AMBIGUOUS' };
    const order = normalizeDateOrder(dateOrder);
    if (order && order !== 'DMY') return { value: null, reason: 'ORDER_CONFLICT' };
    const value = parsePrintedDate(raw);
    return value ? { value, reason: null, order: 'DMY' } : { value: null, reason: 'INVALID_CALENDAR' };
  }
  const match = raw.match(/^(\d{1,4})\s*([./-])\s*(\d{1,2})(?:\s*\2\s*(\d{1,4}))?$/);
  if (!match) return { value: null, reason: 'UNSUPPORTED_FORMAT' };
  const tokens = match[4] == null ? [match[1], match[3]] : [match[1], match[3], match[4]];
  const numbers = tokens.map(Number);
  let order = normalizeDateOrder(dateOrder);

  if (tokens.length === 2) {
    if (!Number.isInteger(fourDigitYear) || fourDigitYear < 1000 || fourDigitYear > 9999) {
      return { value: null, reason: 'YEAR_AMBIGUOUS' };
    }
    if (order === 'YMD') return { value: null, reason: 'ORDER_CONFLICT' };
    if (!order) {
      if (numbers[0] > 12 && numbers[1] <= 12) order = 'DMY';
      else if (numbers[1] > 12 && numbers[0] <= 12) order = 'MDY';
      else return { value: null, reason: 'ORDER_AMBIGUOUS' };
    }
    const month = order === 'DMY' ? numbers[1] : numbers[0];
    const day = order === 'DMY' ? numbers[0] : numbers[1];
    if (!validCalendarDate(fourDigitYear, month, day)) return { value: null, reason: 'INVALID_CALENDAR' };
    return { value: canonicalDate(fourDigitYear, month, day), reason: null, order };
  }

  if (tokens[0].length === 4) {
    if (order && order !== 'YMD') return { value: null, reason: 'ORDER_CONFLICT' };
    order = 'YMD';
  } else if (tokens[2].length === 4) {
    if (order === 'YMD') return { value: null, reason: 'ORDER_CONFLICT' };
    if (!order) {
      if (numbers[0] > 12 && numbers[1] <= 12) order = 'DMY';
      else if (numbers[1] > 12 && numbers[0] <= 12) order = 'MDY';
      else return { value: null, reason: 'ORDER_AMBIGUOUS' };
    }
  } else {
    if (!order) return { value: null, reason: 'ORDER_AMBIGUOUS' };
    if (!Number.isInteger(fourDigitYear) || fourDigitYear < 1000 || fourDigitYear > 9999) {
      return { value: null, reason: 'YEAR_AMBIGUOUS' };
    }
    if (tokens[2].length === 2 && fourDigitYear % 100 !== numbers[2]) {
      return { value: null, reason: 'YEAR_CONFLICT' };
    }
  }

  const positions = Object.fromEntries(order.split('').map((part, index) => [part, numbers[index]]));
  const year = tokens[order.indexOf('Y')].length === 4 ? positions.Y : fourDigitYear;
  if (!validCalendarDate(year, positions.M, positions.D)) return { value: null, reason: 'INVALID_CALENDAR' };
  return { value: canonicalDate(year, positions.M, positions.D), reason: null, order };
}

export function normalizePackingDate(rawDate, options = {}) {
  const fourDigitYear = options.fourDigitYear ?? options.fourDigitYearEvidence ?? options.yearEvidence ?? options.sourceYear ?? null;
  return parseNumericDate(rawDate, { ...options, fourDigitYear }).value;
}

export const normalizeNumericDate = normalizePackingDate;

function dateIssue(parsed, rawDate) {
  const details = { rawValue: rawDate ?? null };
  switch (parsed.reason) {
    case 'SOURCE_UNAVAILABLE': return issue('DATE_SOURCE_UNAVAILABLE', 'raw_date', '인쇄된 날짜 원문을 확인해야 합니다.', details);
    case 'ORDER_AMBIGUOUS': return issue('DATE_ORDER_AMBIGUOUS', 'date_order', '숫자 날짜의 월/일 순서를 원문에서 확인해야 합니다.', details);
    case 'YEAR_AMBIGUOUS': return issue('DATE_YEAR_AMBIGUOUS', 'raw_date', '2자리 연도는 원문의 4자리 연도 근거 없이 세기를 추정할 수 없습니다.', details);
    case 'YEAR_CONFLICT': return issue('DATE_YEAR_CONFLICT', 'raw_date', '2자리 연도와 4자리 연도 근거가 서로 다릅니다.', details);
    case 'ORDER_CONFLICT': return issue('DATE_ORDER_CONFLICT', 'date_order', '날짜 배열과 선언된 날짜 순서가 서로 다릅니다.', details);
    case 'INVALID_CALENDAR': return issue('DATE_INVALID_CALENDAR', 'raw_date', '존재하지 않는 달력 날짜입니다.', details);
    default: return issue('DATE_FORMAT_UNSUPPORTED', 'raw_date', '날짜 원문을 안전하게 정규화할 수 없습니다.', details);
  }
}

function strictFinite(value) {
  if (typeof value === 'boolean' || value == null || (typeof value === 'string' && !value.trim())) return null;
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function declaredGrandTotal(invoice) {
  if (Object.prototype.hasOwnProperty.call(invoice, 'invoice_total')) {
    const total = strictFinite(invoice.invoice_total);
    if (total !== null) return total;
  }
  if (Object.prototype.hasOwnProperty.call(invoice, 'total_value')) return strictFinite(invoice.total_value);
  return null;
}

function productAmount(invoice, country) {
  const rows = country === 'NL' ? invoice.lines : invoice.products;
  if (!Array.isArray(rows) || !rows.length) return null;
  let total = 0;
  for (const row of rows) {
    let amount = strictFinite(row?.t_price);
    if (amount === null && country === 'NL') {
      const stems = strictFinite(row?.stems);
      const price = strictFinite(row?.price);
      if (stems !== null && price !== null) amount = stems * price;
    }
    if (amount === null) return null;
    total += amount;
  }
  return total;
}

function expectedGrandTotal(invoice, country) {
  const goods = productAmount(invoice, country);
  if (goods === null) return null;
  let extras = 0;
  if (country === 'CO') extras = strictFinite(invoice.freight_total);
  else if (country === 'CN') extras = strictFinite(invoice.freight);
  else if (country === 'NL') {
    const freight = strictFinite(invoice.freight);
    const handling = strictFinite(invoice.handling);
    extras = freight === null || handling === null ? null : freight + handling;
  }
  return extras === null ? null : goods + extras;
}

function requiredExtrasMissing(invoice, country) {
  if (country === 'CO') return strictFinite(invoice.freight_total) === null;
  return false;
}

function amountComponentsMissing(invoice, country) {
  if (productAmount(invoice, country) === null) return true;
  if (country === 'CN') return strictFinite(invoice.freight) === null;
  if (country === 'NL') return strictFinite(invoice.freight) === null || strictFinite(invoice.handling) === null;
  return false;
}

function appendUniqueIssues(existing, additions) {
  const output = Array.isArray(existing) ? existing.map(item => ({ ...item })) : [];
  const seen = new Set(output.map(item => `${item?.code ?? ''}|${item?.field ?? ''}`));
  for (const addition of additions) {
    const key = `${addition.code}|${addition.field}`;
    if (!seen.has(key)) {
      output.push(addition);
      seen.add(key);
    }
  }
  return output;
}

export function normalizePackingMetadata(invoice, country = null) {
  const source = invoice && typeof invoice === 'object' && !Array.isArray(invoice) ? invoice : {};
  const output = { ...source };
  const issues = [];
  const rawDate = textOrNull(source.raw_date);
  const dateOrder = normalizeDateOrder(source.date_order);
  const dateKind = normalizeDateKind(source.date_kind);
  const parsedRaw = parseNumericDate(rawDate, {
    dateOrder,
    fourDigitYear: sourceYearEvidence(source),
  });

  output.raw_date = rawDate;
  output.date_order = dateOrder;
  output.date_kind = dateKind;

  if (!dateKind) issues.push(issue('DATE_KIND_UNAVAILABLE', 'date_kind', '날짜가 인보이스일인지 출고일인지 확인해야 합니다.'));
  const requiredDateKind = PACKING_DATE_KIND_CONTRACT[country] ?? null;
  if (dateKind && requiredDateKind && dateKind !== requiredDateKind) {
    issues.push(issue('DATE_KIND_CONTRACT_MISMATCH', 'date_kind', '국가별 날짜 기준과 추출된 날짜 종류가 다릅니다.', {
      expectedValue: requiredDateKind,
      extractedValue: dateKind,
    }));
  }
  if (parsedRaw.value) {
    const parsedAi = parseNumericDate(source.date, { dateOrder: 'YMD' });
    if (source.date == null || !textOrNull(String(source.date))) output.date = parsedRaw.value;
    else if (parsedAi.value === parsedRaw.value) output.date = parsedRaw.value;
    else issues.push(issue('DATE_CONFLICT', 'date', '정규화된 날짜와 인쇄 원문 날짜가 서로 다릅니다.', {
      rawValue: rawDate,
      extractedValue: source.date,
      normalizedRawValue: parsedRaw.value,
    }));
  } else {
    issues.push(dateIssue(parsedRaw, rawDate));
  }

  output.currency = normalizeCurrency(source.currency);
  if (!output.currency) issues.push(issue('CURRENCY_UNAVAILABLE', 'currency', '원문에 명시된 ISO 3문자 통화를 확인해야 합니다.'));

  const grandTotal = declaredGrandTotal(source);
  if (requiredExtrasMissing(source, country)) {
    issues.push(issue('INVOICE_EXTRAS_UNAVAILABLE', 'freight_total', '콜롬비아 상품 외 부대비가 미확인이라 최종 송장 총액을 검증할 수 없습니다.'));
  }
  if (grandTotal === null) {
    issues.push(issue('INVOICE_TOTAL_UNAVAILABLE', 'invoice_total', '원문에 인쇄된 최종 송장 총액을 확인해야 합니다.'));
  } else {
    const expected = expectedGrandTotal(source, country);
    if (amountComponentsMissing(source, country)) {
      issues.push(issue('AMOUNT_COMPONENTS_UNAVAILABLE', 'invoice_total', '상품 금액 또는 명시 부대비가 미확인이라 최종 송장 총액을 대조할 수 없습니다.', {
        extractedValue: grandTotal,
      }));
    } else if (expected !== null && Math.abs(expected - grandTotal) > 0.01) {
      issues.push(issue('INVOICE_TOTAL_MISMATCH', 'invoice_total', '상품 금액과 명시 부대비의 합계가 인쇄된 최종 송장 총액과 다릅니다.', {
        expected,
        extractedValue: grandTotal,
      }));
    }
  }

  output.extractionIssues = appendUniqueIssues(source.extractionIssues, issues);
  return output;
}

export const normalizeInvoiceMetadata = normalizePackingMetadata;
