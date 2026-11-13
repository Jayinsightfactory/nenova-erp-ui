'use strict';
const XLSX=require('xlsx');
function makeWorkbook(label,target=0,cycle='40-1'){
 const book=XLSX.utils.book_new();for(let i=1;i<=12;i++)XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Synthetic fixture',label],['Quantity',10],['Amount',12.5]]),i===1?cycle:'Summary '+i);
 const bytes=XLSX.write(book,{type:'buffer',bookType:'xlsx',compression:true});if(!target)return bytes;
 const zip=XLSX.CFB.read(bytes,{type:'buffer'}),types=zip.FileIndex[zip.FullPaths.findIndex(p=>p.endsWith('/[Content_Types].xml'))];
 types.content=Buffer.from(types.content.toString('utf8').replace('</Types>','<Default Extension="bin" ContentType="application/octet-stream"/></Types>'));types.size=types.content.length;
 XLSX.CFB.utils.cfb_add(zip,'synthetic/padding.bin',Buffer.alloc(1));const baseLength=XLSX.CFB.write(zip,{type:'buffer',fileType:'zip',compression:false}).length;
 const padding=zip.FileIndex[zip.FullPaths.findIndex(p=>p.endsWith('/synthetic/padding.bin'))];padding.content=Buffer.alloc(target-baseLength+1,37);padding.size=padding.content.length;const result=XLSX.CFB.write(zip,{type:'buffer',fileType:'zip',compression:false});
 if(result.length!==target||XLSX.read(result,{type:'buffer',bookSheets:true}).SheetNames.length!==12)throw Error('Maximum workbook validation failed');return result;
}
function makePdf(label){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 150] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 const stream=`BT /F1 12 Tf 20 90 Td (Synthetic invoice ${label}) Tj ET`;objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);let text='%PDF-1.4\n',offsets=[0];
 objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${o}\nendobj\n`;});const xref=Buffer.byteLength(text);text+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(text);
}
module.exports={makeWorkbook,makePdf};
