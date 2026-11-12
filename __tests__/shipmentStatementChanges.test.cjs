const {test}=require('node:test'),assert=require('node:assert/strict');
const {reconcile}=require('../lib/shipmentStatementChanges.cjs');
const row=(prodKey,name,cost,qty,unit='박스')=>({id:JSON.stringify([prodKey,unit,cost]),prodKey,name,category:JSON.stringify(['콜롬비아','수국']),unit,cost,qty});
const cal=[{day:'수',date:'2026-11-11'}];
const src=(rows,baseDay='금')=>({customer:{name:'연습업체',baseDay},calendar:cal,rows});
const A=row(1,'수국 블루',2800,10),B=row(2,'카네이션 문라이트',11500,5),C=row(3,'루스커스',900,8);
const saved=(rows,entries)=>({source:src(rows),draft:{defaultDay:'금',groups:[],entries}});
const base=()=>saved([A,B,C],{[A.id]:{수:4},[B.id]:{월:2},[C.id]:{화:3}});

test('바뀐 것이 없으면 변경목록 없음, 배분 그대로',()=>{
 const r=reconcile(base(),src([A,B,C]));assert.deepEqual(r.changes,[]);assert.deepEqual(r.draft.entries,{[A.id]:{수:4},[B.id]:{월:2},[C.id]:{화:3}});
});
test('수량만 바뀐 품목: 그 품목만 표시, 다른 품목 배분 유지, 배분이 들어가면 유지',()=>{
 const A2={...A,qty:12},r=reconcile(base(),src([A2,B,C]));
 assert.equal(r.changes.length,1);assert.match(r.changes[0].text,/수국 블루: 분배수량 10 → 12.*2.*기본 출고요일/);
 assert.deepEqual(r.draft.entries[A.id],{수:4});assert.deepEqual(r.draft.entries[B.id],{월:2});
});
test('수량이 배분 합계보다 줄면 그 품목만 배분 비움',()=>{
 const A2={...A,qty:3},r=reconcile(base(),src([A2,B,C]));
 assert.ok(!r.draft.entries[A.id]);assert.deepEqual(r.draft.entries[B.id],{월:2});assert.ok(r.changes.some(c=>c.type==='reset'&&/수국 블루/.test(c.text)));
});
test('단가 변경은 같은 품목으로 이어 붙이고 새 id 로 배분 유지',()=>{
 const B2=row(2,'카네이션 문라이트',12000,5),r=reconcile(base(),src([A,B2,C]));
 assert.equal(r.changes.length,1);assert.match(r.changes[0].text,/11,500원 → 12,000원/);assert.deepEqual(r.draft.entries[B2.id],{월:2});assert.ok(!r.draft.entries[B.id]);
});
test('품목 추가·삭제를 구분해 알리고 삭제 품목 배분은 버림',()=>{
 const D=row(4,'신규 품목',700,2),r=reconcile(base(),src([A,B,D]));
 assert.ok(r.changes.some(c=>c.type==='removed'&&/루스커스/.test(c.text)));assert.ok(r.changes.some(c=>c.type==='added'&&/신규 품목/.test(c.text)));
 assert.ok(!r.draft.entries[C.id]);assert.deepEqual(r.draft.entries[A.id],{수:4});
});
test('업체 기본요일·달력 변경 안내, 이전 원본 정보 없는 저장본은 안전하게 비움',()=>{
 const r=reconcile(base(),{customer:{name:'연습업체',baseDay:'일'},calendar:[{day:'수',date:'2026-11-12'}],rows:[A,B,C]});
 assert.ok(r.changes.some(c=>c.type==='customer'));assert.ok(r.changes.some(c=>c.type==='calendar'));
 const old=reconcile({draft:{defaultDay:'금',groups:[],entries:{x:{수:1}}}},src([A]));assert.deepEqual(old.draft.entries,{});assert.equal(old.changes[0].type,'reset');
});
