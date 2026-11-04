// Mechanical extraction from the reviewed private workbook; never uploads it.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {INVOICE_COST_EXPORT_PROFILES} from '../lib/invoiceCostExportProfiles.js';
const X=createRequire(import.meta.url)('xlsx'),p=INVOICE_COST_EXPORT_PROFILES.CN_SEA_ORIGINAL_V1;
const bytes=fs.readFileSync(process.argv[2]);
if(createHash('sha256').update(bytes).digest('hex')!==p.sourceHash)throw Error('Unverified source');
const s=X.read(bytes,{cellFormula:true}).Sheets[p.sourceSheet],records=[];
for(let r=p.detailPrototypeRow??p.detailStartRow;r<=p.lastDetailRow;r++){
 const name=s[`B${r}`]?.v,link=s[`H${r}`]?.f?.match(/^\+?\$?Q\$?(\d+)$/);
 if(typeof name!=='string'||!link)continue;
 const n=Number(link[1]),dimensions=s[`L${n}`]?.v,bunches=s[`N${n}`]?.v,f=s[`M${n}`]?.f;
 if(typeof dimensions!=='string'||!/^\d+(?:\.\d+)?\*\d+(?:\.\d+)?\*\d+(?:\.\d+)?$/.test(dimensions)||!/^\d+(?:\.\d+)?\*\d+(?:\.\d+)?\*\d+(?:\.\d+)?$/.test(f??'')||!(bunches>0))throw Error(`Invalid CBM evidence row ${r}`);
 const cbm=dimensions.split('*').reduce((a,b)=>a*Number(b)/100,1),formulaCbm=f.split('*').reduce((a,b)=>a*Number(b),1);
 if(Math.abs(cbm-formulaCbm)>1e-12)throw Error('Dimensions/formula mismatch');
 records.push({name,boxCbm:cbm,bunchesPerBox:bunches,dimensionsCm:dimensions,sourceCell:`H${r} → M${n}/N${n}`});
}
if(!records.length)throw Error('No source records');
const data={schemaVersion:1,sourceHash:p.sourceHash,sourceSheet:p.sourceSheet,records};
fs.writeFileSync(process.argv[3],JSON.stringify({...data,assetHash:createHash('sha256').update(JSON.stringify(data)).digest('hex')},null,2)+'\n');
console.log({records:records.length});
