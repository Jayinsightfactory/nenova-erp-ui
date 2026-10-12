import assert from 'node:assert/strict';
import {buildAppliedStockCopy,buildAppliedStockScope,appendAppliedStockResult} from '../lib/pasteAppliedStockCopy.js';
const products=[{ProdKey:1,ProdName:'Moonlight'},{ProdKey:2,ProdName:'Novia'},{ProdKey:3,ProdName:'Ikebana'}];
const matches=new Map([['문라이트',{prodKey:1}],['노비아',{prodKey:2}],['이케바나',{prodKey:3}]]);
const baseText='기초재고\n문라이트1\n노비아1\n이케바나1\n--------------';
const currentScope=buildAppliedStockScope({week:'2026-42-01',baseText,pasteText:'노비아1 추가'});
const entry={entryId:'saved-1',ok:true,verified:true,type:'ADD',orderYear:'2026',orderWeek:'42-01',prodKey:2,custKey:1,qty:1,delta:1,unit:'박스',outQtyBefore:0,outQtyAfter:1};
const result={orderId:'ALL',okCount:1,failCount:0,verified:true,details:[entry],stockCopyScope:currentScope};
const args={baseText,pasteText:currentScope.pasteText,week:currentScope.week,resolvedMatches:matches,products,result,currentScope};
assert.equal(buildAppliedStockCopy(args).text,'기초재고\n이케바나1\n문라이트1\n--------------','original names and format, zero omitted, English DB names sorted');
assert.equal(buildAppliedStockCopy(args).text,buildAppliedStockCopy(args).text,'render never reapplies operation to prior remainder');
const initialChanges=buildAppliedStockCopy(args).changeRows;
assert.deepEqual(initialChanges.map(row=>row.name),['이케바나','문라이트','노비아'],'change table follows the same DB-name sort and keeps original input names');
assert.deepEqual(initialChanges.find(row=>row.prodKey===2),{prodKey:2,name:'노비아',start:{main:1,detail:null,unit:'박스',detailUnit:''},added:{main:1,detail:null,unit:'박스',detailUnit:''},cancelled:{main:0,detail:null,unit:'박스',detailUnit:''},applied:{main:0,detail:null,unit:'박스',detailUnit:''},startText:'1박스',addedText:'1박스',cancelledText:'0박스',appliedText:'0박스',changed:true},'zero remainder stays visible in verified change table');
assert.equal(initialChanges.find(row=>row.prodKey===1).changed,false,'unchanged starting stock is visible without change highlight');
for(const changed of [{rolledBack:true},{undone:true},{preflightBlocked:true},{stockCopyScope:undefined}])assert.equal(buildAppliedStockCopy({...args,result:{...result,...changed}}).ready,false);
assert.equal(buildAppliedStockCopy({...args,currentScope:{...currentScope,week:'2025-42-01'}}).ready,false);
assert.equal(buildAppliedStockCopy({...args,result:{...result,details:[{...entry,orderYear:'2025'}]}}).ready,false,'prior-year same week never subtracts');
assert.equal(buildAppliedStockCopy({...args,result:{...result,details:[{...entry,qty:2,delta:2,outQtyAfter:2}]}}).ready,false,'negative stock blocks instead of clamping');
const fractional=buildAppliedStockCopy({...args,result:{...result,details:[{...entry,qty:.5,delta:.5,outQtyAfter:.5}]}});
assert(fractional.text.includes('노비아0.5'),'positive fraction stays');
const cancelled=buildAppliedStockCopy({...args,result:{...result,details:[{...entry,type:'CANCEL',outQtyBefore:1,outQtyAfter:0}]}});
assert(cancelled.text.includes('노비아2'),'committed cancellation increases stock');
assert.equal(buildAppliedStockCopy({...args,result:{...result,details:[entry,entry]}}).ready,false,'duplicate successful result cannot subtract twice');
const failed=buildAppliedStockCopy({...args,result:{...result,details:[{...entry,ok:false}]}});
assert.equal(failed.ready,false,'failed rows alone never claim applied-stock ready');
const noChange=buildAppliedStockCopy({...args,result:{...result,details:[{...entry,outQtyBefore:1,outQtyAfter:1}]}});
assert(noChange.text.includes('노비아1'),'already applied/no-change server result does not subtract requested quantity');
assert.equal(noChange.changeRows.find(row=>row.prodKey===2).added.main,0,'zero shipment delta never claims requested quantity was applied');
assert.equal(noChange.changeRows.find(row=>row.prodKey===2).changed,false);
assert.equal(buildAppliedStockCopy({...args,result:{...result,details:[{...entry,unit:'송이'}]}}).ready,false,'unknown conversion blocks');
const mixedBase='기초재고\n노비아 1박스 + 15스팀 (보관)\n문라이트\n  0.5박스';
const mixedScope=buildAppliedStockScope({week:args.week,baseText:mixedBase,pasteText:args.pasteText});
const mixed=buildAppliedStockCopy({...args,baseText:mixedBase,currentScope:mixedScope,result:{...result,stockCopyScope:mixedScope,details:[{...entry,unit:'송이',qty:5,delta:5,outQtyAfter:5}]}});
assert.equal(mixed.text,'기초재고\n문라이트\n  0.5박스\n노비아 1박스 + 10스팀 (보관)','mixed units and multiline/punctuation survive intact');
assert.deepEqual(mixed.changeRows.find(row=>row.prodKey===2).added,{main:0,detail:5,unit:'박스',detailUnit:'스팀'},'detail-unit consumption is separate from boxes');
assert.equal(mixed.changeRows.find(row=>row.prodKey===2).appliedText,'1박스 + 10스팀');
const mixedBoth=buildAppliedStockCopy({...args,baseText:mixedBase,currentScope:mixedScope,result:{...result,stockCopyScope:mixedScope,details:[{...entry,entryId:'detail-add',unit:'송이',qty:5,delta:5,outQtyAfter:5},{...entry,entryId:'box-cancel',type:'CANCEL',unit:'박스',qty:1,delta:1,outQtyBefore:1,outQtyAfter:0}]}});
const mixedChange=mixedBoth.changeRows.find(row=>row.prodKey===2);
assert.equal(mixedChange.startText,'1박스 + 15스팀');
assert.equal(mixedChange.addedText,'0박스 + 5스팀');
assert.equal(mixedChange.cancelledText,'1박스 + 0스팀');
assert.equal(mixedChange.appliedText,'2박스 + 10스팀','main and detail amounts use the exact copy calculation');
assert(mixedBoth.text.includes('노비아 2박스 + 10스팀'));
assert.equal(buildAppliedStockCopy({...args,resolvedMatches:new Map()}).ready,false);
assert.equal(buildAppliedStockCopy({...args,currentScope:{...currentScope,matchesKey:'changed'}}).ready,false,'rematching invalidates old copy result');

const excludedBase=baseText+'\n매칭안된품목 99\n제외할 잘못된 원문';
const excluded=[5,6];
const excludedScope=buildAppliedStockScope({week:args.week,baseText:excludedBase,pasteText:args.pasteText,excludedLines:excluded});
const excludedResult=buildAppliedStockCopy({...args,baseText:excludedBase,baseExcludedLineNos:excluded,currentScope:excludedScope,result:{...result,stockCopyScope:excludedScope}});
assert.equal(excludedResult.ready,true,'excluded unmatched product does not block applied copy');
assert(!excludedResult.text.includes('매칭안된품목')&&!excludedResult.text.includes('잘못된'),'excluded original lines never appear in copy');
const excludedRaw=baseText+'\n매칭안된품목 99';
const start=excludedRaw.indexOf('매칭안된품목');
const signature=[{start,end:excludedRaw.length,text:excludedRaw.slice(start)}];
const signatureScope=buildAppliedStockScope({week:args.week,baseText:excludedRaw,pasteText:args.pasteText,excludedLines:signature});
assert.equal(buildAppliedStockCopy({...args,baseText:excludedRaw,baseExcludedLineNos:signature,currentScope:signatureScope,result:{...result,stockCopyScope:signatureScope}}).ready,true,'signed text exclusions use same helper as parser');

const successiveBase='노비아10';
const successiveScope=buildAppliedStockScope({week:args.week,baseText:successiveBase,pasteText:args.pasteText});
const successive=buildAppliedStockCopy({...args,baseText:successiveBase,currentScope:successiveScope,result:{...result,stockCopyScope:successiveScope,details:[entry],stockCopyDetails:[{...entry,entryId:'execution-1:item-1'},{...entry,entryId:'execution-2:item-1',custKey:2,outQtyBefore:1,outQtyAfter:2}]}});
assert.equal(successive.text,'노비아8','successive customer operations accumulate against original base once each');
assert.equal(buildAppliedStockCopy({...args,result:{...result,verified:false}}).ready,false);
assert.equal(buildAppliedStockCopy({...args,result:{...result,failCount:1}}).ready,false);
for(const unsafe of [
  {...args,result:{...result,verified:false}},
  {...args,result:{...result,failCount:1}},
  {...args,result:{...result,rolledBack:true}},
  {...args,result:{...result,undone:true}},
  {...args,currentScope:{...currentScope,matchesKey:'stale'}},
  {...args,result:{...result,details:[{...entry,orderYear:'2025'}]}},
  {...args,result:{...result,details:[{...entry,orderWeek:'41-01'}]}},
  {...args,result:{...result,details:[entry,entry]}},
  {...args,result:{...result,details:[{...entry,qty:2,delta:2,outQtyAfter:2}]}},
  {...args,result:{...result,details:[{...entry,unit:'송이'}]}},
])assert.deepEqual(buildAppliedStockCopy(unsafe).changeRows,[],'unsafe results cannot show a misleading verified change table');
const netZero=buildAppliedStockCopy({...args,result:{...result,details:[entry,{...entry,entryId:'return',type:'CANCEL',outQtyBefore:1,outQtyAfter:0}]}}).changeRows.find(row=>row.prodKey===2);
assert.equal(netZero.added.main,1);assert.equal(netZero.cancelled.main,1);assert.equal(netZero.applied.main,1);assert.equal(netZero.changed,true,'net zero still shows both actual operations');

const spacedBase='문라이트1\n\n노비아1\n\n이케바나1';
const spacedScope=buildAppliedStockScope({week:args.week,baseText:spacedBase,pasteText:args.pasteText});
assert.equal(buildAppliedStockCopy({...args,baseText:spacedBase,currentScope:spacedScope,result:{...result,stockCopyScope:spacedScope}}).text.trim(),'이케바나1\n문라이트1','blank spacing does not prevent DB product sort');

const firstSaved=appendAppliedStockResult(null,{...result,stockCopyScope:successiveScope},{executionId:'first'});
const restored=JSON.parse(JSON.stringify(firstSaved));
const secondSaved=appendAppliedStockResult(restored,{...result,stockCopyScope:successiveScope,details:[{...entry,custKey:2}]},{executionId:'second'});
assert.equal(secondSaved.stockCopyDetails.length,2,'restored prior operation is accumulated');
assert.notEqual(secondSaved.stockCopyDetails[0].entryId,secondSaved.stockCopyDetails[1].entryId,'same input entry IDs are execution scoped');
assert.equal(buildAppliedStockCopy({...args,baseText:successiveBase,currentScope:successiveScope,result:secondSaved}).text,'노비아8');
assert.equal(appendAppliedStockResult({...restored,undone:true},{...result,stockCopyScope:successiveScope},{executionId:'after-undo'}).stockCopyDetails.length,1);
assert.equal(appendAppliedStockResult(restored,result,{executionId:'other-scope'}).stockCopyDetails.length,1);
assert.deepEqual(appendAppliedStockResult(restored,{...result,verified:false},{executionId:'failure'}).stockCopyDetails,[],'another scope does not inherit earlier committed rows');
const failedSecond=appendAppliedStockResult(firstSaved,{...result,verified:false,failCount:1,rolledBack:true,stockCopyScope:successiveScope,details:[{...entry,ok:false}]},{executionId:'failed-second'});
assert.equal(failedSecond.stockCopyDetails.length,1,'failed B preserves committed A only');
assert.equal(buildAppliedStockCopy({...args,baseText:successiveBase,currentScope:successiveScope,result:failedSecond}).ready,false,'current failure never claims copy ready');
const retried=appendAppliedStockResult(JSON.parse(JSON.stringify(failedSecond)),{...result,stockCopyScope:successiveScope,details:[{...entry,custKey:2}]},{executionId:'retried-second'});
assert.equal(buildAppliedStockCopy({...args,baseText:successiveBase,currentScope:successiveScope,result:retried}).text,'노비아8','A success, B failure, B retry retains both committed deductions');
const undoneAfterFailure=appendAppliedStockResult({...failedSecond,undone:true},{...result,stockCopyScope:successiveScope},{executionId:'after-failure-undo'});
assert.equal(undoneAfterFailure.stockCopyDetails.length,1,'undo invalidates earlier facts even after failed operation');

const absolute=appendAppliedStockResult(firstSaved,{...result,stockCopyScope:successiveScope,details:[{...entry,type:'DISTRIBUTE'}]},{executionId:'absolute'});
assert.equal(absolute.stockCopyUnsupported,true,'absolute distribution without proof blocks current stock copy');
const afterAbsolute=appendAppliedStockResult(absolute,{...result,stockCopyScope:successiveScope},{executionId:'after-absolute'});
assert.equal(afterAbsolute.stockCopyUnsupported,true,'later ADD cannot hide unaccounted absolute distribution');
assert.equal(buildAppliedStockCopy({...args,baseText:successiveBase,currentScope:successiveScope,result:afterAbsolute}).ready,false);
assert.equal(appendAppliedStockResult(absolute,result,{executionId:'new-source'}).stockCopyUnsupported,false,'new source scope resets unsupported operation flag');
console.log('paste applied stock copy tests passed');
