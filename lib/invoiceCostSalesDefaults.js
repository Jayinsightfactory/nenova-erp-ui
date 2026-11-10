// Download-only reference sales projection. Never persists prices or changes cost snapshots.
import {createHash} from 'node:crypto';
import reference from './invoiceCostTemplates/sales-reference-v1.json' with {type:'json'};
import {RESTORED_COST_LAYOUTS} from './invoiceCostOriginalRestoration.js';
const HASH='9f70dd526e07beeedd93897dc6c40517147ea5b9dfe8ad92898303a2b3a3ff03';
const {assetHash,...payload}=reference;
if(assetHash!==HASH||createHash('sha256').update(JSON.stringify(payload)).digest('hex')!==HASH)throw Error('Unverified sales reference');
const layouts={...RESTORED_COST_LAYOUTS,
 AU_ORIGINAL_V1:{first:13,qty:'E',factor:'L',unitCost:'M',sale:'N',input:'O',recommend:'P',profit:'Q',margin:'R',sales:'S',profits:'T'},
 CO_42_1_ORIGINAL_V1:{first:15,qty:'E',factor:'N',unitCost:'O',sale:'P',input:'Q',recommend:'R',profit:'S',margin:'T',sales:'U',profits:'V'}};
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const decode=v=>v.replace(/&(?:amp|lt|gt|quot|apos);/g,c=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[c]));
const normalize=s=>String(s??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
export function findReferenceSale(records,names,factor){
 const keys=new Set(names.filter(Boolean).map(normalize));
 const matches=records.filter(r=>keys.has(normalize(r.name))&&finite(r.factor)&&Math.abs(r.factor-factor)<1e-8&&finite(r.price)&&r.price>=0);
 return matches.length&&new Set(matches.map(r=>r.price)).size===1?matches[0]:null;
}

export function applyCostSalesDefaults({sheet,profile,rows}){
 const p=layouts[profile.id],evidence=reference.profiles[profile.id];
 if(!p||!evidence||evidence.sourceHash!==profile.sourceHash||evidence.sourceSheet!==profile.sourceSheet)throw Error('Sales reference/profile mismatch');
 const first=p.first,last=first+rows.length-1,header=profile.headerRow??first-1,summary=header-1;
 const values=new Map(),styles=new Map();
 for(const m of sheet.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
  const ref=m[1].match(/\br="([A-Z]+\d+)"/)?.[1];if(!ref)continue;
  styles.set(ref,m[1].match(/\bs="(\d+)"/)?.[1]??'0');
  const raw=m[2]?.match(/<v>([\s\S]*?)<\/v>/)?.[1];
  if(raw!==undefined&&raw!==''&&!/\bt="(?:str|s|inlineStr)"/.test(m[1]))values.set(ref,Number(raw));
 }
 const edits=new Map(), put=(ref,value,formula)=>{
  if(finite(value)===false&&typeof value==='number')throw Error('Invalid sales calculation');
  const attrs=`r="${ref}" s="${styles.get(ref)??styles.get(`${p.input}${Number(ref.match(/\d+$/)[0])>=first?first:header}`)??'0'}"`;
  edits.set(ref,formula?`<c ${attrs}${finite(value)?'':' t="str"'}><f>${escape(formula)}</f><v>${escape(value??'')}</v></c>`:
   finite(value)?`<c ${attrs}><v>${value}</v></c>`:`<c ${attrs} t="inlineStr"><is><t>${escape(value)}</t></is></c>`);
 };
 put('B3',`${evidence.sourceSheet} 레퍼런스 기준가 자동 적용 · 실제 판매가 아님. ${p.input}열 수정 가능 · AE:AF열 근거 · ERP/승인 원가 변경 없음.`);
 put(`${p.input}${header}`,'기준판매가(VAT포함)\n매주 확인·수정 가능');
 put(`${p.recommend}${header}`,`추천가\n(원가/${evidence.divisor}${evidence.multiplier===1?'':`×${evidence.multiplier}`})`);
 put(`AE${header}`,'판매 기준');put(`AF${header}`,'기준 차수·셀');
 let salesTotal=0,profitTotal=0,salesCount=0,profitCount=0;
 rows.forEach(({source,detail},i)=>{
  const r=first+i,cost=values.get(`${p.unitCost}${r}`),qty=values.get(`${p.qty}${r}`),factor=values.get(`${p.factor}${r}`);
  const names=[source.originalName,source.prodName,source.matchedProdName,detail.prodName];
  const match=findReferenceSale(evidence.records,names,factor);
  const recommended=finite(cost)?cost/evidence.divisor*evidence.multiplier:undefined;
  const recFormula=`IF(ISNUMBER(${p.unitCost}${r}),${p.unitCost}${r}/${evidence.divisor}${evidence.multiplier===1?'':`*${evidence.multiplier}`},"")`;
  put(`${p.recommend}${r}`,recommended??'',recFormula);
  const price=qty===0?0:match?match.price:recommended;
  put(`${p.input}${r}`,price??'',match||qty===0?undefined:`IF(ISNUMBER(${p.recommend}${r}),${p.recommend}${r},"")`);
  const sale=finite(price)?price/1.1:undefined,profit=finite(sale)&&finite(cost)?sale-cost:undefined;
  const total=finite(sale)&&finite(qty)&&factor>0?sale*qty/factor:undefined;
  const profits=finite(profit)&&finite(qty)&&factor>0?profit*qty/factor:undefined;
  put(`${p.sale}${r}`,sale??'',`IF(ISNUMBER(${p.input}${r}),${p.input}${r}/1.1,"")`);
  put(`${p.profit}${r}`,profit??'',`IF(AND(ISNUMBER(${p.sale}${r}),ISNUMBER(${p.unitCost}${r})),${p.sale}${r}-${p.unitCost}${r},"")`);
  put(`${p.margin}${r}`,finite(profit)&&sale!==0?profit/sale:'',`IF(OR(${p.sale}${r}="",${p.sale}${r}=0),"",${p.profit}${r}/${p.sale}${r})`);
  put(`${p.sales}${r}`,total??'',`IF(ISNUMBER(${p.sale}${r}),${p.sale}${r}*${p.qty}${r}/${p.factor}${r},"")`);
  put(`${p.profits}${r}`,profits??'',`IF(ISNUMBER(${p.profit}${r}),${p.profit}${r}*${p.qty}${r}/${p.factor}${r},"")`);
  if(finite(total)){salesTotal+=total;salesCount++;}if(finite(profits)){profitTotal+=profits;profitCount++;}
  put(`AE${r}`,qty===0?'취소 수량 0':match?'레퍼런스 품목판매가 · 참고':'레퍼런스 추천식 · 자동');
  put(`AF${r}`,`${evidence.sourceSheet} · ${match?.cell??`${p.recommend}${profile.detailPrototypeRow??first}`} · ${match?match.name:`원가/${evidence.divisor}${evidence.multiplier===1?'':`×${evidence.multiplier}`}`}`);
 });
 const completeSales=salesCount===rows.length,completeProfit=profitCount===rows.length;
 for(const[col,value,count]of [[p.sales,salesTotal,completeSales],[p.profits,profitTotal,completeProfit]])
  put(`${col}${summary}`,count?value:'입력 필요',`IF(COUNT(${col}${first}:${col}${last})=${rows.length},SUM(${col}${first}:${col}${last}),"입력 필요")`);
 put(`${p.margin}${summary}`,completeSales&&completeProfit&&salesTotal!==0?profitTotal/salesTotal:'',`IF(AND(ISNUMBER(${p.sales}${summary}),ISNUMBER(${p.profits}${summary}),${p.sales}${summary}<>0),${p.profits}${summary}/${p.sales}${summary},"")`);
 // CO AB12 is the fifth group's kg/box input, including when that group has
 // zero boxes. COUNT(sales) here creates a cycle through the SUMPRODUCT weight
 // denominator and every cost -> recommendation -> sales formula. Keep the
 // original weight table intact and put diagnostics outside calculation inputs.
 if(styles.has('AA12')){
  const refs=profile.id==='CO_42_1_ORIGINAL_V1'
   ? ['AK14','AL14','AK15','AL15'] : ['AA12','AB12','AA13','AB13'];
  put(refs[0],'기준판매가 적용 행수');put(refs[1],salesCount,`COUNT(${p.input}${first}:${p.input}${last})`);
  put(refs[2],'손익 합계 기준');put(refs[3],'자동 기준가 · 실판매 아님');
 }
 // Keep every cost/metadata cell intact; rewrite only the explicit sales projection.
 sheet=sheet.replace(/<row\b([^>]*)>([\s\S]*?)<\/row>/g,(whole,attrs,body)=>{
  const r=Number(attrs.match(/\br="(\d+)"/)?.[1]);
  body=body.replace(/<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g,(cell,a)=>{
   const ref=a.match(/\br="([A-Z]+\d+)"/)?.[1];if(!edits.has(ref))return cell;
   const changed=edits.get(ref);edits.delete(ref);return changed;
  });
  for(const[ref,data]of edits)if(Number(ref.match(/\d+$/)[0])===r){body+=data;edits.delete(ref);}
  const colNumber=c=>[...c].reduce((n,v)=>n*26+v.charCodeAt(0)-64,0);
  const cells=[...body.matchAll(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g)].map(m=>m[0]);
  cells.sort((a,b)=>colNumber(a.match(/r="([A-Z]+)/)[1])-colNumber(b.match(/r="([A-Z]+)/)[1]));
  const rowAttrs=r===header?attrs.replace(/\s(?:ht|customHeight)="[^"]*"/g,'')+' ht="64" customHeight="1"':attrs;
  return `<row${rowAttrs}>${cells.join('')}</row>`;
 });
 if(edits.size)throw Error('Missing sales projection rows');
 sheet=sheet.replace(/(<dimension ref="[A-Z]+\d+:)([A-Z]+)(\d+)("\/?>)/,(all,a,c,r,end)=>c.length>2||c.length===2&&c>='AF'?all:`${a}AF${r}${end}`);
 // Source notes need readable columns, not inherited narrow/default width.
 return sheet.replace(/<cols>([\s\S]*?)<\/cols>/,(_,block)=>{
  const columns=[];
  for(const m of block.matchAll(/<col\b[^>]*\/>/g)){
   const min=Number(m[0].match(/\bmin="(\d+)"/)[1]),max=Number(m[0].match(/\bmax="(\d+)"/)[1]);
   for(const[a,b]of [[min,Math.min(max,30)],[Math.max(min,33),max]])if(a<=b)
    columns.push({min:a,xml:m[0].replace(/\bmin="\d+"/,`min="${a}"`).replace(/\bmax="\d+"/,`max="${b}"`)});
  }
  columns.push({min:31,xml:'<col min="31" max="31" width="33" customWidth="1"/>'},{min:32,xml:'<col min="32" max="32" width="49" customWidth="1"/>'});
  return `<cols>${columns.sort((a,b)=>a.min-b.min).map(c=>c.xml).join('')}</cols>`;
 });
}

// Preserve precision underneath; whole-KRW sales displays also fit narrow source totals.
export function formatCostSalesProjection({sheet,styles,profile,count}){
 const p=layouts[profile.id],summary=(profile.headerRow??p.first-1)-1;
 const block=styles.match(/<cellXfs\b([^>]*)>([\s\S]*?)<\/cellXfs>/);
 if(!block)throw Error('Missing sales styles');
 const existing=[...block[2].matchAll(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g)].map(m=>m[0]),added=[],map=new Map();
 const money=new Set([p.input,p.sale,p.recommend,p.profit,p.sales,p.profits]);
 sheet=sheet.replace(/<c\b([^>]*?)(\/>|>)/g,(whole,attrs,end)=>{
  const m=attrs.match(/\br="([A-Z]+)(\d+)"/);if(!m)return whole;
  const row=Number(m[2]);
  const wrapHeader=profile.id==='TH_ORIGINAL_V1'&&row===summary+1&&[p.input,p.recommend].includes(m[1]);
  if(!wrapHeader&&!(row>=p.first&&row<p.first+count&&money.has(m[1])||row===summary&&[p.sales,p.profits].includes(m[1])))return whole;
  const id=attrs.match(/\bs="(\d+)"/)?.[1]??'0';
  const key=`${wrapHeader?'wrap':'money'}:${id}`;
  if(!map.has(key)){
   let xf=existing[Number(id)];if(!xf)throw Error('Invalid sales style');
   if(wrapHeader){
    // A newline alone is not rendered as a wrapped header by desktop Excel.
    // Clone, never alter the original font/fill/border or shared alignment.
    if(!/<alignment\b/.test(xf))throw Error('Missing Thai header alignment');
    xf=xf.replace(/<alignment\b([^>]*?)\/>/,(_,a)=>`<alignment${a.replace(/\s+wrapText="[^"]*"/g,'')} wrapText="1"/>`);
   }else{
   xf=/\bnumFmtId=/.test(xf)?xf.replace(/\bnumFmtId="\d+"/,'numFmtId="3"'):xf.replace('<xf','<xf numFmtId="3"');
   xf=/\bapplyNumberFormat=/.test(xf)?xf.replace(/\bapplyNumberFormat="[^"]*"/,'applyNumberFormat="1"'):xf.replace('<xf','<xf applyNumberFormat="1"');
   }
   map.set(key,existing.length+added.length);added.push(xf);
  }
  return `<c${attrs.replace(/\bs="\d+"/,`s="${map.get(key)}"`)}${end}`;
 });
 styles=styles.replace(block[0],`<cellXfs${block[1].replace(/count="\d+"/,`count="${existing.length+added.length}"`)}>${block[2]}${added.join('')}</cellXfs>`);
 return {sheet,styles};
}
