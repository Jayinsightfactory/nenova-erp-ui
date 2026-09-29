export function parseNaturalInlineOrderLine(line) {
  const inlineMixed=String(line||'').trim().match(/^(.+?)\s+(?:-|:|：)\s+(.+)$/);
  const mixed=inlineMixed&&parseMixedOrderQuantity(inlineMixed[2]);
  if(mixed)return {...mixed,customerName:inlineMixed[1].trim()};
  const match = String(line || '').trim().match(
    /^(.+?)\s+(?:-|:|：)\s+(.+?)\s*(-?\d+(?:\.\d+)?)?\s*(박\s*스|단|송\s*이(?:\s*\(\s*대\s*\))?|개(?:\s*\(\s*대\s*\))?|대|스\s*팀(?:\s*\(\s*대\s*\))?|스\s*템(?:\s*\(\s*대\s*\))?|st|stems?|steam|ea)?\s*(추가|취소)\s*$/i,
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
  const mixed=parseMixedOrderQuantity(value);
  if(mixed?.action)return mixed;
  const match = value.match(
    /^(.+?)\s*(-?\d+(?:\.\d+)?)?\s*(박\s*스|boxes?|box|bx|단|bunch(?:es)?|bun|송\s*이(?:\s*\(\s*대\s*\))?|개(?:\s*\(\s*대\s*\))?|대|스\s*팀(?:\s*\(\s*대\s*\))?|스\s*템(?:\s*\(\s*대\s*\))?|st|stems?|steam|ea)?\s*(추가|취소)\s*$/i,
  );
  if (!match) return null;
  return {
    productName: match[1].trim(),
    quantityText: match[2] || '1',
    unitText: match[3] || '',
    action: match[4],
  };
}

export function parseMixedOrderQuantity(line) {
  const value=/추가|취소/.test(String(line||''))?stripTrailingOrderMemo(line):String(line||'').trim();
  const match=value.match(/^(.+?)\s*(\d+(?:\.\d+)?)\s*(박스|box|단|bunch|송이|스팀|스템|stems?|st)\s*\+\s*\(?\s*(\d+(?:\.\d+)?)\s*(박스|box|단|bunch|송이|스팀|스템|stems?|st)\s*\)?\s*(추가|취소)?\s*$/i);
  if(!match)return null;
  if(/[+−-]\s*$/.test(match[1])||/\d\s*(?:박스|box|단|bunch|송이|스팀|스템|stems?|st)\s*\+/i.test(match[1]))return null;
  return {productName:match[1].trim(),quantityText:match[2],unitText:match[3],action:match[6]||'',
    quantityParts:[{qty:Number(match[2]),unit:match[3]},{qty:Number(match[4]),unit:match[5]}],
    quantitySource:`${match[2]}${match[3]} + ${match[4]}${match[5]}`};
}
