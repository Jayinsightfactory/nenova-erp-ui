import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHotelOrderRows, hotelRegistrationPlan, hotelConvert, uniqueHotelMappings, hasHotelDraftContent } from '../lib/hotelOrderWorkspace.js';
import { hotelMiuMajorWeekOptions } from '../lib/hotelMiuWeeks.js';
import { commitHotelReview, hotelImageUrl, hotelNextBatchNumber, hotelSavedBatches, hotelBatchMatrix, editHotelBatchQuantity, hotelImageRowBounds } from '../lib/hotelOrderReview.js';

test('numbered quantity matrix edits preserve exact scope and original evidence, normalize mixed units and conserve totals',()=>{
  const products={7:{ProdKey:7,DisplayName:'TEST',OutUnit:'송이',SteamOf1Box:30,SteamOf1Bunch:10,BunchOf1Box:3}};
  for(const year of ['2025','2026']){
    const w={year,week:'44-01',request:[{id:'a',batchId:'one',prodKey:7,qty:2,unit:'단',originalQty:2,originalUnit:'단'},{id:'b',batchId:'one',prodKey:7,qty:10,unit:'송이',originalQty:10},{id:'c',batchId:'two',prodKey:7,qty:1,unit:'박스'}],purchase:[],batches:{request:[{id:'one',number:1},{id:'two',number:2}]},allocations:{7:{8:5}}};
    const first=hotelBatchMatrix(w,'request',products);assert.equal(first.rows[0].total,60);assert.equal(first.rows[0].cells.one.qty,30);
    const changed=editHotelBatchQuantity(w,'request','one','p:7','31',products),matrix=hotelBatchMatrix(changed,'request',products);
    assert.equal(matrix.rows[0].total,61);assert.equal(matrix.rows[0].cells.one.qty,31);
    assert.equal(changed.year,year);assert.equal(changed.week,'44-01');assert.equal(changed.request[0].originalQty,2);assert.equal(changed.request[0].originalUnit,'단');assert.deepEqual(changed.allocations,{});
    assert.equal(buildHotelOrderRows(changed.request,[],products).rows[0].request,61);
    const zero=editHotelBatchQuantity(changed,'request','one','p:7',0,products);assert.equal(hotelBatchMatrix(zero,'request',products).rows[0].total,30);
    const restored=editHotelBatchQuantity(zero,'request','one','p:7',5,products);assert.equal(hotelBatchMatrix(restored,'request',products).rows[0].total,35);
    assert.throws(()=>editHotelBatchQuantity(w,'request','one','p:7','',products));
    assert.throws(()=>editHotelBatchQuantity({...w,frozen:true},'request','one','p:7',5,products));
    assert.throws(()=>editHotelBatchQuantity(w,'request','missing','p:7',5,products));
    assert.equal(w.request[0].qty,2);
  }
});
test('unmatched item rows stay distinct rather than merging guessed identities',()=>{
  const w={request:[{id:'x',inputName:'A',qty:3,unit:'송이'},{id:'y',inputName:'A',qty:4,unit:'송이'}]};
  assert.equal(hotelBatchMatrix(w,'request',{}).rows.length,2);
  assert.equal(editHotelBatchQuantity(w,'request','legacy','r:x',5,{}).request[1].qty,4);
});
test('ruled image rows align with title/header, reject omitted rows, nonuniform tables and images without rules',()=>{
  const width=100,height=216,data=new Uint8ClampedArray(width*height*4).fill(255);
  for(const y of [0,54,95,135,175,215]) for(let x=0;x<width;x++){const i=(y*width+x)*4;data[i]=data[i+1]=data[i+2]=0;}
  assert.deepEqual(hotelImageRowBounds({data,width,height},3),[95,135,175,215].map(y=>y/height));
  assert.equal(hotelImageRowBounds({data,width,height},2),null);
  assert.equal(hotelImageRowBounds({data:new Uint8ClampedArray(width*height*4).fill(255),width,height},3),null);
  assert.equal(hotelImageRowBounds({data,width,height},8),null);
});

test('review is excluded until saved; sequential batches retain images, edits, and cross-year scope', () => {
  const p = {7:{ProdKey:7,OutUnit:'송이',SteamOf1Box:30}}, review={id:'one',imageId:'a'.repeat(64)+'.png',rows:[{id:'a',prodKey:7,qty:303,unit:'송이'}]};
  for (const year of ['2025','2026']) {
    const w={year,week:'44-01',request:[],purchase:[],allocations:{},pending:{request:review}};
    assert.equal(hasHotelDraftContent(w),true);
    assert.equal(buildHotelOrderRows(w.request,w.purchase,p).rows.length,0);
    const saved=commitHotelReview(w,'request','time');
    assert.equal(saved.year,year); assert.equal(saved.week,'44-01');
    assert.equal(saved.pending.request,null); assert.equal(saved.batches.request[0].number,1);
    assert.equal(hotelSavedBatches(saved,'request')[0].imageId,review.imageId);
    assert.equal(buildHotelOrderRows(saved.request,saved.purchase,p).rows[0].request,303);
    const duplicate=commitHotelReview({...saved,pending:{request:review}},'request','later');
    assert.equal(duplicate.request.length,1);
    const next=commitHotelReview({...saved,pending:{request:{...review,id:'two',rows:[{...review.rows[0],id:'b',qty:103}]}}},'request','later');
    assert.equal(buildHotelOrderRows(next.request,next.purchase,p).rows[0].request,406);
    assert.equal(hotelSavedBatches(next,'request')[1].number,2);
    assert.equal(hotelNextBatchNumber({...next,request:[]},'request'),3);
    assert.equal(hotelNextBatchNumber({...w,request:review.rows},'request'),2);
    assert.equal(hotelNextBatchNumber(next,'purchase'),1);
  }
});
test('review refuses invalid quantities/frozen state and image URLs cannot escape the authenticated endpoint', () => {
  const w={request:[],pending:{request:{id:'x',rows:[{qty:'',unit:'송이'}]}}};
  assert.throws(()=>commitHotelReview(w,'request'),/수량/);
  assert.throws(()=>commitHotelReview({...w,frozen:true},'request'));
  assert.equal(hotelImageUrl('javascript:alert(1)'), '');
  assert.equal(hotelImageUrl('../other.png'), '');
  assert.equal(hotelImageUrl('b'.repeat(64)+'.png').startsWith('/api/sales/hotel-order-images?id='),true);
});

test('hotel quick choices show base plus/minus five majors with exact years and unchanged legacy defaults', () => {
  const opts = hotelMiuMajorWeekOptions(new Date(2026, 9, 28), 5, 5);
  assert.equal(opts.length, 11);
  assert.deepEqual(opts.map(o => o.major), [39,40,41,42,43,44,45,46,47,48,49]);
  assert.equal(opts[5].isDefault, true);
  assert.equal(hotelMiuMajorWeekOptions(new Date(2026, 9, 28)).length, 10);
  assert.equal(hotelMiuMajorWeekOptions(new Date(2026, 9, 28), 0, 0).length, 1);
  const edge = hotelMiuMajorWeekOptions(new Date(2026, 11, 31), 5, 5);
  assert.deepEqual(edge.map(o => `${o.year}/${o.major}`), ['2026/48','2026/49','2026/50','2026/51','2026/52','2027/1','2027/2','2027/3','2027/4','2027/5','2027/6']);
  assert.equal(edge[0].label.includes('26년'), true);
  const jan = hotelMiuMajorWeekOptions(new Date(2026, 0, 1), 5, 5);
  assert.equal(jan[0].year, '2025');
  assert.equal(jan[5].year, '2026');
});

test('period/default vendors alone do not autosave-lock a blank workspace; raw text and clearing saved contents are distinguishable', () => {
  assert.equal(hasHotelDraftContent({ year:'2026', week:'44-01', raum:'680', surplus:'690', texts:{request:'  ',purchase:''} }), false);
  assert.equal(hasHotelDraftContent({pinned:['691']}), false);
  for (const content of [{texts:{request:'수국 화이트 30송이\n장미 10단'}}, {texts:{purchase:'수국 20송이'}}, {request:[{qty:0}]}, {receipts:[{}]}]) assert.equal(hasHotelDraftContent(content), true);
  assert.equal(hasHotelDraftContent({request:[],purchase:[],texts:{request:'',purchase:''}}), false);
});
const products = { 10: { ProdKey: 10, DisplayName: '수국', OutUnit: '송이', SteamOf1Box: 30, BunchOf1Box: 3, SteamOf1Bunch: 10 } };
const line = (qty, unit = '송이') => ({ prodKey: 10, inputName: '수국', qty, unit });
const scope = { year: '2026', week: '44-01', raum: 680, surplus: 690, customers: [{ CustKey: 680, CustName: '라움' }, { CustKey: 690, CustName: '호텔여분' }, { CustKey: 691, CustName: '은화' }] };
test('mixed units aggregate, full boxes and remainder conserve request quantity', () => {
  const m = buildHotelOrderRows([line(3, '박스'), line(15)], [line(3, '단')], products, { 10: { 691: 15 } });
  assert.deepEqual([m.rows[0].request, m.rows[0].purchase, m.rows[0].remaining, m.rows[0].surplus, m.rows[0].unassigned], [105, 30, 75, 60, 0]);
  const groups = hotelRegistrationPlan(m, scope);
  assert.deepEqual(groups.map(g => [g.custKey, g.items[0].qty]), [[680, 30], [690, 60], [691, 15]]);
  assert.equal(groups.reduce((s, g) => s + g.items[0].qty, 0), 105);
  assert.ok(groups.every(g => g.year === '2026' && g.week === '44-01'));
  const prior = hotelRegistrationPlan(m, { ...scope, year: '2025' });
  assert.ok(prior.every(g => g.year === '2025'));
});
test('exact box, zero balance, and fractional box boundaries', () => {
  assert.equal(buildHotelOrderRows([line(30)], [], products).rows[0].surplus, 30);
  const equal = buildHotelOrderRows([line(30)], [line(30)], products);
  assert.equal(equal.rows[0].unassigned, 0);
  assert.equal(hotelRegistrationPlan(equal, scope).length, 1);
  const fraction = buildHotelOrderRows([line(29.5)], [], products);
  assert.equal(fraction.rows[0].surplus, 0);
  assert.throws(() => hotelRegistrationPlan(fraction, scope), /분류필요/);
});
test('negative, missing, stale, invalid or overassigned inputs block registration', () => {
  for (const m of [
    buildHotelOrderRows([line(20)], [line(30)], products),
    buildHotelOrderRows([{ ...line(20), prodKey: null }], [], products),
    buildHotelOrderRows([line(20)], [], {}),
    buildHotelOrderRows([line(20, '')], [], products),
    buildHotelOrderRows([line(-1)], [], products),
    buildHotelOrderRows([line(Infinity)], [], products),
    buildHotelOrderRows([line(45)], [], products, { 10: { 691: 16 } }),
    buildHotelOrderRows([line(45)], [], products, { 10: { 691: -1 } }),
    buildHotelOrderRows([line(45)], [], { 10: { ...products[10], SteamOf1Box: 0, BunchOf1Box: 0 } }),
  ]) assert.throws(() => hotelRegistrationPlan(m, scope));
  const m = buildHotelOrderRows([line(45)], [], products, { 10: { 999: 15 } });
  assert.throws(() => hotelRegistrationPlan(m, scope), /업체/);
  assert.throws(() => hotelRegistrationPlan(m, { ...scope, year: '' }), /연도/);
  assert.throws(() => hotelConvert(1, '알수없음', '송이', products[10]), /단위/);
  assert.equal(hotelConvert(0, '송이', '송이', products[10]), 0);
});
test('saved mappings cannot resolve conflicting hotel names arbitrarily', () => {
  const x = uniqueHotelMappings([{ ItemName: '수국 화이트', ProdKey: 10 }, { ItemName: '수국화이트', ProdKey: 11 }, { ItemName: '장미', ProdKey: 12 }, { ItemName: '장미', ProdKey: 12 }]);
  assert.equal(x.groups.get(x.token('수국 화이트')).size, 2);
  assert.equal(x.groups.get(x.token('장미')).size, 1);
});
