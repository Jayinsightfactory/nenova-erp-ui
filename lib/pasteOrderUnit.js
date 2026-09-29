import { defaultUnit, normalizeOrderUnit } from './orderUtils.js';
import { computeShipmentAdjustUnits } from './adjustUnits.js';

// Keep explicit mixed quantities until the final product (including saved/manual mapping) is known.
export function resolvePasteMixedQuantity(item, product, requestedUnit) {
  if (!Array.isArray(item.quantityParts)) return item;
  try {
    if (!product || !item.prodKey || item.quantityParts.length !== 2) throw Error('품목 매칭과 포장수를 확인하세요.');
    const units=item.quantityParts.map(part=>parseExplicitOrderUnit(part.unit));
    if(units.some(unit=>!unit))throw Error('혼합수량 단위를 확인하세요.');
    const unit=parseExplicitOrderUnit(requestedUnit)||(units.includes('송이')?'송이':units.includes('단')?'단':'박스');
    const qty=item.quantityParts.reduce((sum,part,index)=>{
      if(!Number.isFinite(Number(part.qty))||Number(part.qty)<0)throw Error('혼합수량을 확인하세요.');
      return sum+computeShipmentAdjustUnits({delta:Number(part.qty),unit:units[index],outUnit:unit,
        steamOf1Box:product.SteamOf1Box??product.steamOf1Box,
        bunchOf1Box:product.BunchOf1Box??product.bunchOf1Box,
        steamOf1Bunch:product.SteamOf1Bunch??product.steamOf1Bunch}).deltaOut;
    },0);
    if(!Number.isFinite(qty)||qty<=0)throw Error('혼합수량과 품목 포장수를 확인하세요.');
    return {...item,qty,unit,unitExplicit:true,mixedQuantityError:null};
  }catch(error){return {...item,qty:0,unitExplicit:true,mixedQuantityError:error.message};}
}

export function parseExplicitOrderUnit(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const compact = raw.replace(/\s+/g, '').toLowerCase();
  if (/^(?:박스|boxes?|box|bx)$/.test(compact)) return '박스';
  if (/^(?:단|bunch(?:es)?|bun)$/.test(compact)) return '단';
  if (/^(?:송이|개)(?:\(대\))?$|^(?:스팀|스템)(?:\(대\))?$|^(?:대|st|stems?|steam|ea)$/.test(compact)) return '송이';
  return '';
}

export function resolvePasteOrderUnit({ prod, parsedUnit, unitExplicit, prodUnitMap = {} } = {}) {
  const explicitUnit = unitExplicit ? parseExplicitOrderUnit(parsedUnit) : '';
  if (explicitUnit) return explicitUnit;
  return normalizeOrderUnit(defaultUnit(prod, '', prodUnitMap));
}
