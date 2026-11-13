import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { classifyReceipt, investigationSql } from '../lib/warehouseStockInvestigation.js';

test('active receipts, deleted uploads, missing evidence and prior-year reuse',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE Product(ProdKey int,ProdName text,OutUnit text);
    CREATE TABLE WarehouseMaster(WarehouseKey int,OrderYear text,OrderWeek text,isDeleted int);
    CREATE TABLE WarehouseDetail(WarehouseKey int,ProdKey int,OutQuantity real);
    CREATE TABLE StockHistory(OrderYear text,OrderWeek text,ProdKey int,ChangeType text,BeforeValue real,AfterValue real,ChangeDtm text);
    INSERT INTO Product VALUES(1,'Rose','단'),(2,'Other','박스');
    INSERT INTO WarehouseMaster VALUES(1,'2026','27-01',1),(2,'2026','27-01',0),(3,'2025','27-01',0);
    INSERT INTO WarehouseDetail VALUES(1,1,20),(2,1,10),(2,2,1),(3,1,900);
    INSERT INTO StockHistory VALUES('2026','27-01',1,'입고',0,30,'2026-06-29'),('2025','27-01',1,'입고',0,900,'2025-06-30');`);
  const sql=investigationSql.replaceAll('ISNULL(','IFNULL(').replaceAll('COUNT_BIG','COUNT').replaceAll("N'","'").replace('CONVERT(varchar(19),h.lastEvent,120)','h.lastEvent');
  const run=()=>db.prepare(sql).all({year:'2026'}).map(classifyReceipt);
  assert.equal(run().find(r=>r.prodKey===1).correction,-20);
  assert.equal(run().find(r=>r.prodKey===2).correction,null);
  db.exec("INSERT INTO StockHistory VALUES('2026','27-01',1,'입고',30,10,'2026-06-30')");
  assert.deepEqual(run().map(r=>r.prodKey),[2]);
  db.close();
});
