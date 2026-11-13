const test=require('node:test'),assert=require('node:assert/strict');
const {requestExcerpt,requestRows}=require('../lib/distributionKakaoRequests');
test('only quantity addition/cancellation requests; balance reports and delivery changes excluded',()=>{
 for(const text of ['37-1 잔량\n돈셀 4박스\n중국 잔량 (태림취소분) 킹스데이 10단','37-1 출고일 변경\n미우 수국 10박스\n월요일 출고','취소 하면서까지 만들 필요는 없어요.','추가취소방에서 요청해 주세요','화이트 10박스 취소분'])assert.equal(requestExcerpt(text).text,'',text);
 assert.deepEqual(requestExcerpt('46-1 수국 변경사항\n미우\n화이트 10박스 취소\n존버\n화이트 10박스 추가\n-> 오늘 출고입니다'),{text:'46-1 수국 변경사항\n미우\n화이트 10박스 취소\n존버\n화이트 10박스 추가',kinds:['취소','추가']});
 assert.deepEqual(requestExcerpt('46차 레몬잎 추가\n그린 레몬잎 2박스'),{text:'46차 레몬잎 추가\n그린 레몬잎 2박스',kinds:['추가']});
 const mixed=requestExcerpt('46-1 잔량\n화이트 10박스\n태림취소분 10단\n46-1 카네이션 변경사항\n업체 A 돈셀 1박스 취소\n46-1 출고일 변경\n업체 B 화요일 출고\n46-1 수국 추가\n업체 C 화이트 1박스');
 assert.match(mixed.text,/업체 A 돈셀 1박스 취소/);assert.match(mixed.text,/업체 C 화이트 1박스/);assert.doesNotMatch(mixed.text,/잔량|출고일|취소분|업체 B/);
});
test('canonical timestamps sort latest first across noon/dates and deduplicate IDs',()=>{
 const message=(id,time,text)=>({source:'nenovakakao',chat_id:'fixture',external_message_id:id,created_at:time,chatroom:'영업방',sender:'연습',message:text});
 const rows=requestRows([message('99','2026-11-12T22:00:00+09:00','업체 A 수국 1박스 추가'),message('10','2026-11-13T10:00:00+09:00','업체 B 수국 1박스 취소'),message('2','2026-11-13T13:00:00+09:00','업체 C 수국 1박스 추가'),message('2','2026-11-13T13:00:00+09:00','업체 C 수국 1박스 추가'),message('3','invalid','업체 D 수국 1박스 추가')]);
 assert.equal(rows.length,3);assert.deepEqual(rows.map(r=>r.sender),['연습','연습','연습']);assert.match(rows[0].text,/업체 C/);assert.deepEqual(rows[1].kinds,['취소']);
});
