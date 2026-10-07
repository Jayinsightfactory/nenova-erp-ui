import test from 'node:test';
import assert from 'node:assert/strict';
import {bindAutoHeightFrame} from '../lib/autoHeightFrame.js';

function fixture() {
 let height=1800, visible=true, callback, queued;
 const listeners=new Map(), styles=[];
 const view={ResizeObserver:class {constructor(fn){callback=fn;}observe(){}disconnect(){this.closed=true;}},requestAnimationFrame(fn){queued=fn;return 1;},cancelAnimationFrame(){queued=null;},addEventListener(){},removeEventListener(){}};
 const doc={body:{getBoundingClientRect:()=>({height})},head:{appendChild:s=>styles.push(s)},defaultView:view,createElement:()=>({dataset:{},remove(){this.removed=true;}})};
 const frame={contentDocument:doc,style:{},clientWidth:1000,getClientRects:()=>visible?[{}]:[],addEventListener:(k,v)=>listeners.set(k,v),removeEventListener:k=>listeners.delete(k)};
 return {frame,styles,listeners,setHeight:v=>height=v,setVisible:v=>visible=v,flush(){const fn=queued;queued=null;fn?.();},resize(){callback();}};
}
test('same-origin frame grows and shrinks with content, keeps hidden tab height and cleans up',()=>{
 const f=fixture(),cleanup=bindAutoHeightFrame(f.frame);f.flush();assert.equal(f.frame.style.height,'1802px');
 f.setHeight(620);f.resize();f.flush();assert.equal(f.frame.style.height,'622px');
 f.setVisible(false);f.setHeight(0);f.resize();f.flush();assert.equal(f.frame.style.height,'622px');
 f.setVisible(true);f.setHeight(2400);f.resize();f.flush();assert.equal(f.frame.style.height,'2402px');
 f.listeners.get('load')();f.flush();assert.equal(f.styles[0].removed,true);assert.equal(f.styles.length,2);
 cleanup();assert.equal(f.styles[1].removed,true);assert.equal(f.listeners.size,0);
});
test('unavailable/cross-origin document is never read or mutated',()=>{
 let load;const frame={addEventListener:(k,fn)=>load=fn,removeEventListener(){},get contentDocument(){throw Error('cross-origin');}};
 const cleanup=bindAutoHeightFrame(frame);assert.doesNotThrow(load);assert.doesNotThrow(cleanup);
});
test('missing or failed observer leaves ordinary frame scrolling accessible',()=>{
 const missing=fixture();missing.frame.contentDocument.defaultView.ResizeObserver=undefined;
 const stopMissing=bindAutoHeightFrame(missing.frame);assert.equal(missing.styles.length,0);stopMissing();
 const failed=fixture();failed.frame.contentDocument.defaultView.ResizeObserver=class{observe(){throw Error('unsupported target');}disconnect(){}};
 const stopFailed=bindAutoHeightFrame(failed.frame);assert.equal(failed.styles[0].removed,true);assert.doesNotThrow(stopFailed);
});
test('navigation to another application page restores ordinary iframe layout',()=>{
 const f=fixture();f.frame.contentDocument.location={pathname:'/sales/farm-quality'};
 const cleanup=bindAutoHeightFrame(f.frame);f.flush();
 f.frame.contentDocument.location.pathname='/sales/defect-deductions';f.resize();f.flush();
 assert.equal(f.styles[0].removed,true);assert.equal(f.frame.style.height,'600px');cleanup();
});
