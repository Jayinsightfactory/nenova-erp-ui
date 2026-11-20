import JSZip from 'jszip';
import {createSharedAwbCostWorkbook} from './invoiceReceiptCostExport.js';
import {INVOICE_COST_EXPORT_PROFILES} from './invoiceCostExportProfiles.js';
import {applyCostSalesDefaults} from './invoiceCostSalesDefaults.js';
import {CO_AWB_GROUP_COEFFICIENTS} from './invoiceSharedAwbCost.js';
const xml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const fail=message=>{throw Object.assign(Error(message),{statusCode:422});};
const groups=['ROSE','CARNATION','ALSTROMERIA','RUSCUS','HYDRANGEA'];
const sum=(rows,key)=>rows.reduce((n,row)=>n+(row[key]??0),0);
const near=(a,b)=>Math.abs(a-b)<1e-4;

// New exact-week export only. Legacy per-invoice/AWB exports and historical
// source assets are not edited. All current rows occupy one original cost table.
export async function createColombiaWeekCostWorkbook({prepared,calculation}){
 if(calculation?.status!=='CALCULATED'||prepared?.issues?.length||calculation.scope.orderYear!==prepared.scope.orderYear||calculation.scope.orderWeek!==prepared.scope.orderWeek)fail('전체 입고·비용 귀속 검증을 통과한 계산만 다운로드합니다.');
 const sources=new Map(prepared.documents.flatMap(document=>document.receiptLines.map(line=>[line.lineId,{...line,farmName:document.reviewedMetadata.farmName}])));
 if(sources.size!==calculation.lines.length||calculation.lines.some(line=>!sources.has(line.lineId)))fail('현재 입고 전체와 계산행이 다릅니다.');
 const lineInputs=calculation.results.flatMap(({result})=>result.lineInputs),allGroups=calculation.results.flatMap(({result})=>result.costGroups);
 if(lineInputs.some(line=>!(line.stemsPerBunch>0)))fail('원본 단당 송이수 확인이 필요한 행이 있습니다.');
 const costGroups=groups.map(groupId=>{const entries=allGroups.filter(group=>group.groupId===groupId);return{groupId,quantity:sum(entries,'quantity'),boxQuantity:sum(entries,'boxQuantity'),fullBoxEquivalent:sum(entries,'fullBoxEquivalent'),grossWeightKg:sum(entries,'grossWeightKg'),volumeWeightKg:sum(entries,'volumeWeightKg')};}).filter(group=>group.quantity>0);
 const first=prepared.documents[0],totalGw=sum(calculation.weights,'gw'),totalCw=sum(calculation.weights,'cw');
 const document={...first,invoiceNo:`CO ${prepared.scope.orderYear}/${prepared.scope.orderWeek} 통합`,receiptStatus:'SHARED_AWB_PREVIEW',costStatus:'PREVIEW_ONLY',receiptLines:[...sources.values()],reviewedMetadata:{...first.reviewedMetadata,country:'CO',transportMode:'AIR',gw:totalGw,cw:totalCw,farmName:'차수 전체 농장'}};
 const input={formulaId:'CO_GROUP_42_1_V1',nativeCurrency:'USD',exchangeRateKRW:calculation.results[0].input.exchangeRate,exchangeRateType:calculation.results.some(r=>r.input.exchangeRateType==='TEST_ONLY')?'TEST_ONLY':'MANUAL',costGroups,lineInputs};
 const result={status:'CALCULATED',allocationScope:'SHARED_AWB',lines:calculation.lines};
 const base=await JSZip.loadAsync(await createSharedAwbCostWorkbook({document,input,result}));
 let sheet=await base.file('xl/worksheets/sheet3.xml')?.async('string');if(!sheet)fail('기존 콜롬비아 원본 계산 양식을 읽지 못했습니다.');
 const edits=new Map(),styles=new Map([...sheet.matchAll(/<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g)].map(m=>[m[1].match(/\br="([A-Z]+\d+)"/)?.[1],m[1].match(/\bs="(\d+)"/)?.[1]??'0']));
 const put=(ref,value,formula)=>{if(typeof value==='number'&&!Number.isFinite(value))fail(`원가 셀 계산이 유효하지 않습니다: ${ref}`);const numeric=typeof value==='number',attrs=`r="${ref}" s="${styles.get(ref)??'0'}"`;edits.set(ref,formula?`<c ${attrs}${numeric?'':' t="str"'}><f>${xml(formula)}</f><v>${xml(value??'')}</v></c>`:numeric?`<c ${attrs}><v>${value}</v></c>`:`<c ${attrs} t="inlineStr"><is><t>${xml(value??'')}</t></is></c>`);};
 const awbRows=new Map(calculation.results.map((entry,i)=>[entry.awb,2+i]));
 ['AWB 비용 입력','GW kg','CW kg','운임 USD','환율 KRW/USD','귀속 통관 KRW'].forEach((label,i)=>put(`${['AO','AP','AQ','AR','AS','AT'][i]}1`,label));
 calculation.results.forEach(({awb,input},i)=>{
  const r=i+2;put(`AO${r}`,awb);
  for(const[col,field,top]of [['AP','gw','C8'],['AQ','cw','E8'],['AR','freightAmount','C11'],['AS','exchangeRate','C7']])put(`${col}${r}`,input[field],calculation.results.length===1?`$${top.replace(/(\d+)/,'$$$1')}`:undefined);
  const terms=calculation.customsSources.flatMap((source,index)=>source.awbs.includes(awb)?[`$AP$${60+index}*AP${r}/$AQ$${60+index}`]:[]);
  put(`AT${r}`,input.customsTotalKRW,terms.join('+'));
 });
 const totalRows=[...awbRows.values()],totalFormula=column=>`SUM(${totalRows.map(r=>`${column}${r}`).join(',')})`;
 put('B1',`COLOMBIA ${prepared.scope.orderYear}/${prepared.scope.orderWeek} 전체 입고 통합 원가 · 미승인 계산본${input.exchangeRateType==='TEST_ONLY'?' · TEST_ONLY':''}`);
 put('B2','일반꽃·수국 전체 입고. 운임은 AWB 내부에서만 배분. 공유 통관비는 증빙별 한 번. 운영 원장 변경 없음.');
 put('AK3','통관비 근거 합계');put('AL3',calculation.totals.customsKRW);put('AK4','현재 계산 합계 KRW');put('AL4',sum(calculation.lines,'totalCostKRW'));
 if(calculation.results.length>1){put('C8',totalGw,totalFormula('AP'));put('E8',totalCw,totalFormula('AQ'));put('C11',calculation.totals.freightNative,totalFormula('AR'));put('C7','AWB별 환율 → AO:AT');}
 calculation.customsSources.forEach((source,i)=>{
  const r=60+i,refs=source.awbs.map(awb=>`AP${awbRows.get(awb)}`),groupIds=[...new Set(calculation.results.filter(entry=>source.awbs.includes(entry.awb)).flatMap(entry=>entry.result.costGroups.map(g=>g.groupId)))];
  put(`AO${r}`,source.sourceId);put(`AQ${r}`,source.awbs.reduce((n,awb)=>n+calculation.weights.find(w=>w.awb===awb).gw,0),`SUM(${refs.join(',')})`);
  const fullScope=calculation.customsSources.length===1&&source.awbs.length===calculation.awbCount;
  put(`AP${r}`,source.amountKRW,source.mode==='FORMULA'?(fullScope?'SUM($P$6:$P$9)+$R$6':`AQ${r}*460+33000+${groupIds.length}*10000+99000+40000`):undefined);
  put(`AR${r}`,source.mode==='FORMULA'?'원본 수식 가정값 · 미승인':'확인 입력 합계');
 });
 put('P10',calculation.totals.customsKRW,`SUM(AP60:AP${59+calculation.customsSources.length})`);
 put('O5','공유 통관비 근거 합계 (AO:AT)');
 const groupRows=new Map();let cursor=200;
 for(const entry of calculation.results){
  const start=cursor,end=start+entry.result.costGroups.length-1,a=awbRows.get(entry.awb);
  for(const group of entry.result.costGroups){
   const r=cursor++,coef=CO_AWB_GROUP_COEFFICIENTS[group.groupId],boxes=group.fullBoxEquivalent??group.boxQuantity;
   const gs=group.grossWeightKg/entry.input.gw,vs=group.volumeWeightKg/entry.input.cw,freight=entry.input.freightAmount*(entry.input.gw===entry.input.cw?gs:vs),customs=entry.input.customsTotalKRW*gs;
   groupRows.set(`${entry.awb}/${group.groupId}`,r);put(`AO${r}`,entry.awb);put(`AP${r}`,group.groupId);put(`AQ${r}`,boxes);put(`AR${r}`,coef.gross);put(`AS${r}`,coef.volume);put(`AT${r}`,group.quantity);
   put(`AU${r}`,gs,`AQ${r}*AR${r}/SUMPRODUCT($AQ$${start}:$AQ$${end},$AR$${start}:$AR$${end})`);
   put(`AV${r}`,vs,`AQ${r}*AS${r}/SUMPRODUCT($AQ$${start}:$AQ$${end},$AS$${start}:$AS$${end})`);
   put(`AW${r}`,freight,`IF($AP$${a}=$AQ$${a},$AR$${a}*AU${r},$AR$${a}*AV${r})`);
   put(`AX${r}`,freight/group.quantity,`AW${r}/AT${r}`);put(`AY${r}`,customs,`$AT$${a}*AU${r}`);put(`AZ${r}`,customs/group.quantity,`AY${r}/AT${r}`);
   put(`BA${r}`,group.grossWeightKg,`$AP$${a}*AU${r}`);put(`BB${r}`,group.volumeWeightKg,`$AQ$${a}*AV${r}`);
  }
 }
 groups.forEach((groupId,i)=>{const r=7+i,weightRow=8+i,entries=calculation.results.flatMap(e=>e.result.costGroups.filter(g=>g.groupId===groupId).map(g=>({awb:e.awb,group:g})));
  if(!entries.length)return;const keys=entries.map(e=>groupRows.get(`${e.awb}/${groupId}`));
  const matching=calculation.lines.filter(line=>lineInputs.find(setting=>setting.lineId===line.lineId)?.groupId===groupId);
  const freight=matching.reduce((n,line)=>n+line.componentAmounts.freightNative,0),customs=matching.reduce((n,line)=>n+line.componentAmounts.customsKRW,0),quantity=sum(entries.map(e=>e.group),'quantity');
  put(`K${r}`,freight,`SUM(${keys.map(k=>`AW${k}`).join(',')})`);put(`T${r}`,customs,`SUM(${keys.map(k=>`AY${k}`).join(',')})`);
  put(`M${r}`,freight/quantity,`IF(L${r}=0,0,K${r}/L${r})`);put(`U${r}`,customs/quantity,`IF(L${r}=0,0,T${r}/L${r})`);
  put(`AB${weightRow}`,sum(entries.map(e=>e.group),'grossWeightKg')/sum(entries.map(e=>e.group),'fullBoxEquivalent'),`SUM(${keys.map(k=>`BA${k}`).join(',')})/AC${weightRow}`);
  put(`AG${weightRow}`,sum(entries.map(e=>e.group),'volumeWeightKg')/sum(entries.map(e=>e.group),'fullBoxEquivalent'),`SUM(${keys.map(k=>`BB${k}`).join(',')})/AH${weightRow}`);
 });
 const rows=calculation.lines.map((cost,i)=>{
  const r=15+i,source=sources.get(cost.lineId),setting=lineInputs.find(line=>line.lineId===cost.lineId),g=groupRows.get(`${cost.awb}/${setting.groupId}`),a=awbRows.get(cost.awb),q=cost.quantity;
  const component=cost.componentAmounts,freight=q?component.freightNative/q:0,goods=q?component.goodsNative/q:0,cnf=goods+freight,won=q?(component.goodsKRW+component.freightKRW)/q:0,tariff=q?component.tariffKRW/q:0,customs=q?component.customsKRW/q:0,arrival=won+tariff+customs;
  if(!near(arrival*q,cost.totalCostKRW))fail('통합 원가 캐시와 계산 코어가 다릅니다.');
  put(`G${r}`,freight,`IF(E${r}=0,0,$AX$${g})`);put(`H${r}`,cnf,`F${r}+G${r}`);put(`I${r}`,q*cnf,`E${r}*H${r}`);put(`J${r}`,won,`H${r}*$AS$${a}`);put(`K${r}`,tariff,`J${r}*${setting.tariffRate}`);
  put(`L${r}`,customs,`IF(E${r}=0,0,$AZ$${g})`);put(`M${r}`,arrival,`J${r}+K${r}+L${r}`);put(`O${r}`,arrival*setting.stemsPerBunch,`M${r}*N${r}`);
  return{source,detail:source,cost};
 });
 put('AL12',sum(calculation.lines,'totalCostKRW'),`SUMPRODUCT(E15:E${14+rows.length},M15:M${14+rows.length})`);put('AL13',0,'AL12-AL4');
 const byRow=new Map();
 for(const [ref,body]of edits){const r=Number(ref.match(/\d+$/)[0]);if(!byRow.has(r))byRow.set(r,new Map());byRow.get(r).set(ref,body);}
 sheet=sheet.replace(/<sheetData>[\s\S]*?<\/sheetData>/,block=>{
  const existing=new Map([...block.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)].map(m=>[Number(m[1].match(/\br="(\d+)"/)[1]),{attrs:m[1],cells:m[2]}]));
  const indices=[...new Set([...existing.keys(),...byRow.keys()])].sort((a,b)=>a-b);
  const col=ref=>[...ref.match(/^[A-Z]+/)[0]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
  // A greedy attribute scan eats the slash of a blank cell and joins it to
  // the following populated cell. Replacing that following address then
  // emits two cells at one address, which native Excel removes on repair.
  return '<sheetData>'+indices.map(r=>{const old=existing.get(r),cells=new Map([...String(old?.cells??'').matchAll(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)].map(m=>[m[0].match(/\br="([A-Z]+\d+)"/)[1],m[0]]));for(const entry of byRow.get(r)??[])cells.set(...entry);return `<row${old?.attrs??` r="${r}"`}>${[...cells].sort(([a],[b])=>col(a)-col(b)).map(([,body])=>body).join('')}</row>`;}).join('')+'</sheetData>';
 });
 sheet=applyCostSalesDefaults({sheet,profile:INVOICE_COST_EXPORT_PROFILES.CO_42_1_ORIGINAL_V1,rows});
 sheet=sheet.replace(/<dimension[^>]*\/>/,`<dimension ref="A1:BB${Math.max(14+rows.length,cursor-1,59+calculation.customsSources.length)}"/>`).replace(/<cols>([\s\S]*?)<\/cols>/,(_,cols)=>{
  const parts=[{min:41,body:'<col min="41" max="54" width="18" customWidth="1"/>'}];
  for(const [body] of cols.matchAll(/<col\b[^>]*\/>/g)){
   const min=Number(body.match(/\bmin="(\d+)"/)[1]),max=Number(body.match(/\bmax="(\d+)"/)[1]);
   for(const [lo,hi] of [[min,Math.min(max,40)],[Math.max(min,55),max]])if(lo<=hi)parts.push({min:lo,body:body.replace(/\bmin="\d+"/,`min="${lo}"`).replace(/\bmax="\d+"/,`max="${hi}"`)});
  }
  return `<cols>${parts.sort((a,b)=>a.min-b.min).map(c=>c.body).join('')}</cols>`;
 });
 const zip=new JSZip(),name=`${prepared.scope.orderYear} ${prepared.scope.orderWeek}`,ns='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>');
 zip.file('_rels/.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
 zip.file('xl/workbook.xml',`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${ns}"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'${name}'!$A$1:$V$${14+rows.length}</definedName></definedNames><calcPr calcMode="auto" fullCalcOnLoad="1"/></workbook>`);
 zip.file('xl/_rels/workbook.xml.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${ns}/styles" Target="styles.xml"/><Relationship Id="rId3" Type="${ns}/theme" Target="theme/theme1.xml"/></Relationships>`);
 zip.file('xl/worksheets/sheet1.xml',sheet);zip.file('xl/styles.xml',await base.file('xl/styles.xml').async('string'));zip.file('xl/theme/theme1.xml',await base.file('xl/theme/theme1.xml').async('string'));
 return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
