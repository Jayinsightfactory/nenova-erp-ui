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

export async function prepareSimpleReview(api, value, mark = () => {}) {
  const request = value.request;
  if (request.status !== 'requested' || !value.permissions.review) return {...value,preview:null};
  if (!request.reviewedBy) {
    const matching = prepareSimpleMatching(value.facts,request);
    mark('matching','기본 매칭 저장 중');
    await api({action:'saveMatching',requestId:request.requestId,revision:request.revision,matching});
    mark('matching','기본 매칭 저장 응답을 받았습니다.','done');
    value = await api(null,request.requestId);
  }
  try {
    mark('preview','원장과 연결 자료 영향 검증 중');
    const preview = await api({action:'preview',requestId:value.request.requestId,revision:value.request.revision});
    mark('preview',preview.canCommit?'검증 결과를 확인할 수 있습니다.':'검토가 필요한 항목이 있습니다.',preview.canCommit?'done':'attention');
    return {...value,preview};
  } catch(error) {
    mark('preview',error.message,'error');
    return {...value,preview:{canCommit:false,issues:[{code:'APPROVAL_PREPARATION_FAILED',message:error.message}],groups:[]}};
  }
}

const normalizedReceiptSearch = value => String(value ?? '').normalize('NFKC').toLowerCase();
const searchTokens = value => normalizedReceiptSearch(value).match(/[\p{L}\p{N}]+/gu) ?? [];
const searchCompact = value => searchTokens(value).join('');
const receiptSearchValues = product => [product.ProdName, product.DisplayName, product.ProdCode, product.FlowerName, product.CounName, ...(product.MappingAliases ?? [])];

export function searchReceiptProducts(query, products) {
  const tokens = searchTokens(query);
  if (!tokens.length) return [];
  const compact = tokens.join('');
  return products.map((product, index) => {
    const names = receiptSearchValues(product);
    const folded = names.map(searchCompact);
    const all = folded.join(' ');
    const score = folded.includes(compact) ? 3
      : folded.some(value => value.includes(compact)) ? 2
      : tokens.every(token => all.includes(token)) ? 1 : 0;
    return {product, index, score};
  }).filter(item => item.score).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,12).map(item=>item.product);
}

export function receiptSearchSuggestions(query, candidates) {
  const numbers = normalizedReceiptSearch(query).match(/\d+/g) ?? [];
  return candidates.filter(product => {
    if (Number(product.MatchScore) < 68) return false;
    if (!numbers.length) return true;
    const available = receiptSearchValues(product).join(' ').match(/\d+/g) ?? [];
    return numbers.every(number=>available.includes(number));
  }).slice(0,12);
}

export const receiptDifferenceFields = {
  ProdKey:'품목', OutQuantity:'출고 기준 수량', EstQuantity:'견적 기준 수량',
  BoxQuantity:'박스', BunchQuantity:'단', SteamQuantity:'송이',
  SteamOf1Box:'박스당 송이', SteamOf1Bunch:'단당 송이', UPrice:'단가', TPrice:'총액', OrderCode:'주문코드',
};

export function receiptRowDifferences(before = [], after = []) {
  const fields = Object.keys(receiptDifferenceFields);
  const value = (row,field) => field==='OrderCode'?String(row?.[field]??'').trim()||null:row?.[field]??null;
  const previous = new Map(before.map((row,index)=>[row.WdetailKey ?? 'before'+index,row]));
  const differences = [];
  const remaining = [];
  const collect = (oldRow,newRow,key) => {
    const changed = fields.filter(field => value(oldRow,field) !== value(newRow,field));
    if (changed.length) differences.push({key,before:oldRow,after:newRow,changed});
  };
  const match = (row,key) => {
    const old = previous.get(key);
    previous.delete(key);
    collect(old,row,key);
  };
  for (const [index,row] of after.entries()) {
    const key = row.SourceWdetailKey ?? row.WdetailKey;
    if (previous.has(key)) match(row,key);
    else remaining.push({row,index});
  }
  // A replacement file has no physical row key. Pair unchanged duplicates once
  // before displaying the remaining removals and insertions separately.
  const fingerprint = row => JSON.stringify(fields.map(field=>value(row,field)));
  for (const {row,index} of remaining) {
    const same = [...previous].find(([,old])=>fingerprint(old)===fingerprint(row));
    if (same) match(row,same[0]);
    else collect(null,row,'after'+index);
  }
  for (const [key,old] of previous) collect(old,null,key);
  return differences;
}
