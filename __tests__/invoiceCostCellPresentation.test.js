import test from 'node:test';import assert from 'node:assert/strict';import JSZip from 'jszip';import {createRequire}from'node:module';
import {invoiceCostExportFixture}from'./invoiceReceiptCostExport.test.js';import {createInvoiceCostWorkbook}from'../lib/invoiceReceiptCostExport.js';
import {INVOICE_COST_EXPORT_PROFILES}from'../lib/invoiceCostExportProfiles.js';
import {appendCostInputDifferentialStyle,costSellingInputCue}from'../lib/invoiceCostCellPresentation.js';
const X=createRequire(import.meta.url)('xlsx');
for(const profile of Object.values(INVOICE_COST_EXPORT_PROFILES))test(`${profile.id}: complete current metadata, no hidden populated cells, selling cue and immutable snapshot`,async()=>{
 const f=invoiceCostExportFixture(7,profile.formulaId);f.document.orderYear='2025';const before=JSON.stringify(f),bytes=await createInvoiceCostWorkbook(f),z=await JSZip.loadAsync(bytes),book=X.read(bytes,{cellFormula:true}),s=book.Sheets[book.SheetNames[0]];
 assert.equal(JSON.stringify(f),before);assert.match(book.SheetNames[0],/^2025 /);
 const compact=profile.priceBasis&&profile.id!=='EC_ORIGINAL_V1',col=compact?['US_ORIGINAL_V1','NZ_ORIGINAL_V1'].includes(profile.id)?'C':'D':'C';
 assert.equal(s[`${col}${compact?8:9}`].v,7);assert.match(s.B3.v,/원본|원가|추정/);
 const result=await z.file('xl/worksheets/sheet1.xml').async('string'),original=await z.file('xl/worksheets/sheet3.xml').async('string');
 assert.doesNotMatch(result,/<f\b|conditionalFormatting/);assert.match(original,/<conditionalFormatting/);assert.match(original,/NOT\(ISNUMBER\(/);assert.match(await z.file('xl/styles.xml').async('string'),/FFFCE4D6/);
 if(profile.id==='CN_SEA_ORIGINAL_V1'){const comparison=await z.file('xl/worksheets/sheet2.xml').async('string');assert.match(comparison,/sqref="W13:X19"/);assert.match(comparison,/AND\(\$B13&lt;&gt;0/);}
 if(profile.id==='CO_42_1_ORIGINAL_V1'){const c=book.Sheets['원본 양식 계산'];assert.match(c.P15.f,/ISNUMBER\(Q15\)/);assert.match(c.S15.f,/ISNUMBER\(P15\)/);assert.match(c.V15.f,/ISNUMBER\(S15\)/);assert.match(c.U13.f,/COUNT\(U15:U21\)=7/);assert.equal(typeof c.U13.v,'number');}
 const populated=Object.entries(s).filter(([r,c])=>/^[A-Z]+\d+$/.test(r)&&c.v!==undefined&&c.v!=='');
 for(const m of s['!merges']||[])for(const[ref]of populated){const c=X.utils.decode_cell(ref);assert.ok(!(c.r>=m.s.r&&c.r<=m.e.r&&c.c>=m.s.c&&c.c<=m.e.c)||c.r===m.s.r&&c.c===m.s.c,`${profile.id}:${ref} hidden inside merged range ${X.utils.encode_range(m)}`);}
 if(profile.id==='NL_ORIGINAL_V1'){assert.equal(s.J6.v,'Eryngium');assert.equal(s.K6.v,.25);assert.equal(s.M8.v,.08);assert.equal(s.H6.v,f.document.lines.reduce((n,r)=>n+r.lineAmount,0)+f.revision.lines.reduce((n,r)=>n+r.componentAmounts.freightNative,0));assert.equal(s.C12.v,f.snapshot.receiptSnapshot.details.reduce((n,r)=>n+r.stemQuantity,0));assert.match(s.E11.v,/미보유/);}
 for(const name of book.SheetNames)for(const[ref,c]of Object.entries(book.Sheets[name]))if(/^[A-Z]+\d+$/.test(ref))assert.notEqual(c.t,'e',`${name}!${ref}`);
});
test('input cue appends differential style without altering original rules and uses relative numeric blank/zero check',()=>{
 const base='<styleSheet><cellXfs count="1"><xf/></cellXfs><dxfs count="1"><dxf><font/></dxf></dxfs><tableStyles/></styleSheet>',s=appendCostInputDifferentialStyle(base);assert.equal(s.id,1);assert.match(s.styles,/<dxf><font\/><\/dxf>/);assert.match(s.styles,/<dxfs count="2">/);
 const p=INVOICE_COST_EXPORT_PROFILES.NL_ORIGINAL_V1,x=costSellingInputCue({sheet:'<worksheet><sheetData/><pageMargins/></worksheet>',profile:p,count:71,dxfId:s.id});assert.match(x,/sqref="R15:R85"/);assert.match(x,/NOT\(ISNUMBER\(R15\)\)/);assert.ok(x.indexOf('conditionalFormatting')<x.indexOf('pageMargins'));
});
