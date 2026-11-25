// Canonical ERP special rows (2182 운송료, 3100 Gross weight, 3101 Chargeable weight),
// legacy country/flower freight ProdKeys (~2026-05-02 Holex/EZ 2256 네덜란드 운송료 등),
// and legacy weigth-typo orphan weight rows (ProdKey IS NULL, Box=1, Bunch=1, UPrice=0, TPrice=0).
export const SPECIAL_WAREHOUSE_PROD_KEYS = new Set([2182, 3100, 3101]);

export const WAREHOUSE_FREIGHT_PROD_KEYS_LIST = Object.freeze([
  2182, 2253, 2254, 2255, 2256, 2257, 2258, 2259,
  2260, 2262, 2367, 2648, 2649, 2682, 2867, 2868,
]);
export const WAREHOUSE_FREIGHT_PROD_KEYS = new Set(WAREHOUSE_FREIGHT_PROD_KEYS_LIST);
export const WAREHOUSE_FREIGHT_PROD_KEYS_SQL = WAREHOUSE_FREIGHT_PROD_KEYS_LIST.join(', ');

export function isOrphanWeightDetailRow(row) {
  if (!row || row.ProdKey != null || row.prodKey != null) return false;
  if (row.OutQuantity != null || row.outQuantity != null) return false;
  const box = Number(row.BoxQuantity ?? row.boxQuantity);
  const bunch = Number(row.BunchQuantity ?? row.bunchQuantity);
  const sbox = row.SteamOf1Box ?? row.steamOf1Box ?? 1;
  const sbunch = row.SteamOf1Bunch ?? row.steamOf1Bunch ?? 1;
  const uprice = Number(row.UPrice ?? row.unitPrice ?? row['단가'] ?? 0);
  const tprice = Number(row.TPrice ?? row.lineAmount ?? row['총액'] ?? 0);
  return box === 1 && bunch === 1 && Number(sbox) === 1 && Number(sbunch) === 1 && uprice === 0 && tprice === 0;
}

export function isSpecialWarehouseDetailRow(row) {
  const key = Number(row?.ProdKey ?? row?.prodKey);
  return SPECIAL_WAREHOUSE_PROD_KEYS.has(key) || isOrphanWeightDetailRow(row);
}

export const WAREHOUSE_ORPHAN_WEIGHT_ROW_SQL = `(wd.ProdKey IS NULL AND wd.BoxQuantity = 1 AND wd.BunchQuantity = 1
      AND ISNULL(wd.SteamOf1Box, 1) = 1 AND ISNULL(wd.SteamOf1Bunch, 1) = 1
      AND wd.OutQuantity IS NULL
      AND ISNULL(wd.UPrice, 0) = 0 AND ISNULL(wd.TPrice, 0) = 0)`;

export const WAREHOUSE_WEIGHT_ROW_SQL = `
  wd.ProdKey IN (3100, 3101)
  OR ${WAREHOUSE_ORPHAN_WEIGHT_ROW_SQL}`;
