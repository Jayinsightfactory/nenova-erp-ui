const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('guide advances invalid input → confirmation → preview → download without writes or typing focus theft',()=>{
 const source=fs.readFileSync('components/import-tools/useCostStepGuide.js','utf8').replace("import {useEffect,useRef} from 'react';",'').replace('export default function','function');
 let effect,idx=0;const refs=[];const ctx={useEffect:f=>effect=f,useRef:v=>refs[idx++]||=( {current:v}),document:{activeElement:null}};
 vm.createContext(ctx);vm.runInContext(source+';this.hook=useCostStepGuide;',ctx);
 const node=()=>({disabled:false,checked:false,getClientRects:()=>[1],setAttribute(k,v){this[k]=v},removeAttribute(k){delete this[k]},scrollIntoView(){this.scrolled=true}});
 const input=node(),confirm=node(),preview=node(),download=node();let invalid=[input],listener;
 const panel={querySelectorAll:s=>s==='[data-cost-next]'?[input,confirm,preview,download].filter(n=>n['data-cost-next']):invalid,querySelector:s=>s.includes('confirm')?confirm:s.includes('download')?download:preview,contains:()=>false,addEventListener:(e,f)=>listener=f,removeEventListener:()=>{}};
 const run=ready=>{idx=0;const root=ctx.hook(Math.random(),ready);root.current=panel;effect()};
 run(false);assert.equal(input['data-cost-next'],'true');invalid=[];run(false);assert.equal(input['data-cost-next'],undefined);assert.equal(confirm['data-cost-next'],'true');
 confirm.checked=true;run(false);assert.equal(preview['data-cost-next'],'true');run(true);assert.equal(download['data-cost-next'],'true');assert.equal(download.scrolled,true);
});
