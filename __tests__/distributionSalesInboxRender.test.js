const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {execFileSync}=require('node:child_process');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const babel=require('next/dist/compiled/babel/core');
const root=path.resolve(__dirname,'..');
const filename=path.join(root,'components/orders/DistributionSalesInbox.js');
const rows=Array.from({length:172},(_,index)=>({identity:`fixture-${index}`,sender:'fixture',created_at:'2026-10-02T00:00:00Z',message:`40-01 카네이션 변경사항\n거래처${index}\n문라이트 2박스 추가`}));

function render(source,{expanded=false}={}) {
  let hook=0,firstArray=true;
  const mockedReact={...React,useEffect:()=>{},useRef:value=>({current:value}),useMemo:fn=>fn(),useState:value=>{
    const index=hook++;
    if(index===1&&source.includes('expandedEvidence,setExpandedEvidence'))value=expanded?{[rows[0].identity]:true}:{};
    if(Array.isArray(value)&&firstArray){value=rows;firstArray=false;}
    return [value,()=>{}];
  }};
  const code=babel.transformSync(source,{filename,envName:'test',presets:[require.resolve('next/babel')]}).code;
  const module={exports:{}};
  const localRequire=name=>{
    if(name==='react')return mockedReact;
    if(name.startsWith('./Distribution'))return {__esModule:true,default:()=>null};
    return name.startsWith('.')?require(path.resolve(path.dirname(filename),name)):require(name);
  };
  vm.runInNewContext(code,{module,exports:module.exports,require:localRequire,console,Intl,Date,Map,Set,URLSearchParams,AbortController,setTimeout,clearTimeout,setInterval,clearInterval},{filename});
  return renderToStaticMarkup(React.createElement(module.exports.default,{year:'2026',week:'2026-40-01',onLoadText:()=>{}}));
}

const source=fs.readFileSync(filename,'utf8');
const closed=render(source),opened=render(source,{expanded:true});
const count=(html,token)=>html.split(token).length-1;
assert.equal(count(closed,'class="compact-source-evidence"'),172);
assert.equal(count(closed,'class="paired-message-original"'),172,'all source messages remain visible');
assert.equal(count(closed,'class="compact-match-expanded"'),0,'closed evidence panels are not mounted');
assert.equal(count(opened,'class="compact-match-expanded"'),1,'only the selected evidence panel mounts');
assert(opened.includes('입력칸으로')&&opened.includes('비교 선택'),'original actions remain available when opened');
// Optional local baseline measurement; absence of git does not affect assertions.
let baseline;
try {baseline=render(execFileSync('git',['show','HEAD:components/orders/DistributionSalesInbox.js'],{cwd:root,encoding:'utf8'}));} catch {}
const nodes=html=>(html.match(/<[a-z][^>]*>/g)||[]).length;
console.log(JSON.stringify({fixtureRows:172,closedNodes:nodes(closed),oneExpandedNodes:nodes(opened),baselineNodes:baseline?nodes(baseline):null}));
console.log('distribution inbox render: complete sources, lazy evidence and original actions passed');
