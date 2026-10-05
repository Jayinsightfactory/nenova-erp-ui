const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { transformSync } = require('next/dist/build/swc');

const root = path.resolve(__dirname, '..');

function compileModule(filename, mocks = {}) {
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = transformSync(source, {
    filename,
    jsc: { parser: { syntax: 'ecmascript' }, target: 'es2022' },
    module: { type: 'commonjs' },
  }).code;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = request => (Object.prototype.hasOwnProperty.call(mocks, request) ? mocks[request] : originalRequire(request));
  loaded._compile(compiled, filename);
  return loaded.exports;
}

const hotels = [
  {code:'raum',label:'라움'}, {code:'choimun',label:'초이문'}, {code:'shilla',label:'신라호텔'},
  {code:'hotel_87bc41c16ae5',label:'은화'},
];
const base = {PnlKey:1,ItemKey:1,OrderYear:'2026',MajorWeek:'39',PartnerCode:'raum',Name:'왁스 화이트',ProdKey:2330,Unit:'단',CostPrice:5000,IsCustom:0};
async function main() {
  let registryReads=0;
  const api=compileModule(path.join(root,'lib/pnlHotelCostHistory.js'),{
    './db.js':{sql:new Proxy({},{get:(_,key)=>key}),query:()=>{throw Error('unexpected default query');}},
    './pnlHotelRegistry.js':{listPnlHotels:async()=>{registryReads++;return hotels;}},
  });
  for(const year of [undefined,null,'26','2026;DROP','',[],['2026'],2026]) assert.throws(()=>api.normalizeHotelCostHistoryYear(year));
  assert.equal(api.normalizeHotelCostHistoryYear(' 2026 '),'2026');
  const inputs=[
    base,
    {...base,ItemKey:2,PartnerCode:'shilla',CostPrice:0},
    {...base,ItemKey:3,PartnerCode:'hotel_87bc41c16ae5',CostPrice:7000},
    {...base,ItemKey:4,PartnerCode:'hotel_87bc41c16ae5',CostPrice:7100},
    {...base,ItemKey:5,PartnerCode:'hotel_87bc41c16ae5',Unit:'송이',CostPrice:700},
    {...base,ItemKey:6,PartnerCode:'hotel_87bc41c16ae5',ProdKey:null},
    {...base,ItemKey:7,PartnerCode:'hotel_87bc41c16ae5',IsCustom:1},
    {...base,ItemKey:8,OrderYear:'2025',CostPrice:88888},
    {...base,ItemKey:9,PartnerCode:'hotel_ffffffffffff',CostPrice:99999},
    {...base,ItemKey:10,CostPrice:null},
    {...base,ItemKey:11,isDeleted:1,CostPrice:99999},
  ];
  const before=JSON.stringify(inputs);
  let call;
  const result=await api.loadPnlHotelCostHistory({orderYear:'2026'},async(statement,params)=>{
    call={statement,params};
    assert.match(statement,/m.OrderYear=@yr AND ISNULL\(m.isDeleted,0\)=0/);
    assert.match(statement,/i.CostPrice IS NOT NULL/);
    assert.match(statement,/h.PartnerCode=m.PartnerCode AND h.IsActive=1/);
    assert.match(statement,/OPENJSON\(@partners\)/);
    assert.doesNotMatch(statement,/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|MERGE|EXEC)\b/i);
    assert.doesNotMatch(statement,/WebArrivalCost|WebRaumCostPrice|SUM\(|AVG\(/i);
    return {recordset:inputs.filter(row=>!row.isDeleted)};
  });
  assert.equal(registryReads,1);
  assert.equal(call.params.yr.value,'2026');
  assert.deepEqual(JSON.parse(call.params.partners.value),hotels.map(hotel=>hotel.code));
  assert.equal(result.rows.length,7);
  assert.deepEqual(result.partners,hotels);
  assert.equal(result.rows.find(row=>row.itemKey===2).costPrice,0,'explicit zero preserved');
  assert.equal(result.rows.find(row=>row.itemKey===3).partnerLabel,'은화');
  assert.equal(result.rows.find(row=>row.itemKey===5).unit,'송이','units never converted');
  assert.equal(result.rows.find(row=>row.itemKey===6).prodKey,null,'unmapped identity retained for current-hotel-only client fallback');
  assert.equal(result.rows.find(row=>row.itemKey===7).isCustom,true,'custom discriminator retained');
  assert.deepEqual(result.rows.filter(row=>[3,4].includes(row.itemKey)).map(row=>row.costPrice),[7000,7100],'conflicting stored costs are not averaged');
  assert.equal(JSON.stringify(inputs),before);

  let authenticated=0,loads=0;
  const handler=compileModule(path.join(root,'pages/api/raum/hotel-cost-history.js'),{
    '../../../lib/auth':{withAuth:handler=>{authenticated++;return handler;}},
    '../../../lib/pnlHotelCostHistory.js':{loadPnlHotelCostHistory:async({orderYear})=>{loads++;api.normalizeHotelCostHistoryYear(orderYear);return result;}},
  }).default;
  const response=()=>({headers:{},statusCode:200,setHeader(key,value){this.headers[key]=value;},status(value){this.statusCode=value;return this;},json(value){this.body=value;return this;}});
  assert.equal(authenticated,1,'endpoint is authenticated');
  for(const method of ['POST','PUT','DELETE','PATCH']) {
    const res=response();await handler({method,query:{year:'2026'}},res);
    assert.equal(res.statusCode,405);assert.equal(res.headers.Allow,'GET');
  }
  assert.equal(loads,0,'non-GET cannot reach database loader');
  const missing=response();await handler({method:'GET',query:{}},missing);assert.equal(missing.statusCode,400);
  const ok=response();await handler({method:'GET',query:{year:'2026'}},ok);
  assert.equal(ok.statusCode,200);assert.equal(ok.headers['Cache-Control'],'no-store');assert.equal(ok.body.success,true);
  assert.deepEqual(ok.body.rows,result.rows);
  console.log('All-hotel stored cost history read-only, active hotel/year, zero/null and API tests passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
