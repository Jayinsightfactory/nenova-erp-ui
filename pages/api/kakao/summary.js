import { withAuth } from '../../../lib/auth';
import { getKakaoSheetId, readSheetValues } from '../../../lib/googleSheets';

const BUSINESS_EVENT_RANGE = '비즈니스이벤트!A:P';

function normText(value) {
  return String(value || '').trim();
}

function normWeek(value) {
  const raw = normText(value);
  const m = raw.match(/(\d{1,2})\s*(?:-|차\s*)?(\d{1,2})?/);
  if (!m) return raw;
  const major = m[1].padStart(2, '0');
  const minor = (m[2] || '').padStart(2, '0');
  return minor ? `${major}-${minor}` : major;
}

function parseQty(value) {
  const n = Number(String(value || '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)?.[0] || 0);
  return Number.isFinite(n) ? n : 0;
}

function rowToEvent(row) {
  return {
    eventId: normText(row[0]),
    time: normText(row[1]),
    eventType: normText(row[2]),
    week: normText(row[3]),
    product: normText(row[4]),
    variety: normText(row[5]),
    quantity: parseQty(row[6]),
    unit: normText(row[7]) || '개',
    direction: normText(row[8]),
    supplier: normText(row[9]),
    room: normText(row[10]),
    pipeline: normText(row[11]),
    sender: normText(row[12]),
    summary: normText(row[13]),
    threadId: normText(row[14]),
    messageId: normText(row[15]),
  };
}

function displayProductName(event) {
  return [event.product, event.variety].filter(Boolean).join(' / ') || '품목 미분류';
}

function passesFilter(event, query) {
  const week = normText(query.week);
  const room = normText(query.room);
  const product = normText(query.product);
  const supplier = normText(query.supplier);
  const direction = normText(query.direction || '+');
  const eventType = normText(query.eventType || '');

  if (!event.product || !event.quantity) return false;
  if (week) {
    const wanted = normWeek(week);
    const actual = normWeek(event.week);
    if (wanted.length === 2) {
      if (!actual.startsWith(`${wanted}-`) && actual !== wanted) return false;
    } else if (actual !== wanted) {
      return false;
    }
  }
  if (room && !event.room.includes(room)) return false;
  if (product && !displayProductName(event).toLowerCase().includes(product.toLowerCase())) return false;
  if (supplier && !event.supplier.includes(supplier)) return false;
  if (direction && direction !== 'all' && event.direction !== direction) return false;
  if (eventType && event.eventType !== eventType) return false;
  return true;
}

function aggregate(events) {
  const map = new Map();
  for (const event of events) {
    const name = displayProductName(event);
    const key = `${name}|${event.unit}`;
    const prev = map.get(key) || {
      productName: name,
      unit: event.unit,
      quantity: 0,
      count: 0,
    };
    prev.quantity += event.quantity;
    prev.count += 1;
    map.set(key, prev);
  }
  return [...map.values()].sort((a, b) => {
    const byQty = Math.abs(b.quantity) - Math.abs(a.quantity);
    if (byQty) return byQty;
    return a.productName.localeCompare(b.productName, 'ko');
  });
}

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });

  const values = await readSheetValues({
    spreadsheetId: getKakaoSheetId(),
    range: BUSINESS_EVENT_RANGE,
  });
  const rows = values.slice(1).map(rowToEvent);
  const filtered = rows.filter(event => passesFilter(event, req.query || {}));
  const items = aggregate(filtered);

  res.status(200).json({
    success: true,
    summary: {
      rows: filtered.length,
      products: items.length,
      totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
      direction: normText(req.query.direction || '+'),
    },
    items,
    details: req.query.includeDetails === '1' ? filtered : undefined,
  });
}

export default withAuth(handler);
