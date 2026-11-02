// Mechanical read-only extraction. Private workbook paths never enter the asset.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {INVOICE_COST_EXPORT_PROFILES} from '../lib/invoiceCostExportProfiles.js';
const XLSX=createRequire(import.meta.url)('xlsx');
const columns={NL:['O','R','S','N'],CN_SEA:['P','R','S','O'],US:['L','N','O','K'],VN:['M','O','P','L'],AU:['M','O','P','L'],NZ:['M','O','P','L'],EC:['O','Q','R','N'],CO:['O','Q','R','N'],TH:['P','R','S','O'],CO42:['O','Q','R','N'],CN_AIR:['O','Q','R','N']};
const profiles={};
for(const source of JSON.parse(fs.readFileSync(process.argv[2],'utf8'))){
 const p=Object.values(INVOICE_COST_EXPORT_PROFILES).find(p=>p.sourceHash===source.hash);
 if(!p)throw Error('Unknown source');
 const bytes=fs.readFileSync(source.filename);
 if(createHash('sha256').update(bytes).digest('hex')!==p.sourceHash)throw Error('Source hash mismatch');
 const s=XLSX.read(bytes,{cellFormula:true}).Sheets[p.sourceSheet], [cost,input,recommend,factor]=columns[source.id];
 const records=[]; let formulaCount=0;
 for(let r=p.detailPrototypeRow??p.detailStartRow;r<=p.lastDetailRow;r++){
  if(s[`${recommend}${r}`]?.f){
   const f=s[`${recommend}${r}`].f.replace(/[+()\s]/g,'');
   if(f!==`${cost}${r}/${source.id==='CN_SEA'?'0.85*1.1':'0.77'}`)throw Error(`Different source sale formula ${source.id}:${r}`);
   formulaCount++;
  }
  const value=s[`${input}${r}`], unitFactor=s[`${factor}${r}`]?.v, name=s[`${source.id==='TH'?'C':'B'}${r}`]?.v;
  if(name&&typeof value?.v==='number'&&!value.f&&Number.isFinite(value.v)&&value.v>=0&&typeof unitFactor==='number'&&unitFactor>0)
   records.push({name,price:value.v,factor:unitFactor,cell:`${input}${r}`});
 }
 if(!formulaCount)throw Error('Missing recommendation evidence');
 if(source.id==='AU')for(let r=3;r<=12;r++)if(typeof s[`V${r}`]?.v==='string'&&typeof s[`W${r}`]?.v==='number')
  records.push({name:s[`V${r}`].v,price:s[`W${r}`].v,factor:1,cell:`W${r}`});
 profiles[p.id]={sourceHash:p.sourceHash,sourceSheet:p.sourceSheet,divisor:source.id==='CN_SEA'?.85:.77,multiplier:source.id==='CN_SEA'?1.1:1,records};
}
const data={schemaVersion:1,profiles};
console.log(JSON.stringify({...data,assetHash:createHash('sha256').update(JSON.stringify(data)).digest('hex')},null,2));
