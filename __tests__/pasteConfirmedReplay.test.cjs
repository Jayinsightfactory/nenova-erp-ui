const test=require('node:test'),assert=require('node:assert/strict');
const {makeReplayArm,compareConfirmed,canonicalQuantity}=require('../scripts/paste-confirmed-audit.cjs');
test('old and improved real handlers replay on frozen masters without DB/cache writes',async()=>{
 const products=[{ProdKey:10,ProdName:'CARNATION Moon Light',DisplayName:'문라이트',FlowerName:'카네이션',CounName:'콜롬비아',OutUnit:'박스',BunchOf1Box:20,SteamOf1Box:200,SteamOf1Bunch:10}];
 const data={masters:[[{CustKey:1,CustName:'검증업체'}],products,[],[{StoreKey:'product',Payload:JSON.stringify({'카네이션 문라이트':{prodKey:10,manual:true}})},{StoreKey:'customer',Payload:'{}'}]]};
 const sdkClient={messages:{create:async request=>{
  let value;if(request.system.includes('각 task.id')){const tasks=JSON.parse(request.messages[0].content).tasks;value={decisions:tasks.map(t=>({id:t.id,key:t.kind==='customer'?1:10,confidence:1}))};}else value={orders:[{custName:'검증업체',items:[{inputName:'카네이션 문라이트',qty:1,unit:'박스',action:'추가'}]}]};
  return {content:[{type:'text',text:JSON.stringify(value)}],usage:{input_tokens:100,output_tokens:10}};
 }}};
 const c={text:'44-1 카네이션 변경사항\n검증업체\n문라이트 1박스 추가',year:'2026',entries:[{custKey:1,prodKey:10,type:'ADD',qty:1,unit:'박스'}]},budget={calls:0,inputTokens:0,characters:0};
 const old=await makeReplayArm('baseline',data,budget,{sdkClient}).run(c),next=await makeReplayArm('improved',data,budget,{sdkClient}).run(c);
 assert.equal(old.status,200);assert.equal(next.status,200);assert.equal(compareConfirmed(c.entries,old.result.orders,products).complete,true);assert.equal(compareConfirmed(c.entries,next.result.orders,products).complete,true);assert.equal(old.performance.calls,2);assert.equal(next.performance.calls,0);
 assert.equal(canonicalQuantity(20,'단',products[0]),1);assert.equal(compareConfirmed(c.entries,[{custMatch:{CustKey:1},items:[{prodKey:10,action:'추가',qty:20,unit:'단'}]}],products).complete,true);
 assert.equal(compareConfirmed(c.entries,[{custMatch:{CustKey:1},items:[{prodKey:10,action:'추가',qty:2,unit:'박스'}]}],products).quantityCorrect,0);
});
