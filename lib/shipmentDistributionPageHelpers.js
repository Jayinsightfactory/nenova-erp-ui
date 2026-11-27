import { suggestDisplayName, jamoMatch, filterProducts } from './displayName';
import { convertQwertyInputToHangul } from './qwertyHangul';

export const fmt = n => Number(n || 0).toLocaleString();
export const PG_SEP = '::';
export const pgLabel = (country, flower) => `${country || ''}${flower || ''}`;

export const countryFlowerFromGroup = (prodGroup, prodGroups) => {
  if (!prodGroup || prodGroup.endsWith(PG_SEP)) return '';
  const g = prodGroups.find((x) => x.key === prodGroup);
  if (g?.country && g?.flower) return pgLabel(g.country, g.flower);
  if (prodGroup.includes(PG_SEP)) {
    const [country, flower] = prodGroup.split(PG_SEP);
    return pgLabel(country, flower);
  }
  return prodGroup;
};

export const pairKeyFromGroup = (prodGroup, prodGroups) => {
  if (!prodGroup) return '';
  const g = prodGroups.find((x) => x.key === prodGroup);
  const [country, flower] = g?.country && g?.flower ? [g.country, g.flower] : prodGroup.split(PG_SEP);
  return [country, flower].map(v => String(v || '').trim()).filter(Boolean).join(' ');
};

export const shipDayGroupKey = (item) => {
  const country = String(item?.CounName || '').trim();
  const flower = String(item?.FlowerName || '').trim();
  if (country && flower) return `${country}${PG_SEP}${flower}`;
  return String(item?.CountryFlower || '').trim();
};

export function weekToShipDate(weekStr, year = new Date().getFullYear()) {
  try {
    const [wStr, dStr] = weekStr.split('-');
    const weekNum = parseInt(wStr, 10);
    const delivNum = parseInt(dStr, 10) || 1;
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const monday = new Date(jan4);
    monday.setDate(jan4.getDate() - dayOfWeek + 1 + (weekNum - 1) * 7);
    const offsets = [0, 0, 3, 5];
    monday.setDate(monday.getDate() + (offsets[delivNum] ?? 0));
    return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`;
  } catch {
    return null;
  }
}

export const WEEK_SUFFIXES = ['-01', '-02'];
export const DAY_NAMES = ['월', '화', '수', '목', '금'];
export const DAY_NAMES_TAB2 = ['월', '화', '수', '목', '금', '토', '일'];
export const EXE_DAY_NUM = { 월: 2, 화: 3, 수: 4, 목: 5, 금: 6, 토: 7, 일: 1 };
export const PRODUCT_FAVORITE_PAGE = 'shipment-distribute-products';
export const GROUP_FAVORITE_PAGE = 'shipment-distribute-groups';
export const COUNTRY_FAVORITE_PAGE = 'shipment-distribute-countries';

export function mapCustWeekGridRow(row) {
  const dayByKr = {};
  for (const d of DAY_NAMES_TAB2) {
    dayByKr[d] = Number(row[`day${EXE_DAY_NUM[d]}`]) || 0;
  }
  const totalOut = Number(row.OutQuantity) || 0;
  const daySum = Object.values(dayByKr).reduce((a, b) => a + b, 0);
  return {
    ProdKey: row.ProdKey,
    ProdName: row.ProdName,
    OutUnit: row.OutUnit,
    EstUnit: row.EstUnit,
    SdetailKey: row.SdetailKey,
    출고수량: totalOut || daySum,
    _exeWeekGrid: true,
    _dayByKr: dayByKr,
    _ymdByKr: Object.fromEntries(DAY_NAMES_TAB2.map(d => [d, row[`ymd${EXE_DAY_NUM[d]}`]])),
  };
}

export function autoSplitQty(totalQty, dayCount) {
  if (dayCount <= 0 || totalQty <= 0) return [];
  const base = Math.floor(totalQty / dayCount);
  const remainder = totalQty - base * dayCount;
  return Array.from({ length: dayCount }, (_, i) => base + (i < remainder ? 1 : 0));
}

export const weekButtonStyle = (_value, active) => ({
  padding: '5px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
  border: active ? '2px solid #1a237e' : '1px solid #c5cae9',
  background: active ? '#1a237e' : '#f3f4ff', color: active ? '#fff' : '#1a237e', fontWeight: active ? 700 : 500,
});

export const pickButtonStyle = (active, hasStock) => ({
  padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', maxWidth: 220, overflow: 'hidden',
  textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left',
  border: active ? '2px solid var(--blue)' : '1px solid var(--border2)',
  background: active ? 'var(--blue)' : hasStock ? '#F0F7FF' : 'var(--bg)',
  color: active ? '#fff' : hasStock ? 'var(--blue)' : 'var(--text2)', fontWeight: active || hasStock ? 700 : 400,
});

function matchItemNameOne(row, q) {
  const ko = suggestDisplayName(row.ProdName || '');
  if (`${row.DisplayName || ''} ${row.ProdName || ''} ${ko}`.toLowerCase().includes(q.toLowerCase())) return true;
  if (/[ㄱ-힣]/.test(q) && [row.DisplayName, ko, row.FlowerName].some(name => name && jamoMatch(q, name))) return true;
  return /[ㄱ-힣]/.test(q) && filterProducts([row], q, 0.9).length > 0;
}

export function matchDistributeItemName(row, text) {
  const raw = String(text || '').trim();
  if (!raw) return true;
  const typed = convertQwertyInputToHangul(raw);
  return [raw, ...(typed !== raw ? [typed] : [])].some(q => matchItemNameOne(row, q));
}

export function calculateAutoDistributeInputs(custDist, available, distMode) {
  const newInputs = {};
  if (distMode === 'ratio') {
    const totalOrder = custDist.reduce((a, b) => a + (b.주문수량 || 0), 0);
    if (totalOrder === 0) return { emptyOrder: true, inputs: {} };
    let allocated = 0;
    const sorted = [...custDist].sort((a, b) => (b.주문수량 || 0) - (a.주문수량 || 0));
    sorted.forEach((c, idx) => {
      if (idx === sorted.length - 1) {
        newInputs[c.CustKey] = Math.max(0, available - allocated);
      } else {
        const ratio = (c.주문수량 || 0) / totalOrder;
        const qty = Math.floor(ratio * available);
        newInputs[c.CustKey] = qty;
        allocated += qty;
      }
    });
  } else {
    let remain = available;
    const sorted = [...custDist].sort((a, b) => (b.주문수량 || 0) - (a.주문수량 || 0));
    sorted.forEach(c => {
      const want = c.주문수량 || 0;
      const give = Math.min(want, remain);
      newInputs[c.CustKey] = give;
      remain = Math.max(0, remain - give);
    });
  }
  return { emptyOrder: false, inputs: newInputs };
}
