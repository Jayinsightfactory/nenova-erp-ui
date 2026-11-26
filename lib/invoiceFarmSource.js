// A historical receipt is evidence for a FarmName, never a synthetic FarmKey.
export async function listInvoiceFarmSources(queryFn) {
  const result = await queryFn(`WITH history AS (
    SELECT LTRIM(RTRIM(FarmName)) FarmName,MAX(WarehouseKey) WarehouseKey,COUNT(*) UsageCount
    FROM dbo.WarehouseMaster WHERE isDeleted=0 AND NULLIF(LTRIM(RTRIM(FarmName)),N'') IS NOT NULL GROUP BY LTRIM(RTRIM(FarmName))
  ), countries AS (
    SELECT LTRIM(RTRIM(w.FarmName)) FarmName,CASE WHEN COUNT(DISTINCT p.CounName)=1 THEN MAX(p.CounName) END CounName
    FROM dbo.WarehouseMaster w JOIN dbo.WarehouseDetail d ON d.WarehouseKey=w.WarehouseKey JOIN dbo.Product p ON p.ProdKey=d.ProdKey
    WHERE w.isDeleted=0 GROUP BY LTRIM(RTRIM(w.FarmName))
  ) SELECT f.FarmKey,f.FarmName,CAST(NULL AS int) WarehouseKey,c.CounName,ISNULL(h.UsageCount,0) UsageCount
    FROM dbo.Farm f LEFT JOIN dbo.Country c ON c.CounKey=f.CounKey LEFT JOIN history h ON h.FarmName=LTRIM(RTRIM(f.FarmName)) WHERE f.isDeleted=0
    UNION ALL
    SELECT NULL,h.FarmName,h.WarehouseKey,c.CounName,h.UsageCount FROM history h LEFT JOIN countries c ON c.FarmName=h.FarmName
    WHERE NOT EXISTS(SELECT 1 FROM dbo.Farm f JOIN dbo.Country knownCountry ON knownCountry.CounKey=f.CounKey
      WHERE f.isDeleted=0 AND LTRIM(RTRIM(f.FarmName))=h.FarmName
        AND NULLIF(LTRIM(RTRIM(knownCountry.CounName)),N'') IS NOT NULL AND knownCountry.CounName=c.CounName)`);
  if (!Array.isArray(result.recordset)) throw new Error('농장 조회 응답이 올바르지 않습니다.');
  return result.recordset;
}

export function hasReceiptFarmSource(document) {
  const meta = document?.reviewedMetadata || {};
  return document?.farmKey == null && Number.isSafeInteger(meta.farmSourceWarehouseKey)
    && meta.farmSourceWarehouseKey > 0 && typeof meta.farmName === 'string'
    && meta.farmName.trim().length > 0 && meta.farmName.length <= 100;
}

export function hasNewReceiptFarm(document) {
  const meta = document?.reviewedMetadata || {};
  return document?.farmKey == null && meta.farmSourceWarehouseKey == null
    && meta.isNewFarm === true && typeof meta.farmName === 'string'
    && meta.farmName.trim().length > 0 && meta.farmName.trim().length <= 100
    && String(meta.country || '').toUpperCase() !== 'NZ';
}

export async function readReceiptFarmSource({ queryFn, types, document, locked = false }) {
  if (!hasReceiptFarmSource(document)) return [];
  const meta = document.reviewedMetadata;
  const result = await queryFn(`SELECT WarehouseKey,FarmName FROM dbo.WarehouseMaster ${locked ? 'WITH (HOLDLOCK)' : ''}
    WHERE WarehouseKey=@farmSourceWarehouseKey AND isDeleted=0 AND FarmName=@selectedFarmName`, {
    farmSourceWarehouseKey: { type: types.Int, value: meta.farmSourceWarehouseKey },
    selectedFarmName: { type: types.NVarChar, value: meta.farmName },
  });
  if (!Array.isArray(result.recordset)) throw new Error('기존 입고 농장 근거를 조회하지 못했습니다.');
  return result.recordset.map(row => ({ FarmKey: null, FarmName: row.FarmName, WarehouseKey: row.WarehouseKey }));
}
