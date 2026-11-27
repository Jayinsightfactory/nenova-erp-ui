import assert from 'node:assert/strict';
import {readImportDay, farmTotals, groupFarmTotalsByCycle, matchesCountryOrderScope, visibleKakaoMessages, kakaoMessagePageSize, validItem, validSignedItem, summarizeUnitQuantities} from '../lib/importKakaoAdditions.js';
import './importKakaoOrderText.test.mjs';
import './importKakaoFarmSummary.test.mjs';
const headers='요청번호 항목|원문 시각|원문 작성자|분석 담당자|담당자 카톡|차수|원문 거래처|매칭 거래처|원문 품목|매칭 품목|수량|단위|매칭 판정|품목 후보|처리 상태|확인 필요사항|원문|검토 결과|거래처 수정|품목 수정'.replace('요청번호 항목','요청번호|항목').split('|');
const row=(i,customer,q,date='2026년 11월 17일 오전 11:30')=>['m',i,date,'','','','46-01',customer,'','','콜롬비아수국 Moon Light',q,'박스','','','','','추가 요청'];
const vals=[headers,row(1,'주광',1),row(2,'미우',2),row(3,'일신',1),row(4,'지난해',10,'2025년 11월 17일')];
const [m]=readImportDay(vals,'2026-11-17');assert.equal(m.items.length,3);
const checked=m.items.map(r=>({...r,checked:true}));
const [sum]=farmTotals(checked);assert.equal(sum.quantity,4);assert.equal(sum.product,'Moon Light');assert.equal(sum.group,'콜롬비아수국');assert.equal(sum.notes,'주광 1, 미우 2, 일신 1');
assert.equal(farmTotals([...checked,{...checked[0],customer:'',quantity:3}])[0].quantity,7);
assert.equal(farmTotals([...checked,{...checked[0],unit:'단'}]).length,2);
assert.equal(farmTotals(m.items).length,0);assert.equal(validItem({...checked[0],quantity:-1}),false);
assert.throws(()=>readImportDay([...vals,vals[1]],'2026-11-17'));assert.throws(()=>readImportDay([[]],'2026-11-17'));
const named=row(1,'CL21',2);named[10]='콜 수국 Moon Light';assert.equal(readImportDay([headers,named],'2026-11-17')[0].items[0].group,'콜롬비아수국');assert.equal(readImportDay([headers,named],'2026-11-17')[0].items[0].customer,'CL21');

const { readRecentImports } = await import('../lib/importKakaoAdditions.js');
function message(id, date) {
  const value = row(1, '', 1, date);
  value[0] = id;
  return value;
}
const recentRows = [headers,
  message('morning','2026년 11월 17일 오전 11:30'),
  message('today','2026-11-18 09:00:00'),
  message('old','2026년 11월 16일 오후 11:59'),
  message('evening','2026년 11월 17일 오후 7:08'),
  message('noon','2026년 11월 17일 오후 12:00'),
  message('midnight','2026년 11월 17일 오전 12:00'),
  message('future','2026년 11월 19일 오전 9:00'),
  message('prior-year','2025년 11월 18일 오전 9:00'),
];
const recent = readRecentImports(recentRows, new Date('2026-11-18T01:00:00Z'));
assert.deepEqual(recent.messages.map(m => m.id), ['today','evening','noon','morning','midnight']);
assert.equal(recent.from, '2026-11-17');
assert.equal(recent.to, '2026-11-18');
assert.equal(recent.latest, '2026-11-18 09:00:00');
const rollover = readRecentImports([headers,message('yesterday','2026년 12월 31일 오후 11:59')],new Date('2026-12-31T15:01:00Z'));
assert.equal(rollover.to,'2027-01-01');
assert.equal(rollover.from,'2026-12-31');
assert.equal(rollover.messages.length,1);
const stale = readRecentImports([headers,message('stale','2026년 11월 15일 오후 1:00')],new Date('2026-11-18T01:00:00Z'));
assert.equal(stale.messages.length,0);
assert.equal(stale.latest,'2026년 11월 15일 오후 1:00');
const { importItemView } = await import('../lib/importKakaoAdditions.js');
const autoRows = m.items.map(item => importItemView(item));
assert.equal(farmTotals(autoRows)[0].quantity, 4);
assert.equal(farmTotals(autoRows)[0].notes, '주광 1, 미우 2, 일신 1');
assert.equal(farmTotals([importItemView(m.items[0],{checked:false}),...autoRows.slice(1)])[0].quantity,3);
assert.equal(farmTotals([importItemView(m.items[0],{quantity:'3'}),...autoRows.slice(1)])[0].quantity,6);
assert.equal(farmTotals([...autoRows,importItemView({...m.items[0],customer:'',quantity:'2'})])[0].quantity,6);
assert.equal(importItemView({...m.items[0],product:''}).checked,false);
assert.equal(importItemView({...m.items[0],reviewReason:'취소·변경 내용 확인 필요'}).checked,false);
const cancelled = row(1,'업체',2); cancelled[17]='Moon Light 2박스 취소'; cancelled[15]='hold';
assert.equal(importItemView(readImportDay([headers,cancelled],'2026-11-17')[0].items[0]).checked,false);
const comma = row(1,'업체','1,000');
assert.equal(importItemView(readImportDay([headers,comma],'2026-11-17')[0].items[0]).quantity,'1000');
assert.equal(farmTotals([importItemView({...m.items[0],product:'moon light'}),...autoRows.slice(1)])[0].quantity,4);
for (const status of ['cancelled_wrong_contact','superseded_test_restart','archived_previous_scope']) {
  const inactive = row(1,'업체',2); inactive[15]=status;
  const item=readImportDay([headers,inactive],'2026-11-17')[0].items[0];
  assert.equal(importItemView(item).checked,false);
  assert.equal(importItemView(item,{checked:true}).checked,true);
}
assert.equal(importItemView({...m.items[0],quantity:'0'}).checked,false);
assert.equal(importItemView({...m.items[0],quantity:'-1'}).checked,false);
assert.equal(farmTotals([importItemView(m.items[0]),importItemView({...m.items[0],quantity:'2'})])[0].notes,'주광 3');

const groupFixture = {country:'콜롬비아', group:'수국', product:'Moon Light', checked:true, year:'2026', week:'46-01', quantity:1, unit:'박스'};
const grouped = groupFarmTotalsByCycle(farmTotals([
  {...groupFixture,key:'a'},
  {...groupFixture,key:'b',unit:'단'},
  {...groupFixture,key:'c',week:'46-02'},
  {...groupFixture,key:'d',year:'2025'},
  {...groupFixture,key:'e',group:'카네이션'},
  {...groupFixture,key:'f',country:'중국'},
  {...groupFixture,key:'g',country:'',group:''},
]));
assert.deepEqual(grouped.map(x=>x.label),['2025/46-01차','2026/46-01차','2026/46-02차']);
assert.deepEqual(grouped[1].rows.map(x=>x.country),['중국','콜롬비아','콜롬비아','콜롬비아','']);
assert.deepEqual(grouped[1].rows.map(x=>x.group),['수국','수국','수국','카네이션','']);
assert.deepEqual(grouped[1].rows.flatMap(x=>x.sourceKeys).sort(),['a','b','e','f','g']);
assert.equal(new Set(grouped[1].rows.filter(x=>x.country==='콜롬비아'&&x.group==='수국').map(x=>x.unit)).size,2);

const selectedScope = {country:'Colombia',year:2026,majorWeek:'46'};
assert(matchesCountryOrderScope(groupFixture, selectedScope));
assert(matchesCountryOrderScope({...groupFixture,week:'46-02'}, selectedScope));
assert(matchesCountryOrderScope({...groupFixture,week:'46-1'}, {...selectedScope,orderWeek:'46-01'}));
assert(matchesCountryOrderScope({...groupFixture,week:'46'}, {...selectedScope,orderWeek:'46-01'}));
assert(!matchesCountryOrderScope({...groupFixture,week:'46-02'}, {...selectedScope,orderWeek:'46-01'}));
assert(!matchesCountryOrderScope({...groupFixture,year:'2025'}, selectedScope));
assert(!matchesCountryOrderScope({...groupFixture,country:''}, selectedScope));
assert(!matchesCountryOrderScope({...groupFixture,week:''}, selectedScope));
assert(matchesCountryOrderScope({...groupFixture,year:'',week:''}, {country:'Colombia'}));
assert(matchesCountryOrderScope({...groupFixture,country:''}, null));
const messagePages=Array.from({length:105},(_,i)=>({id:String(i)}));
assert.equal(visibleKakaoMessages(messagePages,kakaoMessagePageSize,new Set()).length,100);
assert.equal(visibleKakaoMessages(messagePages,100,new Set(['104'])).at(-1).id,'104');
assert.equal(visibleKakaoMessages(messagePages,200,new Set()).length,105);

// Signed cancellation subtraction in importItemView, farmTotals & summarizeUnitQuantities
const baseRow = { key: 'add-1', year: '2026', week: '49-01', country: '콜롬비아', group: '수국', product: '화이트', quantity: '5', unit: '박스', customer: '주광' };
const cancelRow = { key: 'cancel-1', year: '2026', week: '49-01', country: '콜롬비아', group: '수국', product: '화이트', quantity: '2', unit: '박스', customer: '주광', cancelled: true };
const addView = importItemView(baseRow);
const cancelView = importItemView(cancelRow);
assert.equal(cancelView.isCancel, true);
assert.equal(cancelView.sign, -1);
assert.equal(cancelView.signedQty, -2);
assert.equal(cancelView.checked, true);
assert.equal(validItem({ ...baseRow, quantity: '-2' }), false);
assert.equal(validSignedItem(cancelView), true);

const netAdded = farmTotals([addView, cancelView]);
assert.equal(netAdded.length, 1);
assert.equal(netAdded[0].quantity, 3);
assert.equal(netAdded[0].addedQuantity, 5);
assert.equal(netAdded[0].cancelledQuantity, 2);
assert.equal(netAdded[0].notes, '주광 3');
assert.deepEqual(netAdded[0].sourceKeys, ['add-1', 'cancel-1']);

const soloCancel = farmTotals([cancelView]);
assert.equal(soloCancel.length, 1);
assert.equal(soloCancel[0].quantity, -2);
assert.equal(summarizeUnitQuantities(soloCancel).totalLine, '-2박스');
assert.equal(summarizeUnitQuantities(soloCancel, { lang: 'en' }).totalLine, '-2 box');

const offsetZero = farmTotals([importItemView({ ...baseRow, quantity: '2' }), cancelView]);
assert.equal(offsetZero.length, 0);
