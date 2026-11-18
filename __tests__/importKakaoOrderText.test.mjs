import assert from 'node:assert/strict';
import fs from 'node:fs';
import { analyzeImportMessage, classifyImportFeed, importCustomerAliases, readLatestOrderImports, latestImportFeed } from '../lib/importKakaoOrderText.js';
import { readRecentImports, importItemView, farmTotals, importTotalsText } from '../lib/importKakaoAdditions.js';
const message=(text,id='a',time='2026년 11월 18일 오전 9:00')=>({id,time,text,sender:'fixture',items:[]});
const parse=text=>analyzeImportMessage(message(text));
const totals=messages=>farmTotals(classifyImportFeed({messages}).messages.flatMap(m=>m.items.map(i=>importItemView(i))));
const a='46-1 콜 수국 발주 추가\n화이트 30박스';
const b='46-1 콜 수국 발주 추가\n주광\n화이트 10박스 (좋은 농장에서 추가 부탁합니다.)';
assert.equal(parse(a).kind,'addition');
assert.equal(parse(b).items[0].customer,'주광');
const sum=totals([message(a),message(b,'b')]);
assert.equal(sum[0].quantity,40); assert.equal(sum[0].notes,'주광 10');
assert.equal(sum[0].country,'콜롬비아');assert.equal(sum[0].group,'수국');
assert.equal(parse('46-1 콜 루스커스 발주 추가\n루스커스 3박스').items[0].quantity,'3');
const carnations=parse('46-1 콜 카네이션 발주추가\n돈셀 3박스\n문라이트 1박스\n폴림니아 2박스');
assert.equal(carnations.items.length,3);assert.equal(carnations.items[1].product,'Moon Light');assert.equal(carnations.items[1].group,'카네이션');
const stems=parse('45-2 네덜란드 발주 추가\nCL23 (연습업체)\nAnthurium gracioasa 15cm : 40st\nAstilbe Europa 50스템\nAstilbe Washington 100스팀');
assert.equal(stems.kind,'addition');assert.deepEqual(stems.items.map(i=>i.quantity),['40','50','100']);assert(stems.items.every(i=>i.unit==='송이'));assert.equal(stems.items[0].product,'Anthurium gracioasa 15cm');
const cl=parse('46-1 중국 발주 추가\nCL63\n캐서린 50단\nCL10\n캐서린 10단');
assert.deepEqual(cl.items.map(i=>i.customer),['CL63','CL10']);
assert.equal(parse('46-1 콜 수국 발주 추가\n주광 : 버건디 10박스(지정 농장)').items[0].customer,'주광');
for(const text of ['이번에 온 3박스가 포장 불량입니다','사진 3장','카라 오데사 400스팀 필요합니다. 가격 네고 가능한지 문의드립니다.','네덜란드 킹프로테아 버건디 정보요청\n정보 및 단가 문의드립니다.','47차 미국 더글라스 ETA 11월19일 도착 일정 확인','60cm는 없을까요?','감사합니다']) {
  assert.equal(parse(text).kind,'excluded',text);
}
for(const text of ['CL2 에린지움 취소입니다','46-1 콜 장미 발주 추가\n실란토이 10단\n못 구하면 46-2차로 넘겨주세요','46-1 콜 수국 발주 추가\n화이트 10박스\n메시지가 삭제되었습니다.','46-1 콜 수국 발주 추가\n화이트 10박스\n가격 가능 여부 문의','46-1 콜 수국 발주 추가\n화이트 : 10.00','수국 화이트 10박스','네 추가에요']) {
  const result=parse(text);assert.equal(result.kind,'review',text);assert(result.items.every(i=>!importItemView(i).checked));
}
const dup=classifyImportFeed({messages:[message(a),message(a.replace(/ /g,'  '),'copy'),message(a,'other','2026년 11월 18일 오전 9:01')]});
assert.equal(dup.messages.length,2);assert.equal(dup.stats.duplicates,1);
const deleted=classifyImportFeed({messages:[message(a),message(a+'\n메시지가 삭제되었습니다.','deleted')]});
assert.equal(deleted.messages.length,0);assert.equal(deleted.review.length,1);
const diffSender=classifyImportFeed({messages:[message(a),{...message(a,'b'),sender:'another-fixture'}]});assert.equal(diffSender.messages.length,2);
assert.equal(totals([message(a),message(a.replace('46-1','46-2'),'b')]).length,2);
assert.equal(totals([message(a),message(a,'b','2025년 11월 18일 오전 9:00')]).length,2);
assert.equal(totals([message(a),message(a.replace('박스','단'),'b')]).length,2);
assert.equal(totals([message(a),message(a.replace('콜 수국','중국 수국'),'b')]).length,2);
const raw=Array(21).fill('');raw[7]='CL2';raw[8]='연습업체';
const aliases=importCustomerAliases([[],raw]);assert.equal(analyzeImportMessage(message('46-1 콜 수국 발주 추가\nCL2\n화이트 1박스'),aliases).items[0].customer,'연습업체');
const conflict=[...raw];conflict[8]='다른업체';assert.equal(importCustomerAliases([[],raw,conflict]).size,0);
const invalid=parse('46-1 콜 수국 발주 추가\n화이트 0박스');assert(!importItemView(invalid.items[0]).checked);
assert.equal(parse('46-1 콜 수국 발주 추가\n화이트 1,000박스').items[0].quantity,'1000');
assert.equal(parse('46-1 콜 수국 발주 추가\n화이트 10박스\n블루 3~5박스').kind,'review');
assert.match(importTotalsText(sum),/2026\/46-01차 · 콜롬비아 · 수국 · 화이트 40 박스 \(주광 10\)/);
const header='요청번호|항목|원문 시각|원문 작성자|분석 담당자|담당자 카톡|차수|원문 거래처|매칭 거래처|원문 품목|매칭 품목|수량|단위|매칭 판정|품목 후보|처리 상태|확인 필요사항|원문|검토 결과|거래처 수정|품목 수정'.split('|');
const sheetRow=(id,text,at)=>{const r=Array(21).fill('');r[0]=id;r[1]='0';r[2]=at;r[17]=text;r[15]='ignored';return r;};
const feed=classifyImportFeed(readRecentImports([header,sheetRow('raw',a,'2026년 11월 18일 오전 9:00'),sheetRow('old',a,'2025년 11월 18일 오전 9:00'),sheetRow('info','사진 3장','2026년 11월 18일 오전 9:01')],new Date('2026-11-18T01:00:00Z')));
assert.equal(feed.messages.length,1);assert.equal(feed.messages[0].items[0].quantity,'30');assert.equal(feed.stats.excluded,1);assert.equal(feed.from,'2026-11-17');
console.log('PASS raw import order selection, quantities, CL contexts, exclusions, review, duplicates and cross-year/unit/week separation');
assert.equal(parse('38-1 태국 발주 추가\nCL10\n봉지덴파레 화이트 17봉').items[0].unit,'봉');
assert.equal(parse('46-1 콜 수국 발주 추가\n화이트 -1박스').kind,'review');
const changedFeed=classifyImportFeed({messages:[message(a),message('46-1 콜 수국 발주 취소\n화이트 3박스','cancel')]});
assert.equal(changedFeed.messages.length,0);assert.equal(changedFeed.review.length,2);
const beforeCancel=classifyImportFeed({messages:[message(a)]}).messages[0].items[0];
const afterCancel=changedFeed.review.find(m=>m.id==='a').items[0];
const oldEdits={[beforeCancel.key]:{checked:true}};
assert.notEqual(afterCancel.key,beforeCancel.key);assert.equal(importItemView(afterCancel,oldEdits[afterCancel.key]).checked,false);
assert.equal(classifyImportFeed({messages:[message(a),message('46-1 콜 수국 발주 취소\n화이트 3박스','cancel')]}).review.find(m=>m.id==='a').items[0].key,afterCancel.key);
assert.equal(parse('46-1 루스커스 발주 추가\n루스커스 70cm 3박스').items[0].product,'루스커스 70cm');
assert.equal(parse('그럼 43-2 클라우드로 600스팀 60박스 부탁드립니다.').kind,'review');
assert.equal(parse('이색상 품목명 확인부탁드립니다\n45-3차에 10단 추가하려고합니다.').kind,'review');
assert.equal(parse('46차 에콰도르 이번 물건을 보내었습니다. 밴딩으로 온 3박스가 문제입니다. 이런 실수하지 않도록 해주세요.').kind,'excluded');
assert.equal(parse('44-1 스타티스 믹스 20단\nYCL55 에 추가 해주세용').items[0].customer,'YCL55');
assert.equal(parse('37차 베트남 호접 발주 추가\n퍼펙트 핑크 1박스 추가\n(총3박스)').items[0].quantity,'1');
assert.equal(parse('37차 베트남 호접 발주 추가\n퍼펙트 핑크 1박스 추가\n(총3박스)').kind,'addition');
const flowerLines=['Astilbe Europa 50','Astilbe Washington 100','Clematis Amazing Kibo 60','Clematis Star River 60','Hyacinthus Fondant 25','Hyacinthus Johanna 25','Hyacinthus Polar Giant 50','Hyacinthus Sky Jacket 25','Daffodil Grand Soleil Dor 50','Daffodil Paperwhite 100','Tulip Ad Rems Beauty 100','Tulip Antarctica 100','Tulip Double Foxtrot 50','Tulip Double Katinka 50','Tulip Dynasty 100','Tulip Ile de France 50','Tulip Ninja 100','Tulip Novi Sun 50','Tulip Saigon 50','Tulip Dyed Brownies 100','Iris Casablanca 50','Nerine Vesta K 50','Nerine Lydia 50'];
const many=parse('45-2차 네덜란드 발주 추가\nETA 11월 8일 일요일\nCL38\n'+flowerLines.map(s=>s+'스템').join('\n'));
assert.equal(many.kind,'addition');assert.equal(many.items.length,23);assert.equal(many.items.reduce((n,r)=>n+Number(r.quantity),0),1445);assert(many.items.every(r=>r.group&&r.customer==='CL38'&&r.unit==='송이'));

// Execute the actual route with archive and sheet dependency stubs: no DB or external writes.
const routeSource=fs.readFileSync(new URL('../pages/api/import/tools/kakao-additions.js',import.meta.url),'utf8').replace(/^import .*;\r?$/gm,'').replace('export default withAuth(','return withAuth(');
let sheetReads=0;
const {offsetImportDay,readImportArchive}=await import('../lib/importKakaoArchive.js');
const route=new Function('withAuth','canManageInvoiceReceipt','getKakaoSheetId','readSheetValues','todaySeoul','classifyImportFeed','importCustomerAliases','latestImportFeed','offsetImportDay','readImportArchive',routeSource)(
  fn=>fn,user=>user.allowed,()=> 'fixture',async()=>{sheetReads++;return [header];},
  ()=> '2026-11-18',classifyImportFeed,importCustomerAliases,latestImportFeed,offsetImportDay,
  async(from,through)=>through==='2026-11-18'?[message('사진 3장','info','2026년 11월 18일 오전 9:01'), message(a,'archive:raw')]:[]);
const call=async(method='GET',allowed=true,day='2026-11-18')=>{const res={code:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},end(){return this;},json(body){this.body=body;return this;}};await route({method,user:{allowed},query:{day}},res);return res;};
const success=await call();assert.equal(success.body.messages.length,1);assert.equal(success.body.stats.excluded,1);assert.equal(success.body.messages[0].items[0].quantity,'30');assert(!('sender' in success.body.messages[0]));
assert.equal((await call('POST')).code,405);assert.equal((await call('GET',false)).code,403);assert.equal((await call('GET',true,'2026-02-30')).code,400);assert.equal(sheetReads,1);
console.log('PASS actual GET route raw analysis, noise filtering, authorization, date and read-only guards');
const now=new Date('2026-11-18T01:00:00Z');
const history=[header,
 sheetRow('first',a,'2026년 11월 12일 오후 2:00'),
 sheetRow('second',b,'2026년 11월 5일 오후 3:00'),
 sheetRow('older',a,'2026년 11월 4일 오후 3:00'),
 sheetRow('future',a,'2026년 11월 19일 오후 3:00'),
 sheetRow('noise','사진 3장','2026년 11월 18일 오전 9:01')];
const latestOrders=readLatestOrderImports(history,now);
assert.deepEqual(latestOrders.orderDays,['2026-11-12','2026-11-05']);
assert.deepEqual(latestOrders.messages.map(m=>m.id),['first','second']);
assert.equal(latestOrders.reviewThrough,'2026-11-18');
assert.equal(farmTotals(latestOrders.messages.flatMap(m=>m.items.map(i=>importItemView(i))))[0].quantity,40);
const canceledHistory=readLatestOrderImports([...history,sheetRow('later-cancel','46-1 콜 수국 발주 취소\n화이트 1박스','2026년 11월 18일 오전 9:02')],now);
assert.equal(canceledHistory.messages.length,0);
assert(canceledHistory.review.some(m=>m.id==='later-cancel'));
assert.deepEqual(readLatestOrderImports([header,sheetRow('info','사진','2026년 11월 18일 오전 9:00')],now).orderDays,[]);
const crossYear=readLatestOrderImports([header,sheetRow('dec',a,'2026년 12월 30일 오전 9:00'),sheetRow('jan',a,'2027년 1월 2일 오후 1:00')],new Date('2027-01-04T01:00:00Z'));
assert.deepEqual(crossYear.orderDays,['2027-01-02','2026-12-30']);
assert.equal(farmTotals(crossYear.messages.flatMap(m=>m.items.map(i=>importItemView(i)))).length,2);
const retained=parse('ETA 11월 23일 월요일\n기존대로 더글라스 200박스만 받겠습니다.\n오늘 추가한 내용은 취소해주세요');
assert.equal(retained.kind,'review');assert.equal(retained.items.length,0);assert.equal(retained.unparsed.length,0);
assert.deepEqual(retained.retained,[{product:'더글라스',quantity:'200',unit:'박스'}]);
const defaultRes={setHeader(){},json(body){this.body=body;return this;}};
await route({method:'GET',user:{allowed:true},query:{}},defaultRes);
assert.deepEqual(defaultRes.body.orderDays,['2026-11-18']);
console.log('PASS latest two actual order dates, quiet days, future exclusion, later cancellation, cross-year, retained quantities and default API');
const auditFeed=classifyImportFeed({messages:[message(a),message(a,'duplicate'),message('사진','photo'),message('카라 400스팀 가격 문의','quote')]},new Map(),{audit:true});
assert.equal(auditFeed.audit.length,3);assert.equal(auditFeed.audit.find(m=>m.id==='duplicate').duplicateOf,'a');
assert.equal(auditFeed.audit.find(m=>m.id==='quote').quantityCandidate,true);
assert(auditFeed.audit.every(m=>!('sender' in m)&&!('items' in m)));
assert.equal(auditFeed.stats.scanned,Object.entries(auditFeed.stats).filter(([k])=>k!=='scanned').reduce((s,[,v])=>s+v,0));
assert(!('audit' in classifyImportFeed({messages:[message('사진')]})));
const {importTotalKey,manualImportReviews}=await import('../lib/importKakaoAdditions.js');
const contribution=farmTotals([{...beforeCancel,checked:true},{...beforeCancel,key:'other',quantity:'2',checked:true},{...beforeCancel,key:'excluded',checked:false}]);
assert.deepEqual(contribution[0].sourceKeys,[beforeCancel.key,'other']);assert.equal(contribution[0].key,importTotalKey(beforeCancel));
const manual={x:{id:'x',time:'2026년 11월 18일 오전 9:00',text:'확인'}};
assert.equal(manualImportReviews(manual,{from:'2026-11-17'}).length,1);
assert.equal(manualImportReviews(manual,{from:'2026-11-19'}).length,0);
assert.equal(manualImportReviews(manual,{audit:[{id:'x',text:'변경'}]}).length,0);
assert.equal(manualImportReviews(manual,{messages:[{id:'x'}]}).length,0);
const auditRes={setHeader(){},json(body){this.body=body;return this;}};
await route({method:'GET',user:{allowed:true},query:{day:'2026-11-18',audit:'1'}},auditRes);
assert.equal(auditRes.body.audit.length,1);
console.log('PASS opt-in omission audit, privacy, count reconciliation, exact contributors and manual review refresh');
const mixedUnits = '45-2 네덜란드 발주 추가\n연습수국 2\n연습장미 60cm 100스팀';
const mixedFeed = classifyImportFeed({messages:[message(mixedUnits)]});
assert.equal(mixedFeed.stats.selected, 1);
assert.equal(mixedFeed.stats.review, 0);
assert.equal(mixedFeed.messages[0].items.filter(i=>i.reviewReason==='단위 확인 필요').length, 1);
assert.deepEqual(totals([message(mixedUnits)]).map(r=>[r.quantity,r.unit]),[[100,'송이']]);
assert.deepEqual(totals([message(mixedUnits),message(mixedUnits,'prior','2025년 11월 18일 오전 9:00')]).map(r=>r.year),['2025','2026']);
assert.equal(parse(mixedUnits+'\n추가 취소합니다').kind,'review');
assert.equal(parse(mixedUnits+'\n가격 확인 부탁').kind,'review');

const priorToken = process.env.ORBIT_OWNER_TOKEN;
process.env.ORBIT_OWNER_TOKEN = 'fixture-only';
try {
  const start = '2026-12-31T15:00:00.000Z';
  const stamp = '2026-12-31T15:03:00.000Z';
  const row = (id, source='nenovakakao') => ({external_message_id:String(id),source,chatroom:'수입방',created_at:stamp,sender:'fixture',message:a});
  const first = Array.from({length:1000},(_,i)=>row(i));
  let calls = 0;
  const loaded = await readImportArchive('2027-01-01','2027-01-01',async(url,init)=>{
    calls++;
    assert.equal(url.pathname,'/api/kakao/messages');
    assert.equal(url.searchParams.get('chatroom'),'수입방');
    assert.equal(url.searchParams.get('startDate'),start);
    assert.equal(init.redirect,'error');
    assert.equal(init.headers.Authorization,'Bearer fixture-only');
    return {ok:true,json:async()=>({ok:true,total:1001,messages:calls===1?first:[row(1000,'other-source')]})};
  });
  assert.equal(calls,2);
  assert.equal(loaded.length,1000);
  assert.match(loaded[0].id,/^archive:[a-f0-9]{64}$/);
  assert.equal(loaded[0].time,'2027년 1월 1일 오전 12:03');
  await assert.rejects(readImportArchive('2027-01-01','2027-01-01',async()=>({ok:true,json:async()=>({ok:true,total:2,messages:[row(1),row(1)]})})),/identity mismatch/);
  await assert.rejects(readImportArchive('2027-01-01','2027-01-01',async()=>({ok:true,json:async()=>({ok:true,total:1,messages:[{...row(1),chatroom:'다른 방'}]})})),/identity mismatch/);
  await assert.rejects(readImportArchive('2027-01-01','2027-01-01',async()=>({ok:true,json:async()=>({ok:true,total:2,messages:[row(1)]})})),/archive incomplete/);
} finally {
  if (priorToken === undefined) delete process.env.ORBIT_OWNER_TOKEN;
  else process.env.ORBIT_OWNER_TOKEN = priorToken;
}
