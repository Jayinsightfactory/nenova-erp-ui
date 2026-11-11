// File-only projection: source/approved costs and ERP records are never mutated.
import { NL_QUARANTINE_SAMPLES } from './nlQuarantineDeduction.js';
import { customsReferenceCells } from './invoiceCostCustomsReference.js';
const xml = v => String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const rowOf = ref => Number(ref.match(/\d+$/)[0]);
const finite = v => typeof v === 'number' && Number.isFinite(v);
const labelUnit = u => ({STEM:'송이',BUNCH:'단',BOX:'박스'})[u] || u;
export const RESTORED_COST_LAYOUTS = Object.freeze({
 NL_ORIGINAL_V1:{first:15,qty:'E',factor:'N',unitCost:'O',sale:'Q',input:'R',recommend:'S',profit:'T',margin:'U',sales:'V',profits:'W',fx:'C7'},
 US_ORIGINAL_V1:{first:13,qty:'D',factor:'K',unitCost:'L',sale:'M',input:'N',recommend:'O',profit:'P',margin:'Q',sales:'R',profits:'S',fx:'C6'},
 NZ_ORIGINAL_V1:{first:13,qty:'E',factor:'L',unitCost:'M',sale:'N',input:'O',recommend:'P',profit:'Q',margin:'R',sales:'S',profits:'T',fx:'C6'},
 VN_ORIGINAL_V1:{first:19,qty:'E',factor:'L',unitCost:'M',sale:'N',input:'O',recommend:'P',profit:'Q',margin:'R',sales:'S',profits:'T',fx:'D6'},
 EC_ORIGINAL_V1:{first:14,qty:'E',factor:'N',unitCost:'O',sale:'P',input:'Q',recommend:'R',profit:'S',margin:'T',sales:'U',profits:'V',fx:'C7'},
 CN_AIR_ORIGINAL_V1:{first:24,qty:'E',factor:'N',unitCost:'O',sale:'P',input:'Q',recommend:'R',profit:'S',margin:'T',sales:'U',profits:'V',fx:'C7'},
 CN_SEA_ORIGINAL_V1:{first:44,qty:'E',factor:'O',unitCost:'P',sale:'Q',input:'R',recommend:'S',profit:'T',margin:'U',sales:'V',profits:'W',fx:'C7'},
 CO_ORIGINAL_V1:{first:15,qty:'E',factor:'N',unitCost:'O',sale:'P',input:'Q',recommend:'R',profit:'S',margin:'T',sales:'U',profits:'V',fx:'C7'},
 TH_ORIGINAL_V1:{first:15,qty:'F',factor:'O',unitCost:'P',sale:'Q',input:'R',recommend:'S',profit:'T',margin:'U',sales:'V',profits:'W',fx:'C7'},
});

function serialize(cells,template,first,last,header,prototype=first,layout,numberStyle=style=>style) {
 const styles=new Map(template.rows.flatMap(r=>r.cells.map(c=>[c.ref,c.style])));
 const byRow=new Map(), origRows=new Map(template.rows.map(r=>[Number(r.attrs.match(/r="(\d+)"/)[1]),r]));
 for(const row of template.rows)for(const c of row.cells)if(rowOf(c.ref)<=last&&!cells.has(c.ref))cells.set(c.ref,{});
 for(const [ref,c]of cells){
  if(finite(c.value)===false&&typeof c.value==='number')throw Error(`Invalid original cost cell ${ref}`);
  const r=rowOf(ref),styleRef=r===first?ref.replace(/\d+$/,String(prototype)):ref;
  let style=styles.get(styleRef)??styles.get(ref.replace(/\d+$/,String(prototype)))??'0';
  const col=ref.replace(/\d+$/,'');
  if(c.formula&&layout&&(r>=first||r===header-1)){
   if(col===layout.margin)style=styles.get(`${layout.margin}${prototype}`)??style;
   if([layout.sales,layout.profits].includes(col))style=styles.get(`${layout.unitCost}${prototype}`)??style;
  }
  if(layout&&((r>=first&&layout.moneyCols.includes(col))||(r===header-1&&[layout.sales,layout.profits].includes(col))||ref===layout.fx))style=numberStyle(style);
  if(c.numberFormat!==undefined)style=numberStyle(style,c.numberFormat);
  const attrs=`r="${ref}" s="${style}"`,numeric=typeof c.value==='number';
  const data=c.formula?`<c ${attrs}${numeric?'':' t="str"'}><f>${xml(c.formula)}</f><v>${xml(c.value??'')}</v></c>`
   :c.value===undefined?`<c ${attrs}/>`:numeric?`<c ${attrs}><v>${c.value}</v></c>`:`<c ${attrs} t="inlineStr"><is><t xml:space="preserve">${xml(c.value)}</t></is></c>`;
  const a=byRow.get(r)||[];a.push({ref,data});byRow.set(r,a);
 }
 const pos=ref=>{const[,col,row]=ref.match(/^([A-Z]+)(\d+)$/);return [Number(row),[...col].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)];};
 const occupied=[...cells].filter(([,c])=>c.value!==undefined||c.formula).map(([ref])=>ref);
 const merges=template.merges.filter(m=>{
  const [a,b]=m.split(':'),[ar,ac]=pos(a),[br,bc]=pos(b||a);
  if(ar<=3&&br>=1)return false; // Rebuild the two captions across the actual output columns.
  if(br>=first)return false;
  return !occupied.some(ref=>{const[r,c]=pos(ref);return ref!==a&&r>=ar&&r<=br&&c>=ac&&c<=bc;});
 });
 merges.push('B1:K2','B3:W3');
 // Original product name spans B:D, except TH's Company B / product C:E.
 const thai=header===14&&cells.get('C14')?.value==='원문 품목';
 if(thai&&cells.has('R4'))merges.push('R4:W4','R11:W11');
 for(let r=first;r<=last;r++)merges.push(`${thai?'C':'B'}${r}:${thai?'E':'D'}${r}`);
 // US/NZ quantity is D, therefore product name can span only B:C.
 if(cells.get(`D${header}`)?.value?.startsWith('수량'))for(let i=0;i<last-first+1;i++)merges[merges.length-1-i]=`B${last-i}:C${last-i}`;
 const sheetData=[...byRow].sort(([a],[b])=>a-b).map(([r,a])=>{
  const attrs=origRows.get(r)?.attrs??origRows.get(first)?.attrs.replace(/r="\d+"/,`r="${r}"`)??`r="${r}" ht="24" customHeight="1"`;
  return `<row ${attrs}>${a.sort((x,y)=>pos(x.ref)[1]-pos(y.ref)[1]).map(c=>c.data).join('')}</row>`;
 }).join('');
 // Long CN layouts have 23/43 header rows: freezing them all hides the data.
 const freezeRows=header>18?3:header,top=header>18?header:first;
 last=Math.max(last,...byRow.keys()); // Reference tables can extend below a short invoice.
 return `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:AD${last}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0" tabSelected="1"><pane ySplit="${freezeRows}" topLeftCell="B${top}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="B${first}" sqref="B${first}"/></sheetView></sheetViews>${template.sheetFormatPr}${template.cols}<sheetData>${sheetData}</sheetData><mergeCells count="${merges.length}">${merges.map(m=>`<mergeCell ref="${m}"/>`).join('')}</mergeCells>${template.print}</worksheet>`;
}

function widenNlQuarantineAuditColumns(cols) {
 let found=0;
 const result=cols.replace(/<col\b[^>]*\/>/g, tag=>{
  const min=Number(tag.match(/\bmin="(\d+)"/)?.[1]),max=Number(tag.match(/\bmax="(\d+)"/)?.[1]);
  if(!(min<=29&&max>=27))return tag;
  const width=tag.match(/\bwidth="([^"]+)"/)?.[1];
  const part=(a,b,w)=>tag.replace(/\bmin="\d+"/,`min="${a}"`).replace(/\bmax="\d+"/,`max="${b}"`)
    .replace(/\bwidth="[^"]+"/,`width="${w}"`);
  const pieces=[];
  if(min<27)pieces.push(part(min,26,width));
  for(const [column,w] of [[27,19],[28,96],[29,22]])if(min<=column&&max>=column){pieces.push(part(column,column,w));found++;}
  if(max>29)pieces.push(part(30,max,width));
  return pieces.join('');
 });
 if(found!==3)throw Error('NL 검역 감사표 AA:AC 열 폭을 찾지 못했습니다');
 return result;
}

export function originalRestoredCostSheet({document,revision,snapshot,rows,template,profile,comparison,numberStyle}) {
 const p=RESTORED_COST_LAYOUTS[profile.id];if(!p)return null;
 const cells=new Map(),put=(r,value)=>cells.set(r,{value}),formula=(r,f,value)=>cells.set(r,{formula:f,value});
 let customsReference=null;
 const input=snapshot.input, settings=new Map(input.lineInputs.map(l=>[l.lineId,l])),nl=profile.id==='NL_ORIGINAL_V1';
 const first=p.first,last=first+rows.length-1,header=profile.headerRow??first-1;
 const sum=k=>rows.reduce((n,row)=>n+(row.cost.componentAmounts[k]??0),0),goods=rows.reduce((n,row)=>n+(row.cost.quantity===0?0:row.source.lineAmount),0);
 const comparisonRef=(c,i)=>`'원본수식 비교'!${c}${13+i}`;
 if(profile.id==='TH_ORIGINAL_V1'){
  const groups=input.costGroups||[],boxes=groups.reduce((n,g)=>n+g.boxQuantity,0);
  put('I5','포장 그룹 · 현재 입력');put('I6','그룹');put('J6','박스');put('K6','기준수량');put('L6','박스 비율');
  groups.forEach((g,i)=>{const r=7+i;put(`I${r}`,g.groupId);put(`J${r}`,g.boxQuantity);put(`K${r}`,g.quantity);formula(`L${r}`,`IF($J$10=0,0,J${r}/$J$10)`,boxes?g.boxQuantity/boxes:0);cells.get(`L${r}`).numberFormat=9;});
  put('I10','합계');formula('J10','SUM(J7:J9)',boxes);formula('K10','SUM(K7:K9)',groups.reduce((n,g)=>n+g.quantity,0));
 }
 if(profile.id==='CO_ORIGINAL_V1'){
  put('J5','그룹 운임 · 현재 입력');put('J6','그룹');put('K6','운임');put('L6','기준수량');put('M6','단위 운임');
  (input.costGroups||[]).forEach((g,i)=>{const r=7+i,freight=rows.filter(x=>settings.get(x.cost.lineId).groupId===g.groupId).reduce((n,x)=>n+x.cost.componentAmounts.freightNative,0);
   put(`J${r}`,g.groupId);formula(`K${r}`,`SUMPRODUCT((AC${first}:AC${last}=J${r})*G${first}:G${last}*E${first}:E${last})`,freight);put(`L${r}`,g.quantity);formula(`M${r}`,`IF(L${r}=0,0,K${r}/L${r})`,g.quantity?freight/g.quantity:0);
  });
 }
 const test=input.exchangeRateType==='TEST_ONLY'||/TEST_ONLY/.test(`${input.costSourceId||''} ${input.estimateSource||''}`);
 put('B1',`${document.reviewedMetadata?.country||profile.id.split('_')[0]} ${document.orderYear}/${document.orderWeek} 원본 양식 계산 · 미승인 파일 계산본${test?' · TEST_ONLY 시험값':''}`);
 put('B3',`원가·판매 KRW · ${p.input}열 현재 판매가(VAT포함) 입력 → 판매·이익·합계 계산. 과거 판매가는 복사하지 않습니다. /0.77은 원본 참고가이며 15% 이익률과 다릅니다.`);
 put('AA1','파일 내 계산만 · ERP/승인 원가 변경 없음');
 put('AA2','비용 근거');put('AB2',input.expenseBasis==='ESTIMATED'?'추정비용 · 실제 청구 아님':'조회/승인 입력값');
 put('AA4','운임 합계(외화)');put('AB4',sum('freightNative'));
 put('AA5','통관 합계(KRW)');put('AB5',sum('customsKRW'));
 put('AA6','기존 원가 합계');put('AB6',revision.totalCostKRW);
 put('AA7','파일 계산 합계');put('AA8','기존 원가와 차이');
 put(p.fx,input.exchangeRateKRW);
 const compact=profile.priceBasis&&profile.id!=='EC_ORIGINAL_V1';
 const valueCol=p.fx[0],identity=compact?`${valueCol}4`:'C5',gwRef=compact?`${valueCol}7`:'C8',countRef=compact?`${valueCol}8`:'C9',qtyRef=compact?`${valueCol}9`:'C10';
 put(compact?'B4':'B5','차수');put(identity,`${document.orderYear}/${document.orderWeek}`);
 put(compact?'B6':'B7','환율');put(compact?'B7':'B8',profile.id==='VN_ORIGINAL_V1'?'CW (kg)':'GW (kg)');
 put(gwRef,document.reviewedMetadata?.[profile.id==='VN_ORIGINAL_V1'?'cw':'gw']??'자료 없음');
 if(!compact){put('D8','CW (kg)');put('E8',document.reviewedMetadata?.cw??'자료 없음');}
 put(compact?'B8':'B9',nl&&input.nlTemplateCosts?.kindCount?'검역 종류수':'품목수');
 put(countRef,nl&&input.nlTemplateCosts?.kindCount?input.nlTemplateCosts.kindCount:rows.length);put(compact?'B9':'B10','총수량');
 if(nl&&input.nlTemplateCosts?.kindCount){put('AA9','입고 품목 행수');put('AB9',rows.length);}
 put(compact?'B5':'B6',`상품 합계 ${input.nativeCurrency}`);
 const totalGoods=goods;
 put(compact?`${valueCol}5`:'D6',totalGoods);
 if(!compact){put('B11',`운임 합계 ${input.nativeCurrency}`);put('C11',sum('freightNative'));put('D11','서류비');put('E11','내역 미보유');put('F11','운송 세부');put('G11','합계 C11 적용');put('D9','요율');put('E9','내역 미보유');}
 if(!nl){
  const us=profile.id==='US_ORIGINAL_V1',th=profile.id==='TH_ORIGINAL_V1';
  const lc=compact?(us?'L':'M'):th?'M':'O',vc=compact?(us?'M':'N'):th?'N':'P',start=compact?5:6;
  put(`${lc}${start-1}`,'통관비 · 현재 원가 입력');
  put(`${lc}${start}`,'통관비 합계');formula(`${vc}${start}`,'$AB$5',sum('customsKRW'));
  put(`${lc}${start+1}`,'기타비 합계');put(`${vc}${start+1}`,sum('otherKRW'));
  put(`${lc}${start+2}`,'청구 세부내역');put(`${vc}${start+2}`,'내역 미보유');
  put(`${lc}${start+3}`,'통관비 수정');put(`${vc}${start+3}`,'AB5에서 조정');
  put(`${lc}${start+4}`,'Total KRW');formula(`${vc}${start+4}`,`SUM(${vc}${start}:${vc}${start+1})`,sum('customsKRW')+sum('otherKRW'));
  customsReference=customsReferenceCells(profile.id,{weightRef:gwRef,countRef,
    weight:document.reviewedMetadata?.[profile.id==='VN_ORIGINAL_V1'?'cw':'gw'],count:rows.length,
    labelCol:lc,valueCol:vc,start});
  if(customsReference){
    for(const [ref,cell] of customsReference.cells)cells.set(ref,cell);
    if(input.expenseBasis==='ESTIMATED' && finite(customsReference.total)){
      put('AA11','통관 수식 외 조정(KRW)');put('AB11',sum('customsKRW')-customsReference.total);
      formula('AB5',`IF(ISNUMBER(${customsReference.totalRef}),${customsReference.totalRef}+$AB$11,"입력 필요")`,sum('customsKRW'));
    }else formula('AB11',`IF(ISNUMBER(${customsReference.totalRef}),$AB$5-${customsReference.totalRef},"입력 필요")`,
      finite(customsReference.total)?sum('customsKRW')-customsReference.total:'입력 필요');
  }
  if(us){put('G4','현재 적용 세율 · 품목별 상세는 비교 시트');put('G5','세율');put('H5','품목수');put('I5','관세 합계');
   const rates=[...new Set(input.lineInputs.map(l=>l.tariffRate))];rates.slice(0,3).forEach((rate,i)=>{const matched=rows.filter(row=>settings.get(row.cost.lineId).tariffRate===rate);put(`G${6+i}`,`${rate*100}%`);put(`H${6+i}`,matched.length);put(`I${6+i}`,matched.reduce((a,row)=>a+row.cost.componentAmounts.tariffKRW,0));});
  }
 }
 if(nl){
  put('B6','총금액 Invoice');formula('D6',`SUMPRODUCT(E${first}:E${last},F${first}:F${last})`,goods);
  formula('C6','D6+C11',goods+sum('freightNative'));put('H5','Double check');formula('H6',`SUM(I${first}:I${last})`,goods+sum('freightNative'));
  put('P5','통관비 · 적용 입력값');['백상','통관 수수료','검역 수수료','국내 운송비'].forEach((v,i)=>put(`P${6+i}`,v));
  const a=input.nlTemplateCosts;
  if(a&&['bakSang','handling','quarantine','domestic','extra','deduct'].every(k=>finite(a[k]))&&Math.abs(a.bakSang+a.handling+a.quarantine+a.domestic+a.extra-a.deduct-input.customsTotalKRW)<.00001){
   put('AA10','백상 원/kg');put('AB10',document.reviewedMetadata.gw>0?a.bakSang/document.reviewedMetadata.gw:0);put('AA11','검역 원/종류');put('AB11',a.quarantine/(a.kindCount||rows.length));
   formula('Q6','C8*$AB$10',a.bakSang);put('Q7',a.handling);formula('Q8','C9*$AB$11',a.quarantine);put('Q9',a.domestic);
   put('R6','검역 차감');put('S6',a.deduct);put('R7','소독비');put('S7',a.extra);
   formula('Q10','SUM(Q6:Q9)+S7-S6',input.customsTotalKRW);put('P5','통관비 · 서식 추정값(실제 청구 아님)');
   if(Array.isArray(a.selections)&&Array.isArray(a.excluded)){
    put('AA14','검역 종류');put('AB14','최저 도착원가 품목 · 원본 차감 송이수');put('AC14','FOB 차감액 KRW');
    const presentKinds=new Set([...a.selections,...a.excluded].map(s=>s.kind));
    const entries=[...a.selections.map(s=>{
      const index=rows.findIndex(row=>s.lineId&&row.cost.lineId===s.lineId);
      // Old snapshots may lack lineId. Their explicit FOB evidence still follows
      // the workbook exchange rate, without guessing a product-row connection.
      const fob=index>=0?`F${first+index}`:Number(s.fobPerStem);
      return {kind:s.kind,label:`${s.originalName} · ${s.stems}송이 × FOB ${Number(s.fobPerStem).toFixed(2)} EUR`,value:s.deductionKRW,
        expression:`${Number(s.stems)}*${fob}*$C$7`};
    }),...a.excluded.map(s=>({kind:s.kind,label:'원본 샘플표 차감 송이수 없음 · 0원',value:0})),
      ...NL_QUARANTINE_SAMPLES.filter(s=>!presentKinds.has(s.kind)).map(s=>({kind:s.kind,label:`원본 차감 ${s.stems}송이 · 해당 종류 미입고`,value:'-'}))];
    entries.forEach((s,i)=>{const r=15+i;put(`AA${r}`,s.kind);put(`AB${r}`,s.label);
      if(s.expression)formula(`AC${r}`,s.expression,s.value);else put(`AC${r}`,s.value);});
    const auditLast=14+entries.length;
    formula('S6',`SUM(AC15:AC${auditLast})`,a.deduct);
   }
  }else{for(let r=6;r<=9;r++)put(`Q${r}`,'내역 미보유');put('Q10',sum('customsKRW'));}
  put('P10','통관총액 KRW');
  for(const [ref,v]of Object.entries({J5:'원본 세율 참고 · X열 적용세율 사용',J6:'Eryngium',K6:.25,J7:'Clematis',K7:.25,J8:'Grevillea',K8:.08,J9:'Kangoroo paw Red',K9:.25,J10:'Delphinium no NL',K10:.25,J11:'Cordyline',K11:.08,L6:'Colombia',M6:.25,L7:'Africa',M7:.25,L8:'Israel',M8:.08,L9:'Sanguisorba',M9:.25}))put(ref,v);
 }
 const basisQuantities=[];let sumCalculated=0,calculatedCount=0;
 rows.forEach(({source,detail,cost},i)=>{
  const r=first+i,cr=13+i,s=settings.get(cost.lineId),c=cost.componentAmounts;
  const cv=col=>comparison.cells.get(`${col}${cr}`)?.value;
  const computedTotal=nl?cost.totalCostKRW:cv('G');
  const computedUnit=cost.quantity===0?0:finite(computedTotal)?computedTotal/cost.quantity:'입력 필요';
  const stems=detail.stemQuantity,baseBasis=nl||profile.grouped?'STEM':profile.priceBasis||cost.unit;
  const factor=cost.quantity===0?1:baseBasis===cost.unit?1:baseBasis==='STEM'?cost.unit==='BUNCH'?s.stemsPerBunch:s.stemsPerBunch*s.bunchesPerBox:baseBasis==='BOX'?cost.unit==='BUNCH'?1/s.bunchesPerBox:1/(s.stemsPerBunch*s.bunchesPerBox):cost.unit==='STEM'?1/s.stemsPerBunch:s.bunchesPerBox;
  const q=cost.quantity===0?0:nl?stems:cost.quantity*factor;basisQuantities.push(q);
  put(`${profile.id==='TH_ORIGINAL_V1'?'C':'B'}${r}`,source.originalName);
  put(`${p.qty}${r}`,q);put(`${p.factor}${r}`,factor);
  put(`Y${header}`,'전산 단위');put(`Y${r}`,labelUnit(cost.unit));put(`Z${header}`,'계산 기준단위');put(`Z${r}`,labelUnit(baseBasis));
  if(profile.grouped){put(`AC${header}`,'원가 그룹');put(`AC${r}`,s.groupId);}
  if(nl){
   const currentGoods=cost.quantity===0?0:source.lineAmount,price=q?currentGoods/q:0,share=c.amountShare,cnf=q?(currentGoods+c.freightNative)/q:0;
   put(`F${r}`,price);put(`X${r}`,s.tariffRate);put('X14','적용 관세율');
   formula(`G${r}`,`IF(E${r}=0,0,E${r}*F${r}/$D$6)`,q?share:0);
   formula(`H${r}`,`IF(E${r}=0,0,F${r}+$C$11*G${r}/E${r})`,cnf);formula(`I${r}`,`E${r}*H${r}`,currentGoods+c.freightNative);
   formula(`J${r}`,`H${r}*$C$7`,q?(c.goodsKRW+c.freightKRW)/q:0);formula(`K${r}`,`J${r}*X${r}`,q?c.tariffKRW/q:0);
   formula(`L${r}`,`IF(E${r}=0,0,$Q$10*G${r}/E${r})`,q?c.customsKRW/q:0);
   formula(`M${r}`,`SUM(J${r}:L${r})`,q?cost.totalCostKRW/q:0);formula(`O${r}`,`M${r}*N${r}`,cost.costPerUnitKRW);formula(`P${r}`,`O${r}*1.1`,cost.costPerUnitKRW*1.1);
  }else{
   // The already verified per-country allocation model owns freight/GW/CW/CBM.
   // Keep its approved values in separate columns while this view recalculates.
   const us=profile.id==='US_ORIGINAL_V1';
   const data=profile.id==='TH_ORIGINAL_V1'?{base:'G',amount:'J',won:'K',tariff:'L',other:'M',arrival:'N'}:profile.id==='CN_SEA_ORIGINAL_V1'?{base:'F',amount:'J',won:'K',tariff:'L',other:'M',arrival:'N'}:compact?{base:us?'E':'F',amount:us?'F':'G',won:us?'G':'H',tariff:us?'H':'I',other:us?'I':'J',arrival:us?'J':'K'}:{base:'F',amount:'I',won:'J',tariff:'K',other:'L',arrival:'M'};
   put(`${data.base}${r}`,q?(c.goodsNative??c.cnfNative)/q:0);
   formula(`${data.amount}${r}`,`IF(ISNUMBER(${comparisonRef('Q',i)}),${comparisonRef('L',i)}+${comparisonRef('Q',i)},"입력 필요")`,finite(cv('Q'))?cv('L')+cv('Q'):'입력 필요');
   for(const[col,comp,val]of [[data.won,'R',c.cnfKRW??((c.goodsKRW??0)+(c.freightKRW??0))],[data.tariff,'S',c.tariffKRW??0],[data.other,'T',(c.customsKRW??0)+(c.otherKRW??0)]]){
    const expr=col===data.other?`SUM(${comparisonRef('T',i)},${comparisonRef('U',i)})`:comparisonRef(comp,i);
    const actual=col===data.other?finite(cv('T'))&&finite(cv('U'))?cv('T')+cv('U'):'입력 필요':cv(comp);
    formula(`${col}${r}`,`IF(${p.qty}${r}=0,0,IF(ISNUMBER(${comparisonRef(comp,i)}),${expr}/${p.qty}${r},"입력 필요"))`,q?finite(actual)?actual/q:'입력 필요':0);
   }
   formula(`${data.arrival}${r}`,`IF(${p.qty}${r}=0,0,IF(ISNUMBER(${comparisonRef('G',i)}),${comparisonRef('G',i)}/${p.qty}${r},"입력 필요"))`,q?finite(computedTotal)?computedTotal/q:'입력 필요':0);
   formula(`${p.unitCost}${r}`,`IF(ISNUMBER(${data.arrival}${r}),${data.arrival}${r}*${p.factor}${r},"입력 필요")`,computedUnit);
   if(!compact){
    const th=profile.id==='TH_ORIGINAL_V1',sea=profile.id==='CN_SEA_ORIGINAL_V1',ec=profile.id==='EC_ORIGINAL_V1';
    const freightCol=th?'H':sea?'H':'G',cnfCol=th||sea?'I':'H';
    // Reuse the verified model: a cancelled row may legitimately omit its ratio.
    const allocationShare=th?cv('M'):ec?cv('N'):0;
    formula(`${freightCol}${r}`,th?comparisonRef('M',i):ec?comparisonRef('N',i):`IF(${p.qty}${r}=0,0,IF(ISNUMBER(${comparisonRef('Q',i)}),${comparisonRef('Q',i)}/${p.qty}${r},"입력 필요"))`,th||ec?allocationShare:q?finite(cv('Q'))?cv('Q')/q:'입력 필요':0);
    formula(`${cnfCol}${r}`,`IF(${p.qty}${r}=0,0,IF(ISNUMBER(${data.amount}${r}),${data.amount}${r}/${p.qty}${r},"입력 필요"))`,q?finite(cv('Q'))?(cv('L')+cv('Q'))/q:'입력 필요':0);
    put(`${freightCol}${header}`,th||ec?'배분비':'운임(단위)');put(`${cnfCol}${header}`,'CNF(단위)');
    if(sea){put(`G${header}`,'박스비 세부');put(`G${r}`,'내역 미보유');}
   }
   for(const[col,v]of [[data.base,'상품/CNF'],[data.amount,'CNF 합계'],[data.won,'CNF(원화)'],[data.tariff,'관세'],[data.other,'통관(단위)'],[data.arrival,'원가(기준)']])put(`${col}${header}`,v);
  }
  formula(`${p.sale}${r}`,`IF(ISNUMBER(${p.input}${r}),${p.input}${r}/1.1,"")`,'');
  formula(`${p.recommend}${r}`,`IF(ISNUMBER(${p.unitCost}${r}),${p.unitCost}${r}/0.77,"")`,finite(computedUnit)?computedUnit/.77:'');
  formula(`${p.profit}${r}`,`IF(AND(ISNUMBER(${p.sale}${r}),ISNUMBER(${p.unitCost}${r})),${p.sale}${r}-${p.unitCost}${r},"")`,'');
  formula(`${p.margin}${r}`,`IF(OR(${p.sale}${r}="",${p.sale}${r}=0),"",${p.profit}${r}/${p.sale}${r})`,'');
  formula(`${p.sales}${r}`,`IF(ISNUMBER(${p.sale}${r}),${p.sale}${r}*${p.qty}${r}/${p.factor}${r},"")`,'');
  formula(`${p.profits}${r}`,`IF(ISNUMBER(${p.profit}${r}),${p.profit}${r}*${p.qty}${r}/${p.factor}${r},"")`,'');
  formula(`AD${r}`,`IF(ISNUMBER(${p.unitCost}${r}),${p.unitCost}${r}*${p.qty}${r}/${p.factor}${r},"입력 필요")`,computedTotal);
  if(finite(computedTotal)){sumCalculated+=computedTotal;calculatedCount++;}
 });
 const summary=header-1;
 if(!nl){
  const base=profile.id==='TH_ORIGINAL_V1'?'G':profile.id==='US_ORIGINAL_V1'?'E':'F';
  formula(compact?`${valueCol}5`:'D6',`SUMPRODUCT(${p.qty}${first}:${p.qty}${last},${base}${first}:${base}${last})`,goods);
  if(!compact)formula('AB4','$C$11',sum('freightNative'));
  if(profile.id==='TH_ORIGINAL_V1'){
   (input.costGroups||[]).forEach((g,i)=>{
    const initial=rows.filter(row=>settings.get(row.cost.lineId).groupId===g.groupId).reduce((sum,row)=>sum+Number(cells.get(`${p.qty}${first+rows.indexOf(row)}`)?.value||0),0);
    formula(`K${7+i}`,`SUMIF(AC${first}:AC${last},I${7+i},${p.qty}${first}:${p.qty}${last})+${g.quantity-initial}`,g.quantity);
   });
  }
 }
 const quantityUnit=nl||profile.grouped?'STEM':profile.priceBasis;
 for(const[col,v]of [[p.sale,'판매(VAT별도)'],[p.input,'매주 확인(VAT포함)'],[p.recommend,'참고가(/0.77)'],[p.profit,'단위 이익'],[p.margin,'이익률'],[p.sales,'총판매가'],[p.profits,'총이익'],[p.unitCost,'원가(단위)'],[p.qty,`수량(${quantityUnit?labelUnit(quantityUnit):'전산'})`],[p.factor,'환산수량']])put(`${col}${header}`,v);
 put(`${profile.id==='TH_ORIGINAL_V1'?'C':'B'}${header}`,'원문 품목');
 if(nl)for(const[col,v]of Object.entries({F:'FOB',G:'금액비율',H:'CNF(송이)',I:'CNF 합계',J:'CNF(원화)',K:'관세',L:'통관(송이)',M:'원가(송이)',P:'원가(VAT포함)'}))put(`${col}${header}`,v);
 for(const[col,v]of [[p.margin,'총이익률'],[p.sales,'총판매가'],[p.profits,'총이익']])put(`${col}${summary-1}`,v);
 formula(`${p.sales}${summary}`,`IF(COUNT(${p.input}${first}:${p.input}${last})=0,"",SUM(${p.sales}${first}:${p.sales}${last}))`,'');
 formula(`${p.profits}${summary}`,`IF(COUNT(${p.input}${first}:${p.input}${last})=0,"",SUM(${p.profits}${first}:${p.profits}${last}))`,'');
 formula(`${p.margin}${summary}`,`IF(OR(${p.sales}${summary}="",${p.sales}${summary}=0),"",${p.profits}${summary}/${p.sales}${summary})`,'');
 put('AA12','판매가 입력 행수');formula('AB12',`COUNT(${p.input}${first}:${p.input}${last})`,0);put('AA13','손익 합계 범위');put('AB13','판매가를 입력한 행만 집계');
 formula(qtyRef,`SUM(${p.qty}${first}:${p.qty}${last})`,basisQuantities.reduce((a,b)=>a+b,0));
 put(`AD${header}`,'품목 원가 합계');formula('AB7',`IF(COUNT(AD${first}:AD${last})=${rows.length},SUM(AD${first}:AD${last}),"입력 필요")`,calculatedCount===rows.length?sumCalculated:'입력 필요');
 formula('AB8','IF(ISNUMBER(AB7),ROUND(AB7-AB6,6),"입력 필요")',calculatedCount===rows.length?Math.round((sumCalculated-revision.totalCostKRW)*1e6)/1e6:'입력 필요');
 // Helpers are visible, editable and labelled, never silently zero-fill unknown bills.
 if(!nl&&!customsReference){put('AA10','통관 세부내역');put('AB10','내역 미보유 · 합계 AB5 적용');}
 const baseMoney=nl?['J','K','L','M','O','P']:compact?profile.id==='US_ORIGINAL_V1'?['G','H','I','J']:['H','I','J','K']:['TH_ORIGINAL_V1','CN_SEA_ORIGINAL_V1'].includes(profile.id)?['K','L','M','N']:['J','K','L','M'];
 const layout={...p,moneyCols:[...baseMoney,p.unitCost,p.sale,p.input,p.recommend,p.profit,p.sales,p.profits]};
 const exportTemplate=nl?{...template,cols:widenNlQuarantineAuditColumns(template.cols)}:template;
 return {xml:serialize(cells,exportTemplate,first,last,header,profile.detailPrototypeRow??first,layout,numberStyle),cells,fx:p.fx,nl,layout:p,first,gwRef,
  cwRef:compact?null:'E8',baseColumn:profile.id==='TH_ORIGINAL_V1'?'G':profile.id==='US_ORIGINAL_V1'?'E':'F'};
}
