import { normalizeDefectUnit } from './salesDefectDeductionCore.js';

// Validate source wording before attaching canonical ERP keys or unit conversion.
// An item's quantity cannot be borrowed from a different line or customer.
export function assertDefectSourceFacts(content, proof) {
  const lines=String(content).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const fold=s=>s.toLowerCase().replace(/\s+/g,'');
  if(!proof || !Array.isArray(proof.customerAliases) || !proof.customerAliases.some(alias=>lines.some(line=>fold(line)===fold(alias)))) throw new Error('원문 업체가 일치하지 않습니다.');
  const items=lines.filter(line=>proof.itemTokens?.some(token=>fold(line).includes(fold(token))));
  if(!items.length)throw new Error('원문 품목이 일치하지 않습니다.');
  if(proof.allQuantity){if(!items.some(line=>line.includes('전량')))throw new Error('전량 신고 근거가 없습니다.');return true;}
  if(!items.some(line=>[...line.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*(박스|BOX|box|스팀|송이|단|대)/g)]
    .some(m=>Number(m[1])===Number(proof.quantity)&&normalizeDefectUnit(m[2])===normalizeDefectUnit(proof.unit))))throw new Error('원문 항목의 수량·단위가 일치하지 않습니다.');
  return true;
}
