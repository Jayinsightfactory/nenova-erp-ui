






CREATE VIEW [dbo].[ViewOrder] AS
SELECT om.OrderMasterKey,
       om.OrderYear,
       om.OrderWeek,
	   SUBSTRING(om.OrderWeek,0,3) OrderWeek2,
	   om.OrderYear + SUBSTRING(om.OrderWeek, 0, 3) OrderYearWeek,
	   om.OrderYear + REPLACE(om.OrderWeek,'-', '') OrderYearWeek2,
       om.OrderDtm,
       ui.UserName Manager,
       om.CustKey,
       c.CustName,
       c.CustArea,
	   c.Manager BusinessManager,
	   c.Descr CustDescr,
	   ct.isUseOrderCode,
       om.OrderCode,
       om.Descr,
       od.OrderDetailKey,
       od.ProdKey,
	   p.ProdName,
	   p.FlowerName, 
	   p.CounName, 
	   p.CountryFlower,
       od.Descr DetailDescr,
       od.BoxQuantity,
       od.BunchQuantity,
       od.SteamQuantity,
       od.OutQuantity,
       od.EstQuantity,
	   od.NoneOutQuantity
  FROM OrderMaster om
  JOIN   OrderDetail od
    ON om.OrderMasterKey = od.OrderMasterKey
  JOIN   Customer c
    ON om.CustKey = c.CustKey AND c.isDeleted = 0
  JOIN   Product p
    ON od.ProdKey = p.ProdKey AND p.isDeleted = 0
  JOIN Country ct 
    ON p.CounName = ct.CounName
  JOIN UserInfo ui
    ON om.Manager = ui.UserID
 WHERE om.isDeleted = 0
   AND od.isDeleted = 0
