// Row-specific review disposition, deliberately unrelated to permanent omission keys.
export function manualHoldProjection(alias = 'd') {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) throw Error('Invalid SQL alias');
  const latest = `FROM WebSalesDefectDeductionHistory held WHERE held.DeductionKey=${alias}.DeductionKey AND held.ActionType IN(N'SUPPORT_HOLD',N'SUPPORT_RESUME') ORDER BY held.HistoryKey DESC`;
  return `CASE WHEN (SELECT TOP 1 held.ActionType ${latest})=N'SUPPORT_HOLD' THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS ManualHeld,
    ISNULL((SELECT TOP 1 held.HistoryKey ${latest}),0) AS ManualHoldHistoryKey`;
}

export function manualHoldDescriptor(row) {
  return { deductionKey:Number(row.deductionKey), sourceYear:Number(row.orderYear), sourceWeek:String(row.orderWeek), expectedRowVersionNo:Number(row.rowVersionNo), expectedHoldHistoryKey:Number(row.manualHoldHistoryKey || 0) };
}

export function canSelectSupportDisposition(row = {}, heldList = false) {
  return Number(row.deductionKey) > 0 && (heldList ? Boolean(row.manualHeld) : !row.manualHeld);
}
