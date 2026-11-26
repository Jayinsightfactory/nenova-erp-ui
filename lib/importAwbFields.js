// Pure, browser-safe extraction. No PDF loading, I/O, clocks or default dates.
export function positionedRows(items = [], tolerance = 1.5) {
  const rows = [];
  if (!Array.isArray(items)) return rows;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const str = String(item.str ?? '').trim();
    const x = item.x ?? item.transform?.[4];
    const y = item.y ?? item.transform?.[5];
    if (!str || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    let row = rows.find(r => Math.abs(r.y - y) <= tolerance);
    if (!row) rows.push(row = { y, items: [] });
    row.items.push({ str, x, y, width: Number(item.width) || 0 });
  }
  return rows.sort((a, b) => b.y - a.y).map(row => {
    row.items.sort((a, b) => a.x - b.x);
    return { ...row, text: row.items.map(i => i.str).join(' ') };
  });
}

const MONTHS = {
  jan: 1, january: 1, januari: 1, feb: 2, february: 2, februari: 2,
  mar: 3, march: 3, maart: 3, apr: 4, april: 4, may: 5, mei: 5,
  jun: 6, june: 6, juni: 6, jul: 7, july: 7, juli: 7,
  aug: 8, august: 8, augustus: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, oktober: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

export function parsePrintedDate(value) {
  const s = String(value ?? '').trim();
  let m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  let year, month, day;
  if (m) [, year, month, day] = m.map(Number);
  else {
    m = s.match(/^(\d{1,2})[-\s]([a-z]+)[-\s](\d{2}|\d{4})$/i);
    if (!m) return null;
    day = Number(m[1]); month = MONTHS[m[2].toLowerCase()]; year = Number(m[3]);
    // Printed AWB two-digit years use the explicit 2000-2099 convention.
    if (m[3].length === 2) year += 2000;
  }
  if (!month || year < 1900 || year > 2099 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
}

// AWBs use both 12,320.40 and 12.320,40. Never erase a decimal comma.
export function parseAwbNumber(value) {
  const s = String(value ?? '').trim();
  if (!s || !/^\d[\d.,]*$/.test(s)) return null;
  let normalized;
  if (s.includes('.') && s.includes(',')) {
    const decimal = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const grouping = decimal === '.' ? ',' : '.';
    const parts = s.split(decimal);
    if (parts.length !== 2 || !/^\d{1,2}$/.test(parts[1])
      || !new RegExp(`^[1-9]\\d{0,2}(?:\\${grouping}\\d{3})+$`).test(parts[0])) return null;
    normalized = parts[0].split(grouping).join('') + '.' + parts[1];
  } else if (/[.,]/.test(s)) {
    const separator = s.includes(',') ? ',' : '.';
    const parts = s.split(separator);
    if (parts.length === 2 && /^\d{1,2}$/.test(parts[1])) normalized = parts.join('.');
    else if (new RegExp(`^[1-9]\\d{0,2}(?:\\${separator}\\d{3})+$`).test(s)) normalized = parts.join('');
    else return null;
  } else normalized = s;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}
const MONEY = '(?:(?:\\d{1,3}(?:,\\d{3})+|\\d+)\\.\\d{2}|(?:\\d{1,3}(?:\\.\\d{3})+|\\d+),\\d{2})';
const moneyValue = parseAwbNumber;

function labeledTotal(text, pages) {
  const candidates = [];
  const direct = new RegExp(`\\bTotal\\s+(Prepaid|Collect)\\s+(?:USD\\s*)?(${MONEY})(?![\\d.,])`, 'gi');
  for (const m of text.matchAll(direct)) {
    // Flattened side-by-side captions do not bind the next value to collect.
    if (/\bTotal\s+(?:Prepaid|Collect)\s*$/i.test(text.slice(0, m.index))) continue;
    candidates.push({ kind: m[1].toLowerCase(), value: moneyValue(m[2]) });
  }
  for (const page of pages) {
    const rows = positionedRows(page.items);
    for (const row of rows) {
      const labels = row.items.filter(i => /^Total\s+(?:Prepaid|Collect)$/i.test(i.str));
      for (const label of labels) {
        const center = label.x + label.width / 2;
        const peers = labels.filter(i => i !== label).map(i => i.x + i.width / 2);
        const left = Math.max(center - 80, ...peers.filter(x => x < center).map(x => (x + center) / 2));
        const right = Math.min(center + 80, ...peers.filter(x => x > center).map(x => (x + center) / 2));
        // Printed form cell ends at the next horizontal caption, not arbitrary money.
        const stop = rows.find(r => r.y < row.y - 2 && r.items.some(i =>
          i.x >= left && i.x < right && /Currency Conversion|Charges in Dest|Charges at Destination/i.test(i.str)));
        const bottom = Math.max(row.y - 25, stop?.y ?? -Infinity);
        const values = rows.filter(r => r.y < row.y - 2 && r.y > bottom).flatMap(r => r.items)
          .filter(i => {
            const cx = i.x + i.width / 2;
            return cx >= left && cx < right && new RegExp(`^${MONEY}$`).test(i.str);
          });
        if (values.length === 1) candidates.push({ kind: /Prepaid/i.test(label.str) ? 'prepaid' : 'collect', value: moneyValue(values[0].str) });
        else if (values.length > 1) return undefined;
      }
    }
  }
  const valid = candidates.filter(c => c.value !== null && c.value >= 0 && c.value < 1e7);
  const positive = valid.filter(c => c.value > 0);
  if (!positive.length) return valid.length ? 0 : undefined;
  if (new Set(positive.map(c => c.kind)).size > 1) return undefined;
  const distinct = [...new Set(positive.map(c => c.value))];
  // Nonzero prepaid AND collect values are ambiguous: do not select the largest.
  return distinct.length === 1 ? distinct[0] : undefined;
}

export function parseAwbFields(input = {}) {
  if (!input || typeof input !== 'object') input = {};
  const pages = Array.isArray(input.pages) && input.pages.length ? input.pages : [input];
  if (pages.some(p => !p || typeof p !== 'object')) return { _error: 'Datos PDF locales no válidos. Rellena los campos manualmente.' };
  const text = String(input.text || pages.map(p => p.text || p.items?.map(i => i.str).join(' ') || '').join('\n'));
  if (text.trim().length < 30) return { _error: 'El PDF parece ser una imagen escaneada (sin texto). Rellena los campos manualmente.' };
  const out = {};
  let m = text.match(/\b(\d{3})\s+([A-Z]{3})\s*(\d{8})\b/);
  if (m) out.awb = `${m[1]}-${m[3]}`;
  else {
    m = text.match(/\b(\d{3})[-\s]+(\d{4})[-\s]+(\d{4})\b/);
    if (m) out.awb = `${m[1]}-${m[2]}${m[3]}`;
    else {
      m = text.match(/\b(\d{3})[-\s]?(\d{8})\b/);
      if (m) out.awb = `${m[1]}-${m[2]}`;
    }
  }
  if (/APOLLO\s+FREIGHT/i.test(text)) out.company = 'Apollo';
  else if (/\bFREIGHTWISE\s+ECUADOR\b/i.test(text)) out.company = 'Freightwise Ecuador';
  else if (/\bEXCEL\s*TRANSPORT\b/i.test(text)) out.company = 'EXCEL';
  else if (/\bFREIGHTWISE\b/i.test(text)) out.company = 'FREIGHTWISE';
  else if (/LA\s*ROSALEDA/i.test(text) && /ECUADOR/i.test(text)) out.company = 'Freightwise Ecuador';
  weights: for (const page of pages) {
    const rows = positionedRows(page.items, 2), items = rows.flatMap(r => r.items);
    const gross = items.find(i => /^Gross(?: Weight)?$/i.test(i.str));
    const chargeable = items.find(i => /^Chargeable(?: Weight)?$/i.test(i.str));
    const rateHeader = items.find(i => /^Rate$/i.test(i.str) && chargeable && Math.abs(i.y-chargeable.y)<8 && i.x>chargeable.x);
    for (const row of rows) {
      const nums = row.items.filter(i => parseAwbNumber(i.str) !== null);
      if (gross && chargeable && rateHeader) {
        if (row.y >= Math.min(gross.y,chargeable.y)-8 || row.y < chargeable.y-75) continue;
        const pick = (left,right) => {const found=nums.filter(i=>i.x>=left && i.x<right);return found.length===1?parseAwbNumber(found[0].str):null;};
        const gw=pick(gross.x-5,Math.min(gross.x+45,chargeable.x)), cw=pick(chargeable.x-5,rateHeader.x), rate=pick(rateHeader.x-5,rateHeader.x+90);
        if (gw>=50 && cw>=gw && cw<=100000 && rate>=0.5 && rate<=50) {Object.assign(out,{gw,cw,uPrice1:rate});break weights;}
        continue;
      }
      for (let i = 0; i + 2 < nums.length; i++) {
        const [gw, cw, rate] = nums.slice(i, i + 3).map(n => parseAwbNumber(n.str));
        if (gw >= 50 && gw <= 100000 && cw >= gw && cw <= 100000 && rate >= 0.5 && rate <= 50 && /[.,]\d{1,2}$/.test(nums[i + 2].str)) {
          Object.assign(out, { gw, cw, uPrice1: rate }); break weights;
        }
      }
    }
  }
  const total = labeledTotal(text, pages);
  if (total !== undefined) out.total = total;
  // Only execution dates; flight dates and unrelated invoice dates are not defaults.
  const dates = [];
  for (const page of pages) {
    const rows = positionedRows(page.items);
    for (const row of rows) for (const label of row.items.filter(i => /^Executed on\s*\(date\)/i.test(i.str))) {
      for (const above of rows.filter(r => r.y > row.y && r.y - row.y <= 25)) {
        for (const item of above.items.filter(i => Math.abs(i.x - label.x) <= 40)) {
          const date = parsePrintedDate(item.str); if (date) dates.push(date);
        }
      }
    }
  }
  if (!dates.length) {
    const re = /Executed on\s*\(date\)\s*[:\-]?\s*(\d{1,2}[-\s][A-Za-z]+[-\s](?:\d{4}|\d{2})|\d{4}[/-]\d{1,2}[/-]\d{1,2})\b/gi;
    for (const match of text.matchAll(re)) { const date = parsePrintedDate(match[1]); if (date) dates.push(date); }
  }
  const distinctDates = [...new Set(dates)];
  if (distinctDates.length === 1) out.date = distinctDates[0];
  return out;
}

/**
 * Detect whether a locally parsed PDF is a standalone Air Waybill (not a commercial invoice)
 * so dropping an AWB PDF into the invoice dropzone can auto-route or guide the user safely.
 */
export function isAirWaybillDocument(input = {}) {
  const pages = Array.isArray(input?.pages) && input.pages.length ? input.pages : [input || {}];
  const text = String(input?.text || pages.map(p => p?.text || p?.items?.map(i => i.str).join(' ') || '').join('\n'));
  if (text.trim().length < 30) return false;
  const hasAwbSignals = /Air\s*Waybill|Shipper'?s\s+Name\s+and\s+Address|Issuing\s+Carrier'?s\s+Agent|Total\s+Prepaid/i.test(text);
  const hasInvoiceTable = /\bCOMMERCIAL\s+INVOICE\b|\bINVOICE\s*#|FACTURA\s+ELECTR[ÓO]NICA|\bUNIT\s+PRICE\b.*\bTOTAL\s+PRICE\b/i.test(text);
  const parsed = parseAwbFields(input);
  return Boolean(hasAwbSignals && !hasInvoiceTable && parsed.awb && !parsed._error);
}

/**
 * Local zero-cost extraction of structured AWB metadata + source quotes for EC/AU invoice pairing.
 * Uses only explicitly printed labels/values; returns null fields when absent or ambiguous.
 */
export function parseSupportAwbDocument(input = {}, { currency = 'USD' } = {}) {
  const pages = Array.isArray(input?.pages) && input.pages.length ? input.pages : [input || {}];
  const text = String(input?.text || pages.map(p => p?.text || p?.items?.map(i => i.str).join(' ') || '').join('\n'));
  const fields = parseAwbFields(input);
  if (fields._error) return { _error: fields._error };

  const piecesMatch = text.match(/TOTAL\s+PIECES\s*[:\-]?\s*(\d+(?:\.\d+)?)/i)
    || text.match(/Total\s+No\.?\s+of\s+Pieces\s*[:\-]?\s*(\d+)/i);
  let packages = null;
  let packagesQuote = '';
  if (piecesMatch) {
    const n = Number(piecesMatch[1]);
    if (Number.isInteger(n) && n > 0 && n <= 100000) {
      packages = n;
      packagesQuote = piecesMatch[0].trim();
    }
  } else if (fields.gw != null) {
    // Fallback to the weight line: "<pieces> <gw> K Q <cw> <rate>"
    const lineMatch = text.match(new RegExp(`\\b(\\d{1,5})\\s+${String(fields.gw).replace('.', '\\.')}\\s*K\\b`));
    if (lineMatch) {
      const n = Number(lineMatch[1]);
      if (Number.isInteger(n) && n > 0 && n <= 100000) {
        packages = n;
        packagesQuote = `Pieces ${lineMatch[1]}`;
      }
    }
  }

  const pmtMatch = text.match(/\b(?:PMT|DAE)\s*[:\-]?\s*([A-Z0-9-]{8,30})/i);
  const daePmt = pmtMatch ? pmtMatch[1].trim() : '';

  const dueAgentMatch = text.match(/Total\s+Other\s+Charges\s+Due\s+Agent[\s\S]{0,160}?\b(\d+(?:,\d{3})*\.\d{2})\b/i);
  const dueCarrierMatch = text.match(/Total\s+Other\s+Charges\s+Due\s+Carrier[\s\S]{0,120}?\b(\d+(?:,\d{3})*\.\d{2})\b/i);
  let otherCharges = null;
  if (fields.total != null && fields.cw != null && fields.uPrice1 != null) {
    const weightCharge = Math.round(fields.cw * fields.uPrice1 * 100) / 100;
    const diff = Math.round((fields.total - weightCharge) * 100) / 100;
    if (diff >= 0 && diff < fields.total) otherCharges = diff;
  } else if (dueAgentMatch || dueCarrierMatch) {
    const a = dueAgentMatch ? parseAwbNumber(dueAgentMatch[1]) || 0 : 0;
    const c = dueCarrierMatch ? parseAwbNumber(dueCarrierMatch[1]) || 0 : 0;
    if (a + c > 0) otherCharges = Math.round((a + c) * 100) / 100;
  }

  const curMatch = text.match(/\b(USD|AUD|EUR)\b/);
  const detectedCurrency = curMatch ? curMatch[1].toUpperCase() : currency;

  return {
    awb: fields.awb || '',
    invoice_awb: null,
    packages,
    gross_weight_kg: fields.gw ?? null,
    chargeable_weight_kg: fields.cw ?? null,
    freight_rate: fields.uPrice1 ?? null,
    other_charges: otherCharges,
    total_prepaid: fields.total ?? null,
    executed_date: fields.date || '',
    company: fields.company || '',
    dae_pmt: daePmt,
    currency: detectedCurrency,
    evidence: {
      awb: fields.awb ? { page: 1, quote: `Air Waybill ${fields.awb}` } : { page: null, quote: '' },
      packages: packages != null ? { page: 1, quote: packagesQuote || `TOTAL PIECES: ${packages}` } : { page: null, quote: '' },
      gross_weight_kg: fields.gw != null ? { page: 1, quote: `Gross Weight ${fields.gw} kg` } : { page: null, quote: '' },
      chargeable_weight_kg: fields.cw != null ? { page: 1, quote: `Chargeable Weight ${fields.cw} kg` } : { page: null, quote: '' },
    },
  };
}
