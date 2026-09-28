const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),Module=require('module');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{transformSync}=require('next/dist/build/swc');
let values={},index=0;
const compile=(relative,custom)=>{const filename=path.resolve(__dirname,'..',relative),m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));if(custom)m.require=custom;m._compile(transformSync(fs.readFileSync(filename,'utf8'),{filename,jsc:{parser:{syntax:'ecmascript',jsx:true},target:'es2022',transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}).code,filename);return m.exports;};
const policy=compile('lib/actionLogOutcome.js');
const Page=compile('pages/dev/action-log.js',name=>name==='react'?{...React,useState(v){const i=index++;return [Object.hasOwn(values,i)?values[i]:v,()=>{}]},useCallback:f=>f,useEffect(){}}:name==='../../lib/useApi'?{}:name==='../../lib/actionLogOutcome'?policy:require(name)).default;
const failure={LogKey:8577,ActionDtm:'2026-09-22 22:06:28',ActionType:'SALES_DEFECT_DEDUCTION',Method:'POST',Result:'FAIL',ResultDesc:'영업지원 전산등록 권한이 필요합니다.',Payload:'{"rows":[',AffectedCount:0};
function render(v){values=v;index=0;return renderToStaticMarkup(React.createElement(Page));}
let html=render({0:[failure],1:1});
assert.match(html,/영업지원 전산등록 권한이 필요합니다/);assert.match(html,/권한 검사 차단/);assert.match(html,/대상 미기록/);assert.match(html,/로그 8577 상세/);
// selected is state15: logs,total,summary,byActor,byType,anomalies,loading,error,offset, six filters.
html=render({0:[failure],1:1,15:failure});assert.match(html,/role="dialog"/);assert.match(html,/로그 상세 닫기/);assert.match(html,/미기록/);
html=render({7:'network failed'});assert.match(html,/role="alert"/);assert.doesNotMatch(html,/이상 징후 없음/);
assert.match(html,/SALES_DEFECT_DEDUCTION/);
console.log('action-log UI: inline cause, evidence, missing target, modal and load failure passed');
