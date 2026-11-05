// Synthetic-only real PDF regression. No server, credentials, SQL or saved PDF.
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const XLSX = require('xlsx-js-style');
(async () => {
  const {buildProfitReportXlsx} = await import('../lib/profitReportExcel.js');
  const {outputPrintHtml,formatPrintUserNote} = await import('../lib/profitRangeOutput.mjs');
  const {fitProfitPrintDocument} = await import('../lib/profitPrintLayout.mjs');
  const {profitReportCategoriesForWeek} = await import('../lib/profitReportCountryResolver.js');
  const {getDocument} = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const columns=['C','AC','D','E','F','G','H','I','J','AJ','K','L','M','N','O','P','Q','R','S','T','U'];
  const rows=profitReportCategoriesForWeek(38).map(def=>({category:def.key,confirmed:true,
    calc:Object.fromEntries(columns.map(key=>[key,key==='K'?.25:100]))}));
  const paragraph='[합성검증] GW 100kg / CW 200kg → CBM · 실제−비교 운임부담 +10,000원 · 재고유보 반영 이익효과 −8,000원 / 이익률 -0.800%p · 합성품목 실제 재고조정 -2박스 · 보고서 평균원가 기준 평가액 -400원 · 기말→기초 평가차이 +20원 (StockHistory 실제 조정과 별개)';
  const notes=[`${paragraph}\n[짧은끝항목]`,Array(75).fill(paragraph).join('\n')+'\n[긴끝항목8533이상]',Array(150).fill(paragraph).join('\n')+'\n[매우긴끝항목]'];
  assert(notes[1].replace(/\s/g,'').length>8533,'Long regression must exceed the production failing note length');
  const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH || (process.platform==='win32'
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe':'/usr/bin/google-chrome'),headless:true,args:process.env.CI?['--no-sandbox']:[]});
  try {
    const items=notes.map((note,i)=>({year:'2026',major:String(38+i),workbook:buildProfitReportXlsx({major:38+i,rows,note,
      confirmedTotals:rows[0].calc,visibleCols:columns,returnWorkbook:true})}));
    const html=outputPrintHtml(items,sheet=>XLSX.utils.sheet_to_json(sheet,{header:1,raw:false,defval:''}));
    const original=JSON.stringify(items);
    const frame=await browser.newPage();await frame.setViewport({width:1920,height:1080});await frame.setContent(html);
    await frame.evaluate(()=>document.fonts.ready);
    const fit=()=>frame.evaluate(source=>(0,eval)(`(${source})(document)`),fitProfitPrintDocument.toString());
    await fit();
    const measurements=()=>frame.$$eval('.profit-print-page',pages=>pages.map(page=>{
      const box=page.getBoundingClientRect(),note=page.querySelector('.note').getBoundingClientRect();
      return {scale:page.dataset.printScale,transform:page.querySelector('.profit-print-content').style.transform,
        zoom:page.querySelector('.profit-print-content').style.zoom,fits:note.bottom<=box.bottom+1&&note.right<=box.right+1,
        bottom:note.bottom-box.top,pageHeight:box.height,right:note.right-box.left,pageWidth:box.width};
    }));
    const first=await measurements();await fit();assert.deepEqual(await measurements(),first,'Repeated fit must not compound scaling');
    console.log(JSON.stringify({syntheticFitMeasurements:first}));
    assert(first.every(item=>item.fits&&item.transform==='none'&&Number(item.zoom)>0));
    // Match the production QA: serialize fitted iframe HTML and render in a new
    // PDF document, rather than testing only the original viewport geometry.
    const printHtml=await frame.content();await frame.close();
    const pdfPage=await browser.newPage();await pdfPage.setContent(printHtml);await pdfPage.emulateMediaType('print');
    await pdfPage.evaluate(()=>document.fonts.ready);
    const bytes=await pdfPage.pdf({preferCSSPageSize:true,printBackground:true});
    const document=await getDocument({data:new Uint8Array(bytes),useSystemFonts:true}).promise;
    assert.equal(document.numPages,notes.length,'One full note and table per A4 landscape sheet');
    for(let i=0;i<notes.length;i++) {
      const page=await document.getPage(i+1),viewport=page.getViewport({scale:1});
      assert(Math.abs(viewport.width-841.89)<2&&Math.abs(viewport.height-595.28)<2);
      const text=(await page.getTextContent()).items.map(item=>item.str).join('').replace(/\s/g,'');
      const expected=formatPrintUserNote(notes[i]).replace(/\s/g,'');
      assert(text.includes(expected),`Entire synthetic note ${i+1}, including all signed values, glyphs and last item, must survive PDF`);
      assert(text.includes(`2026년${38+i}차매출이익보고서`));
      console.log(JSON.stringify({syntheticLongNotePdf:'PASS',page:i+1,noteLength:expected.length,scale:first[i].scale,wholeNoteExact:true}));
    }
    assert.equal(JSON.stringify(items),original,'Output fitting must not mutate source note or financial workbook');
    await document.destroy();await pdfPage.close();
  } finally {await browser.close();}
})().catch(error=>{console.error(error.name+': '+error.message);process.exitCode=1;});
