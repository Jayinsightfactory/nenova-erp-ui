const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const babel=require('next/dist/compiled/babel/core');
const policy=require('../lib/ecountLookupWindow.cjs');
const code=babel.transformSync(fs.readFileSync(require.resolve('../components/ecount/useLookupWindow.js'),'utf8'),{filename:"useLookupWindow.js",babelrc:false,configFile:false,presets:[[require('next/babel'),{'preset-env':{modules:'commonjs'}}]]}).code;
const moduleBox={exports:{}};vm.runInNewContext(code,{module:moduleBox,exports:moduleBox.exports,URLSearchParams,require:id=>id.includes('ecountLookupWindow')?policy:require(id)});
const {createLookupWindowController}=moduleBox.exports;
function fixture(){
 let scope='menu1|orderStat|aggregate',selected=[],errors=[],seq=0;
 const listeners=new Map(),intervals=new Map(),children=[];
 const host={location:{origin:'https://nenovaweb.com'},closed:false,crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++seq).padStart(12,'0')}`},addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:(n,f)=>{if(listeners.get(n)===f)listeners.delete(n);},setInterval:f=>{intervals.set(seq,f);return seq;},clearInterval:id=>intervals.delete(id),open:url=>{const child={closed:false,close(){this.closed=true;},url};children.push(child);return child;}};
 const control=createLookupWindowController(host,{getScope:()=>scope,onDaily:v=>selected.push(v),onError:v=>errors.push(v)});
 function event(child=children.at(-1)){const q=new URL(child.url,host.location.origin).searchParams;return{origin:host.location.origin,source:child,data:policy.createSelection({dataset:q.get('dataset'),nonce:q.get('nonce')})};}
 return{host,control,listeners,intervals,children,selected,errors,event,setScope:v=>scope=v};
}
test('new-window daily selection updates once then closes and removes listeners',()=>{for(const dataset of ['orderStat','poStat']){const f=fixture();f.control.open(dataset);const receive=f.listeners.get('message'),e=f.event();receive(e);receive(e);assert.deepEqual(f.selected,[dataset]);assert(f.children[0].closed);assert.equal(f.listeners.size,0);assert.equal(f.intervals.size,0);}});
test('wrong source/origin/nonce and changed menu cannot update parent',()=>{const f=fixture();f.control.open('orderStat');const receive=f.listeners.get('message'),e=f.event();receive({...e,source:{}});receive({...e,origin:'https://evil.invalid'});receive({...e,data:{...e.data,nonce:'bad'}});assert.equal(f.selected.length,0);f.setScope('menu2|orderStat|aggregate');receive(e);assert.equal(f.selected.length,0);[...f.intervals.values()][0]();assert(f.children[0].closed);assert.equal(f.listeners.size,0);});
test('reopen invalidates previous window; page exit closes pending child',()=>{const f=fixture();f.control.open('orderStat');const old=f.event(),oldReceive=f.listeners.get('message');f.control.open('poStat');assert(f.children[0].closed);oldReceive(old);f.listeners.get('message')(old);assert.equal(f.selected.length,0);f.listeners.get('pagehide')();assert(f.children[1].closed);assert.equal(f.listeners.size,0);});
test('blocked popup and child close leave no active session',()=>{const f=fixture();f.host.open=()=>null;f.control.open('orderStat');assert.equal(f.errors.length,1);assert.equal(f.listeners.size,0);f.host.open=()=>{throw Error('blocked');};f.control.open('orderStat');assert.equal(f.errors.length,2);assert.equal(f.listeners.size,0);const g=fixture();g.control.open('orderStat');g.children[0].closed=true;[...g.intervals.values()][0]();assert.equal(g.listeners.size,0);assert.equal(g.selected.length,0);});

const path=require('node:path'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
function loadComponent(file,cache={}) {
 file=path.resolve(file);if(cache[file])return cache[file].exports;
 const item={exports:{}};cache[file]=item;
 const transformed=babel.transformSync(fs.readFileSync(file,'utf8'),{filename:file,babelrc:false,configFile:false,presets:[[require('next/babel'),{'preset-env':{modules:'commonjs'}}]]}).code;
 vm.runInNewContext(transformed,{module:item,exports:item.exports,require:id=>id.endsWith('.css')?new Proxy({},{get:(_,key)=>key==='__esModule'?false:key}):id.startsWith('.')?loadComponent(path.resolve(path.dirname(file),id.endsWith('.js')?id:id+'.js'),cache):require(id),console,process});return item.exports;
}
test('both lookup variants retain observed IDs and isolated dialog controls',()=>{
 const report=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/ecount-workbench/button-matches.json'),'utf8'));
 for(const [file,name,program,context] of [['OrderStatusPageControls','OrderAggregateLookup','E040209','항목추가'],['PoStatusPageControls','PoAggregateLookup','E040306','집계조건검색']]){
  const Component=loadComponent(path.join(__dirname,'../components/ecount/'+file+'.js'))[name];
  const html=renderToStaticMarkup(React.createElement(Component,{onNewWindow(){},onClose(){},onDaily(){}}));
  const ids=[...html.matchAll(/data-ecount-action-id="([^"]+)"/g)].map(m=>m[1]);
  const expected=report.pages.find(p=>p.program===program).buttons.filter(b=>[context,context+' 제목줄',context+' 하단'].includes(b.source.context)).map(b=>b.matchId);
  assert.deepEqual([...ids].sort(),expected.sort());assert.equal(ids.length,new Set(ids).size);
  assert(html.includes('lookupDialog'));assert(html.includes('aria-label="새창"'));
  const standalone=renderToStaticMarkup(React.createElement(Component,{standalone:true,onClose(){},onDaily(){}}));
  assert(standalone.includes('lookupStandalone'));assert(!standalone.includes('aria-label="새창"'));
 }
});

test('lookup dimensions stay scoped and preserve source measured table widths',()=>{
 const css=require('postcss').parse(fs.readFileSync(path.join(__dirname,'../styles/ecount-workbench.module.css'),'utf8'));
 function value(selector,property){let result;css.walkRules(selector,rule=>rule.walkDecls(property,decl=>result=decl.value));return result;}
 assert.equal(value('.lookupDialog','width'),'960px');assert.equal(value('.lookupDialog','height'),'684px');
 assert.equal(value('.orderLookupDialog .lookupTree table','width'),'406px');
 assert.equal(value('.lookupDialog .lookupTree table','width'),'100%');
 assert.equal(value('.lookupDialog>header','height'),'35.65625px');
 assert.equal(value('.lookupDialog .lookupTree thead th','height'),'39.046875px');
});

test('only observed PO modal maximizes/restores; order and detached window stay disabled',()=>{
 let state=false;
 const item={exports:{}};
 const source=babel.transformSync(fs.readFileSync(path.join(__dirname,'../components/EcountWorkspaceDialog.js'),'utf8'),{filename:'EcountWorkspaceDialog.js',babelrc:false,configFile:false,presets:[[require('next/babel'),{'preset-env':{modules:'commonjs'}}]]}).code;
 vm.runInNewContext(source,{module:item,exports:item.exports,require:id=>id==='react'?{...React,useEffect(){},useRef:()=>({current:null}),useState:()=>[state,update=>state=update(state)]}:id.endsWith('.css')?new Proxy({},{get:(_,key)=>key==='__esModule'?false:key}):require(id)});
 function buttons(element){if(!element||typeof element!=='object')return [];return [...(element.type==='button'?[element]:[]),...React.Children.toArray(element.props?.children).flatMap(buttons)];}
 const render=(variant,standalone=false)=>item.exports.EcountWorkspaceDialog({title:'lookup',lookupVariant:variant,standalone,onClose(){}});
 const max=buttons(render('po')).find(b=>b.props['aria-label']==='최대화');assert.equal(max.props.disabled,false);max.props.onClick();assert.equal(state,true);
 const expanded=render('po');assert(renderToStaticMarkup(expanded).includes('lookupMaximized'));
 const restore=buttons(expanded).find(b=>b.props['aria-label']==='복원');restore.props.onClick();assert.equal(state,false);
 assert.equal(buttons(render('order')).find(b=>b.props['aria-label']==='최대화').props.disabled,true);
 assert.equal(buttons(render('po',true)).find(b=>b.props['aria-label']==='최대화').props.disabled,true);
});
