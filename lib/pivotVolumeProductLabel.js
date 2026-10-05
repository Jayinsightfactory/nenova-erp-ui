// The Pivot volume workbook's product-cell label. Keep preview matching and
// Excel export on the same transformation so a downloaded sheet can be read back.
const PRODUCT_WORD_RE = /\b(spray\s+rose|rose|hydrangea|alstroe?meria)\b\s*\/?\s*/gi;
const HYDRANGEA_FIXED = [
  { test: /mojito|모히또/i, to: '미니그린모히또(진)' },
  { test: /\(bw\)|화이트\s*베이스|white\s*base/i, to: '미니그린(연)' },
];

function cleanProductLabel(name) {
  return String(name || '')
    .replace(/mini\s*carnation/gi, 'Mini ')
    .replace(/\bcarnation\b\s*\/?\s*/gi, ' ')
    .replace(PRODUCT_WORD_RE, ' ')
    .replace(/^[\s/／-]+|[\s/／-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// flower별 품목명: 수국=한글 색상명만(괄호/슬래시/공백 제거), 장미=cm 제거
export function volumeProdLabel(row) {
  const raw = String(row?.prodName || '');
  const fl = String(row?.flower || '');
  const isHydra = /수국|hydrangea|루스커스|ruscus/i.test(fl);
  if (isHydra) {
    const fixed = HYDRANGEA_FIXED.find(m => m.test.test(raw));
    if (fixed) return fixed.to;
  }
  let name = cleanProductLabel(raw);
  if (isHydra) {
    const korean = (name.match(/[가-힣][가-힣\s]*/g) || []).join(' ').trim();
    if (korean) {
      name = korean.replace(/\s+/g, '');
      const suffix = (raw.match(/[가-힣)]\s*([A-Za-z]{1,4})\s*$/) || [])[1];
      if (suffix && !/^cm$/i.test(suffix)) name += suffix.toUpperCase();
    } else {
      name = name.replace(/[()[\]<>\/／.]/g, ' ')
        .replace(/\s+/g, ' ').trim()
        .replace(/\s+(?=\D)/g, '')
        .replace(/\s+(?=\d)/g, ' ')
        .trim() || name;
    }
  } else if (/장미|rose/i.test(fl)) {
    name = name.replace(/\s*cm\b/gi, '').replace(/\s{2,}/g, ' ').trim() || name;
  }
  return name;
}
