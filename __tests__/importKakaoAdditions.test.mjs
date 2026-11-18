import assert from 'node:assert/strict';
import {readImportDay, farmTotals, validItem} from '../lib/importKakaoAdditions.js';
import './importKakaoOrderText.test.mjs';
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
