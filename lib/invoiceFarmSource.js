// A historical receipt is evidence for a FarmName, never a synthetic FarmKey.
export async function listInvoiceFarmSources(queryFn) {
  const result = await queryFn(`SELECT FarmKey,FarmName,CAST(NULL AS int) WarehouseKey FROM dbo.Farm WHERE isDeleted=0
    UNION ALL
    SELECT NULL,LTRIM(RTRIM(w.FarmName)),MAX(w.WarehouseKey) FROM dbo.WarehouseMaster w
    WHERE w.isDeleted=0 AND NULLIF(LTRIM(RTRIM(w.FarmName)),N'') IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM dbo.Farm f WHERE f.isDeleted=0 AND LTRIM(RTRIM(f.FarmName))=LTRIM(RTRIM(w.FarmName)))
    GROUP BY LTRIM(RTRIM(w.FarmName))`);
  if (!Array.isArray(result.recordset)) throw new Error('농장 조회 응답이 올바르지 않습니다.');
  return result.recordset;
}

export function hasReceiptFarmSource(document) {
  const meta = document?.reviewedMetadata || {};
  return document?.farmKey == null && Number.isSafeInteger(meta.farmSourceWarehouseKey)
    && meta.farmSourceWarehouseKey > 0 && typeof meta.farmName === 'string'
    && meta.farmName.trim().length > 0 && meta.farmName.length <= 100;
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
