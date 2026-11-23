import ExcelJS from 'exceljs';

/** One current cost table; original receipt keys and expense scopes remain visible. */
export async function createArrivalWeekCostWorkbook({prepared,calculation}){
 if(calculation.status!=='CALCULATED')throw Error('검증된 원가 계산만 출력합니다.');
 const book=new ExcelJS.Workbook();book.creator='Nenova';book.calcProperties.fullCalcOnLoad=true;
 const sheet=book.addWorksheet(`${prepared.scope.orderYear} ${prepared.scope.orderWeek}`);
 sheet.properties.defaultRowHeight=22;sheet.views=[{state:'frozen',ySplit:7,xSplit:4}];
 sheet.columns=[{width:11},{width:21},{width:19},{width:18},{width:44},...Array.from({length:13},()=>({width:17}))];
 sheet.mergeCells('A1:R1');sheet.getCell('A1').value=`${prepared.scope.country==='CN'?'중국 CLOUD A/B':'콜롬비아 수국·일반꽃'} ${prepared.scope.orderYear}/${prepared.scope.orderWeek} 통합 도착원가`;
 sheet.mergeCells('A2:R2');sheet.getCell('A2').value='선택 입고 원장 조회 기반 미승인 계산본 · 원문 수량·단가 유지 · 운임/통관비 증빙별 대상에 한 번 배분';
 sheet.getCell('A3').value='계산 합계 KRW';sheet.getCell('B3').value={formula:`SUM(N8:N${7+calculation.lines.length})`,result:calculation.totals.totalCostKRW};
 sheet.getCell('D3').value='선택 입고';sheet.getCell('E3').value=calculation.receiptCount;sheet.getCell('G3').value='상품행';sheet.getCell('H3').value=calculation.lines.length;
 sheet.mergeCells('A4:R4');sheet.getCell('A4').value=`원본 집합 ${prepared.baselineDigest} · 계산 버전 ${calculation.versionHash}`;
 sheet.mergeCells('A5:R5');sheet.getCell('A5').value=calculation.sources.some(s=>s.estimated)?'통관비에 기존 원가표 수식의 예상 비용 포함. 실제 납부/청구액이 아닌 추정 계산본.':'비용 합계는 화면에서 확인한 증빙 입력 기준.';
 sheet.mergeCells('A6:R6');sheet.getCell('A6').value=calculation.results.map(e=>`AWB ${e.awb} · ${e.input.exchangeRate}원/${prepared.scope.country==='CN'?'CNY':'USD'} · ${e.input.exchangeRateType==='VALIDATION_ONLY'?'검증용 환율(당시 확정환율 아님)':'원문 참고 환율'} · ${e.input.exchangeRateSource}`).join(' / ');
 sheet.getRow(7).values=['입고번호','농장','송장','AWB','원문 품목','실제량','단위','원문단가','상품원금','배분운임','환율','관세 KRW','통관 KRW','도착원가 KRW','단위당 KRW','3% 가산 KRW','허가증 원금','송장 부대비 원금'];
 calculation.lines.forEach((line,i)=>{
  const r=8+i,c=line.componentAmounts,fx=calculation.results.find(e=>e.awb===line.awb).input.exchangeRate;
  sheet.getRow(r).values=[line.warehouseKey,line.farmName,String(line.invoiceNo),String(line.awb),line.originalName,line.quantity,({BUNCH:'단',STEM:'송이',BOX:'박스'})[line.unit]??line.unit,line.unitPrice,c.goodsNative,c.freightNative,fx,c.tariffKRW,c.customsKRW,null,null,c.surchargeKRW??0,c.permitNative??0,c.invoiceFeeNative??0];
  sheet.getRow(r).height=36;
  sheet.getCell(`N${r}`).value={formula:`(I${r}+J${r}+Q${r}+R${r})*K${r}+L${r}+M${r}+P${r}`,result:line.totalCostKRW};
  sheet.getCell(`O${r}`).value={formula:`IF(F${r}=0,0,N${r}/F${r})`,result:line.costPerUnitKRW};
 });
 let r=10+calculation.lines.length;
 sheet.getRow(r++).values=['비용 증빙 종류','증빙 식별자','대상 AWB','통화','배분 기준','금액','추정 여부'];
 for(const source of calculation.sources)sheet.getRow(r++).values=[source.kind,source.sourceId,source.awbs.join(', ')+(source.warehouseKeys?' / 입고 '+source.warehouseKeys.join(', '):''),source.currency,source.basis,source.amount,source.estimated?'원가표 수식 추정':'확인 입력'];
 r++;
 sheet.getRow(r++).values=['원본 입고','농장','송장','AWB','원본 파일'];
 for(const m of prepared.members){const c=prepared.candidates.find(c=>c.warehouseKey===m.warehouseKey);sheet.getRow(r++).values=[m.warehouseKey,m.farmName,m.invoiceNo,m.awb,c?.fileName??''];}
 sheet.eachRow(row=>row.eachCell(cell=>{cell.font={name:'맑은 고딕',size:11};cell.alignment={vertical:'middle',wrapText:true};if(typeof cell.value==='number'||cell.value?.formula)cell.numFmt='#,##0.00';}));
 sheet.getRow(7).eachCell(cell=>{cell.font={name:'맑은 고딕',size:11,bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF334155'}};});
 sheet.getColumn(5).width=55;
 sheet.getCell('E3').numFmt='0';sheet.getCell('H3').numFmt='0';
 for(let row=8;row<8+calculation.lines.length;row++){sheet.getCell(`A${row}`).numFmt='0';sheet.getCell(`C${row}`).numFmt='@';sheet.getCell(`D${row}`).numFmt='@';sheet.getCell(`F${row}`).numFmt='#,##0.###';sheet.getCell(`H${row}`).numFmt='#,##0.0000';}
 sheet.getCell('A1').font={name:'맑은 고딕',size:16,bold:true};sheet.getRow(1).height=32;sheet.getRow(4).height=34;sheet.getRow(5).height=32;sheet.getRow(6).height=44;
 sheet.autoFilter=`A7:R${7+calculation.lines.length}`;sheet.pageSetup={orientation:'landscape',paperSize:9,fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:7'};
 return Buffer.from(await book.xlsx.writeBuffer());
}
