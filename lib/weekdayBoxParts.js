// Native N2 is a display format, not a storage rounding rule.
export const weekdayPreciseQuantity = value => Number(Number(value).toFixed(9));
const positive = value => Number.isSafeInteger(Number(value)) && Number(value)>0 ? Number(value) : null;
export function weekdayBoxPack(row, unit, packaging) {
  if (unit !== '박스') return null;
  const flowers = row.flowerNames || [row.FlowerName || row.flowerName];
  const carnation = flowers.some(name => /^(카네이션|CARNATION)$/i.test(String(name).trim()));
  const hydrangea = flowers.some(name => /^(수국|HYDRANGEA)$/i.test(String(name).trim()));
  if (!carnation && !hydrangea) return null;
  let count = positive(carnation ? packaging?.bunchOf1Box : packaging?.steamOf1Box);
  const bunch=positive(packaging?.bunchOf1Box),stem=positive(packaging?.steamOf1Bunch),box=positive(packaging?.steamOf1Box);
  if(bunch && stem && box && bunch*stem!==box)count=null;
  return { unit:carnation?'단':'송이', count, error:count?'':'품목의 박스 환산값을 확인할 수 없습니다.' };
}
export function composeWeekdayBoxParts(boxes, loose, pack) {
  if (!pack?.count) throw new Error(pack?.error || '박스 환산값이 없습니다.');
  const whole = value => /^\d+$/.test(String(value).trim()) && Number.isSafeInteger(Number(value));
  if (!whole(boxes) || !whole(loose)) throw new Error('박스와 낱개는 0 이상의 정수로 입력하세요.');
  const total = Number(boxes)*pack.count+Number(loose);
  if (!Number.isSafeInteger(total)) throw new Error('입력 수량이 너무 큽니다.');
  return { quantity:weekdayPreciseQuantity(total/pack.count), total, boxes:Math.floor(total/pack.count), loose:total%pack.count };
}
export function splitWeekdayBoxParts(quantity, pack) {
  if (!pack?.count) return null;
  const total=Number(quantity || 0)*pack.count, integer=Math.round(total);
  if (!Number.isSafeInteger(integer) || integer<0 || Math.abs(total-integer)>0.000001) return null;
  return {boxes:Math.floor(integer/pack.count),loose:integer%pack.count};
}
// Only the two explicit box families with integral physical units get this path.
// Other products and legacy fractional quantities retain existing conversion rules.
export function weekdayNativeBoxUnits(quantity, product) {
  const pack=weekdayBoxPack(product,product.OutUnit,{bunchOf1Box:product.BunchOf1Box,steamOf1Box:product.SteamOf1Box,steamOf1Bunch:product.SteamOf1Bunch});
  if (!pack?.count || product.EstUnit!==pack.unit) return null;
  const parts=splitWeekdayBoxParts(quantity,pack);
  if (!parts) return null;
  const total=parts.boxes*pack.count+parts.loose;
  const box=Number(quantity), bunch=pack.unit==='단'?total:box*Number(product.BunchOf1Box||0);
  const steam=pack.unit==='송이'?total:box*Number(product.SteamOf1Box||Number(product.BunchOf1Box||0)*Number(product.SteamOf1Bunch||0));
  return {box,bunch:weekdayPreciseQuantity(bunch),steam:weekdayPreciseQuantity(steam),outQuantity:box,outQty:box,estQty:total};
}
