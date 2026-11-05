// Preparation only: never changes allocations, farm assignments, or stock consent.
export const receiptItem = (row, products) => ({
  sourceWdetailKey: row.WdetailKey, prodName: products.find(p => p.ProdKey === row.ProdKey)?.ProdName ?? row.ProdName,
  orderCode: row.OrderCode ?? '', boxQty: row.BoxQuantity, bunchQty: row.BunchQuantity,
  steamQty: row.SteamQuantity, steamOf1Box: row.SteamOf1Box, steamOf1Bunch: row.SteamOf1Bunch,
  unitPrice: row.UPrice, totalPrice: row.TPrice,
});
export function resizeReceiptItem(item, quantity, unit) {
  const field = {박스:'boxQty',단:'bunchQty',송이:'steamQty'}[unit];
  if (!field || !Number.isFinite(Number(quantity)) || Number(quantity) < 0 || !(Number(item[field]) > 0)) throw new Error('기존 단위 수량이 없어 비례 계산할 수 없습니다. 포장 수량을 직접 확인하세요.');
  const ratio = Number(quantity) / Number(item[field]);
  return {...item, ...Object.fromEntries(['boxQty','bunchQty','steamQty','totalPrice'].map(k=>[k,Number(item[k])*ratio]))};
}
export function newReceiptItemQuantities(item, quantity, product, existing = []) {
  if (quantity === '') return {...item,boxQty:'',bunchQty:'',steamQty:''};
  const q=Number(quantity);
  if (!Number.isFinite(q)||q<0) throw new Error('음수가 아닌 최종 수량을 입력하세요.');
  const candidates=existing.filter(r=>r.ProdKey===product.ProdKey&&Number(r.OutQuantity)>0);
  const prices=new Set(candidates.map(r=>`${r.UPrice}:${r.TPrice/r.OutQuantity}:${r.SteamOf1Box}:${r.SteamOf1Bunch}`));
  if(candidates.length&&prices.size===1){
    const source=receiptItem(candidates[0],[product]);
    return {...resizeReceiptItem(source,q,product.OutUnit),sourceWdetailKey:null};
  }
  const positive=n=>Number(n)>0?Number(n):null;
  const stemsBox=positive(product.SteamOf1Box),stemsBunch=positive(product.SteamOf1Bunch),bunchesBox=positive(product.BunchOf1Box);
  let box='',bunch='',stem='';
  if(product.OutUnit==='박스'){box=q;bunch=bunchesBox?q*bunchesBox:stemsBox&&stemsBunch?q*stemsBox/stemsBunch:'';stem=stemsBox?q*stemsBox:bunch!==''&&stemsBunch?bunch*stemsBunch:'';}
  if(product.OutUnit==='단'){bunch=q;stem=stemsBunch?q*stemsBunch:'';box=bunchesBox?q/bunchesBox:stem!==''&&stemsBox?stem/stemsBox:'';}
  if(product.OutUnit==='송이'){stem=q;bunch=stemsBunch?q/stemsBunch:'';box=stemsBox?q/stemsBox:bunch!==''&&bunchesBox?bunch/bunchesBox:'';}
  return {...item,boxQty:box,bunchQty:bunch,steamQty:stem,steamOf1Box:stemsBox??'',steamOf1Bunch:stemsBunch??''};
}
export function prepareSimpleMatching(facts, request) {
  const previous = request.matching ?? {rows:[],farms:[]};
  // A review already saved by support must never be replaced by automatic defaults.
  if (request.reviewedBy) return previous;
  const receiptMappings = facts.receiptMappingSuggestions ?? [];
  const costInputs = structuredClone(facts.costInputSuggestions ?? []);
  for (const cost of costInputs) if (cost.kind === 'INVOICE') {
    for (const m of cost.lineMappings ?? []) {
      const after = facts.receiptPlan.after[m.targetRowIndex];
      const source = receiptMappings.find(r=>r.targetRowIndex===m.targetRowIndex);
      const before = facts.receiptPlan.before.find(r=>r.WdetailKey===source?.sourceWdetailKey);
      const field = m.quantityUnit==='송이'||m.quantityUnit==='STEM' ? 'SteamQuantity' : m.quantityUnit==='단'||m.quantityUnit==='BUNCH' ? 'BunchQuantity' : null;
      const siblings = cost.lineMappings.filter(r=>r.targetRowIndex===m.targetRowIndex);
      // Only a proven one-to-one source with unchanged product and known unit can scale.
      if (field && before && after && before.ProdKey===after.ProdKey && siblings.length===1 && Number(m.quantity)===Number(before[field])) m.quantity=Number(after[field]);
    }
  }
  return {...previous,receiptMappings,financial:{costInputs,prepared:true,acknowledged:false,reason:request.reason}};
}

export async function prepareSimpleReview(api, value) {
  const request = value.request;
  if (request.status !== 'requested' || !value.permissions.review) return {...value,preview:null};
  if (!request.reviewedBy) {
    const matching = prepareSimpleMatching(value.facts,request);
    await api({action:'saveMatching',requestId:request.requestId,revision:request.revision,matching});
    value = await api(null,request.requestId);
  }
  try {
    const preview = await api({action:'preview',requestId:value.request.requestId,revision:value.request.revision});
    return {...value,preview};
  } catch(error) {
    return {...value,preview:{canCommit:false,issues:[{code:'APPROVAL_PREPARATION_FAILED',message:error.message}],groups:[]}};
  }
}
