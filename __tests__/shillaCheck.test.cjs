const {test}=require('node:test');
const assert=require('node:assert/strict');
const mod=import('../lib/shillaCheck.js');
const scope={year:'2026',from:'2026-09-01',to:'2026-10-21',periods:['39','40']};
const db=[{year:'2026',period:'40',prodKey:2158,unit:'단',qty:647,price:9200,amount:5952400,quoteDate:'2026-10-07'},
 {year:'2026',period:'39',prodKey:3074,unit:'8스팀',qty:501,price:13000,amount:6513000,quoteDate:'2026-09-30'}];
const receipts=[{date:'2026-10-08',code:'50103916',unit:'PK',qty:427,price:9200,amount:3928400,receiptNo:'1',receiptItem:'1'},
 {date:'2026-09-30',code:'50040599',unit:'EA',qty:485,price:13000,amount:6305000,receiptNo:'2',receiptItem:'1'}];
test('known cases annotate pending220 and white485 without changing sources',async()=>{
 const {shillaKnownReviews:f}=await mod;const input={scope,db,receipts},before=JSON.stringify(input);
 assert.deepEqual(f(input).map(r=>r.status),['수정 대기','수정 필요']);assert.equal(JSON.stringify(input),before);
 assert.equal(f(input)[1].amountDifference,208000);
});
test('case boundaries: other year/period, partial range, changed qty/price, duplicates and missing stay unconfirmed',async()=>{
 const {shillaKnownReviews:f}=await mod;
 assert.deepEqual(f({scope:{...scope,year:'2025'},db,receipts}),[]);
 assert.deepEqual(f({scope:{...scope,periods:['39-2']},db,receipts}),[]);
 assert(f({scope:{...scope,from:'2026-10-08'},db,receipts}).every(r=>r.status==='추가 확인'));
 for(const patch of [{qty:0},{price:null},{amount:null},{unit:'BOX'},{qty:428,amount:3937600}])
   assert.equal(f({scope,db,receipts:[{...receipts[0],...patch},receipts[1]]})[0].status,'추가 확인');
 assert.equal(f({scope,db,receipts:[...receipts,receipts[0]]})[0].status,'추가 확인');
 assert(f({scope,db,receipts:[]}).every(r=>r.status==='추가 확인'));
});
test('corrected live sources clear old findings',async()=>{
 const {shillaKnownReviews:f}=await mod;
 const r=f({scope,db:[db[0],{...db[1],qty:485,amount:6305000}],receipts:[{...receipts[0],qty:647,amount:5952400},receipts[1]]});
 assert(r.every(r=>r.status==='확인 기준 일치'));
});
test('case notes cannot certify conflicting lineage or a changed workbook',async()=>{
 const {shillaReviewStatus:f}=await mod;
 const note={prodKey:3074,period:'39',status:'확인 기준 일치',expected:485,price:13000};
 const line={prodKey:3074,period:'39',excel:{qty:485,amount:6305000}};
 assert.equal(f(line,[note]),'확인 기준 일치');
 assert.equal(f({...line,excel:{qty:501,amount:6513000}},[note]),'추가 확인');
 assert.equal(f({...line,conflict:true},[note]),'추가 확인');
 assert.equal(f({salesExplained:true}), '판매요청 정상');
});
test('stored source requires selected year and preserves explicit zero; ambiguous dates not invented',async()=>{
 const {storedShillaSource:f}=await mod;
 assert.throws(()=>f(db,'2025'),/없습니다/);
 const r=f([...db,{...db[0],year:'2025',qty:99},{...db[0],qty:0,quoteDate:'2026-10-08'}],'2026');
 assert.equal(r.rows.length,3);assert.equal(r.rows.at(-1).qty,0);assert.equal(r.periods[0].date,null);
});
test('default months respect KST today, leap month and selected year',async()=>{
 const {shillaDefaultRange:f}=await mod;
 assert.deepEqual(f([{date:'2026-10-07'}],'2026','2026-10-21'),{from:'2026-10-01',to:'2026-10-21'});
 assert.deepEqual(f([{date:'2024-02-01'}],'2024','2026-10-21'),{from:'2024-02-01',to:'2024-02-29'});
 assert.deepEqual(f([{date:'2025-02-01'}],'2026','2026-10-21'),{from:'2026-01-01',to:'2026-10-21'});
 assert.throws(()=>f([],'2027','2026-10-21'));assert.throws(()=>f([],'','2026-10-21'));
});
test('new route renders one-click optional-file workflow, old route still requires workbook',()=>{
 const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 const {transformSync}=require('next/dist/build/swc');
 function load(filename) {
   filename=path.resolve(filename);const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));
   const base=m.require.bind(m);m.require=n=>n.startsWith('.')?load(path.resolve(path.dirname(filename),n.endsWith('.js')?n:`${n}.js`)):base(n);
   m._compile(transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}).code,filename);
   return m.exports;
 }
 const New=load('pages/raum/shilla-analysis/check.js').default;
 const Old=load('pages/raum/shilla-analysis.js').default;
 const a=renderToStaticMarkup(React.createElement(New)),b=renderToStaticMarkup(React.createElement(Old));
 assert.match(a,/신라 입고·견적·손익 확인/);assert.match(a,/<button class="primary">작업 시작<\/button>/);
 assert.match(a,/원본 엑셀.*선택/);assert.match(b,/<button disabled="">원본·DB 확인<\/button>/);
 assert.doesNotMatch(b,/>작업 시작<\/button>/);
});
