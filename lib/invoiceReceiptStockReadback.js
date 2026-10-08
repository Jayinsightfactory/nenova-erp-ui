import { receiptError } from './invoiceReceiptNative.js';

const MAX_CHANGED_PRODUCTS = 1000;

const param = (type, value) => ({ type, value });

function fail(code, message, details) {
  const error = receiptError(code, message, 500);
  if (details !== undefined) error.details = details;
  throw error;
}

function normalizeScope(document) {
  const orderYear = String(document?.orderYear ?? '');
  const orderWeek = String(document?.orderWeek ?? '');
  if (!/^\d{4}$/.test(orderYear) || Number(orderYear) <= 2025
    || !/^\d{2}-\d{2}$/.test(orderWeek)) {
    throw receiptError(
      'STOCK_READBACK_SCOPE_INVALID',
      '재고 검증은 2026년 이후의 명시 연도와 세부차수가 필요합니다.',
      400,
    );
  }
  return { orderYear, orderWeek };
}

function normalizeProductKeys(changedProdKeys) {
  if (!Array.isArray(changedProdKeys)) {
    throw new TypeError('changedProdKeys must be an array');
  }
  const keys = [...new Set(changedProdKeys.map(Number))];
  if (keys.length > MAX_CHANGED_PRODUCTS
    || keys.some(key => !Number.isInteger(key) || key <= 0 || key > 2147483647)) {
    throw receiptError(
      'STOCK_READBACK_PRODUCT_SCOPE_INVALID',
      `재고 검증 품목은 ${MAX_CHANGED_PRODUCTS}개 이하의 양수 정수키여야 합니다.`,
      400,
    );
  }
  return keys;
}

function readbackSql(keys) {
  const values = keys.map((_, index) => `(${index},@p${index})`).join(',');
  return `SET NOCOUNT ON;
    DECLARE @startOrderYearWeek nvarchar(20)=@year+REPLACE(@week,N'-',N'');
    DECLARE @products TABLE (Ordinal int PRIMARY KEY,ProdKey int NOT NULL UNIQUE);
    INSERT @products (Ordinal,ProdKey) VALUES ${values};

    SELECT requested.ProdKey,COUNT_BIG(activeProduct.ProdKey) AS ActiveProductCount
      FROM @products requested
      LEFT JOIN dbo.Product activeProduct WITH (HOLDLOCK)
        ON activeProduct.ProdKey=requested.ProdKey AND activeProduct.isDeleted=0
     GROUP BY requested.Ordinal,requested.ProdKey
     ORDER BY requested.Ordinal;

    SELECT
      (SELECT COUNT_BIG(*) FROM dbo.StockMaster selectedMaster WITH (HOLDLOCK)
        WHERE selectedMaster.OrderYear=@year AND selectedMaster.OrderWeek=@week
          AND selectedMaster.OrderYearWeek=@startOrderYearWeek) AS SelectedMasterCount,
      (SELECT COUNT_BIG(*) FROM dbo.StockMaster futureMaster WITH (HOLDLOCK)
        WHERE futureMaster.OrderYearWeek>=@startOrderYearWeek) AS FutureMasterCount;

    ;WITH scopes AS (
      SELECT sm.StockKey,sm.OrderYear,sm.OrderWeek,sm.OrderYearWeek,
        (SELECT COUNT_BIG(*) FROM dbo.StockMaster sameBusinessScope WITH (HOLDLOCK)
          WHERE sameBusinessScope.OrderYear=sm.OrderYear
            AND sameBusinessScope.OrderWeek=sm.OrderWeek) AS BusinessScopeCount,
        (SELECT COUNT_BIG(*) FROM dbo.StockMaster sameNativeScope WITH (HOLDLOCK)
          WHERE sameNativeScope.OrderYearWeek=sm.OrderYearWeek) AS NativeScopeCount
      FROM dbo.StockMaster sm WITH (HOLDLOCK)
      WHERE sm.OrderYearWeek>=@startOrderYearWeek
    )
    SELECT scope.StockKey,scope.OrderYear,scope.OrderWeek,scope.OrderYearWeek,
      scope.BusinessScopeCount,scope.NativeScopeCount,requested.ProdKey,
      ISNULL(previousMaster.PreviousMasterCount,0) AS PreviousMasterCount,
      previousMaster.PreviousStockKey,
      ISNULL(previousStock.PreviousStockCount,0) AS PreviousStockCount,
      ISNULL(previousStock.PreviousStock,0) AS PreviousStock,
      ISNULL(warehouseQuantity.WarehouseQuantity,0) AS WarehouseQuantity,
      ISNULL(shipmentQuantity.ShipmentQuantity,0) AS ShipmentQuantity,
      ISNULL(manualQuantity.ManualQuantity,0) AS ManualQuantity,
      ISNULL(currentStock.CurrentStockCount,0) AS CurrentStockCount,
      currentStock.ActualStock,expected.ExpectedStock,
      CASE WHEN currentStock.CurrentStockCount=1
        AND CONVERT(decimal(38,10),currentStock.ActualStock)
          =CONVERT(decimal(38,10),expected.ExpectedStock)
        THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END AS IsMatch
    FROM scopes scope
    CROSS JOIN @products requested
    OUTER APPLY (
      SELECT TOP 1 prior.OrderYearWeek AS PreviousOrderYearWeek
      FROM dbo.StockMaster prior WITH (HOLDLOCK)
      WHERE prior.OrderYearWeek<scope.OrderYearWeek
      ORDER BY prior.OrderYearWeek DESC,prior.OrderWeek DESC
    ) previousScope
    OUTER APPLY (
      SELECT COUNT_BIG(*) AS PreviousMasterCount,MIN(prior.StockKey) AS PreviousStockKey
      FROM dbo.StockMaster prior WITH (HOLDLOCK)
      WHERE prior.OrderYearWeek=previousScope.PreviousOrderYearWeek
    ) previousMaster
    OUTER APPLY (
      SELECT COUNT_BIG(*) AS PreviousStockCount,MIN(ps.Stock) AS PreviousStock
      FROM dbo.ProductStock ps WITH (HOLDLOCK)
      WHERE ps.StockKey=previousMaster.PreviousStockKey AND ps.ProdKey=requested.ProdKey
    ) previousStock
    OUTER APPLY (
      SELECT ROUND(SUM(vw.OutQuantity),2) AS WarehouseQuantity
      FROM dbo.ViewWarehouse vw WITH (HOLDLOCK)
      WHERE vw.OrderYear=scope.OrderYear AND vw.OrderWeek=scope.OrderWeek
        AND vw.ProdKey=requested.ProdKey
    ) warehouseQuantity
    OUTER APPLY (
      SELECT ROUND(SUM(vs.OutQuantity),2) AS ShipmentQuantity
      FROM dbo.ViewShipment vs WITH (HOLDLOCK)
      WHERE vs.OrderYear=scope.OrderYear AND vs.OrderWeek=scope.OrderWeek
        AND vs.ProdKey=requested.ProdKey AND vs.DetailFix=1
    ) shipmentQuantity
    OUTER APPLY (
      SELECT ROUND(SUM(sh.AfterValue-sh.BeforeValue),2) AS ManualQuantity
      FROM dbo.StockHistory sh WITH (HOLDLOCK)
      JOIN dbo.CodeInfo ci WITH (HOLDLOCK)
        ON ci.Category=N'StockType' AND sh.ChangeType=ci.Descr
      WHERE sh.OrderYear=scope.OrderYear AND sh.OrderWeek=scope.OrderWeek
        AND sh.ProdKey=requested.ProdKey
    ) manualQuantity
    OUTER APPLY (
      SELECT COUNT_BIG(*) AS CurrentStockCount,MIN(ps.Stock) AS ActualStock
      FROM dbo.ProductStock ps WITH (HOLDLOCK)
      WHERE ps.StockKey=scope.StockKey AND ps.ProdKey=requested.ProdKey
    ) currentStock
    OUTER APPLY (
      SELECT ROUND(ISNULL(previousStock.PreviousStock,0)
        +ISNULL(warehouseQuantity.WarehouseQuantity,0)
        -ISNULL(shipmentQuantity.ShipmentQuantity,0)
        +ISNULL(manualQuantity.ManualQuantity,0),2) AS ExpectedStock
    ) expected
    ORDER BY scope.OrderYear,scope.OrderWeek,requested.Ordinal;`;
}

function number(value) {
  const converted = Number(value);
  return Number.isFinite(converted) ? converted : null;
}

/**
 * Read-only postcondition for native usp_StockCalculation.
 *
 * Returns the selected/future snapshot rows for the changed active products.
 * Any missing/duplicate scope, missing current ProductStock row, duplicate prior
 * ProductStock row, or SQL-native ROUND(...,2) formula mismatch throws.
 */
export async function verifyInvoiceStockReadback(queryFn, types, document, changedProdKeys) {
  if (typeof queryFn !== 'function' || !types?.Int || !types?.NVarChar) {
    throw new TypeError('queryFn and SQL Int/NVarChar types are required');
  }
  const { orderYear, orderWeek } = normalizeScope(document);
  const keys = normalizeProductKeys(changedProdKeys);
  if (!keys.length) {
    return { orderYear, orderWeek, changedProdKeys: [], stockMasterCount: 0, rows: [] };
  }

  const params = {
    year: param(types.NVarChar, orderYear),
    week: param(types.NVarChar, orderWeek),
  };
  keys.forEach((key, index) => { params[`p${index}`] = param(types.Int, key); });

  const result = await queryFn(readbackSql(keys), params);
  const sets = result?.recordsets;
  if (!Array.isArray(sets) || sets.length < 3
    || !Array.isArray(sets[0]) || !Array.isArray(sets[1]) || !Array.isArray(sets[2])
    || sets[0].length !== keys.length || sets[1].length !== 1) {
    fail('STOCK_READBACK_RESULT_INVALID', '재고 검증 조회 결과가 불완전합니다.');
  }

  const inactive = sets[0].filter((row, index) => row.ProdKey !== keys[index]
    || number(row.ActiveProductCount) !== 1).map(row => row.ProdKey);
  if (inactive.length) {
    fail('STOCK_READBACK_PRODUCT_SCOPE_CHANGED', '재고 검증 대상 품목이 없거나 비활성 상태입니다.', { prodKeys: inactive });
  }

  const selectedMasterCount = number(sets[1][0].SelectedMasterCount);
  const stockMasterCount = number(sets[1][0].FutureMasterCount);
  if (selectedMasterCount === 0 || stockMasterCount === 0) {
    fail('STOCK_READBACK_MISSING', '선택 차수 또는 후속 재고 스냅샷이 없습니다.');
  }
  if (selectedMasterCount !== 1) {
    fail('STOCK_READBACK_DUPLICATE', '선택 차수 재고 마스터가 중복되었습니다.', { selectedMasterCount });
  }
  if (!Number.isInteger(stockMasterCount) || sets[2].length !== stockMasterCount * keys.length) {
    fail('STOCK_READBACK_RESULT_INVALID', '후속 재고 검증 행 수가 예상 범위와 다릅니다.');
  }

  const duplicate = sets[2].find(row => number(row.BusinessScopeCount) !== 1
    || number(row.NativeScopeCount) !== 1
    || ![0, 1].includes(number(row.PreviousMasterCount))
    || number(row.PreviousStockCount) > 1
    || number(row.CurrentStockCount) > 1);
  if (duplicate) {
    fail('STOCK_READBACK_DUPLICATE', '재고 마스터 또는 품목 스냅샷이 중복되었습니다.', {
      stockKey: duplicate.StockKey,
      orderYear: duplicate.OrderYear,
      orderWeek: duplicate.OrderWeek,
      prodKey: duplicate.ProdKey,
    });
  }

  const missing = sets[2].find(row => number(row.CurrentStockCount) !== 1);
  if (missing) {
    fail('STOCK_READBACK_MISSING', 'native 계산 후 품목 재고 스냅샷이 없습니다.', {
      stockKey: missing.StockKey,
      orderYear: missing.OrderYear,
      orderWeek: missing.OrderWeek,
      prodKey: missing.ProdKey,
    });
  }

  const mismatch = sets[2].find(row => ![true, 1].includes(row.IsMatch)
    || number(row.ActualStock) === null || number(row.ExpectedStock) === null);
  if (mismatch) {
    fail('STOCK_READBACK_MISMATCH', 'native 계산 후 품목 재고가 원장 공식과 다릅니다.', {
      stockKey: mismatch.StockKey,
      orderYear: mismatch.OrderYear,
      orderWeek: mismatch.OrderWeek,
      prodKey: mismatch.ProdKey,
      expectedStock: number(mismatch.ExpectedStock),
      actualStock: number(mismatch.ActualStock),
    });
  }

  return {
    orderYear,
    orderWeek,
    changedProdKeys: keys,
    stockMasterCount,
    rows: sets[2].map(row => ({
      stockKey: number(row.StockKey),
      orderYear: String(row.OrderYear),
      orderWeek: String(row.OrderWeek),
      orderYearWeek: String(row.OrderYearWeek),
      prodKey: number(row.ProdKey),
      previousStock: number(row.PreviousStock),
      warehouseQuantity: number(row.WarehouseQuantity),
      shipmentQuantity: number(row.ShipmentQuantity),
      manualQuantity: number(row.ManualQuantity),
      expectedStock: number(row.ExpectedStock),
      actualStock: number(row.ActualStock),
    })),
  };
}
