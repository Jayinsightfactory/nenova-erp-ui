const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{transformSync}=require('next/dist/build/swc');
function compile(relative,dependency) {
  const filename=path.resolve(__dirname,'..',relative),module=new Module(filename);
  module.filename=filename;module.paths=Module._nodeModulePaths(path.dirname(filename));
  const original=module.require.bind(module);
  module.require=id=>id.includes('weekdaySaveReceipt')&&dependency?dependency:original(id);
  module._compile(transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}).code,filename);
  return module.exports;
}
const helper=compile('lib/weekdaySaveReceipt.js'),ui=compile('components/WeekdaySaveReceipt.js',helper);
const receipt={operationId:'saved-uuid',custKey:533,reason:'요일 변경',checkedAt:'2026-10-13',changes:[{
  year:'2026',orderWeek:'42-01',prodKey:359,unit:'박스',beforeState:{total:5,fixed:false},afterState:{total:5,fixed:true},
  latestState:'MATCH',userId:'operator',logs:['영속 감사 대조 완료'],dates:[{date:'2026-10-15',timestamp:'2026-10-15 00:00:00.000',before:5,after:0,changed:true}]}]};
test('render result as native inline disclosure with actual dates, fixation and logs',()=>{
  const html=renderToStaticMarkup(React.createElement(ui.default,{receipt,onRetry(){},names:{359:'카네이션'}}));
  for(const text of ['저장 결과 확인','saved-uuid','2026/42-01','카네이션','2026-10-15','미확정','확정','영속 감사 대조 완료','최신 재조회와 일치']) assert.ok(html.includes(text),text);
  assert.ok(html.includes('<details>'));assert.ok(html.includes('<summary'));assert.ok(html.includes('scope="col"'));
  assert.ok(!html.includes('role="dialog"'));assert.ok(!html.includes('overflow-y'));assert.ok(!html.includes('max-height'));
});
test('readback failure exposes retry without invented saved details',()=>{
  const html=renderToStaticMarkup(React.createElement(ui.default,{error:'offline',onRetry(){}}));
  assert.ok(html.includes('role="alert"'));assert.ok(html.includes('같은 작업 결과 다시 조회'));
  assert.ok(!html.includes('<table'));assert.ok(!html.includes('최신 재조회와 일치'));
});
test('latest change is distinct from saved-time values',()=>{
  const changed={...receipt,changes:[{...receipt.changes[0],latestState:'CHANGED',latest:{total:7,fixed:true,dates:[{date:'2026-10-16',quantity:7}]}}]};
  const html=renderToStaticMarkup(React.createElement(ui.default,{receipt:changed}));
  assert.ok(html.includes('저장 이후 현재값이 달라짐'));assert.ok(html.includes('현재 총량 7'));
  assert.ok(html.includes('총량 5 → 5'));assert.ok(html.includes('저장 시점 값'));
});
test('workspace JSX compiles with receipt/history wiring',()=>{
  const filename=path.resolve(__dirname,'../components/WeekdayEstimateWorkspace.js');
  assert.doesNotThrow(()=>transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},target:'es2022'},module:{type:'commonjs'}}));
});
