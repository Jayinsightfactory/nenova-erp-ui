// Client-safe view model for structured preservation-collision locations.
// Missing fields stay explicitly unknown; this module never invents a year/week.
const text = (value) => {
  const normalized = String(value == null ? '' : value).replace(/[\s\u00a0]+/g, ' ').trim();
  return normalized || null;
};

const shown = (value, unknown) => text(value) || unknown;

// Keep the matcher-provided explanation verbatim.  In particular, do not turn
// candidateIndexes into a claimed existing-row location: those indexes identify
// a preservation ambiguity, not an uploaded source cell.
const confirmation = (detail) => shown(detail?.message, '확인 내용 미상');

export function raumPnlCollisionLocationRows(details) {
  if (!Array.isArray(details)) return [];
  return details.map((detail, index) => {
    const location = detail?.location || {};
    const orderYear = /^\d{4}$/.test(String(location.orderYear || '').trim()) ? String(location.orderYear).trim() : null;
    const majorDigits = String(location.major || '').replace(/[^0-9]/g, '');
    const major = majorDigits ? `${Number(majorDigits)}차` : '차수 미상';
    // Do not use truthiness: 0 is a valid source sale price in a collision detail.
    const salePrice = location.salePrice ?? null;
    return {
      key: `${index}:${text(detail?.incomingIndex) || ''}:${text(detail?.reason) || ''}`,
      hotel: shown(location.hotel, '호텔 미상'),
      orderYear: orderYear || '연도 미상',
      major,
      itemName: shown(location.itemName || detail?.itemName, '품목 미상'),
      originalSource: shown(location.originalSource || detail?.originalSource, '원본 위치 미상'),
      salePrice,
      confirmation: confirmation(detail),
    };
  });
}
