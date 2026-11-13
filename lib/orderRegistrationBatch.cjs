'use strict';

// Validated personal/sales/import items have unique positive integer ProdKey.
// Keep small, mixed, historical and correction orders on their existing path.
function eligible(items) {
  return items.length >= 4 && items.length <= 2000 && items.every(item =>
    Number.isInteger(item.prodKey) && item.prodKey > 0 && item.prodKey <= 2147483647 &&
    Number.isFinite(item.qty) && item.qty > 0 && item.expectedCurrentQty === 0
  ) && new Set(items.map(item => item.prodKey)).size === items.length;
}

async function prepare(tQuery, sql, scope, items, calculate) {
  if (!eligible(items)) return null;
  const result = await tQuery(`
    DECLARE @keys TABLE (ProdKey int PRIMARY KEY);
    INSERT @keys SELECT CONVERT(int,value) FROM OPENJSON(@keysJson);
    SELECT p.ProdKey, p.ProdName, p.FlowerName, p.OutUnit, p.EstUnit, p.CounName,
           ISNULL(p.Descr,'') AS ProdDescr, ISNULL(p.BunchOf1Box,0) AS B1B,
           ISNULL(p.SteamOf1Box,0) AS S1B, ISNULL(p.SteamOf1Bunch,0) AS SteamOf1Bunch
      FROM Product p WITH (HOLDLOCK) JOIN @keys k ON k.ProdKey=p.ProdKey WHERE p.isDeleted=0;
    -- Protect both the source scope and hidden rows on the selected header.
    SELECT TOP 1 1 AS ExistingRow
      FROM OrderMaster om WITH (UPDLOCK,HOLDLOCK)
      JOIN OrderDetail od WITH (UPDLOCK,HOLDLOCK) ON od.OrderMasterKey=om.OrderMasterKey
      JOIN @keys k ON k.ProdKey=od.ProdKey
     WHERE om.CustKey=@ck AND om.OrderYear=@year AND om.OrderWeek=@wk
       AND (om.OrderMasterKey=@mk OR (ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0));`, {
    mk: {type:sql.Int,value:scope.master}, ck:{type:sql.Int,value:scope.customer},
    year:{type:sql.NVarChar,value:scope.year}, wk:{type:sql.NVarChar,value:scope.week},
    keysJson:{type:sql.NVarChar(sql.MAX),value:JSON.stringify(items.map(item=>item.prodKey))}
  });
  if (!Array.isArray(result.recordsets?.[1])) throw Error('주문 상세 잠금 조회 결과가 없습니다.');
  const products = new Map(result.recordsets[0].map(row=>[row.ProdKey,row]));
  if (result.recordsets[1].length || products.size !== items.length) return null;
  const lines = items.map(item=>calculate(item,products.get(item.prodKey)));
  return lines.every(line => line && Object.values(line.values).every(value =>
    typeof value !== 'number' || Number.isFinite(value))) ? lines : null;
}

async function insert(tQuery, sql, scope, lines) {
  const payload=lines.map((line,ord)=>({ord, ...line.values}));
  const result = await tQuery(`
    SET NOCOUNT ON;
    DECLARE @lines TABLE (Ord int PRIMARY KEY, ProdKey int UNIQUE, Box float, Bunch float,
      Steam float, Qty float, Est float, Descr nvarchar(max));
    INSERT @lines SELECT * FROM OPENJSON(@json) WITH (Ord int '$.ord', ProdKey int '$.pk',
      Box float '$.box', Bunch float '$.bunch', Steam float '$.steam', Qty float '$.oq',
      Est float '$.est', Descr nvarchar(max) '$.descr');
    DECLARE @base int;
    SELECT @base=ISNULL(MAX(OrderDetailKey),0) FROM OrderDetail WITH (UPDLOCK,HOLDLOCK);
    INSERT INTO OrderDetail (OrderDetailKey,OrderMasterKey,ProdKey,BoxQuantity,BunchQuantity,
      SteamQuantity,OutQuantity,EstQuantity,NoneOutQuantity,${scope.hasDescr?'Descr,':''}isDeleted,CreateID,CreateDtm)
      SELECT @base+Ord+1,@mk,ProdKey,Box,Bunch,Steam,Qty,Est,0,${scope.hasDescr?'Descr,':''}0,N'admin',GETDATE() FROM @lines;
    INSERT INTO OrderHistory (OrderDetailKey,ChangeType,ColumName,BeforeValue,AfterValue,Descr,ChangeID,ChangeDtm)
      SELECT @base+Ord+1,N'수정',N'수량',0,Qty,@history,@uid,GETDATE() FROM @lines;
    SELECT Ord,ProdKey,@base+Ord+1 AS OrderDetailKey FROM @lines ORDER BY Ord;`, {
    json:{type:sql.NVarChar(sql.MAX),value:JSON.stringify(payload)}, mk:{type:sql.Int,value:scope.master},
    history:{type:sql.NVarChar,value:scope.history}, uid:{type:sql.NVarChar,value:scope.uid}
  });
  const inserted=result.recordset;
  if(inserted.length!==lines.length||inserted.some((r,i)=>r.Ord!==i||r.ProdKey!==lines[i].values.pk||!Number.isInteger(r.OrderDetailKey))) throw Error('신규 주문 상세 키 대조 실패');
  return inserted.map((row,i)=>({...lines[i].response,orderDetailKey:row.OrderDetailKey}));
}

async function verify(tQuery,sql,{orderYear,orderWeek,custKey},keys) {
  const r=await tQuery(`
    DECLARE @keys TABLE(ProdKey int PRIMARY KEY);
    INSERT @keys SELECT CONVERT(int,value) FROM OPENJSON(@keysJson);
    WITH rawOrders AS (
      SELECT od.ProdKey,COUNT(*) AS RecordCount,SUM(ISNULL(od.OutQuantity,0)) AS Qty
        FROM OrderMaster om JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey
        JOIN @keys k ON k.ProdKey=od.ProdKey
       WHERE om.OrderYear=@yr AND om.OrderWeek=@wk AND om.CustKey=@ck
         AND ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0 GROUP BY od.ProdKey
    ), visibleOrders AS (
      SELECT vo.ProdKey,COUNT(*) AS RecordCount,SUM(ISNULL(vo.OutQuantity,0)) AS Qty
        FROM ViewOrder vo JOIN @keys k ON k.ProdKey=vo.ProdKey
       WHERE vo.OrderYear=@yr AND vo.OrderWeek=@wk AND vo.CustKey=@ck GROUP BY vo.ProdKey
    )
    SELECT k.ProdKey,ISNULL(r.RecordCount,0) AS RawOrderCount,ISNULL(r.Qty,0) AS RawOrderQty,
           ISNULL(v.RecordCount,0) AS ViewOrderCount,ISNULL(v.Qty,0) AS ViewOrderQty
      FROM @keys k LEFT JOIN rawOrders r ON r.ProdKey=k.ProdKey LEFT JOIN visibleOrders v ON v.ProdKey=k.ProdKey;`, {
    yr:{type:sql.NVarChar,value:orderYear},wk:{type:sql.NVarChar,value:orderWeek},
    ck:{type:sql.Int,value:Number(custKey)},keysJson:{type:sql.NVarChar(sql.MAX),value:JSON.stringify(keys)}
  });
  const facts=new Map(r.recordset.map(row=>[row.ProdKey,row]));
  if(facts.size!==keys.length||!keys.every(key=>facts.has(key))) throw Error('주문 전산 검증 결과 누락');
  return facts;
}

// OrderHistory is transactional. AppLog is a separate, best-effort diagnostic sink.
async function flushDiagnostics(query, sql, diagnostics) {
  if (!diagnostics.length) return;
  const now = Date.now();
  const entries = diagnostics.splice(0).map(({ at, ...entry }) => ({
    ...entry, ageMs: Math.max(0, Math.min(2147483647, now - at)),
  }));
  try {
    await query(`INSERT INTO AppLog (Category, Step, Detail, IsError, LogDtm)
      SELECT TOP (2147483647) e.Category, e.Step, e.Detail, e.IsError, DATEADD(ms,-e.AgeMs,GETDATE())
      FROM OPENJSON(@logs) j CROSS APPLY OPENJSON(j.value) WITH (
        Category nvarchar(max) '$.category', Step nvarchar(max) '$.step', Detail nvarchar(max) '$.detail',
        IsError bit '$.isError', AgeMs int '$.ageMs'
      ) e ORDER BY CONVERT(int,j.[key])`, {
      logs: { type: sql.NVarChar(sql.MAX), value: JSON.stringify(entries) },
    });
  } catch { /* AppLog is optional in older installations. */ }
}

module.exports = { prepare, insert, verify, flushDiagnostics };
