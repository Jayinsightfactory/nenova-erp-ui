export function normalizePivotAvailableWeeks(rows = []) {
  const unique = new Set();
  for (const row of rows) {
    const value = String(row?.OrderWeek ?? row?.week ?? row?.w ?? '').trim();
    const match = value.match(/^(\d{1,2})-(\d{1,2})$/);
    if (!match) continue;
    const major = Number(match[1]);
    const sub = Number(match[2]);
    if (!Number.isInteger(major) || major < 1 || major > 52) continue;
    if (!Number.isInteger(sub) || sub < 1 || sub > 9) continue;
    unique.add(`${String(major).padStart(2, '0')}-${String(sub).padStart(2, '0')}`);
  }
  return [...unique].sort((a, b) => {
    const [aw, as] = a.split('-').map(Number);
    const [bw, bs] = b.split('-').map(Number);
    return bw - aw || bs - as;
  });
}

export function mergePivotAvailableWeeks(...weekLists) {
  return normalizePivotAvailableWeeks(weekLists.flat().map(OrderWeek => ({ OrderWeek })));
}

export function defaultPivotBoardWeek(incomingWeeks = [], orderWeeks = []) {
  return mergePivotAvailableWeeks(incomingWeeks)[0] || mergePivotAvailableWeeks(orderWeeks)[0] || '';
}

export function selectedPivotWeekValue(value) {
  const text = String(value || '').trim();
  const full = text.match(/^\d{4}-(\d{2}-\d{2})$/);
  return full ? full[1] : text;
}

export function buildPivotAvailableWeeksSql(source = 'all', country = '') {
  if (source === 'orders') {
    return `SELECT DISTINCT OrderWeek
      FROM OrderMaster
      WHERE OrderYear=@year AND ISNULL(isDeleted,0)=0`;
  }
  if (source === 'incoming') {
    const countryFilter = country === 'netherlands'
      ? `AND (CounName LIKE N'%네덜란드%' OR CounName LIKE N'%Netherlands%' OR CounName LIKE N'%Holland%' OR CounName LIKE N'%Dutch%')`
      : country === 'china'
        ? `AND (CounName LIKE N'%중국%' OR CounName LIKE N'%China%')`
        : '';
    return `SELECT DISTINCT OrderWeek
      FROM dbo.ViewWarehouse
      WHERE OrderYear=@year AND ISNULL(OutQuantity,0)>0 ${countryFilter}`;
  }
  return `SELECT OrderWeek
     FROM (
       SELECT DISTINCT OrderWeek FROM OrderMaster
        WHERE OrderYear=@year AND ISNULL(isDeleted,0)=0
       UNION
       SELECT DISTINCT OrderWeek FROM WarehouseMaster
        WHERE OrderYear=@year AND ISNULL(isDeleted,0)=0
       UNION
       SELECT DISTINCT OrderWeek FROM ShipmentMaster
        WHERE OrderYear=@year AND ISNULL(isDeleted,0)=0
       UNION
       SELECT DISTINCT OrderWeek FROM StockMaster
        WHERE OrderYear=@year
     ) weeks`;
}
