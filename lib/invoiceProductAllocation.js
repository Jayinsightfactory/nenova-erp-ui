const fields = ['boxQuantity', 'bunchQuantity', 'stemQuantity', 'lineAmount'];
const labels = { boxQuantity:'박스', bunchQuantity:'단', stemQuantity:'송이', lineAmount:'금액' };
export function needsInvoiceAllocation(country, name) {
  return country === 'AU' && /\bwo{1,2}l{1,2}y[\s_-]*bush\b|울리\s*부[쉬시]/i.test(String(name || ''));
}
const number = value => value == null || value === '' || typeof value === 'boolean' ? null : Number(value);
export function allocationSource(line) {
  return { sourceLineId:line.lineId, originalName:line.originalName, sourceEvidence:line.sourceEvidence,
    lengthText:line.lengthText, priceUnit:line.priceUnit, unitPrice:line.unitPrice, currency:line.currency,
    ...Object.fromEntries(fields.map(key=>[key,number(line[key])])) };
}
export function allocationIssues(document, products) {
  const issues = [];
  const country = document?.reviewedMetadata?.country;
  const sources = document?.rawMetadata?.allocationSources || [];
  const lines = document?.lines || [];
  const add=(message,lineId)=>issues.push({code:'PRODUCT_ALLOCATION_REQUIRED',message,lineId});
  for (const line of lines) {
    if (!needsInvoiceAllocation(country,line.originalName)) continue;
    const id=line.sourceEvidence?.allocationSourceId;
    if (!sources.some(source=>source.sourceLineId===id)) add('Woolly bush 원본행을 불러와 품목별 입고량을 분류하세요.',line.lineId);
  }
  for (const source of sources) {
    const allocated=lines.filter(line=>line.sourceEvidence?.allocationSourceId===source.sourceLineId);
    const first=allocated[0]?.lineId || source.sourceLineId;
    if (!allocated.length) {add('분류할 원본 수량이 누락되었습니다.',first);continue;}
    for (const line of allocated) {
      if (line.reviewed?.allocationConfirmed !== true || !Number.isSafeInteger(Number(line.prodKey)) || Number(line.prodKey)<=0)
        add('Woolly bush 품목과 입고량을 선택한 뒤 분류를 확인하세요.',line.lineId);
      if (line.originalName!==source.originalName || line.priceUnit!==source.priceUnit || line.currency!==source.currency || number(line.unitPrice)!==number(source.unitPrice))
        add('분류 중 원문·단가·통화는 바꿀 수 없습니다. 원본 인식값에서 먼저 수정하세요.',line.lineId);
      if (products) {
        const p=products.find(p=>Number(p.ProdKey)===Number(line.prodKey));
        if (!p || (p.country ? p.country!=='AU' : p.CounName!=='호주') || !needsInvoiceAllocation('AU',p.ProdName))
          add('호주 Woolly bush 전산 품목을 선택하세요.',line.lineId);
      }
    }
    for (const field of fields) {
      const expected=number(source[field]);
      const values=allocated.map(line=>number(line[field]));
      if (expected==null) {
        if(values.some(value=>value!=null)) add(`원본 ${labels[field]}이 미확인입니다. 원본 값을 먼저 확인하세요.`,first);
      } else if (!Number.isFinite(expected)||expected<0||values.some(value=>value==null||!Number.isFinite(value)||value<0)) {
        add(`${labels[field]} 분류값을 빠짐없이 0 이상으로 입력하세요.`,first);
      } else {
        const total=values.reduce((a,b)=>a+b,0);
        if(Math.abs(total-expected)>0.000001) add(`${labels[field]} 원본 ${expected} / 분류 ${total} · 차이 ${+(total-expected).toFixed(6)}`,first);
      }
    }
  }
  return issues;
}

export function applyInvoiceAllocation(document, sourceId, rows, products) {
  const source=(document.rawMetadata?.allocationSources||[]).find(item=>item.sourceLineId===sourceId);
  if(!source || !rows.length) throw new Error('분류할 원본행과 입력행을 확인하세요.');
  const replacement=rows.map(row=>({...row, originalName:source.originalName,lengthText:source.lengthText,
    priceUnit:source.priceUnit,unitPrice:source.unitPrice,currency:source.currency,
    ...Object.fromEntries(fields.map(key=>[key,number(row[key])])),prodKey:number(row.prodKey),
    sourceEvidence:{...source.sourceEvidence,allocationSourceId:sourceId},
    reviewed:{...(row.reviewed||{}),allocationConfirmed:true,erpMatchConfirmed:true,confirmed:true}}));
  const lines=[];let inserted=false;
  for(const line of document.lines){
    if(line.sourceEvidence?.allocationSourceId===sourceId){if(!inserted){lines.push(...replacement);inserted=true;}}
    else lines.push(line);
  }
  if(!inserted)throw new Error('분류 대상이 변경되었습니다. 다시 여세요.');
  const next={...document,lines:lines.map((line,index)=>({...line,lineNo:index+1}))};
  const currentOnly={...next,rawMetadata:{...next.rawMetadata,allocationSources:[source]},lines:replacement};
  const errors=allocationIssues(currentOnly,products);
  if(errors.length)throw new Error(errors.map(item=>item.message).join('\n'));
  return next;
}
