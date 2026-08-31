function normalizeCountryName(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

export function isNetherlandsVolume(value = {}) {
  return normalizeCountryName(value.country) === '네덜란드'
    || normalizeCountryName(value.sheetName) === '네덜란드';
}

/** 네덜란드 통합 시트의 좌측 식별 열. Product.FlowerName과 ProdName을 분리 표시한다. */
export function buildPivotVolumeIdentityColumns(meta = {}) {
  if (!isNetherlandsVolume(meta)) return [{ type: 'product', section: 'left' }];
  return [
    { type: 'flower', section: 'left' },
    { type: 'product', section: 'left' },
    { type: 'color', section: 'left' },
  ];
}

export function pivotVolumeFlowerLabel(row = {}) {
  return String(row.flower || '').trim();
}
