const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('order feed preserves each original message time and ID inside legacy blocks',async()=>{
 const source=fs.readFileSync('pages/api/kakao/order-feed.js','utf8').replace(/^import .*;\s*$/gm,'').replace('export default withAuth(handler);','return handler;');
 const rows=[['time','room','pipeline','sender','text','id'],['10:00','연습 발주방','','연습','업체 A 수국 1박스 추가','a'],['10:02','연습 발주방','','연습','업체 B 장미 2박스 취소','b']];
 const handler=new Function('withAuth','readSheetValues','getKakaoSheetId','PIPELINE_STAGES',source)(fn=>fn,async()=>rows,()=> 'fixture',[{key:'ORDER',rooms:['연습 발주방']}]);
 let body;await handler({method:'GET',query:{n:'60'}},{json(value){body=value;},status(){return this;}});
 assert.equal(body.blocks.length,1);assert.equal(body.blocks[0].text,'업체 A 수국 1박스 추가\n업체 B 장미 2박스 취소');
 assert.deepEqual(body.blocks[0].messages.map(m=>[m.msgId,m.time,m.text]),[['a','10:00','업체 A 수국 1박스 추가'],['b','10:02','업체 B 장미 2박스 취소']]);
});
