import assert from 'node:assert/strict';
import fs from 'node:fs';
import { filterWeekdayCompareRows, normalizeWeekdayCompareRequest, normalizeWeekdayUnit, WEEKDAY_ORDER_OUT_QUANTITY_SQL } from '../lib/weekdayEstimateCompare.js';
import { weekdaySnapshotDigest } from '../lib/weekdayDistributionPolicy.js';
import { weekdayDetailCustomerMatchesMaster, WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL } from '../lib/weekdayCustomerLink.js';

const scope = normalizeWeekdayCompareRequest({ year: '2026', custKey: '7', orderWeeks: ['38-02', '38-02'], prodKeys: [101, '101'] });
for (const value of ['박스','BOX','Box',' box ']) assert.equal(normalizeWeekdayUnit(value), '박스');
for (const value of ['단','BUNCH','Bunch']) assert.equal(normalizeWeekdayUnit(value), '단');
for (const value of ['송이','STEAM','STEM']) assert.equal(normalizeWeekdayUnit(value), '송이');
for (const value of ['',null,'kg','unknown']) assert.equal(normalizeWeekdayUnit(value), null);
assert.match(WEEKDAY_ORDER_OUT_QUANTITY_SQL, /N'BOX'\) THEN ISNULL\(od.BoxQuantity,0\)/);
assert.match(WEEKDAY_ORDER_OUT_QUANTITY_SQL, /N'BUNCH'\) THEN ISNULL\(od.BunchQuantity,0\)/);
assert.match(WEEKDAY_ORDER_OUT_QUANTITY_SQL, /ELSE NULL END$/);
assert.deepEqual(scope, { year: 2026, custKey: 7, weeks: ['38-02'], prodKeys: [101] });
assert.throws(() => normalizeWeekdayCompareRequest({ custKey: 7, orderWeeks: ['38-02'], prodKeys: [101] }), /연도/);
assert.throws(() => normalizeWeekdayCompareRequest({ year: 2026, custKey: 0, orderWeeks: ['38-02'], prodKeys: [101] }), /거래처/);
assert.throws(() => normalizeWeekdayCompareRequest({ year: 2026, custKey: 7, orderWeeks: ['38'], prodKeys: [101] }), /세부차수/);
assert.throws(() => normalizeWeekdayCompareRequest({ year: 2026, custKey: 7, orderWeeks: ['38-02'], prodKeys: [0] }), /품목/);

const fixture = [
  { OrderYear: 2026, OrderWeek: '38-02', CustKey: 7, ProdKey: 101, value: 'positive' },
  { OrderYear: 2025, OrderWeek: '38-02', CustKey: 7, ProdKey: 101, value: 'prior-year near-miss' },
  { OrderYear: 2026, OrderWeek: '38-02', CustKey: 8, ProdKey: 101, value: 'other-customer near-miss' },
  { OrderYear: 2026, OrderWeek: '38-01', CustKey: 7, ProdKey: 101, value: 'other-week near-miss' },
  { OrderYear: 2026, OrderWeek: '38-02', CustKey: 7, ProdKey: 102, value: 'other-product near-miss' },
];
assert.deepEqual(filterWeekdayCompareRows(fixture, scope).map((row) => row.value), ['positive']);
// Raw details now provide the complete digest input. Fixed-state aggregation is
// numeric JavaScript, not SQL MIN/MAX(bit), and must preserve mixed detection.
const compareApi = fs.readFileSync(new URL('../pages/api/estimate/weekday-compare.js', import.meta.url), 'utf8');
assert.doesNotMatch(compareApi, /(?:MIN|MAX)\(\s*(?:ISNULL\()?sd\.isFix/);
assert.match(compareApi, /Math\.min\(\.\.\.detailRows\.map/);
assert.match(compareApi, /Math\.max\(\.\.\.detailRows\.map/);
assert.match(compareApi, /sd\.CustKey AS DetailCustKey/);
assert.match(compareApi, /SELECT sm\.OrderYear,sm\.OrderWeek,sm\.CustKey,sd\.ProdKey/,
  'parent ShipmentMaster customer scopes the compare result');

const master={OrderYear:'2026',OrderWeek:'38-02',CustKey:7,ShipmentKey:11,MasterIsFix:true,OrderYearWeek:'202638'};
const product={ProdKey:101,ProdName:'Fixture',OutUnit:'박스',EstUnit:'단',BunchOf1Box:16,SteamOf1Bunch:1,SteamOf1Box:16};
const detail={...master,DetailCustKey:7,ProdKey:101,SdetailKey:21,OutQuantity:5,BoxQuantity:5,BunchQuantity:80,SteamQuantity:80,EstQuantity:80,DetailCost:1000,DetailAmount:72727,DetailVat:7273,DetailIsFix:true,OutUnit:'박스'};
const rawDay={...master,ProdKey:101,SdetailKey:21,SdateKey:31,ShipmentDate:'2026-09-21',ShipmentTimestamp:'2026-09-21 00:00:00.000',WeekDay:2,ShipmentQuantity:5,EstimateQuantity:80,DetailFixed:1,Cost:1000,Amount:72727,Vat:7273};
let detailFixture=[detail],masterFixture=[master],calls=[];
globalThis.__weekdayCompareFixture={
  sql:{Int:'Int',NVarChar:size=>`NVarChar(${size})`},withAuth:handler=>handler,
  filterWeekdayCompareRows,normalizeWeekdayCompareRequest,normalizeWeekdayUnit,WEEKDAY_ORDER_OUT_QUANTITY_SQL,weekdaySnapshotDigest,
  weekdayDetailCustomerMatchesMaster,WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL,
  query:async(statement,params)=>{
    calls.push(statement);
    assert.doesNotMatch(statement,/\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|MERGE)\b/i);
    if(!statement.includes('FROM Product WHERE')) {assert.equal(params.year.value,2026);assert.equal(params.custKey.value,7);}
    let rows=[];
    if(statement.includes('FROM OrderMaster')) rows=[{...master,ProdKey:101,OrderOutQuantity:5}];
    else if(statement.includes('FROM ShipmentHistory')) rows=[];
    else if(statement.includes('JOIN ShipmentDate')) rows=detailFixture.length ? [rawDay,{...rawDay,OrderYear:'2025',ShipmentQuantity:999}] : [];
    else if(statement.includes('FROM ShipmentMaster') && statement.includes('JOIN ShipmentDetail')) rows=[...detailFixture,{...detail,OrderYear:'2025',OutQuantity:999}];
    else if(statement.includes('FROM ShipmentMaster')) rows=[...masterFixture,{...master,OrderYear:'2025',ShipmentKey:999}];
    else if(statement.includes('FROM Product WHERE')) rows=[product];
    else assert.match(statement,/FROM WarehouseMaster/);
    return {recordset:rows};
  },
};
const executable=`const {query,sql,withAuth,filterWeekdayCompareRows,normalizeWeekdayCompareRequest,normalizeWeekdayUnit,WEEKDAY_ORDER_OUT_QUANTITY_SQL,weekdaySnapshotDigest,weekdayDetailCustomerMatchesMaster,WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL}=globalThis.__weekdayCompareFixture;\n${compareApi.replace(/^import[^\n]*\n/gm,'')}`;
const {default:handler}=await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`);
async function invoke(){
  let code=200,body;
  const res={setHeader(){},status(value){code=value;return this;},json(value){body=value;return this;},end(){return this;}};
  await handler({method:'POST',body:{year:2026,custKey:7,orderWeeks:['38-02'],prodKeys:[101]}},res);
  assert.equal(code,200);assert.equal(body.success,true);assert.equal(body.readOnly,true);
  assert.equal(body.rows.length,1);return body.rows[0];
}
const positive=await invoke();
assert.deepEqual(positive.packaging,{bunchOf1Box:16,steamOf1Bunch:1,steamOf1Box:16},'existing Product SELECT metadata only; no ERP conversion or writes');
assert.equal(positive.shipmentOutQuantity,5);assert.equal(positive.fixed,true);
assert.equal(positive.detailRows,1);assert.equal(calls.length,7,'bulk reads, not one query per product/week');
assert.equal(positive.snapshotDigest,weekdaySnapshotDigest({year:'2026',orderWeek:'38-02',custKey:7,prodKey:101},{detailRows:1,shipmentOutQuantity:5,shipmentDates:positive.shipmentDates,master,detail,product}));
const firstDigest=positive.snapshotDigest;
detailFixture=[{...detail,DetailCost:1001}];
assert.notEqual((await invoke()).snapshotDigest,firstDigest,'detail-only price change must invalidate snapshot');
detailFixture=[detail];masterFixture=[{...master,MasterIsFix:false}];
assert.notEqual((await invoke()).snapshotDigest,firstDigest,'master-only fix change must invalidate snapshot');
masterFixture=[master];product.BunchOf1Box=20;
assert.notEqual((await invoke()).snapshotDigest,firstDigest,'product-only conversion change must invalidate snapshot');
product.BunchOf1Box=16;
// Native EXE rows may leave ShipmentDetail.CustKey NULL. Display/quantity/fix
// behavior stays identical to the exact-key row, while the digest keeps NULL.
detailFixture=[{...detail,DetailCustKey:null}];
const nativeNull=await invoke();
assert.equal(nativeNull.shipmentOutQuantity,positive.shipmentOutQuantity,JSON.stringify(nativeNull));
assert.equal(nativeNull.fixed,positive.fixed);
assert.equal(nativeNull.detailRows,positive.detailRows);
assert.equal(nativeNull.customerLinkError,'');
assert.equal(nativeNull.snapshotDigest,weekdaySnapshotDigest({year:'2026',orderWeek:'38-02',custKey:7,prodKey:101},
  {detailRows:1,shipmentOutQuantity:5,shipmentDates:nativeNull.shipmentDates,master,
    detail:{...detail,CustKey:null},product}),'compare digest uses the raw locked NULL detail key');
assert.notEqual(nativeNull.snapshotDigest,positive.snapshotDigest,'raw NULL remains distinct from a keyed detail in the lock-bound snapshot');
for(const invalidKey of [0,8]) {
  detailFixture=[{...detail,DetailCustKey:invalidKey}];
  const invalid=await invoke();
  assert.ok(invalid.customerLinkError,`invalid detail key ${invalidKey} is visible as a link error`);
  assert.equal(invalid.snapshotDigest,null,`invalid detail key ${invalidKey} cannot mint a write digest`);
  assert.equal(invalid.fixed,true,'ERP detail isFix remains independent from the link warning');
}
detailFixture=[detail];
detailFixture=[{...detail,DetailIsFix:false},{...detail,SdetailKey:22}];
const mixed=await invoke();assert.equal(mixed.fixed,'mixed');assert.equal(mixed.state,'MIXED_FIX_REVIEW_REQUIRED');assert.equal(mixed.snapshotDigest,null);
detailFixture=[detail];masterFixture=[master,{...master,ShipmentKey:12}];
assert.equal((await invoke()).snapshotDigest,null,'ambiguous masters must not issue a save digest');
masterFixture=[];assert.equal((await invoke()).snapshotDigest,null,'missing master must not issue a save digest');
masterFixture=[master];detailFixture=[];
const missingDetail=await invoke();assert.equal(missingDetail.state,'NO_SHIPMENT');assert.match(missingDetail.snapshotDigest,/^[0-9a-f]{64}$/);
delete globalThis.__weekdayCompareFixture;
console.log('weekdayEstimateCompare tests passed');
