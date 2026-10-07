-- 입고 통합 저장 설계의 운영 근거 확인. SELECT만 실행하며 원장을 수정하지 않는다.
-- 실제 Nenova DB를 선택한 연결에서 실행한다. DB명/접속정보/비밀번호를 파일에 넣지 않는다.
-- definition=NULL이면 원문 없음으로 추정하지 말고 VIEW DEFINITION 권한 부족 여부를 확인한다.
SELECT DB_NAME() AS databaseName,
  HAS_PERMS_BY_NAME(DB_NAME(),N'DATABASE',N'VIEW DEFINITION') AS canViewDefinition;

SELECT o.name, o.type_desc, m.definition
FROM sys.objects o
LEFT JOIN sys.sql_modules m ON m.object_id=o.object_id
WHERE o.name IN (N'usp_CreateWarehouse',N'usp_StockCalculation',N'ViewWarehouse',N'ViewOrder',
  N'usp_ProductStockUpdate');

SELECT OBJECT_NAME(t.parent_id) AS parentTable,t.name,t.is_disabled,m.definition
FROM sys.triggers t
LEFT JOIN sys.sql_modules m ON m.object_id=t.object_id
WHERE t.parent_id IN (OBJECT_ID(N'dbo.WarehouseMaster'),OBJECT_ID(N'dbo.WarehouseDetail'),
  OBJECT_ID(N'dbo.TempWarehouseDetail'),OBJECT_ID(N'dbo.Product'),OBJECT_ID(N'dbo.StockHistory'));

SELECT OBJECT_NAME(c.object_id) AS tableName,c.name,TYPE_NAME(c.user_type_id) AS dataType,
  c.max_length,c.precision,c.scale,c.is_nullable,c.is_identity
FROM sys.columns c
WHERE c.object_id IN (OBJECT_ID(N'dbo.WarehouseMaster'),OBJECT_ID(N'dbo.WarehouseDetail'),
  OBJECT_ID(N'dbo.TempWarehouseDetail'),OBJECT_ID(N'dbo.StockHistory'))
ORDER BY tableName,c.column_id;

-- 신규 웹 문서 저장 구조와 기존 원가 연결을 결정하기 위한 읽기 전용 스키마.
SELECT OBJECT_NAME(c.object_id) AS tableName,c.name,TYPE_NAME(c.user_type_id) AS dataType,
  c.max_length,c.precision,c.scale,c.is_nullable,c.is_identity
FROM sys.columns c
WHERE c.object_id IN (OBJECT_ID(N'dbo.FreightCost'),OBJECT_ID(N'dbo.FreightCostDetail'),
  OBJECT_ID(N'dbo.WebArrivalCostImport'),OBJECT_ID(N'dbo.WebArrivalCostLine'),
  OBJECT_ID(N'dbo.WebArrivalCostHistory'))
ORDER BY tableName,c.column_id;

SELECT OBJECT_NAME(i.object_id) AS tableName,i.name,i.is_unique,i.filter_definition,
  c.name AS columnName,ic.key_ordinal
FROM sys.indexes i
JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
WHERE i.object_id IN (OBJECT_ID(N'dbo.WarehouseMaster'),OBJECT_ID(N'dbo.TempWarehouseDetail'),
  OBJECT_ID(N'dbo.FreightCost'),OBJECT_ID(N'dbo.WebArrivalCostLine'))
ORDER BY tableName,i.name,ic.key_ordinal;

SELECT wm.OrderYear,wm.OrderWeek,COUNT(DISTINCT wm.WarehouseKey) AS invoiceCount,
  COUNT(wd.WdetailKey) AS detailCount
FROM dbo.WarehouseMaster wm
LEFT JOIN dbo.WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
WHERE ISNULL(wm.isDeleted,0)=0 AND wm.OrderYear IN (N'2025',N'2026')
  AND wm.OrderWeek IN (N'40-01',N'41-01',N'41-02')
GROUP BY wm.OrderYear,wm.OrderWeek ORDER BY wm.OrderYear,wm.OrderWeek;

SELECT TOP (20) wm.WarehouseKey,wm.OrderYear,wm.OrderWeek,wd.WdetailKey,wd.ProdKey,
  p.OutUnit,p.EstUnit,wd.BoxQuantity,wd.BunchQuantity,wd.SteamQuantity,
  wd.OutQuantity,wd.EstQuantity,wd.UPrice,wd.TPrice
FROM dbo.WarehouseMaster wm
JOIN dbo.WarehouseDetail wd ON wd.WarehouseKey=wm.WarehouseKey
JOIN dbo.Product p ON p.ProdKey=wd.ProdKey
WHERE ISNULL(wm.isDeleted,0)=0 AND wm.OrderYear=N'2026' AND wm.OrderWeek=N'41-02'
ORDER BY wm.WarehouseKey DESC,wd.WdetailKey;
