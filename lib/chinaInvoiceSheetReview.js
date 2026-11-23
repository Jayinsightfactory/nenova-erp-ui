const text = value => String(value ?? '').trim();
const finite = value => typeof value === 'number' && Number.isFinite(value);

export function chinaInvoiceSheetList(book) {
  return (book.SheetNames || []).map((name,i)=>{
    const sheet=book.Sheets[name] || {};
    const populated=Object.entries(sheet).some(([key,cell])=>/^[A-Z]+[1-9]\d*$/.test(key) && (text(cell?.v) || cell?.f));
    return {name,hidden:Boolean(book.Workbook?.Sheets?.[i]?.Hidden),empty:!populated};
  });
}

export function reviewCloudChinaSheet(XLSX,book,name) {
  const sheet=book.Sheets[name];
  if(!sheet?.['!ref'])return null;
  const range=XLSX.utils.decode_range(sheet['!ref']);
  if(range.e.r>5000)return null;
  const get=(c,r)=>sheet[XLSX.utils.encode_cell({c,r})];
  const header=['items','picture','specification','quantity','unit price','packing fee','total(cny)','supplier'];
  const headers=[];
  for(let r=0;r<=Math.min(50,range.e.r);r++)if(header.every((value,c)=>text(get(c,r)?.v).toLowerCase()===value))headers.push(r);
  if(headers.length!==1)return null;
  const start=headers[0];
  const totals=[];
  for(let r=start+1;r<=range.e.r;r++)if(/^TOTAL$/i.test(text(get(0,r)?.v)))totals.push(r);
  if(totals.length!==1)return null;
  const end=totals[0], rows=[];
  for(let r=start+1;r<end;r++){
    const item=text(get(0,r)?.v), quantity=get(3,r)?.v, unitPrice=get(4,r)?.v, packing=get(5,r)?.v, amount=get(6,r)?.v;
    if(!item&&[quantity,unitPrice,packing,amount].every(x=>x==null))continue;
    const label=r+1;
    const formula=text(get(6,r)?.f).replace(/\s/g,'').toUpperCase();
    const subtotalCandidate=/^(FLOWER COST|SUBTOTAL)$/i.test(item) && formula===`SUM(G${start+2}:G${label-1})`;
    const prior=rows.map(row=>row.amount);
    const subtotal=subtotalCandidate&&finite(amount)&&prior.length>0&&prior.every(finite)
      &&Math.abs(prior.reduce((a,b)=>a+b,0)-amount)<=0.01;
    const priced=[quantity,unitPrice,amount].every(finite);
    const expected=formula===`D${label}*E${label}+F${label}*D${label}`&&finite(packing)?quantity*(unitPrice+packing)
      :[ `E${label}*D${label}`,`D${label}*E${label}` ].includes(formula)?quantity*unitPrice:null;
    rows.push({row:label,item,specification:text(get(2,r)?.v),quantity,unitPrice,packing,amount,subtotal,
      amountCheck:subtotal?'검산된 중간 소계':priced&&expected!=null&&Math.abs(expected-amount)<=0.01?'수식·표시값 일치':'원문 금액 근거 확인'});
  }
  const printedTotal=get(6,end)?.v, detail=rows.filter(row=>!row.subtotal);
  const summed=detail.length&&detail.every(row=>finite(row.amount))?detail.reduce((a,row)=>a+row.amount,0):null;
  const difference=finite(printedTotal)&&summed!=null?Math.round((summed-printedTotal)*100)/100:null;
  return {headerRow:start+1,totalRow:end+1,currency:'CNY',printedTotal,summed,difference,rows};
}

export function validateCloudMatchReview(preview,decisions,reason) {
  const issues=[];
  if(!preview||preview.difference!==0)issues.push('원본 총액과 행 합계를 먼저 확인하세요.');
  if(!text(reason))issues.push('수량·단가 단위와 상품·비용 구분의 확인 근거를 입력하세요.');
  const goods=[],charges=[];
  for(const row of preview?.rows||[]){
    if(row.subtotal)continue;
    const decision=decisions?.[row.row]||{};
    if(row.amountCheck!=='수식·표시값 일치'||!finite(row.amount)||row.amount<0){
      issues.push(`${row.row}행 원문 금액 근거를 확인하세요.`);continue;
    }
    if(decision.kind==='charge'){charges.push(row);continue;}
    if(decision.kind!=='goods'||!['박스','단','송이'].includes(decision.quantityUnit)||decision.priceUnit!==decision.quantityUnit){
      issues.push(`${row.row}행 상품·비용 및 수량·가격 기준을 확인하세요. 서로 다른 단위는 환산하지 않습니다.`);continue;
    }
    goods.push({...row,quantityUnit:decision.quantityUnit,priceUnit:decision.priceUnit});
  }
  if(!goods.length)issues.push('매칭할 상품 행이 없습니다.');
  return {issues,goods,charges};
}
