import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseAwbNumber,parseAwbFields} from '../lib/importAwbFields.js';
import {colombiaAwbOriginal} from '../lib/arrivalDriveAwbEvidence.js';
for(const [raw,value] of [['4152,0',4152],['2,95',2.95],['12320,40',12320.4],['12.320,40',12320.4],['12,320.40',12320.4],['4,152',4152],['0,00',0]])assert.equal(parseAwbNumber(raw),value);
for(const bad of ['',null,false,'1,23,20','1.2.3','1,234,56','0,001','0.001','-1','NaN'])assert.equal(parseAwbNumber(bad),null);
const item=(str,x,y,width=30)=>({str,x,y,width});
const source={text:'Air Waybill Colombia 160-17338020 Shipper\'s Name and Address Consignee\'s Name and Address 07-Nov-26 MEDELLIN Executed on (date)',items:[
 item('Gross',64,445),item('Chargeable',178,445),item('Rate',232,445),item('662',22,416),item('3487',73,416),item('4152,0',185,416),item('2,95',263,416),item('12248,40',334,416),
 item('Total Prepaid',53,110,33),item('Total Collect',149,110,31),item('12320,40',83,96,36),item('Currency Conversion Rates',35,88,68),item('07-Nov-26',215,84,38),item('Executed on (date)',216,72,46)]};
const parsed=parseAwbFields(source);assert.equal(parsed.gw,3487);assert.equal(parsed.cw,4152);assert.equal(parsed.uPrice1,2.95);assert.equal(parsed.total,12320.4);assert.equal(parsed.date,'2026/11/07');
assert.equal(colombiaAwbOriginal(source.text).year,'2026');
const commodity=structuredClone(source);commodity.items.push(item('1420',130,416));assert.equal(parseAwbFields(commodity).gw,3487,'commodity code is not GW');
const conflict=structuredClone(source);conflict.items.push(item('100,00',155,96));assert.equal(parseAwbFields(conflict).total,undefined);
const file=process.env.NENOVA_CO46_AWB||'C:/Users/USER/Downloads/46-1 콜수국 AWB.pdf';
if(fs.existsSync(file)){
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const task=getDocument({data:new Uint8Array(fs.readFileSync(file)),isEvalSupported:false});
 try{const d=await task.promise,pages=[];for(let n=1;n<=d.numPages;n++){const c=await(await d.getPage(n)).getTextContent();pages.push({text:c.items.map(i=>i.str||'').join(' '),items:c.items});}
 const input={pages,text:pages.map(p=>p.text).join('\n')},result=parseAwbFields(input);
 assert.equal(result.gw,3487);assert.equal(result.cw,4152);assert.equal(result.total,12320.4);assert.equal(result.date,'2026/11/07');assert.equal(colombiaAwbOriginal(input.text).year,'2026');console.log('actual 46-1 AWB locale/identity PASS');
 }finally{await task.destroy();}
}
console.log('CO AWB locale, original execution date, total ambiguity and commodity counterexamples PASS');
