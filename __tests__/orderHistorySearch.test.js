const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

async function main() {
  const helper = await import('../lib/orderHistorySearch.js');
  const { normalizeOrderHistorySearch: normalize, buildOrderHistoryWhere: where } = helper;
  for (const week of ['36-1', '36-01', '2026-36-01']) {
    const s = normalize({ year:'2026', week });
    assert.equal(s.week, '36-01'); assert.equal(s.year,'2026');
    assert.equal(where(s).values.week,'36-01');
  }
  assert.equal(where(normalize({week:'36차'},'2026')).values.week,'36-%');
  assert.equal(where(normalize({week:'',year:'2025'})).where,'WHERE om.OrderYear = @year');
  assert.equal(normalize({week:'2025-36-01'}).year,'2025');
  assert.equal(normalize({},'2026').year,'2026');
  for (const input of [{year:''},{year:'0'},{year:false},{year:['2026']},{week:'0'},{week:'36-0'},{week:'stale'},{year:'2026',week:'2025-36-01'},{page:0},{page:'x'}]) assert.throws(()=>normalize(input,'2026'));
  const search = where(normalize({year:'2026',week:'36',custName:'서부 꽃집',prodName:'수국 화이트'}));
  assert.equal(search.values.cust0,'%서부%');assert.equal(search.values.cust1,'%꽃집%');
  assert.equal(search.values.prod1,'%화이트%');assert.ok(search.where.includes('p.FlowerName'));
  assert.equal(where(normalize({prodName:'A%_[~',year:'2026'})).values.prod0,'%a~%~_~[~~%');
  assert.equal(where(normalize({custName:"x' OR 1=1",year:'2026'})).where.includes("x'"), false);
  assert.equal(where(normalize({custNames:'A|B|A',year:'2026'})).values.name1,'B');
  const fixture = [{year:'2025',week:'36-01'}, {year:'2026',week:'36-01'}, {year:'2026',week:'36-02'}];
  const scoped = where(normalize({year:'2026',week:'36-01'})).values;
  assert.deepEqual(fixture.filter(r=>r.year===scoped.year&&r.week===scoped.week),[fixture[1]]);

  let calls=0, rows=[], params, queryText;
  const apiSource=fs.readFileSync(path.join(__dirname,'../pages/api/orders/history.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default withAuth','this.handler = withAuth');
  const context={...helper,withAuth:f=>f,sql:{NVarChar:'string',Int:'int'},query:async(text,p)=>{calls++;queryText=text;params=p;return {recordset:rows};}};
  vm.createContext(context);vm.runInContext(apiSource,context);
  const invoke=async(query={},method='GET')=>{const res={statusCode:200,status(n){this.statusCode=n;return this;},json(d){this.body=d;return this;},end(){return this;}};await context.handler({method,query},res);return res;};
  rows=Array.from({length:501},(_,i)=>({historyKey:i,연도:'2026'}));
  const good=await invoke({year:'2026',week:'36-1',prodName:'Novia',page:'2'});
  assert.equal(good.statusCode,200);assert.equal(good.body.history.length,500);assert.equal(good.body.hasMore,true);
  assert.equal(params.year.value,'2026');assert.equal(params.offset.value,500);assert.equal(params.take.value,501);
  assert.ok(queryText.includes('om.OrderYear = @year'));assert.ok(queryText.includes('oh.OrderHistoryKey DESC'));
  assert.ok(!/\b(UPDATE|INSERT|DELETE|MERGE|EXEC)\b/i.test(queryText));
  const before=calls;assert.equal((await invoke({year:'2026',week:'2025-36-01'})).statusCode,400);assert.equal(calls,before);
  assert.equal((await invoke({},'POST')).statusCode,405);assert.equal(calls,before);
  rows=[];assert.equal((await invoke({year:'2026'})).body.hasMore,false);
  context.query=async()=>{throw Error('read failed');};assert.equal((await invoke({year:'2026'})).statusCode,500);
  const page=fs.readFileSync(path.join(__dirname,'../pages/orders/paste.js'),'utf8');assert.ok(page.includes('📋 작업 히스토리'));
  assert.ok(page.indexOf('📋 작업 히스토리')<page.indexOf('{(orders.length > 0 || orderHistoryRows.length > 0)'));
  console.log('order history search: year/week, keywords/escape, pagination, read-only handler and entry passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
