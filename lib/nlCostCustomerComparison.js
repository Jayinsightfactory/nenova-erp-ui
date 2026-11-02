import {createHash} from 'node:crypto';
import {isFreightItem} from './freightCalc.js';

const fail=message=>{throw Object.assign(new Error(message),{statusCode:422});};
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const quantity=(v,signed=false)=>{if(typeof v!=='number'||!Number.isFinite(v)||(!signed&&v<0))fail('주광 비교 수량의 단위·누락값을 확인하세요.');return v;};
const xml=v=>String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

// No customer owns a native WarehouseDetail. These are reporting estimates only.
export function buildNlCustomerComparison({orderYear,orderWeek,warehouseKey=null,customers,orders,receipts}){
 if(typeof orderYear!=='string'||typeof orderWeek!=='string'||!/^\d{4}$/.test(orderYear)||!/^\d{2}-\d{2}$/.test(orderWeek))fail('주광 비교 연도·세부차수를 확인하세요.');
 if(warehouseKey!==null&&(!Number.isSafeInteger(warehouseKey)||warehouseKey<1))fail('주광 비교 입고번호를 확인하세요.');
 const owners=customers.filter(c=>['CL2','YCL2'].includes(String(c.OrderCode||'').trim().toUpperCase()));
 if(owners.length!==1)fail('주광(CL2/YCL2) 활성 업체 연결이 유일하지 않습니다. 업체 코드를 확인하세요.');
 const ownKey=owners[0].CustKey,map=new Map();
 const item=r=>{if(!Number.isSafeInteger(r.ProdKey)||r.ProdKey<1||typeof r.ProdName!=='string'||!r.ProdName.trim())fail('주광 비교 품목키·이름을 확인하세요.');
  if(!map.has(r.ProdKey))map.set(r.ProdKey,{prodKey:r.ProdKey,name:r.ProdName,ownOrder:0,otherOrder:0,current:0,prior:0,otherReceipts:0});return map.get(r.ProdKey);};
 const scope=r=>r.OrderYear===orderYear&&r.OrderWeek===orderWeek;
 for(const r of orders.filter(scope).filter(r=>!isFreightItem(r.ProdName))){const p=item(r);p[r.CustKey===ownKey?'ownOrder':'otherOrder']+=quantity(r.SteamQuantity,true);}
 const seen=new Set();
 for(const r of [...receipts].filter(scope).filter(r=>!isFreightItem(r.ProdName)).sort((a,b)=>a.WarehouseKey-b.WarehouseKey||a.WdetailKey-b.WdetailKey)){
  const key=`${r.WarehouseKey}:${r.WdetailKey}`;if(seen.has(key))fail('주광 비교 입고 상세가 중복되었습니다.');seen.add(key);
  const p=item(r),q=quantity(r.SteamQuantity);
  if(warehouseKey===null||r.WarehouseKey===warehouseKey)p.current+=q;
  else{p.otherReceipts+=q;if(r.WarehouseKey<warehouseKey)p.prior+=q;}
 }
 const rows=[...map.values()].map(p=>{const demand=Math.max(0,p.ownOrder),own=Math.min(Math.max(0,demand-p.prior),p.current),weekOwn=Math.min(demand,p.current+p.otherReceipts);
  return {...p,group:p.ownOrder>0?'주광':'기타',own,other:p.current-own,weekOwn,weekOther:p.current+p.otherReceipts-weekOwn,shared:p.ownOrder>0&&p.otherOrder>0};
 }).sort((a,b)=>(a.group==='주광'?0:1)-(b.group==='주광'?0:1)||a.name.localeCompare(b.name,'ko')||a.prodKey-b.prodKey);
 return {orderYear,orderWeek,warehouseKey,customerKey:ownKey,customerCode:owners[0].OrderCode,rows,digest:hash({orderYear,orderWeek,warehouseKey,customers,orders,receipts})};
}

export async function readNlCustomerComparison({queryFn,types,orderYear,orderWeek,warehouseKey=null}){
 if(typeof orderYear!=='string'||typeof orderWeek!=='string'||!/^\d{4}$/.test(orderYear)||!/^\d{2}-\d{2}$/.test(orderWeek))fail('주광 비교 연도·세부차수를 확인하세요.');
 const params={orderYear:{type:types.NVarChar(4),value:orderYear},orderWeek:{type:types.NVarChar(5),value:orderWeek}};
 const result=await queryFn(`/* nl-cost:readonly-customer-comparison */
 SELECT CustKey,OrderCode FROM dbo.Customer WHERE ISNULL(isDeleted,0)=0 AND UPPER(LTRIM(RTRIM(OrderCode))) IN(N'CL2',N'YCL2') ORDER BY CustKey;
 SELECT TOP(20001) om.OrderYear,om.OrderWeek,om.CustKey,od.ProdKey,p.ProdName,CAST(od.SteamQuantity AS decimal(28,8)) SteamQuantity
 FROM dbo.OrderMaster om JOIN dbo.OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey
 JOIN dbo.Customer c ON c.CustKey=om.CustKey JOIN dbo.Product p ON p.ProdKey=od.ProdKey
 WHERE om.OrderYear=@orderYear AND om.OrderWeek=@orderWeek AND ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0
 AND ISNULL(c.isDeleted,0)=0 AND ISNULL(p.isDeleted,0)=0 AND (p.CounName LIKE N'네덜란드%' OR p.CounName=N'NL') ORDER BY om.OrderMasterKey,od.OrderDetailKey;
 SELECT TOP(20001) wm.OrderYear,wm.OrderWeek,wm.WarehouseKey,wd.WdetailKey,wd.ProdKey,p.ProdName,CAST(wd.SteamQuantity AS decimal(28,8)) SteamQuantity
 FROM dbo.WarehouseMaster wm JOIN dbo.WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey JOIN dbo.Product p ON p.ProdKey=wd.ProdKey
 WHERE wm.OrderYear=@orderYear AND wm.OrderWeek=@orderWeek AND ISNULL(wm.isDeleted,0)=0
 AND (p.CounName LIKE N'네덜란드%' OR p.CounName=N'NL') ORDER BY wm.WarehouseKey,wd.WdetailKey;`,params);
 if(result.recordsets?.length!==3||result.recordsets.some(r=>!Array.isArray(r)))fail('주광 비교 주문·입고 조회 결과를 확인하지 못했습니다.');
 const [customers,orders,receipts]=result.recordsets;
 if(orders.length>20000||receipts.length>20000)fail('주광 비교 조회 범위가 너무 큽니다.');
 return buildNlCustomerComparison({orderYear,orderWeek,warehouseKey,customers,orders,receipts});
}

export async function nlComparisonForExport({document,queryFn,types,warehouseKey=document.warehouseKey??null}){
 if(document.reviewedMetadata?.country!=='NL')return null;
 return readNlCustomerComparison({queryFn,types,orderYear:document.orderYear,orderWeek:document.orderWeek,warehouseKey});
}

export function nlCustomerComparisonSheet({comparison,rows,snapshot,headerStyle,numericStyle,nameStyle='0'}){
 const cells=new Map(),put=(ref,value,formula)=>cells.set(ref,{value,formula}),totals={own:0,other:0,ownOrder:0,otherOrder:0,ownCost:0,otherCost:0,unknownOwn:false,unknownOther:false};
 const byProd=new Map(),settings=new Map(snapshot.input.lineInputs.map(l=>[l.lineId,l]));
 rows.forEach(({source,cost},i)=>{const list=byProd.get(source.prodKey)||[],s=settings.get(cost.lineId);
  const q=cost.quantity===0?0:cost.quantity*(cost.unit==='STEM'?1:cost.unit==='BUNCH'?s.stemsPerBunch:s.stemsPerBunch*s.bunchesPerBox);
  list.push({r:15+i,q,amount:cost.totalCostKRW});byProd.set(source.prodKey,list);});
 put('A1','주광·기타 주문 입고 원가');put('A2',`${comparison.orderYear}/${comparison.orderWeek} · ${comparison.warehouseKey===null?'전산 차수 전체 입고':'입고 #'+comparison.warehouseKey} · 수량: 송이 / 금액: 원`);
 put('A3','주광 주문량 우선 배분(추정). 입고번호·상세번호 순서. 실제 업체 귀속 아님. 기타=주광 제외. '+(comparison.warehouseKey===null?'인보이스 단가를 차수 입고수량에 적용한 비교값.':'원가는 이 파일 계산본 기준.'));
 put('A4','구분');put('B4','주문수량(송이)');put('C4',comparison.warehouseKey===null?'차수 입고배분(추정)':'이번 입고배분(추정)');put('D4',comparison.warehouseKey===null?'비교원가(원)':'배분원가(원)');
 put('A5','주광(CL2)');put('A6','기타');put('A7','전체');
 const headings=['구분','품목','도착원가\n(송이)','주광 주문','주광 입고\n배분(추정)','기타 주문합계','기타 입고\n배분(추정)','이번 실제입고','주광 배분원가','기타 배분원가','공동 주문','차수 주광누적\n(추정)','차수 기타누적\n(추정)','앞선 입고','다른 송장 입고'];
 headings.forEach((v,i)=>put(`${String.fromCharCode(65+i)}8`,v));
 if(comparison.warehouseKey===null){put('H8','차수 실제입고');put('I8','주광 비교원가');put('J8','기타 비교원가');}
 const reportRows=[...comparison.rows],known=new Set(reportRows.map(p=>p.prodKey));
 for(const {source}of rows)if(!known.has(source.prodKey)){known.add(source.prodKey);reportRows.push({prodKey:source.prodKey,name:source.originalName,group:'기타',ownOrder:0,otherOrder:0,current:0,own:0,other:0,weekOwn:0,weekOther:0,prior:0,otherReceipts:0,shared:false});}
 reportRows.forEach((p,i)=>{
  const r=9+i,source=byProd.get(p.prodKey)||[],q=source.reduce((n,s)=>n+s.q,0),cost=q>0?source.reduce((n,s)=>n+s.amount,0)/q:null;
  if(comparison.warehouseKey!==null&&Math.abs(q-p.current)>0.00001)fail('주광 비교 입고수량과 원가의 송이수량이 다릅니다. 다시 조회하세요.');
  const refs=source.map(s=>`'원본 양식 계산'!E${s.r}`),amounts=source.map(s=>`'원본 양식 계산'!E${s.r}*'원본 양식 계산'!M${s.r}`);
  put(`A${r}`,p.group);put(`B${r}`,p.name);
  put(`C${r}`,cost??'-',source.length?`IF(SUM(${refs.join(',')})=0,"-",SUM(${amounts.join(',')})/SUM(${refs.join(',')}))`:undefined);
  put(`D${r}`,p.ownOrder);put(`E${r}`,p.own,`MIN(MAX(0,D${r}-N${r}),H${r})`);put(`F${r}`,p.otherOrder);
  put(`G${r}`,p.other,`H${r}-E${r}`);put(`H${r}`,p.current);
  for(const [col,qty]of [['I','E'],['J','G']])put(`${col}${r}`,p[qty==='E'?'own':'other']===0?0:cost===null?'원가 미확인':p[qty==='E'?'own':'other']*cost,`IF(${qty}${r}=0,0,IF(ISNUMBER(C${r}),${qty}${r}*C${r},"원가 미확인"))`);
  put(`K${r}`,p.shared?'공동 주문':'');put(`L${r}`,p.weekOwn,`MIN(MAX(0,D${r}),H${r}+O${r})`);put(`M${r}`,p.weekOther,`H${r}+O${r}-L${r}`);
  put(`N${r}`,p.prior);put(`O${r}`,p.otherReceipts);
  totals.own+=p.own;totals.other+=p.other;totals.ownOrder+=p.ownOrder;totals.otherOrder+=p.otherOrder;
  if(cost===null){totals.unknownOwn||=p.own>0;totals.unknownOther||=p.other>0;}else{totals.ownCost+=p.own*cost;totals.otherCost+=p.other*cost;}
 });
 const last=8+reportRows.length;
 for(const [r,ord,qty,amount,orderValue,qtyValue,costValue,unknown]of [[5,'D','E','I',totals.ownOrder,totals.own,totals.ownCost,totals.unknownOwn],[6,'F','G','J',totals.otherOrder,totals.other,totals.otherCost,totals.unknownOther]]){
  put(`B${r}`,orderValue,`SUM(${ord}9:${ord}${last})`);put(`C${r}`,qtyValue,`SUM(${qty}9:${qty}${last})`);
  put(`D${r}`,unknown?'원가 미확인':costValue,`IF(COUNTIF(${amount}9:${amount}${last},"원가 미확인")>0,"원가 미확인",SUM(${amount}9:${amount}${last}))`);
 }
 put('B7',totals.ownOrder+totals.otherOrder,'SUM(B5:B6)');put('C7',totals.own+totals.other,'SUM(C5:C6)');
 put('D7',totals.unknownOwn||totals.unknownOther?'원가 미확인':totals.ownCost+totals.otherCost,'IF(COUNTIF(D5:D6,"원가 미확인")>0,"원가 미확인",SUM(D5:D6))');
 const rowMap=new Map();for(const[ref,c]of cells){const r=Number(ref.match(/\d+/)[0]),a=rowMap.get(r)||[],numeric=typeof c.value==='number';
  const style=[4,8].includes(r)?headerStyle:ref.startsWith('B')&&r>=9?nameStyle:numeric||c.formula?numericStyle:'0';
  a.push(`<c r="${ref}" s="${style}"${numeric?'':c.formula?' t="str"':' t="inlineStr"'}>${c.formula?`<f>${xml(c.formula)}</f><v>${xml(c.value)}</v>`:numeric?`<v>${c.value}</v>`:`<is><t>${xml(c.value)}</t></is>`}</c>`);rowMap.set(r,a);}
 const widths=[12,46,18,16,21,18,21,18,19,19,14,23,23,18,19];
 return `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:O${last}"/><sheetViews><sheetView workbookViewId="0" tabSelected="1" showGridLines="0"><pane xSplit="2" ySplit="8" topLeftCell="C9" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="24"/><cols>${widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${[...rowMap].sort(([a],[b])=>a-b).map(([r,a])=>{const length=r>=9?[...(reportRows[r-9]?.name||'')].reduce((n,c)=>n+(c.charCodeAt(0)>255?2:1),0):0;return `<row r="${r}" ht="${[4,8].includes(r)?42:Math.max(24,Math.ceil(length/46)*16)}" customHeight="1">${a.join('')}</row>`;}).join('')}</sheetData><autoFilter ref="A8:O${last}"/><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}

export function markNlCustomerRows(sheet,rows,comparison){
 const byProd=new Map(comparison.rows.map(p=>[p.prodKey,p]));
 for(const [ref,label]of [['A14','주문 구분'],...rows.map((row,i)=>[`A${15+i}`,byProd.get(row.source.prodKey)?.group||'기타'])]){
  const cell=`<c r="${ref}" s="0" t="inlineStr"><is><t>${xml(label)}</t></is></c>`;
  const re=new RegExp(`<c\\b[^>]*r="${ref}"[^>]*(?:/>|>[\\s\\S]*?</c>)`);
  if(re.test(sheet))sheet=sheet.replace(re,cell);else sheet=sheet.replace(new RegExp(`(<row[^>]*r="${ref.match(/\d+/)[0]}"[^>]*>)`),`$1${cell}`);
 }
 return sheet.replace(/<col\b(?=[^>]*min="1")(?=[^>]*max="1")[^>]*\/>/,c=>c.replace(/width="[^"]*"/,'width="12"'));
}
