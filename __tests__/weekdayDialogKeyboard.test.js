import assert from 'node:assert/strict';
import { installWeekdayDialogKeyboard } from '../lib/weekdayDialogKeyboard.js';

const surface=()=>({listeners:new Map(),activeElement:null,
  addEventListener(type,fn){this.listeners.set(type,fn);},
  removeEventListener(type,fn){if(this.listeners.get(type)===fn)this.listeners.delete(type);}});
const doc=surface(),frameDoc=surface();
const control=(name,owner=doc)=>({name,isConnected:true,disabled:false,hidden:false,
  getAttribute(){return null;},focus(){owner.activeElement=this;}});
const textarea=control('reason'),apply=control('apply'),close=control('close'),trigger=control('trigger');
let items=[textarea,apply,close],closed=0,busy=false;
const root={ownerDocument:doc,querySelectorAll:()=>items,querySelector:()=>textarea,
  contains:node=>items.includes(node),focus(){doc.activeElement=this;}};
const key=(key,patch={})=>({key,prevented:false,stopped:false,
  preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...patch});
let cleanup=installWeekdayDialogKeyboard(root,{onClose:()=>closed++,canClose:()=>!busy,returnFocus:trigger});
assert.equal(doc.activeElement,textarea,'opens on reason input');
textarea.focus();let event=key('Tab',{shiftKey:true});doc.listeners.get('keydown')(event);
assert.equal(event.prevented,true);assert.equal(doc.activeElement,close,'Shift+Tab wraps to last');
event=key('Tab');doc.listeners.get('keydown')(event);
assert.equal(doc.activeElement,textarea,'Tab wraps from last');
apply.focus();event=key('Tab');doc.listeners.get('keydown')(event);
assert.equal(event.prevented,false,'ordinary interior navigation preserved');
busy=true;event=key('Escape');doc.listeners.get('keydown')(event);
assert.equal(closed,0,'busy save cannot close or abandon recovery');assert.equal(event.prevented,true);
busy=false;doc.listeners.get('keydown')(key('Escape',{isComposing:true}));assert.equal(closed,0);
doc.listeners.get('keydown')(key('Escape'));assert.equal(closed,1);
items=[];doc.listeners.get('keydown')(key('Tab'));assert.equal(doc.activeElement,root,'all-disabled save keeps focus contained');
cleanup();assert.equal(doc.activeElement,trigger,'close restores trigger');assert.equal(doc.listeners.size,0);

const frame=control('preview document');Object.assign(frame,surface(),{contentDocument:frameDoc});
items=[apply,close,frame];root.querySelector=()=>close;
cleanup=installWeekdayDialogKeyboard(root,{onClose:()=>closed++,returnFocus:trigger,frame});
assert.equal(doc.activeElement,close);
frameDoc.querySelectorAll=()=>[];
frame.focus();frameDoc.listeners.get('keydown')(key('Tab'));assert.equal(doc.activeElement,apply,'empty document forward boundary returns to first control');
frame.focus();frameDoc.listeners.get('keydown')(key('Tab',{shiftKey:true}));assert.equal(doc.activeElement,close,'document reverse boundary returns to close');
frameDoc.listeners.get('keydown')(key('Escape'));assert.equal(closed,2,'Escape works inside print iframe');
const linkA=control('linkA',frameDoc),linkB=control('linkB',frameDoc);
frameDoc.querySelectorAll=()=>[linkA,linkB];linkA.focus();event=key('Tab');frameDoc.listeners.get('keydown')(event);
assert.equal(event.prevented,false,'document internal controls remain reachable');
linkB.focus();frameDoc.listeners.get('keydown')(key('Tab'));assert.equal(doc.activeElement,apply);
cleanup();assert.equal(frameDoc.listeners.size,0);assert.equal(frame.listeners.size,0);
assert.equal(doc.activeElement,trigger);
console.log('Weekday modal keyboard: initial focus, Tab boundaries, busy/IME Escape, focus return and iframe document access passed');
