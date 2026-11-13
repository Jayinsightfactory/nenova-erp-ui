// Compare receipt-unit quantities only within one ERP business year, week and product.
export const investigationSql = `
WITH receipts AS (
  SELECT m.OrderWeek week, d.ProdKey prodKey,
    SUM(CASE WHEN m.isDeleted=0 THEN ISNULL(d.OutQuantity,0) ELSE 0 END) activeQty,
    SUM(CASE WHEN m.isDeleted=1 THEN ISNULL(d.OutQuantity,0) ELSE 0 END) deletedQty
  FROM WarehouseMaster m JOIN WarehouseDetail d ON d.WarehouseKey=m.WarehouseKey
  WHERE m.OrderYear=@year AND d.ProdKey>0
  GROUP BY m.OrderWeek,d.ProdKey
), history AS (
  SELECT OrderWeek week, ProdKey prodKey, COUNT_BIG(*) events,
    SUM(AfterValue-BeforeValue) recordedQty,
    SUM(CASE WHEN BeforeValue IS NULL OR AfterValue IS NULL THEN 1 ELSE 0 END) incomplete,
    MAX(ChangeDtm) lastEvent
  FROM StockHistory WHERE OrderYear=@year AND ChangeType=N'입고' AND ProdKey>0
  GROUP BY OrderWeek,ProdKey
)
SELECT COALESCE(r.week,h.week) week,p.ProdKey prodKey,p.ProdName name,p.OutUnit unit,
  ROUND(ISNULL(r.activeQty,0),2) activeQty,ROUND(ISNULL(r.deletedQty,0),2) deletedQty,
  ROUND(h.recordedQty,2) recordedQty,ISNULL(h.events,0) events,ISNULL(h.incomplete,0) incomplete,
  CONVERT(varchar(19),h.lastEvent,120) lastEvent
FROM receipts r FULL JOIN history h ON r.week=h.week AND r.prodKey=h.prodKey
JOIN Product p ON p.ProdKey=COALESCE(r.prodKey,h.prodKey)
WHERE ISNULL(h.incomplete,0)>0 OR h.events IS NULL OR ROUND(ISNULL(r.activeQty,0)-h.recordedQty,2)<>0
ORDER BY week,p.ProdName,p.ProdKey`;

export function classifyReceipt(row) {
  if (!Number(row.events) || Number(row.incomplete)) return { ...row, correction: null, reason: '입고 이력 불충분' };
  const correction = Math.round((row.activeQty - row.recordedQty) * 100) / 100;
  const deletedMatch = correction < 0 && -correction === Number(row.deletedQty);
  return { ...row, correction, reason: deletedMatch ? '삭제 원장 수량과 초과분 일치' : '원장·입고이력 차이' };
}

export const eventSql = `
SELECT StockHistoryKey id,CONVERT(varchar(19),ChangeDtm,120) time,
 CASE WHEN Descr LIKE N'%삭제%' THEN N'삭제' WHEN Descr LIKE N'%수정%' THEN N'수정' ELSE N'입고 이력' END kind,
 BeforeValue beforeQty,AfterValue afterQty,ROUND(AfterValue-BeforeValue,2) delta
FROM StockHistory WHERE OrderYear=@year AND OrderWeek=@week AND ProdKey=@pk AND ChangeType=N'입고'
ORDER BY ChangeDtm,StockHistoryKey;
SELECT m.WarehouseKey id,CONVERT(varchar(19),m.UploadDtm,120) time,m.isDeleted deleted,
 ROUND(SUM(d.OutQuantity),2) qty
FROM WarehouseMaster m JOIN WarehouseDetail d ON d.WarehouseKey=m.WarehouseKey
WHERE m.OrderYear=@year AND m.OrderWeek=@week AND d.ProdKey=@pk
GROUP BY m.WarehouseKey,m.UploadDtm,m.isDeleted ORDER BY m.UploadDtm,m.WarehouseKey`;

export const matchSql = `
WITH changes AS (
 SELECT ProdKey, ROUND(SUM(AfterValue-BeforeValue),2) delta
 FROM StockHistory WHERE ChangeType=N'현재고동기화' AND ChangeDtm>=@day AND ChangeDtm<DATEADD(day,1,@day)
 GROUP BY ProdKey HAVING ROUND(SUM(AfterValue-BeforeValue),2)<>0
), receipts AS (
 SELECT v.OrderWeek week,v.ProdKey,SUM(v.OutQuantity) received
 FROM ViewWarehouse v JOIN changes c ON c.ProdKey=v.ProdKey
 WHERE v.OrderYear=@year AND v.UploadDtm<DATEADD(day,1,@day)
 GROUP BY v.OrderWeek,v.ProdKey
), hits AS (
 SELECT r.*,c.delta,COUNT(*) OVER(PARTITION BY r.ProdKey) alternatives
 FROM receipts r JOIN changes c ON c.ProdKey=r.ProdKey WHERE ROUND(r.received,2)=ABS(c.delta)
)
SELECT h.week,h.ProdKey prodKey,p.ProdName name,p.OutUnit unit,h.delta,h.received,h.alternatives,
 COUNT(*) OVER(PARTITION BY h.week) matches
FROM hits h JOIN Product p ON p.ProdKey=h.ProdKey ORDER BY matches DESC,h.week,p.ProdName`;
