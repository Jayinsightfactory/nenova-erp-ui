#!/usr/bin/env node
// Isolated inspected loopback MSSQL only. No app environment or operational DB writes.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const sql=require('mssql'),fixture=require('./test-weekday-distribution-sql.cjs');
// Exact original correlated SELECT preserved from origin/master d9b4c94622d932e5d45a21813772dcf1d8f629b5
// pages/api/shipment/estimate-visibility.js. Keep as an independent oracle.
const originalSql=wkIn=>`SELECT TOP 400
              c.CustName, p.ProdName, p.CounName, p.FlowerName,
              sm.CustKey, sd.ProdKey, sm.OrderWeek,
              ISNULL(sm.isFix,0) AS SmFix, sd.OutQuantity, sd.EstQuantity, sd.SdetailKey,
              CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120) AS ShipDtm,
              -- 실제 전산 뷰에 존재하는지 (해당 업체+품목+주차)
              (SELECT COUNT(*) FROM ViewShipment vs WHERE vs.OrderYear=sm.OrderYear AND vs.CustKey=sm.CustKey AND vs.ProdKey=sd.ProdKey AND vs.OrderWeek=sm.OrderWeek) AS InViewShipment,
              (SELECT COUNT(*) FROM ViewOrder   vo WHERE vo.OrderYear=sm.OrderYear AND vo.CustKey=sm.CustKey AND vo.ProdKey=sd.ProdKey AND vo.OrderWeek=sm.OrderWeek) AS InViewOrder,
              -- 주문 라인 원본 존재(뷰 필터 무시) → '주문 자체 없음' vs '주문은 있는데 뷰에서 탈락' 구분
              (SELECT COUNT(*) FROM OrderMaster om JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey
                 WHERE om.OrderYear=sm.OrderYear AND om.CustKey=sm.CustKey AND om.OrderWeek=sm.OrderWeek AND od.ProdKey=sd.ProdKey
                   AND ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0) AS OrderDetailRaw,
              (SELECT COUNT(*) FROM ShipmentDate sdt WHERE sdt.SdetailKey=sd.SdetailKey) AS ShipDateCnt,
              (SELECT COUNT(*) FROM ShipmentDate sdt JOIN PeriodDay pd ON pd.BaseYmd=sdt.ShipmentDtm WHERE sdt.SdetailKey=sd.SdetailKey) AS PeriodExactCnt,
              (SELECT COUNT(*) FROM ShipmentDate sdt JOIN PeriodDay pd ON CONVERT(date,pd.BaseYmd)=CONVERT(date,sdt.ShipmentDtm) WHERE sdt.SdetailKey=sd.SdetailKey) AS PeriodDateCnt,
              (SELECT TOP 1 CONVERT(NVARCHAR(30), sdt.ShipmentDtm, 121) FROM ShipmentDate sdt WHERE sdt.SdetailKey=sd.SdetailKey) AS ShipDateRaw,
              ISNULL(sm.WebCreated,0) AS WebCreated, sm.OrderYearWeek AS SmYW, sm.OrderYear AS SmYear,
              (SELECT TOP 1 vs.OrderYearWeek2 FROM ViewShipment vs WHERE vs.OrderYear=sm.OrderYear AND vs.SdetailKey=sd.SdetailKey) AS VS_YW2,
              -- 실제 GetDetail 조인(ViewShipment⨝ViewOrder⨝ShipmentDate⨝PeriodDay)을 이 SdetailKey 로 그대로 재현
              (SELECT COUNT(*)
                 FROM ViewShipment vs
                 JOIN ViewOrder vo ON vs.OrderYearWeek2 = vo.OrderYearWeek2
                 JOIN ShipmentDate sdd ON sdd.SdetailKey = vs.SdetailKey
                 JOIN PeriodDay pd ON sdd.ShipmentDtm = pd.BaseYmd
                WHERE vs.SdetailKey = sd.SdetailKey
                  AND vs.DetailFix = 1) AS InGetDetail,
              (SELECT COUNT(*)
                 FROM ViewShipment vs
                 JOIN ViewOrder vo ON vs.OrderYearWeek2 = vo.OrderYearWeek2
                  AND vs.CustKey = vo.CustKey
                  AND vs.ProdKey = vo.ProdKey
                 JOIN ShipmentDate sdd ON sdd.SdetailKey = vs.SdetailKey
                 JOIN PeriodDay pd ON sdd.ShipmentDtm = pd.BaseYmd
                WHERE vs.SdetailKey = sd.SdetailKey
                  AND vs.DetailFix = 1) AS InGetDetailByCustProd,
              -- 전산 구조 위반: 같은 출고+거래처+품목에 ShipmentDetail 이 2건 이상(웹 splitDateDetails 잔재)
              (SELECT COUNT(*)
                 FROM ShipmentDetail z
                WHERE z.ShipmentKey = sm.ShipmentKey
                  AND z.CustKey = sm.CustKey
                  AND z.ProdKey = sd.ProdKey) AS DetailSplitCnt
         FROM ShipmentMaster sm
         JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
         JOIN Product p ON p.ProdKey=sd.ProdKey
         JOIN Customer c ON c.CustKey=sm.CustKey
        WHERE sm.OrderYear=@yr AND sm.OrderWeek IN (${wkIn}) AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)<>0
          AND ( p.ProdName LIKE @q OR ISNULL(p.CounName,'') LIKE @q
                OR ISNULL(p.FlowerName,'') LIKE @q OR c.CustName LIKE @q )
        ORDER BY p.ProdName, sm.OrderWeek, c.CustName`;

async function seedCases(pool) {
  await fixture.query(pool,`
    INSERT Customer(CustKey,CustName) VALUES(534,N'Fixture Other Cust');
    INSERT Product(ProdKey,ProdName,CountryFlower,CounName,FlowerName,OutUnit,EstUnit,BunchOf1Box,SteamOf1Bunch,SteamOf1Box,Cost,Stock)
      SELECT 867,N'Fixture Rose',CountryFlower,CounName,FlowerName,OutUnit,EstUnit,BunchOf1Box,SteamOf1Bunch,SteamOf1Box,Cost,Stock FROM Product WHERE ProdKey=866;
    INSERT OrderMaster(OrderMasterKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,Manager,isDeleted)
      VALUES(8001,N'2026',N'37-01',N'202637',534,N'fixture-user',0),
        (8002,N'2025',N'37-01',N'202537',533,N'fixture-user',0),
        (8003,N'2026',N'37-01',N'202637',533,N'fixture-user',0),
        (8004,N'2026',N'37-01',N'202637',533,N'fixture-user',1);
    INSERT OrderDetail(OrderDetailKey,OrderMasterKey,CustKey,ProdKey,OutQuantity,OrderQuantity,isDeleted)
      VALUES(8000,3701,533,866,2,2,0),(8001,8001,534,866,6,6,0),
        (8002,8002,533,866,7,7,0),(8003,8003,533,867,4,4,0),
        (8004,8004,533,866,99,99,0),(8005,3701,533,866,99,99,1);
    INSERT ShipmentMaster(ShipmentKey,OrderYear,OrderWeek,OrderYearWeek,CustKey,isFix,isDeleted,WebCreated)
      VALUES(8001,N'2026',N'37-01',N'202637',534,1,0,0),
        (8002,N'2025',N'37-01',N'202537',533,1,0,0),
        (8003,N'2026',N'37-02',N'202637',533,1,0,0),
        (8004,N'2026',N'37-01',N'202637',533,1,1,0);
    UPDATE ShipmentDetail SET CustKey=NULL WHERE SdetailKey=89892;
    INSERT ShipmentDetail(SdetailKey,ShipmentKey,CustKey,ProdKey,ShipmentDtm,OutQuantity,
      BoxQuantity,BunchQuantity,SteamQuantity,EstQuantity,Cost,Amount,Vat,isFix)
    SELECT v.sdk,v.sk,v.ck,v.pk,CONVERT(datetime,v.dt,121),v.qty,v.qty,v.qty*30,v.qty*30,v.qty*30,2500,0,0,v.fix
    FROM (VALUES
      (90001,6266,533,866,N'2026-09-10 00:00:00.000',2,1),
      (90002,6266,533,866,N'2026-09-11 12:34:00.000',3,1),
      (90003,6266,533,867,N'2026-09-10 00:00:00.000',4,0),
      (90004,8001,534,866,N'2026-09-10 00:00:00.000',6,1),
      (90005,8002,533,866,N'2025-09-10 00:00:00.000',7,1),
      (90006,8003,533,866,N'2026-09-15 00:00:00.000',8,1),
      (90007,8004,533,866,N'2026-09-10 00:00:00.000',99,1),
      (90008,6266,533,867,N'2026-09-10 00:00:00.000',0,1)
    )v(sdk,sk,ck,pk,dt,qty,fix);
    INSERT ShipmentDate(SdateKey,SdetailKey,ShipmentDtm,ShipmentQuantity,EstQuantity,Cost,Amount,Vat,Descr)
      SELECT 120000+SdetailKey,SdetailKey,ShipmentDtm,OutQuantity,EstQuantity,Cost,Amount,Vat,N'visibility fixture'
      FROM ShipmentDetail WHERE SdetailKey>=90001;
    INSERT PeriodDay(PeriodDayKey,OrderYearWeek,BaseYmd,WeekDay)
      VALUES(20,N'202637',N'2026-09-10',5),(21,N'202537',N'2025-09-10',5);
  `);
}
const byKey=rows=>[...rows].sort((a,b)=>a.SdetailKey-b.SdetailKey);
const ordering=rows=>rows.map(row=>[row.ProdName,row.OrderWeek,row.CustName]);
async function main() {
  for(const key of ['DB_SERVER','DB_PORT','DB_NAME','DB_USER','DB_PASSWORD']) assert.ok(!process.env[key],'Operational environment forbidden');
  const approved=fixture.inspectFixture();
  const name=`NenovaEstimateFixture_${new Date().toISOString().slice(0,10).replace(/-/g,'')}_${crypto.randomBytes(4).toString('hex')}`;
  fixture.assertDbName(name);
  const config={user:'sa',password:approved.password,server:'127.0.0.1',port:14339,
    options:{encrypt:false,trustServerCertificate:true},requestTimeout:60000,pool:{max:4,min:0}};
  let master,pool;
  try {
    master=await new sql.ConnectionPool({...config,database:'master'}).connect();
    await fixture.query(master,`CREATE DATABASE ${fixture.bracket(name)}`);
    await fixture.query(master,`ALTER DATABASE ${fixture.bracket(name)} SET COMPATIBILITY_LEVEL=130`);
    pool=await new sql.ConnectionPool({...config,database:name}).connect();
    await fixture.installSchema(pool);await fixture.seed(pool);await seedCases(pool);
    const {readEstimateVisibility}=await import(pathToFileURL(path.resolve(__dirname,'../lib/estimateVisibilityRead.js')).href);
    const query=(statement,params)=>fixture.query(pool,statement,params);
    const cases=[{year:'2026',weeks:['37-01','37-02'],q:'Fixture'},
      {year:'2025',weeks:['37-01'],q:'Fixture'},
      {year:'2026',weeks:['37-01'],q:'Other Cust'},
      {year:'2026',weeks:['37-01'],q:'Rose'},
      {year:'2026',weeks:['37-01'],q:'Missing search'},
      {year:'2026',weeks:['37-02','37-01','37-01'],q:'Fixture'}];
    for(const scope of cases) {
      const params={yr:{type:sql.NVarChar,value:scope.year},q:{type:sql.NVarChar,value:`%${scope.q}%`}};
      scope.weeks.forEach((week,index)=>{params[`w${index}`]={type:sql.NVarChar,value:week};});
      const original=(await query(originalSql(scope.weeks.map((_,i)=>`@w${i}`).join(',')),params)).recordset;
      const current=(await readEstimateVisibility(query,sql,scope)).recordset;
      assert.deepEqual(byKey(current),byKey(original),'all original raw columns and row multiplicities remain equal');
      assert.deepEqual(ordering(current),ordering(original),'specified ProdName/week/customer ordering is preserved (ties have no original ordering contract)');
      if(scope.year==='2026' && scope.q==='Fixture') {
        const source=current.find(row=>row.SdetailKey===89892),shifted=current.find(row=>row.SdetailKey===90002);
        assert.equal(source.InViewShipment,3,'null detail customer still joins through master');
        assert.equal(source.InViewOrder,2,'duplicate order rows count, deleted originals excluded');
        assert.equal(source.OrderDetailRaw,2);
        assert.equal(source.DetailSplitCnt,2,'split diagnostic retains its original detail customer predicate');
        assert.equal(source.PeriodExactCnt,3,'duplicate exact calendar joins preserve multiplicity');
        assert.equal(source.InGetDetail,12,'native broad join includes other customer/product order rows');
        assert.equal(source.InGetDetailByCustProd,6,'refined join preserves selected customer/product multiplicity');
        assert.equal(shifted.PeriodExactCnt,0);assert.equal(shifted.PeriodDateCnt,1);
        assert.equal(shifted.InGetDetail,0,'same calendar date at different timestamp does not print');
        assert.equal(current.find(row=>row.SdetailKey===90003).InGetDetail,0,'unfixed detail excluded from native print');
        assert.ok(!current.some(row=>[90005,90007,90008].includes(row.SdetailKey)),'prior year/deleted master/zero quantity excluded');
      }
      if(scope.year==='2025') assert.deepEqual(current.map(row=>row.SdetailKey),[90005]);
      console.log(`PASS original/new real SQL equal: year=${scope.year}, weeks=${scope.weeks.join(',')}, q=${scope.q}, rows=${current.length}`);
    }
    console.log('PASS estimate visibility isolated SQL equivalence');
  } finally {
    await pool?.close().catch(()=>{});
    if(master) await fixture.query(master,`IF DB_ID(N'${name}') IS NOT NULL BEGIN ALTER DATABASE ${fixture.bracket(name)} SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE ${fixture.bracket(name)}; END`).catch(()=>{});
    await master?.close().catch(()=>{});
  }
}
main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});

