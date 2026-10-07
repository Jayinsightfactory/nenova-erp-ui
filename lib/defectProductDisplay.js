// List-only display policy: preserve ERP names, size, pack and variety words.
const countries = [
  [/^(콜롬비아|colombia|colombian)$/i, '콜롬비아'],
  [/^(중국|china)$/i, '중국'],
  [/^(에콰도르|ecuador)$/i, '에콰도르'],
  [/^(네덜란드|netherlands|holland)$/i, '네덜란드'],
  [/^(호주|australia)$/i, '호주'],
  [/^(베트남|vietnam)$/i, '베트남'],
];
const roseCategory = /^(?:spray\s+)?(?:rose(?:\s+china)?|china\s+rose)$/i;
export function buildDefectProductDisplay(row = {}) {
  const rawCountry = String(row.countryName || '').trim();
  const country = countries.find(([pattern]) => pattern.test(rawCountry))?.[1] || rawCountry;
  const rawName = String(row.matchedProductDbName || row.matchedProductName || row.colorName || '').trim();
  const parts = rawName.split(/\s*[／/]\s*/);
  let kind = String(row.productName || '').trim();
  const metadata = parts.length > 1 ? parts.slice(0, -1) : [];
  const rose = roseCategory.test(kind) || /장미/.test(kind) || metadata.some(part => roseCategory.test(part));
  if (roseCategory.test(kind) || (rose && (!kind || kind === '기타'))) kind = metadata.some(part => /^spray\s/i.test(part)) ? '스프레이장미' : '장미';
  // Only discard leading, complete classification segments. A variety such as
  // "Sweet Rose" or "China Girl" is never altered by word replacement.
  while (parts.length > 1) {
    const part = parts[0].trim();
    const isCountry = countries.some(([pattern]) => pattern.test(part)) || (country && part === country);
    if (!(isCountry || roseCategory.test(part) || (kind && part === kind))) break;
    parts.shift();
  }
  let name = parts.join(' / ') || rawName || '-';
  if (rose && roseCategory.test(name)) name = '-';
  return {
    category: (country && kind.startsWith(country) ? kind : `${country}${kind}`) || '-',
    name,
    fullName: [rawCountry, String(row.productName || '').trim(), rawName].filter(Boolean).join(' · ') || '-',
  };
}
