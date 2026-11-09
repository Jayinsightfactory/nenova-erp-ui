import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {parseArrivalCostWorkbook} from '../lib/arrivalCostExcel.js';
import {prepareSheetReviews,summarizeReview,namedCountry} from '../lib/arrivalUploadReview.js';
const wb=XLSX.utils.book_new();
for(const sheet of ['40-2','41-2','52-2']) XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['Colombia 검역 비용'],['품목명','수량','도착원가(단)'],['Tulip / Test',20,3000]]),sheet);
const bytes=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
const selections=[{sheetName:'40-2',selected:true,country:'네덜란드',orderWeek:'40-02',confirmYear:true},{sheetName:'41-2',selected:false},{sheetName:'52-2',selected:false}];
const reviews=prepareSheetReviews(selections,'41-2 NL 원가.xlsx');
const parsed=parseArrivalCostWorkbook(bytes,{fileName:'41-2 NL 원가.xlsx',orderYear:'2026',sheetReviews:reviews});
assert.equal(parsed.rows.length,1);assert.equal(parsed.rows[0].countryName,'네덜란드');assert.equal(parsed.rows[0].orderWeek,'40-2');assert.equal(summarizeReview(parsed,reviews,'2026').canCommit,true);
assert.equal(summarizeReview(parsed,reviews.map(s=>({...s,confirmYear:false})),'2026').canCommit,false);
assert.equal(namedCountry('40-2차.xlsx','Sheet1'),'');
assert.throws(()=>prepareSheetReviews([{...selections[0],country:'콜롬비아'}],'NL 원가.xlsx'),/국가/);
assert.throws(()=>prepareSheetReviews([{...selections[0],orderWeek:'41-2'}],'NL 원가.xlsx'),/차수/);
assert.throws(()=>prepareSheetReviews([{...selections[0],country:''}],'40-2차.xlsx'),/국가/);
assert.throws(()=>prepareSheetReviews([{...selections[0],orderWeek:'0-0'}],'NL 원가.xlsx'),/차수/);
for(const year of ['2025','2026']){const p=parseArrivalCostWorkbook(bytes,{fileName:`${year}년 NL.xlsx`,orderYear:year,sheetReviews:reviews});assert.equal(summarizeReview(p,reviews,year).canCommit,true);assert.equal(summarizeReview(p,reviews,year==='2025'?'2026':'2025').canCommit,false);}
const missing={...parsed,rejectedRows:[{sheetName:'40-2'}]};assert.equal(summarizeReview(missing,reviews,'2026').canCommit,false);
assert.notEqual(summarizeReview(parsed,reviews,'2026').digest,summarizeReview({...parsed,rows:parsed.rows.map(r=>({...r,quantity:21}))},reviews,'2026').digest);
console.log('review: year/country/week, excluded old sheets, missing cost, stale digest passed');
// Execute the actual HTTP handler with isolated multipart/SQL/storage adapters.
import fs from 'node:fs';
import {namedCountry as named,prepareSheetReviews as prepare,summarizeReview as summary} from '../lib/arrivalUploadReview.js';
const apiSource=fs.readFileSync(new URL('../pages/api/arrival-cost/upload.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export const config=','const config=').replace('export default withAuth','return withAuth');
let stored=null,saves=0,mirrored=[];
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const handler=await new AsyncFunction('fs','formidable','XLSX','withAuth','query','parseArrivalCostWorkbook','createArrivalCostImport','loadMappings','arrivalUploadViewScope','namedCountry','prepareSheetReviews','summarizeReview','retainUpload','readReview','writeReview','originalBytes','mirrorWebUpload',apiSource)(
 {readFileSync:()=>bytes,unlinkSync:()=>{}},()=>({parse:(req,cb)=>cb(null,req.fields,req.files||{})}),XLSX,h=>h,async()=>({recordset:[]}),parseArrivalCostWorkbook,async()=>{saves++;return {rowCount:1}},async()=>({}),()=>null,named,prepare,summary,
 (b,fileName,u)=>(stored={id:'11111111-1111-4111-8111-111111111111',fileName,owner:u.userId,sha:'fixture',attempts:[]}), (id,u)=>{if(id!==stored.id||u.userId!==stored.owner)throw Error('owner mismatch');return stored;},r=>{stored=r;},()=>bytes,(m)=>{mirrored.push(m);return {ok:true};});
async function call(fields,files,userId='test'){let status=200,result;await handler({method:'POST',fields,files,user:{userId}},{setHeader(){},status(s){status=s;return this;},json(j){result=j;return j;}});return {status,...result};}
const initial=await call({action:'preview',orderYear:'2026'},{file:{filepath:'fixture',originalFilename:'41-2 NL 원가.xlsx'}});assert.equal(saves,0);assert.equal(mirrored.length,1);assert.equal(mirrored[0].source,'arrival-cost/upload');assert.equal(mirrored[0].filename,'41-2 NL 원가.xlsx'); // 원본이 업무 드라이브로도 미러됨(2026-11-09)assert.equal(initial.canCommit,false);
const selected=JSON.stringify(selections);
const reviewed=await call({action:'review',orderYear:'2026',reviewId:stored.id,sheets:selected});assert.equal(reviewed.canCommit,true);assert.equal(saves,0);
assert.equal((await call({action:'commit',orderYear:'2026',reviewId:stored.id,sheets:selected,digest:'stale'})).status,400);assert.equal(saves,0);
assert.equal((await call({action:'review',orderYear:'2026',reviewId:stored.id,sheets:selected},null,'other')).status,400);
const saved=await call({action:'commit',orderYear:'2026',reviewId:stored.id,sheets:selected,digest:reviewed.digest});assert.equal(saved.success,true);assert.equal(saves,1);
await call({action:'commit',orderYear:'2026',reviewId:stored.id,sheets:selected,digest:reviewed.digest});assert.equal(saves,1);assert.ok(stored.attempts.some(a=>a.error));
console.log('actual upload handler: preview zero writes, owner check, stale digest blocked, commit once, retry idempotent, failure audit passed');
// Current writer readback is part of the transaction and an idempotent review is checked under the shared lock.
import {validateArrivalImportYear} from '../lib/arrivalImportPolicy.js';
const writer=fs.readFileSync(new URL('../lib/arrivalCost.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export async function','async function').replaceAll('export function','function').replaceAll('export const','const');
let committed=0,rolledBack=0,wrongReadback=false,prior=false;
const one=parsed.rows[0];
const query=async(text,p={})=>{
 if(text.includes("h.ActionType=N'REVIEW_UPLOAD'"))return {recordset:prior?[{ImportKey:77}]:[]};
 if(text.includes('SELECT OrderYear,OrderWeek,CountryName'))return {recordset:[{OrderYear:'2026',OrderWeek:one.orderWeek,CountryName:one.countryName,ProductNameRaw:one.productNameRaw,FarmNameRaw:one.farmNameRaw,Unit:one.unit,Quantity:wrongReadback?999:one.quantity,SourceArrivalCostKRW:one.sourceArrivalCostKRW,SelectedArrivalCostKRW:one.selectedArrivalCostKRW,ProdKey:one.prodKey,FarmKey:one.farmKey}]};
 if(text.includes('MAX(RevisionNo)'))return {recordset:[{RevisionNo:1}]};
 if(text.includes('OUTPUT INSERTED.ImportKey'))return {recordset:[{ImportKey:77}]};
 return {recordset:[]};
};
const writerFn=await new AsyncFunction('query','withTransaction','sql','validateArrivalImportYear',writer+'\nreturn createArrivalCostImport;')(query,async fn=>{try{const r=await fn(query);committed++;return r;}catch(e){rolledBack++;throw e;}},{Int:'int',NVarChar:'nvarchar',Decimal:()=>''},validateArrivalImportYear);
const input={parsed,fileName:'NL.xlsx',user:{userId:'test'},orderYear:'2026',reviewSource:{id:'test-review'}};
await writerFn(input);assert.equal(committed,1);
wrongReadback=true;await assert.rejects(writerFn(input),/롤백/);assert.equal(rolledBack,1);
prior=true;const repeated=await writerFn(input);assert.equal(repeated.duplicate,true);
console.log('actual writer: positive readback, quantity drift rollback, locked review dedup passed');
