// Synthetic documents only. Chrome PDF and actual Microsoft Excel print output.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const puppeteer=require('puppeteer-core');

async function main(){
  const {buildEstimateHtml}=await import('../lib/estimatePrintHtml.js');
  const {paginateEstimateRows,splitEstimatePrintDocument}=await import('../lib/estimatePrintPagination.js');
  const {buildEstimatePrintWorkbook}=await import('../lib/estimatePrintExcel.js');
  const {measureEstimatePrintDocument,buildEstimateRenderedWorksheet,serializeEstimatePrintWorkbook}=await import('../lib/estimatePrintRenderedExcel.js');
  const folder=path.resolve('.verify/estimate-print-parity');fs.mkdirSync(folder,{recursive:true});
  const logo=await require('sharp')(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="100"><rect width="360" height="100" fill="white"/><text x="15" y="65" font-family="Arial" font-size="36">TEST SUPPLIER</text></svg>')).png().toBuffer();
  const options={printDate:'2026-11-24',serialNo:'TEST-ONLY',custTel:'연습용 연락처',bigoLabel:'연습용 문서',logoDataUrl:'data:image/png;base64,'+logo.toString('base64')};
  const fixtures=[
    {id:'china-total-fee',count:2,format:'estimate',customers:1,china:true},
    {id:'estimate-small',count:12,format:'estimate',customers:1},
    {id:'estimate-long-two-customers',count:55,format:'estimate',customers:2,long:true},
    {id:'estimate-no-box',count:12,format:'estimate',customers:1,noBox:true},
    {id:'statement-long',count:55,format:'statement',customers:1,long:true},
    {id:'statement-negative',count:14,format:'statement',customers:1,negative:true},
    {id:'supply-negative',count:14,format:'supply',customers:1,negative:true},
    {id:'2025-same-week',count:12,format:'estimate',customers:1,year:2025},
  ];
  const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox','--no-proxy-server']});
  try{
    for(const fixture of fixtures){
      const docs=[],sheets=[];
      for(let customer=0;customer<fixture.customers;customer++){
        const rows=Array.from({length:fixture.count},(_,i)=>{
          if(fixture.china)return {_exePrint:true,ProdKey:i+1,ProdName:'연습 품목 T'+String(i+1).padStart(3,'0')+(i===0?' 중국 TOTAL':' 항공수수료'),OrderYear:2026,OrderWeek:'47-01',Unit:'박스',Quantity:1,UnitQuantity:'1박스',Cost:i===0?5511000:-220000,Amount:i===0?5010000:-200000,Vat:i===0?501000:-20000,EstimateType:'정상출고'};
          const negative=fixture.negative&&i===fixture.count-1;
          return {_exePrint:true,ProdKey:i+1,ProdName:`연습 품목 T${String(i+1).padStart(3,'0')}${fixture.long&&i%7===0?' 긴 품목명과 규격을 끝까지 확인합니다':''}`,
            OrderYear:fixture.year||2026,OrderWeek:'47-01',Unit:'단',Quantity:negative?-3:120,UnitQuantity:negative?'-3단':'120단',
            Cost:1100,Amount:negative?-3000:120000,Vat:negative?-300:12000,BunchesPerBox:60,
            EstimateType:negative?'불량차감/단':'정상출고',_printNoteOverride:true,
            Descr:fixture.long&&i%7===0?'긴 적요 줄바꿈을 확인합니다.\n품목과 수량을 빠뜨리지 않습니다.':'연습 적요'};
        });
        const html=buildEstimateHtml({...options,custName:`연습 업체 ${customer+1}`,rows,printFormat:fixture.format,showBoxQty:!fixture.noBox,
          showDistribDesc:true,showDeductionOutDay:true,showDeductionDescr:true})
          .replace(/(<td class="info-key">(?:사업자등록번호|회사명[/]대표|주소|업태[/]종목|계좌번호|TEL[/]FAX)<\/td><td class="info-val">)[\s\S]*?(<\/td>)/g,'$1연습용 회사정보$2');

        const page=await browser.newPage();await page.setViewport({width:794,height:1123});
        await page.setContent(html,{waitUntil:'domcontentloaded'});
        await page.evaluate(async()=>{document.documentElement.style.width='210mm';document.body.style.width='210mm';await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));});
        const htmlPages=await page.evaluate(new Function("return ("+splitEstimatePrintDocument.toString()+")(document, "+paginateEstimateRows.toString()+")"));
        for(let index=0;index<htmlPages.length;index++){
          const oneHtml=htmlPages[index];docs.push(oneHtml);
          await page.setContent(oneHtml,{waitUntil:"domcontentloaded"});
          await page.evaluate(async()=>{document.documentElement.style.width="210mm";document.body.style.width="210mm";await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode().catch(()=>{})));});
          const layout=await page.evaluate(new Function("return ("+measureEstimatePrintDocument.toString()+")(document)"));
          sheets.push({name:(fixture.year||2026)+"_47_"+(customer+1)+"_p"+(index+1),worksheet:buildEstimateRenderedWorksheet(layout)});
        }
        await page.close();
      }
      // Same batch wrapper used by estimate.js: each customer's document starts a new page.
      const styles=[...new Set(docs.map(h=>h.match(/<style>([\s\S]*?)<\/style>/)[1]))].join('\n');
      const body=docs.map(h=>'<section class="print-page">'+h.match(/<body\b[^>]*>([\s\S]*?)<\/body>/)[1]+'</section>').join('');
      const bundle=`<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>${styles}\nbody{padding:0!important}.print-page{padding:10mm 15mm;break-after:page}.print-page:last-child{break-after:auto}</style></head><body>${body}</body></html>`;
      const page=await browser.newPage();await page.setContent(bundle,{waitUntil:'domcontentloaded'});await page.evaluate(()=>document.fonts.ready);
      const htmlPdf=path.join(folder,fixture.id+'.html.pdf'),xlsx=path.join(folder,fixture.id+'.xlsx'),excelPdf=path.join(folder,fixture.id+'.excel.pdf');
      await page.pdf({path:htmlPdf,format:'A4',preferCSSPageSize:true,printBackground:true});await page.close();
      fs.writeFileSync(xlsx,await serializeEstimatePrintWorkbook(buildEstimatePrintWorkbook(sheets)));
      execFileSync('powershell',['-NoProfile','-File','scripts/render-estimate-print-xlsx.ps1','-WorkbookPath',xlsx,'-PdfPath',excelPdf],{windowsHide:true});
      const pages=p=>Number(execFileSync('pdfinfo',[p],{encoding:'utf8',windowsHide:true}).match(/Pages:\s+(\d+)/)[1]);
      const expected=pages(htmlPdf),actual=pages(excelPdf);assert.equal(actual,expected,fixture.id+' page count');
      const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
      const read=async p=>{const pdf=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(p)),useSystemFonts:true}).promise;const texts=[],pageRows=[];for(let n=1;n<=pdf.numPages;n++){const items=(await (await pdf.getPage(n)).getTextContent()).items;texts.push(items.map(i=>i.str).join(' '));pageRows.push(items.flatMap(item=>[...item.str.matchAll(/연습\s*품목\s*T(\d{3})/g)].map(m=>({id:+m[1],y:item.transform[5]}))).sort((a,b)=>b.y-a.y).map(row=>row.id));}await pdf.destroy();const text=texts.join(' ');return {pageRows,compact:text.replace(/\s+/g,''),amounts:[...text.matchAll(/-?\d{1,3}(?:,\d{3})+(?:\.\d+)?/g)].map(m=>m[0])};};
      const a=await read(htmlPdf),b=await read(excelPdf);
      assert.equal(a.pageRows.flat().length,fixture.count*fixture.customers,fixture.id+' all HTML row IDs');
      assert.equal(b.pageRows.flat().length,fixture.count*fixture.customers,fixture.id+' all Excel row IDs');
      assert.deepEqual(b.pageRows,a.pageRows,fixture.id+' same item order and page boundaries');
      for(const text of ['사업자등록번호','연습용회사정보','연습업체1'])assert(b.compact.includes(text),fixture.id+' header '+text);
      const occurrences=(text,needle)=>text.split(needle).length-1;
      for(let c=1;c<=fixture.customers;c++)assert(b.compact.includes('연습업체'+c),fixture.id+' customer '+c);
      for(let i=1;i<=fixture.count;i++)assert.equal(occurrences(b.compact,'연습품목T'+String(i).padStart(3,'0')),fixture.customers,fixture.id+' item multiplicity '+i);
      for(const amount of new Set(a.amounts))assert.equal(b.amounts.filter(v=>v===amount).length,a.amounts.filter(v=>v===amount).length,fixture.id+' amount multiplicity '+amount);
      if(fixture.long)assert.equal(occurrences(b.compact,'품목과수량을빠뜨리지않습니다.'),occurrences(a.compact,'품목과수량을빠뜨리지않습니다.'),fixture.id+' complete long notes');
      if(fixture.format==='estimate'&&!fixture.china)assert.equal(b.compact.includes('120단(2)'),!fixture.noBox,fixture.id+' box option');
      console.log(JSON.stringify({fixture:fixture.id,htmlPages:expected,excelPages:actual,customers:fixture.customers,header:true,rows:true,amounts:true,htmlPageRows:a.pageRows.map(rows=>rows.length),excelPageRows:b.pageRows.map(rows=>rows.length)}));
      fs.writeFileSync(path.join(folder,fixture.id+'.evidence.json'),JSON.stringify({fixture:fixture.id,htmlPages:expected,excelPages:actual,htmlPageIds:a.pageRows,excelPageIds:b.pageRows,header:true,amountMultiplicity:true},null,2));
    }
  }finally{await browser.close();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
