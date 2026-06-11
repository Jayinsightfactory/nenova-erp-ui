// lib/pivotProdName.js
// Pivot 품목명 표시 — 꽃(품종) 열과 중복되는 ROSE /, CARNATION 등 접두어 제거

const EN_FLOWER_PREFIX_RE =
  /\b(spray\s+rose|mini\s+carnation|carnation|rose|hydrangea|alstroe?meria|orchid|lily|gypsophila|eustoma|ranunculus|chrysanthemum|tulip|lisianthus)\b\s*[\/／]?\s*/gi;

/** flower(꽃) 열 값과 매칭되는 한·영 접두어 */
function stripFlowerColumnPrefix(name, flower) {
  const fl = String(flower || '').trim();
  if (!fl) return name;
  let out = name;
  const esc = fl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  out = out.replace(new RegExp(`^${esc}\\s*[\\/／]\\s*`, 'i'), '');
  out = out.replace(new RegExp(`^${esc}\\s+`, 'i'), '');

  const pairs = [
    ['장미', 'rose'], ['카네이션', 'carnation'], ['수국', 'hydrangea'],
    ['알스트로', 'alstroemeria'], ['알스트로메리아', 'alstroemeria'],
    ['호접', 'orchid'], ['백합', 'lily'], ['거베라', 'gerbera'],
  ];
  for (const [ko, en] of pairs) {
    if (!fl.includes(ko) && !new RegExp(ko, 'i').test(fl)) continue;
    out = out.replace(new RegExp(`^${ko}\\s*[\\/／]\\s*`, 'i'), '');
    out = out.replace(new RegExp(`^${en}\\s*[\\/／]\\s*`, 'i'), '');
    out = out.replace(new RegExp(`^${en}\\s+`, 'i'), '');
  }
  return out;
}

/**
 * @param {string} prodName — DB Product.ProdName
 * @param {string} [flower] — DB FlowerName (꽃 열)
 * @returns {string} 품종 접두어 제거된 품목명(색상)
 */
export function cleanPivotProdName(prodName, flower) {
  const raw = String(prodName || '').trim();
  if (!raw) return '';

  let name = stripFlowerColumnPrefix(raw, flower);
  name = name
    .replace(EN_FLOWER_PREFIX_RE, ' ')
    .replace(/^[\s/／\-]+|[\s/／\-]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return name || raw;
}
