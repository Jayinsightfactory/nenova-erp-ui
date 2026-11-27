import JSZip from 'jszip';
import {CLOUD_CATEGORIES,cloudCategory,cloudLineCategory,cloudCustomsTotal,CLOUD_CUSTOMS_DEFAULTS} from './chinaCloudCost.js';
import {formatCostSheetName} from './costMasterStore.js';
const ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
const cell=(r,v,f,style=0)=>`<c r="${r}" s="${style}"${typeof v==='string'?f?' t="str"':' t="inlineStr"':''}>${f?`<f>${esc(f)}</f>`:''}${typeof v==='string'&&!f?`<is><t>${esc(v)}</t></is>`:`<v>${typeof v==='string'?esc(v):Number.isFinite(v)?v:0}</v>`}</c>`;
function sheet(rows,widths,merges,autoFilterRef,freeze=11){
 const index=c=>[...c.match(/r="([A-Z]+)/)[1]].reduce((s,x)=>s*26+x.charCodeAt(0)-64,0);
 return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${ns}"><sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="${freeze}" topLeftCell="A${freeze+1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${[...rows].sort((a,b)=>a[0]-b[0]).map(([r,c])=>`<row r="${r}" ht="${r>=11?54:36}" customHeight="1">${c.sort((a,b)=>index(a)-index(b)).join('')}</row>`).join('')}</sheetData>${autoFilterRef?`<autoFilter ref="${autoFilterRef}"/>`:''}<mergeCells count="${merges.length}">${merges.map(m=>`<mergeCell ref="${m}"/>`).join('')}</mergeCells><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}

// Download-only formulas on a single week cost sheet. Numeric caches reconcile to the
// same server preview; Excel recalculates from editable quantity, FOB, FX, freight and right-side category table.
export async function createCloudCostWorkbook({document,revision,snapshot,rows,previewOnly=false}){
 const input=snapshot.input,main=new Map(),catColOffset=23; // X..AH (or AI with custom)
 const byId=new Map(input.lineInputs.map(l=>[String(l.lineId).toLowerCase(),l]));
 const effective=[...CLOUD_CATEGORIES.map(c=>({...c,worksheetCode:c.code}))],customIds=new Map();
 const rowCategories=rows.map(({source})=>{
  const setting=byId.get(String(source.lineId).toLowerCase()),category=cloudLineCategory(setting);
  if(!category)return null;
  if(!setting?.categoryOverride)return effective.find(c=>c.code===category.code);
  if(!customIds.has(category.categoryIdentity)){const copy={...category,worksheetCode:effective.length+1,weightMode:setting.categoryOverride.weightMode};effective.push(copy);customIds.set(category.categoryIdentity,copy);}
  return customIds.get(category.categoryIdentity);
 });
 const hasCustom=effective.length>CLOUD_CATEGORIES.length,categoryLast=effective.length+3,lookup=`$X$4:$${hasCustom?'AI':'AH'}$${categoryLast}`;

 const put=(map,r,c,v,f,s=0)=>{if(!map.has(r))map.set(r,[]);map.get(r).push(cell(`${col(c)}${r}`,v,f,s));};
 put(main,1,0,`CLOUD 도착원가 · ${document.orderYear}/${document.orderWeek}`,null,1);
 put(main,2,0,`46-2 CLOUD cbm 기준${input.estimateSource?` · ${input.estimateSource}`:''}`);
 const fx=Number(input.exchangeRateKRW),freight=Number(input.freightAmount)*Number(input.allocationShareNumerator)/Number(input.allocationShareDenominator),customs=input.cloudCustomsMode==='FORMULA'?cloudCustomsTotal(document,rows.map(r=>({...r.source,outQuantity:r.cost.quantity})),input):Number(input.customsTotalKRW);
 const totalQty=rows.reduce((s,r)=>s+r.cost.quantity,0),last=11+rows.length;
 put(main,3,8,'호접 허가증 CNY');put(main,3,9,Number(input.cloudOrchidPermitNative??300),null,2);
 [['환율',fx],['GW (kg)',Number(document.reviewedMetadata.gw)],['운임 CNY',freight],['통관비 KRW',customs]].forEach(([label,v],i)=>{put(main,i+3,0,label);put(main,i+3,2,v,i===3&&input.cloudCustomsMode==='FORMULA'?`C4*V3+V4+${input.cloudQuarantineCategoryCount===undefined?`COUNTIF(AF4:AF${categoryLast},">0")`:Number(input.cloudQuarantineCategoryCount)}*V5+V6+V7+V8`:null,2);});
 const labels={cloudWarehousePerKg:'백상 원/kg',cloudBrokerage:'통관 수수료',cloudQuarantinePerCategory:'검역 원/품종',cloudDomesticTransport:'국내운송비 · 원본 추정',cloudMiscellaneous:'기타 비용',cloudDisinfection:'소독비'};
 Object.entries(labels).forEach(([key,label],i)=>{put(main,i+3,20,label);put(main,i+3,21,Number(input[key]??CLOUD_CUSTOMS_DEFAULTS[key]),null,2);});
 put(main,7,0,'총 단수');put(main,7,2,totalQty,`SUM(D12:D${last})`,3);
 put(main,8,0,'총 원가');put(main,8,2,revision.totalCostKRW,`SUMPRODUCT(D12:D${last},L12:L${last})`,3);
 const summary={sales:0,profit:0};
 const categoryQty=new Map(effective.map(c=>[c.worksheetCode,rows.reduce((sum,r,i)=>sum+(rowCategories[i]?.worksheetCode===c.worksheetCode?r.cost.quantity:0),0)]));
 const totalVolume=effective.reduce((sum,c)=>sum+c.volumeKgPerBunch*categoryQty.get(c.worksheetCode),0);
 put(main,1,catColOffset,'CLOUD 품종 기준 · 수정 시 운임·관세 자동 재계산',null,1);
 ['코드','카테고리','박스당 단수','길이 cm','폭 cm','높이 cm','부피 kg/단','관세율','총 단수','총 부피 kg','운임 CNY/단',...(hasCustom?['호접 허가증 분류']:[])].forEach((h,c)=>put(main,3,catColOffset+c,h,null,1));
 effective.forEach((c,i)=>{
  const r=i+4,q=categoryQty.get(c.worksheetCode),vol=q*c.volumeKgPerBunch;
  [c.worksheetCode,c.label,c.bunchesPerBox,c.length,c.width,c.height].forEach((v,j)=>{if(v!=null)put(main,r,catColOffset+j,v,null,2);});
  put(main,r,catColOffset+6,c.volumeKgPerBunch,(c.weightMode?c.weightMode==='FIXED_15KG':[4,21].includes(c.code))?`15/Z${r}`:`AA${r}*AB${r}*AC${r}/6000/Z${r}`,3);
  put(main,r,catColOffset+7,c.tariffRate,null,4);if(hasCustom)put(main,r,catColOffset+11,c.code===8?1:0,null,2);
  put(main,r,catColOffset+8,q,`SUMIF(C12:C${last},X${r},D12:D${last})`,3);
  put(main,r,catColOffset+9,vol,`AD${r}*AF${r}`,3);
  put(main,r,catColOffset+10,freight*c.volumeKgPerBunch/totalVolume,`$C$5*AD${r}/SUM($AG$4:$AG$${categoryLast})`,3);
 });
 ['원문 품목','카테고리','코드','단수','FOB CNY/단','운임 CNY/단','CNF CNY','3% 가산 KRW','CNF KRW','관세 KRW/단','통관 KRW/단','도착원가 KRW/단','판매가 VAT포함','판매가 VAT별도','단 이익','이익률','총 판매가','총 이익','허가증 CNY/단'].forEach((h,c)=>put(main,11,c,h,null,1));
 rows.forEach(({source,cost},i)=>{
  const r=i+12,q=cost.quantity,c=rowCategories[i]||{code:0,worksheetCode:0,label:'취소 · 카테고리 없음',tariffRate:0},f=q?cost.componentAmounts.goodsNative/q:0;
  const permitUnit=q?cost.componentAmounts.permitNative/q:0;
  const freightUnit=q?cost.componentAmounts.freightNative/q:0,cnf=f+freightUnit+permitUnit,krw=cnf*fx,surcharge=krw*.03,tariff=krw*c.tariffRate,customsUnit=customs/totalQty;
  const rate=cost.costPerUnitKRW??0,selling=rate/.77,net=selling/1.1,profit=net-rate;
  summary.sales+=net*q;summary.profit+=profit*q;
  put(main,r,0,source.originalName);put(main,r,1,c.label,`IF(D${r}=0,"취소",VLOOKUP(C${r},${lookup},2,FALSE))`);put(main,r,2,c.worksheetCode,null,2);put(main,r,3,q,null,2);put(main,r,4,f,null,2);
  const vals=[freightUnit,cnf,surcharge,krw,tariff,customsUnit,rate,selling,net,profit,net?profit/net:0,net*q,profit*q];
  const fs=[`VLOOKUP(C${r},${lookup},11,FALSE)`,`E${r}+F${r}+S${r}`,`G${r}*$C$3*0.03`,`G${r}*$C$3`,`I${r}*VLOOKUP(C${r},${lookup},8,FALSE)`,`$C$6/$C$7`,`H${r}+I${r}+J${r}+K${r}`,`L${r}/0.77`,`M${r}/1.1`,`N${r}-L${r}`,`IF(N${r}=0,0,O${r}/N${r})`,`N${r}*D${r}`,`O${r}*D${r}`];
  vals.forEach((v,j)=>put(main,r,j+5,q?v:0,`IF(D${r}=0,0,${fs[j]})`,j===10?4:3));
  put(main,r,18,permitUnit,hasCustom?`IF(AND(D${r}>0,VLOOKUP(C${r},${lookup},12,FALSE)=1),$J$3/SUMPRODUCT($AF$4:$AF$${categoryLast},$AI$4:$AI$${categoryLast}),0)`:`IF(AND(D${r}>0,C${r}=8),$J$3/$AF$11,0)`,3);
 });
 put(main,9,0,'총 판매가 / 총 이익 / 총 이익률');put(main,9,2,summary.sales,`SUM(Q12:Q${last})`,3);put(main,9,4,summary.profit,`SUM(R12:R${last})`,3);put(main,9,6,summary.sales?summary.profit/summary.sales:0,'IF(C9=0,0,E9/C9)',4);
 put(main,10,0,`송장 ${document.invoiceNo||'미확인'} · ${input.exchangeRateType||''}`);put(main,10,4,input.estimateSource||input.costSourceId||'');
 const evidence=document.reviewedMetadata?.nativeWorkbookEvidence;
 if(evidence)put(main,last+2,0,`${(evidence.note||'원본 중량 2행 분리').replace(/\s*·\s*원장 변경 없음/g,'')} · 입고 원본 ${evidence.scope.fileName} · SHA256 ${evidence.source.sha256} · ${evidence.source.sheet}!${evidence.weights.map(w=>w.cells).join(',')} · GW/CW ${evidence.weights.map(w=>w.kg).join('/')}kg · 환율 ${fx}${fx===210?' (제공 원가표 46-2 CLOUD cbm C7=210과 일치)':' (현재 입력값)'}${evidence.unitConversions?.length?' · 원가 계산만 1송이=1단: '+evidence.unitConversions.map(c=>c.cells).join(','):''}`);
 const sheetName=formatCostSheetName(document.orderWeek);
 const merges=['A1:S1','A2:S2',`X1:${hasCustom?'AI':'AH'}1`,...(evidence?[`A${last+2}:S${last+2}`]:[])];
 const widths=[48,20,8,12,14,14,14,16,16,16,16,18,18,18,16,12,18,18,18,3,28,18,3,10,24,15,14,14,14,18,14,16,18,20,...(hasCustom?[18]:[])];
 const zip=new JSZip();
 zip.file('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
 zip.file('_rels/.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
 zip.file('xl/workbook.xml',`<workbook xmlns="${ns}" xmlns:r="${rel}"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets><calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`);
 zip.file('xl/_rels/workbook.xml.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/></Relationships>`);
 zip.file('xl/styles.xml',`<styleSheet xmlns="${ns}"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts><fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><name val="맑은 고딕"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="5">${[0,1,2,3,4].map(i=>`<xf fontId="${i===1?1:0}" fillId="${i===1?2:i===2?3:0}" borderId="0" numFmtId="${i===4?9:i===3?164:0}" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>`).join('')}</cellXfs></styleSheet>`);
 zip.file('xl/worksheets/sheet1.xml',sheet(main,widths,merges,`A11:S${last}`));
 return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
