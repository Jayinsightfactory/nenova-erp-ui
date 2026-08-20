// nenova.exe FormEstimateView 의 ShipmentDate.EstQuantity 저장 규칙.
// 출고분배 수량(ShipmentDate.ShipmentQuantity/ShipmentDetail.OutQuantity)과
// 견적서 날짜별 수량(ShipmentDate.EstQuantity)을 분리한다.

/** EXE 그리드가 표시·합산할 때 쓰는 정수 수량. */
export function exeRoundedEstimateQuantity(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/**
 * FormEstimateView.btnSave_Click / ClassShipmentDate.Update와 동일한 금액 계산.
 * Cost는 부가세 포함 단가, quantity는 EstQuantity.
 * Amount = Round(Cost * Round(qty,0) / 1.1, 0)
 * Vat    = Cost * Round(qty,0) - Amount
 */
export function exeDateAmountVat(cost, quantity) {
  const unitCost = Number(cost) || 0;
  const roundedQty = exeRoundedEstimateQuantity(quantity);
  const gross = unitCost * roundedQty;
  const amount = Math.round(gross / 1.1);
  const vat = gross - amount;
  return { roundedQty, amount, vat, gross };
}

/** SQL fallback/write 용. costExpr·qtyExpr 는 이미 안전한 식별자/식이어야 한다. */
export function exeAmountVatSql(costExpr, qtyExpr) {
  const roundedQty = `ROUND(CONVERT(DECIMAL(18,6), ${qtyExpr}), 0)`;
  const gross = `(CONVERT(DECIMAL(18,6), ${costExpr}) * ${roundedQty})`;
  return {
    roundedQty,
    gross,
    amount: `ROUND(${gross} / 1.1, 0)`,
    vat: `(${gross} - ROUND(${gross} / 1.1, 0))`,
  };
}

/**
 * EXE 저장 전 품목별 요일 행 합계 검증.
 * rows는 ShipmentDate 행이며, changes는 SdateKey → 새 EstQuantity 맵이다.
 */
export function checkExeDateQuantityTotal(rows, totalQuantity, changes = new Map()) {
  const changed = changes instanceof Map ? changes : new Map(Object.entries(changes || {}));
  const sum = (rows || []).reduce((total, row) => {
    const key = String(row.SdateKey);
    const value = changed.has(key) ? changed.get(key) : row.EstQuantity;
    return total + exeRoundedEstimateQuantity(value);
  }, 0);
  const expected = exeRoundedEstimateQuantity(totalQuantity);
  return {
    ok: sum === expected,
    sum,
    expected,
    diff: sum - expected,
  };
}

