export function parseNaturalInlineOrderLine(line) {
  const match = String(line || '').trim().match(
    /^(.+?)\s+(?:-|:|：)\s+(.+?)\s*(-?\d+(?:\.\d+)?)?\s*(박스|단|송이|개|스팀|스템|stems?|steam)?\s*(추가|취소)\s*$/i,
  );
  if (!match) return null;
  return {
    customerName: match[1].trim(),
    productName: match[2].trim(),
    quantityText: match[3] || '1',
    unitText: match[4] || '',
    action: match[5],
  };
}
