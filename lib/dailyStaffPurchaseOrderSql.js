// Read-only SELECT query for KST daily registered orders with explicit OrderYear scope.
export const DAILY_STAFF_PURCHASE_ORDER_SQL = `
SELECT
  om.OrderMasterKey AS orderMasterKey,
  om.OrderYear AS orderYear,
  om.OrderWeek AS orderWeek,
  om.CustKey AS custKey,
  c.CustName AS custName,
  LTRIM(RTRIM(ISNULL(c.Manager, N''))) AS custManager,
  uiCust.UserID AS custManagerUserId,
  uiCust.UserName AS custManagerUserName,
  LTRIM(RTRIM(ISNULL(om.Manager, N''))) AS omManager,
  uiOm.UserID AS omManagerUserId,
  uiOm.UserName AS omManagerUserName,
  od.OrderDetailKey AS orderDetailKey,
  od.ProdKey AS prodKey,
  p.CounName AS counName,
  p.FlowerName AS flowerName,
  p.ProdGroup AS prodGroup,
  p.ProdName AS prodName,
  p.DisplayName AS displayName,
  p.OutUnit AS OutUnit,
  ISNULL(od.OutQuantity, 0) AS OutQuantity,
  ISNULL(od.Descr, N'') AS OdDescr,
  CASE
    WHEN od.CreateDtm >= @startDtm AND od.CreateDtm < @endDtm THEN LTRIM(RTRIM(ISNULL(od.CreateID, N'')))
    ELSE N''
  END AS odCreateId,
  CASE
    WHEN od.CreateDtm >= @startDtm AND od.CreateDtm < @endDtm THEN ISNULL(uiCreate.UserName, N'')
    ELSE N''
  END AS odCreateName,
  CASE
    WHEN od.LastUpdateDtm >= @startDtm AND od.LastUpdateDtm < @endDtm THEN LTRIM(RTRIM(ISNULL(od.LastUpdateID, N'')))
    ELSE N''
  END AS odUpdateId,
  CASE
    WHEN od.LastUpdateDtm >= @startDtm AND od.LastUpdateDtm < @endDtm THEN ISNULL(uiUpdate.UserName, N'')
    ELSE N''
  END AS odUpdateName,
  ISNULL(oh.todayActorId, N'') AS todayActorId,
  ISNULL(uiHist.UserName, N'') AS todayActorName,
  CONVERT(NVARCHAR(19), COALESCE(oh.todayChangeDtm, od.LastUpdateDtm, od.CreateDtm), 120) AS registeredAt
FROM OrderMaster om
JOIN OrderDetail od
  ON od.OrderMasterKey = om.OrderMasterKey
 AND ISNULL(od.isDeleted, 0) = 0
JOIN Customer c
  ON c.CustKey = om.CustKey
 AND ISNULL(c.isDeleted, 0) = 0
JOIN Product p
  ON p.ProdKey = od.ProdKey
 AND ISNULL(p.isDeleted, 0) = 0
OUTER APPLY (
  SELECT TOP 1
    LTRIM(RTRIM(ISNULL(h.ChangeID, N''))) AS todayActorId,
    h.ChangeDtm AS todayChangeDtm
  FROM OrderHistory h
  WHERE h.OrderDetailKey = od.OrderDetailKey
    AND h.ChangeDtm >= @startDtm
    AND h.ChangeDtm < @endDtm
    AND (h.ColumName IS NULL OR h.ColumName IN (N'주문수량', N'수량'))
  ORDER BY h.OrderHistoryKey DESC
) oh
OUTER APPLY (
  SELECT TOP 1 UserID, UserName
  FROM UserInfo ui
  WHERE ISNULL(ui.isDeleted, 0) = 0
    AND (ui.UserID = LTRIM(RTRIM(ISNULL(c.Manager, N''))) OR ui.UserName = LTRIM(RTRIM(ISNULL(c.Manager, N''))))
  ORDER BY CASE WHEN ui.UserID = LTRIM(RTRIM(ISNULL(c.Manager, N''))) THEN 0 ELSE 1 END
) uiCust
LEFT JOIN UserInfo uiOm
  ON uiOm.UserID = LTRIM(RTRIM(ISNULL(om.Manager, N'')))
 AND ISNULL(uiOm.isDeleted, 0) = 0
LEFT JOIN UserInfo uiCreate
  ON uiCreate.UserID = LTRIM(RTRIM(ISNULL(od.CreateID, N'')))
 AND ISNULL(uiCreate.isDeleted, 0) = 0
LEFT JOIN UserInfo uiUpdate
  ON uiUpdate.UserID = LTRIM(RTRIM(ISNULL(od.LastUpdateID, N'')))
 AND ISNULL(uiUpdate.isDeleted, 0) = 0
LEFT JOIN UserInfo uiHist
  ON uiHist.UserID = oh.todayActorId
 AND ISNULL(uiHist.isDeleted, 0) = 0
WHERE ISNULL(om.isDeleted, 0) = 0
  AND om.OrderYear >= N'2020'
  AND ISNULL(od.OutQuantity, 0) > 0
  AND (
    (od.CreateDtm >= @startDtm AND od.CreateDtm < @endDtm)
    OR (od.LastUpdateDtm >= @startDtm AND od.LastUpdateDtm < @endDtm)
    OR oh.todayChangeDtm IS NOT NULL
  )
ORDER BY c.CustName, p.FlowerName, p.ProdName, od.OrderDetailKey`;
