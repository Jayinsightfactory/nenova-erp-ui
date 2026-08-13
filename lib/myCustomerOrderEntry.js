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

const FLOWER_PREFIXES = new Set(['rose','carnation','hydrangea','chrysanthemum','lily','tulip','gerbera','lisianthus','ranunculus','peony','orchid','anthurium','gypsophila','alstroemeria']);

export function productAlphabetInitial(product = {}) {
  const source = String(product.DisplayName || product.ProdName || '').trim();
  const tokens = source.replace(/[\/|·_-]+/g, ' ').split(/\s+/).filter(Boolean);
  if (!tokens.length) return '#';
  const first = tokens[0].replace(/[^A-Za-z]/g, '');
  const isFlowerPrefix = FLOWER_PREFIXES.has(first.toLowerCase()) || (first.length > 2 && first === first.toUpperCase());
  const target = isFlowerPrefix && tokens[1] ? tokens[1] : tokens[0];
  const initial = String(target).match(/[A-Za-z]/)?.[0];
  return initial ? initial.toUpperCase() : '#';
}

export function buildForwardOrderWeeks(now = new Date(), majorOffset = 2, majorCount = 6) {
  const year = now.getFullYear();
  const start = new Date(year, 0, 1);
  const dayOfYear = Math.floor((now - start) / 86400000) + 1;
  let targetYear = year;
  let targetMajor = Math.min(Math.ceil(dayOfYear / 7), 52) + majorOffset;
  while (targetMajor > 52) { targetMajor -= 52; targetYear += 1; }
  const choices = [];
  for (let i = 0; i < majorCount; i += 1) {
    let y = targetYear;
    let major = targetMajor + i;
    while (major > 52) { major -= 52; y += 1; }
    for (const seq of [1, 2]) {
      choices.push({ year: String(y), week: `${String(major).padStart(2, '0')}-${String(seq).padStart(2, '0')}`, label: `${major}-${seq}` });
    }
  }
  return choices;
}
