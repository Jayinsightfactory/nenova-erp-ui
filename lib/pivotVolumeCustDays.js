// 물량표 엑셀 — 거래처 비고(custDescr)에서 품종/국가별 출고요일 파싱

export const FLOWER_PREFIX = {
  '카네이션': ['카'],
  '수국': ['수'],
  '장미': ['장'],
  '알스트로': ['알'],
  // 거래처관리 비고: 대부분 「중-일」 한글, 일부 「中-수」 한자
  '중국': ['중', '中'],
  '태국': ['태'],
  '네덜란드': ['네'],
};

const DAY_ORDER = { '목': 0, '금': 1, '토': 2, '일': 3, '화': 4, '수': 5, '월': 6 };
const DAY_CHARS = '일월화수목금토';

export { DAY_ORDER };

function prefixPatterns(prefix) {
  const esc = String(prefix).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    new RegExp(`${esc}[-.\\s]*([${DAY_CHARS}][,.\\s${DAY_CHARS}]*)`, 'gi'),
    new RegExp(`${esc}([${DAY_CHARS}])`, 'gi'),
  ];
}

export function extractDays(customer, flower) {
  const spec = FLOWER_PREFIX[flower];
  if (!spec) return [];
  const prefixes = Array.isArray(spec) ? spec : [spec];
  const descr = String(customer?.custDescr || '').trim();
  if (!descr) return [];

  const days = [];
  for (const prefix of prefixes) {
    for (const re of prefixPatterns(prefix)) {
      re.lastIndex = 0;
      for (const match of descr.matchAll(re)) {
        const dayText = String(match[1] || '');
        for (const dayMatch of dayText.matchAll(/[일월화수목금토]/g)) {
          const day = dayMatch[0];
          if (!days.includes(day)) days.push(day);
        }
      }
    }
  }
  return days.sort((a, b) => (DAY_ORDER[a] ?? 99) - (DAY_ORDER[b] ?? 99));
}

export function pickDataDay(days) {
  if (!days.length) return '';
  if (days.includes('일')) return '일';
  return days[0] || '';
}
