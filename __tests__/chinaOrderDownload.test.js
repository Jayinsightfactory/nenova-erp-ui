import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeChinaCenter,buildChinaCycleCatalog,selectChinaCycles,buildChinaOrderReport,buildChinaOrdersSql,buildChinaHiddenOrdersSql} from '../lib/chinaOrderDownload.js';
export const periods=['202551','202552','202553','202601','202602','202603','202604','202605'].map((OrderYearWeek,i)=>({OrderYearWeek,WeekDay:5,BaseYmd:new Date(Date.UTC(2025,11,11+i*7)).toISOString().slice(0,10)}));
const selection=selectChinaCycles(buildChinaCycleCatalog(periods),{year:2026,majorWeek:'01'},'2026-01-01');
const order=(x={})=>({orderYear:2026,orderWeek:'01-01',custKey:1,custName:'업체',prodKey:9,prodCode:'0009',prodName:'품목',flower:'기타',country:'중국',unit:'단',quantity:16,...x});
const response=(orders)=>({success:true,readOnly:true,...selection,orders,queriedAt:'2026-01-01T00:00:00Z'});
test('explicit center accepts only complete valid pair',()=>{
 assert.equal(normalizeChinaCenter({}),null);assert.deepEqual(normalizeChinaCenter({year:'2026',majorWeek:'1'}),{year:2026,majorWeek:'01'});
 for(const value of [{year:2026},{majorWeek:1},{year:['2026'],majorWeek:1},{year:2026,majorWeek:'01-01'},{year:2026,majorWeek:54}])assert.throws(()=>normalizeChinaCenter(value));
});
test('seven cycles retain authoritative 53-week year boundary and offsets',()=>{
 assert.deepEqual(selection.cycles.map(c=>c.key),['202551','202552','202553','202601','202602','202603','202604']);
 assert.deepEqual(selection.cycles.map(c=>c.offset),[-3,-2,-1,0,1,2,3]);
 assert.deepEqual(selectChinaCycles(buildChinaCycleCatalog(periods),null,'2026-01-06').scope,{year:2026,majorWeek:'01'});
});
test('missing duplicate discontinuous calendar never produces partial cycles',()=>{
 assert.throws(()=>buildChinaCycleCatalog([...periods,periods[3]]));
 assert.throws(()=>buildChinaCycleCatalog([{...periods[3],BaseYmd:'2026-01-02'}]));
 assert.throws(()=>selectChinaCycles(buildChinaCycleCatalog(periods.filter((_,i)=>i!==1)),{year:2026,majorWeek:'01'},'2026-01-01'));
 assert.throws(()=>selectChinaCycles(buildChinaCycleCatalog(periods),{year:2026,majorWeek:'53'},'2026-01-01'));
});
test('registered quantity only; duplicates aggregate, year and units stay separate',()=>{
 const report=buildChinaOrderReport(response([order(),order({custKey:2,quantity:32}),order({orderYear:2025,orderWeek:'53-02',quantity:5}),order({orderYear:2025,orderWeek:'01-01',quantity:1000}),order({country:'콜롬비아',quantity:1000}),order({unit:'박스',quantity:2}),order({quantity:0}),order({quantity:-2})]));
 assert.equal(report.rows.length,2);const bunch=report.rows.find(r=>r.unit==='단');
 assert.equal(bunch.quantities['202601'],48);assert.equal(bunch.quantities['202553'],5);assert.equal(bunch.total,53);
 assert.equal(report.totals.find(r=>r.unit==='박스').total,2);assert.equal(report.orders.length,4);
 assert.throws(()=>buildChinaOrderReport(response([order({unit:'개'})])));
 assert.throws(()=>buildChinaOrderReport(response([order({quantity:Infinity})])));
 assert.throws(()=>buildChinaOrderReport({...response([]),success:false}));
});
test('SQL is native read-only with year+major pair for every scope',()=>{
 const query=buildChinaOrdersSql(selection.cycles),hidden=buildChinaHiddenOrdersSql(selection.cycles);
 assert.match(query,/FROM ViewOrder v/);assert.match(query,/SUM\(v.OutQuantity\)/);assert.doesNotMatch(query,/Shipment|StockList|BoxQuantity|BunchQuantity|SteamQuantity|UPDATE|INSERT|DELETE|EXEC|CREATE|ALTER/);
 assert.match(query,/CounName=N'중국'/);assert.match(query,/GROUP BY v.OrderYear,v.OrderWeek,v.CustKey/);
 assert.match(query,/c.OrderCode AS CustOrderCode/);assert.doesNotMatch(query,/v.OrderCode|c.CustCode/);
 for(let i=0;i<7;i++){assert.ok(query.includes(`v.OrderYear=@year${i} AND v.OrderWeek LIKE @week${i}`));assert.ok(hidden.includes(`om.OrderYear=@year${i} AND om.OrderWeek LIKE @week${i}`));}
 assert.match(hidden,/NOT EXISTS\(SELECT 1 FROM ViewOrder/);assert.doesNotMatch(hidden,/UPDATE|INSERT|DELETE|EXEC|CREATE|ALTER/);
});
