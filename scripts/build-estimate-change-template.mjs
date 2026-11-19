import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
// Set ARTIFACT_NODE_MODULES from load_workspace_dependencies; use its bundled Node binary.
const artifactRequire=createRequire(path.join(process.env.ARTIFACT_NODE_MODULES||path.join(process.cwd(),'node_modules'),'artifact-runtime.cjs'));
const {Workbook,SpreadsheetFile}=await import(pathToFileURL(artifactRequire.resolve('@oai/artifact-tool')));

const wb=Workbook.create(),sheet=wb.worksheets.add('변경요청서');
sheet.showGridLines=false;
const range=sheet.getRange('A1:I7');
range.values=Array.from({length:7},()=>Array(9).fill(''));
range.format.font={name:'맑은 고딕',size:11,color:'#111111'};
range.format.wrapText=true;
range.format.verticalAlignment='center';
range.format.horizontalAlignment='center';
const widths=[8,15,26,10,8,12,12,15,6];
widths.forEach((w,i)=>sheet.getRange(`${String.fromCharCode(65+i)}1:${String.fromCharCode(65+i)}7`).format.columnWidth=w);
sheet.getRange('A1:I1').merge();
sheet.getRange('A1').values=[['견 적 변 경 요 청 서']];
sheet.getRange('A1:I1').format.font={name:'맑은 고딕',size:24,bold:true};
sheet.getRange('A1:I1').format.rowHeight=52.5;
sheet.getRange('A2:I4').format.rowHeight=17.25;
for(const a of ['B5:G5','H5:I5','H6:I6','H7:I7'])sheet.getRange(a).merge();
sheet.getRange('A5:I5').format.rowHeight=28;
sheet.getRange('A5').setNumberFormat('yyyy-mm-dd');
sheet.getRange('A5').format.font={name:'맑은 고딕',size:9,color:'#111111'};
sheet.getRange('A5').format.wrapText=false;
sheet.getRange('A5').values=[['작성일']];
sheet.getRange('H5').values=[['작성자']];
sheet.getRange('A6:H6').values=[['차수','업체','품목','색상','단위','변경전','변경후','비고']];
sheet.getRange('A6:I6').format.font={name:'맑은 고딕',size:11,bold:true};
sheet.getRange('A6:I6').format.fill='#F2F2F2';
sheet.getRange('A6:I7').format.borders={preset:'all',style:'thin',color:'#222222'};
sheet.getRange('A6:I6').format.rowHeight=27;
sheet.getRange('A7:I7').format.rowHeight=40;
sheet.getRange('F7:G7').setNumberFormat('#,##0.###############;[Red]-#,##0.###############');
sheet.getRange('H7:I7').format.horizontalAlignment='left';
if(process.argv.includes('--help-print')){
 console.log(wb.help('print',{search:'print|page',include:'index,examples,notes',maxChars:3500}).ndjson);
}else{
 const output=path.resolve(process.argv[2]);await fs.mkdir(output,{recursive:true});
 const file=await SpreadsheetFile.exportXlsx(wb);const target=path.join(output,'estimate-change-request.xlsx');await file.save(target);
 // Artifact API has no documented print setup. Preserve its authored cells/styles and finalize only OpenXML print metadata.
 const {default:print}=await import('../lib/estimateChangeHistoryWorkbook.cjs');await fs.writeFile(target,await print.prepareBlankTemplate(await fs.readFile(target)));
 const png=await wb.render({sheetName:'변경요청서',range:'A1:I7',scale:1.5,format:'png'});
 await fs.writeFile(path.join(output,'template-preview.png'),new Uint8Array(await png.arrayBuffer()));
 console.log('Created blank reference-format template; no source workbook values imported.');
}
