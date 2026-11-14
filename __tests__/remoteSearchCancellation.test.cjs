const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const cases = [
  ['pages/orders/new.js', '/api/customers/search'],
  ['pages/orders/paste-template.js', '/api/customers/search'],
  ['pages/estimate.js', '/api/customers/search'],
  ['components/estimate/OrderRegisterDistributeModal.js', '/api/customers/search'],
  ['pages/sales/status.js', '/api/customers/search'],
  ['pages/sales/revenue-management.js', '/api/customers/search'],
  ['pages/orders/import.js', "{ q: query.trim() }"],
  ['pages/shipment/distribute-import.js', '/api/customers/search?q='],
  ['pages/shipment/distribute-import.js', '/api/products/search?q='],
  ['components/HotelOrderWorkspace.js', '{ q: search }'],
  ['pages/m/customers/index.js', 'fetch(url,'],
  ['pages/arrival-cost.js', 'const encoded = encodeURIComponent'],
];

function effectFor(file, marker) {
  const source = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
  const position = source.indexOf(marker);
  assert.ok(position >= 0, `${file}: search exists`);
  const start = source.lastIndexOf('useEffect(() => {', position);
  const end = source.indexOf('\n  }, [', position);
  return source.slice(start + 'useEffect('.length, end) + '\n  }';
}

function harness(body) {
  let timer, pending, signal;
  const writes = [];
  const setters = Object.fromEntries(['setCustList','setShowCustDrop','setResults','setOpen','setLoading','setCustResults','setCustOpen','setRemote','setHits','setError','setCustomers','setOptions','setBusy'].map(key => [key, value => writes.push([key, value])]));
  const request = options => {
    signal = options.signal;
    return new Promise((resolve, reject) => { pending = { resolve, reject }; });
  };
  const context = {
    ...setters, AbortController, query:'rose', custQuery:'rose', custSearch:'rose', search:'rose', open:true, selectedCust:null, selectedCustFixed:false, me:{}, showAll:false,
    picker:{}, lookup:{current:0}, custReqSeq:{current:0}, custPickedName:{current:''}, contextText:'',
    kind:'product', value:'rose', parseJsonResponse:response=>response.json(),
    shouldRunCustomerSearch:()=>true, custDebounce:{current:null}, searchTimer:{current:null},
    setTimeout:callback => { timer = callback; return callback; }, clearTimeout:handle => { if (handle === timer) timer = undefined; },
    apiGet:(_path,_params,options) => request(options), fetch:(_path,options) => request(options),
  };
  const effect = vm.runInNewContext(`(${body})`, context);
  return { effect, writes, run:()=>timer?.(), pending:()=>pending, signal:()=>signal };
}
const flush = async () => { for (let i=0;i<12;i++) await Promise.resolve(); };

for (const [file, marker] of cases) {
  test(`${file} ${marker}: debounce cancels pending work and stale responses cannot write`, async () => {
    const body = effectFor(file, marker);
    const queued = harness(body);
    const cancel = queued.effect();
    cancel(); queued.run();
    assert.equal(queued.pending(), undefined, 'rapid typing before delay sends no request');

    const current = harness(body);
    const finish = current.effect(); current.run();
    const before = current.writes.length;
    current.pending().resolve({ ok:true, success:true, customers:[{CustKey:1}], products:[{ProdKey:1}], json:async()=>({success:true,customers:[{CustKey:1}],products:[{ProdKey:1}]}) });
    await flush();
    assert.ok(current.writes.length > before, 'current result still reaches the original UI');
    finish();

    for (const fail of [false, true]) {
      const h = harness(body);
      const cleanup = h.effect(); h.run();
      assert.ok(h.pending(), 'settled input sends request');
      cleanup(); assert.equal(h.signal().aborted, true);
      const count = h.writes.length;
      if (fail) h.pending().reject(new Error('late failed request'));
      else h.pending().resolve({ ok:true, success:true, customers:[{CustKey:1}], products:[{ProdKey:1}], json:async()=>({success:true,customers:[{CustKey:1}],products:[{ProdKey:1}]}) });
      await flush();
      assert.equal(h.writes.length, count, 'late response/rejection after new input, clearing or closing is ignored even if transport ignores abort');
    }
  });
}

test('defect lookup close cancels request and rejects late results/errors and candidate telemetry', async () => {
  const source = fs.readFileSync('pages/sales/defect-deductions.js','utf8').replaceAll('\r\n','\n');
  const fetchBody = source.slice(source.indexOf('  const fetchLookup ='), source.indexOf('  const openLookup ='));
  const closeBody = source.slice(source.indexOf('  const closeLookup ='), source.indexOf('  const readLookupAnchor ='));
  for (const fail of [false,true]) {
    let timer, pending, signal;
    const writes=[];
    const context={ AbortController, searchTimer:{current:null},lookupRequestSeq:{current:0},lookupController:{current:null},
      setTimeout:fn=>{timer=fn;return fn;},clearTimeout:()=>{timer=null;},
      apiGet:(_path,_params,options)=>{signal=options.signal;return new Promise((resolve,reject)=>{pending={resolve,reject};});},
      apiPost:()=>{writes.push('telemetry');return Promise.resolve();},
      ...Object.fromEntries(['setLookup','setActiveSearch','setLookupQuery','setLookupActiveIndex','setLookupMatchMeta','setLookupAnchor','setError'].map(key=>[key,()=>writes.push(key)])),
    };
    const {fetchLookup,closeLookup}=vm.runInNewContext(`(()=>{${fetchBody}\n${closeBody}\nreturn {fetchLookup,closeLookup};})()`,context);
    fetchLookup(0,'product','rose'); timer(); closeLookup();
    assert.equal(signal.aborted,true); const count=writes.length;
    if(fail)pending.reject(new Error('old failure'));else pending.resolve({products:[{ProdKey:1}]});
    await flush(); assert.equal(writes.length,count);
  }
});
