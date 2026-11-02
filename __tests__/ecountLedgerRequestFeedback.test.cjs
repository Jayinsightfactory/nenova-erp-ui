const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../pages/ecount/customer-ledger.js'),'utf8');
const code=source.slice(source.indexOf('  async function load(key)'),source.indexOf('  useEffect(',source.indexOf('  async function load(key)')));
function setup(fetch){const state={data:{custKey:13,takenAt:'2025-12-31T09:00:00Z',ledger:{totals:{balance:100}}},error:'',requestError:''},requestId={current:0},selectionId={current:0};const run=new Function('fetch','messages','requestId','selectionId','setLoading','setError','setData','setRequesting','setRequestError','selected',code+';return {load,requestRefresh};')(fetch,{REQUEST_RATE_LIMIT:'WAIT_10_MINUTES',CUSTOMER_FORBIDDEN:'FORBIDDEN'},requestId,selectionId,()=>{},v=>state.error=v,v=>state.data=typeof v==='function'?v(state.data):v,()=>{},v=>state.requestError=v,'13');return {...run,state,requestId,selectionId};}
const response=(status,data)=>({status,ok:status<400,json:async()=>data});
test('temporary HTTP or network lookup failures retain the selected verified snapshot; auth denial clears it',async()=>{
 let result=response(503,{success:false});const h=setup(async()=>{if(result instanceof Error)throw result;return result;}),saved=h.state.data;
 await h.load('13');assert.equal(h.state.data,saved);assert.ok(h.state.error);
 result=new TypeError('network unavailable');await h.load('13');assert.equal(h.state.data,saved);
 result=response(403,{success:false,error:'CUSTOMER_FORBIDDEN'});await h.load('13');assert.equal(h.state.data,null);assert.equal(h.state.error,'FORBIDDEN');
});
test('rejected manual request remains visible through cached polling; accepted retry clears the rejection',async()=>{
 let allowed=false;const h=setup(async(_url,options)=>options?.method==='POST'?response(allowed?200:429,allowed?{success:true,request:{status:'PENDING'}}:{success:false,error:'REQUEST_RATE_LIMIT'}):response(200,{success:true,...h.state.data}));
 await h.requestRefresh();assert.equal(h.state.requestError,'WAIT_10_MINUTES');const saved=h.state.data;
 await h.load('13');assert.equal(h.state.requestError,'WAIT_10_MINUTES');assert.equal(h.state.data.takenAt,saved.takenAt);
 allowed=true;await h.requestRefresh();assert.equal(h.state.requestError,'');assert.equal(h.state.data.refreshRequest.status,'PENDING');
});
test('a late denied lookup from a previous selection cannot clear a new-year customer snapshot',async()=>{
 let resolve;const h=setup(()=>new Promise(r=>resolve=r)),pending=h.load('13');h.requestId.current++;const newer={custKey:14,takenAt:'2026-01-01T09:00:00Z',ledger:{totals:{balance:200}}};h.state.data=newer;
 resolve(response(403,{success:false,error:'CUSTOMER_FORBIDDEN'}));await pending;assert.equal(h.state.data,newer);assert.equal(h.state.error,'');
});

test('manual authorization denial clears cached data, while a rate-limit rejection retains it',async()=>{
 let status=429;const h=setup(async()=>response(status,{success:false,error:status===429?'REQUEST_RATE_LIMIT':'CUSTOMER_FORBIDDEN'})),saved=h.state.data;
 await h.requestRefresh();assert.equal(h.state.data,saved);status=403;await h.requestRefresh();assert.equal(h.state.data,null);assert.equal(h.state.requestError,'FORBIDDEN');
});
