import ExcelJS from 'exceljs';
import {cloudLineCategory} from './chinaCloudCost.js';
import {formatCostSheetName} from './costMasterStore.js';

// Reproduces the supplied CLOUD cbm presentation; calculation remains owned by
// arrivalWeekCost/cloudCostReview. No source workbook or ERP values are bundled.
export function cloudTemplatePlan(prepared,calculation){
 const receipts=prepared.members.map((m,i)=>{const lines=calculation.lines.filter(l=>l.warehouseKey===m.warehouseKey),input=calculation.results.find(r=>r.awb===m.awb)?.input;
  const reference=m.reviewSource?.reference??m.source?.cloudReference,sourcePart=/\d{1,2}-\d{1,2}([A-Z])\s+CLOUD\b/i.exec(reference?.source?.sheet??'')?.[1];
  return {member:m,part:sourcePart??(i<26?String.fromCharCode(65+i):String(i+1)),row:7+i,lines,input,reference,
   freight:lines.reduce((s,l)=>s+l.componentAmounts.freightNative,0),customs:lines.reduce((s,l)=>s+l.componentAmounts.customsKRW,0),reserved:lines.filter(l=>l.manual).reduce((s,l)=>s+l.componentAmounts.freightNative,0)};});
 receipts.sort((a,b)=>a.part.localeCompare(b.part)||a.member.warehouseKey-b.member.warehouseKey);receipts.forEach((r,i)=>{r.row=7+i;});
 const groups=[];for(const receipt of receipts)for(const line of receipt.lines){const choice=line.categoryInput??receipt.member.lineInputs.find(i=>i.lineId===line.lineId),category=cloudLineCategory(choice),manual=line.manual===true;
  const identity=JSON.stringify([receipt.member.warehouseKey,manual?'MANUAL':category?.categoryIdentity??category?.code,line.unit,manual?line.manualFreight:null,manual?line.manualDuty:null]);
  let group=groups.find(g=>g.identity===identity);if(!group){group={identity,receipt,category,manual,lines:[],row:7+groups.length};groups.push(group);}group.lines.push(line);
 }
 const headerRow=Math.max(33,7+groups.length+2,7+receipts.length+9),firstRow=headerRow+1,lastRow=headerRow+calculation.lines.length;
 const lineRows=new Map(receipts.flatMap(r=>r.lines).map((l,i)=>[l.lineId,firstRow+i]));
 return {receipts,groups,headerRow,firstRow,lastRow,lineRows};
}
const sumCells=cells=>cells.length?`SUM(${cells.join(',')})`:'0';
const total=(lines,key)=>lines.reduce((s,l)=>s+(l.componentAmounts[key]??0),0);
const numberFormat='#,##0.00;[Red](#,##0.00)';
export async function createCloudTemplateWorkbook({prepared,calculation}){
 if(prepared.scope.country!=='CN'||calculation.status!=='CALCULATED'||!calculation.lines.length)throw Error('검증된 CLOUD 계산만 출력합니다.');
 const plan=cloudTemplatePlan(prepared,calculation),{receipts,groups,headerRow,firstRow,lastRow,lineRows}=plan;
 const book=new ExcelJS.Workbook();book.creator='Nenova';book.calcProperties.fullCalcOnLoad=true;
 const sheet=book.addWorksheet(formatCostSheetName(prepared.scope.orderWeek));
 const widths=[8,14.42578125,12.7109375,39.42578125,11.28515625,8,8,10.5703125,12.42578125,12.42578125,13.85546875,15.42578125,12,11.7109375,13.5703125,11.42578125,15.28515625,12.28515625,27.42578125,16.140625,15.28515625,16.85546875,17.140625,15.7109375,16];
 sheet.columns=widths.map(width=>({width}));sheet.properties.defaultRowHeight=16.5;
 const cell=(address,value)=>{sheet.getCell(address).value=value;};
 const formula=(address,text,result)=>cell(address,{formula:text,result});
 const merge=(range,value)=>{sheet.mergeCells(range);cell(range.split(':')[0],value);};
 const border={top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'}};
 const rangeStyle=(start,end,fill)=>{for(let r=start;r<=end;r++)for(let c=1;c<=25;c++){const x=sheet.getCell(r,c);x.font={name:'맑은 고딕',size:10};x.alignment={vertical:'middle',horizontal:c===2?'left':'center',wrapText:true};if(fill)x.fill={type:'pattern',pattern:'solid',fgColor:{argb:fill}};}};
 rangeStyle(1,lastRow+1);merge('B2:J2',`${prepared.scope.orderYear}/${prepared.scope.orderWeek} CHINA CLOUD A/B 통합 원가${calculation.reviewMode==='TEST_ONLY'?' · TEST_ONLY':''}`);sheet.getCell('B2').font={name:'맑은 고딕',size:14,bold:true};sheet.getRow(2).height=25;
 cell('B3','합계 KRW');sheet.mergeCells('C3:F3');formula('C3',`O${lastRow+1}`,calculation.totals.totalCostKRW);sheet.getCell('C3').numFmt='#,##0.00';sheet.getCell('C3').font={name:'맑은 고딕',size:12,bold:true};cell('G3','상품행');cell('H3',calculation.lines.length);cell('I3','입고');cell('J3',receipts.length);
 merge('B5:J5','입고별 중량 · 환율 · 운임');merge('K5:Q5','품목별 운임비');merge('S5:Y5','그외에 통관비');
 const headings={B6:'구분',C6:'송장',D6:'GW kg',E6:'AWB CW kg',F6:'원가표 계산부피',G6:'잔액배분 CBM',H6:'환율 원/CNY',I6:'운임 CNY',J6:'통관 KRW',K6:'단수/1BX',L6:'품목 · 구분',M6:'CBM/1BX',N6:'수량',O6:'총 CBM',P6:'단당 운임비',Q6:'관세',S6:'구분',T6:'백상',U6:'통관 수수료',V6:'검역 수수료',W6:'국내 운송비',X6:'기타·소독',Y6:'Total'};for(const[a,v]of Object.entries(headings))cell(a,v);sheet.getRow(6).height=31;
 for(const receipt of receipts){const {member:m,part,row,lines,input,reference}=receipt,scopeMembers=prepared.awbs.find(a=>a.awb===m.awb)?.members??[];
  cell(`B${row}`,part);cell(`C${row}`,String(m.invoiceNo));cell(`D${row}`,scopeMembers.length===1?input.gw:m.gw??'공동 AWB');cell(`E${row}`,scopeMembers.length===1?input.cw:m.cw??'공동 AWB');cell(`F${row}`,reference?.calculatedVolume?.kg??null);
  const own=groups.filter(g=>g.receipt===receipt),volume=total(lines,'volumeWeightKg');formula(`G${row}`,sumCells(own.map(g=>`O${g.row}`)),volume);cell(`H${row}`,input.exchangeRate);cell(`I${row}`,receipt.freight);formula(`J${row}`,`Y${row}`,receipt.customs);
  cell(`S${row}`,part);const pool=calculation.review?.expensePools?.find(p=>p.kind==='CUSTOMS'&&p.mode==='FORMULA'&&p.awbs.length===1&&p.awbs[0]===m.awb),count=pool?.quarantineCategoryCount;
  const expected=Number(input.gw)*460+33000+Number(count)*10000+195000+240000;
  if(pool&&scopeMembers.length===1&&count!==''&&count!=null&&Math.abs(expected-receipt.customs)<1e-5){formula(`T${row}`,`D${row}*460`,input.gw*460);cell(`U${row}`,33000);formula(`V${row}`,`${Number(count)}*10000`,Number(count)*10000);cell(`W${row}`,195000);cell(`X${row}`,240000);formula(`Y${row}`,`SUM(T${row}:X${row})`,receipt.customs);}else cell(`Y${row}`,receipt.customs);
  sheet.getRow(row).height=27;for(const col of ['D','E','F','G','H','I','J','T','U','V','W','X','Y'])sheet.getCell(`${col}${row}`).numFmt=numberFormat;
 }
 const infoRow=7+receipts.length+1;merge(`B${infoRow}:J${infoRow}`,`출처: ${[...new Set(receipts.map(r=>r.reference?.source?.fileName).filter(Boolean))].join(', ')||'원가 작성 화면의 입고별 입력·비용 증빙'}. 원가표 계산부피와 AWB CW는 별개입니다.`);sheet.getRow(infoRow).height=30;
 merge(`B${infoRow+1}:J${infoRow+1}`,calculation.reviewMode==='TEST_ONLY'?'TEST_ONLY · 원가 작성 화면의 참고 환율·추정 비용을 적용한 검증본. 실비 승인 아님.':'원가 계산본 · 승인 원가/입고 원장을 변경하지 않습니다. 추정 비용은 하단 출처에 표시합니다.');sheet.getRow(infoRow+1).height=31;
 merge(`B${infoRow+2}:J${infoRow+2}`,'수기 운임 선배분 후 잔액만 CBM 배분. 수량에 표시한 단/송이를 구분하며 실물 단수는 변경하지 않습니다.');sheet.getRow(infoRow+2).height=30;
 for(const group of groups){const {row,receipt,category,manual,lines}=group,q=lines.reduce((s,l)=>s+l.quantity,0),freight=total(lines,'freightNative'),weight=total(lines,'volumeWeightKg');
  cell(`K${row}`,manual?null:category?.bunchesPerBox??null);cell(`L${row}`,`${receipt.part} ${manual?'수기 비용':category?.label??'미확인'}${lines[0].unit==='STEM'?' (송이)':''}`);cell(`M${row}`,manual?null:category?.volumeKgPerBox??null);formula(`N${row}`,sumCells(lines.map(l=>`E${lineRows.get(l.lineId)}`)),q);
  if(manual){cell(`O${row}`,0);cell(`P${row}`,freight/q);}else{formula(`O${row}`,`M${row}/K${row}*N${row}`,weight);const own=receipt,manualGroups=groups.filter(g=>g.receipt===receipt&&g.manual),reserve=manualGroups.length?sumCells(manualGroups.map(g=>`N${g.row}*P${g.row}`)):'0';formula(`P${row}`,`(I${own.row}-${reserve})*O${row}/G${own.row}/N${row}`,freight/q);}cell(`Q${row}`,manual?null:category?.tariffRate??null);
  for(const col of ['M','N','O','P'])sheet.getCell(`${col}${row}`).numFmt=numberFormat;sheet.getCell(`Q${row}`).numFmt='0.0%';sheet.getRow(row).height=Math.max(sheet.getRow(row).height??16.5,22);
 }
 sheet.mergeCells(`B${headerRow}:D${headerRow}`);const detailHeaders={A:'A/B',B:'Color\nGrade',E:'수량',F:'FOB',G:'허가증',H:'운송비\n(단/송이)',I:'CNF\n(단/송이)',J:'3% 수수료\nKRW',K:'3% 수수료\n합계 KRW',L:'CNF 원화\n(단/송이)',M:'관세\nKRW',N:'그외통관\n(단/송이)',O:'도착원가\n(단/송이)',P:'단당 수량\n환산',Q:'도착원가\n(환산)',R:'판매\n(부가세 별도)',S:'판매가\n(부가세 포함)',T:'15% 이익 판매가\n(부가세 별도)',U:'단 이익',V:'이익률',W:'총 판매가',X:'총 이익'};for(const[col,label]of Object.entries(detailHeaders))cell(`${col}${headerRow}`,label);sheet.getRow(headerRow).height=33;
 for(const line of calculation.lines){const r=lineRows.get(line.lineId),receipt=receipts.find(m=>m.member.warehouseKey===line.warehouseKey),group=groups.find(g=>g.lines.some(l=>l.lineId===line.lineId)),c=line.componentAmounts,q=line.quantity,fx=receipt.input.exchangeRate,ownGroups=groups.filter(g=>g.receipt===receipt),qty=receipt.lines.reduce((s,l)=>s+l.quantity,0);
  if(!(q>0)||Math.abs((c.goodsNative+c.freightNative+(c.permitNative??0))*fx+(c.surchargeKRW??0)+c.tariffKRW+c.customsKRW-line.totalCostKRW)>1e-5)throw Error('CLOUD 출력 구성금액이 검증 원가와 다릅니다.');
  cell(`A${r}`,receipt.part);merge(`B${r}:D${r}`,line.appliedDescription??line.originalName);cell(`E${r}`,q);cell(`F${r}`,c.goodsNative/q);cell(`G${r}`,(c.permitNative??0)/q);formula(`H${r}`,`P${group.row}`,c.freightNative/q);formula(`I${r}`,`SUM(F${r}:H${r})`,(c.goodsNative+c.freightNative+(c.permitNative??0))/q);formula(`J${r}`,`I${r}*3%*$H$${receipt.row}`,(c.surchargeKRW??0)/q);formula(`K${r}`,`E${r}*J${r}`,c.surchargeKRW??0);formula(`L${r}`,`I${r}*$H$${receipt.row}`,(c.goodsNative+c.freightNative+(c.permitNative??0))*fx/q);
  if(line.manual)cell(`M${r}`,c.tariffKRW/q);else formula(`M${r}`,`L${r}*$Q$${group.row}`,c.tariffKRW/q);
  formula(`N${r}`,`$J$${receipt.row}/${sumCells(ownGroups.map(g=>`$N$${g.row}`))}`,c.customsKRW/q);formula(`O${r}`,`SUM(J${r},L${r}:N${r})`,line.costPerUnitKRW);cell(`P${r}`,1);formula(`Q${r}`,`O${r}*P${r}`,line.costPerUnitKRW);
  for(const [col,text]of Object.entries({R:`IF(S${r}="","",S${r}/1.1)`,T:`IF(S${r}="","",Q${r}/(1-15%))`,U:`IF(R${r}="","",R${r}-Q${r})`,V:`IF(OR(R${r}="",R${r}=0),"",U${r}/R${r})`,W:`IF(R${r}="","",R${r}*E${r}/P${r})`,X:`IF(R${r}="","",U${r}*E${r}/P${r})`}))formula(`${col}${r}`,text,'');
  for(let col=1;col<=24;col++){const x=sheet.getCell(r,col);x.border=border;if(col>=6)x.numFmt=numberFormat;}sheet.getCell(`E${r}`).numFmt=(Number.isInteger(q)?'#,##0':'#,##0.###')+(line.unit==='STEM'?'" 송이"':'');sheet.getCell(`V${r}`).numFmt='0.0%';sheet.getCell(`P${r}`).numFmt='0.00';sheet.getRow(r).height=[...(line.appliedDescription??line.originalName)].reduce((n,c)=>n+(/[가-힣中-鿿]/.test(c)?2:1),0)>88?30:18;
 }
 const totalRow=lastRow+1;merge(`B${totalRow}:D${totalRow}`,'합계');formula(`K${totalRow}`,`SUM(K${firstRow}:K${lastRow})`,calculation.totals.surchargeKRW);formula(`O${totalRow}`,`SUMPRODUCT(E${firstRow}:E${lastRow},O${firstRow}:O${lastRow})`,calculation.totals.totalCostKRW);sheet.getCell(`O${totalRow}`).numFmt=numberFormat;sheet.getRow(totalRow).height=24;
 let noteRow=totalRow+2;merge(`B${noteRow}:X${noteRow}`,'비용 출처 · 같은 증빙은 적용 범위에 한 번만 반영');sheet.getRow(noteRow++).height=23;
 for(const source of calculation.sources){const scope=source.awbs.flatMap(a=>receipts.filter(r=>r.member.awb===a).map(r=>r.part)).join('/'),id=source.sourceId.replace(/^[a-f0-9]{64}\//i,'');merge(`B${noteRow}:X${noteRow}`,`${scope} ${source.kind==='FREIGHT'?'운임':'통관'} · ${id} · ${source.amount.toLocaleString('ko-KR',{maximumFractionDigits:3})}${source.currency} · ${source.estimated?'원가표 재현/추정':'확인 입력'}`);sheet.getRow(noteRow++).height=25;}
 for(const receipt of receipts){if(receipt.lines.some(l=>Number(l.categoryInput?.categoryCode??receipt.member.lineInputs.find(i=>i.lineId===l.lineId)?.categoryCode)===8)&&receipt.input.permitReason){merge(`B${noteRow}:X${noteRow}`,`${receipt.part} 허가증 적용 ${receipt.input.permitAmount}CNY · ${receipt.input.permitReason}`);sheet.getRow(noteRow++).height=28;}}
 for(const line of calculation.lines){const o=line.originalComparison,e=line.sourceLine,c=line.reviewChoice,part=receipts.find(m=>m.member.warehouseKey===line.warehouseKey).part;let text='';
  if(line.manual)text=`${part} ${line.originalName} · 수기 운임 ${line.manualFreight}CNY/계산단위, 관세 ${line.manualDuty}KRW/계산단위 우선 적용`;
  else if(o&&(o.amount!==e.lineAmount||o.prodKey!==e.prodKey||o.quantity!==e.outQuantity))text=`${part} ${o.originalName} ${o.specification??''} · 원문 ${o.amount}CNY / ERP ${e.lineAmount}CNY / 이번 적용 ${line.componentAmounts.goodsNative}CNY · 원가 전용`;
  else if(/오참조/.test(c?.reason??''))text=`${part} ${line.originalName} · 원본 오참조는 복제하지 않고 검증된 규격으로 운임 재배분`;
  if(text){merge(`B${noteRow}:X${noteRow}`,text);sheet.getRow(noteRow++).height=29;}
 }
 for(const r of [5,6])for(let c=2;c<=25;c++){const x=sheet.getCell(r,c);if(x.value!=null){x.border=border;x.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFCFEBF'}};}}
 for(let col=1;col<=24;col++){sheet.getCell(headerRow,col).border=border;sheet.getCell(headerRow,col).alignment={horizontal:'center',vertical:'middle',wrapText:true};sheet.getCell(headerRow,col).fill={type:'pattern',pattern:'solid',fgColor:{argb:col>=2&&col<=4?'FFFFF2CC':(col>=5&&col<=7||col===13)?'FFFFFFCC':col>=8?'FFDDEBF7':'FFFFFFFF'}};sheet.getCell(totalRow,col).font={name:'맑은 고딕',size:10,bold:true};}
 sheet.views=[{state:'frozen',ySplit:headerRow,xSplit:4,showGridLines:false}];sheet.autoFilter=`A${headerRow}:X${lastRow}`;sheet.pageSetup={orientation:'landscape',paperSize:8,fitToPage:true,fitToWidth:1,fitToHeight:0,printArea:`A1:Y${noteRow-1}`,printTitlesRow:`${headerRow}:${headerRow}`};sheet.headerFooter.oddFooter='&C&P / &N';
 return Buffer.from(await book.xlsx.writeBuffer());
}
