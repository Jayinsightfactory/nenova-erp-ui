const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const {applyOrchid4403View,orchid4403Amount,orchid4403Identity}=await import('../lib/profitOrchid4403.js');
 const line={OrderYear:'2026',OrderWeek:'44-03',WarehouseKey:7870,WdetailKey:47389,ProdKey:3529,OrderNo:'99997130176',FarmName:'Cloudland',OutUnit:'송이',CounName:'중국',OutQuantity:600,SteamQuantity:600,UPrice:230,TPrice:138000};
 const c={C:39413527,Q:237170,R:199.2138,P:47247536.945999995,T:12728267.7165,G:59975804.662499994,H:6980209.087485718,E:1629651.5336000123,F:7168887.127077471,I:61416778.15650825,J:-22003251.156508252,K:-.5582664844104983,S:63892.5,L:-4848177,O:-703229,N:44964933,AC:null,AJ:null};
 const payload={orderYear:'2026',major:'44',rows:[{category:'중국',calc:c,auto:{Q:c.Q,F:c.F},manual:{},inventoryValuation:{end:{year:'2026',major:'44',method:'category_average',unit:'단',quantity:515,value:c.F,average:{purchaseQty:4810,purchaseForeign:c.Q,totalCost:c.G+c.H,unitCost:(c.G+c.H)/4810}}}},{category:'미국',calc:{C:100,J:25,P:20,E:0,F:0}}],totals:{...c,C:c.C+100,J:c.J+25,P:c.P+20}};
 const evidence={line,count:1,purchaseTotal:237170},scope={orderYear:'2026',major:'44'};
 const original=JSON.stringify(payload),out=applyOrchid4403View(payload,evidence,scope),after=out.rows[0].calc;
 assert.equal(out.orchid4403View.changed,true);assert.equal(after.Q,112970);assert.equal(orchid4403Amount(line),13800);
 assert(Math.abs(after.P-112970*c.R)<.01);assert(Math.abs(after.I-(after.E+after.G+after.H-after.F))<.01);assert(Math.abs(after.J-(after.C-after.I))<.01);assert.equal(after.K,after.J/after.C);
 assert(Math.abs(after.F-(after.G+after.H)/4810*515)<.01);
 for(const k of ['C','E','H','R','S','T','N','L','O','AC','AJ'])assert.equal(after[k],c[k],k);
 assert.equal(JSON.stringify(payload),original);assert.deepEqual(applyOrchid4403View(out,evidence,scope),out);
 assert.deepEqual(applyOrchid4403View(payload,evidence,{orderYear:'2025',major:'44'}),payload);
 for(const [key,value]of Object.entries({OrderYear:'2025',OrderWeek:'43-03',WarehouseKey:7871,WdetailKey:47390,ProdKey:3530,OrderNo:'99997130177',FarmName:'HUBFRESH',CounName:'태국',OutUnit:'단',OutQuantity:60,SteamQuantity:60,UPrice:231,TPrice:138001})){
  const wrong={...line,[key]:value};assert.equal(orchid4403Amount(wrong),wrong.TPrice,key);assert.equal(applyOrchid4403View(payload,{...evidence,line:wrong},scope).orchid4403View.changed,false,key);
 }
 assert(orchid4403Identity({...line,OrderNo:'999-97130176'}));
 for(const change of [p=>p.rows[0].calc.Q++,p=>p.rows[0].manual.F=0,p=>p.rows[0].inventoryValuation.end.average.purchaseForeign++,p=>p.rows[0].inventoryValuation.end.unit='송이']){
  const p=structuredClone(payload);change(p);const blocked=applyOrchid4403View(p,evidence,scope);assert.equal(blocked.orchid4403View.changed,false);assert.equal(blocked.audit.status,'needs_review');assert.equal(blocked.audit.warningCount,1);
 }
 const corrected=structuredClone(out);delete corrected.orchid4403View;assert.equal(applyOrchid4403View(corrected,evidence,scope).orchid4403View.reason,'already_applied');
 assert.deepEqual(applyOrchid4403View(payload,{...evidence,line:{...line,UPrice:23,TPrice:13800},purchaseTotal:112970},scope).rows,out.rows);
 assert.equal(orchid4403Amount({...line,UPrice:23,TPrice:13800}),13800);
 const api=fs.readFileSync('pages/api/sales/profit-report.js','utf8');assert.match(api,/exactView\?\{\.\.\.options,checkStale:false\}/);
 assert.match(api,/return exactView \? orchid4403ReportView\(payload,major,orderYear\) : payload/);
 assert.match(fs.readFileSync('lib/profitChinaTransportData.js','utf8'),/amount:orchid4403Amount\(row\)/);
 console.log(JSON.stringify({result:'PASS',before:{Q:c.Q,F:c.F,I:c.I,J:c.J,K:c.K},after:{Q:after.Q,F:after.F,I:after.I,J:after.J,K:after.K},delta:out.orchid4403View,originalUnchanged:true}));
})().catch(e=>{console.error(e);process.exitCode=1;});
