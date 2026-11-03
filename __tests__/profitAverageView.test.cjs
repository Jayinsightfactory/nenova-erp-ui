const test=require('node:test'),assert=require('node:assert/strict');
const api=Promise.all([import('../lib/profitAverageView.mjs'),import('../lib/profitReportStoredCalculation.js'),import('../lib/profitReportCalc.js'),import('../lib/profitReportCustomsRateTiming.mjs')]);
function row(){return {category:'태국',manual:{},auto:{N:1000,L:0,O:0,Q:100,S:10,R:null,E:0,F:0,H:10},source:{H:'actual'},calc:{N:1000,L:0,O:0,C:1000,Q:100,S:10,R:null,P:null,T:null,G:null,E:0,F:0,H:10,I:null,J:null,K:null,AJ:null,AC:null}};}
test('official missing FX preserves foreign goods/freight and canonical profit formula without mutation',async()=>{const [v,,c,t]=await api;const r=row(),p={rows:[r]},before=JSON.stringify(p);const timing=t.approvedCustomsTiming({orderYear:2026,major:18,category:'태국',currency:'USD',missingCostRecovery:true});
 assert.equal(timing.date,'2026-05-04');assert.equal(t.approvedCustomsTiming({orderYear:2026,major:18,category:'태국',currency:'USD'}),null);
 for(const variant of [undefined,'noEnding'])for(const N of [1000,-1000]){const input=structuredClone(p);input.rows[0].variant=variant;input.rows[0].calc.C=N;input.rows[0].auto.N=N;input.rows[0].calc.AJ=23;input.rows[0].manual.AJ=23;
 const out=v.applyAverageFallbackView(input,{year:2026,major:18,fxByCategory:{태국:{available:true,rate:2,timing}}});const got=out.rows[0];const expected=c.computeProfitRow(got);
 assert.equal(got.calc.G,220);for(const k of ['I','J','K'])assert.equal(got.calc[k],expected[k]);assert.equal(got.averageFallback.evidence.R.actualDeclarationDateVerified,false);}
 assert.equal(JSON.stringify(p),before);
});
test('unrelated and profit edits retain approved derived acquisition amounts',async()=>{const [,s]=await api;const r=row();r.calc={...r.calc,G:220,P:200,T:20,E:0,F:0,H:10,I:230,J:770,K:.77};r.averageFallback={evidence:{G:{method:'weighted_goods_freight'}}};r.calculationFrozen=true;
 const p={rows:[r],averageFallback:{version:'test'},templateDuty:{},effectiveViewTotals:{}};
 assert.equal(s.profitDisplayCalculation(p,{別:{AJ:1}}).rows[0].calc.G,220);
 const edited=s.profitDisplayCalculation(p,{태국:{AJ:30}}).rows[0].calc;assert.equal(edited.G,220);assert.equal(edited.J,800);assert.equal(edited.K,.8);
 assert.equal(s.profitDisplayCalculation(p,{태국:{R:3}}).rows[0].calc.G,330);
});
test('explicit manual customs zero survives official FX recovery',async()=>{const [v]=await api,r=row();r.manual.H=0;r.calc.H=0;r.auto.H=0;const got=v.applyAverageFallbackView({rows:[r]},{year:2026,major:18,fxByCategory:{태국:{available:true,rate:2}}}).rows[0];assert.equal(got.calc.H,0);assert.equal(got.calc.K,.78);});
test('completed average view is shown as calculation basis without certifying held original evidence',async()=>{const {buildProfitStatusPresentation}=await import('../lib/profitReportStatusPresentation.mjs');const r=row();r.calc={...r.calc,G:220,P:200,T:20,R:2,I:230,J:770,K:.77};r.averageFallback={evidence:{G:{method:'weighted_goods_freight'}}};const out=buildProfitStatusPresentation({rows:[r],validation:{knownIssues:[{category:'태국',severity:'error',message:'원본 원가 연결 확인'}]}}).items[0];assert.equal(out.state,'estimated');assert.equal(out.label,'계산 기준');assert.ok(out.reasons.includes('원본 원가 연결 확인'));assert.notEqual(out.state,'verified');});
test('actual evidence JSX shows components, conversion and original/current snapshot without certainty promotion',()=>{const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{transformSync}=require('next/dist/build/swc');const filename=path.resolve('components/ProfitAverageEvidence.js'),m=new Module(filename);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));m._compile(transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}).code,filename);const html=renderToStaticMarkup(React.createElement(m.exports.default,{data:{rows:[{category:'중국',calc:{F:100},averageFallback:{evidence:{F:{details:[{prodKey:3477,stems:100,rawQuantity:10,rawUnit:'단',conversion:{factor:10,level:'reference_conversion',historicalPackingVerified:false},cost:{goodsPerStem:2,freightPerStem:3,customsPerStem:1,level:'same_country',sourcePeriods:[2026430100],sourceCount:2},snapshotBasisChange:{year:'2026',week:'43-03',previousQuantity:147,currentQuantity:210,unit:'단',stockKey:297}}]}}}}]}}));for(const text of ['계산 기준','품목 #3477','환산','상품 2원','운임 3원','통관 1원','147','210','StockKey 297','당시 실제 납부'])assert.ok(html.includes(text),text);assert.ok(!html.includes('추정 포함'));});
test('recovered official FX metadata passes unchanged production smoke assertions and preserves all numbers',async()=>{
 const [view,,,timingApi]=await api,timing=timingApi.approvedCustomsTiming({orderYear:'2026',major:'18',category:'태국',currency:'USD',missingCostRecovery:true});
 const r=row();r.currency='USD';r.calc={...r.calc,R:1476.35,P:147635,T:14763.5,G:162398.5};r.source.R='approved_customs_timing_estimate';r.rateEstimated=false;r.rateDetail={source:'missing'};
 r.averageFallback={evidence:{R:{available:true,rate:1476.35,currency:'USD',timing,sourceDate:'2026-05-03',sourceRangeStart:'2026-05-03',sourceRangeEnd:'2026-05-09'}}};
 const input={rows:[r],averageFallback:{version:'arrival-weighted-country-v1'},totals:{C:1000,G:162398.5},confirmedTotals:{C:1000,G:162398.5},audit:{status:'needs_input',issues:[{severity:'error',code:'OLD_SOURCE',category:'태국'}]}};
 const original=JSON.stringify(input),got=view.applyAverageFallbackView(input,{year:'2026',major:'18'}),rate=got.rows[0];
 assert.deepEqual(rate.calc,r.calc);assert.deepEqual(got.totals,input.totals);assert.deepEqual(got.confirmedTotals,input.confirmedTotals);assert.equal(JSON.stringify(input),original);
 // Same assertions as scripts/profit-production-download-smoke.cjs, not relaxed.
 assert.equal(rate.rateEstimated,true);assert.equal(rate.rateDetail.estimated,true);assert.equal(String(rate.rateDetail.orderYear),'2026');assert.equal(Number(rate.rateDetail.major),18);
 assert.ok(rate.rateDetail.scheduleId||rate.rateDetail.scheduleIds?.length);assert.ok(rate.rateDetail.officialSourceRange);
 assert.ok(got.audit.issues.some(i=>i.code==='APPROVED_CUSTOMS_TIMING_ESTIMATE'&&i.category===rate.category));
 assert.equal(rate.rateDetail.dates[0].date,'2026-05-04');assert.deepEqual(rate.rateDetail.officialSourceRange,{start:'2026-05-03',end:'2026-05-09'});assert.equal(rate.rateDetail.actualDeclarationDateVerified,false);
 assert.equal(got.audit.status,'needs_input');assert.equal(rate.averageFallback.originalRateEvidence.rateEstimated,false);
 assert.deepEqual(view.completeAverageRateEvidence(got,{year:'2026',major:'18'}),got);
 for(const manual of [0,1500]){const p=structuredClone(input);p.rows[0].manual.R=manual;assert.deepEqual(view.completeAverageRateEvidence(p,{year:'2026',major:'18'}),p);}
 assert.deepEqual(view.completeAverageRateEvidence(input,{year:'2025',major:'18'}),input);
 const missingRange=structuredClone(input);delete missingRange.rows[0].averageFallback.evidence.R.sourceRangeStart;assert.deepEqual(view.completeAverageRateEvidence(missingRange,{year:'2026',major:'18'}),missingRange);
 const actual=structuredClone(input);actual.rows[0].source.R='manual';assert.deepEqual(view.completeAverageRateEvidence(actual,{year:'2026',major:'18'}),actual);
});
