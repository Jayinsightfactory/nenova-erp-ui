const test=require('node:test');const assert=require('node:assert/strict');
const load=import('../lib/invoiceCostDownloadFeedback.js');
test('download feedback preserves existing eligibility across years and all states',async()=>{
 const {invoiceCostDownloadFeedback:f}=await load;
 for(const orderYear of ['2025','2026']) for(const busy of [false,true]) for(const status of [undefined,'BLOCKED','APPROVED']) {
  assert.equal(f({busy,preview:{status},form:{orderYear}}).disabled,busy || status!=='APPROVED');
 }
 assert.match(f().reason,/환율/);
 assert.match(f({form:{exchangeRateKRW:1000}}).reason,/공식 적용/);
 assert.match(f({form:{exchangeRateKRW:1000,formulaApplicabilityConfirmed:true},inputEdited:true}).reason,/변경/);
 assert.match(f({preview:{status:'BLOCKED',issues:[{message:'CW 입력 필요',severity:'error'}]}}).reason,/CW/);
 assert.equal(f({notice:{type:'error',text:'서버 연결 실패'}}).reason,'서버 연결 실패');
 assert.equal(f({preview:{status:'APPROVED',issues:[{severity:'warning',message:'시험값'}]}}).disabled,false);
});
test('AU missing GW is explicit while zero is not missing',async()=>{
 const {invoiceCostDownloadFeedback:f}=await load;
 const form={formulaId:'AU_CNF_BUNCH_V1',auOriginalMode:'FORMULA',exchangeRateKRW:1090,formulaApplicabilityConfirmed:true,auOriginal:{gw:'',itemCount:11,baeksangRateKRW:460,clearanceFeeKRW:33000,inspectionRateKRW:10000,domesticTransportKRW:0}};
 assert.match(f({form}).reason,/GW/);form.auOriginal.gw=0;assert.doesNotMatch(f({form}).reason,/GW/);
 assert.match(f({busy:true,form}).reason,/처리 중/);
});
