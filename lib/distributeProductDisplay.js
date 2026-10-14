// Display-only: do not use these labels or snapshots as distribution write inputs.
export function distributeProductName(product, selectedFlower = '') {
  const raw = String(product?.DisplayName || product?.ProdName || '').trim();
  const flower = String(selectedFlower || '').trim();
  if (!flower) return raw;
  const aliases = {
    '카네이션': ['carnation'], '장미': ['rose'], '수국': ['hydrangea'],
    '알스트로': ['alstroemeria', 'alstromeria'], '백합': ['lily'],
    '미니카네이션': ['minicarnation', 'mini carnation'],
  };
  const prefixes = [flower, ...(aliases[flower] || [])];
  for (const prefix of prefixes) {
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const shortened = raw.replace(new RegExp(`^${escaped}(?:\\s*[／/]\\s*|\\s+)`, 'i'), '').trim();
    if (shortened && shortened !== raw) return shortened;
  }
  return raw;
}

export function distributePreviousStock(product) {
  // Only the EXE-parity response maps prevStock from BeforeStock.
  // The legacy all-products response uses the current snapshot under that name.
  if (!product?._exeParity || product.prevStock == null || product.prevStock === '') return null;
  const value = Number(product.prevStock);
  return Number.isFinite(value) ? value : null;
}

export function distributePreviousStockTotal(products) {
  const values = products.map(distributePreviousStock);
  return values.some(value => value == null) ? null : values.reduce((sum, value) => sum + value, 0);
}
