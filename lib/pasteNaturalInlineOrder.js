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

// 품목 동작 뒤의 괄호는 농장/박스 위치 같은 메모다.
// 예: "프라우드 10단 취소 (밀라그로)" -> "프라우드 10단 취소"
export function stripTrailingOrderMemo(line) {
  let value = String(line || '').trim();
  let previous;
  do {
    previous = value;
    value = value.replace(/\s*\([^()]*\)\s*$/, '').trim();
  } while (value !== previous);
  return value;
}

export function parseNaturalSectionActionLine(line) {
  const value = stripTrailingOrderMemo(line);
  const match = value.match(
    /^(.+?)\s*(-?\d+(?:\.\d+)?)?\s*(박\s*스|boxes?|box|bx|단|bunch(?:es)?|bun|송\s*이|개|스\s*팀(?:\s*\(\s*대\s*\))?|스\s*템|stems?|steam)?\s*(추가|취소)\s*$/i,
  );
  if (!match) return null;
  return {
    productName: match[1].trim(),
    quantityText: match[2] || '1',
    unitText: match[3] || '',
    action: match[4],
  };
}
