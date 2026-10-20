const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const babel=require('next/dist/compiled/babel/core');
const source=fs.readFileSync(path.join(__dirname,'../pages/ecount/workbench.js'),'utf8');
const ast=babel.parseSync(source,{babelrc:false,configFile:false,parserOpts:{plugins:['jsx']}});
let selection,effect;
function walk(node){
  if(!node||typeof node!=='object')return;
  if(node.type==='FunctionDeclaration'&&node.id?.name==='selectMenu')selection=source.slice(node.start,node.end);
  if(node.type==='CallExpression'&&node.callee?.name==='useEffect'&&source.slice(node.start,node.end).includes("'hashchange'"))effect=source.slice(node.arguments[0].start,node.arguments[0].end);
  for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);}
}
walk(ast);assert.ok(selection&&effect,'execute actual page selection and location effect');
function harness(){
  const listeners=new Map(),updates=[],writes=[];
  const scope={busy:false,menuId:null,MENUS:[{id:'receipt',tab:'stock'},{id:'payment',tab:'finance'}],URLSearchParams,requestId:{current:0},titleRef:{current:null},setTimeout:()=>{},window:{location:{hash:'#menu=receipt',pathname:'/ecount/workbench',search:''},history:{replaceState:(...args)=>writes.push(args)},addEventListener:(type,fn)=>listeners.set(type,fn),removeEventListener:(type,fn)=>{if(listeners.get(type)===fn)listeners.delete(type);}}};
  for(const name of selection.matchAll(/\b(set[A-Z]\w*)\(/g)){if(name[1]==='setTimeout')continue;scope[name[1]]=value=>{updates.push([name[1],value]);if(name[1]==='setMenuId')scope.menuId=value;};}
  const context=vm.createContext(scope);vm.runInContext(selection,context);
  let cleanup;
  const mount=()=>{cleanup?.();cleanup=vm.runInContext('('+effect+')()',context);};
  return {scope,updates,writes,listeners,mount,unmount:()=>cleanup?.(),fire:type=>listeners.get(type)?.()};
}
test('same-path hash and browser history select the new dataset without writing URL or retaining modal drafts',()=>{
  const h=harness();h.mount();assert.equal(h.scope.menuId,'receipt');assert.equal(h.writes.length,0);
  h.updates.length=0;h.scope.window.location.hash='#menu=payment';h.fire('hashchange');assert.equal(h.scope.menuId,'payment');assert.equal(h.writes.length,0);
  for(const setter of ['setVersion','setRevision','setDialog','setUpload'])assert.ok(h.updates.some(([name,value])=>name===setter&&value===null),setter);
  assert.ok(h.updates.some(([name,value])=>name==='setTab'&&value==='finance'));
  h.scope.window.location.hash='#menu=receipt';h.fire('popstate');assert.equal(h.scope.menuId,'receipt');
  h.unmount();assert.equal(h.listeners.size,0);
});
test('busy navigation is applied after work finishes; duplicate/invalid events do not erase current data',()=>{
  const h=harness();h.mount();h.scope.busy=true;h.scope.window.location.hash='#menu=payment';h.fire('hashchange');assert.equal(h.scope.menuId,'receipt');
  h.scope.busy=false;h.mount();assert.equal(h.scope.menuId,'payment');h.updates.length=0;
  h.fire('hashchange');h.fire('popstate');assert.equal(h.updates.length,0);
  h.scope.window.location.hash='#menu=unknown';h.fire('hashchange');assert.equal(h.updates.length,0);assert.equal(h.scope.menuId,'payment');
});
test('menu clicks still update URL once and selecting the same menu preserves loaded revision',()=>{
  const h=harness();h.mount();vm.runInContext("selectMenu('payment')",vm.createContext(h.scope));assert.equal(h.writes.length,1);assert.ok(h.writes[0][2].endsWith('#menu=payment'));
  h.updates.length=0;vm.runInContext("selectMenu('payment')",vm.createContext(h.scope));assert.equal(h.writes.length,1);assert.ok(!h.updates.some(([name])=>['setVersion','setRevision'].includes(name)));
});
