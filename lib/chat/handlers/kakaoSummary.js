import { getKakaoSheetId, readSheetValues } from '../../googleSheets';

const BUSINESS_EVENT_RANGE = '비즈니스이벤트!A:P';
const fmt = n => Number(n || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 });

function norm(value) {
  return String(value || '').trim();
}

function extractWeek(text) {
  const m = String(text || '').match(/(\d{1,2})\s*(?:-|차\s*)\s*(\d{1,2})?/);
  if (!m) return '';
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
    eventType: norm(row[2]),
    week: norm(row[3]),
    product: norm(row[4]),
    variety: norm(row[5]),
    quantity: parseQty(row[6]),
    unit: norm(row[7]) || '개',
    direction: norm(row[8]),
    supplier: norm(row[9]),
    room: norm(row[10]),
  };
}

function productName(event) {
  return [event.product, event.variety].filter(Boolean).join(' / ') || '품목 미분류';
}

function matchesWeek(eventWeek, wanted) {
  if (!wanted) return true;
  const actual = extractWeek(eventWeek) || norm(eventWeek);
  if (wanted.length === 2) return actual === wanted || actual.startsWith(`${wanted}-`);
  return actual === wanted;
}

function extractProductHint(text) {
  const cleaned = String(text || '')
    .replace(/\d{1,2}\s*(?:-|차\s*)\s*\d{0,2}/g, ' ')
    .replace(/수입방|카톡|카카오|추가|취소|차감|수량|합계|품목|보여줘|조회|얼마|전체/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length >= 2 ? cleaned : '';
}

export async function handleKakaoSummaryLookup(text) {
  const week = extractWeek(text);
  const direction = /취소|차감|마이너스/.test(text) ? '-' : '+';
  const productHint = extractProductHint(text);

  const values = await readSheetValues({
    spreadsheetId: getKakaoSheetId(),
    range: BUSINESS_EVENT_RANGE,
  });

  const events = values
    .slice(1)
    .map(rowToEvent)
    .filter(event => {
      if (!event.product || !event.quantity) return false;
      if (event.direction !== direction) return false;
      if (!matchesWeek(event.week, week)) return false;
      if (event.room && !event.room.includes('수입')) return false;
      if (productHint && !productName(event).toLowerCase().includes(productHint.toLowerCase())) return false;
      return true;
    });

  const grouped = new Map();
  for (const event of events) {
    const name = productName(event);
    const key = `${name}|${event.unit}`;
    const row = grouped.get(key) || { productName: name, unit: event.unit, quantity: 0, count: 0 };
    row.quantity += event.quantity;
    row.count += 1;
    grouped.set(key, row);
  }

  const items = [...grouped.values()].sort((a, b) => Math.abs(b.quantity) - Math.abs(a.quantity));
  const total = items.reduce((sum, item) => sum + item.quantity, 0);
  const titleWeek = week ? `${week}차 ` : '';
  const directionLabel = direction === '-' ? '취소/차감' : '추가';

  if (!items.length) {
    return {
      messages: [
        {
          type: 'text',
          content: `${titleWeek}수입방 카톡 ${directionLabel} 수량에서 표시할 품목을 찾지 못했습니다. 차수나 품목명을 조금 더 구체적으로 입력해 주세요.`,
        },
      ],
      _askback: true,
    };
  }

  return {
    messages: [
      {
        type: 'text',
        content: `${titleWeek}수입방 카톡 ${directionLabel} 수량을 품목별로 합산했습니다. 품목 ${items.length}개, 근거 행 ${events.length}건, 총수량 ${fmt(total)}입니다.`,
      },
      {
        type: 'card',
        card: {
          title: `${titleWeek}수입방 카톡 ${directionLabel} 수량`,
          subtitle: 'Google Sheet 비즈니스이벤트 기준',
          rows: items.slice(0, 50).map(item => ({
            label: item.productName,
            value: `${fmt(item.quantity)} ${item.unit}`,
          })),
          footer: items.length > 50 ? `총 ${items.length}개 중 50개 표시` : `총 ${items.length}개`,
        },
      },
    ],
  };
}
