const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync('pages/shipment/distribute.js','utf8'),marker='  const loadWorkspaceCustomers=useCallback(';
assert(source.includes(marker));let callback=source.slice(source.indexOf(marker)+marker.length);callback=callback.slice(0,callback.indexOf('\n  },[week,selectedOrderYear,apiGetDistribute]);')+4);assert(callback.endsWith('}'));
const compile=new Function('week','selectedOrderYear','apiGetDistribute','customerListRequestRef','currentWeekRef','setCustomerListLoading','setCustList','sortDistributionCustomers','setErr','return ('+callback+');');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(){const state={loading:[],lists:[],errors:[],calls:[]},request={current:0},currentWeek={current:'2025-45-02'};return {state,request,currentWeek,make:(week,year,pending)=>compile(week,year,params=>{state.calls.push({year,...params});return pending.promise;},request,currentWeek,v=>state.loading.push(v),v=>state.lists.push(v),rows=>rows.slice().sort((a,b)=>a.CustKey-b.CustKey),v=>state.errors.push(v))};}
test('same shared loader backs week effect and manual search; request completion belongs to customer scope',()=>{
 assert.match(source,/useEffect\(\(\)=>\{loadWorkspaceCustomers\(\)/);const search=source.slice(source.indexOf('  const handleSearch = async () => {'),source.indexOf('  const loadPivotRows'));
 assert.match(search,/loadWorkspaceCustomers\(\)/);assert(!search.includes('customerListRequestRef.current+='));
});
test('2025 and 2026 same45 reverse responses cannot replace current customers or clear newer loading',async()=>{
 const f=fixture(),old=deferred(),latest=deferred();const oldRun=f.make('2025-45-02','2025',old)();f.currentWeek.current='2026-45-02';const latestRun=f.make('2026-45-02','2026',latest)();
 old.resolve({success:true,customers:[{CustKey:2025}]});await oldRun;assert.deepEqual(f.state.loading,[true,true]);assert.deepEqual(f.state.lists,[[],[]]);
 latest.resolve({success:true,customers:[{CustKey:3},{CustKey:1}]});await latestRun;assert.deepEqual(f.state.lists.at(-1),[{CustKey:1},{CustKey:3}]);assert.equal(f.state.loading.at(-1),false);
 assert.deepEqual(f.state.calls,[{year:'2025',type:'workspaceCustomers',week:'2025-45-02',prodGroup:''},{year:'2026',type:'workspaceCustomers',week:'2026-45-02',prodGroup:''}]);
});
test('manual replacement resolves even when unrelated product/group search becomes stale',async()=>{
 const f=fixture(),a=deferred(),b=deferred();const runA=f.make('2025-45-02','2025',a)(),runB=f.make('2025-45-02','2025',b)();
 b.resolve({success:true,customers:[{CustKey:7}]});await runB;const before=JSON.stringify(f.state);a.reject(Error('old request failed'));await runA;assert.equal(JSON.stringify(f.state),before);assert.deepEqual(f.state.errors,[]);assert.equal(f.state.loading.at(-1),false);
});
test('current API error clears its loading and exposes failure; absent scope performs no request',async()=>{
 for(const fail of [Error('network failed'),{success:false,error:'query failed'}]){const f=fixture(),p=deferred(),run=f.make('2025-45-02','2025',p)();if(fail instanceof Error)p.reject(fail);else p.resolve(fail);assert.equal((await run).success,false);assert.equal(f.state.loading.at(-1),false);assert.equal(f.state.errors.length,1);assert.deepEqual(f.state.lists,[[]]);}
 for(const [week,year] of [['','2025'],['2025-45-02','']]){const f=fixture();assert.equal(await f.make(week,year,deferred())(),undefined);assert.deepEqual(f.state.calls,[]);assert.deepEqual(f.state.loading,[]);}
});
