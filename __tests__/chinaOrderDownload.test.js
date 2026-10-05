import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeChinaCenter,buildChinaCycleCatalog,selectChinaCycles,buildChinaOrderReport,selectChinaOrderSubweek,compareChinaSubweeks,buildChinaOrdersSql,buildChinaHiddenOrdersSql} from '../lib/chinaOrderDownload.js';
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
 assert.equal(bunch.quantities['2026/01-01'],48);assert.equal(bunch.quantities['2025/53-02'],5);assert.equal(bunch.total,53);
 assert.equal(report.totals.find(r=>r.unit==='박스').total,2);assert.equal(report.orders.length,4);
 assert.throws(()=>buildChinaOrderReport(response([order({unit:'개'})])));
 assert.throws(()=>buildChinaOrderReport(response([order({quantity:Infinity})])));
 assert.throws(()=>buildChinaOrderReport({...response([]),success:false}));
});
test('all actual subweeks have separate year-scoped columns and immutable totals',()=>{
 const report=buildChinaOrderReport(response([order({custOrderCode:'CL2'}),order({orderWeek:'01-02',quantity:32}),order({orderWeek:'01-03A',quantity:3}),order({orderYear:2025,orderWeek:'53-02',quantity:5}),order({orderWeek:'01-01',custKey:2,quantity:2})]));
 assert.equal(report.cycles.length,7);
 assert.deepEqual(report.columns.filter(c=>c.cycleKey==='202601').map(c=>c.orderWeek),['01-01','01-02','01-03A']);
 assert.equal(report.rows[0].quantities['2026/01-01'],18);
 assert.equal(report.rows[0].quantities['2026/01-02'],32);
 assert.equal(report.rows[0].quantities['2026/01-03A'],3);
 assert.equal(report.rows[0].quantities['2025/53-02'],5);
 assert.equal(report.rows[0].total,58);
 assert.equal(report.totals[0].total,58);
 assert.equal(report.orders[0].custOrderCode,'CL2');
 assert.equal(Object.values(report.rows[0].quantities).reduce((a,b)=>a+b,0),58);
 assert.equal(report.columns.find(c=>c.cycleKey==='202552').empty,true);
 assert.equal(report.columns.find(c=>c.cycleKey==='202552').orderWeek,null);
 assert.equal(report.columns.find(c=>c.cycleKey==='202552').label,'주문 없음');
 assert.equal(report.rows[0].quantities['202552/empty'],0);
 const filtered={...report,rows:[],orders:[],totals:[]};
 assert.deepEqual(filtered.columns,report.columns,'filtering must retain original dimensions');
});
test('empty report preserves seven calendar groups without inventing subweeks',()=>{
 const report=buildChinaOrderReport(response([]));
 assert.equal(report.columns.length,7);
 assert.ok(report.columns.every(c=>c.empty&&c.orderWeek===null));
 assert.equal(report.rows.length,0);assert.equal(report.orders.length,0);
});
test('single subweek lists customers and keeps CL identity, totals and unfiltered dimensions',()=>{
 const report=buildChinaOrderReport(response([order({custOrderCode:'CL2',custName:'업체 A'}),order({custKey:2,custOrderCode:'CL2',custName:'업체 B',quantity:32}),order({orderWeek:'01-02',quantity:5}),order({orderYear:2025,orderWeek:'53-02',quantity:7}),order({custKey:3,custOrderCode:'CLS',quantity:1,unit:'박스'})]));
 const selected=selectChinaOrderSubweek(report,'2026/01-01');
 assert.equal(selected.customerRows.length,3,'same CL does not merge distinct CustKey');
 assert.equal(selected.orders.length,3);
 assert.equal(selected.totals.find(r=>r.unit==='단').total,48);
 assert.equal(selected.totals.find(r=>r.unit==='박스').total,1);
 assert.equal(selected.rows.find(r=>r.unit==='단').quantities['2026/01-02'],0);
 assert.deepEqual(selected.columns,report.columns);
 assert.equal(selected.selectedColumnKey,'2026/01-01');
 const filtered=selectChinaOrderSubweek(report,'2026/01-01',new Set(['1|9|단']));
 assert.equal(filtered.customerRows.length,1);assert.equal(filtered.orders.length,1);assert.equal(filtered.rows[0].total,16);
 assert.deepEqual(filtered.columns,report.columns,'actual customer filter keeps all original dimensions');
 assert.deepEqual(selectChinaOrderSubweek(report,'2026/01-01',new Set()).rows,[]);
 assert.throws(()=>selectChinaOrderSubweek(report,'202552/empty'));
 assert.throws(()=>selectChinaOrderSubweek(report,'2025/01-01'));
 assert.deepEqual(['01-10','01-03B','01-03a','01-03','01-02','01-03A'].sort(compareChinaSubweeks),['01-02','01-03','01-03A','01-03B','01-03a','01-10']);
});
test('SQL is native read-only with year+major pair for every scope',()=>{
 const query=buildChinaOrdersSql(selection.cycles),hidden=buildChinaHiddenOrdersSql(selection.cycles);
 assert.match(query,/FROM ViewOrder v/);assert.match(query,/SUM\(v.OutQuantity\)/);assert.doesNotMatch(query,/Shipment|StockList|BoxQuantity|BunchQuantity|SteamQuantity|UPDATE|INSERT|DELETE|EXEC|CREATE|ALTER/);
 assert.match(query,/CounName=N'중국'/);assert.match(query,/GROUP BY v.OrderYear,v.OrderWeek,v.CustKey/);
 assert.match(query,/c.OrderCode AS CustOrderCode/);assert.doesNotMatch(query,/v.OrderCode|c.CustCode/);
 for(let i=0;i<7;i++){assert.ok(query.includes(`v.OrderYear=@year${i} AND v.OrderWeek LIKE @week${i}`));assert.ok(hidden.includes(`om.OrderYear=@year${i} AND om.OrderWeek LIKE @week${i}`));}
 assert.match(hidden,/NOT EXISTS\(SELECT 1 FROM ViewOrder/);assert.doesNotMatch(hidden,/UPDATE|INSERT|DELETE|EXEC|CREATE|ALTER/);
});
