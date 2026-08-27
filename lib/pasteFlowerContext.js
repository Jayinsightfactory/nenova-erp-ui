const FLOWER_FAMILY_PATTERNS = [
  ['수국', /수국|hydrangea/i],
  ['장미', /장미|rose/i],
  ['카네이션', /카네이션|카네|carnation/i],
  ['알스트로', /알스트로(?:메리아)?|alstro(?:emeria)?/i],
  ['루스커스', /루스커스|ruscus/i],
  ['리시안셔스', /리시안셔스|lisianthus/i],
];

export function inputFlowerFamily(inputName) {
  const text = String(inputName || '');
  return FLOWER_FAMILY_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] || '';
}

export function productMatchesFlowerFamily(family, product) {
  if (!family || !product) return true;
  const pattern = FLOWER_FAMILY_PATTERNS.find(([name]) => name === family)?.[1];
  if (!pattern) return true;
  return pattern.test([
    product.FlowerName,
    product.CountryFlower,
    product.ProdName,
    product.DisplayName,
  ].filter(Boolean).join(' '));
}

export function isFlowerFamilyMismatch(inputName, product) {
  const family = inputFlowerFamily(inputName);
  return Boolean(family && product && !productMatchesFlowerFamily(family, product));
}
