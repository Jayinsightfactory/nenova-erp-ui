// Only canonical ERP weight items and the identified legacy duplicate shape.
export const WAREHOUSE_WEIGHT_ROW_SQL = `
  wd.ProdKey IN (3100, 3101)
  OR (wd.ProdKey IS NULL AND wd.BoxQuantity = 1 AND wd.BunchQuantity = 1
      AND wd.SteamOf1Box = 1 AND wd.SteamOf1Bunch = 1 AND wd.SteamQuantity > 0
      AND ISNULL(wd.UPrice, 0) = 0 AND ISNULL(wd.TPrice, 0) = 0
      AND EXISTS (
        SELECT 1 FROM dbo.WarehouseDetail canonicalWeight
        WHERE canonicalWeight.WarehouseKey = wd.WarehouseKey
          AND canonicalWeight.ProdKey IN (3100, 3101)
          AND canonicalWeight.SteamQuantity = wd.SteamQuantity
      ))`;
