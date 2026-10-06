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

const MONEY = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)\\.\\d{2}';
const moneyValue = s => Number(s.replace(/,/g, ''));

function labeledTotal(text, pages) {
  const candidates = [];
  const direct = new RegExp(`\\bTotal\\s+(Prepaid|Collect)\\s+(?:USD\\s*)?(${MONEY})(?![\\d.])`, 'gi');
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
  const valid = candidates.filter(c => c.value >= 0 && c.value < 1e7);
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
    for (const row of positionedRows(page.items, 2)) {
      const nums = row.items.filter(i => /^[\d,]+(\.\d+)?$/.test(i.str));
      for (let i = 0; i + 2 < nums.length; i++) {
        const [gw, cw, rate] = nums.slice(i, i + 3).map(n => Number(n.str.replace(/,/g, '')));
        if (gw >= 50 && gw <= 100000 && cw >= 50 && cw <= 100000 && rate >= 0.5 && rate <= 50 && /\./.test(nums[i + 2].str)) {
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
