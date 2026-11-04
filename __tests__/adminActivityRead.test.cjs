const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('actual history handler qualifies colliding Product columns and preserves PK joins across years', async () => {
  const source = fs.readFileSync(require.resolve('../pages/api/admin/activity.js'), 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export default withAuth(', 'module.exports = withAuth(');
  const calls = [], sandbox = {module:{exports:{}}, withAuth:x=>x, sql:{NVarChar:'nvarchar'}, query:async (sql, params)=>{
    calls.push({sql,params});
    assert.ok(!/\b(INSERT|UPDATE|DELETE|MERGE)\b/i.test(sql));
    assert.ok(!/(?<!\.)\bDescr\s+AS/.test(sql));
    assert.ok(!/CAST\(ChangeDtm|AND ChangeID/.test(sql));
    return {recordset:[]};
  }};
  vm.runInNewContext(source, sandbox);
  for (const year of [2025,2026]) {
    const res = {status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
    await sandbox.module.exports({method:'GET',query:{startDate:`${year}-01-01`,endDate:`${year}-12-31`,userId:'fixture'}},res);
    assert.equal(res.code,200); assert.equal(res.body.success,true);
    assert.ok(calls.slice(-3).every(c=>c.params.start.value===`${year}-01-01`));
  }
  assert.match(calls[0].sql,/sh\.Descr AS/);
  assert.match(calls[1].sql,/oh\.OrderDetailKey = od\.OrderDetailKey/);
  assert.match(calls[2].sql,/sd\.ShipmentKey = sm\.ShipmentKey/);
  assert.match(calls[2].sql,/CONVERT\(NVARCHAR\(10\), sh\.ShipmentDtm, 23\) AS 변경항목/);
  assert.match(calls[2].sql,/sm\.CustKey = c\.CustKey/);
  assert.doesNotMatch(calls[2].sql,/sh\.ColumName|sd\.CustKey/);
});
