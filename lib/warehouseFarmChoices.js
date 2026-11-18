// Receipt labels are strings; only real Farm rows can supply distribution FarmKeys.
export function warehouseFarmChoicesSql({ locked = false, selected = false } = {}) {
  const hint = locked ? 'WITH (HOLDLOCK)' : '';
  return `SELECT MIN(FarmKey) AS FarmKey,FarmName FROM (
    SELECT f.FarmKey,f.FarmName COLLATE Latin1_General_100_BIN2 AS FarmName
      FROM dbo.Farm f ${hint} WHERE f.isDeleted=0 AND NOT EXISTS (
        SELECT 1 FROM dbo.Farm duplicate ${hint}
        WHERE duplicate.FarmName=f.FarmName AND duplicate.isDeleted=0 AND duplicate.FarmKey<>f.FarmKey
      )
    UNION ALL
    SELECT CAST(NULL AS int),wm.FarmName COLLATE Latin1_General_100_BIN2
      FROM dbo.WarehouseMaster wm ${hint}
      WHERE wm.isDeleted=0 AND NOT EXISTS (
        SELECT 1 FROM dbo.Farm known ${hint} WHERE known.FarmName=wm.FarmName
      )
  ) choices WHERE FarmName IS NOT NULL AND LTRIM(RTRIM(FarmName))<>N'' AND LEN(FarmName)<=100
    AND DATALENGTH(FarmName)=DATALENGTH(LTRIM(RTRIM(FarmName)))
    ${selected ? 'AND FarmName=@farm' : ''}
    GROUP BY FarmName ORDER BY FarmName`;
}

const searchKey = value => String(value ?? '').replace(/\s+/gu, '').toLocaleLowerCase('en-US');
export function warehouseFarmSearch(farms = [], search = '', current = []) {
  const names = [...new Set([...current, ...farms.map(f => f.FarmName)])]
    .filter(name => typeof name === 'string' && name.trim());
  const key = searchKey(search);
  return { names, matches: names.filter(name => searchKey(name).includes(key)) };
}
