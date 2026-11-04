import assert from 'node:assert/strict';
import fs from 'node:fs';
import {canUseLocalPasteParse,createPasteAnalysisMetrics} from '../lib/pasteLocalAnalysis.js';
import {localProductReviewKey,reviewPasteMatches,PASTE_REVIEW_SYSTEM} from '../lib/pasteAiMatchReview.js';
import * as natural from '../lib/pasteNaturalInlineOrder.js';
import * as sales from '../lib/salesPasteOrder.js';
import * as units from '../lib/pasteOrderUnit.js';
import {resolveImportCustomer} from '../lib/orderImportCustomerMatch.js';

const customers=[{CustKey:1,CustName:'검증업체'}];
const products=[{ProdKey:10,ProdName:'CARNATION Moon Light',DisplayName:'문라이트',FlowerName:'카네이션',CounName:'콜롬비아',OutUnit:'박스'}];
const productMappings={'카네이션 문라이트':{prodKey:10,manual:true}};
const source=fs.readFileSync('pages/api/orders/parse-paste.js','utf8');
// Execute the real handler with isolated read-only master/model adapters; never DB/API credentials.
function fixture({modelFail=false,mappings=productMappings,legacy=false}={}){
  const calls=[];
  const deps={...natural,...sales,...units,resolveImportCustomer,canUseLocalPasteParse,createPasteAnalysisMetrics,reviewPasteMatches,PASTE_REVIEW_SYSTEM,
    process:{env:{ANTHROPIC_API_KEY:'fixture'}},sql:{Int:'int'},withAuth:x=>x,trackLLMCall:()=>{},
    Anthropic:class {constructor(){this.messages={create:async input=>{calls.push(input);if(modelFail)throw Error('fixture timeout');const data=input.system===PASTE_REVIEW_SYSTEM?{decisions:[]}:{orders:[{custName:'검증업체',items:[{inputName:'카네이션 문라이트',qty:1,unit:'박스',action:'추가'}]}]};return {content:[{type:'text',text:JSON.stringify(data)}],usage:{input_tokens:100,output_tokens:10}};}};}},
    query:async sql=>({recordset:sql.includes('FROM Customer')?customers:sql.includes('FROM Product')?products:[]}),
    loadMappings:async()=>mappings,loadCustomerMappings:async()=>({}),loadImportUnits:()=>({}),
    matchImportRows:rows=>rows.map(()=>({prodKey:10,prodName:products[0].ProdName,unit:'박스',confidence:1})),
  };
  const parserSource=legacy?source.replace(/const localParse=.*?;/,'const localParse=false;').replace('productMappings:savedProductMappings,metrics:analysis.metrics,','metrics:analysis.metrics,'):source;
  const body=parserSource.replace(/^import .*;\r?\n/gm,'').replace(/export const config/,'const config').replace('export async function parsePasteHandler','async function parsePasteHandler').replace('export default withAuth(parsePasteHandler);','');
  const handler=new Function(...Object.keys(deps),body+'\nreturn parsePasteHandler;')(...Object.values(deps));
  return {calls,async run(text,year='2026'){let status=200,data;await handler({method:'POST',body:{text,selectedOrderYear:year},user:{userId:'fixture'}},{status(n){status=n;return this;},json(d){data=d;}});return {status,data};}};
}

const baseline=fixture({legacy:true});await baseline.run('44-1 카네이션 변경사항\n검증업체\n문라이트 1박스 추가');assert.equal(baseline.calls.length,2,'baseline full parse plus model review');
for(const year of ['2025','2026']){
  const f=fixture(),r=await f.run('44-1 카네이션 변경사항\n검증업체\n문라이트 1박스 추가',year);
  assert.equal(r.status,200);assert.equal(f.calls.length,0);assert.equal(r.data.analysisPerformance.modelCalls,0);
  assert.equal(r.data.parseSource,'rules-local');assert.equal(r.data.orders[0].items[0].prodKey,10);assert.equal(r.data.orders[0].items[0].qty,1);
  const cancel=await f.run('44-1 카네이션 변경사항\n검증업체\n문라이트 2박스 취소',year);assert.equal(cancel.data.orders[0].items[0].action,'취소');assert.equal(f.calls.length,0);
}
const omitted=fixture();const omittedResult=await omitted.run('44-1 카네이션 변경사항\n검증업체\n문라이트 1추가');assert.equal(omitted.calls.length,0);assert.equal(omittedResult.data.orders[0].items[0].unit,'박스');
const noHeader=fixture();await noHeader.run('검증업체\n문라이트 1추가');assert(noHeader.calls.length>0);
for(const note of ['-> 오늘 출고입니다','오늘 출고 입니다.','나머지는 검역 표기','수요일 출고 물건입니다.','금요일 출고분 입니다.']){const f=fixture();const r=await f.run('44-1차 카네이션 변경사항\n검증업체\n문라이트 1추가\n'+note);assert.equal(f.calls.length,0,note);assert.equal(r.data.orders[0].items[0].qty,1);}
for(const note of ['-> 문라이트 2박스로 변경','-> 핑크로 바꿔 출고','오늘 2박스 출고','나머지는 제외','-> 출고 색상 변경']){const f=fixture();await f.run('44-1 카네이션 변경사항\n검증업체\n문라이트 1박스 추가\n'+note);assert(f.calls.length>0,note);}
for(const memo of ['(농장표기)','(검역분)','(총 50단)']){const f=fixture();const r=await f.run('44-1차 카네이션 변경사항\n검증업체\n문라이트 1박스 추가 '+memo);assert.equal(f.calls.length,0,memo);assert.equal(r.data.orders[0].items[0].qty,1);}
const conflicting=fixture();await conflicting.run('44-1 카네이션 변경사항\n검증업체\n문라이트 1박스 추가 (사실 취소)');assert(conflicting.calls.length>0);
const odd=fixture();await odd.run('44-1 카네이션 변경사항\n검증업체\n문라이트 1박스 추가\n내일 상태 보고 변경');assert(odd.calls.length>0,'unknown line must retain model fallback');
const duplicate=fixture();await duplicate.run('검증업체\n문라이트 1박스 추가\n문라이트 1박스 추가');assert.equal(duplicate.calls.length,0); // exact display-name path
for(const text of ['검증업체\n문라이트 -1박스','검증업체\n문라이트 0박스','검증업체\n문라이트 1박스 (냉해 취소)','검증업체\n문라이트 1','검증업체\n문라이트 1박스+2단','이름모름\n문라이트 1박스']){
  assert.equal(canUseLocalPasteParse(text,{orders:[]},customers,{}),false);
}
const item={inputName:'카네이션 문라이트',matchName:'카네이션 문라이트',prodKey:10};
assert.equal(localProductReviewKey(item,products,productMappings),10);
assert.equal(localProductReviewKey({...item,prodKey:99},products,productMappings),null,'common ranker disagreement must remain review');
assert.equal(localProductReviewKey({...item,ambiguousCountry:true},products,productMappings),null);
const wrongUnit={orders:[{custName:'검증업체',items:[{inputName:'문라이트',qty:1,unit:'단',action:'추가'}]}]};assert.equal(canUseLocalPasteParse('검증업체\n문라이트 1박스 추가',wrongUnit,customers),false);
const wrongName={orders:[{custName:'검증업체',items:[{inputName:'노비아',qty:1,unit:'박스',action:'추가'}]}]};assert.equal(canUseLocalPasteParse('검증업체\n문라이트 1박스 추가',wrongName,customers),false);
assert.equal(localProductReviewKey(item,products,{'카네이션 문라이트':{prodKey:10,auto:true}}),null);
assert.equal(localProductReviewKey(item,products,{'카네이션 문라이트':{prodKey:99,manual:true}}),null);
assert.equal(localProductReviewKey({...item,matchName:'중국 카네이션 문라이트'},products,productMappings),null);
assert.equal(localProductReviewKey({...item,matchName:'장미 문라이트 60cm'},products,productMappings),null);
assert.equal(localProductReviewKey(item,[{...products[0],isDeleted:1}],productMappings),null);
const roses=[{ProdKey:20,ProdName:'Rose 40cm',DisplayName:'장미 품종',FlowerName:'장미',CounName:'콜롬비아'}];
assert.equal(localProductReviewKey({inputName:'장미 품종'},roses,{}),null,'default rose size cannot become 40cm');
assert.equal(localProductReviewKey({inputName:'문라이트'},[...products,{...products[0],ProdKey:11}],{}),null,'duplicate names require review');
const orders=Array.from({length:30},()=>({custName:'검증업체',year:2026,week:'44-01',items:[{inputName:'낯선품종',prodKey:10,qty:2,unit:'박스',action:'취소'}]}));
let reviewCalls=0;const metrics={};
const reviewed=await reviewPasteMatches({orders,customers,products,mappings:{},metrics,callModel:async tasks=>{reviewCalls++;assert.equal(tasks.length,1);return {decisions:tasks.map(t=>({id:t.id,key:10,confidence:.95}))};}});
assert.equal(reviewCalls,1);assert.equal(metrics.uniqueModelTasks,1);assert.equal(reviewed.length,30);assert(reviewed.every(o=>o.items[0].qty===2&&o.items[0].action==='취소'&&o.items[0].prodKey===10));
const failed=await reviewPasteMatches({orders,customers,products,mappings:{},callModel:async()=>{throw Error('timeout');}});assert(failed.every(o=>o.items[0].prodKey===null));
const start=performance.now();for(let i=0;i<100;i++){const f=fixture();const r=await f.run('44-1 카네이션 변경사항\n검증업체\n문라이트 1박스 추가');assert.equal(f.calls.length,0);assert.equal(r.status,200);}
console.log(JSON.stringify({pass:'local full-handler extraction/matching, model fallback, exact/manual safeguards, dedup, immutable quantities/year, failure',baselineModelCalls:baseline.calls.length,fixtureRuns:100,modelCalls:0,fixtureElapsedMs:Math.round(performance.now()-start)}));
