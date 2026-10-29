import { createHash } from 'node:crypto';
import content from './invoiceCostTemplates/australia-content.json' with { type: 'json' };
import { auNumber, initialAuOriginalInputs, calculateAuOriginalCustoms } from './auOriginalCostInputs.js';

const HASH = '229876192d96e6768bfae274a187afa93b452142f3a0ab5ffa430c3f64a7e013';
const xml = v => String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const rowOf = ref => Number(ref.match(/\d+$/)[0]);

// Separate editable original-layout calculation. Persisted approved amounts are never rewritten.
export function originalAustraliaCostSheet({document,revision,snapshot,rows,template}) {
  const {assetHash,...payload}=content;
  if(assetHash!==HASH || createHash('sha256').update(JSON.stringify(payload)).digest('hex')!==HASH
    || content.sourceHash!==template.sourceHash) throw new Error('Unverified AU content');
  const cells=new Map(), put=(ref,value)=>cells.set(ref,{value}), formula=(ref,f,value)=>cells.set(ref,{formula:f,value});
  Object.entries(content.labels).forEach(([ref,value])=>put(ref,value));
  Object.entries(content.defaults).forEach(([ref,value])=>put(ref,value));
  // Restore both row-level sales and the top summary; correct source spelling only.
  Object.entries({N12:'판매(부가세 별도)',O12:'판매가(부가세 포함)\n매주 확인 · 직접 입력',Q12:'이익',R12:'이익률',
    S12:'총판매가',T12:'총이익',R10:'총이익률',S10:'총판매가',T10:'총이익',O11:'<영업부 · 판매가 입력>'}).forEach(([ref,value])=>put(ref,value));
  const input=snapshot.input, settings=new Map(input.lineInputs.map(l=>[l.lineId,l]));
  const {inputs:a,total:originalTotal}=calculateAuOriginalCustoms(initialAuOriginalInputs(document,input));
  const formulaMode=input.auOriginalMode==='FORMULA';
  const totalCustoms=formulaMode?originalTotal:auNumber(input.customsTotalKRW);
  const last=12+rows.length;
  // Quantities come from the validated cost price basis, never invoice string guesses.
  const quantities=rows.map(({cost})=>{
    const s=settings.get(cost.lineId);
    if(cost.quantity===0)return 0;
    return cost.quantity*(cost.unit==='BUNCH'?1:cost.unit==='STEM'?1/s.stemsPerBunch:s.bunchesPerBox);
  });
  const bunches=quantities.reduce((a,b)=>a+b,0), goods=rows.reduce((n,{cost})=>n+cost.componentAmounts.cnfNative,0);
  const test=input.exchangeRateType==='TEST_ONLY'||/TEST_ONLY/i.test(`${input.costSourceId||''} ${input.estimateSource||''}`);
  put('B1',`PREMIUM GREENS ${document.orderYear}/${document.orderWeek} 원본 양식 · ${test?'TEST_ONLY 시험값 · ':''}미승인 계산본`);
  put('B3','O열에 현재 판매가(부가세 포함)를 입력하면 N·Q:T열과 상단 손익 합계가 계산됩니다. 판매가 미입력은 누락이 아닌 입력 대기입니다.');
  put('D4',`${document.orderYear}/${document.orderWeek}`); put('D6',input.exchangeRateKRW);
  put('D7',a.gw ?? '입력 필요'); put('B8','품목수'); put('D8',a.itemCount ?? '입력 필요');
  formula('D5',`SUM(G13:G${last})`,goods); formula('F5',`SUM(G13:G${last})`,goods);
  formula('D9',`SUM(E13:E${last})`,bunches);
  const boxes=rows.map(({source})=>auNumber(source.boxQuantity));
  put('I8',boxes.every(v=>v!==null)?boxes.reduce((a,b)=>a+b,0):'미확인');
  put('M4','통관비 · 원본 기본값(수정 가능)');
  put('N6',a.clearanceFeeKRW ?? '입력 필요'); put('N8',a.domesticTransportKRW ?? '입력 필요');
  put('V14','백상 원/kg'); put('W14',a.baeksangRateKRW ?? '입력 필요');
  put('V15','검역 원/품목'); put('W15',a.inspectionRateKRW ?? '입력 필요');
  formula('N5','IF(AND(ISNUMBER(D7),ISNUMBER(W14)),D7*W14,"입력 필요")',a.gw!==null&&a.baeksangRateKRW!==null?a.gw*a.baeksangRateKRW:'입력 필요');
  formula('N7','IF(AND(ISNUMBER(D8),ISNUMBER(W15)),D8*W15,"입력 필요")',a.itemCount!==null&&a.inspectionRateKRW!==null?a.itemCount*a.inspectionRateKRW:'입력 필요');
  formula('N9','IF(COUNT(N5:N8)=4,SUM(N5:N8),"입력 필요")',originalTotal ?? '입력 필요');
  put('V17','통관비 적용 방식'); put('W17',formulaMode?'원본 수식':'합계 직접 입력');
  put('V18','직접 입력 통관비'); if(!formulaMode)put('W18',totalCustoms ?? '입력 필요');
  put('V19','적용 통관비'); formula('W19','IF(ISNUMBER(W18),W18,N9)',totalCustoms ?? '입력 필요');
  put('V20','기존 계산본 합계'); put('W20',revision.totalCostKRW);
  put('V21','원본 양식 합계'); put('V22','기존 계산본 차이');
  put('V2','38-1 과거 참고판매가 · 현재 판매가 아님');
  content.referencePrices.forEach((p,i)=>{put(`V${i+3}`,p.name);put(`W${i+3}`,p.price);});
  put('J5','원본 세율 메모(현행 확인 아님)');
  let sum=0, calculable=totalCustoms!==null&&bunches>0;
  rows.forEach(({source,cost},i)=>{
    const r=13+i,s=settings.get(cost.lineId),q=quantities[i];
    const price=q?cost.componentAmounts.cnfNative/q:0, won=price*input.exchangeRateKRW;
    const rate=q===0?0:s.tariffRate;
    const tariff=won*rate, customs=calculable&&q>0?totalCustoms/bunches:0, arrival=won+tariff+customs;
    put(`B${r}`,source.originalName);put(`E${r}`,q);put(`F${r}`,price);put(`L${r}`,1);
    formula(`G${r}`,`E${r}*F${r}`,q*price);formula(`H${r}`,`F${r}*$D$6`,won);
    formula(`I${r}`,`H${r}*${rate}`,tariff);
    formula(`J${r}`,`IF(E${r}=0,0,IF(AND(ISNUMBER($W$19),$D$9>0),$W$19/$D$9,"입력 필요"))`,calculable?customs:'입력 필요');
    formula(`K${r}`,`IF(ISNUMBER(J${r}),H${r}+I${r}+J${r},"입력 필요")`,calculable?arrival:'입력 필요');
    formula(`M${r}`,`IF(ISNUMBER(K${r}),K${r}*L${r},"입력 필요")`,calculable?arrival:'입력 필요');
    formula(`N${r}`,`IF(ISNUMBER(O${r}),O${r}/1.1,"")`,'');
    formula(`P${r}`,`IF(ISNUMBER(M${r}),M${r}/0.77,"")`,calculable?arrival/0.77:'');
    formula(`Q${r}`,`IF(AND(ISNUMBER(N${r}),ISNUMBER(M${r})),N${r}-M${r},"")`,'');
    formula(`R${r}`,`IF(OR(N${r}="",N${r}=0),"",Q${r}/N${r})`,'');
    formula(`S${r}`,`IF(ISNUMBER(N${r}),N${r}*E${r}/L${r},"")`,'');
    formula(`T${r}`,`IF(ISNUMBER(Q${r}),E${r}*Q${r}/L${r},"")`,'');
    sum+=q*arrival;
  });
  formula('S11',`IF(COUNT(O13:O${last})=0,"",SUM(S13:S${last}))`,'');
  formula('T11',`IF(COUNT(O13:O${last})=0,"",SUM(T13:T${last}))`,'');
  formula('R11','IF(OR(S11="",S11=0),"",T11/S11)','');
  formula('W21',`IF(COUNT(K13:K${last})=${rows.length},SUMPRODUCT(E13:E${last},K13:K${last}),"입력 필요")`,calculable?sum:'입력 필요');
  formula('W22','IF(ISNUMBER(W21),ROUND(W21-W20,6),"")',calculable?Math.round((sum-revision.totalCostKRW)*1e6)/1e6:'');
  const styles=new Map(template.rows.flatMap(row=>row.cells.map(c=>[c.ref,c.style])));
  for(let r=13;r<=last;r++) for(const col of 'BCDEFGHIJKLMNOPQRST') if(!cells.has(`${col}${r}`))put(`${col}${r}`,undefined);
  for(const row of template.rows) for(const c of row.cells) if(rowOf(c.ref)<=Math.max(last,22)&&!cells.has(c.ref))put(c.ref,undefined);
  const byRow=new Map();
  for(const [ref,cell] of cells){
    if(typeof cell.value==='number'&&!Number.isFinite(cell.value))throw new Error('Invalid AU cell');
    const r=rowOf(ref),style=styles.get(ref)??styles.get(ref.replace(/\d+$/,'13'))??'0',numeric=typeof cell.value==='number';
    const attrs=`r="${ref}" s="${style}"`;
    const data=cell.value===undefined?`<c ${attrs}/>`:cell.formula?`<c ${attrs}${numeric?'':' t="str"'}><f>${xml(cell.formula)}</f><v>${xml(cell.value)}</v></c>`:numeric?`<c ${attrs}><v>${cell.value}</v></c>`:`<c ${attrs} t="inlineStr"><is><t xml:space="preserve">${xml(cell.value)}</t></is></c>`;
    const entries=byRow.get(r)||[];entries.push({ref,data});byRow.set(r,entries);
  }
  const sheetData=[...byRow].sort(([a],[b])=>a-b).map(([r,cells])=>`<row r="${r}" ht="${r===12?42:r>=13?30:r===3?30:22}" customHeight="1">${cells.sort((a,b)=>a.ref.replace(/\d+$/,'').length-b.ref.replace(/\d+$/,'').length||a.ref.localeCompare(b.ref)).map(c=>c.data).join('')}</row>`).join('');
  const merges=[...template.merges,'B3:T3',...Array.from({length:rows.length},(_,i)=>`B${13+i}:D${13+i}`)];
  return `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="B1:Y${Math.max(last,22)}"/><sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="12" topLeftCell="B13" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${template.sheetFormatPr}${template.cols}<sheetData>${sheetData}</sheetData><mergeCells count="${merges.length}">${merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells>${template.print}</worksheet>`;
}
