export function sortCustomerProducts(rows = []) {
  const flowerUsage = new Map();
  for (const row of rows) {
    const flower = String(row.CountryFlower || row.FlowerName || '기타');
    flowerUsage.set(flower, (flowerUsage.get(flower) || 0) + Number(row.UsageCount || 0));
  }
  return [...rows].sort((a, b) => {
    const af = String(a.CountryFlower || a.FlowerName || '기타');
    const bf = String(b.CountryFlower || b.FlowerName || '기타');
    return (flowerUsage.get(bf) || 0) - (flowerUsage.get(af) || 0)
      || af.localeCompare(bf, 'ko')
      || Number(b.UsageCount || 0) - Number(a.UsageCount || 0)
      || Number(b.LastOrderYear || 0) - Number(a.LastOrderYear || 0)
      || String(b.LastOrderWeek || '').localeCompare(String(a.LastOrderWeek || ''))
      || String(a.DisplayName || a.ProdName || '').localeCompare(String(b.DisplayName || b.ProdName || ''), 'ko');
  });
}

export function quantitiesMatch(expected, actual, epsilon = 0.0001) {
  return Math.abs(Number(expected || 0) - Number(actual || 0)) <= epsilon;
}

const FLOWER_PREFIXES = new Set(['rose','carnation','hydrangea','chrysanthemum','lily','tulip','gerbera','lisianthus','ranunculus','peony','orchid','anthurium','gypsophila','alstroemeria','ruscus']);
const COUNTRY_PREFIXES = new Set(['china','colombia','colombian','ecuador','netherlands','holland','ethiopia','australia','kenya','vietnam','thailand','korea','japan']);
const KOREAN_SKIP = new Set(['장미','카네이션','수국','백합','튤립','루스커스','중국','콜롬비아','에콰도르','네덜란드','호주','태국','베트남']);

function skippableAlphabetToken(token) {
  const trimmed = String(token || '').trim();
  if (!trimmed || /^\[[^\]]*\]$/.test(trimmed)) return true;
  if (/^\d+(?:cm)?$/i.test(trimmed)) return true;
  const latin = trimmed.replace(/[^A-Za-z]/g, '').toLowerCase();
  const hangul = trimmed.replace(/[^가-힣]/g, '');
  if (/^(mq|hq|cm)$/i.test(latin)) return true;
  if (latin && (FLOWER_PREFIXES.has(latin) || COUNTRY_PREFIXES.has(latin))) return true;
  if (hangul && KOREAN_SKIP.has(hangul) && !latin) return true;
  return false;
}

function latinInitialFrom(text) {
  const match = String(text || '').match(/[A-Za-z]/);
  return match ? match[0].toUpperCase() : '';
}

export function productAlphabetInitial(product = {}) {
  const names = [product.DisplayName, product.ProdName].map(value => String(value || '').trim()).filter(Boolean);
  for (const source of names) {
    const tokens = source.replace(/\[[^\]]*\]/g, ' ').replace(/[\/|·_-]+/g, ' ').split(/\s+/).filter(Boolean);
    const variety = tokens.find(token => !skippableAlphabetToken(token)) || '';
    const initial = latinInitialFrom(variety);
    if (initial) return initial;
  }
  return '#';
}

function calendarMajorWeek(now = new Date()) {
  const year = now.getFullYear();
  const start = new Date(year, 0, 1);
  const dayOfYear = Math.floor((now - start) / 86400000) + 1;
  return { year, major: Math.min(Math.ceil(dayOfYear / 7), 52) };
}

function shiftMajorWeek(year, major, delta) {
  let nextYear = Number(year);
  let nextMajor = Number(major) + Number(delta);
  while (nextMajor > 52) { nextMajor -= 52; nextYear += 1; }
  while (nextMajor < 1) { nextMajor += 52; nextYear -= 1; }
  return { year: nextYear, major: nextMajor };
}

/** 등록 차수 선택지: 현재 차수 -backOffset 부터, 기본 선택은 현재 +majorOffset, 이후 majorCount개까지. */
export function buildForwardOrderWeeks(now = new Date(), majorOffset = 2, majorCount = 6, backOffset = 2) {
  const current = calendarMajorWeek(now);
  const startDelta = -Number(backOffset);
  const weekCount = Number(backOffset) + Number(majorOffset) + Number(majorCount);
  const defaultDelta = Number(majorOffset);
  const choices = [];
  for (let i = 0; i < weekCount; i += 1) {
    const delta = startDelta + i;
    const { year, major } = shiftMajorWeek(current.year, current.major, delta);
    for (const seq of [1, 2]) {
      choices.push({
        year: String(year),
        week: `${String(major).padStart(2, '0')}-${String(seq).padStart(2, '0')}`,
        label: `${major}-${seq}`,
        default: delta === defaultDelta && seq === 1,
      });
    }
  }
  return choices;
}
