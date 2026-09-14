import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the existing shared endpoint with isolated in-memory SQL fixtures, never production.
const source = fs.readFileSync(new URL('../pages/api/favorites.js', import.meta.url), 'utf8');
const records = [];
const calls = [];
let nextId = 1;
const context = { handler:null, withAuth:handler=>handler, sql:{NVarChar:'text',Int:'int'}, query:async (q, p={}) => {
  calls.push({q,p});
  if (/SELECT CASE WHEN OBJECT_ID/.test(q)) return {recordset:[{Ready:1}]};
  if (/IF NOT EXISTS/.test(q)) return {recordset:[]};
  assert.match(q, /UserFavorite/);
  assert.doesNotMatch(q, /\b(OrderMaster|OrderDetail|ShipmentDetail|ProductStock|Estimate|WarehouseMaster)\b/);
  const uid=p.uid.value;
  if (/INSERT INTO/.test(q)) {
    const item={FavoriteKey:nextId++,UserID:uid,PageName:p.page.value,FavName:p.name.value,FilterData:p.data.value};
    records.push(item);return {recordset:[{FavoriteKey:item.FavoriteKey}]};
  }
  assert.match(q,/UserID\s*=\s*@uid/);
  if (/SELECT FavoriteKey/.test(q)) {
    assert.match(q,/PageName\s*=\s*@page/);
    return {recordset:records.filter(r=>r.UserID===uid && r.PageName===p.page.value).map(r=>({...r}))};
  }
  const index=records.findIndex(r=>r.UserID===uid && r.FavoriteKey===p.fk.value);
  if (/UPDATE/.test(q) && index>=0) Object.assign(records[index],{FavName:p.name.value,FilterData:p.data.value});
  if (/DELETE/.test(q) && index>=0) records.splice(index,1);
  return {rowsAffected:[index>=0?1:0]};
}};
vm.runInNewContext(source.replace(/^import .*;\r?\n/gm,'').replace('export default withAuth','handler = withAuth'),context);
async function call(userId,method,body={},page='stats-pivot-exe') {
  const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;},end(){return this;}};
  await context.handler({method,body,query:{page},user:{userId}},res); return res;
}
const view=JSON.stringify({schemaVersion:1,decimals:0,zeroVisible:false});
let r=await call('A','POST',{page:'stats-pivot-exe',name:'출고 비교',filterData:view,userId:'B'});
assert.equal(r.code,200); const key=r.body.favoriteKey;
assert.equal(records[0].UserID,'A','body owner must not override authenticated owner');
assert.equal((await call('B','GET')).body.favorites.length,0);
assert.equal((await call('A','GET',{},'stock-status')).body.favorites.length,0);
r=await call('B','PUT',{favoriteKey:key,name:'다른 사람 변경',filterData:view});
assert.equal(r.code,404); assert.equal(records[0].FavName,'출고 비교');
await call('B','DELETE',{favoriteKey:key}); assert.equal(records.length,1);
r=await call('A','PUT',{favoriteKey:key,name:'내 수정',filterData:view});assert.equal(r.code,200);
const saved=(await call('A','GET')).body.favorites[0];
assert.equal(saved.FavName,'내 수정');assert.equal(JSON.parse(saved.FilterData).decimals,0);assert.equal(JSON.parse(saved.FilterData).zeroVisible,false);
const before=calls.length; r=await call('A','POST',{page:'stats-pivot-exe',name:'파손',filterData:'<html>'});
assert.equal(r.code,400);assert.equal(calls.length,before);
await call('A','DELETE',{favoriteKey:key});assert.equal(records.length,0);
console.log('pivot favorites: authenticated owner isolation, cross-page isolation, create/update/delete, invalid JSON and ERP preservation passed');
