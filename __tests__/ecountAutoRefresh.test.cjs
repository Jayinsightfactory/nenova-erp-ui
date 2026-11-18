'use strict';
// 2026-10-22: ECOUNT 수집 직후 웹 작업본 자동 갱신 + RED 건너뛰기 + 합계 반올림 허용폭.
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('fs');const path=require('path');const vm=require('vm');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const policy=require('../lib/ecountWorkspacePolicy.cjs');

function loadStore(queryImpl){
  const src=read('lib/ecountWorkspaceStore.js').replace(/^import .*;\r?\n/gm,'').replace(/export async function /g,'async function ');
  const ctx={policy,crypto:require('crypto'),sql:{VarChar:()=>'v',NVarChar:()=>'n',Int:'i',UniqueIdentifier:'u',Char:()=>'c',DateTime2:'d',MAX:0},query:queryImpl,withTransaction:async()=>{throw new Error('no tx in this test');},effectiveAuthority:()=>null};
  vm.createContext(ctx);vm.runInContext(src+'\nthis.refreshFromLatest=refreshFromLatest;',ctx);return ctx;
}

test('refreshFromLatest: 기존 Head 마다 import-latest(IMPORT, 현재 revision) 호출, 화면별 실패는 격리', async()=>{
  const ctx=loadStore(async sqlText=>/OBJECT_ID/.test(sqlText)?{recordset:[{ready:1}]}:{recordset:[{menuId:'M1',program:'E040214',revision:3},{menuId:'M2',program:'E040214',revision:1}]});
  const calls=[];
  ctx.saveVersion=async(input,user)=>{calls.push({input,user});if(input.menuId==='M2'){const e=new Error('REVISION_CONFLICT');e.status=409;throw e;}return {revision:input.expectedRevision+1,idempotent:false};};
  const r=await ctx.refreshFromLatest('ar');
  assert.equal(calls.length,2);
  assert.deepEqual(calls.map(c=>[c.input.action,c.input.reasonCode,c.input.expectedRevision]),[['import-latest','IMPORT',3],['import-latest','IMPORT',1]]);
  assert.equal(calls[0].user.userId,'ecount-auto-refresh');
  assert.equal(r.scopes[0].revision,4);assert.equal(r.scopes[1].error,'REVISION_CONFLICT');
});

test('refreshFromLatest: 수집 데이터셋 밖(예: poQuery)은 건드리지 않는다', async()=>{
  let q=0;const ctx=loadStore(async()=>{q++;return {recordset:[]};});
  assert.equal((await ctx.refreshFromLatest('poQuery')).skipped,'NOT_SOURCE_DATASET');assert.equal(q,0);
});

test('latestSource 는 수집 검사 RED 스냅샷을 건너뛴다(직전 정상본 유지)', ()=>{
  assert.match(read('lib/ecountWorkspaceStore.js'),/FROM dbo\.WebEcountSnapshot WITH\(HOLDLOCK\) WHERE Dataset=@dataset AND VerifyStatus<>\\'RED\\' ORDER BY SnapshotKey DESC/);
});

test('ingest: RED 면 갱신하지 않고, 갱신 실패가 적재 성공을 뒤집지 않는다', ()=>{
  const s=read('pages/api/ecount/ingest.js');
  assert.match(s,/r\.status === 'RED'\) workspaceRefresh = \{ dataset, skipped: 'VERIFY_RED' \}/);
  assert.match(s,/try \{ workspaceRefresh = await refreshFromLatest\(dataset\); \} catch/);
});

test('합계 검사 허용폭 = max(1, 0.5×행수) — 채무 181행 2원 차(원 단위 반올림)는 GREEN', ()=>{
  const s=read('lib/ecountIngest.js');
  assert.match(s,/const tol = Math\.max\(1, 0\.5 \* dataRows\.length\);/);
  const tol=rows=>Math.max(1,0.5*rows);
  assert.ok(2<=tol(181));assert.ok(!(2<=tol(1)));
});

test('2026-10-22 판매조회·회계거래조회 매일 수집: 화이트리스트·ingest·자동 갱신 대상에 함께 등록', ()=>{
  const core=read('scripts/ecount-scraper/scrape-core.mjs');
  assert.match(core,/saleQuery: \{ prgId: 'E040206', form: true/);assert.match(core,/journal: \{ prgId: 'E010701', form: true/);
  assert.match(core,/const READONLY_PRGIDS = new Set\(Object\.values\(DEFS\)\.map\(d => d\.prgId\)\)/);
  assert.match(read('lib/ecountIngest.js'),/saleQuery: \{ label: '판매조회', prgId: 'E040206'/);
  assert.deepEqual([...policy.SOURCE_DATASETS],['cash','ar','ap','sales','saleQuery','journal','quote','purchase','buyStatus']);
  // 날짜는 원본 '일자-No.' 표기 그대로 보내고 작업본이 같은 규칙으로 정규화한다.
  assert.deepEqual(policy.sanitizeRows('journal',[{sourceDateLabel:'2026/10/20 -12',amount:'30625700',isSubtotal:false}]).map(r=>[r.refDate,r.amount]),[['2026-10-20','30625700']]);
});

test('2026-11-17 견적서조회·구매조회·구매현황 매일 수집: 화이트리스트·ingest·자동 갱신 대상에 함께 등록', ()=>{
  const core=read('scripts/ecount-scraper/scrape-core.mjs');
  assert.match(core,/quote: \{ prgId: 'E040202', form: true/);assert.match(core,/purchase: \{ prgId: 'E040304', form: true/);assert.match(core,/buyStatus: \{ prgId: 'E040305', form: true/);
  assert.match(core,/const READONLY_PRGIDS = new Set\(Object\.values\(DEFS\)\.map\(d => d\.prgId\)\)/);
  // 메뉴 해시는 source-menu.json 의 해당 prgId 메뉴 id 와 일치해야 한다(지어낸 값 금지).
  const menus=require('../data/ecount-workbench/source-menu.json').menus;
  for(const [ds,prg,menu] of [['quote','E040202','MENUTREE_000487'],['purchase','E040304','MENUTREE_000511'],['buyStatus','E040305','MENUTREE_000513']]){
    assert.ok(menus.some(m=>m.id===menu&&m.program===prg),ds);
    assert.ok(core.includes(`prgId: '${prg}', form: true, hash: '#menuType=MENUTREE_000004&menuSeq=${menu}&groupSeq=`),ds);
    assert.ok(core.includes(`&prgId=${prg}&depth=4'`),ds);
  }
  const ing=read('lib/ecountIngest.js');
  assert.match(ing,/quote: \{ label: '견적서조회', prgId: 'E040202'/);assert.match(ing,/purchase: \{ label: '구매조회', prgId: 'E040304'/);assert.match(ing,/buyStatus: \{ label: '구매현황', prgId: 'E040305'/);
  assert.deepEqual(['quote','purchase','buyStatus'].filter(d=>!policy.SOURCE_DATASETS.includes(d)),[]);
  const store=read('lib/ecountWorkspaceStore.js');
  assert.ok(store.includes("['saleQuery','journal','quote','purchase','buyStatus'].includes(scope.dataset)?['sourceDateLabel']"));
  assert.ok(store.includes("'cash','ar','ap','sales','saleQuery','journal','quote','purchase','buyStatus') AND s.SnapshotKey"));
  // 기존 6개 정의는 그대로 남아 있다.
  for(const k of ['cash','ar','ap','sales','saleQuery','journal'])assert.ok(core.includes(`\n  ${k}: { prgId`),k);
});

test('2026-11-17 수집기 map 키는 업로드가 쓰는 허용 필드와 일치하고 합성 행이 sanitizeRows 를 통과한다', async()=>{
  const {DEFS}=await import('../scripts/ecount-scraper/scrape-core.mjs');
  for(const ds of ['quote','purchase','buyStatus']){
    const keys=Object.keys(DEFS[ds].map);
    const allowed=new Set([...policy.FIELDS[ds],'sourceDateLabel','custName','prodName','statusText']);
    for(const k of keys)assert.ok(allowed.has(k),ds+':'+k);
    for(const f of policy.FIELDS[ds])assert.ok(keys.includes(f),ds+' 누락 필드 '+f);
    assert.deepEqual(DEFS[ds].numFields.slice().sort(),policy.FIELDS[ds].slice().sort());
  }
  // 합성(가짜) 행 — 실제 거래처·금액 아님. statusText·prodName·custName 등은 허용 목록에서 버려진다.
  const q=policy.sanitizeRows('quote',[{sourceDateLabel:'2026/11/03 -1',custName:'TEST_CUST',prodName:'TEST_PROD',estimateTotal:1000,statusText:'TEST',isSubtotal:false},{sourceDateLabel:'2026/11 계',estimateTotal:1000,isSubtotal:true}]);
  assert.equal(q[0].refDate,'2026-11-03');assert.equal(q[0].estimateTotal,'1000');assert.equal(q[1].isSubtotal,true);
  assert.ok(!('statusText' in q[0])&&!('quoteStatus' in q[0])&&!('custName' in q[0]));
  const p=policy.sanitizeRows('purchase',[{sourceDateLabel:'2026/11/03 -2',amountTotal:2000,foreignTotal:0,exchangeRate:1300.5,isSubtotal:false}]);
  assert.deepEqual([p[0].refDate,p[0].amountTotal,p[0].exchangeRate],['2026-11-03','2000','1300.5']);
  const b=policy.sanitizeRows('buyStatus',[{sourceDateLabel:'2026/11/03 -3',qty:2,boxQty:1,unitPrice:10,foreignAmount:0,supplyAmt:20,exchangeRate:1,total:20,weight:3.5,isSubtotal:false},{sourceDateLabel:'',qty:1,total:5,isSubtotal:false}]);
  assert.deepEqual([b[0].refDate,b[0].weight,b[0].total],['2026-11-03','3.5','20']);assert.equal(b[1].refDate,null);
});

test('2026-11-18 quote 0행("등록된 데이터가 없습니다.")은 emptyOk 로 파싱하고 buyStatus 거래처 오클릭(text=Excel)을 막는다', async()=>{
  const XLSX=require('xlsx');
  const {DEFS,parseExcel}=await import('../scripts/ecount-scraper/scrape-core.mjs');
  const wb=XLSX.utils.book_new();
  const ws=XLSX.utils.aoa_to_sheet([
    ['회사명 : (주) 네노바 / 2026/10/19  ~ 2026/12/18'],
    ['일자-No.','최초작성일자','거래처명','품목명(요약)','견적금액합계','비고','진행상태','생성한전표','인쇄'],
    ['등록된 데이터가 없습니다.']
  ]);
  XLSX.utils.book_append_sheet(wb,ws,'Sheet1');
  const buf=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
  const parsed=parseExcel(buf,DEFS.quote);
  assert.equal(parsed.emptyOk,true);assert.equal(parsed.parseFailed,false);
  assert.equal(parsed.rows.length,0);assert.equal(parsed.screenTotal,0);
  assert.equal(parsed.periodFrom,'2026-10-19');assert.equal(parsed.periodTo,'2026-12-18');

  const badWb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(badWb,XLSX.utils.aoa_to_sheet([['제목없음'],['오류페이지']]),'Sheet1');
  const badParsed=parseExcel(XLSX.write(badWb,{type:'buffer',bookType:'xlsx'}),DEFS.quote);
  assert.equal(badParsed.parseFailed,true);assert.ok(!badParsed.emptyOk);

  const core=read('scripts/ecount-scraper/scrape-core.mjs');
  assert.ok(!core.includes("locator?.('text=Excel')"),'거래처명 Excel 오클릭 방지');
  assert.match(core,/Excel\(화면\)/);
  assert.match(core,/ds === 'sales' \|\| ds === 'buyStatus'/);
  assert.match(read('scripts/ecount-scraper/daemon.mjs'),/!data\.rows\.length && !data\.emptyOk/);
});
